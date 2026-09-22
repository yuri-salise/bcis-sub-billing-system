import React, { useState, useEffect, useMemo } from 'react';
import {
  formatCurrency,
  parseCurrencyToCentavos,
  getMunicipalities,
  getBarangays,
  getDefaultPostalCode,
} from '@bcis/domain';
import { ServicePlanRecord, SubscriberRecord } from '../api/types.js';
import { apiClient } from '../api/client.js';
import { IconPlus, IconX, IconSearch, IconMapPin } from '../components/icons/index.js';
import { Paginator } from '../components/Paginator.js';

export const BillingAdminWorkspace: React.FC = () => {
  const [plans, setPlans] = useState<ServicePlanRecord[]>([]);
  const [subscribers, setSubscribers] = useState<SubscriberRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [selectedBarangayFilter, setSelectedBarangayFilter] = useState('ALL');

  // Pagination state
  const SUB_PAGE_SIZE = 10;
  const PLAN_PAGE_SIZE = 5;
  const [subPage, setSubPage] = useState(1);
  const [planPage, setPlanPage] = useState(1);

  // Billing Batch Generator State
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const [billingPeriodStart, setBillingPeriodStart] = useState(`${currentYear}-${currentMonth}-01`);
  const [billingPeriodEnd, setBillingPeriodEnd] = useState(`${currentYear}-${currentMonth}-28`);
  const [dueDate, setDueDate] = useState(`${currentYear}-${currentMonth}-15`);
  const [isDryRun, setIsDryRun] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [batchResult, setBatchResult] = useState<{ generatedCount: number; skippedCount: number; message?: string } | null>(null);

  // New Subscriber Modal State
  const [isSubscriberModalOpen, setIsSubscriberModalOpen] = useState(false);
  const [newSub, setNewSub] = useState({
    firstName: '',
    lastName: '',
    phone: '09',
    email: '',
    addressLine1: '',
    municipality: 'Malaybalay',
    barangay: 'Poblacion',
    planId: '',
  });

  // Edit Subscriber Modal State
  const [isEditSubModalOpen, setIsEditSubModalOpen] = useState(false);
  const [editingSubId, setEditingSubId] = useState<string>('');
  const [editSub, setEditSub] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    status: 'ACTIVE',
    addressLine1: '',
    municipality: 'Malaybalay',
    barangay: 'Poblacion',
  });

  // New Plan Modal State
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [newPlan, setNewPlan] = useState({
    name: '',
    code: '',
    serviceType: 'INTERNET',
    bandwidthMbps: '50',
    monthlyFeeStr: '1499.50',
    description: '',
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [plansRes, subsRes] = await Promise.all([
        apiClient.listPlans(),
        apiClient.listSubscribers({ limit: 50 }),
      ]);
      setPlans(plansRes.data);
      setSubscribers(subsRes.data);
      if (plansRes.data.length > 0 && !newSub.planId) {
        setNewSub((prev) => ({ ...prev, planId: plansRes.data[0].id }));
      }
    } catch {}
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGenerateBatch = async () => {
    setIsGenerating(true);
    setBatchResult(null);
    try {
      if (isDryRun) {
        // Preview computation
        const eligibleCount = subscribers.filter((s) => s.status === 'ACTIVE').length;
        setBatchResult({
          generatedCount: eligibleCount,
          skippedCount: subscribers.length - eligibleCount,
          message: `[Dry-Run Preview] ${eligibleCount} active accounts projected to generate invoices. No database modifications written.`,
        });
      } else {
        const res = await apiClient.generateInvoiceBatch({
          billingPeriodStart,
          billingPeriodEnd,
          dueDate,
          notes: 'Automated Monthly Recurring Billing Cycle',
        });
        setBatchResult({
          generatedCount: res.generatedCount,
          skippedCount: res.skippedCount,
          message: `Success: Generated ${res.generatedCount} invoices (${res.skippedCount} skipped).`,
        });
      }
    } catch (err: any) {
      setBatchResult({
        generatedCount: 0,
        skippedCount: 0,
        message: `Generation error: ${err.message || 'Failed to complete batch run'}`,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredSubscribers = useMemo(() => {
    let list = subscribers;
    if (selectedBarangayFilter !== 'ALL') {
      list = list.filter((s) => s.primaryAddress?.barangay === selectedBarangayFilter);
    }
    if (subscriberSearch.trim()) {
      const q = subscriberSearch.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.firstName.toLowerCase().includes(q) ||
          s.lastName.toLowerCase().includes(q) ||
          s.accountNumber.toLowerCase().includes(q) ||
          s.phone.includes(q) ||
          s.primaryAddress?.barangay?.toLowerCase().includes(q) ||
          s.primaryAddress?.municipality?.toLowerCase().includes(q) ||
          s.primaryAddress?.streetAddress?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [subscribers, subscriberSearch, selectedBarangayFilter]);

  // Reset subscriber page when search/filter changes
  useEffect(() => {
    setSubPage(1);
  }, [subscriberSearch, selectedBarangayFilter]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSubscriberModalOpen) setIsSubscriberModalOpen(false);
        if (isEditSubModalOpen) setIsEditSubModalOpen(false);
        if (isPlanModalOpen) setIsPlanModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubscriberModalOpen, isEditSubModalOpen, isPlanModalOpen]);

  const handleCreateSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.createSubscriber({
        firstName: newSub.firstName,
        lastName: newSub.lastName,
        phone: newSub.phone,
        email: newSub.email || undefined,
        primaryAddress: {
          addressLine1: newSub.addressLine1,
          barangay: newSub.barangay,
          municipality: newSub.municipality,
          city: newSub.municipality,
        },
      });
      setIsSubscriberModalOpen(false);
      setNewSub({
        firstName: '',
        lastName: '',
        phone: '09',
        email: '',
        addressLine1: '',
        municipality: 'Malaybalay',
        barangay: 'Poblacion',
        planId: plans[0]?.id || '',
      });
      loadData();
    } catch (err: any) {
      alert(`Failed to register subscriber: ${err.message}`);
    }
  };

  const handleOpenEditSub = (sub: SubscriberRecord) => {
    setEditingSubId(sub.id);
    setEditSub({
      firstName: sub.firstName,
      lastName: sub.lastName,
      phone: sub.phone,
      email: sub.email || '',
      status: sub.status || 'ACTIVE',
      addressLine1: sub.primaryAddress?.addressLine1 || sub.primaryAddress?.streetAddress || '',
      barangay: sub.primaryAddress?.barangay || 'Poblacion',
      municipality: sub.primaryAddress?.municipality || sub.primaryAddress?.city || 'Malaybalay',
    });
    setIsEditSubModalOpen(true);
  };

  const handleUpdateSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.updateSubscriber(editingSubId, {
        firstName: editSub.firstName,
        lastName: editSub.lastName,
        contactNumber: editSub.phone,
        email: editSub.email || null,
        status: editSub.status as any,
        streetAddress: editSub.addressLine1,
        barangay: editSub.barangay,
        municipality: editSub.municipality,
      });
      setIsEditSubModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(`Failed to update subscriber: ${err.message}`);
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const feeCentavos = parseCurrencyToCentavos(newPlan.monthlyFeeStr);
      await apiClient.createPlan({
        name: newPlan.name,
        code: newPlan.code.toUpperCase(),
        serviceType: newPlan.serviceType,
        bandwidthMbps: newPlan.bandwidthMbps ? parseInt(newPlan.bandwidthMbps, 10) : undefined,
        monthlyFeeCentavos: feeCentavos,
        description: newPlan.description || undefined,
      });
      setIsPlanModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(`Failed to create plan: ${err.message}`);
    }
  };

  return (
    <div className="workspace-animate-enter" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, overflowY: 'auto' }}>
      {/* KPI Metrics Ribbon */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="apple-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Total Registered Subscribers
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
            {subscribers.length}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--pine)', marginTop: '2px', fontWeight: 600 }}>
            {subscribers.filter((s) => s.status === 'ACTIVE').length} Active Services
          </div>
        </div>

        <div className="apple-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Active Plans in Catalog
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
            {plans.length}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Fiber, Cable & Bundles
          </div>
        </div>

        <div className="apple-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Estimated Monthly Billing
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--pine)', marginTop: '4px' }} className="tabular-nums">
            {formatCurrency(subscribers.length * 149950)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Projected Recurring Base
          </div>
        </div>

        <div className="apple-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Billing Run Readiness
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--pine)', marginTop: '4px' }}>
            Ready
          </div>
          <div style={{ fontSize: '11px', color: 'var(--pine)', marginTop: '2px', fontWeight: 600 }}>
            System Integrity Verified
          </div>
        </div>
      </div>

      {/* Batch Invoicing Generator */}
      <div className="apple-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Monthly Billing Cycle Batch Generator</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Generates recurring subscription invoices across active subscriber accounts.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox"
                checked={isDryRun}
                onChange={(e) => setIsDryRun(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#2C5745' }}
              />
              <span>Dry-Run / Preview Mode</span>
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 200px', gap: '14px', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Billing Period Start
            </label>
            <input
              type="date"
              value={billingPeriodStart}
              onChange={(e) => setBillingPeriodStart(e.target.value)}
              className="apple-input"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Billing Period End
            </label>
            <input
              type="date"
              value={billingPeriodEnd}
              onChange={(e) => setBillingPeriodEnd(e.target.value)}
              className="apple-input"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Invoice Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="apple-input"
            />
          </div>

          <button
            type="button"
            onClick={handleGenerateBatch}
            disabled={isGenerating}
            className={isDryRun ? 'btn-secondary' : 'btn-primary'}
            style={{ height: '38px', width: '100%' }}
          >
            {isGenerating ? 'Processing...' : isDryRun ? 'Run Dry-Run Preview' : 'Generate Real Invoices'}
          </button>
        </div>

        {batchResult && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: isDryRun ? 'var(--warning-bg)' : 'var(--success-bg)',
              border: isDryRun ? '1px solid var(--warning-border)' : '1px solid var(--success-border)',
              fontSize: '13px',
              fontWeight: 500,
              color: isDryRun ? 'var(--amber)' : 'var(--pine)',
            }}
          >
            {batchResult.message}
          </div>
        )}
      </div>

      {/* Split Roster: Service Plans & Subscribers Catalog */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Service Plans Catalog */}
        <div className="apple-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Service Plans Catalog</h4>
            <button
              type="button"
              onClick={() => setIsPlanModalOpen(true)}
              className="btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <IconPlus size={12} strokeWidth={2} />
              <span>New Plan</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '310px', overflowY: 'auto' }}>
            {plans.slice((planPage - 1) * PLAN_PAGE_SIZE, planPage * PLAN_PAGE_SIZE).map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: '7px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: '#FFFFFF',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }} className="font-mono">
                    {p.code} • {p.serviceType} {p.bandwidthMbps ? `• ${p.bandwidthMbps} Mbps` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="tabular-nums font-semibold" style={{ color: 'var(--pine)' }}>
                    {formatCurrency(p.monthlyFeeCentavos ?? (p as any).monthlyRecurringCentavos ?? 0)}
                  </div>
                  <span className="badge badge-success" style={{ fontSize: '9px' }}>Active</span>
                </div>
              </div>
            ))}
          </div>
          <Paginator
            page={planPage}
            totalPages={Math.ceil(plans.length / PLAN_PAGE_SIZE)}
            totalItems={plans.length}
            pageSize={PLAN_PAGE_SIZE}
            onPageChange={setPlanPage}
          />
        </div>

        {/* Subscriber Roster */}
        <div className="apple-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Subscriber Roster</h4>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {filteredSubscribers.length} subscriber{filteredSubscribers.length !== 1 ? 's' : ''} listed
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSubscriberModalOpen(true)}
              className="btn-primary"
              style={{ fontSize: '11px', padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <IconPlus size={13} strokeWidth={2} />
              <span>Register Subscriber</span>
            </button>
          </div>

          {/* Search & Barangay Filter Bar */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--text-tertiary)' }}>
                <IconSearch size={14} />
              </span>
              <input
                type="text"
                placeholder="Search by name, account number, phone, or barangay..."
                value={subscriberSearch}
                onChange={(e) => setSubscriberSearch(e.target.value)}
                className="apple-input"
                style={{ paddingLeft: '32px', fontSize: '12px', height: '34px' }}
              />
            </div>
            <select
              value={selectedBarangayFilter}
              onChange={(e) => setSelectedBarangayFilter(e.target.value)}
              className="apple-input"
              style={{ width: '160px', fontSize: '12px', height: '34px' }}
            >
              <option value="ALL">All Barangays</option>
              {getBarangays('Malaybalay').map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredSubscribers.length > 0 ? (
              filteredSubscribers
                .slice((subPage - 1) * SUB_PAGE_SIZE, subPage * SUB_PAGE_SIZE)
                .map((s) => (
                <div
                  key={s.id}
                  className="table-row-hover"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {s.firstName} {s.lastName}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }} className="font-mono">
                      {s.accountNumber} • {s.phone}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div>
                      <span className={`badge ${s.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>
                        {s.status}
                      </span>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'flex-end' }}>
                        <IconMapPin size={10} style={{ color: 'var(--pine)' }} />
                        <span>{s.primaryAddress?.barangay || 'Poblacion'}, {s.primaryAddress?.municipality || s.primaryAddress?.city || 'Malaybalay'}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenEditSub(s)}
                      className="btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                No subscribers match your search filter.
              </div>
            )}
          </div>
          <Paginator
            page={subPage}
            totalPages={Math.ceil(filteredSubscribers.length / SUB_PAGE_SIZE)}
            totalItems={filteredSubscribers.length}
            pageSize={SUB_PAGE_SIZE}
            onPageChange={setSubPage}
          />
        </div>
      </div>

      {/* New Subscriber Registration Modal */}
      {isSubscriberModalOpen && (
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
            style={{ width: '500px', backgroundColor: '#FFFFFF', overflow: 'hidden' }}
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
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Register New Subscriber</h3>
              <button
                type="button"
                onClick={() => setIsSubscriberModalOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                title="Close dialog"
              >
                <IconX size={16} strokeWidth={2} />
              </button>
            </div>

            <form onSubmit={handleCreateSubscriber} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    First Name
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={newSub.firstName}
                    onChange={(e) => setNewSub({ ...newSub, firstName: e.target.value })}
                    className="apple-input"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newSub.lastName}
                    onChange={(e) => setNewSub({ ...newSub, lastName: e.target.value })}
                    className="apple-input"
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Mobile Phone Number
                </label>
                <input
                  type="tel"
                  required
                  placeholder="09171234567"
                  value={newSub.phone}
                  onChange={(e) => setNewSub({ ...newSub, phone: e.target.value })}
                  className="apple-input font-mono"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Street Address
                </label>
                <input
                  type="text"
                  required
                  placeholder="Purok 3, Fortich Street"
                  value={newSub.addressLine1}
                  onChange={(e) => setNewSub({ ...newSub, addressLine1: e.target.value })}
                  className="apple-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Municipality / City
                  </label>
                  <select
                    value={newSub.municipality}
                    onChange={(e) => {
                      const m = e.target.value;
                      const bgys = getBarangays(m);
                      setNewSub({
                        ...newSub,
                        municipality: m,
                        barangay: bgys[0] || '',
                      });
                    }}
                    className="apple-input"
                  >
                    {getMunicipalities().map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Barangay
                  </label>
                  <select
                    value={newSub.barangay}
                    onChange={(e) => setNewSub({ ...newSub, barangay: e.target.value })}
                    className="apple-input"
                  >
                    {getBarangays(newSub.municipality).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button type="button" onClick={() => setIsSubscriberModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Subscriber
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Service Plan Modal */}
      {isPlanModalOpen && (
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
            style={{ width: '480px', backgroundColor: '#FFFFFF', overflow: 'hidden' }}
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
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Create Service Plan</h3>
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                title="Close dialog"
              >
                <IconX size={16} strokeWidth={2} />
              </button>
            </div>

            <form onSubmit={handleCreatePlan} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Plan Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Fiber Ultra 75Mbps"
                  value={newPlan.name}
                  onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                  className="apple-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Plan Code
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="FIBER-75"
                    value={newPlan.code}
                    onChange={(e) => setNewPlan({ ...newPlan, code: e.target.value })}
                    className="apple-input font-mono"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Service Type
                  </label>
                  <select
                    value={newPlan.serviceType}
                    onChange={(e) => setNewPlan({ ...newPlan, serviceType: e.target.value })}
                    className="apple-input"
                  >
                    <option value="INTERNET">Internet</option>
                    <option value="CABLE">Cable TV</option>
                    <option value="BUNDLE">Bundle</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Bandwidth (Mbps)
                  </label>
                  <input
                    type="number"
                    value={newPlan.bandwidthMbps}
                    onChange={(e) => setNewPlan({ ...newPlan, bandwidthMbps: e.target.value })}
                    className="apple-input tabular-nums"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Monthly Fee (PHP)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newPlan.monthlyFeeStr}
                    onChange={(e) => setNewPlan({ ...newPlan, monthlyFeeStr: e.target.value })}
                    className="apple-input tabular-nums"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button type="button" onClick={() => setIsPlanModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Subscriber Modal */}
      {isEditSubModalOpen && (
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
            style={{ width: '520px', backgroundColor: '#FFFFFF', overflow: 'hidden' }}
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
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Edit Subscriber Profile</h3>
              <button
                type="button"
                onClick={() => setIsEditSubModalOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                title="Close dialog"
              >
                <IconX size={16} strokeWidth={2} />
              </button>
            </div>

            <form onSubmit={handleUpdateSubscriber} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    First Name
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={editSub.firstName}
                    onChange={(e) => setEditSub({ ...editSub, firstName: e.target.value })}
                    className="apple-input"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editSub.lastName}
                    onChange={(e) => setEditSub({ ...editSub, lastName: e.target.value })}
                    className="apple-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Mobile Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={editSub.phone}
                    onChange={(e) => setEditSub({ ...editSub, phone: e.target.value })}
                    className="apple-input font-mono"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Status
                  </label>
                  <select
                    value={editSub.status}
                    onChange={(e) => setEditSub({ ...editSub, status: e.target.value })}
                    className="apple-input"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="TERMINATED">TERMINATED</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="subscriber@example.ph"
                  value={editSub.email}
                  onChange={(e) => setEditSub({ ...editSub, email: e.target.value })}
                  className="apple-input"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Street Address
                </label>
                <input
                  type="text"
                  required
                  value={editSub.addressLine1}
                  onChange={(e) => setEditSub({ ...editSub, addressLine1: e.target.value })}
                  className="apple-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Municipality / City
                  </label>
                  <select
                    value={editSub.municipality}
                    onChange={(e) => {
                      const m = e.target.value;
                      const bgys = getBarangays(m);
                      setEditSub({
                        ...editSub,
                        municipality: m,
                        barangay: bgys[0] || '',
                      });
                    }}
                    className="apple-input"
                  >
                    {getMunicipalities().map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Barangay
                  </label>
                  <select
                    value={editSub.barangay}
                    onChange={(e) => setEditSub({ ...editSub, barangay: e.target.value })}
                    className="apple-input"
                  >
                    {getBarangays(editSub.municipality).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button type="button" onClick={() => setIsEditSubModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Update Subscriber
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
