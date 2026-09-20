import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

// Secure in-memory token and configuration storage in main process
let sessionToken: string | null = null;
let isScreenLocked = false;
let screenLockedAt: string | null = null;

let serverConfig = {
  url: process.env.BCIS_SERVER_URL || 'http://127.0.0.1:4000',
};

let printerConfig = {
  type: '80mm' as '80mm' | '58mm',
  autoPrint: true,
  cutPaper: true,
  stationId: 'COUNTER-PC-01',
};

if (app) {
  app.name = 'BCIS-Billing-System';
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'BCIS Subscription Billing and Collection System',
    backgroundColor: '#0F172A',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/preload.js'),
    },
  });

  mainWindow.webContents.on('console-message', (event: any, ...rest: any[]) => {
    const message = event && typeof event === 'object' && 'message' in event
      ? event.message
      : (rest[1] ?? event);
    console.log(`[Renderer] ${message}`);
  });

  const indexPath = path.join(__dirname, '../../index.html');
  mainWindow.loadFile(indexPath).catch(() => {
    mainWindow?.loadURL(
      `data:text/html;charset=utf-8,<html><head><title>BCIS</title></head><body style="background:#0F172A;color:white;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;"><h2>BCIS Desktop Client Initialized</h2></body></html>`
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// IPC Handlers: Application & Screen Lock
ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('app:lock-screen', () => {
  isScreenLocked = true;
  screenLockedAt = new Date().toISOString();
  return { locked: true, lockedAt: screenLockedAt };
});

ipcMain.handle('app:unlock-screen', () => {
  isScreenLocked = false;
  screenLockedAt = null;
  return { unlocked: true, unlockedAt: new Date().toISOString() };
});

ipcMain.handle('app:is-locked', () => {
  return { isLocked: isScreenLocked, lockedAt: screenLockedAt };
});

// IPC Handlers: Secure Session Token Storage
ipcMain.handle('storage:get-token', () => sessionToken);

ipcMain.handle('storage:set-token', (_event, token: string) => {
  sessionToken = token;
  return true;
});

ipcMain.handle('storage:clear-token', () => {
  sessionToken = null;
  return true;
});

// IPC Handlers: Network & Configuration
ipcMain.handle('config:get-server-url', () => serverConfig.url);

ipcMain.handle('config:set-server-url', (_event, url: string) => {
  serverConfig.url = url;
  return true;
});

ipcMain.handle('config:get-printer-config', () => printerConfig);

ipcMain.handle('config:set-printer-config', (_event, newConfig: Partial<typeof printerConfig>) => {
  printerConfig = { ...printerConfig, ...newConfig };
  return printerConfig;
});

// IPC Handlers: Hardware Printing Simulation / Execution
ipcMain.handle('hardware:print-receipt', async (_event, receiptData: any) => {
  // Simulates thermal printer output with cut paper signal
  const receiptNumber = receiptData?.receiptNumber || 'OR-RECEIPT';
  console.log(`[Hardware] Printing thermal receipt ${receiptNumber} on ${printerConfig.type} printer at ${printerConfig.stationId}`);
  return {
    success: true,
    printedAt: new Date().toISOString(),
    printerType: printerConfig.type,
    receiptNumber,
  };
});

// IPC Handlers: LAN Server Health Check
ipcMain.handle('network:ping', async (_event, targetUrl?: string) => {
  const urlToPing = targetUrl || serverConfig.url;
  const start = performance.now();
  try {
    const res = await fetch(`${urlToPing}/health`);
    const data = await res.json();
    const latencyMs = Math.round(performance.now() - start);
    return { ok: res.ok, latencyMs, data };
  } catch (err: any) {
    return { ok: false, latencyMs: -1, error: err.message || 'Connection failed' };
  }
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
