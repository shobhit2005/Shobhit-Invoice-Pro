import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  CalendarPlus,
  Check,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  KeyRound,
  Lock,
  LogOut,
  PlusCircle,
  Power,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { OpsOverviewPayload, useStore } from '../context/StoreContext';
import {
  LicenseRecord,
  PlanTier,
  SubscriptionFeatureKey,
  SubscriptionPlanConfig,
} from '../types/accounting';
import { formatINR } from '../utils/formatters';
import { downloadLicenseInvoicePDF } from '../utils/pdfGenerator';
import {
  buildOpsSheetTabData,
  createOpsMasterSpreadsheet,
  DriveSpreadsheetItem,
  getWorkspaceAccessToken,
  initWorkspaceAuth,
  inspectSpreadsheetMetadata,
  listDriveSpreadsheets,
  logoutGoogleWorkspace,
  OPS_SHEET_TABS,
  OpsTelemetryData,
  SheetMetadataSummary,
  signInWithGoogleWorkspace,
  syncAllOpsDataToSheet,
} from '../utils/googleWorkspaceSync';

const OPS_FEATURES: { key: SubscriptionFeatureKey; label: string }[] = [
  { key: 'core_billing', label: 'Core Billing, Inventory & GST' },
  { key: 'payroll', label: 'Payroll & Salary Payslips' },
  { key: 'gst_portals', label: 'GST Govt Portals' },
  { key: 'invoice_designs', label: '24 Invoice Designs' },
  { key: 'bulk_print', label: 'Bulk Print Center (IP)' },
  { key: 'multi_currency', label: 'Multi-Currency Rates' },
  { key: 'operations_erp', label: 'Manufacturing & ERP' },
  { key: 'ocr_bulk_tools', label: 'OCR Scanner & Bulk Excel' },
];

interface OpsDashboardModalProps {
  opsPassword: string;
  initialOverview: OpsOverviewPayload;
  onClose: () => void;
}

export const OpsDashboardModal: React.FC<OpsDashboardModalProps> = ({
  opsPassword,
  initialOverview,
  onClose,
}) => {
  const {
    db,
    opsVerifyLicense,
    opsUpdateLicense,
    opsUpdatePlan,
    opsUpdatePasscodes,
    opsFetchTelemetry,
    opsSaveSheetLink,
  } = useStore();

  const [activePassword, setActivePassword] = useState(opsPassword);
  const [overview, setOverview] = useState<OpsOverviewPayload>(initialOverview);
  const [tab, setTab] = useState<'queue' | 'plans' | 'passcodes' | 'sheets'>('queue');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_verification' | 'active' | 'deactivated'>('all');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Google Sheets & Telemetry State (access token stored strictly in memory)
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(() => getWorkspaceAccessToken());
  const [authBusy, setAuthBusy] = useState(false);
  const [telemetry, setTelemetry] = useState<OpsTelemetryData | null>(null);
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [sheetInput, setSheetInput] = useState<string>(initialOverview.settings.linkedSheetUrl || initialOverview.settings.linkedSheetId || '');
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetItem[]>([]);
  const [driveBusy, setDriveBusy] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<SheetMetadataSummary | null>(() =>
    initialOverview.settings.linkedSheetId
      ? {
          spreadsheetId: initialOverview.settings.linkedSheetId,
          title: initialOverview.settings.linkedSheetTitle || 'Linked Ops Google Sheet',
          spreadsheetUrl:
            initialOverview.settings.linkedSheetUrl ||
            `https://docs.google.com/spreadsheets/d/${initialOverview.settings.linkedSheetId}/edit`,
          sheetTabs: [],
          previewTabTitle: '',
          previewRows: [],
        }
      : null
  );
  const [inspectBusy, setInspectBusy] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{
    spreadsheetUrl: string;
    title: string;
    totalRowsWritten: number;
    tabsUpdated: string[];
  } | null>(null);

  useEffect(() => {
    const unsubscribe = initWorkspaceAuth(
      (user, accessToken) => {
        setGoogleUser(user);
        setGoogleToken(accessToken);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(getWorkspaceAccessToken());
      }
    );
    return () => unsubscribe();
  }, []);

  const loadTelemetry = async () => {
    setTelemetryBusy(true);
    try {
      const res = await opsFetchTelemetry(activePassword);
      setTelemetry(res.telemetry);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed loading Ops telemetry');
    } finally {
      setTelemetryBusy(false);
    }
  };

  useEffect(() => {
    if (tab === 'sheets') {
      void loadTelemetry();
    }
  }, [tab]);

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setErrorMsg('');
    try {
      const res = await signInWithGoogleWorkspace();
      setGoogleUser(res.user);
      setGoogleToken(res.accessToken);
      showToast(`Connected Google Workspace (${res.user.email || res.user.displayName || 'Signed in'})`);
      setDriveBusy(true);
      try {
        const files = await listDriveSpreadsheets(res.accessToken);
        setDriveFiles(files);
        if (selectedSheet?.spreadsheetId) {
          const inspected = await inspectSpreadsheetMetadata(res.accessToken, selectedSheet.spreadsheetId);
          setSelectedSheet(inspected);
        }
      } catch {
        // Non-fatal: user can still paste URL or retry
      } finally {
        setDriveBusy(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logoutGoogleWorkspace();
    setGoogleUser(null);
    setGoogleToken(null);
    setDriveFiles([]);
    showToast('Disconnected Google Workspace session.');
  };

  const handleRefreshDriveList = async () => {
    if (!googleToken) return;
    setDriveBusy(true);
    setErrorMsg('');
    try {
      const files = await listDriveSpreadsheets(googleToken);
      setDriveFiles(files);
      showToast(`Loaded ${files.length} spreadsheet(s) from Google Drive.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not list Drive spreadsheets');
      if (!getWorkspaceAccessToken()) setGoogleToken(null);
    } finally {
      setDriveBusy(false);
    }
  };

  const handleInspectSheet = async (idOrUrl: string) => {
    if (!googleToken) {
      setErrorMsg('Please sign in with Google first.');
      return;
    }
    setInspectBusy(true);
    setErrorMsg('');
    try {
      const meta = await inspectSpreadsheetMetadata(googleToken, idOrUrl);
      setSelectedSheet(meta);
      setSheetInput(meta.spreadsheetUrl);
      const saved = await opsSaveSheetLink(activePassword, {
        linkedSheetId: meta.spreadsheetId,
        linkedSheetTitle: meta.title,
        linkedSheetUrl: meta.spreadsheetUrl,
        lastSheetSyncAt: overview.settings.lastSheetSyncAt || '',
        lastSheetSyncBy: overview.settings.lastSheetSyncBy || '',
      });
      setOverview({ licenses: saved.licenses, plans: saved.plans, settings: saved.settings });
      setTelemetry(saved.telemetry);
      showToast(`Selected Google Sheet "${meta.title}" (${meta.sheetTabs.length} tabs).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not inspect Google Sheet');
      if (!getWorkspaceAccessToken()) setGoogleToken(null);
    } finally {
      setInspectBusy(false);
    }
  };

  const handleCreateMasterSheet = async () => {
    if (!googleToken) {
      setErrorMsg('Please sign in with Google first.');
      return;
    }
    setInspectBusy(true);
    setErrorMsg('');
    try {
      const created = await createOpsMasterSpreadsheet(googleToken);
      setSelectedSheet(created);
      setSheetInput(created.spreadsheetUrl);
      const saved = await opsSaveSheetLink(activePassword, {
        linkedSheetId: created.spreadsheetId,
        linkedSheetTitle: created.title,
        linkedSheetUrl: created.spreadsheetUrl,
      });
      setOverview({ licenses: saved.licenses, plans: saved.plans, settings: saved.settings });
      setTelemetry(saved.telemetry);
      const files = await listDriveSpreadsheets(googleToken).catch(() => driveFiles);
      setDriveFiles(files);
      showToast(`Created new Ops Master Google Sheet "${created.title}". Click Sync Now to write live data.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not create Google Sheet');
      if (!getWorkspaceAccessToken()) setGoogleToken(null);
    } finally {
      setInspectBusy(false);
    }
  };

  const handleExecuteConfirmedSync = async () => {
    if (!googleToken || !selectedSheet) return;
    setSyncBusy(true);
    setErrorMsg('');
    try {
      const freshTelemetry = (await opsFetchTelemetry(activePassword)).telemetry;
      setTelemetry(freshTelemetry);
      const syncResult = await syncAllOpsDataToSheet(
        googleToken,
        selectedSheet.spreadsheetId,
        freshTelemetry
      );
      const syncTime = new Date().toISOString();
      const saved = await opsSaveSheetLink(activePassword, {
        linkedSheetId: syncResult.spreadsheetId,
        linkedSheetTitle: syncResult.title,
        linkedSheetUrl: syncResult.spreadsheetUrl,
        lastSheetSyncAt: syncTime,
        lastSheetSyncBy: googleUser?.email || googleUser?.displayName || 'Ops Admin',
      });
      setOverview({ licenses: saved.licenses, plans: saved.plans, settings: saved.settings });
      setTelemetry(saved.telemetry);
      const updatedMeta = await inspectSpreadsheetMetadata(googleToken, syncResult.spreadsheetId).catch(
        () => selectedSheet
      );
      setSelectedSheet(updatedMeta);
      setLastSyncResult(syncResult);
      setConfirmSyncOpen(false);
      showToast(`Synced ${syncResult.totalRowsWritten} rows across ${syncResult.tabsUpdated.length} tabs to "${syncResult.title}"!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Sheet sync failed');
      if (!getWorkspaceAccessToken()) setGoogleToken(null);
    } finally {
      setSyncBusy(false);
    }
  };

  // Verify Modal State (Mandatory Transaction ID or Screenshot)
  const [verifyingLicense, setVerifyingLicense] = useState<LicenseRecord | null>(null);
  const [txnIdInput, setTxnIdInput] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);

  // Screenshot Viewer Modal
  const [previewShot, setPreviewShot] = useState<{ title: string; url: string } | null>(null);

  // Custom Validity Date Modal
  const [extendingLicense, setExtendingLicense] = useState<LicenseRecord | null>(null);
  const [customExpiryDate, setCustomExpiryDate] = useState('');

  // Plan Editor Local Copies
  const [planDrafts, setPlanDrafts] = useState<Record<PlanTier, SubscriptionPlanConfig>>(() => {
    const map: Partial<Record<PlanTier, SubscriptionPlanConfig>> = {};
    for (const p of initialOverview.plans) {
      map[p.tier] = { ...p, features: { ...p.features } };
    }
    return map as Record<PlanTier, SubscriptionPlanConfig>;
  });
  const [savingTier, setSavingTier] = useState<PlanTier | null>(null);

  // Passcodes Editor
  const [detachPasscodeInput, setDetachPasscodeInput] = useState(initialOverview.settings.detachPasscode || '112233');
  const [newOpsPassInput, setNewOpsPassInput] = useState('');
  const [savingPasscodes, setSavingPasscodes] = useState(false);

  const filteredLicenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return overview.licenses.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (!q) return true;
      return (
        l.customerName.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        l.invoiceNo.toLowerCase().includes(q) ||
        l.licenseCode.toLowerCase().includes(q) ||
        l.transactionId.toLowerCase().includes(q)
      );
    });
  }, [overview.licenses, search, statusFilter]);

  const metrics = useMemo(() => {
    const pending = overview.licenses.filter((l) => l.status === 'pending_verification').length;
    const active = overview.licenses.filter((l) => l.status === 'active').length;
    const revenue = overview.licenses
      .filter((l) => l.status === 'active')
      .reduce((s, l) => s + l.totalAmount, 0);
    return { total: overview.licenses.length, pending, active, revenue };
  }, [overview.licenses]);

  const showToast = (msg: string) => {
    setNotice(msg);
    setErrorMsg('');
    setTimeout(() => setNotice(''), 4000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setErrorMsg('Upload PNG, JPEG, or WEBP transaction screenshot.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setScreenshotDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVerifyConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingLicense) return;
    setErrorMsg('');
    if (!txnIdInput.trim() && !screenshotDataUrl.trim()) {
      setErrorMsg('Transaction ID or Transaction Screenshot is required to verify and generate License ID.');
      return;
    }
    setVerifyBusy(true);
    try {
      const res = await opsVerifyLicense(activePassword, verifyingLicense.id, {
        transactionId: txnIdInput.trim(),
        screenshotDataUrl: screenshotDataUrl.trim(),
      });
      setOverview({ licenses: res.licenses, plans: res.plans, settings: res.settings });
      setVerifyingLicense(null);
      setTxnIdInput('');
      setScreenshotDataUrl('');
      showToast(`Verified ${res.license.invoiceNo} -> Unique License ID ${res.license.licenseCode} generated!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleQuickUpdateLicense = async (
    id: string,
    payload: { status?: 'active' | 'deactivated'; extendDays?: number; expiresAt?: string },
    successLabel: string
  ) => {
    setErrorMsg('');
    try {
      const res = await opsUpdateLicense(activePassword, id, payload);
      setOverview({ licenses: res.licenses, plans: res.plans, settings: res.settings });
      showToast(successLabel);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleSavePlan = async (tier: PlanTier) => {
    setSavingTier(tier);
    setErrorMsg('');
    try {
      const res = await opsUpdatePlan(activePassword, tier, planDrafts[tier]);
      setOverview({ licenses: res.licenses, plans: res.plans, settings: res.settings });
      showToast(`Saved ${tier.toUpperCase()} pricing & feature matrix.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update plan');
    } finally {
      setSavingTier(null);
    }
  };

  const handleSavePasscodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPasscodes(true);
    setErrorMsg('');
    try {
      const res = await opsUpdatePasscodes(activePassword, {
        detachPasscode: detachPasscodeInput,
        newOpsPassword: newOpsPassInput.trim() || undefined,
      });
      setOverview({ licenses: res.licenses, plans: res.plans, settings: res.settings });
      if (newOpsPassInput.trim()) {
        setActivePassword(newOpsPassInput.trim());
        setNewOpsPassInput('');
      }
      showToast('Updated Detach License Passcode & Ops security settings.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed updating passcodes');
    } finally {
      setSavingPasscodes(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-6xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">
                Subscription Operations &amp; Licensing Console (OPS)
              </h2>
              <p className="text-[11px] text-slate-300">
                Verify customer payments with Transaction ID / Screenshot, manage Licenses, edit Plans &amp; Feature Locks, and configure Detach Passcodes.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-800 p-1 text-xs">
              <button
                type="button"
                onClick={() => setTab('queue')}
                className={`px-3 py-1.5 rounded-md font-semibold ${
                  tab === 'queue' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                License Queue ({overview.licenses.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('plans')}
                className={`px-3 py-1.5 rounded-md font-semibold ${
                  tab === 'plans' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                Edit Plans &amp; Features
              </button>
              <button
                type="button"
                onClick={() => setTab('passcodes')}
                className={`px-3 py-1.5 rounded-md font-semibold ${
                  tab === 'passcodes' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                Passcode Control
              </button>
              <button
                type="button"
                onClick={() => setTab('sheets')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold ${
                  tab === 'sheets' ? 'bg-emerald-600 text-white' : 'text-emerald-300 hover:text-white'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Google Sheets Sync
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Close Ops Console"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notices */}
        {(notice || errorMsg) && (
          <div className="px-6 pt-3 shrink-0">
            {notice && (
              <div className="px-3.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                {notice}
              </div>
            )}
            {errorMsg && (
              <div className="px-3.5 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {tab === 'queue' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[11px] text-slate-500">Total Orders</div>
                  <div className="text-lg font-extrabold font-mono text-slate-900 dark:text-white mt-0.5">
                    {metrics.total}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30">
                  <div className="text-[11px] text-amber-700 dark:text-amber-300">Pending Verification</div>
                  <div className="text-lg font-extrabold font-mono text-amber-800 dark:text-amber-200 mt-0.5">
                    {metrics.pending}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Active Licenses</div>
                  <div className="text-lg font-extrabold font-mono text-emerald-800 dark:text-emerald-200 mt-0.5">
                    {metrics.active}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[11px] text-slate-500">Verified License Revenue</div>
                  <div className="text-lg font-extrabold font-mono text-indigo-700 dark:text-indigo-400 mt-0.5">
                    {formatINR(metrics.revenue)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search customer, phone, invoice no, license ID, or Txn ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
                  {(['all', 'pending_verification', 'active', 'deactivated'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1 rounded-md font-semibold capitalize ${
                        statusFilter === st
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {st === 'pending_verification' ? 'Pending Queue' : st}
                    </button>
                  ))}
                </div>
              </div>

              {filteredLicenses.length === 0 ? (
                <div className="p-10 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-500">
                  No subscription orders or licenses match this filter.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredLicenses.map((lic) => (
                    <div
                      key={lic.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-white">
                            {lic.invoiceNo}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 font-bold uppercase text-[10px]">
                            {lic.tier} · {lic.deviceScope === 'desktop_mobile' ? 'Desktop + Mobile' : 'Desktop'} ·{' '}
                            {lic.duration === '3_years' ? '3Y' : '1Y'}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                              lic.status === 'active'
                                ? 'bg-emerald-100 text-emerald-700'
                                : lic.status === 'deactivated'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {lic.status === 'pending_verification' ? 'Pending Verification' : lic.status}
                          </span>
                          <span className="font-mono font-extrabold text-slate-900 dark:text-white">
                            {formatINR(lic.totalAmount)}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-slate-600 dark:text-slate-300">
                          <div>
                            Customer: <strong className="text-slate-900 dark:text-white">{lic.customerName}</strong>
                          </div>
                          <div>
                            Phone: <strong className="font-mono">{lic.phone}</strong>
                          </div>
                          <div>
                            GSTIN: <strong className="font-mono">{lic.gstin || 'N/A'}</strong>
                          </div>
                          <div>
                            Payment: <strong>{lic.paymentMode}</strong>
                          </div>
                          <div>
                            Txn ID: <strong className="font-mono">{lic.transactionId || 'Not entered'}</strong>
                          </div>
                          <div>
                            Ordered: <span className="font-mono">{lic.createdAt.slice(0, 10)}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <span className="font-mono font-bold text-indigo-700 dark:text-indigo-400">
                            License ID: {lic.licenseCode || 'PENDING VERIFY'}
                          </span>
                          {lic.expiresAt && (
                            <span className="text-slate-500">
                              Valid: <strong>{lic.validFrom}</strong> → <strong>{lic.expiresAt}</strong>
                            </span>
                          )}
                          {lic.screenshotDataUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewShot({
                                  title: `${lic.invoiceNo} · ${lic.customerName}`,
                                  url: lic.screenshotDataUrl,
                                })
                              }
                              className="inline-flex items-center gap-1 text-indigo-600 font-semibold hover:underline"
                            >
                              <Eye className="w-3.5 h-3.5" /> View Payment Screenshot
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {lic.status === 'pending_verification' && (
                          <button
                            type="button"
                            onClick={() => {
                              setVerifyingLicense(lic);
                              setTxnIdInput(lic.transactionId || lic.paymentRef || '');
                              setScreenshotDataUrl(lic.screenshotDataUrl || '');
                              setErrorMsg('');
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                          >
                            <BadgeCheck className="w-4 h-4" /> Verify &amp; Generate License
                          </button>
                        )}

                        {lic.status !== 'pending_verification' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickUpdateLicense(
                                  lic.id,
                                  { status: lic.status === 'active' ? 'deactivated' : 'active' },
                                  lic.status === 'active'
                                    ? `Deactivated license ${lic.licenseCode}`
                                    : `Reactivated license ${lic.licenseCode}`
                                )
                              }
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                                lic.status === 'active'
                                  ? 'border border-red-200 text-red-700 bg-red-50 hover:bg-red-100'
                                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                              {lic.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setExtendingLicense(lic);
                                setCustomExpiryDate(lic.expiresAt || new Date().toISOString().slice(0, 10));
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold"
                            >
                              <CalendarPlus className="w-3.5 h-3.5" /> Extend Validity
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => downloadLicenseInvoicePDF(lic, db?.profile)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-white dark:hover:bg-slate-800"
                        >
                          <Download className="w-3.5 h-3.5" /> Invoice PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'plans' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(['silver', 'gold', 'platinum'] as PlanTier[]).map((tier) => {
                const draft = planDrafts[tier];
                if (!draft) return null;
                return (
                  <div
                    key={tier}
                    className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-4 text-xs"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2.5">
                      <span className="text-sm font-extrabold uppercase text-slate-900 dark:text-white flex items-center gap-1.5">
                        <SlidersHorizontal className="w-4 h-4 text-indigo-600" /> {tier} Plan
                      </span>
                      <button
                        type="button"
                        disabled={savingTier === tier}
                        onClick={() => handleSavePlan(tier)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50"
                      >
                        {savingTier === tier ? 'Saving...' : 'Save Plan'}
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Display Name</label>
                        <input
                          value={draft.name}
                          onChange={(e) =>
                            setPlanDrafts((prev) => ({
                              ...prev,
                              [tier]: { ...prev[tier], name: e.target.value },
                            }))
                          }
                          className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Tagline</label>
                        <input
                          value={draft.tagline}
                          onChange={(e) =>
                            setPlanDrafts((prev) => ({
                              ...prev,
                              [tier]: { ...prev[tier], tagline: e.target.value },
                            }))
                          }
                          className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Desktop 1Y (₹)</label>
                          <input
                            type="number"
                            value={draft.priceDesktop1Y}
                            onChange={(e) =>
                              setPlanDrafts((prev) => ({
                                ...prev,
                                [tier]: { ...prev[tier], priceDesktop1Y: Number(e.target.value) },
                              }))
                            }
                            className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Desktop 3Y (₹)</label>
                          <input
                            type="number"
                            value={draft.priceDesktop3Y}
                            onChange={(e) =>
                              setPlanDrafts((prev) => ({
                                ...prev,
                                [tier]: { ...prev[tier], priceDesktop3Y: Number(e.target.value) },
                              }))
                            }
                            className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Desktop + Mobile 1Y (₹)</label>
                          <input
                            type="number"
                            value={draft.priceCombo1Y}
                            onChange={(e) =>
                              setPlanDrafts((prev) => ({
                                ...prev,
                                [tier]: { ...prev[tier], priceCombo1Y: Number(e.target.value) },
                              }))
                            }
                            className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Desktop + Mobile 3Y (₹)</label>
                          <input
                            type="number"
                            value={draft.priceCombo3Y}
                            onChange={(e) =>
                              setPlanDrafts((prev) => ({
                                ...prev,
                                [tier]: { ...prev[tier], priceCombo3Y: Number(e.target.value) },
                              }))
                            }
                            className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                          />
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                        <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                          Feature Lock / Unlock Controls
                        </div>
                        {OPS_FEATURES.map((f) => {
                          const unlocked = Boolean(draft.features[f.key]);
                          return (
                            <label
                              key={f.key}
                              className="flex items-center justify-between py-1 px-2 rounded hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={unlocked}
                                  onChange={(e) =>
                                    setPlanDrafts((prev) => ({
                                      ...prev,
                                      [tier]: {
                                        ...prev[tier],
                                        features: {
                                          ...prev[tier].features,
                                          [f.key]: e.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                  className="accent-indigo-600 w-3.5 h-3.5"
                                />
                                <span>{f.label}</span>
                              </span>
                              {unlocked ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Lock className="w-3 h-3 text-slate-400" />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'passcodes' && (
            <form
              onSubmit={handleSavePasscodes}
              className="max-w-lg p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-4 text-xs"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <Settings2 className="w-4 h-4 text-indigo-600" />
                License Detach Passcode &amp; Ops Password
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                Customers must enter the <strong>Detach Passcode</strong> whenever they click Detach License in the Subscription portal. Set or change it here anytime.
              </p>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Customer License Detach Passcode
                </label>
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-slate-400" />
                  <input
                    required
                    minLength={4}
                    value={detachPasscodeInput}
                    onChange={(e) => setDetachPasscodeInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  New Ops Panel Password (leave blank to keep current)
                </label>
                <input
                  type="password"
                  minLength={4}
                  placeholder="Optional new password (min 4 chars)"
                  value={newOpsPassInput}
                  onChange={(e) => setNewOpsPassInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={savingPasscodes}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:opacity-50"
              >
                {savingPasscodes ? 'Saving...' : 'Save Security Settings'}
              </button>
            </form>
          )}

          {tab === 'sheets' && (
            <div className="space-y-5 text-xs">
              {/* Connection Bar */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      Google Sheets &amp; Drive — Live Ops &amp; Performance Sync
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {googleToken && googleUser
                        ? `Connected as ${googleUser.displayName || 'Google User'} (${googleUser.email || 'Authorized'})`
                        : 'Sign in with Google to connect your spreadsheet and sync all live Ops, performance & runtime metrics.'}
                    </div>
                  </div>
                </div>

                {!googleToken ? (
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={handleGoogleSignIn}
                    className="inline-flex items-center gap-2.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold shadow-xs disabled:opacity-50"
                  >
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4 block">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                    <span>{authBusy ? 'Connecting...' : 'Sign in with Google'}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={driveBusy}
                      onClick={handleRefreshDriveList}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold hover:bg-slate-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${driveBusy ? 'animate-spin' : ''}`} />
                      Refresh Drive Sheets
                    </button>
                    <button
                      type="button"
                      onClick={handleGoogleLogout}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 font-semibold"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </div>
                )}
              </div>

              {/* Target Spreadsheet Selector + Create New */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-900 dark:text-white text-sm">
                      Target Google Sheet
                    </div>
                    <button
                      type="button"
                      disabled={!googleToken || inspectBusy}
                      onClick={handleCreateMasterSheet}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      Create New Ops Master Sheet
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      placeholder="Paste Google Sheet URL or Spreadsheet ID..."
                      value={sheetInput}
                      onChange={(e) => setSheetInput(e.target.value)}
                      className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                    <button
                      type="button"
                      disabled={!googleToken || inspectBusy || !sheetInput.trim()}
                      onClick={() => handleInspectSheet(sheetInput)}
                      className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-50"
                    >
                      {inspectBusy ? 'Loading...' : 'Select / Inspect Sheet'}
                    </button>
                  </div>

                  {driveFiles.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-500">
                        Or pick from your Google Drive spreadsheets ({driveFiles.length}):
                      </div>
                      <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                        {driveFiles.map((f) => (
                          <div
                            key={f.id}
                            className={`px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                              selectedSheet?.spreadsheetId === f.id ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : ''
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">{f.name}</div>
                              <div className="text-[10px] font-mono text-slate-400 truncate">
                                ID: {f.id} · Modified {f.modifiedTime?.slice(0, 10)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleInspectSheet(f.id)}
                              className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold shrink-0"
                            >
                              Use Sheet
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedSheet && (
                    <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-emerald-900 dark:text-emerald-200">
                            Selected: {selectedSheet.title}
                          </div>
                          <div className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                            ID: {selectedSheet.spreadsheetId}
                            {overview.settings.lastSheetSyncAt
                              ? ` · Last Synced: ${overview.settings.lastSheetSyncAt.slice(0, 19).replace('T', ' ')} UTC`
                              : ''}
                          </div>
                        </div>
                        <a
                          href={selectedSheet.spreadsheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-emerald-300 text-emerald-800 dark:text-emerald-300 font-semibold hover:underline"
                        >
                          Open Sheet <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      {selectedSheet.sheetTabs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {selectedSheet.sheetTabs.map((st) => (
                            <span
                              key={st.sheetId}
                              className="px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono"
                            >
                              {st.title}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Live Ops Telemetry & Sync Action */}
                <div className="lg:col-span-5 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-indigo-600" />
                        Live Ops &amp; System Performance
                      </div>
                      <button
                        type="button"
                        disabled={telemetryBusy}
                        onClick={loadTelemetry}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-semibold"
                      >
                        <RefreshCw className={`w-3 h-3 ${telemetryBusy ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>

                    {telemetry ? (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                          <div className="text-slate-500">Server Uptime</div>
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {telemetry.runtime.uptimeFormatted}
                          </div>
                          <div className="text-[10px] text-emerald-600 font-semibold">
                            {telemetry.runtime.serverStatus} · Port {telemetry.runtime.port}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                          <div className="text-slate-500">Memory RSS / Heap</div>
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {telemetry.runtime.memoryRssMb} MB
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Heap {telemetry.runtime.heapUsedMb}/{telemetry.runtime.heapTotalMb} MB
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                          <div className="text-slate-500">SQLite &amp; Sessions</div>
                          <div className="font-mono font-bold text-slate-900 dark:text-white flex items-center gap-1">
                            <Database className="w-3 h-3 text-indigo-600" />
                            {telemetry.runtime.dbFileSizeKb} KB
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {telemetry.runtime.sqliteTableCount} tables · {telemetry.runtime.activeSessionsCount} sessions
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                          <div className="text-slate-500">Workspaces &amp; Queues</div>
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {telemetry.companies.length} Firms
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {telemetry.runningOperations.length} running items · {telemetry.auditLogs.length} logs
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 text-center text-slate-400">Loading live Ops telemetry...</div>
                    )}

                    <div className="p-2.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-[11px] text-indigo-900 dark:text-indigo-200">
                      Sync writes <strong>6 structured tabs</strong>: {OPS_SHEET_TABS.join(', ')}.
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!googleToken || !selectedSheet || !telemetry || syncBusy}
                    onClick={() => setConfirmSyncOpen(true)}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm disabled:opacity-50"
                  >
                    Sync All Ops Data &amp; Performances to This Sheet
                  </button>
                </div>
              </div>

              {lastSyncResult && (
                <div className="p-4 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-emerald-900 dark:text-emerald-200">
                      Sync Completed — {lastSyncResult.totalRowsWritten} rows updated across{' '}
                      {lastSyncResult.tabsUpdated.length} tabs in &quot;{lastSyncResult.title}&quot;
                    </div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                      Tabs: {lastSyncResult.tabsUpdated.join(' · ')}
                    </div>
                  </div>
                  <a
                    href={lastSyncResult.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold"
                  >
                    Open Updated Google Sheet <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {/* Preview rows from inspected sheet */}
              {selectedSheet && selectedSheet.previewRows.length > 0 && (
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    Sheet Data Preview — Tab &quot;{selectedSheet.previewTabTitle}&quot; (Top {selectedSheet.previewRows.length} rows)
                  </div>
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-[11px] text-left">
                      <tbody>
                        {selectedSheet.previewRows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={
                              rIdx === 0
                                ? 'bg-slate-900 text-white font-bold'
                                : 'border-t border-slate-100 dark:border-slate-800'
                            }
                          >
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-2.5 py-1.5 whitespace-nowrap">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ops Payment Verification Modal (Mandatory Transaction ID or Screenshot) */}
      {verifyingLicense && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleVerifyConfirm}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-emerald-600" />
                  Verify Payment &amp; Issue Unique License ID
                </h3>
                <p className="text-[11px] text-slate-500">
                  {verifyingLicense.invoiceNo} · {verifyingLicense.customerName} ({formatINR(verifyingLicense.totalAmount)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVerifyingLicense(null)}
                className="p-1 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200">
                Enter the <strong>Transaction / UTR ID</strong> OR upload the <strong>Payment Screenshot</strong> below to verify payment and generate the customer&apos;s Unique License ID.
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Transaction ID / UTR Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. UTR429810293847"
                  value={txnIdInput}
                  onChange={(e) => setTxnIdInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Upload Transaction Screenshot (PNG/JPG/WEBP)
                </label>
                <label className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Upload className="w-4 h-4 text-indigo-600" />
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {screenshotDataUrl ? 'Screenshot Attached (Click to Replace)' : 'Choose Screenshot File'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                {screenshotDataUrl && (
                  <img
                    src={screenshotDataUrl}
                    alt="Payment proof"
                    className="mt-2 max-h-36 rounded-lg border border-slate-200 object-contain"
                  />
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVerifyingLicense(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifyBusy || (!txnIdInput.trim() && !screenshotDataUrl.trim())}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {verifyBusy ? 'Verifying...' : 'Confirm & Generate License ID'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Extend Validity Modal */}
      {extendingLicense && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Extend License Validity ({extendingLicense.licenseCode})
              </h3>
              <button type="button" onClick={() => setExtendingLicense(null)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '+30 Days', days: 30 },
                { label: '+90 Days', days: 90 },
                { label: '+1 Year', days: 365 },
              ].map((opt) => (
                <button
                  key={opt.days}
                  type="button"
                  onClick={async () => {
                    await handleQuickUpdateLicense(
                      extendingLicense.id,
                      { extendDays: opt.days },
                      `Extended ${extendingLicense.licenseCode} by ${opt.days} days`
                    );
                    setExtendingLicense(null);
                  }}
                  className="px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <label className="block font-semibold text-slate-600">Or Set Exact Expiry Date</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={customExpiryDate}
                  onChange={(e) => setCustomExpiryDate(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await handleQuickUpdateLicense(
                      extendingLicense.id,
                      { expiresAt: customExpiryDate },
                      `Updated expiry of ${extendingLicense.licenseCode} to ${customExpiryDate}`
                    );
                    setExtendingLicense(null);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white font-bold"
                >
                  Apply Date
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screenshot Preview Modal */}
      {previewShot && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-white dark:bg-slate-900 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>Payment Screenshot · {previewShot.title}</span>
              <button type="button" onClick={() => setPreviewShot(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <img src={previewShot.url} alt="Transaction Screenshot" className="w-full max-h-[70vh] object-contain rounded-lg" />
          </div>
        </div>
      )}

      {/* Mandatory User Confirmation Dialog Before Updating Google Sheet */}
      {confirmSyncOpen && selectedSheet && telemetry && (
        <div className="fixed inset-0 z-[70] bg-slate-950/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-xs">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                Confirm Google Sheet Update
              </div>
              <button type="button" onClick={() => setConfirmSyncOpen(false)} disabled={syncBusy}>
                <X className="w-4 h-4 text-slate-400 hover:text-white" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-slate-700 dark:text-slate-300">
                Are you sure you want to update the contents of Google Sheet{' '}
                <strong className="text-slate-900 dark:text-white">&quot;{selectedSheet.title}&quot;</strong>? Existing
                rows in the 6 Ops tabs below will be overwritten with fresh live telemetry:
              </p>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1 font-mono text-[11px]">
                {(() => {
                  const previewTabs = buildOpsSheetTabData(telemetry);
                  return OPS_SHEET_TABS.map((t) => (
                    <div key={t} className="flex justify-between">
                      <span>{t}</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">
                        {Math.max(0, previewTabs[t].length - 1)} data rows
                      </span>
                    </div>
                  ));
                })()}
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate">
                Target Spreadsheet ID: {selectedSheet.spreadsheetId}
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => setConfirmSyncOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 text-slate-700 dark:text-slate-200 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={syncBusy}
                onClick={handleExecuteConfirmedSync}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50"
              >
                {syncBusy ? 'Writing to Google Sheet...' : 'Confirm & Sync to Sheet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
