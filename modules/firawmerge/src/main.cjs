const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { mergeThree, compareTwo, mergeThreeArrays, compareTwoArrays } = require('./merge.cjs');
const { MODELS, scanHardware, recommend, assessSuggestion } = require('./ai-config.cjs');
const { detectFormat, delimiterFor, splitTableRows, hexRows, imageData, isHttpUrl, fileMatchesMask } = require('./formats.cjs');

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_BYTES = 30 * 1024 * 1024;
const { startUpdates } = require('./updates.cjs');
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
let window;
let workspace;
let activeBatch;
let webSnapshots = new Map();
let pendingShellPaths = [];

function queueShellPaths(paths) {
  for (const item of paths) {
    if (pendingShellPaths.some(existing => existing.path.toLocaleLowerCase() === item.path.toLocaleLowerCase())) continue;
    if (pendingShellPaths.length === 3) break;
    pendingShellPaths.push(item);
  }
}

async function selectedShellPaths(argv) {
  if (!app.isPackaged) return [];
  const paths = [];
  for (const value of argv.slice(1)) {
    if (!value || value.startsWith('--')) continue;
    try {
      const stat = await fs.stat(value);
      if (stat.isFile() || stat.isDirectory()) paths.push({ path: value, kind: stat.isDirectory() ? 'folder' : 'file' });
    } catch { /* Ignora argumentos que não são arquivos ou pastas. */ }
    if (paths.length === 3) break;
  }
  return paths;
}

async function receiveShellPaths(argv) {
  const paths = await selectedShellPaths(argv);
  if (!paths.length) return;
  queueShellPaths(paths);
  if (window && !window.isDestroyed() && !window.webContents.isLoading()) {
    window.show(); window.focus(); window.webContents.send('shell:paths', pendingShellPaths); pendingShellPaths = [];
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1040, minHeight: 680,
    backgroundColor: '#080d16', title: 'FirawMerge',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.once('did-finish-load', () => {
    if (pendingShellPaths.length) { window.webContents.send('shell:paths', pendingShellPaths); pendingShellPaths = []; }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => { receiveShellPaths(argv); });
  app.whenReady().then(async () => {
    queueShellPaths(await selectedShellPaths(process.argv));
    createWindow();
    startUpdates(app);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('dialog:choose', async (_event, kind) => {
  const properties = kind === 'folder' ? ['openDirectory'] : ['openFile'];
  const result = await dialog.showOpenDialog(window, { properties });
  return result.canceled ? null : result.filePaths[0];
});

async function collect(root, kind, format, mask, includeSubfolders) {
  if (!root) return new Map();
  if (isHttpUrl(root)) {
    if (kind !== 'file' || format !== 'webpage') throw new Error('URLs são aceitas apenas no modo Página da Web.');
    return new Map([['__single__', root]]);
  }
  const stat = await fs.stat(root);
  if (kind === 'file') {
    if (!stat.isFile()) throw new Error(`Não é um arquivo: ${root}`);
    return new Map([['__single__', root]]);
  }
  if (!stat.isDirectory()) throw new Error(`Não é uma pasta: ${root}`);
  const map = new Map();
  async function visit(dir, relative) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && includeSubfolders) await visit(full, rel);
      if (entry.isFile()) {
        if (!fileMatchesMask(rel, mask)) continue;
        map.set(rel, full);
        if (map.size > 20000) throw new Error('Pasta com mais de 20.000 arquivos. Selecione uma subpasta.');
      }
    }
  }
  await visit(root, '');
  return map;
}

async function sourceBuffer(file) {
  if (!isHttpUrl(file)) return fs.readFile(file);
  if (webSnapshots.has(file)) return webSnapshots.get(file);
  const response = await fetch(file, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Não foi possível abrir ${file}: HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_PREVIEW_BYTES) throw new Error('Página acima de 2 MB.');
  const chunks = [];
  let total = 0;
  if (!response.body) throw new Error('A página não retornou conteúdo.');
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_PREVIEW_BYTES) throw new Error('Página acima de 2 MB.');
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  webSnapshots.set(file, buffer);
  return buffer;
}

async function fingerprint(file) {
  if (!file) return null;
  if (isHttpUrl(file)) {
    const buffer = await sourceBuffer(file);
    return { size: buffer.length, hash: crypto.createHash('sha256').update(buffer).digest('hex') };
  }
  const stat = await fs.stat(file);
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { size: stat.size, hash: hash.digest('hex') };
}

function fileStatus(records, hasBase, kind, slots) {
  const present = records.map(Boolean);
  const type = kind === 'folder' ? 'Pasta' : 'Arquivo';
  const label = side => `${type} 0${(slots[side] ?? side) + 1}`;
  if (!present[1] && !present[2] && present[0]) return `só ${label(0)}`;
  if (!present[1]) return `só ${label(2)}`;
  if (!present[2]) return `só ${label(1)}`;
  if (hasBase && !present[0]) return records[1].hash === records[2].hash ? 'novo igual' : 'novo divergente';
  if (hasBase && records[0].hash === records[1].hash && records[1].hash === records[2].hash) return 'igual';
  if (hasBase && records[1].hash === records[2].hash) return 'alterado igual';
  if (records[1].hash === records[2].hash) return 'igual';
  return 'diferente';
}

ipcMain.handle('workspace:open', async (_event, spec) => {
  if (activeBatch) activeBatch.abort();
  const { kind, base, origin, destination, format = 'auto', mask = '*', includeSubfolders = true } = spec;
  if (!['file', 'folder'].includes(kind)) throw new Error('Selecione pastas ou arquivos.');
  if (!['auto', 'text', 'table', 'binary', 'image', 'webpage'].includes(format)) throw new Error('Tipo de comparação inválido.');
  const selected = [base, origin, destination].map((value, index) => ({ value: typeof value === 'string' ? value.trim() : '', index }))
    .filter(item => item.value);
  if (selected.length < 2) throw new Error('Selecione pelo menos duas pastas ou arquivos.');
  webSnapshots = new Map();
  const roots = selected.length === 3 ? selected.map(item => item.value) : [null, selected[0].value, selected[1].value];
  const slots = selected.length === 3 ? [0, 1, 2] : [null, selected[0].index, selected[1].index];
  const maps = await Promise.all(roots.map(root => collect(root, kind, format, mask, includeSubfolders)));
  const keys = [...new Set(maps.flatMap(map => [...map.keys()]))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const items = [];
  for (const key of keys) {
    const files = maps.map(map => map.get(key) || null);
    const records = await Promise.all(files.map(fingerprint));
    const name = kind === 'file' ? isHttpUrl(roots[1]) ? path.basename(new URL(roots[1]).pathname) || new URL(roots[1]).hostname : path.basename(roots[1]) : key;
    items.push({ key, name, files, status: fileStatus(records, !!roots[0], kind, slots), sizes: records.map(record => record?.size ?? null) });
  }
  workspace = { kind, roots, slots, items, format, mask, includeSubfolders };
  return { kind, roots, slots, format, mask, includeSubfolders, items: items.map(({ files, ...item }) => item) };
});

ipcMain.handle('workspace:session-save', async (_event, session) => {
  if (!workspace || session?.app !== 'FirawMerge' || session?.version !== 1 ||
      !session.comparison || !session.review) throw new Error('Trabalho inválido para salvar.');
  const contents = JSON.stringify({ ...session, savedAt: new Date().toISOString() }, null, 2);
  if (Buffer.byteLength(contents) > MAX_SESSION_BYTES) throw new Error('O trabalho ultrapassou 64 MB.');
  const chosen = await dialog.showSaveDialog(window, {
    title: 'Salvar trabalho do FirawMerge',
    defaultPath: path.join(app.getPath('documents'), 'FirawMerge-trabalho.firawmerge'),
    filters: [{ name: 'Trabalho FirawMerge', extensions: ['firawmerge'] }]
  });
  if (chosen.canceled || !chosen.filePath) return null;
  await fs.writeFile(chosen.filePath, contents, 'utf8');
  return chosen.filePath;
});

ipcMain.handle('workspace:session-load', async () => {
  const chosen = await dialog.showOpenDialog(window, {
    title: 'Abrir trabalho do FirawMerge', properties: ['openFile'],
    filters: [{ name: 'Trabalho FirawMerge', extensions: ['firawmerge'] }]
  });
  if (chosen.canceled || !chosen.filePaths.length) return null;
  const file = chosen.filePaths[0];
  if ((await fs.stat(file)).size > MAX_SESSION_BYTES) throw new Error('O trabalho ultrapassa 64 MB.');
  let session;
  try { session = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw new Error('Arquivo de trabalho inválido.'); }
  const comparison = session?.comparison;
  if (session?.app !== 'FirawMerge' || session.version !== 1 ||
      !['folder', 'file'].includes(comparison?.kind) ||
      !['auto', 'text', 'table', 'binary', 'image', 'webpage'].includes(comparison?.format) ||
      !comparison.paths || Object.values(comparison.paths).filter(value => typeof value === 'string' && value.trim()).length < 2 ||
      !session.review || typeof session.review !== 'object') throw new Error('Arquivo de trabalho incompatível ou incompleto.');
  return { path: file, session };
});

function decode(buffer) {
  if (buffer.length > MAX_PREVIEW_BYTES) return { error: 'Arquivo acima de 2 MB; prévia de texto indisponível.' };
  if (buffer.includes(0) && !(buffer[0] === 0xff && buffer[1] === 0xfe)) return { error: 'Arquivo binário; esta versão compara o conteúdo por hash, sem editor binário.' };
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: true };
  const bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(bom ? 3 : 0)), encoding: 'utf8', bom }; }
  catch { return { error: 'Codificação não suportada. Use UTF-8 ou UTF-16 LE para editar.' }; }
}

async function detailFor(item, requestedFormat = workspace.format) {
  const format = requestedFormat === 'auto' ? detectFormat(item.name) : requestedFormat;
  if (!['text', 'table', 'binary', 'image', 'webpage'].includes(format)) throw new Error('Tipo de comparação inválido.');
  const byteLimit = ['image', 'binary'].includes(format) ? 8 * 1024 * 1024 : MAX_PREVIEW_BYTES;
  for (const file of item.files) {
    if (file && !isHttpUrl(file) && (await fs.stat(file)).size > byteLimit)
      return { key: item.key, name: item.name, status: item.status, format, error: `Arquivo acima de ${byteLimit / 1048576} MB; prévia indisponível.` };
  }
  const buffers = await Promise.all(item.files.map(async file => file ? sourceBuffer(file) : Buffer.alloc(0)));
  if (format === 'binary' || format === 'image') {
    if (buffers.some(buffer => buffer.length > 8 * 1024 * 1024)) return { key: item.key, name: item.name, status: item.status, format,
      error: 'Arquivo acima de 8 MB; prévia indisponível.' };
    const assets = format === 'image' ? buffers.map((buffer, i) => item.files[i] ? imageData(item.files[i], buffer) : null) :
      buffers.map((buffer, i) => item.files[i] ? `data:application/octet-stream;base64,${buffer.toString('base64')}` : null);
    return { key: item.key, name: item.name, status: item.status, format, assets,
      hexes: format === 'binary' ? buffers.map(buffer => hexRows(buffer)) : null, lengths: buffers.map(buffer => buffer.length),
      hashes: buffers.map(buffer => crypto.createHash('sha256').update(buffer).digest('hex')),
      conflicts: 0 };
  }
  const reads = buffers.map((buffer, index) => !item.files[index] ? { text: '', missing: true } : decode(buffer));
  const failure = reads.find(read => read.error);
  if (failure) return { key: item.key, name: item.name, status: item.status, format, error: failure.error };
  const texts = reads.map(read => read.text);
  const rows = format === 'table' ? texts.map(splitTableRows) : null;
  const analysis = rows ? (workspace.roots[0] ? mergeThreeArrays(...rows) : compareTwoArrays(rows[1], rows[2])) :
    (workspace.roots[0] ? mergeThree(...texts) : compareTwo(texts[1], texts[2]));
  return { key: item.key, name: item.name, status: item.status, format, texts, reads,
    delimiter: format === 'table' ? delimiterFor(item.name) : null, ...analysis };
}

ipcMain.handle('workspace:detail', async (_event, key, format) => {
  const item = workspace?.items.find(candidate => candidate.key === key);
  if (!item) throw new Error('Arquivo não encontrado na sessão.');
  return detailFor(item, format || workspace.format);
});

ipcMain.handle('workspace:save', async (_event, { key, text }) => {
  const item = workspace?.items.find(candidate => candidate.key === key);
  if (!item || typeof text !== 'string') throw new Error('Resultado inválido.');
  const original = item.files[2];
  const name = isHttpUrl(original) ? path.basename(new URL(original).pathname) || 'pagina.html' : path.basename(original || item.name);
  const parsed = path.parse(name);
  const defaultDir = isHttpUrl(original) ? app.getPath('documents') : path.dirname(original || workspace.roots[2]);
  const defaultPath = path.join(defaultDir, `${parsed.name}.merged${parsed.ext}`);
  const chosen = await dialog.showSaveDialog(window, { title: 'Salvar resultado do merge', defaultPath });
  if (chosen.canceled || !chosen.filePath) return null;
  const source = original ? decode(await sourceBuffer(original)) : { encoding: 'utf8', bom: false, text: '' };
  const eol = source.text?.includes('\r\n') ? '\r\n' : '\n';
  let content = text.replace(/\r\n|\r|\n/g, eol);
  let buffer = Buffer.from(content, source.encoding === 'utf16le' ? 'utf16le' : 'utf8');
  if (source.bom) buffer = Buffer.concat([source.encoding === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xef, 0xbb, 0xbf]), buffer]);
  await fs.writeFile(chosen.filePath, buffer);
  return chosen.filePath;
});

ipcMain.handle('workspace:save-asset', async (_event, { key, side }) => {
  const item = workspace?.items.find(candidate => candidate.key === key);
  if (!item || ![0, 1, 2].includes(side) || !item.files[side]) throw new Error('Versão indisponível.');
  const name = path.basename(item.files[side]);
  const parsed = path.parse(name);
  const chosen = await dialog.showSaveDialog(window, { title: 'Salvar versão escolhida',
    defaultPath: path.join(path.dirname(item.files[side]), `${parsed.name}.merged${parsed.ext}`) });
  if (chosen.canceled || !chosen.filePath) return null;
  if (path.resolve(chosen.filePath).toLowerCase() === path.resolve(item.files[side]).toLowerCase())
    throw new Error('Escolha outro caminho para preservar o original.');
  await fs.copyFile(item.files[side], chosen.filePath);
  return chosen.filePath;
});

ipcMain.handle('workspace:export', async (_event, resolutions) => {
  if (!workspace) throw new Error('Abra uma comparação primeiro.');
  const selected = resolutions?.results || resolutions || {};
  const aiReviews = resolutions?.aiReviews || {};
  const assetSelections = resolutions?.assetSelections || {};
  const formats = resolutions?.formats || {};
  const entries = [];
  let total = 0;
  for (const item of workspace.items) {
    if (item.status === 'igual') continue;
    const detail = await detailFor(item, formats[item.key] || workspace.format);
    if (detail.error) {
      entries.push({ key: item.key, name: item.name, status: item.status, error: detail.error });
      continue;
    }
    const entry = { key: item.key, name: item.name, status: item.status, format: detail.format,
      texts: detail.texts, merged: Object.prototype.hasOwnProperty.call(selected, item.key) ? selected[item.key] : detail.merged,
      conflicts: detail.conflicts, segments: detail.segments, delimiter: detail.delimiter,
      assets: detail.assets, hexes: detail.hexes, lengths: detail.lengths,
      assetSide: [0, 1, 2].includes(assetSelections[item.key]) ? assetSelections[item.key] : (item.files[2] ? 2 : item.files[1] ? 1 : 0),
      review: aiReviews[item.key] ? { model: aiReviews[item.key].model, safe: aiReviews[item.key].safe,
        warnings: aiReviews[item.key].warnings, modifiedAfterAi: !!aiReviews[item.key].modifiedAfterAi } : null,
      aiSuggestion: typeof aiReviews[item.key]?.suggestion === 'string' ? aiReviews[item.key].suggestion :
        aiReviews[item.key] && !aiReviews[item.key].modifiedAfterAi && Object.prototype.hasOwnProperty.call(selected, item.key) ? selected[item.key] : null };
    total += Buffer.byteLength(JSON.stringify(entry));
    if (total > MAX_REPORT_BYTES) throw new Error('O relatório ultrapassou 30 MB. Exporte uma subpasta menor.');
    entries.push(entry);
  }
  const report = { version: 1, title: 'FirawMerge', createdAt: new Date().toISOString(), kind: workspace.kind, slots: workspace.slots,
    roots: workspace.roots.map(root => root ? isHttpUrl(root) ? root : path.basename(root) : null), entries };
  const template = await fs.readFile(path.join(__dirname, 'viewer.html'), 'utf8');
  const runtime = await fs.readFile(path.join(__dirname, 'viewer-runtime.js'), 'utf8');
  const payload = JSON.stringify(report).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = template.replace('__FIRAWMERGE_DATA__', payload).replace('__FIRAWMERGE_SCRIPT__', runtime);
  const chosen = await dialog.showSaveDialog(window, {
    title: 'Exportar sessão interativa', defaultPath: path.join(app.getPath('documents'), 'FirawMerge-revisao.html'),
    filters: [{ name: 'Página HTML', extensions: ['html'] }]
  });
  if (chosen.canceled || !chosen.filePath) return null;
  await fs.writeFile(chosen.filePath, html, 'utf8');
  return { path: chosen.filePath, count: entries.length };
});

ipcMain.handle('ai:models', async (_event, startIfNeeded = false) => {
  if (startIfNeeded) await ensureOllama();
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Ollama não respondeu.');
  const data = await response.json();
  return (data.models || []).filter(model => model.size > 0 && !model.name.includes(':cloud')).map(model => model.name);
});

ipcMain.handle('ai:hardware', scanHardware);
ipcMain.handle('ai:recommend', (_event, settings) => recommend(settings));

async function ensureOllama() {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (response.ok) return;
  } catch { /* Inicia o servidor local abaixo. */ }
  const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  const executable = await fs.access(local).then(() => local).catch(() => 'ollama');
  const child = spawn(executable, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Aguarda o serviço iniciar. */ }
  }
  throw new Error('O Ollama não iniciou. Abra o Ollama e tente novamente.');
}

ipcMain.handle('ai:install', async (event, name) => {
  if (!MODELS.some(model => model.name === name)) throw new Error('Modelo não permitido.');
  await ensureOllama();
  const response = await fetch('http://127.0.0.1:11434/api/pull', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true })
  });
  if (!response.ok || !response.body) throw new Error(`Falha ao instalar o modelo: HTTP ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const update = JSON.parse(line);
      if (update.error) throw new Error(update.error);
      event.sender.send('ai:pull-progress', { model: name, status: update.status,
        percent: update.total ? Math.round(update.completed / update.total * 100) : null });
    }
  }
  return name;
});

async function installedLocalModel(model) {
  let installedResponse;
  try { installedResponse = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) }); }
  catch { throw new Error('Ollama local indisponível. Abra o Ollama e tente novamente.'); }
  if (!installedResponse.ok) throw new Error('Ollama local indisponível.');
  const installed = await installedResponse.json();
  const modelInfo = (installed.models || []).find(found => found.name === model && found.size > 0 && !found.name.includes(':cloud'));
  if (!modelInfo) throw new Error('Selecione um modelo instalado localmente.');
  return modelInfo;
}

function validateModelBudget(modelInfo, settings) {
  const estimatedGb = modelInfo.size / 1073741824 * 1.4 + 0.5;
  if (settings && estimatedGb + 1 > Number(settings.ramGb)) throw new Error('O modelo excede a RAM reservada. Ajuste a barra ou escolha um modelo menor.');
  if (settings?.useGpu && !settings?.useCpu && estimatedGb > Number(settings.vramGb) * 0.86)
    throw new Error('O modelo excede a VRAM reservada para uso sem fallback na CPU.');
}

async function resolveItem({ model, key, settings, format, batchFolder = null, signal = null, validatedModel = null }) {
  const currentWorkspace = workspace;
  const item = workspace?.items.find(candidate => candidate.key === key);
  if (!model || !item) throw new Error('Selecione um modelo e um arquivo.');
  if (workspace.roots[0]) throw new Error('A IA resolve apenas comparações entre duas entradas. Revise o merge de três entradas manualmente.');
  const modelInfo = validatedModel || await installedLocalModel(model);
  validateModelBudget(modelInfo, settings);
  const detail = await detailFor(item, format || workspace.format);
  if (signal?.aborted || workspace !== currentWorkspace) throw new Error('Resolução cancelada.');
  if (!['text', 'table', 'webpage'].includes(detail.format)) throw new Error('IA disponível apenas para conflitos de texto.');
  if (detail.error) throw new Error(detail.error);
  const canResolve = detail.segments.some(segment => segment.kind === 'changed');
  if (!canResolve) throw new Error('Este arquivo não tem conflitos ou diferenças para resolver com IA.');
  const [base, origin, destination] = detail.texts;
  if ([base, origin, destination].some(value => value.length > 40000)) throw new Error('Arquivo grande demais para o contexto de IA local.');
  const predictionLimit = Math.min(16384, Math.max(256, Math.ceil(Math.max(origin.length, destination.length) * 1.5)));
  const options = { temperature: 0, num_ctx: 8192, num_predict: predictionLimit };
  if (!settings?.useGpu) options.num_gpu = 0;
  else if (!settings?.useCpu) options.num_gpu = 999;
  if (settings?.useCpu && Number.isInteger(settings.threads)) options.num_thread = Math.max(1, Math.min(128, settings.threads));
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    body: JSON.stringify({ model, stream: false, think: false, options, messages: [
      { role: 'system', content: 'Você resolve diferenças entre origem e destino de um processo de CI/CD. Retorne APENAS o arquivo final, sem markdown nem explicações. Preserve conteúdo não conflitante, quebras e sintaxe. Combine as alterações de forma conservadora e não introduza ações novas.' },
      { role: 'user', content: `ORIGEM:\n<<<ORIGEM\n${origin}\nORIGEM\nDESTINO:\n<<<DESTINO\n${destination}\nDESTINO\nProduza o resultado consolidado.` }
    ] })
  });
  if (!response.ok) throw new Error(`Ollama retornou HTTP ${response.status}.`);
  const data = await response.json();
  if (signal?.aborted || workspace !== currentWorkspace) throw new Error('Resolução cancelada.');
  let suggestion = data.message?.content?.trim();
  if (!suggestion) throw new Error('A IA retornou um resultado vazio.');
  suggestion = suggestion.replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
  const assessment = assessSuggestion({ name: item.name, candidate: suggestion, base, origin, destination,
    segments: detail.segments, doneReason: data.done_reason });
  let gpuUsed = null;
  try {
    const loaded = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(3000) }).then(result => result.json());
    const loadedModel = (loaded.models || []).find(found => found.name === model);
    gpuUsed = loadedModel ? loadedModel.size_vram > 0 : null;
  } catch { /* Informação opcional. */ }
  if (settings?.useGpu && !settings?.useCpu && gpuUsed === false) {
    assessment.safe = false;
    assessment.warnings.push('O Ollama usou CPU, embora o fallback na CPU estivesse desmarcado.');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = batchFolder || path.join(app.getPath('documents'), 'FirawMerge', 'Resolvidos', `${stamp}-${crypto.randomUUID().slice(0, 8)}`);
  await fs.mkdir(folder, { recursive: true });
  const relative = workspace.kind === 'folder' ? item.key : path.basename(item.name);
  const output = path.resolve(folder, relative);
  const inside = path.relative(folder, output);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Caminho inválido para o resultado.');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, suggestion, 'utf8');
  if (!batchFolder) await fs.writeFile(path.join(folder, 'REVISAO.txt'), [
    'FirawMerge - resultado sugerido pela IA local',
    `Modelo: ${model}`,
    `Arquivo: ${item.name}`,
    `Status: ${assessment.safe ? 'sem alerta automático' : 'REVISÃO NECESSÁRIA'}`,
    ...assessment.warnings.map(warning => `ALERTA: ${warning}`),
    'Verificações automáticas não comprovam segurança nem correção. Revise antes de usar.',
    'Os arquivos originais não foram alterados.'
  ].join('\r\n'), 'utf8');
  return { suggestion, warnings: assessment.warnings, safe: assessment.safe, folder, file: output, gpuUsed, model };
}

ipcMain.handle('ai:resolve', async (_event, payload) => {
  if (activeBatch) throw new Error('Aguarde ou cancele o lote em andamento.');
  return resolveItem(payload);
});

ipcMain.handle('ai:cancel-batch', () => {
  if (!activeBatch) return false;
  activeBatch.abort();
  return true;
});

ipcMain.handle('ai:resolve-batch', async (event, { model, settings, formats = {}, excludeKeys = [] }) => {
  if (!workspace) throw new Error('Abra uma comparação primeiro.');
  if (workspace.roots[0]) throw new Error('A IA em lote usa apenas duas entradas: origem e destino.');
  if (activeBatch) throw new Error('Já há uma resolução em lote em andamento.');
  if (!model) throw new Error('Escolha um modelo local instalado.');
  const targetWorkspace = workspace;
  const excluded = new Set(Array.isArray(excludeKeys) ? excludeKeys : []);
  const candidates = targetWorkspace.items.filter(item => item.status !== 'igual' && !excluded.has(item.key));
  if (!candidates.length) throw new Error('Não há diferenças pendentes para resolver.');
  const controller = new AbortController();
  activeBatch = controller;
  let validatedModel;
  try {
    validatedModel = await installedLocalModel(model);
    validateModelBudget(validatedModel, settings);
    if (controller.signal.aborted) throw new Error('Lote cancelado.');
  } catch (error) { activeBatch = null; throw error; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = path.join(app.getPath('documents'), 'FirawMerge', 'Resolvidos', `Lote-${stamp}-${crypto.randomUUID().slice(0, 8)}`);
  const summary = { total: candidates.length, completed: 0, resolved: 0, alerts: 0, skipped: 0, canceled: false, folder, entries: [] };
  const reportPath = path.join(folder, 'REVISAO.txt');
  const writeReport = async () => {
    const lines = [
      'FirawMerge - resolução em lote com IA local',
      `Modelo: ${model}`,
      `Concluídos: ${summary.completed}/${summary.total}`,
      `Resolvidos: ${summary.resolved}; com alertas: ${summary.alerts}; ignorados/falhas: ${summary.skipped}`,
      summary.canceled ? 'Lote cancelado pelo usuário.' : '',
      'Os arquivos originais não foram alterados.',
      'Verificações automáticas não comprovam segurança nem correção. Revise cada resultado antes de usar.',
      '',
      ...summary.entries.map(entry => `${entry.status}: ${entry.key}${entry.note ? ` - ${entry.note}` : ''}`)
    ];
    await fs.writeFile(reportPath, lines.join('\r\n'), 'utf8');
  };
  try {
    await fs.mkdir(folder, { recursive: true });
    await writeReport();
    for (const item of candidates) {
      if (controller.signal.aborted || workspace !== targetWorkspace) { summary.canceled = true; break; }
      event.sender.send('ai:batch-progress', { type: 'start-item', key: item.key, ...summary });
      try {
        const result = await resolveItem({ model, key: item.key, settings, format: formats[item.key] || targetWorkspace.format,
          batchFolder: folder, signal: controller.signal, validatedModel });
        summary.resolved++;
        if (!result.safe) summary.alerts++;
        summary.entries.push({ key: item.key, status: result.safe ? 'RESOLVIDO' : 'REVISÃO NECESSÁRIA', note: result.warnings.join(' ') });
        summary.completed++;
        await writeReport();
        event.sender.send('ai:batch-progress', { type: 'result', key: item.key, result, ...summary });
      } catch (error) {
        if (controller.signal.aborted || workspace !== targetWorkspace) { summary.canceled = true; break; }
        const note = error.message || String(error);
        summary.skipped++;
        summary.entries.push({ key: item.key, status: 'IGNORADO', note });
        summary.completed++;
        await writeReport();
        event.sender.send('ai:batch-progress', { type: 'skipped', key: item.key, note, ...summary });
      }
    }
    await writeReport();
    return summary;
  } finally { activeBatch = null; }
});

ipcMain.handle('shell:show', async (_event, file) => {
  if (typeof file !== 'string') return;
  shell.showItemInFolder(file);
});
