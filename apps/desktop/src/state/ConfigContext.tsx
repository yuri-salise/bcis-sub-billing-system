import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import { LANServerHealth } from '../api/types.js';

export interface PrinterPreferences {
  type: '80mm' | '58mm';
  autoPrint: boolean;
  cutPaper: boolean;
  stationId: string;
}

interface ConfigContextType {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  isOnline: boolean;
  latencyMs: number | null;
  serverHealth: LANServerHealth | null;
  printerConfig: PrinterPreferences;
  updatePrinterConfig: (newConfig: Partial<PrinterPreferences>) => void;
  pingServer: (targetUrl?: string) => Promise<{ ok: boolean; latencyMs: number; data?: LANServerHealth }>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [serverUrl, setServerUrlState] = useState<string>('http://127.0.0.1:4000');
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [serverHealth, setServerHealth] = useState<LANServerHealth | null>(null);
  const [printerConfig, setPrinterConfigState] = useState<PrinterPreferences>({
    type: '80mm',
    autoPrint: true,
    cutPaper: true,
    stationId: 'COUNTER-PC-01',
  });

  const pingServer = useCallback(async (targetUrl?: string): Promise<{ ok: boolean; latencyMs: number; data?: LANServerHealth }> => {
    try {
      if (targetUrl) {
        apiClient.setBaseUrl(targetUrl);
      }
      const pingResult = await apiClient.ping();
      setIsOnline(pingResult.ok);
      setLatencyMs(pingResult.ok ? pingResult.latencyMs : null);
      if (pingResult.data) {
        setServerHealth(pingResult.data);
      }
      return pingResult;
    } catch {
      setIsOnline(false);
      setLatencyMs(null);
      return { ok: false, latencyMs: 0 };
    }
  }, []);

  const setServerUrl = (url: string) => {
    setServerUrlState(url);
    apiClient.setBaseUrl(url);
    pingServer(url);
  };

  const updatePrinterConfig = (newConfig: Partial<PrinterPreferences>) => {
    setPrinterConfigState((prev) => {
      const updated = { ...prev, ...newConfig };
      if (typeof window !== 'undefined' && window.api) {
        window.api.config.setPrinterConfig(updated).catch(() => {});
      }
      return updated;
    });
  };

  useEffect(() => {
    // Initial fetch from Electron IPC config
    if (typeof window !== 'undefined' && window.api) {
      window.api.config.getServerUrl().then((url) => {
        if (url) {
          setServerUrlState(url);
          apiClient.setBaseUrl(url);
        }
      }).catch(() => {});

      window.api.config.getPrinterConfig().then((cfg) => {
        if (cfg) setPrinterConfigState(cfg);
      }).catch(() => {});
    }

    pingServer();
    const interval = setInterval(pingServer, 10000);
    return () => clearInterval(interval);
  }, [pingServer]);

  return (
    <ConfigContext.Provider
      value={{
        serverUrl,
        setServerUrl,
        isOnline,
        latencyMs,
        serverHealth,
        printerConfig,
        updatePrinterConfig,
        pingServer,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) throw new Error('useConfig must be used within a ConfigProvider');
  return context;
};
