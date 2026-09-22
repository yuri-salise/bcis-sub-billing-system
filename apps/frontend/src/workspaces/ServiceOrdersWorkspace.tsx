import React, { useState, useEffect } from 'react';
import { formatCurrency, parseCurrencyToCentavos } from '@bcis/domain';
import { ServiceOrderRecord, SubscriberRecord } from '../api/types.js';
import { apiClient } from '../api/client.js';
import { IconPlus, IconX } from '../components/icons/index.js';

export const ServiceOrdersWorkspace: React.FC = () => {
  const [orders, setOrders] = useState<ServiceOrderRecord[]>([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrderRecord | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState<boolean>(false);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [technicians, setTechnicians] = useState<Array<{ id: string; fullName: string }>>([]);
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [subscribers, setSubscribers] = useState<SubscriberRecord[]>([]);

  const [newOrder, setNewOrder] = useState({
    orderType: 'INSTALLATION',
    priority: 'NORMAL',
    subscriberId: '',
    serviceAccountId: '',
    assignedTechnicianId: '',
    scheduledDate: new Date().toISOString().split('T')[0],
    description: '',
    feeStr: '1500.00',
  });

  const loadOrders = async () => {
    try {
      const res = await apiClient.listServiceOrders();
      setOrders(res.data);
    } catch {}
  };

  const loadTechnicians = async () => {
    try {
      const res = await apiClient.listTechnicians();
      setTechnicians(res.data);
      if (res.data.length > 0) setSelectedTechId(res.data[0].id);
    } catch {}
  };

  const loadSubscribers = async () => {
    try {
      const res = await apiClient.listSubscribers({ limit: 100 });
      setSubscribers(res.data);
    } catch {}
  };

  useEffect(() => {
    loadOrders();
    loadTechnicians();
    loadSubscribers();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDetailModalOpen) setIsDetailModalOpen(false);
        if (isNewOrderModalOpen) setIsNewOrderModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDetailModalOpen, isNewOrderModalOpen]);

  const handleStatusChange = async (orderId: string, nextStatus: string) => {
    try {
      if (nextStatus === 'COMPLETED') {
        if (!resolutionNotes.trim()) {
          alert('Please enter Field Resolution Notes before completing the order.');
          return;
        }
        await apiClient.completeServiceOrder(orderId, resolutionNotes);
      } else if (nextStatus === 'CANCELLED') {
        await apiClient.cancelServiceOrder(orderId, 'Cancelled by dispatcher');
      } else if (nextStatus === 'ASSIGNED') {
        // Dispatch: assign tech first, which will auto-transition to ASSIGNED
        if (!selectedTechId) {
          alert('Please select a technician before dispatching.');
          return;
        }
        await apiClient.assignTechnician(orderId, selectedTechId);
      } else if (nextStatus === 'IN_PROGRESS') {
        // Ensure tech is assigned (re-assign if changed), then transition
        if (selectedTechId && selectedTechId !== selectedOrder?.assignedTechnicianId) {
          await apiClient.assignTechnician(orderId, selectedTechId);
        }
        await apiClient.updateServiceOrderStatus(orderId, nextStatus);
      } else {
        await apiClient.updateServiceOrderStatus(orderId, nextStatus);
      }
      setIsDetailModalOpen(false);
      loadOrders();
    } catch (err: any) {
      alert(`Error updating order: ${err.message}`);
    }
  };

  const openCreateModal = () => {
    const defaultSub = subscribers.find((s) => s.serviceAccounts && s.serviceAccounts.length > 0) || subscribers[0];
    const defaultSa = defaultSub?.serviceAccounts?.[0]?.id || '';
    setNewOrder({
      orderType: 'INSTALLATION',
      priority: 'NORMAL',
      subscriberId: defaultSub?.id || '',
      serviceAccountId: defaultSa,
      assignedTechnicianId: '',
      scheduledDate: new Date().toISOString().split('T')[0],
      description: '',
      feeStr: '1500.00',
    });
    setIsNewOrderModalOpen(true);
  };

  const handleSubscriberChange = (subId: string) => {
    const sub = subscribers.find((s) => s.id === subId);
    const firstSaId = sub?.serviceAccounts?.[0]?.id || '';
    setNewOrder((prev) => ({
      ...prev,
      subscriberId: subId,
      serviceAccountId: firstSaId,
    }));
  };

  const handleOrderTypeChange = (type: string) => {
    let defaultFee = '0.00';
    if (type === 'INSTALLATION') defaultFee = '1500.00';
    else if (type === 'RECONNECTION') defaultFee = '500.00';
    setNewOrder((prev) => ({
      ...prev,
      orderType: type,
      feeStr: ['1500.00', '0.00', '500.00'].includes(prev.feeStr) ? defaultFee : prev.feeStr,
    }));
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.serviceAccountId) {
      alert('Please select a subscriber and service account.');
      return;
    }
    if (!newOrder.description.trim() || newOrder.description.trim().length < 3) {
      alert('Work description must be at least 3 characters.');
      return;
    }
    try {
      await apiClient.createServiceOrder({
        serviceAccountId: newOrder.serviceAccountId,
        orderType: newOrder.orderType,
        priority: newOrder.priority,
        description: newOrder.description.trim(),
        assignedTechnicianId: newOrder.assignedTechnicianId || undefined,
        scheduledDate: newOrder.scheduledDate || undefined,
        feeCentavos: parseCurrencyToCentavos(newOrder.feeStr || '0'),
      });
      setIsNewOrderModalOpen(false);
      loadOrders();
    } catch (err: any) {
      alert(`Failed to create order: ${err.message}`);
    }
  };

  const filteredOrders = selectedTypeFilter === 'ALL'
    ? orders
    : orders.filter((o) => o.orderType === selectedTypeFilter);

  const columns = [
    { id: 'PENDING', label: 'Pending Dispatch', badgeColor: 'badge-neutral' },
    { id: 'ASSIGNED', label: 'Assigned to Tech', badgeColor: 'badge-primary' },
    { id: 'IN_PROGRESS', label: 'In Progress On-Site', badgeColor: 'badge-warning' },
    { id: 'COMPLETED', label: 'Completed & Closed', badgeColor: 'badge-success' },
  ];

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'INSTALLATION': return 'badge-primary';
      case 'REPAIR': return 'badge-warning';
      case 'DISCONNECTION': return 'badge-danger';
      case 'RECONNECTION': return 'badge-success';
      default: return 'badge-neutral';
    }
  };

  return (
    <div className="workspace-animate-enter" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>
      {/* Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>Field Service Orders & Technician Queue</h2>
          <div style={{ display: 'flex', gap: '6px' }}>
            {['ALL', 'INSTALLATION', 'REPAIR', 'DISCONNECTION', 'RECONNECTION'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedTypeFilter(type)}
                className="pressable"
                style={{
                  padding: '5px 11px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: selectedTypeFilter === type ? 700 : 500,
                  border: selectedTypeFilter === type ? '1.5px solid #2C5745' : '1px solid var(--border-subtle)',
                  backgroundColor: selectedTypeFilter === type ? 'rgba(44, 87, 69, 0.09)' : '#FFFFFF',
                  color: selectedTypeFilter === type ? '#2C5745' : 'var(--text-secondary)',
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <IconPlus size={14} strokeWidth={2} />
          <span>Create Service Order</span>
        </button>
      </div>

      {/* Kanban Board Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', flex: 1, minHeight: 0 }}>
        {columns.map((col) => {
          const colOrders = filteredOrders.filter((o) => o.status === col.id);
          return (
            <div
              key={col.id}
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderRadius: '11px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {/* Column Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {col.label}
                </span>
                <span className={`badge ${col.badgeColor}`}>
                  {colOrders.length}
                </span>
              </div>

              {/* Cards Container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1 }}>
                {colOrders.map((order) => (
                  <div
                    key={order.id}
                    onClick={() => {
                      setSelectedOrder(order);
                      setResolutionNotes(order.resolutionNotes || '');
                      // Pre-select the currently assigned tech, or fall back to first available
                      setSelectedTechId(order.assignedTechnicianId || (technicians[0]?.id ?? ''));
                      setIsDetailModalOpen(true);
                    }}
                    className="apple-card pressable"
                    style={{
                      padding: '12px',
                      cursor: 'pointer',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span className="font-mono font-semibold" style={{ fontSize: '12px' }}>
                        {order.orderNumber}
                      </span>
                      <span className={`badge ${getTypeBadgeClass(order.orderType)}`} style={{ fontSize: '10px' }}>
                        {order.orderType}
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {order.subscriberName || 'Subscriber'}
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.3 }}>
                      {order.description || 'No detailed instructions provided.'}
                    </div>

                    <div
                      style={{
                        marginTop: '10px',
                        paddingTop: '8px',
                        borderTop: '1px dashed var(--border-subtle)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '11px',
                      }}
                    >
                      <span style={{ color: order.priority === 'URGENT' ? '#E11D48' : 'var(--text-tertiary)', fontWeight: order.priority === 'URGENT' ? 600 : 400 }}>
                        {order.priority}
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {order.assignedTechnicianName || 'Unassigned'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Order Detail & Transition Modal */}
      {isDetailModalOpen && selectedOrder && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(46, 41, 16, 0.72)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="glass-modal modal-animate-enter"
            style={{ width: '540px', backgroundColor: '#FFFFFF', overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600 }}>{selectedOrder.orderNumber}</h3>
                  <span className={`badge ${getTypeBadgeClass(selectedOrder.orderType)}`}>
                    {selectedOrder.orderType}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {selectedOrder.subscriberName || 'Subscriber'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailModalOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                title="Close dialog"
              >
                <IconX size={16} strokeWidth={2} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                  Instructions / Work Description
                </label>
                <div style={{ fontSize: '13px', marginTop: '4px', padding: '10px', backgroundColor: 'var(--bg-subtle)', borderRadius: '6px' }}>
                  {selectedOrder.description || 'Routine installation / service check.'}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Assign Field Technician
                </label>
                <select
                  value={selectedTechId}
                  onChange={(e) => setSelectedTechId(e.target.value)}
                  className="apple-input"
                >
                  {technicians.length === 0 && (
                    <option value="">No technicians available</option>
                  )}
                  {technicians.map((tech) => (
                    <option key={tech.id} value={tech.id}>{tech.fullName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Field Resolution Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Enter equipment serials, line readings (dBm), or completion details..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  className="apple-input"
                />
              </div>

              {/* Status Transition Action Buttons */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Transition Status
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {selectedOrder.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(selectedOrder.id, 'ASSIGNED')}
                      className="btn-primary"
                    >
                      Dispatch & Assign
                    </button>
                  )}
                  {selectedOrder.status === 'ASSIGNED' && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(selectedOrder.id, 'IN_PROGRESS')}
                      className="btn-primary"
                    >
                      Start On-Site Work
                    </button>
                  )}
                  {(selectedOrder.status === 'IN_PROGRESS' || selectedOrder.status === 'ASSIGNED') && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(selectedOrder.id, 'COMPLETED')}
                      className="btn-primary"
                      style={{ backgroundColor: '#059669' }}
                    >
                      Complete & Sign Off
                    </button>
                  )}
                  {selectedOrder.status !== 'COMPLETED' && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(selectedOrder.id, 'CANCELLED')}
                      className="btn-danger"
                    >
                      Cancel Order
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Service Order Modal */}
      {isNewOrderModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(46, 41, 16, 0.72)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div className="glass-modal modal-animate-enter" style={{ width: '540px', maxHeight: '90vh', backgroundColor: '#FFFFFF', overflowY: 'auto', borderRadius: '12px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Create Service Order</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Dispatch field technician or schedule maintenance</span>
              </div>
              <button
                type="button"
                onClick={() => setIsNewOrderModalOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                title="Close dialog"
              >
                <IconX size={16} strokeWidth={2} />
              </button>
            </div>
            <form onSubmit={handleCreateOrder} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Subscriber Selector */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Subscriber Account *
                </label>
                <select
                  required
                  value={newOrder.subscriberId}
                  onChange={(e) => handleSubscriberChange(e.target.value)}
                  className="apple-input"
                >
                  <option value="">-- Select Subscriber --</option>
                  {subscribers.map((s) => (
                    <option key={s.id} value={s.id}>
                      [{s.accountNumber}] {s.firstName} {s.lastName} {s.businessName ? `(${s.businessName})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Service Account Selector */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Target Service Account *
                </label>
                {(() => {
                  const currentSub = subscribers.find((s) => s.id === newOrder.subscriberId);
                  const accounts = currentSub?.serviceAccounts || [];

                  if (!newOrder.subscriberId) {
                    return (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '6px' }}>
                        Please select a subscriber above to choose their service account.
                      </div>
                    );
                  }

                  if (accounts.length === 0) {
                    return (
                      <div style={{ fontSize: '12px', color: '#B91C1C', backgroundColor: '#FEF2F2', padding: '10px 12px', borderRadius: '6px', border: '1px solid #FCA5A5' }}>
                        This subscriber does not have any active service accounts provisioned yet. Please provision a service account under Billing &amp; Admin first.
                      </div>
                    );
                  }

                  return (
                    <select
                      required
                      value={newOrder.serviceAccountId}
                      onChange={(e) => setNewOrder({ ...newOrder, serviceAccountId: e.target.value })}
                      className="apple-input"
                    >
                      <option value="">-- Select Service Account --</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.accountNumber} • {acc.planName || acc.serviceType} ({acc.serviceType}) — [{acc.status}]
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>

              {/* Order Type & Priority Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Order Type
                  </label>
                  <select
                    value={newOrder.orderType}
                    onChange={(e) => handleOrderTypeChange(e.target.value)}
                    className="apple-input"
                  >
                    <option value="INSTALLATION">Installation</option>
                    <option value="REPAIR">Repair / Trouble</option>
                    <option value="DISCONNECTION">Disconnection</option>
                    <option value="RECONNECTION">Reconnection</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Priority
                  </label>
                  <select
                    value={newOrder.priority}
                    onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value })}
                    className="apple-input"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              {/* Assigned Tech & Scheduled Date Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Assigned Technician
                  </label>
                  <select
                    value={newOrder.assignedTechnicianId}
                    onChange={(e) => setNewOrder({ ...newOrder, assignedTechnicianId: e.target.value })}
                    className="apple-input"
                  >
                    <option value="">-- Unassigned (Pending) --</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.fullName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Scheduled Date
                  </label>
                  <input
                    type="date"
                    value={newOrder.scheduledDate}
                    onChange={(e) => setNewOrder({ ...newOrder, scheduledDate: e.target.value })}
                    className="apple-input"
                  >
                  </input>
                </div>
              </div>

              {/* Work Description */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Work Description &amp; Location Notes *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Fiber optical link red alarm. Replace drop cable from NAP 4 to subscriber premises."
                  value={newOrder.description}
                  onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                  className="apple-input"
                />
              </div>

              {/* Service Fee */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Service Fee (PHP)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newOrder.feeStr}
                  onChange={(e) => setNewOrder({ ...newOrder, feeStr: e.target.value })}
                  className="apple-input tabular-nums"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setIsNewOrderModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newOrder.serviceAccountId || !newOrder.description.trim()}
                  className="btn-primary"
                  style={{
                    opacity: !newOrder.serviceAccountId || !newOrder.description.trim() ? 0.6 : 1,
                    cursor: !newOrder.serviceAccountId || !newOrder.description.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  Dispatch Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
