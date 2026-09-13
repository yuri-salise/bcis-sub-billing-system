import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BCIS Subscription Billing and Collection System',
    backgroundColor: '#0F2747',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/preload.js'),
    },
  });

  // In production, loads the bundled dist index.html; in dev, can load localhost
  const indexPath = path.join(__dirname, '../../index.html');
  mainWindow.loadFile(indexPath).catch(() => {
    // If file isn't built yet, load raw HTML string
    mainWindow?.loadURL(`data:text/html;charset=utf-8,<html><head><title>BCIS</title></head><body style="background:#0F2747;color:white;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><h2>BCIS Desktop Client Initialized</h2></body></html>`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// IPC Handlers
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:lock-screen', () => {
  return { locked: true, lockedAt: new Date().toISOString() };
});

if (app) {
  app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
