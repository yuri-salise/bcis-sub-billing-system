import React, { useState, useEffect } from 'react';
import { formatCurrency } from '@bcis/domain';
import { PaymentReceipt } from '../api/types.js';
import { useConfig } from '../state/ConfigContext.js';
import { IconX, IconPrinter, IconCheck } from './icons/index.js';

interface ReceiptModalProps {
  receipt: PaymentReceipt;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ receipt, onClose }) => {
  const { printerConfig, updatePrinterConfig } = useConfig();
  const [printPaperType, setPrintPaperType] = useState<'80mm' | '58mm'>(printerConfig.type || '80mm');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      if (typeof window !== 'undefined' && window.api) {
        await window.api.hardware.printReceipt({
          ...receipt,
          printerType: printPaperType,
        });
      }
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 2500);
    } catch {
      alert('Thermal printer offline or communication error.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Calculate 12% VAT breakdown
  const totalPaidCentavos = receipt.totalAmountCentavos;
  const vatableSalesCentavos = Math.round(totalPaidCentavos / 1.12);
  const vatAmountCentavos = totalPaidCentavos - vatableSalesCentavos;

  return (
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
        style={{
          width: '560px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>Official Receipt Preview</span>
            <span className="badge badge-success">BIR Standard</span>
          </div>

          {/* Paper Width Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', borderRadius: '6px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setPrintPaperType('80mm')}
                style={{
                  padding: '5px 9px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: 'none',
                  backgroundColor: printPaperType === '80mm' ? '#2C5745' : 'var(--bg-subtle)',
                  color: printPaperType === '80mm' ? '#FFFFFF' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 140ms ease',
                }}
              >
                80mm POS
              </button>
              <button
                type="button"
                onClick={() => setPrintPaperType('58mm')}
                style={{
                  padding: '5px 9px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: 'none',
                  backgroundColor: printPaperType === '58mm' ? '#2C5745' : 'var(--bg-subtle)',
                  color: printPaperType === '58mm' ? '#FFFFFF' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 140ms ease',
                }}
              >
                58mm Mini
              </button>
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
              title="Close receipt preview"
            >
              <IconX size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Scrollable Receipt Canvas */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div
            className={`thermal-receipt ${printPaperType === '80mm' ? 'thermal-80mm' : 'thermal-58mm'}`}
            style={{ width: '100%' }}
          >
            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #000000', paddingBottom: '10px', marginBottom: '10px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '14px' }}>BUKIDNON CABLE & INTERNET SERVICES</div>
              <div>Fortich Street, Poblacion, Malaybalay City</div>
              <div>Bukidnon, Philippines 8700</div>
              <div>VAT Reg. TIN: 123-456-789-00000</div>
              <div style={{ marginTop: '6px', fontWeight: 'bold', fontSize: '13px' }}>OFFICIAL RECEIPT</div>
              <div style={{ fontWeight: 'bold' }}>{receipt.receiptNumber}</div>
            </div>

            {/* Metadata */}
            <div style={{ fontSize: '11px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Date & Time:</span>
                <span>{receipt.date || new Date().toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Cashier:</span>
                <span>{receipt.cashierName || 'Counter Teller'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Terminal:</span>
                <span>{printerConfig.stationId}</span>
              </div>
            </div>

            {/* Subscriber */}
            <div style={{ borderTop: '1px dashed #000000', paddingTop: '8px', marginBottom: '8px', fontSize: '11px' }}>
              <div><strong>Subscriber:</strong> {receipt.subscriberName}</div>
              <div><strong>Account No:</strong> {receipt.subscriberAccountNumber}</div>
              {receipt.address && <div><strong>Address:</strong> {receipt.address}</div>}
            </div>

            {/* Line Items */}
            <div style={{ borderTop: '1px dashed #000000', borderBottom: '1px dashed #000000', padding: '8px 0', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: '4px' }}>
                <span>Item / Particulars</span>
                <span>Amount</span>
              </div>
              {receipt.allocations && receipt.allocations.length > 0 ? (
                receipt.allocations.map((a, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                    <span>{a.invoiceNumber} {a.description || 'Monthly Service'}</span>
                    <span className="tabular-nums">{formatCurrency(a.allocatedCentavos ?? 0)}</span>
                  </div>
                ))
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>Subscription Payment</span>
                  <span className="tabular-nums">{formatCurrency(receipt.totalAmountCentavos ?? 0)}</span>
                </div>
              )}

              {receipt.advanceCreditCentavos && receipt.advanceCreditCentavos > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#059669' }}>
                  <span>Advance Credit Applied</span>
                  <span className="tabular-nums">+{formatCurrency(receipt.advanceCreditCentavos ?? 0)}</span>
                </div>
              )}
            </div>

            {/* Financial Summary */}
            <div style={{ fontSize: '11px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }}>
                <span>TOTAL AMOUNT PAID:</span>
                <span className="tabular-nums">{formatCurrency(receipt.totalAmountCentavos ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Payment Method:</span>
                <span>{receipt.paymentMethod}</span>
              </div>
              {receipt.referenceNumber && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Reference No:</span>
                  <span>{receipt.referenceNumber}</span>
                </div>
              )}
              {receipt.tenderedCentavos !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Amount Tendered:</span>
                  <span className="tabular-nums">{formatCurrency(receipt.tenderedCentavos ?? 0)}</span>
                </div>
              )}
              {receipt.changeCentavos !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                  <span>Change:</span>
                  <span className="tabular-nums">{formatCurrency(receipt.changeCentavos ?? 0)}</span>
                </div>
              )}
            </div>

            {/* Tax Details */}
            <div style={{ borderTop: '1px dashed #000000', paddingTop: '6px', fontSize: '10px', color: '#333' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>VATable Sales (12%):</span>
                <span className="tabular-nums">{formatCurrency(vatableSalesCentavos ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>VAT Amount (12%):</span>
                <span className="tabular-nums">{formatCurrency(vatAmountCentavos ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>VAT-Exempt Sales:</span>
                <span className="tabular-nums">₱0.00</span>
              </div>
            </div>

            {/* Footer */}
            <div style={{ borderTop: '1px dashed #000000', paddingTop: '10px', marginTop: '10px', textAlign: 'center', fontSize: '10px' }}>
              <div>THIS SERVES AS AN OFFICIAL RECEIPT</div>
              <div>Thank you for choosing BCIS!</div>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
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
          <div>
            {printSuccess && (
              <span style={{ fontSize: '13px', color: '#059669', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconCheck size={14} strokeWidth={2} />
                <span>Printed to thermal receipt printer</span>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={onClose} className="btn-secondary">
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <IconPrinter size={15} strokeWidth={2} />
              <span>{isPrinting ? 'Printing...' : 'Print Official Receipt'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
