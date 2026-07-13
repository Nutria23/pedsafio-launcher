const { contextBridge, ipcRenderer } = require('electron');
const { runLaunchSequence } = require('./src/launch');
const { startSync } = require('./src/downloader');
const fs = require('fs');
const path = require('path');

contextBridge.exposeInMainWorld('api', {
  // Read local configuration secure-bypass
  getLauncherConfig: () => {
    try {
      const configPath = path.join(__dirname, 'src', 'launcher-config.json');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading launcher-config.json:', err);
    }
    return null;
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  
  // Folder opening
  openFolder: (path) => ipcRenderer.send('open-game-folder', path),
  
  // Settings management
  getLocalSettings: () => ipcRenderer.invoke('get-local-settings'),
  saveLocalSettings: (settings) => ipcRenderer.invoke('save-local-settings', settings),
  
  // Microsoft Authentication
  loginMicrosoft: () => ipcRenderer.invoke('login-microsoft'),
  loginMicrosoftRefresh: (token) => ipcRenderer.invoke('login-microsoft-refresh', token),

  // Direct Minecraft status ping
  pingServer: (host, port) => ipcRenderer.invoke('ping-minecraft-server', host, port),

  // Launcher Game engine interface
  startUpdateAndLaunch: async (remoteConfig, settings, onProgress, onStatus, onLog) => {
    try {
      onStatus({ state: 'checking', message: 'Iniciando comprobación de archivos...' });
      
      // 1. Delta updater phase
      onStatus({ state: 'updating', message: 'Sincronizando archivos del servidor...' });
      await startSync(remoteConfig, settings, (prog) => {
        // Prog contains: progress (0-100), speed (MB/s), file, eta (seconds)
        onProgress(prog);
      }, (logLine) => {
        onLog('[AutoUpdater] ' + logLine);
      });

      // 2. Launch game phase
      onStatus({ state: 'launching', message: 'Preparando arranque de Minecraft...' });
      await runLaunchSequence(remoteConfig, settings, (statusMsg) => {
        onStatus({ state: 'launching', message: statusMsg });
      }, (logLine) => {
        onLog('[Minecraft] ' + logLine);
      }, () => {
        onStatus({ state: 'running', message: 'Juego en ejecución' });
      }, () => {
        onStatus({ state: 'closed', message: 'Juego cerrado' });
      });
    } catch (err) {
      onStatus({ state: 'error', message: err.message || 'Error durante el arranque.' });
      onLog('[Error] ' + (err.stack || err.message));
    }
  }
});
