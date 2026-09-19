import React, { useState } from 'react';
import { useConfig } from '../state/ConfigContext.js';

export const SettingsWorkspace: React.FC = () => {
  const {
    serverUrl,
    setServerUrl,
    isOnline,
    latencyMs,
    serverHealth,
    printerConfig,
    updatePrinterConfig,
    pingServer,
  } = useConfig();

  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setServerUrl(inputUrl);
    const res = await pingServer(inputUrl);
    setIsTesting(false);

    if (res.ok) {
      setTestResult({
        ok: true,
        message: `Connected to Fastify LAN server (${res.latencyMs}ms latency). Database: ${res.data?.database || 'OK'}`,
      });
    } else {
      setTestResult({
        ok: false,
        message: `Unable to reach server at ${inputUrl}. Verify IP address and port 4000.`,
      });
    }
  };

  const handleTestPrint = async () => {
    if (typeof window !== 'undefined' && window.api) {
      const res = await window.api.hardware.printReceipt({
        receiptNumber: 'OR-TEST-0001',
        subscriberName: 'Juan Dela Cruz (Test Print)',
        totalAmountCentavos: 149950,
      });
      alert(`Hardware print signal dispatched to ${res.printerType} printer (${res.receiptNumber})`);
    } else {
      alert('Mock test receipt printed successfully in browser mode.');
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, overflowY: 'auto' }}>
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>LAN Settings & Hardware Configuration</h2>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Configure multi-client LAN server endpoint, workstation ID, and thermal receipt printers.
        </div>
      </div>

      {/* LAN Fastify Server Connection Card */}
      <div className="apple-card" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Fastify LAN Server Endpoint</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Connect this workstation to the central BCIS LAN database server. Default is local loopback or local IP.
        </p>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="http://192.168.1.100:4000"
              className="apple-input font-mono"
              style={{ fontSize: '13px', height: '38px' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Example LAN formats: http://192.168.1.50:4000 or http://127.0.0.1:4000
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="btn-primary"
            style={{ height: '38px', minWidth: '160px' }}
          >
            {isTesting ? 'Testing Ping...' : 'Save & Test Ping'}
          </button>
        </div>

        {/* Live Latency & Status Pill */}
        <div
          style={{
            marginTop: '16px',
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: isOnline ? '#ECFDF5' : '#FFF1F2',
            border: isOnline ? '1px solid #A7F3D0' : '1px solid #FECDD3',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: isOnline ? '#059669' : '#DC2626',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: '13px', fontWeight: 500, color: isOnline ? '#065F46' : '#9F1239' }}>
              {isOnline ? 'LAN Server Connection Established' : 'Server Unreachable (Offline Mode)'}
            </span>
          </div>

          {isOnline && latencyMs !== null && (
            <div style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }} className="font-mono">
              Latency: {latencyMs}ms • DB: {serverHealth?.database || 'PostgreSQL OK'}
            </div>
          )}
        </div>

        {testResult && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: testResult.ok ? '#059669' : '#DC2626' }}>
            {testResult.message}
          </div>
        )}
      </div>

      {/* Hardware & Thermal Printer Preferences */}
      <div className="apple-card" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Thermal Receipt Printer & POS Station</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Configure ESC/POS thermal printing preferences for official receipts (BIR format).
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Workstation Terminal Identifier
            </label>
            <input
              type="text"
              value={printerConfig.stationId}
              onChange={(e) => updatePrinterConfig({ stationId: e.target.value })}
              className="apple-input font-mono"
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Used in audit trail and official receipt metadata.
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Thermal Paper Width
            </label>
            <div style={{ display: 'flex', gap: '10px', marginTop: '2px' }}>
              <button
                type="button"
                onClick={() => updatePrinterConfig({ type: '80mm' })}
                className="pressable"
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: printerConfig.type === '80mm' ? '2px solid #0071E3' : '1px solid var(--border-subtle)',
                  backgroundColor: printerConfig.type === '80mm' ? '#EFF6FF' : '#FFFFFF',
                  color: printerConfig.type === '80mm' ? '#0071E3' : 'var(--text-primary)',
                  fontWeight: printerConfig.type === '80mm' ? 600 : 400,
                  fontSize: '12px',
                }}
              >
                80mm (Standard POS)
              </button>
              <button
                type="button"
                onClick={() => updatePrinterConfig({ type: '58mm' })}
                className="pressable"
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: printerConfig.type === '58mm' ? '2px solid #0071E3' : '1px solid var(--border-subtle)',
                  backgroundColor: printerConfig.type === '58mm' ? '#EFF6FF' : '#FFFFFF',
                  color: printerConfig.type === '58mm' ? '#0071E3' : 'var(--text-primary)',
                  fontWeight: printerConfig.type === '58mm' ? 600 : 400,
                  fontSize: '12px',
                }}
              >
                58mm (Compact Mobile)
              </button>
            </div>
          </div>
        </div>

        {/* Checkbox Options */}
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={printerConfig.autoPrint}
              onChange={(e) => updatePrinterConfig({ autoPrint: e.target.checked })}
              style={{ width: '16px', height: '16px', accentColor: '#0071E3' }}
            />
            <span>Automatically print Official Receipt upon posting payment</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={printerConfig.cutPaper}
              onChange={(e) => updatePrinterConfig({ cutPaper: e.target.checked })}
              style={{ width: '16px', height: '16px', accentColor: '#0071E3' }}
            />
            <span>Send auto-cutter paper command (ESC i / GS V) after receipt print</span>
          </label>
        </div>

        {/* Test Print Action */}
        <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={handleTestPrint}
            className="btn-secondary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>Send Test Receipt to Printer</span>
          </button>
        </div>
      </div>
    </div>
  );
};
