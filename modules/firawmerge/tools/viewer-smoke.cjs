const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { mergeThree } = require('../src/merge.cjs');

app.whenReady().then(async () => {
  try {
    const base = 'ambiente=produção\ncor=azul\nativo=true';
    const origin = 'ambiente=produção\ncor=ciano\nativo=true';
    const destination = 'ambiente=produção\ncor=verde\nativo=true';
    const analysis = mergeThree(base, origin, destination);
    const report = { version: 1, title: 'FirawMerge', createdAt: new Date().toISOString(),
      roots: ['Pasta 01', 'Pasta 02', 'Pasta 03'], entries: [{ key: 'config.txt', name: 'config.txt', status: 'diferente', format: 'text',
        texts: [base, origin, destination], merged: 'ambiente=produção\ncor=ciano-editado\nativo=true',
        aiSuggestion: 'ambiente=produção\ncor=ciano\nativo=true',
        conflicts: analysis.conflicts, segments: analysis.segments,
        review: { model: 'qwen3:8b', safe: false, warnings: ['A sugestão precisa de revisão.'], modifiedAfterAi: true } }] };
    const template = await fs.readFile(path.join(__dirname, '..', 'src', 'viewer.html'), 'utf8');
    const runtime = await fs.readFile(path.join(__dirname, '..', 'src', 'viewer-runtime.js'), 'utf8');
    const html = template.replace('__FIRAWMERGE_DATA__', JSON.stringify(report).replace(/</g, '\\u003c'))
      .replace('__FIRAWMERGE_SCRIPT__', runtime);
    const output = path.join(__dirname, '..', 'examples', 'revisao-exemplo.html');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, html, 'utf8');
    const win = new BrowserWindow({ width: 1280, height: 800, show: false });
    await win.loadFile(output);
    const initial = await win.webContents.executeJavaScript("document.getElementById('content').value");
    assert.ok(initial.includes('cor=ciano'));
    assert.ok(initial.includes('ciano-editado'));
    const suggestion = await win.webContents.executeJavaScript("[...document.querySelectorAll('#viewButtons button')].find(x=>x.textContent==='Sugestão da IA').click(); document.getElementById('content').value");
    assert.ok(suggestion.includes('cor=ciano\n'));
    assert.ok(!suggestion.includes('ciano-editado'));
    const original = await win.webContents.executeJavaScript("[...document.querySelectorAll('#viewButtons button')].find(x=>x.textContent==='Pasta 03').click(); document.getElementById('content').value");
    assert.ok(original.includes('cor=verde'));
    await win.webContents.executeJavaScript("document.getElementById('hide').click()");
    const folds = await win.webContents.executeJavaScript("document.querySelectorAll('.fold').length");
    assert.ok(folds > 0);
    const warning = await win.webContents.executeJavaScript("document.getElementById('reviewWarning').textContent");
    assert.ok(warning.includes('A sugestão precisa de revisão.'));
    await new Promise(resolve => setTimeout(resolve, 250));
    try {
      const image = await win.webContents.capturePage();
      await fs.writeFile(path.join(__dirname, '..', 'assets', 'viewer-screenshot.png'), image.toPNG());
    } catch { /* A captura visual é opcional; as interações acima foram verificadas. */ }
    console.log('Viewer offline: versões, simulação e ocultação de linhas iguais OK.');
  } catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
  finally { app.exit(process.exitCode || 0); }
});
