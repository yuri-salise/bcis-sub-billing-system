import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronApiBridge {
  app: {
    getVersion: () => Promise<string>;
    lockScreen: () => Promise<{ locked: boolean; lockedAt: string }>;
  };
  network: {
    checkServerHealth: (url: string) => Promise<any>;
  };
}

const api: ElectronApiBridge = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    lockScreen: () => ipcRenderer.invoke('app:lock-screen'),
  },
  network: {
    checkServerHealth: async (url: string) => {
      const res = await fetch(`${url}/health`);
      return res.json();
    },
  },
};

// Expose safe API to renderer with context isolation
contextBridge.exposeInMainWorld('api', api);
