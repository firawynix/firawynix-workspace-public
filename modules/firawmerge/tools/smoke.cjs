const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

let target;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
const networkFetch = global.fetch;
global.fetch = async (url, options) => {
  const address = String(url);
  if (address === 'http://127.0.0.1:11434/api/tags') return new Response(JSON.stringify({ models: [
    { name: 'firaw-test:1b', size: 500000000 }, { name: 'qwen3:8b', size: 500000000 }
  ] }), { status: 200 });
  if (address === 'http://127.0.0.1:11434/api/chat') {
    const prompt = JSON.parse(options.body).messages[1].content;
    const answer = prompt.includes('one\nTWO-A') ? 'one\nAI-RESOLVED\nthree' : 'id,name\n1,AI-RESOLVED';
    return new Response(JSON.stringify({ message: { content: answer }, done_reason: 'stop' }), { status: 200 });
  }
  if (address === 'http://127.0.0.1:11434/api/ps') return new Response(JSON.stringify({ models: [] }), { status: 200 });
  return networkFetch(url, options);
};
require('../src/main.cjs');

app.whenReady().then(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'firawmerge-smoke-'));
  app.setPath('documents', temporary);
  try {
    const roots = ['base', 'origin', 'destination'].map(name => path.join(temporary, name));
    await Promise.all(roots.map(root => fs.mkdir(root)));
    const versions = ['one\ntwo\nthree', 'one\nTWO-A\nthree', 'one\nTWO-B\nthree'];
    await Promise.all(roots.map((root, i) => fs.writeFile(path.join(root, 'sample.txt'), versions[i])));
    const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6kqYAAAAASUVORK5CYII=', 'base64');
    await Promise.all(roots.flatMap((root, i) => [
      fs.writeFile(path.join(root, 'table.csv'), `id,name\n1,${['Base', 'Origin', 'Destination'][i]}`),
      fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0x41, i, 0xff])),
      fs.writeFile(path.join(root, 'image.png'), samplePng),
      fs.writeFile(path.join(root, 'image.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${['blue', 'green', 'cyan'][i]}"/></svg>`),
      fs.writeFile(path.join(root, 'page.html'), `<h1>${['Base', 'Origin', 'Destination'][i]}</h1>`),
      fs.writeFile(path.join(root, 'equal.txt'), 'sem alteração')
    ]));
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    const firstTwo = await win.webContents.executeJavaScript(`window.firaw.open(${JSON.stringify({
      kind: 'folder', base: roots[0], origin: roots[1], destination: ''
    })})`);
    assert.deepEqual(firstTwo.slots, [null, 0, 1]);
    assert.deepEqual(firstTwo.roots, [null, roots[0], roots[1]]);
    const firstAndThird = await win.webContents.executeJavaScript(`window.firaw.open(${JSON.stringify({
      kind: 'folder', base: roots[0], origin: '', destination: roots[2]
    })})`);
    assert.deepEqual(firstAndThird.slots, [null, 0, 2]);
    const secondAndThird = await win.webContents.executeJavaScript(`window.firaw.open(${JSON.stringify({
      kind: 'folder', base: '', origin: roots[1], destination: roots[2]
    })})`);
    assert.deepEqual(secondAndThird.slots, [null, 1, 2]);
    const open = await win.webContents.executeJavaScript(`window.firaw.open(${JSON.stringify({ kind: 'folder', base: roots[0], origin: roots[1], destination: roots[2] })})`);
    assert.equal(open.items.length, 7);
    assert.equal(open.items.find(item => item.name === 'sample.txt').status, 'diferente');
    const detail = await win.webContents.executeJavaScript(`window.firaw.detail('sample.txt')`);
    assert.equal(detail.conflicts, 1);
    assert.equal(detail.merged, versions[2]);
    const table = await win.webContents.executeJavaScript("window.firaw.detail('table.csv')");
    assert.equal(table.format, 'table');
    assert.equal(table.conflicts, 1);
    const binary = await win.webContents.executeJavaScript("window.firaw.detail('binary.bin')");
    assert.equal(binary.format, 'binary');
    assert.deepEqual(binary.hexes[1][0].hex, ['41', '01', 'FF']);
    const image = await win.webContents.executeJavaScript("window.firaw.detail('image.png')");
    assert.equal(image.format, 'image');
    assert.ok(image.assets[1].startsWith('data:image/png;base64,'));
    const webpage = await win.webContents.executeJavaScript("window.firaw.detail('page.html')");
    assert.equal(webpage.format, 'webpage');
    assert.equal(webpage.conflicts, 1);
    const ui = await win.webContents.executeJavaScript(`(async () => {
      state.paths = ${JSON.stringify({ base: roots[0], origin: roots[1], destination: roots[2] })};
      await compare();
      const beforeHide = document.querySelectorAll('#fileList .file-row').length;
      document.getElementById('hideEqualFiles').click();
      const afterHide = document.querySelectorAll('#fileList .file-row').length;
      document.getElementById('hideEqualFiles').click();
      const labels = ['baseLabel', 'originLabel', 'destinationLabel'].map(id => document.getElementById(id).textContent);
      await selectFile('table.csv');
      const tableCells = document.querySelectorAll('.table-cells > span').length;
      state.formatOverrides['table.csv'] = 'text';
      await selectFile('table.csv');
      const recompare = state.detail.format;
      delete state.formatOverrides['table.csv'];
      await selectFile('binary.bin');
      const hexRows = document.querySelectorAll('.hex-row').length;
      await selectFile('image.svg');
      const images = document.querySelectorAll('.compared-image').length;
      await selectFile('page.html');
      const frames = document.querySelectorAll('iframe.web-preview[sandbox]').length;
      await selectFile('table.csv');
      for (const side of ['base', 'origin', 'destination']) document.getElementById(side + 'Path').value = state.paths[side];
      return { labels, tableCells, recompare, hexRows, images, frames, beforeHide, afterHide };
    })()`);
    assert.deepEqual(ui.labels, ['Pasta 01', 'Pasta 02', 'Pasta 03']);
    assert.equal(ui.recompare, 'text');
    assert.equal(ui.beforeHide - ui.afterHide, open.items.filter(item => item.status === 'igual').length);
    assert.ok(ui.tableCells > 0 && ui.hexRows > 0 && ui.images === 3 && ui.frames === 3);
    try {
      await new Promise(resolve => setTimeout(resolve, 350));
      await fs.writeFile(path.join(__dirname, '..', 'assets', 'screenshot.png'), (await win.webContents.capturePage()).toPNG());
    }
    catch { /* A captura é ilustrativa e não faz parte da verificação funcional. */ }
    target = path.join(temporary, 'copied.svg');
    await win.webContents.executeJavaScript("window.firaw.saveAsset({key:'image.svg',side:1})");
    assert.equal(await fs.readFile(target, 'utf8'), await fs.readFile(path.join(roots[1], 'image.svg'), 'utf8'));
    target = path.join(temporary, 'review.html');
    const exported = await win.webContents.executeJavaScript(`window.firaw.export(${JSON.stringify({
      results: { 'sample.txt': 'one\nRESOLVED\nthree' },
      aiReviews: { 'sample.txt': { model: 'test-model', safe: false, warnings: ['Resultado requer revisão.'], suggestion: 'one\nAI-SUGGESTION\nthree', modifiedAfterAi: true } }
    })})`);
    assert.equal(exported.count, 5);
    const html = await fs.readFile(target, 'utf8');
    assert.ok(html.includes('RESOLVED'));
    assert.ok(html.includes('AI-SUGGESTION'));
    assert.ok(html.includes('application/json'));
    assert.ok(html.includes('Resultado requer revisão.'));
    assert.ok(html.includes('data:image/svg+xml;base64,'));
    assert.ok(!html.includes('__FIRAWMERGE_SCRIPT__'));
    const reviewWindow = new BrowserWindow({ show: false, width: 1100, height: 750 });
    await reviewWindow.loadFile(target);
    const originalAi = await reviewWindow.webContents.executeJavaScript("[...document.querySelectorAll('#files .file')].find(button => button.querySelector('strong').textContent === 'sample.txt').click(); [...document.querySelectorAll('#viewButtons button')].find(button => button.textContent === 'Sugestão da IA').click(); document.getElementById('content').value");
    assert.ok(originalAi.includes('AI-SUGGESTION'));
    const offline = await reviewWindow.webContents.executeJavaScript(`(() => {
      const results = {};
      for (const name of ['table.csv', 'binary.bin', 'image.svg', 'page.html']) {
        [...document.querySelectorAll('#files .file')].find(button => button.querySelector('strong').textContent === name).click();
        results[name] = { title: document.getElementById('title').textContent,
          cells: document.querySelectorAll('.cells > span').length,
          rows: document.querySelectorAll('.row').length,
          images: document.querySelectorAll('.asset-image').length,
          frames: document.querySelectorAll('.web-frame[sandbox]').length };
      }
      return results;
    })()`);
    assert.ok(offline['table.csv'].cells > 0);
    assert.ok(offline['binary.bin'].rows > 0);
    assert.ok(offline['image.svg'].images > 0);
    assert.ok(offline['page.html'].frames > 0);
    reviewWindow.close();
    const aiModes = await win.webContents.executeJavaScript(`(async () => {
      const threeDisabled = document.getElementById('aiBtn').disabled && document.getElementById('aiBatchBtn').disabled;
      state.paths = ${JSON.stringify({ base: '', origin: roots[1], destination: roots[2] })};
      for (const field of ['base', 'origin', 'destination']) document.getElementById(field + 'Path').value = state.paths[field];
      await compare();
      await selectFile('table.csv');
      return { threeDisabled, twoEnabled: !document.getElementById('aiBtn').disabled && !document.getElementById('aiBatchBtn').disabled };
    })()`);
    assert.equal(aiModes.threeDisabled, true);
    assert.equal(aiModes.twoEnabled, true);
    const batchUi = await win.webContents.executeJavaScript(`(async () => {
      await refreshModels();
      document.getElementById('modelSelect').value = 'firaw-test:1b';
      await aiResolveBatch();
      return { folder: state.batchFolder, resolved: Object.keys(state.aiReviews),
        ignored: Object.keys(state.batchFailures), status: document.getElementById('batchStatus').textContent,
        aiPane: document.querySelector('.ai-result-pane .ai-preview')?.textContent };
    })()`);
    assert.ok(batchUi.folder.startsWith(temporary));
    assert.ok(batchUi.resolved.includes('sample.txt'));
    assert.ok(batchUi.ignored.includes('binary.bin'));
    assert.ok(batchUi.aiPane.includes('AI-RESOLVED'));
    assert.ok((await fs.readFile(path.join(batchUi.folder, 'REVISAO.txt'), 'utf8')).includes('Os arquivos originais não foram alterados'));
    assert.ok((await fs.readFile(path.join(batchUi.folder, 'sample.txt'), 'utf8')).includes('AI-RESOLVED'));
    target = path.join(temporary, 'trabalho.firawmerge');
    await win.webContents.executeJavaScript('saveSession()');
    const saved = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.equal(saved.app, 'FirawMerge');
    assert.equal(saved.review.aiReviews['sample.txt'].model, 'firaw-test:1b');
    const restored = await win.webContents.executeJavaScript(`(async () => {
      state.resolutions = {}; state.aiReviews = {}; state.batchFailures = {};
      await loadSession();
      return { resolved: state.resolutions['sample.txt'], review: state.aiReviews['sample.txt']?.model,
        folder: state.batchFolder, selected: state.detail?.key };
    })()`);
    assert.ok(restored.resolved.includes('AI-RESOLVED'));
    assert.equal(restored.review, 'firaw-test:1b');
    assert.equal(restored.folder, batchUi.folder);
    assert.equal(restored.selected, 'table.csv');
    if (process.env.FIRAWMERGE_AI_SMOKE === '1') {
      const models = await win.webContents.executeJavaScript('window.firaw.models()');
      assert.ok(models.includes('qwen3:8b'));
      const result = await win.webContents.executeJavaScript(`window.firaw.resolve(${JSON.stringify({
        model: 'qwen3:8b', key: 'sample.txt', settings: { ramGb: 32, vramGb: 14, threads: 8, useGpu: true, useCpu: true }
      })})`);
      assert.ok(result.suggestion.length > 0);
      assert.equal(await fs.readFile(result.file, 'utf8'), result.suggestion);
      assert.ok((await fs.readFile(path.join(result.folder, 'REVISAO.txt'), 'utf8')).includes('Os arquivos originais não foram alterados'));
      console.log(`IA local: pasta isolada criada, GPU usada=${result.gpuUsed}, alertas=${result.warnings.length}, resultado=${JSON.stringify(result.suggestion.slice(0, 180))}.`);
      const resolvedRoot = path.join(app.getPath('documents'), 'FirawMerge', 'Resolvidos');
      const resolvedRelative = path.relative(resolvedRoot, result.folder);
      if (resolvedRelative && !resolvedRelative.startsWith('..') && !path.isAbsolute(resolvedRelative))
        await fs.rm(result.folder, { recursive: true, force: true });
    }
    const server = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<h1>${request.url === '/a' ? 'Versão A' : 'Versão B'}</h1>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const webOpen = await win.webContents.executeJavaScript(`window.firaw.open(${JSON.stringify({
        kind: 'file', format: 'webpage', origin: `http://127.0.0.1:${address.port}/a`, destination: `http://127.0.0.1:${address.port}/b`
      })})`);
      const webDetail = await win.webContents.executeJavaScript("window.firaw.detail('__single__')");
      assert.equal(webOpen.items.length, 1);
      assert.equal(webDetail.format, 'webpage');
      assert.ok(webDetail.texts[1].includes('Versão A'));
      target = path.join(temporary, 'web-review.html');
      await win.webContents.executeJavaScript('window.firaw.export({})');
      assert.ok((await fs.readFile(target, 'utf8')).includes('Versão B'));
    } finally { await new Promise(resolve => server.close(resolve)); }
    await Promise.all(roots.map(async root => {
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', 'inside.txt'), 'nested');
    }));
    const onlyTop = await win.webContents.executeJavaScript(`window.firaw.open(${JSON.stringify({
      kind: 'folder', base: roots[0], origin: roots[1], destination: roots[2], mask: '*.txt', includeSubfolders: false
    })})`);
    assert.deepEqual(onlyTop.items.map(item => item.name), ['equal.txt', 'sample.txt']);
    const recursive = await win.webContents.executeJavaScript(`window.firaw.open(${JSON.stringify({
      kind: 'folder', base: roots[0], origin: roots[1], destination: roots[2], mask: '*.txt', includeSubfolders: true
    })})`);
    assert.deepEqual(recursive.items.map(item => item.name), ['equal.txt', 'nested/inside.txt', 'sample.txt']);
    await win.webContents.executeJavaScript("state.kind = 'folder'; updateMode()");
    win.webContents.send('shell:paths', [{ path: roots[0], kind: 'folder' }]);
    await new Promise(resolve => setTimeout(resolve, 40));
    win.webContents.send('shell:paths', [{ path: roots[1], kind: 'folder' }]);
    await new Promise(resolve => setTimeout(resolve, 40));
    const twoUi = await win.webContents.executeJavaScript(`(async () => {
      const selected = { ...state.paths };
      await compare();
      await selectFile('sample.txt');
      return { selected, slots: state.workspace.slots,
        labels: [...document.querySelectorAll('.pane-title span')].map(node => node.textContent),
        mode: document.getElementById('topMode').textContent };
    })()`);
    assert.deepEqual(twoUi.selected, { base: roots[0], origin: roots[1], destination: '' });
    assert.deepEqual(twoUi.slots, [null, 0, 1]);
    assert.deepEqual(twoUi.labels, ['Pasta 01', 'Pasta 02']);
    assert.ok(twoUi.mode.includes('2 ambientes'));
    const onePathMessage = await win.webContents.executeJavaScript(`(async () => {
      state.paths = ${JSON.stringify({ base: roots[0], origin: '', destination: '' })};
      await compare(); return document.getElementById('statusText').textContent;
    })()`);
    assert.equal(onePathMessage, 'Selecione pelo menos duas pastas ou arquivos.');
    console.log('Smoke: comparação, conflito e HTML exportado com sucesso.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    const relative = path.relative(os.tmpdir(), temporary);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(temporary, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
