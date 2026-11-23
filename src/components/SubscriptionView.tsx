import React, { useMemo, useState } from 'react';
import {
  BadgeCheck,
  CalendarClock,
  Check,
  CreditCard,
  Download,
  FileText,
  KeyRound,
  Lock,
  Monitor,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import {
  DeviceScope,
  LicenseRecord,
  PaymentMode,
  PlanDuration,
  PlanTier,
  SubscriptionFeatureKey,
  SubscriptionPlanConfig,
} from '../types/accounting';
import { formatINR } from '../utils/formatters';
import { downloadLicenseInvoicePDF } from '../utils/pdfGenerator';

const FEATURE_LABELS: { key: SubscriptionFeatureKey; label: string }[] = [
  { key: 'core_billing', label: 'Sales, Purchase, Inventory, Banking & GST Reports' },
  { key: 'payroll', label: 'Payroll Engine, Salary Runs & Payslip PDF' },
  { key: 'gst_portals', label: 'Government GST Portals Integration' },
  { key: 'invoice_designs', label: '24 Tax Invoice Designs & Digital Signatory' },
  { key: 'bulk_print', label: 'Bulk Print & Date-Filtered Reports (IP)' },
  { key: 'multi_currency', label: 'Multi-Currency Exchange Rates' },
  { key: 'operations_erp', label: 'Manufacturing, BOM, Production & ERP' },
  { key: 'ocr_bulk_tools', label: 'OCR Invoice Scanner & Bulk Excel Import/Export' },
];

function getPlanPrice(
  plan: SubscriptionPlanConfig,
  scope: DeviceScope,
  duration: PlanDuration
): number {
  if (scope === 'desktop' && duration === '1_year') return plan.priceDesktop1Y;
  if (scope === 'desktop' && duration === '3_years') return plan.priceDesktop3Y;
  if (scope === 'desktop_mobile' && duration === '1_year') return plan.priceCombo1Y;
  return plan.priceCombo3Y;
}

function getLicenseDaysLeft(expiresAt?: string): number {
  if (!expiresAt) return 0;
  const endMs = new Date(`${expiresAt.slice(0, 10)}T23:59:59Z`).getTime();
  const diff = endMs - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export const SubscriptionView: React.FC = () => {
  const {
    db,
    purchaseSubscription,
    requestSubscriptionOtp,
    verifySubscriptionOtp,
    attachLicense,
    detachLicense,
  } = useStore();

  const sub = db?.subscription;
  const plans = sub?.plans || [];

  const [scope, setScope] = useState<DeviceScope>('desktop');
  const [duration, setDuration] = useState<PlanDuration>('1_year');

  // Checkout Modal State
  const [buyingPlan, setBuyingPlan] = useState<SubscriptionPlanConfig | null>(null);
  const [customerName, setCustomerName] = useState(() => db?.profile.companyName || '');
  const [phone, setPhone] = useState(() => db?.profile.phone || '');
  const [gstin, setGstin] = useState(() => db?.profile.gstin || '');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('UPI');
  const [paymentRef, setPaymentRef] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [recentOrder, setRecentOrder] = useState<LicenseRecord | null>(null);

  // Customer OTP License Portal State
  const [otpPhone, setOtpPhone] = useState(() => db?.profile.phone || '');
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [issuedOtpPreview, setIssuedOtpPreview] = useState('');
  const [otpStep, setOtpStep] = useState<'phone' | 'otp' | 'verified'>('phone');
  const [otpLicenses, setOtpLicenses] = useState<LicenseRecord[]>([]);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState('');
  const [otpErr, setOtpErr] = useState('');

  // Detach Passcode Modal State
  const [showDetachModal, setShowDetachModal] = useState(false);
  const [detachPasscode, setDetachPasscode] = useState('');
  const [detachError, setDetachError] = useState('');
  const [detachBusy, setDetachBusy] = useState(false);

  const daysRemaining = useMemo(() => {
    if (!sub) return 7;
    if (sub.isLicensed && sub.attachedLicense?.expiresAt) {
      return getLicenseDaysLeft(sub.attachedLicense.expiresAt);
    }
    return sub.trialDaysLeft;
  }, [sub]);

  if (!db || !sub) return null;

  const activePlanLabel = sub.isLicensed
    ? `${sub.activeTier.toUpperCase()} PLAN`
    : sub.isTrialExpired
    ? 'FREE TRIAL EXPIRED'
    : 'FREE 7-DAY TRIAL';

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyingPlan) return;
    setOrderError('');
    setSubmittingOrder(true);
    try {
      const created = await purchaseSubscription({
        tier: buyingPlan.tier,
        deviceScope: scope,
        duration,
        customerName,
        phone,
        gstin,
        paymentMode,
        paymentRef,
      });
      setRecentOrder(created);
      setBuyingPlan(null);
      setPaymentRef('');
      setOtpPhone(created.phone);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Subscription order failed');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleRequestOtp = async () => {
    setOtpErr('');
    setOtpMsg('');
    setOtpBusy(true);
    try {
      const res = await requestSubscriptionOtp(otpPhone);
      setIssuedOtpPreview(res.otpCode);
      setOtpStep('otp');
      setOtpMsg(
        res.licenseCount > 0
          ? `Found ${res.licenseCount} license record(s) for ${res.phone}. Enter the 6-digit OTP below.`
          : `OTP sent for ${res.phone}. Enter OTP to check available licenses.`
      );
    } catch (err) {
      setOtpErr(err instanceof Error ? err.message : 'Failed to request OTP');
    } finally {
      setOtpBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    setOtpErr('');
    setOtpMsg('');
    setOtpBusy(true);
    try {
      const list = await verifySubscriptionOtp(otpPhone, otpCodeInput);
      setOtpLicenses(list);
      setOtpStep('verified');
      if (list.length === 0) {
        setOtpMsg('Verified! No purchased licenses found on this phone number yet.');
      } else {
        setOtpMsg(`Verified ${list.length} license(s). Click any Active License ID to attach it permanently.`);
      }
    } catch (err) {
      setOtpErr(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setOtpBusy(false);
    }
  };

  const handleAttachLicense = async (lic: LicenseRecord) => {
    setOtpErr('');
    setOtpBusy(true);
    try {
      await attachLicense({ licenseId: lic.id });
      setOtpMsg(`License ${lic.licenseCode} permanently attached to ${db.profile.companyName}!`);
    } catch (err) {
      setOtpErr(err instanceof Error ? err.message : 'Could not attach license');
    } finally {
      setOtpBusy(false);
    }
  };

  const handleDetachSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDetachError('');
    setDetachBusy(true);
    try {
      await detachLicense(detachPasscode);
      setShowDetachModal(false);
      setDetachPasscode('');
    } catch (err) {
      setDetachError(err instanceof Error ? err.message : 'Invalid passcode');
    } finally {
      setDetachBusy(false);
    }
  };

  const tierTheme: Record<PlanTier, { border: string; header: string; btn: string }> = {
    silver: {
      border: 'border-slate-300 dark:border-slate-700',
      header: 'bg-slate-100 dark:bg-slate-800/80 text-slate-900 dark:text-white',
      btn: 'bg-slate-800 hover:bg-slate-900 text-white',
    },
    gold: {
      border: 'border-amber-400 dark:border-amber-600 ring-1 ring-amber-400/40',
      header: 'bg-amber-50 dark:bg-amber-950/50 text-amber-950 dark:text-amber-200',
      btn: 'bg-amber-600 hover:bg-amber-700 text-white',
    },
    platinum: {
      border: 'border-indigo-500 dark:border-indigo-500 ring-1 ring-indigo-500/40',
      header: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-200',
      btn: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    },
  };

  return (
    <div className="space-y-6">
      {/* Live Status & Telemetry Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              Subscription &amp; License Control
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {activePlanLabel}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {sub.isLicensed
                ? 'Active commercial license permanently attached to this company workspace.'
                : sub.isTrialExpired
                ? 'Your 7-day Free Trial has ended. Purchase a plan or attach your verified License ID below to continue.'
                : `Free trial works with full access for 7 days. ${sub.trialDaysLeft} day(s) remaining before license is required.`}
            </p>
          </div>

          {sub.isLicensed && sub.attachedLicense && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => downloadLicenseInvoicePDF(sub.attachedLicense!, db.profile)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                License Invoice PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  setDetachError('');
                  setDetachPasscode('');
                  setShowDetachModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Detach License
              </button>
            </div>
          )}
        </div>

        {/* 4 Live KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <div className="text-[11px] font-medium text-slate-500">Current Subscription</div>
            <div className="text-sm font-bold text-slate-900 dark:text-white mt-1 flex items-center gap-1.5">
              {sub.isLicensed ? (
                <>
                  <BadgeCheck className="w-4 h-4 text-emerald-600" />
                  <span className="uppercase">{sub.activeTier}</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    ({sub.activeScope === 'desktop_mobile' ? 'Desktop + Mobile' : 'Desktop'})
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span>{sub.isTrialExpired ? 'Trial Expired' : 'Free Plan (7d Trial)'}</span>
                </>
              )}
            </div>
          </div>

          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5" /> Days Remaining
            </div>
            <div
              className={`text-lg font-extrabold font-mono mt-1 ${
                daysRemaining === 0
                  ? 'text-red-600'
                  : daysRemaining <= 3
                  ? 'text-amber-600'
                  : 'text-emerald-600'
              }`}
            >
              {daysRemaining} {daysRemaining === 1 ? 'Day' : 'Days'}
            </div>
          </div>

          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" /> Total Vouchers / Invoices
            </div>
            <div className="text-lg font-extrabold font-mono text-slate-900 dark:text-white mt-1">
              {sub.invoiceCount}
            </div>
          </div>

          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <div className="text-[11px] font-medium text-slate-500">Attached License ID</div>
            <div className="text-xs font-mono font-bold text-indigo-700 dark:text-indigo-400 mt-1.5 truncate">
              {sub.attachedLicense?.licenseCode || 'No License Attached'}
            </div>
            {sub.attachedLicense?.expiresAt && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                Valid until {sub.attachedLicense.expiresAt}
              </div>
            )}
          </div>
        </div>

        {sub.isTrialExpired && !sub.isLicensed && (
          <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-800 dark:text-red-200 font-medium">
            Free 7-day trial has ended. All billing and master creation features are locked until you purchase a Silver, Gold, or Platinum subscription below or attach a verified License ID using your Registered Phone + OTP.
          </div>
        )}
      </div>

      {/* Customer Recent Order Confirmation Banner */}
      {recentOrder && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
              <BadgeCheck className="w-4 h-4 text-emerald-600" />
              Subscription Order Recorded · Invoice {recentOrder.invoiceNo}
            </div>
            <p className="text-xs text-emerald-800 dark:text-emerald-300">
              Plan: <strong className="uppercase">{recentOrder.tier}</strong> · Amount:{' '}
              <strong>{formatINR(recentOrder.totalAmount)}</strong> · Phone:{' '}
              <strong className="font-mono">{recentOrder.phone}</strong>. Once payment is verified in Ops, login with Phone + OTP below to click &amp; attach your Unique License ID.
            </p>
          </div>
          <button
            type="button"
            onClick={() => downloadLicenseInvoicePDF(recentOrder, db.profile)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0"
          >
            <Download className="w-4 h-4" />
            Download License Invoice (PDF)
          </button>
        </div>
      )}

      {/* Customer Phone + OTP License Login & Permanent Attach */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Phone className="w-4 h-4 text-indigo-600" />
              Customer License Login (Registered Phone + OTP)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Already purchased? Enter your registered phone number, verify OTP, and click your Unique License ID to attach it permanently.
            </p>
          </div>
          {otpStep !== 'phone' && (
            <button
              type="button"
              onClick={() => {
                setOtpStep('phone');
                setOtpCodeInput('');
                setIssuedOtpPreview('');
                setOtpLicenses([]);
                setOtpMsg('');
                setOtpErr('');
              }}
              className="text-xs font-semibold text-indigo-600 hover:underline"
            >
              Use Different Number
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Registered Phone Number
            </label>
            <input
              type="tel"
              placeholder="e.g. 9876543210"
              value={otpPhone}
              onChange={(e) => setOtpPhone(e.target.value)}
              disabled={otpStep === 'verified'}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
            />
          </div>

          {otpStep === 'otp' && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Enter 6-Digit OTP
              </label>
              <input
                type="text"
                maxLength={6}
                placeholder="6-digit OTP"
                value={otpCodeInput}
                onChange={(e) => setOtpCodeInput(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono tracking-widest font-bold"
              />
            </div>
          )}

          <div className="flex gap-2">
            {otpStep === 'phone' && (
              <button
                type="button"
                disabled={otpBusy}
                onClick={handleRequestOtp}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {otpBusy ? 'Sending...' : 'Send OTP'}
              </button>
            )}
            {otpStep === 'otp' && (
              <>
                <button
                  type="button"
                  disabled={otpBusy}
                  onClick={handleVerifyOtp}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {otpBusy ? 'Verifying...' : 'Verify OTP & Show Licenses'}
                </button>
                <button
                  type="button"
                  disabled={otpBusy}
                  onClick={handleRequestOtp}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  Resend
                </button>
              </>
            )}
          </div>
        </div>

        {issuedOtpPreview && otpStep === 'otp' && (
          <div className="px-3.5 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-900 dark:text-indigo-200 flex items-center justify-between">
            <span>
              In-App Verification OTP for <strong className="font-mono">{otpPhone}</strong>:{' '}
              <strong className="font-mono text-sm tracking-widest">{issuedOtpPreview}</strong>
            </span>
            <button
              type="button"
              onClick={() => setOtpCodeInput(issuedOtpPreview)}
              className="text-xs font-semibold underline"
            >
              Auto-Fill OTP
            </button>
          </div>
        )}

        {otpMsg && <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{otpMsg}</div>}
        {otpErr && <div className="text-xs font-medium text-red-600 dark:text-red-400">{otpErr}</div>}

        {otpStep === 'verified' && otpLicenses.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {otpLicenses.map((lic) => {
              const isCurrentlyAttached = sub.attachedLicense?.id === lic.id;
              return (
                <div
                  key={lic.id}
                  className={`p-4 rounded-xl border space-y-2.5 ${
                    isCurrentlyAttached
                      ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold uppercase text-slate-900 dark:text-white">
                        {lic.tier} · {lic.deviceScope === 'desktop_mobile' ? 'Desktop + Mobile' : 'Desktop'} ·{' '}
                        {lic.duration === '3_years' ? '3 Years' : '1 Year'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {lic.customerName} · Inv {lic.invoiceNo} · {formatINR(lic.totalAmount)}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        lic.status === 'active'
                          ? 'bg-emerald-100 text-emerald-700'
                          : lic.status === 'deactivated'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {lic.status === 'pending_verification' ? 'Pending Ops Verify' : lic.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                    {lic.status === 'active' && lic.licenseCode ? (
                      <button
                        type="button"
                        disabled={otpBusy || isCurrentlyAttached}
                        onClick={() => handleAttachLicense(lic)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-colors ${
                          isCurrentlyAttached
                            ? 'bg-emerald-600 text-white cursor-default'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {isCurrentlyAttached ? `${lic.licenseCode} (Attached)` : `Attach ${lic.licenseCode}`}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-500 font-mono">
                        {lic.licenseCode || 'Awaiting Ops Verification'}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => downloadLicenseInvoicePDF(lic, db.profile)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600"
                    >
                      <Download className="w-3.5 h-3.5" /> Invoice PDF
                    </button>
                  </div>
                  {lic.expiresAt && (
                    <div className="text-[11px] text-slate-500">
                      Valid: {lic.validFrom} to {lic.expiresAt}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pricing & Plan Selector */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Choose Your License Plan
            </h2>
            <p className="text-xs text-slate-500">
              Select device access and term, enter Registered Mobile + Name (+ optional GSTIN), and download your Tax Invoice immediately.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setScope('desktop')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
                  scope === 'desktop'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" /> Desktop Only
              </button>
              <button
                type="button"
                onClick={() => setScope('desktop_mobile')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
                  scope === 'desktop_mobile'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" /> Desktop + Mobile
              </button>
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setDuration('1_year')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                  duration === '1_year'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                1 Year
              </button>
              <button
                type="button"
                onClick={() => setDuration('3_years')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                  duration === '3_years'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                3 Years
              </button>
            </div>
          </div>
        </div>

        {/* 3 Plan Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {plans.map((plan) => {
            const price = getPlanPrice(plan, scope, duration);
            const theme = tierTheme[plan.tier];
            const isActiveTier = sub.isLicensed && sub.activeTier === plan.tier;

            return (
              <div
                key={plan.tier}
                className={`bg-white dark:bg-slate-900 border rounded-xl overflow-hidden flex flex-col ${theme.border}`}
              >
                <div className={`p-5 border-b border-slate-200 dark:border-slate-800 ${theme.header}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-extrabold tracking-tight uppercase">
                      {plan.name}
                    </span>
                    {isActiveTier && (
                      <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold uppercase">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs opacity-80 mt-1">{plan.tagline}</p>

                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-2xl font-extrabold font-mono">
                      {formatINR(price)}
                    </span>
                    <span className="text-xs opacity-75">
                      / {duration === '3_years' ? '3 Years' : '1 Year'} ({scope === 'desktop_mobile' ? 'Desktop + Mobile' : 'Desktop'})
                    </span>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] opacity-80 font-mono">
                    <div>Desktop 1Y: {formatINR(plan.priceDesktop1Y)}</div>
                    <div>Desktop 3Y: {formatINR(plan.priceDesktop3Y)}</div>
                    <div>Combo 1Y: {formatINR(plan.priceCombo1Y)}</div>
                    <div>Combo 3Y: {formatINR(plan.priceCombo3Y)}</div>
                  </div>
                </div>

                <div className="p-5 flex-1 space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Included &amp; Locked Modules
                  </div>
                  {FEATURE_LABELS.map((f) => {
                    const enabled = Boolean(plan.features[f.key]);
                    return (
                      <div key={f.key} className="flex items-start gap-2 text-xs">
                        {enabled ? (
                          <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="w-3 h-3" />
                          </span>
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center shrink-0 mt-0.5">
                            <Lock className="w-2.5 h-2.5" />
                          </span>
                        )}
                        <span
                          className={
                            enabled
                              ? 'text-slate-800 dark:text-slate-200 font-medium'
                              : 'text-slate-400 dark:text-slate-500 line-through'
                          }
                        >
                          {f.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="p-5 pt-0">
                  <button
                    type="button"
                    onClick={() => {
                      setOrderError('');
                      setBuyingPlan(plan);
                    }}
                    className={`w-full py-2.5 px-4 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors ${theme.btn}`}
                  >
                    <CreditCard className="w-4 h-4" />
                    Buy {plan.name} ({formatINR(price)})
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Company Purchase History */}
      {sub.ordersForCompany && sub.ordersForCompany.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            License Orders &amp; Invoices ({sub.ordersForCompany.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 pr-3">Invoice No</th>
                  <th className="py-2 pr-3">Plan &amp; Scope</th>
                  <th className="py-2 pr-3">Customer / Phone</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">License ID</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sub.ordersForCompany.map((ord) => (
                  <tr key={ord.id}>
                    <td className="py-2.5 pr-3 font-mono font-semibold">{ord.invoiceNo}</td>
                    <td className="py-2.5 pr-3 uppercase font-semibold">
                      {ord.tier} · {ord.deviceScope === 'desktop_mobile' ? 'Desktop+Mobile' : 'Desktop'} ·{' '}
                      {ord.duration === '3_years' ? '3Y' : '1Y'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{ord.customerName}</div>
                      <div className="text-[11px] font-mono text-slate-500">{ord.phone}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono font-bold">{formatINR(ord.totalAmount)}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          ord.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : ord.status === 'deactivated'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {ord.status === 'pending_verification' ? 'Pending Verify' : ord.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {ord.licenseCode || '—'}
                    </td>
                    <td className="py-2.5 text-right space-x-2 whitespace-nowrap">
                      {ord.status === 'active' && sub.attachedLicense?.id !== ord.id && (
                        <button
                          type="button"
                          onClick={() => attachLicense({ licenseId: ord.id })}
                          className="px-2.5 py-1 rounded bg-indigo-600 text-white text-[11px] font-semibold"
                        >
                          Attach
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => downloadLicenseInvoicePDF(ord, db.profile)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Download className="w-3 h-3" /> Invoice PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {buyingPlan && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handlePurchaseSubmit}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Purchase {buyingPlan.name} License
                </h3>
                <p className="text-[11px] text-slate-500">
                  {scope === 'desktop_mobile' ? 'Desktop + Mobile App' : 'Desktop Only'} ·{' '}
                  {duration === '3_years' ? '3 Years' : '1 Year'} ·{' '}
                  <strong className="text-indigo-600">
                    {formatINR(getPlanPrice(buyingPlan, scope, duration))}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBuyingPlan(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Registered Mobile Number *
                </label>
                <input
                  required
                  type="tel"
                  placeholder="10-digit registered phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Customer / Business Name *
                </label>
                <input
                  required
                  type="text"
                  placeholder="Full name or firm name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  GSTIN (Optional — for B2B Input Tax Credit)
                </label>
                <input
                  type="text"
                  maxLength={15}
                  placeholder="e.g. 27AABCS1429B1ZN"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="UPI">UPI / QR</option>
                    <option value="Bank Transfer">Bank Transfer (NEFT/IMPS)</option>
                    <option value="Card">Debit / Credit Card</option>
                    <option value="Cash">Cash</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Transaction / UTR Ref (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="UTR / Txn ID"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
              </div>

              {orderError && <div className="text-red-600 font-medium">{orderError}</div>}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBuyingPlan(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingOrder}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {submittingOrder
                  ? 'Processing Payment...'
                  : `Pay ${formatINR(getPlanPrice(buyingPlan, scope, duration))} & Generate Invoice`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Detach License Passcode Modal */}
      {showDetachModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleDetachSubmit}
            className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Unlock className="w-4 h-4 text-red-600" />
                Detach License Passcode Required
              </h3>
              <button
                type="button"
                onClick={() => setShowDetachModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                Active License <strong className="font-mono">{sub.attachedLicense?.licenseCode}</strong> is permanently attached to this workspace. Enter the Detach Passcode to unlink it.
              </p>
              <input
                required
                type="password"
                placeholder="Enter Detach Passcode"
                value={detachPasscode}
                onChange={(e) => setDetachPasscode(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
              {detachError && <div className="text-red-600 font-semibold">{detachError}</div>}
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDetachModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={detachBusy}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {detachBusy ? 'Verifying...' : 'Verify & Detach'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
