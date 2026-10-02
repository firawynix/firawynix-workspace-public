const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

function startUpdates(app) {
  if (!app.isPackaged || process.windowsStore || process.env.PORTABLE_EXECUTABLE_FILE) return;
  // O instalador NSIS cria support/. O executável portátil não consulta atualizações.
  if (!fs.existsSync(path.join(path.dirname(process.execPath), 'support', 'register.ps1'))) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('error', error => {
    // O feed é um link mock até a primeira publicação; falha de rede não bloqueia o app.
    process.stderr.write(`FirawMerge update: ${error.message}\n`);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000).unref();
  const timer = setInterval(check, 6 * 60 * 60 * 1000);
  timer.unref();
}

module.exports = { startUpdates };
