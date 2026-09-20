import React, { useState, useEffect } from 'react';
import { formatCurrency, parseCurrencyToCentavos } from '@bcis/domain';
import { ServiceOrderRecord } from '../api/types.js';
import { apiClient } from '../api/client.js';
import { IconPlus, IconX } from '../components/icons/index.js';

export const ServiceOrdersWorkspace: React.FC = () => {
  const [orders, setOrders] = useState<ServiceOrderRecord[]>([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrderRecord | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState<boolean>(false);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [assignedTechName, setAssignedTechName] = useState<string>('Tech Noel');

  const [newOrder, setNewOrder] = useState({
    orderType: 'INSTALLATION',
    priority: 'NORMAL',
    subscriberId: 'sub-001',
    serviceAccountId: 'acc-001',
    description: '',
    feeStr: '1500.00',
  });

  const loadOrders = async () => {
    try {
      const res = await apiClient.listServiceOrders();
      setOrders(res.data);
    } catch {}
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleStatusChange = async (orderId: string, nextStatus: string) => {
    try {
      await apiClient.updateServiceOrderStatus(orderId, nextStatus, resolutionNotes || undefined);
      setIsDetailModalOpen(false);
      loadOrders();
    } catch (err: any) {
      alert(`Error updating order: ${err.message}`);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.createServiceOrder({
        orderType: newOrder.orderType,
        priority: newOrder.priority,
        subscriberId: newOrder.subscriberId,
        serviceAccountId: newOrder.serviceAccountId,
        description: newOrder.description,
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
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>
      {/* Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Field Service Orders & Technician Queue</h2>
          <div style={{ display: 'flex', gap: '6px' }}>
            {['ALL', 'INSTALLATION', 'REPAIR', 'DISCONNECTION', 'RECONNECTION'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedTypeFilter(type)}
                className="pressable"
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: selectedTypeFilter === type ? 600 : 400,
                  border: selectedTypeFilter === type ? '1px solid #0071E3' : '1px solid var(--border-subtle)',
                  backgroundColor: selectedTypeFilter === type ? '#EFF6FF' : '#FFFFFF',
                  color: selectedTypeFilter === type ? '#0071E3' : 'var(--text-secondary)',
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsNewOrderModalOpen(true)}
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
                backgroundColor: '#F1F5F9',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                border: '1px solid rgba(0, 0, 0, 0.05)',
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
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(8px)',
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
                  value={assignedTechName}
                  onChange={(e) => setAssignedTechName(e.target.value)}
                  className="apple-input"
                >
                  <option value="Tech Noel">Tech Noel (Lineman - North)</option>
                  <option value="Tech Mark">Tech Mark (Fiber Splicer)</option>
                  <option value="Tech Dennis">Tech Dennis (Installer)</option>
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
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(8px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div className="glass-modal modal-animate-enter" style={{ width: '480px', backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Create Service Order</h3>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Order Type
                  </label>
                  <select
                    value={newOrder.orderType}
                    onChange={(e) => setNewOrder({ ...newOrder, orderType: e.target.value })}
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

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Work Description & Location Notes
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

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Service Fee (PHP)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newOrder.feeStr}
                  onChange={(e) => setNewOrder({ ...newOrder, feeStr: e.target.value })}
                  className="apple-input tabular-nums"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setIsNewOrderModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
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
