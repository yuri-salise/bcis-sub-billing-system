import { contextBridge, ipcRenderer } from 'electron';

export interface PrinterConfig {
  type: '80mm' | '58mm';
  autoPrint: boolean;
  cutPaper: boolean;
  stationId: string;
}

export interface ElectronApiBridge {
  app: {
    getVersion: () => Promise<string>;
    lockScreen: () => Promise<{ locked: boolean; lockedAt: string }>;
    unlockScreen: () => Promise<{ unlocked: boolean; unlockedAt: string }>;
    isLocked: () => Promise<{ isLocked: boolean; lockedAt: string | null }>;
  };
  storage: {
    getToken: () => Promise<string | null>;
    setToken: (token: string) => Promise<boolean>;
    clearToken: () => Promise<boolean>;
  };
  config: {
    getServerUrl: () => Promise<string>;
    setServerUrl: (url: string) => Promise<boolean>;
    getPrinterConfig: () => Promise<PrinterConfig>;
    setPrinterConfig: (config: Partial<PrinterConfig>) => Promise<PrinterConfig>;
  };
  hardware: {
    printReceipt: (receiptData: any) => Promise<{ success: boolean; printedAt: string; printerType: string; receiptNumber: string }>;
  };
  network: {
    ping: (url?: string) => Promise<{ ok: boolean; latencyMs: number; data?: any; error?: string }>;
    checkServerHealth: (url: string) => Promise<any>;
  };
}

const api: ElectronApiBridge = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    lockScreen: () => ipcRenderer.invoke('app:lock-screen'),
    unlockScreen: () => ipcRenderer.invoke('app:unlock-screen'),
    isLocked: () => ipcRenderer.invoke('app:is-locked'),
  },
  storage: {
    getToken: () => ipcRenderer.invoke('storage:get-token'),
    setToken: (token: string) => ipcRenderer.invoke('storage:set-token', token),
    clearToken: () => ipcRenderer.invoke('storage:clear-token'),
  },
  config: {
    getServerUrl: () => ipcRenderer.invoke('config:get-server-url'),
    setServerUrl: (url: string) => ipcRenderer.invoke('config:set-server-url', url),
    getPrinterConfig: () => ipcRenderer.invoke('config:get-printer-config'),
    setPrinterConfig: (cfg: Partial<PrinterConfig>) => ipcRenderer.invoke('config:set-printer-config', cfg),
  },
  hardware: {
    printReceipt: (receiptData: any) => ipcRenderer.invoke('hardware:print-receipt', receiptData),
  },
  network: {
    ping: (url?: string) => ipcRenderer.invoke('network:ping', url),
    checkServerHealth: async (url: string) => {
      const res = await fetch(`${url}/health`);
      return res.json();
    },
  },
};

// Expose safe API to renderer with context isolation
contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api?: ElectronApiBridge;
  }
}
