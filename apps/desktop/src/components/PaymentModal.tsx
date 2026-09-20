import React, { useState, useMemo } from 'react';
import { PaymentMethod, InvoiceStatus } from '@bcis/shared-types';
import { formatCurrency, parseCurrencyToCentavos, allocatePaymentFIFO } from '@bcis/domain';
import { SubscriberRecord, InvoiceRecord, PaymentReceipt } from '../api/types.js';
import { apiClient } from '../api/client.js';
import { useAuth } from '../state/AuthContext.js';
import {
  IconX,
  IconBanknote,
  IconSmartphone,
  IconBuilding,
  IconReceipt,
  IconAlertTriangle,
} from './icons/index.js';

interface PaymentModalProps {
  subscriber: SubscriberRecord;
  invoices: InvoiceRecord[];
  onClose: () => void;
  onPaymentSuccess: (receipt: PaymentReceipt) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  subscriber,
  invoices,
  onClose,
  onPaymentSuccess,
}) => {
  const { user } = useAuth();

  // Filter for strictly payable invoices (UNPAID, PARTIALLY_PAID, OVERDUE)
  // DRAFT invoices are unposted work-in-progress and VOID invoices are invalidated.
  const payableInvoices = useMemo(() => {
    return invoices.filter(
      (inv) =>
        inv.status === InvoiceStatus.UNPAID ||
        inv.status === InvoiceStatus.PARTIALLY_PAID ||
        inv.status === InvoiceStatus.OVERDUE
    );
  }, [invoices]);

  const hasDraftInvoices = useMemo(() => {
    return invoices.some((inv) => inv.status === InvoiceStatus.DRAFT);
  }, [invoices]);

  // Outstanding total due from strictly payable invoices
  const totalBalanceCentavos = useMemo(() => {
    return payableInvoices.reduce((acc, inv) => acc + inv.remainingBalanceCentavos, 0);
  }, [payableInvoices]);

  const defaultPayAmountPesos = (totalBalanceCentavos / 100).toFixed(2);
  const [paymentAmountStr, setPaymentAmountStr] = useState<string>(defaultPayAmountPesos);
  const [tenderMethod, setTenderMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [tenderedStr, setTenderedStr] = useState<string>(defaultPayAmountPesos);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Convert input amounts to integer centavos safely
  const paymentAmountCentavos = useMemo(() => {
    try {
      return parseCurrencyToCentavos(paymentAmountStr || '0');
    } catch {
      return 0;
    }
  }, [paymentAmountStr]);

  const tenderedCentavos = useMemo(() => {
    try {
      return parseCurrencyToCentavos(tenderedStr || '0');
    } catch {
      return 0;
    }
  }, [tenderedStr]);

  // Instant Change Calculator
  const changeCentavos = useMemo(() => {
    if (tenderMethod !== PaymentMethod.CASH) return 0;
    return tenderedCentavos - paymentAmountCentavos;
  }, [tenderMethod, tenderedCentavos, paymentAmountCentavos]);

  // Real-time FIFO Allocation Preview using domain function!
  const allocationPlan = useMemo(() => {
    if (paymentAmountCentavos <= 0) return null;

    const allocatableInvoices = payableInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      dueDate: inv.dueDate,
      createdAt: inv.issueDate || new Date().toISOString(),
      status: inv.status,
      totalDueCentavos: inv.totalDueCentavos,
      allocatedCentavos: inv.totalDueCentavos - inv.remainingBalanceCentavos,
      remainingBalanceCentavos: inv.remainingBalanceCentavos,
    }));

    try {
      return allocatePaymentFIFO(paymentAmountCentavos, allocatableInvoices);
    } catch {
      return null;
    }
  }, [paymentAmountCentavos, payableInvoices]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentAmountCentavos <= 0) {
      setErrorMessage('Please enter a valid payment amount greater than ₱0.00');
      return;
    }

    if (tenderMethod === PaymentMethod.CASH && changeCentavos < 0) {
      setErrorMessage('Cash tendered cannot be less than the payment amount.');
      return;
    }

    if (
      (tenderMethod === PaymentMethod.GCASH ||
        tenderMethod === PaymentMethod.BANK_TRANSFER ||
        tenderMethod === PaymentMethod.CHECK) &&
      !referenceNumber.trim()
    ) {
      setErrorMessage(`Reference / Transaction number is required for ${tenderMethod}`);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await apiClient.postPayment({
        subscriberId: subscriber.id,
        amountCentavos: paymentAmountCentavos,
        paymentMethod: tenderMethod,
        referenceNumber: referenceNumber.trim() || null,
        notes: notes.trim() || null,
      });

      // Prepare receipt record for instant print preview
      const receipt: PaymentReceipt = {
        receiptNumber: response?.data?.receiptNumber || `OR-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`,
        paymentId: response?.data?.id || 'pay-local',
        date: new Date().toLocaleString(),
        subscriberName: `${subscriber.firstName} ${subscriber.lastName}`,
        subscriberAccountNumber: subscriber.accountNumber,
        address: subscriber.primaryAddress ? `${subscriber.primaryAddress.barangay}, ${subscriber.primaryAddress.city}` : undefined,
        cashierName: user?.fullName || 'Teller Counter 1',
        paymentMethod: tenderMethod,
        totalAmountCentavos: paymentAmountCentavos,
        tenderedCentavos: tenderMethod === PaymentMethod.CASH ? tenderedCentavos : paymentAmountCentavos,
        changeCentavos: tenderMethod === PaymentMethod.CASH ? Math.max(0, changeCentavos) : 0,
        referenceNumber: referenceNumber.trim() || null,
        allocations: allocationPlan?.allocations.map((a) => ({
          invoiceNumber: a.invoiceNumber,
          allocatedCentavos: a.allocatedAmountCentavos,
          description: 'Monthly Subscription Plan',
        })) || [],
        advanceCreditCentavos: allocationPlan?.advanceCreditCentavos || 0,
      };

      onPaymentSuccess(receipt);
    } catch (err: any) {
      setErrorMessage(err.message || 'Payment failed to post. Check network or server status.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
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
        style={{
          width: '640px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Accept Payment</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {subscriber.firstName} {subscriber.lastName} • <span className="font-mono">{subscriber.accountNumber}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
            }}
            title="Close modal"
          >
            <IconX size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Total Due Banner */}
            <div
              style={{
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '8px',
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <span style={{ fontSize: '12px', color: '#1E40AF', fontWeight: 500 }}>Total Current Due:</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#1E3A8A' }} className="tabular-nums">
                  {formatCurrency(totalBalanceCentavos)}
                </div>
              </div>
              {totalBalanceCentavos > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setPaymentAmountStr((totalBalanceCentavos / 100).toFixed(2));
                    setTenderedStr((totalBalanceCentavos / 100).toFixed(2));
                  }}
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                >
                  Pay Exact Total
                </button>
              )}
            </div>

            {/* Unposted Draft Invoices Alert */}
            {hasDraftInvoices && (
              <div
                style={{
                  backgroundColor: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '12px',
                  color: '#92400E',
                }}
              >
                <IconAlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0, color: '#D97706' }} />
                <span>
                  <strong>Unposted Drafts Excluded:</strong> Invoices in DRAFT status are unposted and cannot receive payment until finalized by billing.
                </span>
              </div>
            )}

            {/* Zero Balance Info */}
            {payableInvoices.length === 0 && (
              <div
                style={{
                  backgroundColor: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '12px',
                  color: '#166534',
                }}
              >
                <strong>No posted receivables due.</strong> Any payment accepted will be credited as <strong>Advance Credit</strong> on this subscriber's account.
              </div>
            )}

            {/* Tender Method Selector */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Payment Tender Method
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {[
                  { id: PaymentMethod.CASH, label: 'Cash', icon: <IconBanknote size={15} strokeWidth={2} /> },
                  { id: PaymentMethod.GCASH, label: 'GCash', icon: <IconSmartphone size={15} strokeWidth={2} /> },
                  { id: PaymentMethod.BANK_TRANSFER, label: 'Bank Transfer', icon: <IconBuilding size={15} strokeWidth={2} /> },
                  { id: PaymentMethod.CHECK, label: 'Check', icon: <IconReceipt size={15} strokeWidth={2} /> },
                ].map((m) => {
                  const isSelected = tenderMethod === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setTenderMethod(m.id)}
                      className="pressable"
                      style={{
                        padding: '10px 6px',
                        borderRadius: '6px',
                        border: isSelected ? '2px solid #0071E3' : '1px solid var(--border-subtle)',
                        backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                        color: isSelected ? '#0071E3' : 'var(--text-primary)',
                        fontWeight: isSelected ? 600 : 400,
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      {m.icon}
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment & Tendered Amounts Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Payment Amount (PHP)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '10px', top: '9px', fontSize: '14px', color: 'var(--text-muted)' }}>₱</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={paymentAmountStr}
                    onChange={(e) => setPaymentAmountStr(e.target.value)}
                    className="apple-input tabular-nums"
                    style={{ paddingLeft: '24px', fontSize: '15px', fontWeight: 600 }}
                  />
                </div>
              </div>

              {tenderMethod === PaymentMethod.CASH ? (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Cash Tendered (PHP)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '9px', fontSize: '14px', color: 'var(--text-muted)' }}>₱</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tenderedStr}
                      onChange={(e) => setTenderedStr(e.target.value)}
                      className="apple-input tabular-nums"
                      style={{ paddingLeft: '24px', fontSize: '15px', fontWeight: 600 }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Reference / Ref No.
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 9021-348-1294"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="apple-input font-mono"
                    style={{ fontSize: '13px' }}
                  />
                </div>
              )}
            </div>

            {/* Instant Change Calculator for Cash */}
            {tenderMethod === PaymentMethod.CASH && (
              <div
                style={{
                  backgroundColor: changeCentavos >= 0 ? '#ECFDF5' : '#FFF1F2',
                  border: changeCentavos >= 0 ? '1px solid #A7F3D0' : '1px solid #FECDD3',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', color: changeCentavos >= 0 ? '#065F46' : '#9F1239', fontWeight: 500 }}>
                    {changeCentavos >= 0 ? 'Change to Return to Customer:' : 'Shortage / Underpaid Amount:'}
                  </span>
                </div>
                <div
                  className="tabular-nums"
                  style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: changeCentavos >= 0 ? '#059669' : '#E11D48',
                  }}
                >
                  {formatCurrency(Math.abs(changeCentavos))}
                </div>
              </div>
            )}

            {/* FIFO Invoice Allocation Preview */}
            {allocationPlan && (
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px', backgroundColor: '#F8FAFC' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>FIFO Allocation Plan Preview (Oldest Invoices First)</span>
                  <span className="badge badge-primary">Automatic</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {allocationPlan.allocations.map((a) => (
                    <div
                      key={a.invoiceId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '11px',
                        padding: '4px 8px',
                        backgroundColor: '#FFFFFF',
                        borderRadius: '4px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div>
                        <span className="font-mono" style={{ fontWeight: 600 }}>{a.invoiceNumber}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                          Prev: {formatCurrency(a.previousBalanceCentavos)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#059669', fontWeight: 600 }} className="tabular-nums">
                          +{formatCurrency(a.allocatedAmountCentavos)}
                        </span>
                        <span
                          className={`badge ${
                            a.newStatus === InvoiceStatus.PAID ? 'badge-success' : 'badge-warning'
                          }`}
                        >
                          {a.newStatus}
                        </span>
                      </div>
                    </div>
                  ))}

                  {allocationPlan.advanceCreditCentavos > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        padding: '4px 8px',
                        backgroundColor: '#ECFDF5',
                        borderRadius: '4px',
                        border: '1px solid #A7F3D0',
                        color: '#065F46',
                      }}
                    >
                      <span>Excess Stored as Advance Credit:</span>
                      <span className="tabular-nums" style={{ fontWeight: 600 }}>
                        +{formatCurrency(allocationPlan.advanceCreditCentavos)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Payment Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Counter deposit, verified by cashier"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="apple-input"
              />
            </div>

            {errorMessage && (
              <div style={{ fontSize: '12px', color: '#E11D48', padding: '8px', backgroundColor: '#FFF1F2', borderRadius: '6px' }}>
                {errorMessage}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div
            style={{
              padding: '16px 20px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#FFFFFF',
            }}
          >
            <button type="button" onClick={onClose} className="btn-secondary" disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting || paymentAmountCentavos <= 0 || (tenderMethod === PaymentMethod.CASH && changeCentavos < 0)}
              style={{ minWidth: '160px' }}
            >
              {isSubmitting ? 'Posting Payment...' : `Post ${formatCurrency(paymentAmountCentavos)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
