import React, { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '@bcis/domain';
import { CollectionAreaRecord, CollectionRouteRecord, RouteSheetItem } from '../api/types.js';
import { apiClient } from '../api/client.js';

export const CollectionsWorkspace: React.FC = () => {
  const [areas, setAreas] = useState<CollectionAreaRecord[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string>('');
  const [routes, setRoutes] = useState<CollectionRouteRecord[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('ALL');
  const [routeSheet, setRouteSheet] = useState<RouteSheetItem[]>([]);
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    const loadAreas = async () => {
      try {
        const res = await apiClient.listAreas();
        setAreas(res.data);
        if (res.data.length > 0) {
          setSelectedAreaId(res.data[0].id);
        }
      } catch {}
    };
    loadAreas();
  }, []);

  useEffect(() => {
    if (!selectedAreaId) return;

    const loadRoutesAndSheet = async () => {
      setIsLoading(true);
      try {
        const routesRes = await apiClient.listRoutes(selectedAreaId);
        setRoutes(routesRes.data);

        let sheetRes;
        if (selectedRouteId !== 'ALL') {
          sheetRes = await apiClient.getRouteRouteSheet(selectedRouteId, overdueOnly);
        } else {
          sheetRes = await apiClient.getAreaRouteSheet(selectedAreaId, overdueOnly);
        }
        setRouteSheet(sheetRes.data);
      } catch {
        setRoutes([]);
        setRouteSheet([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadRoutesAndSheet();
  }, [selectedAreaId, selectedRouteId, overdueOnly]);

  const filteredItems = useMemo(() => {
    let list = routeSheet;
    if (selectedRouteId !== 'ALL') {
      list = list.filter((item) => !item.routeId || item.routeId === selectedRouteId || item.collectionRouteId === selectedRouteId);
    }
    if (overdueOnly) {
      list = list.filter((item) => item.arrearsCentavos > 0);
    }
    return list;
  }, [routeSheet, selectedRouteId, overdueOnly]);

  const totalArrearsCentavos = useMemo(() => {
    return filteredItems.reduce((acc, item) => acc + item.arrearsCentavos, 0);
  }, [filteredItems]);

  const selectedArea = areas.find((a) => a.id === selectedAreaId);

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>
      {/* Top Selector & Controls */}
      <div className="apple-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
              Collection Area
            </label>
            <select
              value={selectedAreaId}
              onChange={(e) => {
                setSelectedAreaId(e.target.value);
                setSelectedRouteId('ALL');
              }}
              className="apple-input"
              style={{ width: '220px', marginTop: '2px', fontWeight: 500 }}
            >
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name} ({area.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
              Route Filter
            </label>
            <select
              value={selectedRouteId}
              onChange={(e) => setSelectedRouteId(e.target.value)}
              className="apple-input"
              style={{ width: '220px', marginTop: '2px' }}
            >
              <option value="ALL">All Routes in Area ({routes.length})</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.routeCode} — {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Overdue Only Filter Switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#E11D48' }}
            />
            <span style={{ color: overdueOnly ? '#E11D48' : 'var(--text-primary)' }}>
              Show Overdue Arrears Only
            </span>
          </label>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => window.print()}
            style={{ fontSize: '12px', padding: '6px 14px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>Print Run Sheet</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <div className="apple-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
            Accounts on Run Sheet
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px' }}>
            {filteredItems.length}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {selectedArea?.barangay || 'Malaybalay'}, {selectedArea?.city || 'Bukidnon'}
          </div>
        </div>

        <div className="apple-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
            Total Collectibles / Arrears
          </div>
          <div
            className="tabular-nums"
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: totalArrearsCentavos > 0 ? '#E11D48' : '#059669',
              marginTop: '4px',
            }}
          >
            {formatCurrency(totalArrearsCentavos)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Target field collections
          </div>
        </div>

        <div className="apple-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
            Assigned Field Collector
          </div>
          <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px' }}>
            {selectedArea?.assignedCollectorName || 'Collector Rommel'}
          </div>
          <div style={{ fontSize: '11px', color: '#059669', marginTop: '2px' }}>
            Active Field Route
          </div>
        </div>
      </div>

      {/* Field Route Sheet Table */}
      <div className="apple-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600 }}>
            Field Route Run Sheet: {selectedArea?.name}
          </h3>
          <span className="badge badge-neutral">
            {filteredItems.length} subscribers in queue
          </span>
        </div>

        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', textAlign: 'left' }}>
                <th style={{ padding: '10px 8px' }}>Account No.</th>
                <th style={{ padding: '10px 8px' }}>Subscriber Name</th>
                <th style={{ padding: '10px 8px' }}>Address & Barangay</th>
                <th style={{ padding: '10px 8px' }}>Contact</th>
                <th style={{ padding: '10px 8px' }}>Plan</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Plan MRC</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Total Arrears</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>Overdue Days</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length > 0 ? (
                filteredItems.map((item) => (
                  <tr key={item.serviceAccountId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 8px' }} className="font-mono font-semibold">
                      {item.accountNumber}
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 500 }}>
                      {item.subscriberName}
                    </td>
                    <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>
                      {item.address}, {item.barangay}
                    </td>
                    <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }} className="font-mono">
                      {item.contactNumber}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {item.planName}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }} className="tabular-nums">
                      {formatCurrency(item.planFeeCentavos)}
                    </td>
                    <td
                      style={{
                        padding: '10px 8px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: item.arrearsCentavos > 0 ? '#E11D48' : '#059669',
                      }}
                      className="tabular-nums"
                    >
                      {formatCurrency(item.arrearsCentavos)}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }} className="tabular-nums">
                      {item.daysOverdue > 0 ? (
                        <span style={{ color: item.daysOverdue > 60 ? '#E11D48' : '#D97706', fontWeight: 600 }}>
                          {item.daysOverdue}d
                        </span>
                      ) : (
                        <span style={{ color: '#059669' }}>0d</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <span className={`badge ${item.isDelinquent ? 'badge-danger' : 'badge-success'}`}>
                        {item.isDelinquent ? 'DELINQUENT' : 'CURRENT'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    No route accounts matching current filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
