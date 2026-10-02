const $ = id => document.getElementById(id);
const savedSettings = (() => { try { return JSON.parse(localStorage.getItem('firawmerge.aiSettings') || 'null'); } catch { return null; } })();
const state = { kind: 'folder', format: 'auto', paths: { base: '', origin: '', destination: '' }, workspace: null, detail: null, resolutions: {}, assetSelections: {}, formatOverrides: {}, choices: {}, manual: false,
  settings: savedSettings || { ramGb: 8, vramGb: 4, threads: 8, useGpu: true, useCpu: true }, hardware: null, recommendation: null, aiReviews: {}, batchRunning: false, batchFailures: {}, batchFolder: null };
let toastTimer;

function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4600);
  $('statusText').textContent = message;
}

function failure(error) {
  const message = (error?.message || String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '');
  notify(message);
}

function updateMode(resetPaths = true) {
  $('modeFolder').classList.toggle('active', state.kind === 'folder');
  $('modeFile').classList.toggle('active', state.kind === 'file');
  $('folderOptions').classList.toggle('hidden', state.kind !== 'folder');
  for (const [index, field] of ['base', 'origin', 'destination'].entries()) {
    const type = state.kind === 'folder' ? 'Pasta' : state.format === 'webpage' ? 'Página' : 'Arquivo';
    $(`${field}Label`).textContent = `${type} 0${index + 1}`;
    if (resetPaths) { state.paths[field] = ''; $(`${field}Path`).value = ''; }
    $(`${field}Path`).readOnly = state.format !== 'webpage';
    $(`${field}Path`).placeholder = state.format === 'webpage' ? 'URL https://… ou arquivo HTML' : `Selecionar ${type} 0${index + 1}…`;
  }
}

$('modeFolder').onclick = () => { if (state.format === 'webpage') $('formatSelect').value = state.format = 'auto'; state.kind = 'folder'; updateMode(); };
$('modeFile').onclick = () => { state.kind = 'file'; updateMode(); };
$('formatSelect').onchange = () => {
  const format = $('formatSelect').value;
  if (state.workspace && state.detail) {
    state.formatOverrides[state.detail.key] = format;
    delete state.resolutions[state.detail.key];
    selectFile(state.detail.key);
    return;
  }
  const previousFormat = state.format;
  const previousKind = state.kind;
  state.format = format;
  if (format === 'webpage') state.kind = 'file';
  updateMode(previousKind !== state.kind || (previousFormat === 'webpage' && format !== 'webpage'));
};
for (const field of ['base', 'origin', 'destination']) $(`${field}Path`).oninput = () => { state.paths[field] = $(`${field}Path`).value.trim(); };
for (const button of document.querySelectorAll('[data-pick]')) {
  button.onclick = async () => {
    try {
      const field = button.dataset.pick;
      const chosen = await window.firaw.choose(state.kind);
      if (chosen) { state.paths[field] = chosen; $(`${field}Path`).value = chosen; }
    } catch (error) { failure(error); }
  };
}

window.firaw.onShellPaths(items => {
  if (!Array.isArray(items) || !items.length) return;
  const kind = items[0].kind;
  if (!['folder', 'file'].includes(kind) || items.some(item => item.kind !== kind)) {
    notify('Selecione somente pastas ou somente arquivos no Explorador.'); return;
  }
  if (state.kind !== kind || items.length > 1 || !['base', 'origin', 'destination'].some(field => !state.paths[field])) {
    state.kind = kind; state.format = 'auto'; $('formatSelect').value = 'auto'; updateMode();
  }
  for (const item of items) {
    const field = ['base', 'origin', 'destination'].find(candidate => !state.paths[candidate]);
    if (!field) break;
    state.paths[field] = item.path;
    $(`${field}Path`).value = item.path;
  }
  notify(items.length > 1 ? `${items.length} itens recebidos do Explorador. Clique em Comparar ambientes.` :
    'Item recebido do Explorador. Escolha outro e clique em Comparar ambientes.');
});

function stat(value, label) { return `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`; }

function renderList() {
  const list = $('fileList');
  list.textContent = '';
  if (!state.workspace) return;
  const query = $('fileSearch').value.trim().toLocaleLowerCase('pt-BR');
  const files = state.workspace.items.filter(item =>
    (!$('hideEqualFiles').checked || item.status !== 'igual') && item.name.toLocaleLowerCase('pt-BR').includes(query));
  if (!files.length) { list.innerHTML = '<div class="empty-list">Nenhum arquivo encontrado.</div>'; return; }
  const fragment = document.createDocumentFragment();
  for (const item of files) {
    const button = document.createElement('button');
    button.className = `file-row${state.detail?.key === item.key ? ' active' : ''}`;
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = '≡';
    const info = document.createElement('span'); info.style.minWidth = '0'; info.style.flex = '1';
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = item.name; name.title = item.name;
    const status = document.createElement('span'); status.className = 'file-status';
    const review = state.aiReviews[item.key];
    status.textContent = `${item.status}${review ? review.safe ? ' · IA: revisar' : ' · IA: alerta' : state.batchFailures[item.key] ? ' · IA: ignorado' : ''}`;
    const dot = document.createElement('span'); dot.className = `status-dot${item.status === 'igual' ? ' equal' : ''}`;
    info.append(name, status); button.append(icon, info, dot); button.onclick = () => selectFile(item.key);
    fragment.append(button);
  }
  list.append(fragment);
}

function chosenLines(segment, index) {
  const choice = state.choices[index];
  if (choice === 'origin') return segment.origin;
  if (choice === 'destination') return segment.destination;
  if (!segment.base) return segment.destination;
  if (segment.kind === 'equal') return segment.base;
  if (JSON.stringify(segment.origin) === JSON.stringify(segment.base)) return segment.destination;
  if (JSON.stringify(segment.destination) === JSON.stringify(segment.base)) return segment.origin;
  return segment.destination;
}

function rebuildMerged() {
  if (!state.detail) return;
  const chunks = state.detail.segments.flatMap(chosenLines);
  const result = chunks.join('\n');
  $('resultText').value = result;
  state.resolutions[state.detail.key] = result;
  if (state.aiReviews[state.detail.key]) state.aiReviews[state.detail.key].modifiedAfterAi = true;
  state.manual = false;
  resultInfo(); updateBatchButton();
  if (state.aiReviews[state.detail.key]) renderDiff();
}

function resultInfo() {
  const text = $('resultText').value;
  $('lineCount').textContent = `${text ? text.split(/\r\n|\r|\n/).length : 0} linhas`;
  $('resultState').textContent = state.manual ? 'Resultado editado por você · revise antes de salvar' : 'Edite o texto ou escolha versões no painel à direita.';
}

function sideLabel(index) {
  const type = state.workspace?.kind === 'folder' ? 'Pasta' : state.detail?.format === 'webpage' ? 'Página' : 'Arquivo';
  return `${type} 0${(state.workspace?.slots?.[index] ?? index) + 1}`;
}

function parseRow(raw, delimiter) {
  const cells = []; let cell = ''; let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') { if (quoted && raw[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell); return cells;
}

function makeAssetPane(index) {
  const pane = document.createElement('div'); pane.className = 'pane asset-pane';
  const title = document.createElement('div'); title.className = 'pane-title'; title.textContent = sideLabel(index);
  pane.append(title); $('diffArea').append(pane); return pane;
}

function renderAssetDiff() {
  const detail = state.detail;
  const sides = state.workspace.roots[0] ? [0, 1, 2] : [1, 2];
  const panes = sides.map(makeAssetPane);
  sides.forEach((side, paneIndex) => {
    const pane = panes[paneIndex];
    if (!detail.assets[side]) { const empty = document.createElement('p'); empty.className = 'asset-note'; empty.textContent = 'Ausente nesta versão'; pane.append(empty); return; }
    if (detail.format === 'image') {
      const image = document.createElement('img'); image.className = 'compared-image'; image.src = detail.assets[side]; image.alt = sideLabel(side); pane.append(image);
    } else {
      const body = document.createElement('div'); body.className = 'hex-body';
      const rows = detail.hexes[side];
      let hidden = 0;
      rows.forEach((row, rowIndex) => {
        const equal = sides.every(other => detail.hexes[other]?.[rowIndex]?.hex.join(' ') === row.hex.join(' '));
        if ($('hideEqual').checked && equal) { hidden++; return; }
        const line = document.createElement('div'); line.className = 'hex-row';
        if (!equal) line.classList.add('changed');
        line.textContent = `${row.offset.toString(16).padStart(8, '0')}  ${row.hex.join(' ').padEnd(47, ' ')}  ${row.ascii}`; body.append(line);
      });
      if (hidden) { const note = document.createElement('div'); note.className = 'collapsed'; note.textContent = `⋯ ${hidden} blocos iguais ocultos ⋯`; body.prepend(note); }
      pane.append(body);
      if (detail.lengths[side] > 65536) { const note = document.createElement('p'); note.className = 'asset-note'; note.textContent = 'Prévia dos primeiros 64 KB. O arquivo completo pode ser salvo ou exportado.'; pane.append(note); }
    }
  });
  if (detail.format === 'image' && detail.assets[1] && detail.assets[2]) {
    const overlay = document.createElement('div'); overlay.className = 'image-overlay-controls';
    const label = document.createElement('span'); label.textContent = `Sobrepor ${sideLabel(1)} e ${sideLabel(2)}`;
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '50';
    slider.title = 'Transparência da sobreposição';
    const difference = document.createElement('label'); difference.className = 'difference-option';
    const check = document.createElement('input'); check.type = 'checkbox'; difference.append(check, ' Destacar diferenças');
    const zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = '100'; zoom.max = '300'; zoom.value = '100'; zoom.title = 'Zoom';
    const stack = document.createElement('div'); stack.className = 'image-stack';
    const lower = document.createElement('img'); lower.src = detail.assets[1]; lower.alt = sideLabel(1);
    const upper = document.createElement('img'); upper.src = detail.assets[2]; upper.alt = sideLabel(2); upper.style.opacity = '.5';
    slider.oninput = () => { upper.style.opacity = String(Number(slider.value) / 100); };
    check.onchange = () => { upper.style.mixBlendMode = check.checked ? 'difference' : 'normal'; upper.style.opacity = check.checked ? '1' : String(Number(slider.value) / 100); slider.disabled = check.checked; };
    zoom.oninput = () => { stack.style.width = `${Number(zoom.value) * 3}px`; };
    stack.append(lower, upper); overlay.append(label, slider, difference, 'Zoom', zoom, stack); $('assetResult').append(overlay);
  }
}

function renderWebDiff() {
  const detail = state.detail;
  const sides = state.workspace.roots[0] ? [0, 1, 2] : [1, 2];
  for (const side of sides) {
    const pane = makeAssetPane(side);
    const button = document.createElement('button'); button.className = 'web-source-toggle'; button.textContent = 'Ver código-fonte';
    const frame = document.createElement('iframe'); frame.className = 'web-preview'; frame.setAttribute('sandbox', '');
    frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'">' + detail.texts[side];
    const source = document.createElement('pre'); source.className = `web-source${$('hideEqual').checked ? '' : ' hidden'}`;
    const sideKey = ['base', 'origin', 'destination'][side];
    source.textContent = $('hideEqual').checked ? detail.segments.map(segment => segment.kind === 'equal' ?
      `⋯ ${segment[sideKey]?.length || 0} linhas iguais ocultas ⋯` : (segment[sideKey] || []).join('\n')).join('\n') : detail.texts[side];
    frame.classList.toggle('hidden', $('hideEqual').checked);
    button.textContent = $('hideEqual').checked ? 'Ver página' : 'Ver código-fonte';
    button.onclick = () => { const hidden = source.classList.toggle('hidden'); frame.classList.toggle('hidden', !hidden); button.textContent = hidden ? 'Ver código-fonte' : 'Ver página'; };
    pane.append(button, frame, source);
  }
  appendAiResultPane();
}

function appendAiResultPane() {
  const key = state.detail?.key;
  const review = key && state.aiReviews[key];
  if (!review || state.workspace.roots[0] || !Object.prototype.hasOwnProperty.call(state.resolutions, key)) return null;
  const pane = document.createElement('div'); pane.className = 'pane ai-result-pane';
  const title = document.createElement('div'); title.className = 'pane-title';
  const label = document.createElement('span'); label.textContent = 'Resultado da IA';
  const status = document.createElement('small'); status.textContent = review.modifiedAfterAi ? 'EDITADO · REVISAR' : review.safe ? 'REVISAR' : 'ALERTA';
  title.append(label, status);
  const note = document.createElement('p'); note.className = 'ai-pane-note';
  note.textContent = review.safe && !review.modifiedAfterAi ? 'Sugestão local. Confira antes de usar.' :
    review.modifiedAfterAi ? 'Resultado alterado após a sugestão. Confira antes de usar.' : review.warnings.join(' ');
  const preview = document.createElement('pre'); preview.className = 'ai-preview'; preview.textContent = state.resolutions[key];
  pane.append(title, note, preview); $('diffArea').append(pane);
  return pane;
}

function renderDiff() {
  const detail = state.detail;
  const area = $('diffArea'); area.textContent = '';
  if (detail.format === 'image' || detail.format === 'binary') { renderAssetDiff(); return; }
  if (detail.format === 'webpage') { renderWebDiff(); return; }
  const three = !!state.workspace.roots[0];
  const columns = three ? [
    { key: 'base', label: sideLabel(0), sub: 'BASE OPCIONAL' },
    { key: 'origin', label: sideLabel(1), sub: 'VERSÃO A' },
    { key: 'destination', label: sideLabel(2), sub: 'VERSÃO B' }
  ] : [{ key: 'origin', label: sideLabel(1), sub: 'VERSÃO A' }, { key: 'destination', label: sideLabel(2), sub: 'VERSÃO B' }];
  const panes = [];
  for (const column of columns) {
    const pane = document.createElement('div'); pane.className = 'pane';
    const title = document.createElement('div'); title.className = `pane-title ${column.key}`;
    const label = document.createElement('span'); label.textContent = column.label;
    const sub = document.createElement('small'); sub.textContent = column.sub;
    title.append(label, sub); pane.append(title);
    const body = document.createElement('div'); pane.append(body);
    panes.push({ pane, body, column }); area.append(pane);
  }
  const fragments = panes.map(() => document.createDocumentFragment());
  const counts = Object.fromEntries(columns.map(column => [column.key, 1]));
  detail.segments.forEach(segment => {
    const hidden = $('hideEqual').checked && segment.kind === 'equal' && (segment.origin?.length || 0) > 0;
    if (hidden) {
      for (let c = 0; c < columns.length; c++) {
        const column = columns[c];
        const note = document.createElement('div'); note.className = 'collapsed';
        note.textContent = `⋯ ${segment[column.key].length} ${detail.format === 'table' ? 'linhas da tabela' : 'linhas'} iguais ocultas ⋯`;
        fragments[c].append(note); counts[column.key] += segment[column.key].length;
      }
      return;
    }
    const max = Math.max(...columns.map(column => segment[column.key]?.length || 0));
    for (let r = 0; r < max; r++) for (let c = 0; c < columns.length; c++) {
      const column = columns[c];
      const line = segment[column.key]?.[r];
      const row = document.createElement('div'); row.className = `code-row ${segment.kind}${line === undefined ? ' placeholder' : ''}`;
      const number = document.createElement('span'); number.className = 'num'; number.textContent = line === undefined ? '' : counts[column.key]++;
      const content = document.createElement('span'); content.className = 'code';
      if (detail.format === 'table' && line !== undefined) {
        content.classList.add('table-cells');
        for (const value of parseRow(line, detail.delimiter)) { const cell = document.createElement('span'); cell.textContent = value || ' '; content.append(cell); }
      } else content.textContent = line === undefined ? ' ' : line || ' ';
      row.append(number, content); fragments[c].append(row);
    }
  });
  panes.forEach((entry, i) => entry.body.append(fragments[i]));
  const aiPane = appendAiResultPane();
  if (aiPane) panes.push({ pane: aiPane });
  let syncing = false;
  panes.forEach(({ pane }) => pane.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    panes.forEach(other => { if (other.pane !== pane) { other.pane.scrollTop = pane.scrollTop; other.pane.scrollLeft = pane.scrollLeft; } });
    requestAnimationFrame(() => { syncing = false; });
  }));
}

function renderHunks() {
  const list = $('hunkList'); list.textContent = '';
  if (['binary', 'image'].includes(state.detail.format)) {
    $('hunkCount').textContent = state.detail.status === 'igual' ? '0' : '1';
    const message = document.createElement('p'); message.className = 'muted';
    message.textContent = state.detail.format === 'binary' ? 'Compare os bytes em hexadecimal e escolha uma versão completa abaixo.' : 'Compare as imagens e escolha uma versão completa abaixo.';
    list.append(message); return;
  }
  const segments = state.detail.segments;
  const indexes = segments.map((segment, index) => segment.kind !== 'equal' ? index : -1).filter(index => index >= 0);
  $('hunkCount').textContent = indexes.length;
  if (!indexes.length) { list.innerHTML = '<p class="muted">As versões deste arquivo são iguais.</p>'; return; }
  indexes.forEach((index, position) => {
    const segment = segments[index];
    const card = document.createElement('div'); card.className = `hunk-card ${segment.kind}`;
    const top = document.createElement('div');
    const name = document.createElement('span'); name.textContent = `Mudança ${String(position + 1).padStart(2, '0')}`;
    const type = document.createElement('span'); type.className = 'hunk-label'; type.textContent = segment.kind === 'conflict' ? 'CONFLITO' : 'ALTERADO';
    top.append(name, type);
    const preview = document.createElement('p'); preview.textContent = (segment.origin.find(Boolean) || segment.destination.find(Boolean) || 'Linha vazia').slice(0, 80);
    const actions = document.createElement('div'); actions.className = 'hunk-actions';
    for (const side of ['origin', 'destination']) {
      const button = document.createElement('button'); button.textContent = side === 'origin' ? `Usar ${sideLabel(1)}` : `Usar ${sideLabel(2)}`;
      button.onclick = () => {
        if (state.manual && !confirm('Essa escolha vai reconstruir o resultado e substituir suas edições manuais. Continuar?')) return;
        state.choices[index] = side; rebuildMerged(); notify(`${side === 'origin' ? sideLabel(1) : sideLabel(2)} aplicado à mudança ${position + 1}.`);
      };
      actions.append(button);
    }
    card.append(top, preview, actions); list.append(card);
  });
}

async function selectFile(key) {
  try {
    $('activeFile').textContent = 'Carregando…';
    const selectedFormat = state.formatOverrides[key] || state.workspace.format;
    $('formatSelect').value = selectedFormat;
    const detail = await window.firaw.detail(key, selectedFormat);
    state.detail = detail;
    renderAiReview(key);
    state.choices = {};
    state.manual = Object.prototype.hasOwnProperty.call(state.resolutions, key);
    $('activeFile').textContent = detail.name;
    $('saveBtn').disabled = !!detail.error;
    $('aiBtn').disabled = state.batchRunning || !!state.workspace.roots[0] || !!detail.error || !['text', 'table', 'webpage'].includes(detail.format) || !detail.segments?.some(segment => segment.kind === 'changed');
    $('assetResult').textContent = '';
    $('assetResult').classList.toggle('hidden', !['image', 'binary'].includes(detail.format));
    $('resultText').classList.toggle('hidden', ['image', 'binary'].includes(detail.format));
    if (detail.error) {
      $('diffArea').innerHTML = '<div class="empty-list"></div>';
      $('diffArea').firstChild.textContent = detail.error;
      $('resultText').value = '';
      $('resultText').disabled = true;
      $('hunkList').textContent = detail.error;
      $('hunkCount').textContent = '0';
      $('resultState').textContent = detail.error;
    } else {
      if (['image', 'binary'].includes(detail.format)) {
        $('resultText').disabled = true;
        const available = [2, 1, 0].find(side => !!detail.assets[side]);
        const selected = state.assetSelections[key] ?? available;
        state.assetSelections[key] = selected;
        const controls = document.createElement('div'); controls.className = 'asset-choices';
        for (const side of (state.workspace.roots[0] ? [0, 1, 2] : [1, 2])) {
          if (!detail.assets[side]) continue;
          const button = document.createElement('button'); button.textContent = `Usar ${sideLabel(side)}`;
          button.className = selected === side ? 'active' : '';
          button.onclick = () => { state.assetSelections[key] = side; selectFile(key); };
          controls.append(button);
        }
        $('assetResult').append(controls);
        $('lineCount').textContent = `${detail.lengths[selected]} bytes`;
        $('resultState').textContent = `Versão escolhida: ${sideLabel(selected)}. Salvar resultado cria uma cópia.`;
        renderDiff(); renderHunks();
      } else {
        $('resultText').disabled = false;
        $('resultText').value = state.manual ? state.resolutions[key] : detail.merged;
        renderDiff(); renderHunks(); resultInfo();
      }
    }
    renderList();
    notify(`Arquivo aberto: ${detail.name}`);
  } catch (error) { failure(error); }
}

async function compare() {
  if (state.batchRunning) { notify('Cancele ou aguarde o lote antes de abrir outra comparação.'); return null; }
  if (Object.values(state.paths).filter(Boolean).length < 2) {
    notify('Selecione pelo menos duas pastas ou arquivos.');
    return;
  }
  try {
    $('compareBtn').disabled = true;
    notify('Comparando arquivos…');
    const result = await window.firaw.open({ kind: state.kind, format: state.format,
      mask: $('fileMask').value.trim() || '*', includeSubfolders: $('includeSubfolders').checked, ...state.paths });
    state.workspace = result; state.detail = null; state.resolutions = {}; state.assetSelections = {}; state.formatOverrides = {}; state.choices = {}; state.aiReviews = {}; state.batchFailures = {}; state.batchFolder = null;
    $('batchPanel').classList.add('hidden'); $('openBatchFolder').classList.add('hidden');
    $('topMode').textContent = result.roots[0] ? 'Comparação de 3 ambientes' : 'Comparação de 2 ambientes';
    $('workspaceTitle').textContent = result.roots[0] ? 'Revisão de três ambientes' : `Revisão entre dois ${result.kind === 'folder' ? 'diretórios' : 'arquivos'}`;
    $('workspaceSubtitle').textContent = `${result.items.length} arquivo(s) mapeado(s) · escolha um arquivo para revisar`;
    $('fileCount').textContent = result.items.length;
    const different = result.items.filter(item => item.status !== 'igual').length;
    $('stats').innerHTML = stat(result.items.length, 'ARQUIVOS') + stat(different, 'MUDANÇAS');
    $('exportTop').disabled = $('exportSide').disabled = false;
    $('saveSession').disabled = false;
    $('saveBtn').disabled = $('aiBtn').disabled = true;
    updateBatchButton();
    renderList();
    if (result.items.length) await selectFile(result.items.find(item => item.status !== 'igual')?.key || result.items[0].key);
    else notify('Nenhum arquivo encontrado nos caminhos selecionados.');
    return result;
  } catch (error) { failure(error); }
  finally { $('compareBtn').disabled = false; }
  return null;
}

function updateBatchButton() {
  const pending = state.workspace?.items.filter(item => item.status !== 'igual' &&
    !Object.prototype.hasOwnProperty.call(state.resolutions, item.key)).length || 0;
  $('aiBatchBtn').disabled = state.batchRunning || !!state.workspace?.roots[0] || pending === 0;
  $('aiBatchBtn').textContent = `✦  Resolver todas as diferenças (${pending})`;
}

async function saveSession() {
  if (!state.workspace) return;
  try {
    const savedPaths = { base: '', origin: '', destination: '' };
    for (const [side, root] of state.workspace.roots.entries()) {
      const slot = state.workspace.slots[side];
      if (root && slot !== null && slot !== undefined) savedPaths[['base', 'origin', 'destination'][slot]] = root;
    }
    const session = {
      app: 'FirawMerge', version: 1,
      comparison: { kind: state.workspace.kind, format: state.workspace.format, paths: savedPaths,
        mask: state.workspace.mask, includeSubfolders: state.workspace.includeSubfolders },
      review: { resolutions: state.resolutions, assetSelections: state.assetSelections,
        formatOverrides: state.formatOverrides, aiReviews: state.aiReviews, batchFailures: state.batchFailures, batchFolder: state.batchFolder,
        selectedKey: state.detail?.key || null, hideEqual: $('hideEqual').checked, search: $('fileSearch').value }
    };
    const file = await window.firaw.saveSession(session);
    if (file) notify(`Trabalho salvo: ${file}`);
  } catch (error) { failure(error); }
}

async function loadSession() {
  if (state.batchRunning) { notify('Cancele ou aguarde o lote antes de abrir outro trabalho.'); return; }
  try {
    const loaded = await window.firaw.loadSession();
    if (!loaded) return;
    const { comparison, review } = loaded.session;
    state.kind = comparison.kind; state.format = comparison.format;
    $('formatSelect').value = comparison.format;
    updateMode();
    state.paths = { base: comparison.paths.base || '', origin: comparison.paths.origin || '', destination: comparison.paths.destination || '' };
    for (const field of ['base', 'origin', 'destination']) $(`${field}Path`).value = state.paths[field];
    $('fileMask').value = comparison.mask || '*';
    $('includeSubfolders').checked = comparison.includeSubfolders !== false;
    const opened = await compare();
    if (!opened) return;
    const keys = new Set(opened.items.map(item => item.key));
    const pick = (values, valid) => Object.fromEntries(Object.entries(values && typeof values === 'object' && !Array.isArray(values) ? values : {})
      .filter(([key, value]) => keys.has(key) && valid(value)));
    state.resolutions = pick(review.resolutions, value => typeof value === 'string');
    state.assetSelections = pick(review.assetSelections, value => [0, 1, 2].includes(value));
    state.formatOverrides = pick(review.formatOverrides, value => ['text', 'table', 'binary', 'image', 'webpage'].includes(value));
    state.aiReviews = pick(review.aiReviews, value => value && typeof value === 'object' && typeof value.model === 'string' && Array.isArray(value.warnings));
    state.batchFailures = pick(review.batchFailures, value => typeof value === 'string');
    state.batchFolder = typeof review.batchFolder === 'string' ? review.batchFolder : null;
    $('batchPanel').classList.toggle('hidden', !state.batchFolder);
    $('openBatchFolder').classList.toggle('hidden', !state.batchFolder);
    $('aiBatchCancel').disabled = true;
    if (state.batchFolder) $('batchStatus').textContent = 'Trabalho reaberto. Revise os resultados do lote salvo.';
    $('hideEqual').checked = !!review.hideEqual;
    $('fileSearch').value = typeof review.search === 'string' ? review.search : '';
    if (typeof review.selectedKey === 'string' && keys.has(review.selectedKey)) await selectFile(review.selectedKey);
    else if (opened.items.length) await selectFile(opened.items[0].key);
    renderList(); updateBatchButton();
    notify(`Trabalho reaberto: ${loaded.path}`);
  } catch (error) { failure(error); }
}

async function exportReview() {
  try {
    notify('Gerando revisão interativa…');
    const result = await window.firaw.export({ results: state.resolutions, assetSelections: state.assetSelections,
      formats: state.formatOverrides, aiReviews: state.aiReviews });
    if (result) { notify(`Revisão com ${result.count} arquivo(s) exportada.`); window.firaw.show(result.path); }
  } catch (error) { failure(error); }
}

async function saveResult() {
  if (!state.detail || state.detail.error) return;
  try {
    const file = ['image', 'binary'].includes(state.detail.format) ? await window.firaw.saveAsset({ key: state.detail.key, side: state.assetSelections[state.detail.key] }) :
      await window.firaw.save({ key: state.detail.key, text: $('resultText').value });
    if (file) { notify('Resultado salvo.'); window.firaw.show(file); }
  } catch (error) { failure(error); }
}

async function refreshModels(startIfNeeded = false) {
  try {
    const models = await window.firaw.models(startIfNeeded === true);
    $('modelSelect').textContent = '';
    if (!models.length) {
      const option = document.createElement('option'); option.textContent = 'Nenhum modelo instalado'; option.value = ''; $('modelSelect').append(option);
      $('aiInfo').textContent = 'Instale um modelo no Ollama para usar IA.';
      return;
    }
    for (const model of models) {
      const option = document.createElement('option'); option.value = model; option.textContent = model; $('modelSelect').append(option);
    }
    $('aiInfo').textContent = `${models.length} modelo(s) locais disponível(is).`;
  } catch {
    $('modelSelect').innerHTML = '<option value="">Ollama indisponível</option>';
    $('aiInfo').textContent = 'Abra o Ollama e atualize os modelos.';
  }
}

async function aiResolve() {
  const detail = state.detail;
  const model = $('modelSelect').value;
  if (!model) { notify('Abra o Ollama e escolha um modelo instalado.'); return; }
  try {
    $('aiBtn').disabled = true;
    $('aiBtn').textContent = '✦  Analisando localmente…';
    notify('A IA local está propondo uma resolução…');
    const result = await window.firaw.resolve({ model, key: detail.key, format: detail.format, settings: state.settings });
    if (state.detail?.key !== detail.key) return;
    $('resultText').value = result.suggestion;
    state.resolutions[detail.key] = result.suggestion;
    state.aiReviews[detail.key] = { model: result.model, safe: result.safe, warnings: result.warnings, file: result.file, suggestion: result.suggestion, modifiedAfterAi: false };
    state.manual = true; resultInfo();
    renderAiReview(detail.key);
    renderDiff();
    renderList(); updateBatchButton();
    const info = $('aiResultInfo');
    if (state.settings.useGpu && result.gpuUsed === false) {
      const gpu = document.createElement('div'); gpu.textContent = 'O Ollama usou CPU nesta execução; verifique o suporte da GPU.'; info.append(gpu);
    }
    notify(result.safe ? 'Sugestão salva em pasta nova. Revise antes de usar.' : 'A IA gerou alertas. Revise a pasta nova antes de usar.');
  } catch (error) { failure(error); }
  finally { $('aiBtn').disabled = state.batchRunning || !state.detail || !!state.workspace.roots[0] || !!state.detail.error || !['text', 'table', 'webpage'].includes(state.detail.format) || !state.detail.segments?.some(segment => segment.kind === 'changed'); $('aiBtn').textContent = '✦   Resolver conflito'; }
}

async function aiResolveBatch() {
  if (!state.workspace || state.batchRunning) return;
  const model = $('modelSelect').value;
  if (!model) { notify('Abra o Ollama e escolha um modelo instalado.'); return; }
  state.batchRunning = true;
  $('aiBatchBtn').disabled = $('aiBtn').disabled = $('compareBtn').disabled = $('openSession').disabled = true;
  $('batchPanel').classList.remove('hidden');
  $('batchProgress').value = 0;
  $('batchStatus').textContent = 'Preparando resolução em lote…';
  $('aiBatchCancel').disabled = false;
  try {
    const summary = await window.firaw.resolveBatch({ model, settings: state.settings, formats: state.formatOverrides,
      excludeKeys: Object.keys(state.resolutions) });
    $('batchStatus').textContent = `${summary.canceled ? 'Lote cancelado' : 'Lote concluído'}: ${summary.resolved} resolvido(s), ${summary.alerts} com alerta(s), ${summary.skipped} ignorado(s).`;
    notify(`${$('batchStatus').textContent} Resultados em ${summary.folder}`);
    state.batchFolder = summary.folder;
    $('openBatchFolder').classList.remove('hidden');
    $('aiBatchCancel').disabled = true;
  } catch (error) { failure(error); $('batchStatus').textContent = 'Não foi possível iniciar ou concluir o lote.'; }
  finally {
    state.batchRunning = false;
    $('compareBtn').disabled = $('openSession').disabled = false;
    if (state.detail) await selectFile(state.detail.key);
    updateBatchButton();
  }
}

window.firaw.onBatchProgress(update => {
  $('batchProgress').value = update.total ? Math.round(update.completed / update.total * 100) : 0;
  $('batchStatus').textContent = `${update.completed}/${update.total} concluídos · ${update.resolved} resolvidos · ${update.skipped} ignorados${update.type === 'start-item' ? ` · ${update.key}` : ''}`;
  if (update.type === 'result') {
    state.resolutions[update.key] = update.result.suggestion;
    state.aiReviews[update.key] = { model: update.result.model, safe: update.result.safe,
      warnings: update.result.warnings, file: update.result.file, suggestion: update.result.suggestion, modifiedAfterAi: false };
    delete state.batchFailures[update.key];
    if (state.detail?.key === update.key) {
      $('resultText').value = update.result.suggestion;
      state.manual = true; resultInfo(); renderAiReview(update.key); renderDiff();
    }
  } else if (update.type === 'skipped') state.batchFailures[update.key] = update.note;
  renderList(); updateBatchButton();
});

function renderAiReview(key) {
  const info = $('aiResultInfo'); info.textContent = '';
  const review = state.aiReviews[key];
  info.classList.toggle('warning', !!review && (!review.safe || review.modifiedAfterAi));
  if (!review) return;
  const message = document.createElement('div');
  message.textContent = review.modifiedAfterAi ? 'Resultado alterado após a verificação da IA. Revise novamente antes de usar.' :
    review.safe ? 'Sugestão salva em pasta nova. Revise antes de usar.' : `Atenção: ${review.warnings.join(' ')} Resultado isolado em pasta nova.`;
  const open = document.createElement('button'); open.className = 'text-button'; open.textContent = 'Abrir pasta do resultado ↗';
  open.onclick = () => window.firaw.show(review.file);
  info.append(message, open);
}

function readSettings() {
  state.settings = {
    ramGb: Number($('ramRange').value), vramGb: Number($('gpuRange').value), threads: Number($('cpuRange').value),
    useGpu: $('useGpu').checked, useCpu: $('useCpu').checked
  };
  $('ramValue').textContent = `${state.settings.ramGb} GB`;
  $('gpuValue').textContent = `${state.settings.vramGb} GB VRAM`;
  $('cpuValue').textContent = `${state.settings.threads} threads`;
  $('gpuRange').disabled = !state.settings.useGpu;
  $('cpuRange').disabled = !state.settings.useCpu;
  localStorage.setItem('firawmerge.aiSettings', JSON.stringify(state.settings));
  recommendModel();
}

async function recommendModel() {
  try {
    const recommendation = await window.firaw.recommend(state.settings);
    state.recommendation = recommendation;
    $('recommendedModel').textContent = recommendation.name;
    $('recommendReason').textContent = `${recommendation.downloadGb} GB para baixar · execução por ${recommendation.mode}. ${recommendation.note}`;
    $('installModel').disabled = false;
  } catch (error) {
    state.recommendation = null;
    $('recommendedModel').textContent = 'Ajuste os recursos';
    $('recommendReason').textContent = error.message || String(error);
    $('installModel').disabled = true;
  }
}

function renderSettings() {
  for (const [control, value] of [['ramRange', state.settings.ramGb], ['gpuRange', state.settings.vramGb], ['cpuRange', state.settings.threads]]) $(control).value = value;
  $('useGpu').checked = state.settings.useGpu;
  $('useCpu').checked = state.settings.useCpu;
  readSettings();
}

async function scanHardware() {
  try {
    $('scanHardware').disabled = true;
    $('hardwareInfo').textContent = 'Lendo CPU, RAM e memória dedicada da GPU…';
    const hardware = await window.firaw.hardware();
    state.hardware = hardware;
    $('hardwareInfo').textContent = '';
    for (const item of [`CPU: ${hardware.cpu}`, `Threads: ${hardware.threads}`, `RAM: ${hardware.ramGb} GB`,
      `GPU: ${hardware.gpu} · VRAM: ${hardware.vramReliable ? `${hardware.vramGb} GB` : 'não detectada'}`]) {
      const row = document.createElement('span'); row.textContent = item; $('hardwareInfo').append(row);
    }
    $('ramRange').max = Math.max(2, hardware.ramGb - 2);
    $('cpuRange').max = Math.max(1, hardware.threads);
    $('gpuRange').max = hardware.vramReliable ? Math.max(0, hardware.vramGb) : 24;
    if (!savedSettings && !localStorage.getItem('firawmerge.hardwareConfigured')) {
      $('ramRange').value = Math.min(Math.max(4, Math.floor(hardware.ramGb * 0.45)), Number($('ramRange').max));
      $('gpuRange').value = hardware.vramGb ? Math.max(0, hardware.vramGb - 2) : 0;
      $('cpuRange').value = Math.max(1, Math.ceil(hardware.threads / 2));
      $('useGpu').checked = hardware.vramGb >= 2;
      localStorage.setItem('firawmerge.hardwareConfigured', '1');
    }
    readSettings();
    notify('Hardware verificado. Ajuste as barras se desejar.');
  } catch (error) { failure(error); $('hardwareInfo').textContent = 'Não foi possível ler o hardware. Configure as barras manualmente.'; }
  finally { $('scanHardware').disabled = false; }
}

async function installRecommended() {
  if (!state.recommendation) return;
  try {
    $('installModel').disabled = true;
    $('installStatus').textContent = `Baixando ${state.recommendation.name} pelo Ollama…`;
    $('installProgress').value = 0;
    const name = await window.firaw.install(state.recommendation.name);
    $('installStatus').textContent = `${name} instalado e pronto para uso.`;
    $('installProgress').value = 100;
    await refreshModels();
    $('modelSelect').value = name;
    notify('Modelo local instalado.');
  } catch (error) { failure(error); $('installStatus').textContent = error.message || String(error); }
  finally { $('installModel').disabled = false; }
}

window.firaw.onPullProgress(update => {
  $('installStatus').textContent = `${update.model}: ${update.status}${update.percent === null ? '' : ` · ${update.percent}%`}`;
  if (update.percent !== null) $('installProgress').value = update.percent;
});

$('compareBtn').onclick = compare;
$('fileSearch').oninput = renderList;
$('hideEqualFiles').onchange = renderList;
$('hideEqual').onchange = () => { if (state.detail && !state.detail.error) renderDiff(); };
$('resultText').oninput = () => {
  if (!state.detail) return;
  state.resolutions[state.detail.key] = $('resultText').value;
  if (state.aiReviews[state.detail.key]) { state.aiReviews[state.detail.key].modifiedAfterAi = true; renderAiReview(state.detail.key); }
  const pane = $('diffArea').querySelector('.ai-result-pane');
  if (pane) {
    pane.querySelector('.ai-preview').textContent = $('resultText').value;
    pane.querySelector('small').textContent = 'EDITADO · REVISAR';
  }
  state.manual = true; resultInfo(); updateBatchButton();
};
$('saveBtn').onclick = saveResult;
$('saveSession').onclick = saveSession;
$('openSession').onclick = loadSession;
$('exportTop').onclick = exportReview;
$('exportSide').onclick = exportReview;
$('refreshModels').onclick = () => refreshModels(true);
$('aiBtn').onclick = aiResolve;
$('aiBatchBtn').onclick = aiResolveBatch;
$('aiBatchCancel').onclick = async () => { $('aiBatchCancel').disabled = true; $('batchStatus').textContent = 'Cancelando após o arquivo atual…'; await window.firaw.cancelBatch(); };
$('openBatchFolder').onclick = () => { if (state.batchFolder) window.firaw.show(state.batchFolder); };
$('aiSettings').onclick = () => { $('aiModal').classList.remove('hidden'); renderSettings(); if (!state.hardware) scanHardware(); };
$('configClose').onclick = () => $('aiModal').classList.add('hidden');
$('aiModal').onclick = event => { if (event.target === $('aiModal')) $('aiModal').classList.add('hidden'); };
$('scanHardware').onclick = scanHardware;
for (const id of ['ramRange', 'gpuRange', 'cpuRange', 'useGpu', 'useCpu']) $(id).oninput = readSettings;
$('installModel').onclick = installRecommended;
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); event.shiftKey ? saveResult() : saveSession(); }
});
updateMode();
refreshModels();
