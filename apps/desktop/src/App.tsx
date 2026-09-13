import React, { useState, useEffect } from 'react';
import { UserRole } from '@bcis/shared-types';
import { formatCurrency } from '@bcis/domain';

export const App: React.FC = () => {
  const [selectedRole, setSelectedRole] = useState<UserRole>(UserRole.CASHIER);
  const [serverHealth, setServerHealth] = useState<{ status: string; db: string; latency?: number } | null>(null);
  const [serverUrl, setServerUrl] = useState('http://localhost:4000');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const start = performance.now();
        const res = await fetch(`${serverUrl}/health`);
        const data = (await res.json()) as { status: string; database: string };
        const latency = Math.round(performance.now() - start);
        setServerHealth({ status: data.status, db: data.database, latency });
      } catch {
        setServerHealth({ status: 'offline', db: 'unreachable' });
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [serverUrl]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F6F8FB', color: '#0F172A', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header Bar */}
      <header style={{ backgroundColor: '#0F2747', color: '#FFFFFF', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
            B
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>BCIS Subscription Billing & Collection</h1>
            <p style={{ margin: 0, fontSize: '12px', color: '#94A3B8' }}>Bukidnon Cable and Internet Services — Office LAN Client</p>
          </div>
        </div>

        {/* Server Connection Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: serverHealth?.status === 'ok' ? '#059669' : '#DC2626',
              }}
            />
            <span>
              Server: {serverHealth?.status === 'ok' ? `Connected (${serverHealth.latency}ms)` : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: '1200px', margin: '32px auto', padding: '0 24px' }}>
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '24px', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0F2747', marginBottom: '16px' }}>
            Workstation Mode Selection (Multi-Client LAN Deployment)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <button
              onClick={() => setSelectedRole(UserRole.SUPER_ADMIN)}
              style={{
                padding: '16px',
                borderRadius: '6px',
                border: selectedRole === UserRole.SUPER_ADMIN ? '2px solid #2563EB' : '1px solid #CBD5E1',
                backgroundColor: selectedRole === UserRole.SUPER_ADMIN ? '#EFF6FF' : '#FFFFFF',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, color: '#0F2747' }}>PC 1: Owner / Super Admin</div>
              <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
                Full system control, reversals, audit logs, and backups.
              </div>
            </button>

            <button
              onClick={() => setSelectedRole(UserRole.CASHIER)}
              style={{
                padding: '16px',
                borderRadius: '6px',
                border: selectedRole === UserRole.CASHIER ? '2px solid #2563EB' : '1px solid #CBD5E1',
                backgroundColor: selectedRole === UserRole.CASHIER ? '#EFF6FF' : '#FFFFFF',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, color: '#0F2747' }}>PC 2: Cashier Counter</div>
              <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
                Counter payment receipting, FIFO allocation, and GCash verification.
              </div>
            </button>

            <button
              onClick={() => setSelectedRole(UserRole.COLLECTION_SUPERVISOR)}
              style={{
                padding: '16px',
                borderRadius: '6px',
                border: selectedRole === UserRole.COLLECTION_SUPERVISOR ? '2px solid #2563EB' : '1px solid #CBD5E1',
                backgroundColor: selectedRole === UserRole.COLLECTION_SUPERVISOR ? '#EFF6FF' : '#FFFFFF',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, color: '#0F2747' }}>PC 3: Field Operations</div>
              <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
                Route sheets, collection batching, and remittance reconciliation.
              </div>
            </button>
          </div>
        </div>

        {/* Financial Domain Check Sample */}
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0F2747', marginBottom: '12px' }}>
            Financial Precision Verification
          </h2>
          <p style={{ fontSize: '14px', color: '#64748B' }}>
            Integer centavos standard verified: {formatCurrency(99900)} (Plan MRC), {formatCurrency(149950)} (Combo Plan).
          </p>
        </div>
      </main>
    </div>
  );
};

export default App;
