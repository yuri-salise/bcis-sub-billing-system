import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PaymentMethod, InvoiceStatus } from '@bcis/shared-types';
import { formatCurrency } from '@bcis/domain';
import { SubscriberRecord, InvoiceRecord, PaymentReceipt } from '../api/types.js';
import { apiClient } from '../api/client.js';
import { PaymentModal } from '../components/PaymentModal.js';
import { ReceiptModal } from '../components/ReceiptModal.js';
import {
  IconSearch,
  IconCreditCard,
  IconMapPin,
  IconBanknote,
  IconSmartphone,
  IconBuilding,
  IconReceipt,
  IconCheckCircle,
} from '../components/icons/index.js';
import { Paginator } from '../components/Paginator.js';

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

  // Pagination for the invoices table
  const INVOICE_PAGE_SIZE = 8;
  const [invoicePage, setInvoicePage] = useState(1);

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

  // Only posted, legally payable invoices (UNPAID, PARTIALLY_PAID, OVERDUE) can receive cashier payments.
  // DRAFT invoices are unposted work-in-progress and strictly cannot receive payments.
  const payableInvoices = useMemo(() => {
    return invoices.filter(
      (inv) =>
        inv.status === InvoiceStatus.UNPAID ||
        inv.status === InvoiceStatus.PARTIALLY_PAID ||
        inv.status === InvoiceStatus.OVERDUE
    );
  }, [invoices]);

  const totalOutstandingCentavos = useMemo(() => {
    return payableInvoices.reduce((acc, inv) => acc + (inv.remainingBalanceCentavos ?? inv.totalDueCentavos ?? 0), 0);
  }, [payableInvoices]);

  // Reset invoice page when subscriber changes
  useEffect(() => {
    setInvoicePage(1);
  }, [selectedSubscriber?.id]);

  // Hotkey listener for '/' search focus and F1 payment modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept hotkeys while modals are open
      if (isPayModalOpen || isReceiptModalOpen) return;

      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        if (!isInput) {
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
  }, [selectedSubscriber, totalOutstandingCentavos, isPayModalOpen, isReceiptModalOpen]);

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

    // Refresh invoices and subscriber record immediately
    if (selectedSubscriber) {
      apiClient.listInvoices({ subscriberId: selectedSubscriber.id }).then((r) => setInvoices(r.data)).catch(() => {});
      apiClient.getSubscriber(selectedSubscriber.id).then((r) => setSelectedSubscriber(r.data)).catch(() => {});
      apiClient.listSubscribers().then((r) => setSubscribers(r.data)).catch(() => {});
    }
  };

  const totalShiftCentavos = shiftTotals.cashCentavos + shiftTotals.gcashCentavos + shiftTotals.bankCentavos + shiftTotals.checkCentavos;

  return (
    <div className="workspace-animate-enter" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>
      {/* Top Search & Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '560px' }}>
          <span style={{ position: 'absolute', left: '14px', top: '12px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
            <IconSearch size={16} strokeWidth={2} />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Fast Subscriber Search (Name, Account No., Phone) — Press '/' to focus"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="apple-input"
            style={{ paddingLeft: '40px', paddingRight: '40px', height: '40px', fontSize: '14px' }}
          />
          <kbd
            style={{
              position: 'absolute',
              right: '12px',
              top: '10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: 600,
            }}
          >
            /
          </kbd>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn-accent"
            disabled={!selectedSubscriber || totalOutstandingCentavos <= 0}
            onClick={() => setIsPayModalOpen(true)}
            style={{ height: '40px', padding: '0 22px', fontSize: '14px' }}
          >
            <IconCreditCard size={17} strokeWidth={2.2} />
            <span>Accept Payment (F1)</span>
          </button>
        </div>
      </div>

      {/* Main Split Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: '20px', flex: 1, minHeight: 0 }}>
        {/* Left Column: Search Results */}
        <div className="apple-card" style={{ display: 'flex', flexDirection: 'column', padding: '16px', gap: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                    padding: '11px 13px',
                    borderRadius: '9px',
                    border: isSelected ? '1.5px solid #2C5745' : '1px solid var(--border-subtle)',
                    borderLeft: isSelected ? '4px solid #2C5745' : '1px solid var(--border-subtle)',
                    backgroundColor: isSelected ? 'rgba(44, 87, 69, 0.08)' : '#FFFFFF',
                    textAlign: 'left',
                    width: '100%',
                    boxShadow: isSelected ? '0 2px 8px rgba(44, 87, 69, 0.15)' : 'var(--shadow-sm)',
                    transition: 'all 150ms var(--ease-out)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: isSelected ? '#2C5745' : 'var(--text-primary)' }}>
                      {sub.firstName} {sub.lastName}
                    </div>
                    <span className={`badge ${sub.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '10px' }}>
                      {sub.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }} className="font-mono">
                    {sub.accountNumber} {sub.phone ? `• ${sub.phone}` : sub.contactNumber ? `• ${sub.contactNumber}` : ''}
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
                      <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {selectedSubscriber.firstName} {selectedSubscriber.lastName}
                      </h2>
                      <span className="badge badge-parchment font-mono">{selectedSubscriber.accountNumber}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <IconMapPin size={13} strokeWidth={2} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      <span>
                        {[
                          selectedSubscriber.primaryAddress?.addressLine1 || selectedSubscriber.primaryAddress?.streetAddress,
                          selectedSubscriber.primaryAddress?.barangay,
                          selectedSubscriber.primaryAddress?.city || selectedSubscriber.primaryAddress?.municipality || 'Malaybalay',
                        ].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>
                      Outstanding Balance
                    </div>
                    <div
                      className="tabular-nums"
                      style={{
                        fontSize: '24px',
                        fontWeight: 800,
                        color: totalOutstandingCentavos > 0 ? '#DC2626' : '#2C5745',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {formatCurrency(totalOutstandingCentavos)}
                    </div>
                    {((selectedSubscriber.advanceCreditCentavos || selectedSubscriber.advancePaymentCentavos || 0) > 0) && (
                      <div style={{ fontSize: '11px', color: '#2C5745', marginTop: '2px', fontWeight: 700 }}>
                        Advance Credit: {formatCurrency(selectedSubscriber.advanceCreditCentavos || selectedSubscriber.advancePaymentCentavos || 0)}
                      </div>
                    )}
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
                          border: '1px solid var(--border-subtle)',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{acc.planName || 'Plan'}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                          ({acc.serviceType || 'INTERNET'}) — {formatCurrency(acc.monthlyFeeCentavos ?? (acc as any).currentRateCentavos ?? 0)}/mo
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Outstanding Invoices Table */}
              <div className="apple-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    Outstanding & Historical Invoices
                  </h4>
                  <span className="badge badge-neutral">{invoices.length} invoices found</span>
                </div>

                <div style={{ overflowX: 'auto', flex: 1 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-strong)', color: 'var(--text-muted)', textAlign: 'left' }}>
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
                        invoices
                          .slice((invoicePage - 1) * INVOICE_PAGE_SIZE, invoicePage * INVOICE_PAGE_SIZE)
                          .map((inv) => (
                          <tr key={inv.id} className="table-row-hover" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
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
                              {formatCurrency(inv.totalDueCentavos ?? 0)}
                            </td>
                            <td
                              style={{
                                padding: '10px 6px',
                                textAlign: 'right',
                                fontWeight: 700,
                                color: (inv.remainingBalanceCentavos || 0) > 0 ? '#DC2626' : '#2C5745',
                              }}
                              className="tabular-nums"
                            >
                              {formatCurrency(inv.remainingBalanceCentavos ?? 0)}
                            </td>
                            <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                              {inv.status === 'DRAFT' ? (
                                <span className="badge badge-neutral" title="Unposted Draft — Cannot receive payment until posted">
                                  DRAFT (Unposted)
                                </span>
                              ) : inv.status === 'VOID' ? (
                                <span className="badge badge-neutral" title="Invalidated / Voided Invoice">
                                  VOID
                                </span>
                              ) : inv.status === 'PAID' ? (
                                <span className="badge badge-success">PAID</span>
                              ) : inv.status === 'OVERDUE' ? (
                                <span className="badge badge-danger">OVERDUE</span>
                              ) : inv.status === 'PARTIALLY_PAID' ? (
                                <span className="badge badge-warning">PARTIAL</span>
                              ) : (
                                <span className="badge badge-danger">{inv.status}</span>
                              )}
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
                <Paginator
                  page={invoicePage}
                  totalPages={Math.ceil(invoices.length / INVOICE_PAGE_SIZE)}
                  totalItems={invoices.length}
                  pageSize={INVOICE_PAGE_SIZE}
                  onPageChange={setInvoicePage}
                />
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
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Shift Reconciliation</div>
              <span className="badge badge-success">Open Shift</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconBanknote size={14} strokeWidth={2} style={{ color: '#2C5745' }} />
                  <span>Cash in Drawer:</span>
                </span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.cashCentavos ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconSmartphone size={14} strokeWidth={2} style={{ color: '#EB7D00' }} />
                  <span>GCash Verified:</span>
                </span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.gcashCentavos ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconBuilding size={14} strokeWidth={2} style={{ color: '#4A442E' }} />
                  <span>Bank Transfers:</span>
                </span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.bankCentavos ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconReceipt size={14} strokeWidth={2} style={{ color: '#EB7D00' }} />
                  <span>Checks Received:</span>
                </span>
                <span className="tabular-nums font-semibold">{formatCurrency(shiftTotals.checkCentavos ?? 0)}</span>
              </div>

              <div
                style={{
                  borderTop: '1px dashed var(--border-strong)',
                  paddingTop: '8px',
                  marginTop: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 700,
                  fontSize: '14px',
                }}
              >
                <span>Total Collected:</span>
                <span className="tabular-nums" style={{ color: '#2C5745', fontWeight: 800 }}>
                  {formatCurrency(totalShiftCentavos ?? 0)}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'right' }}>
                {shiftTotals.txCount} payments processed
              </div>
            </div>
          </div>

          {/* Quick Receipt Preview trigger */}
          {lastReceipt && (
            <div className="apple-card" style={{ padding: '16px', backgroundColor: 'var(--success-bg)', border: '1px solid var(--success-border)' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--pine)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconCheckCircle size={14} strokeWidth={2} />
                <span>Last Transaction Receipt Ready</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--pine)' }} className="font-mono">
                {lastReceipt.receiptNumber} ({formatCurrency(lastReceipt.totalAmountCentavos ?? 0)})
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

      {/* Payment Modal (Strictly payable invoices only) */}
      {isPayModalOpen && selectedSubscriber && (
        <PaymentModal
          subscriber={selectedSubscriber}
          invoices={payableInvoices}
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
