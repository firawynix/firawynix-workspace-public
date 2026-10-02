const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { mergeThree } = require('../src/merge.cjs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 950, show: false,
    backgroundColor: '#080d16', webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise(resolve => setTimeout(resolve, 700));
  const image = await win.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, '..', 'assets', 'screenshot.png'), image.toPNG());
  const base = 'ambiente=produção\ncor=azul\nativo=true';
  const origin = 'ambiente=produção\ncor=ciano\nativo=true';
  const destination = 'ambiente=produção\ncor=verde\nativo=true';
  const detail = { key: 'config.txt', name: 'config.txt', status: 'diferente', texts: [base, origin, destination], ...mergeThree(base, origin, destination) };
  await win.webContents.executeJavaScript(`
    state.workspace = { roots: ['Base', 'Origem', 'Destino'], items: [{ key: 'config.txt', name: 'config.txt', status: 'diferente' }] };
    state.detail = ${JSON.stringify(detail)};
    document.getElementById('workspaceTitle').textContent = 'Revisão em três ambientes';
    document.getElementById('workspaceSubtitle').textContent = '1 arquivo mapeado · escolha um arquivo para revisar';
    document.getElementById('fileCount').textContent = '1';
    document.getElementById('activeFile').textContent = 'config.txt';
    document.getElementById('resultText').disabled = false;
    document.getElementById('resultText').value = state.detail.merged;
    renderList(); renderDiff(); renderHunks(); resultInfo();
  `);
  await new Promise(resolve => setTimeout(resolve, 250));
  const diffImage = await win.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, '..', 'assets', 'diff-screenshot.png'), diffImage.toPNG());
  await win.webContents.executeJavaScript(`
    document.getElementById('aiModal').classList.remove('hidden');
    document.getElementById('hardwareInfo').innerHTML = '<span>CPU: AMD Ryzen 9 5900XT</span><span>Threads: 32</span><span>RAM: 128 GB</span><span>GPU: AMD Radeon RX 9060 XT · VRAM: 16 GB</span>';
    document.getElementById('ramRange').value = 56;
    document.getElementById('gpuRange').value = 14;
    document.getElementById('cpuRange').value = 16;
    document.getElementById('ramValue').textContent = '56 GB';
    document.getElementById('gpuValue').textContent = '14 GB VRAM';
    document.getElementById('cpuValue').textContent = '16 threads';
    document.getElementById('recommendedModel').textContent = 'qwen2.5-coder:7b';
    document.getElementById('recommendReason').textContent = '4.7 GB para baixar · execução por GPU, se compatível com o Ollama.';
  `);
  await new Promise(resolve => setTimeout(resolve, 300));
  const settingsImage = await win.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, '..', 'assets', 'settings-screenshot.png'), settingsImage.toPNG());
  app.quit();
});
