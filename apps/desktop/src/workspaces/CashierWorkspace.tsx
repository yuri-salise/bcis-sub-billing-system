import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PaymentMethod } from '@bcis/shared-types';
import { formatCurrency } from '@bcis/domain';
import { SubscriberRecord, InvoiceRecord, PaymentReceipt } from '../api/types.js';
import { apiClient } from '../api/client.js';
import { PaymentModal } from '../components/PaymentModal.js';
import { ReceiptModal } from '../components/ReceiptModal.js';

export const CashierWorkspace: React.FC = () => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [subscribers, setSubscribers] = useState<SubscriberRecord[]>([]);
  const [selectedSubscriber, setSelectedSubscriber] = useState<SubscriberRecord | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals state
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PaymentReceipt | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);

  // Shift collection totals (simulated / fetched)
  const [shiftTotals, setShiftTotals] = useState({
    cashCentavos: 1450000,
    gcashCentavos: 999000,
    bankCentavos: 500000,
    checkCentavos: 0,
    txCount: 14,
  });

  // Fetch subscribers on search query
  useEffect(() => {
    const fetchSubscribers = async () => {
      setIsLoading(true);
      try {
        const res = await apiClient.listSubscribers({ search: searchQuery.trim() || undefined, limit: 10 });
        setSubscribers(res.data);
        if (res.data.length > 0 && !selectedSubscriber) {
          setSelectedSubscriber(res.data[0]);
        }
      } catch {
        // Handled gracefully in client
      } finally {
        setIsLoading(false);
      }
    };

    const timer = setTimeout(fetchSubscribers, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch invoices for selected subscriber
  useEffect(() => {
    if (!selectedSubscriber) {
      setInvoices([]);
      return;
    }

    const fetchInvoices = async () => {
      try {
        const res = await apiClient.listInvoices({ subscriberId: selectedSubscriber.id });
        setInvoices(res.data);
      } catch {
        setInvoices([]);
      }
    };

    fetchInvoices();
  }, [selectedSubscriber]);

  const totalOutstandingCentavos = useMemo(() => {
    return invoices.reduce((acc, inv) => acc + inv.remainingBalanceCentavos, 0);
  }, [invoices]);

  // Hotkey listener for '/' search focus and F1 payment modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
      if (e.key === 'F1') {
        if (selectedSubscriber && totalOutstandingCentavos > 0) {
          e.preventDefault();
          setIsPayModalOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSubscriber, totalOutstandingCentavos]);

  const handlePaymentCompleted = (receipt: PaymentReceipt) => {
    setIsPayModalOpen(false);
    setLastReceipt(receipt);
    setIsReceiptModalOpen(true);

    // Update shift totals
    setShiftTotals((prev) => {
      const centavos = receipt.totalAmountCentavos;
      return {
        ...prev,
        cashCentavos: receipt.paymentMethod === PaymentMethod.CASH ? prev.cashCentavos + centavos : prev.cashCentavos,
        gcashCentavos: receipt.paymentMethod === PaymentMethod.GCASH ? prev.gcashCentavos + centavos : prev.gcashCentavos,
        bankCentavos: receipt.paymentMethod === PaymentMethod.BANK_TRANSFER ? prev.bankCentavos + centavos : prev.bankCentavos,
        checkCentavos: receipt.paymentMethod === PaymentMethod.CHECK ? prev.checkCentavos + centavos : prev.checkCentavos,
        txCount: prev.txCount + 1,
      };
    });

    // Refresh invoices
    if (selectedSubscriber) {
      apiClient.listInvoices({ subscriberId: selectedSubscriber.id }).then((r) => setInvoices(r.data)).catch(() => {});
    }
  };

  const totalShiftCentavos = shiftTotals.cashCentavos + shiftTotals.gcashCentavos + shiftTotals.bankCentavos + shiftTotals.checkCentavos;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>
      {/* Top Search & Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '540px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-tertiary)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Fast Subscriber Search (Name, Account No., Phone) — Press '/' to focus"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="apple-input"
            style={{ paddingLeft: '36px', height: '38px', fontSize: '14px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn-primary"
            disabled={!selectedSubscriber || totalOutstandingCentavos <= 0}
            onClick={() => setIsPayModalOpen(true)}
            style={{ height: '38px', padding: '0 20px', fontSize: '14px' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
            <span>Accept Payment (F1)</span>
          </button>
        </div>
      </div>

      {/* Main Split Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: '20px', flex: 1, minHeight: 0 }}>
        {/* Left Column: Search Results */}
        <div className="apple-card" style={{ display: 'flex', flexDirection: 'column', padding: '16px', gap: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Subscribers List ({subscribers.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {subscribers.map((sub) => {
              const isSelected = selectedSubscriber?.id === sub.id;
              return (
                <button
                  key={sub.id}
                  onClick={() => setSelectedSubscriber(sub)}
                  className="pressable"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: isSelected ? '1px solid #0071E3' : '1px solid var(--border-subtle)',
                    backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                    textAlign: 'left',
                    width: '100%',
                    boxShadow: isSelected ? '0 1px 3px rgba(0, 113, 227, 0.15)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: isSelected ? '#0071E3' : 'var(--text-primary)' }}>
                      {sub.firstName} {sub.lastName}
                    </div>
                    <span className={`badge ${sub.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '10px' }}>
                      {sub.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }} className="font-mono">
                    {sub.accountNumber} • {sub.phone}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    {sub.primaryAddress?.barangay || 'Malaybalay'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Column: Subscriber Detail & Invoices */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {selectedSubscriber ? (
            <>
              {/* Subscriber Overview Header */}
              <div className="apple-card" style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ fontSize: '18px', fontWeight: 600 }}>
                        {selectedSubscriber.firstName} {selectedSubscriber.lastName}
                      </h2>
                      <span className="badge badge-primary font-mono">{selectedSubscriber.accountNumber}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      📍 {selectedSubscriber.primaryAddress?.addressLine1}, {selectedSubscriber.primaryAddress?.barangay}, {selectedSubscriber.primaryAddress?.city}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                      Outstanding Balance
                    </div>
                    <div
                      className="tabular-nums"
                      style={{
                        fontSize: '22px',
                        fontWeight: 700,
                        color: totalOutstandingCentavos > 0 ? '#E11D48' : '#059669',
                      }}
                    >
                      {formatCurrency(totalOutstandingCentavos)}
                    </div>
                  </div>
                </div>

                {/* Service Accounts */}
                {selectedSubscriber.serviceAccounts && selectedSubscriber.serviceAccounts.length > 0 && (
                  <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '12px' }}>
                    {selectedSubscriber.serviceAccounts.map((acc) => (
                      <div
                        key={acc.id}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--bg-subtle)',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{acc.planName || 'Plan'}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                          ({acc.serviceType}) — {formatCurrency(acc.monthlyFeeCentavos)}/mo
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Outstanding Invoices Table */}
              <div className="apple-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Outstanding & Historical Invoices
                  </h4>
                  <span className="badge badge-neutral">{invoices.length} invoices found</span>
                </div>

                <div style={{ overflowX: 'auto', flex: 1 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 6px' }}>Invoice No.</th>
                        <th style={{ padding: '8px 6px' }}>Billing Period</th>
                        <th style={{ padding: '8px 6px' }}>Due Date</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Total Due</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Remaining Balance</th>
                        <th style={{ padding: '8px 6px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.length > 0 ? (
                        invoices.map((inv) => (
                          <tr key={inv.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '10px 6px' }} className="font-mono font-semibold">
                              {inv.invoiceNumber}
                            </td>
                            <td style={{ padding: '10px 6px', color: 'var(--text-secondary)' }}>
                              {inv.billingPeriodStart} to {inv.billingPeriodEnd}
                            </td>
                            <td style={{ padding: '10px 6px', color: 'var(--text-secondary)' }}>
                              {inv.dueDate}
                            </td>
                            <td style={{ padding: '10px 6px', textAlign: 'right' }} className="tabular-nums">
                              {formatCurrency(inv.totalDueCentavos)}
                            </td>
                            <td
                              style={{
                                padding: '10px 6px',
                                textAlign: 'right',
                                fontWeight: 600,
                                color: inv.remainingBalanceCentavos > 0 ? '#E11D48' : '#059669',
                              }}
                              className="tabular-nums"
                            >
                              {formatCurrency(inv.remainingBalanceCentavos)}
                            </td>
                            <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                              <span className={`badge ${inv.status === 'PAID' ? 'badge-success' : 'badge-danger'}`}>
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                            No unpaid invoices found for this subscriber.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="apple-card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Select a subscriber from the list to view balances and take payments.
            </div>
          )}
        </div>

        {/* Right Column: Shift Reconciliation & Recent OR */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Shift Reconciliation Card */}
          <div className="apple-card" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Shift Reconciliation</div>
              <span className="badge badge-success">Open Shift</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>💵 Cash in Drawer:</span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.cashCentavos)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>📱 GCash Verified:</span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.gcashCentavos)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>🏦 Bank Transfers:</span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.bankCentavos)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>🧾 Checks Received:</span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.checkCentavos)}</span>
              </div>

              <div
                style={{
                  borderTop: '1px dashed var(--border-subtle)',
                  paddingTop: '8px',
                  marginTop: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 700,
                  fontSize: '14px',
                }}
              >
                <span>Total Collected:</span>
                <span className="tabular-nums" style={{ color: '#059669' }}>
                  {formatCurrency(totalShiftCentavos)}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'right' }}>
                {shiftTotals.txCount} payments processed
              </div>
            </div>
          </div>

          {/* Quick Receipt Preview trigger */}
          {lastReceipt && (
            <div className="apple-card" style={{ padding: '16px', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#065F46', marginBottom: '6px' }}>
                ✓ Last Transaction Receipt Ready
              </div>
              <div style={{ fontSize: '12px', color: '#047857' }} className="font-mono">
                {lastReceipt.receiptNumber} ({formatCurrency(lastReceipt.totalAmountCentavos)})
              </div>
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(true)}
                className="btn-secondary"
                style={{ width: '100%', marginTop: '10px', fontSize: '12px' }}
              >
                Reprint / View Receipt
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Payment Modal */}
      {isPayModalOpen && selectedSubscriber && (
        <PaymentModal
          subscriber={selectedSubscriber}
          invoices={invoices}
          onClose={() => setIsPayModalOpen(false)}
          onPaymentSuccess={handlePaymentCompleted}
        />
      )}

      {/* Receipt Modal */}
      {isReceiptModalOpen && lastReceipt && (
        <ReceiptModal receipt={lastReceipt} onClose={() => setIsReceiptModalOpen(false)} />
      )}
    </div>
  );
};
