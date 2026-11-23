import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crown,
  Download,
  Edit3,
  FileText,
  Globe,
  History,
  Image as ImageIcon,
  Info,
  KeyRound,
  Link2,
  Lock,
  MessageSquare,
  Paperclip,
  PenTool,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import { OpsOverviewPayload, useStore } from '../context/StoreContext';
import {
  AppDatabase,
  AppSettings,
  BusinessProfile,
  InvoiceDesignConfig,
  PaperFormat,
  Voucher,
  VoucherType,
  WhatsAppStatusInfo,
} from '../types/accounting';
import { DEFAULT_APP_SETTINGS, mergeAppSettings } from '../utils/defaultAppSettings';
import { formatINR, INDIAN_STATES, INVOICE_TEMPLATES, todayISO } from '../utils/formatters';
import { getInvoicePdfBase64 } from '../utils/pdfGenerator';
import { generateInvoicePngBase64 } from '../utils/invoiceImageGenerator';
import { InvoiceRenderer } from './InvoiceRenderer';
import { OpsDashboardModal } from './OpsDashboardModal';

type SettingsSectionId =
  | 'GENERAL'
  | 'TRANSACTION'
  | 'PRINT'
  | 'TAXES_GST'
  | 'TRANSACTION_MESSAGE'
  | 'PARTY'
  | 'ITEM'
  | 'SERVICE_REMINDERS'
  | 'ACCOUNTING'
  | 'MULTI_CURRENCY'
  | 'RECYCLE_BIN';

const SIDEBAR_ITEMS: { id: SettingsSectionId; label: string; badge?: boolean; keywords: string }[] = [
  { id: 'GENERAL', label: 'GENERAL', keywords: 'passcode currency decimal gstin negative stock multi firm godown backup audit trail zoom scale dashboard widgets' },
  { id: 'TRANSACTION', label: 'TRANSACTION', keywords: 'invoice bill time cash billing name po inclusive tax round off prefix eway lite full sale' },
  { id: 'PRINT', label: 'PRINT', keywords: 'regular thermal printer theme layout colors logo address gstin signature digital seal words footer preview 24 templates' },
  { id: 'TAXES_GST', label: 'TAXES & GST', keywords: 'gst hsn sac reverse charge place of supply composite scheme tcs tds tax list' },
  { id: 'TRANSACTION_MESSAGE', label: 'TRANSACTION MESSAGE', keywords: 'whatsapp sms message party update web link payment link reminder edit preview' },
  { id: 'PARTY', label: 'PARTY', keywords: 'party grouping shipping address status payment reminder due days additional fields loyalty' },
  { id: 'ITEM', label: 'ITEM', keywords: 'item barcode stock manufacturing low stock unit category mrp serial batch exp mfg model size custom fields' },
  { id: 'SERVICE_REMINDERS', label: 'SERVICE REMINDERS', keywords: 'service amc warranty renewal reminder template' },
  { id: 'ACCOUNTING', label: 'ACCOUNTING', keywords: 'accounting double entry lock financial year backup restore clear reset demo' },
  { id: 'MULTI_CURRENCY', label: 'MULTI CURRENCY', badge: true, keywords: 'currency usd eur gbp aed inr exchange rate' },
  { id: 'RECYCLE_BIN', label: 'RECYCLE BIN', keywords: 'recycle bin deleted restore invoices vouchers bank accounts trash recover' },
];

const SETTING_CHECKBOX_STYLE = 'w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 accent-blue-600 cursor-pointer shrink-0';

const InfoTip: React.FC<{ text: string }> = ({ text }) => (
  <span title={text} className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-help shrink-0">
    <Info className="w-3.5 h-3.5" />
  </span>
);

const CheckRow: React.FC<{
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  tip?: string;
  trailing?: React.ReactNode;
}> = ({ checked, onChange, label, tip, trailing }) => (
  <div className="flex items-center gap-2.5 py-1.5 text-[13px] text-slate-700">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className={SETTING_CHECKBOX_STYLE}
    />
    <span onClick={() => onChange(!checked)} className="cursor-pointer select-none leading-snug">
      {label}
    </span>
    {tip && <InfoTip text={tip} />}
    {trailing}
  </div>
);

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="inline-flex items-center gap-2 text-xs text-slate-500"
  >
    <span
      className={`w-8 h-4 rounded-full p-0.5 transition-colors inline-flex items-center ${
        checked ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'
      }`}
    >
      <span className="w-3 h-3 rounded-full bg-white shadow" />
    </span>
    {label && <span>{label}</span>}
  </button>
);

export const SettingsToolsView: React.FC = () => {
  const {
    db,
    updateProfile,
    createCompany,
    switchCompany,
    saveCurrencyRate,
    clearDemoData,
    resetToDemo,
    importDatabase,
    restoreFromRecycleBin,
    deleteRecycleBinItem,
    emptyRecycleBin,
    getEffectivePaid,
    opsAuth,
    getWhatsAppStatus,
    connectWhatsApp,
    disconnectWhatsApp,
    sendTransactionWhatsApp,
  } = useStore();

  const [section, setSection] = useState<SettingsSectionId>('GENERAL');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  // Local editable copy synced from db.profile
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => mergeAppSettings(null));
  const [passcodeDraft, setPasscodeDraft] = useState('');

  // WhatsApp QR & Test Dispatch state
  const [waStatus, setWaStatus] = useState<WhatsAppStatusInfo>({
    status: 'disconnected',
    updatedAt: '',
  });
  const [waConnecting, setWaConnecting] = useState(false);
  const [waTestPhone, setWaTestPhone] = useState('');
  const [waTestBusy, setWaTestBusy] = useState(false);

  // Sub-modals & inline helpers
  const [showAddFirm, setShowAddFirm] = useState(false);
  const [newFirm, setNewFirm] = useState({ companyName: '', gstin: '', state: 'Maharashtra', financialYear: '2026-27' });
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showTaxListModal, setShowTaxListModal] = useState(false);
  const [printSubTab, setPrintSubTab] = useState<'layout' | 'colors' | 'signature'>('layout');
  const [msgTxnType, setMsgTxnType] = useState<'Sales Transaction' | 'Payment In' | 'Estimate'>('Sales Transaction');
  const [customItemFieldInput, setCustomItemFieldInput] = useState('');
  const [newCurr, setNewCurr] = useState({ code: 'AED', name: 'UAE Dirham', symbol: 'AED', rateToInr: 22.9 });
  const [confirmEmptyBin, setConfirmEmptyBin] = useState(false);
  const [confirmForeverId, setConfirmForeverId] = useState<string | null>(null);

  // Hidden Ops Panel trigger (Settings -> MULTI CURRENCY -> type "SUBS" -> password 112233)
  const [showOpsPasswordModal, setShowOpsPasswordModal] = useState(false);
  const [opsPasswordInput, setOpsPasswordInput] = useState('');
  const [opsAuthError, setOpsAuthError] = useState('');
  const [opsAuthBusy, setOpsAuthBusy] = useState(false);
  const [opsSession, setOpsSession] = useState<{ password: string; overview: OpsOverviewPayload } | null>(null);
  const subsKeyBufferRef = useRef('');

  // Signature canvas pad refs
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingSig = useRef(false);

  useEffect(() => {
    if (section !== 'TRANSACTION_MESSAGE') return;
    let active = true;
    const poll = async () => {
      try {
        const info = await getWhatsAppStatus();
        if (active) setWaStatus(info);
      } catch {
        // ignore transient polling failure
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [section, getWhatsAppStatus]);

  useEffect(() => {
    if (section !== 'MULTI_CURRENCY' || showOpsPasswordModal || opsSession) {
      subsKeyBufferRef.current = '';
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
        subsKeyBufferRef.current = (subsKeyBufferRef.current + e.key.toUpperCase()).slice(-8);
        if (subsKeyBufferRef.current.endsWith('SUBS')) {
          subsKeyBufferRef.current = '';
          setOpsAuthError('');
          setOpsPasswordInput('');
          setShowOpsPasswordModal(true);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [section, showOpsPasswordModal, opsSession]);

  useEffect(() => {
    if (db?.profile) {
      setProfile(db.profile);
      const merged = mergeAppSettings(db.profile.appSettings);
      setSettings(merged);
      setPasscodeDraft(merged.general.passcode || '');
    }
  }, [db?.profile]);

  const filteredSidebar = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SIDEBAR_ITEMS;
    return SIDEBAR_ITEMS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.keywords.includes(q)
    );
  }, [searchQuery]);

  if (!db || !profile) return null;

  const notify = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const commitChanges = async (nextProfile: BusinessProfile, nextSettings: AppSettings, toastMsg?: string) => {
    setProfile(nextProfile);
    setSettings(nextSettings);
    setSaving(true);
    try {
      await updateProfile({
        ...nextProfile,
        appSettings: nextSettings,
      });
      if (toastMsg) notify(toastMsg);
    } finally {
      setSaving(false);
    }
  };

  const patchGeneral = <K extends keyof AppSettings['general']>(key: K, value: AppSettings['general'][K]) => {
    const next = { ...settings, general: { ...settings.general, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchTxn = <K extends keyof AppSettings['transaction']>(key: K, value: AppSettings['transaction'][K]) => {
    const next = { ...settings, transaction: { ...settings.transaction, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchPrint = <K extends keyof AppSettings['print']>(key: K, value: AppSettings['print'][K]) => {
    const next = { ...settings, print: { ...settings.print, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchGst = <K extends keyof AppSettings['gst']>(key: K, value: AppSettings['gst'][K]) => {
    const next = { ...settings, gst: { ...settings.gst, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchMsg = <K extends keyof AppSettings['message']>(key: K, value: AppSettings['message'][K]) => {
    const next = { ...settings, message: { ...settings.message, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchParty = <K extends keyof AppSettings['party']>(key: K, value: AppSettings['party'][K]) => {
    const next = { ...settings, party: { ...settings.party, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchItem = <K extends keyof AppSettings['item']>(key: K, value: AppSettings['item'][K]) => {
    const next = { ...settings, item: { ...settings.item, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchService = <K extends keyof AppSettings['serviceReminder']>(
    key: K,
    value: AppSettings['serviceReminder'][K]
  ) => {
    const next = { ...settings, serviceReminder: { ...settings.serviceReminder, [key]: value } };
    void commitChanges(profile, next);
  };

  const patchAccounting = <K extends keyof AppSettings['accounting']>(
    key: K,
    value: AppSettings['accounting'][K]
  ) => {
    const next = { ...settings, accounting: { ...settings.accounting, [key]: value } };
    void commitChanges(profile, next);
  };

  const handleBackupDownload = async () => {
    const now = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const nextSettings = { ...settings, general: { ...settings.general, lastBackupAt: now } };
    await commitChanges(profile, nextSettings, 'Full SQLite JSON backup downloaded');
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shobhit_invoice_pro_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRestoreFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AppDatabase;
        if (!parsed.profile || !Array.isArray(parsed.vouchers)) {
          notify('Invalid backup JSON format');
          return;
        }
        await importDatabase(parsed);
        notify('Restored backup JSON successfully!');
      } catch {
        notify('Failed to parse JSON backup file.');
      }
    };
    reader.readAsText(file);
  };

  const handleLogoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const nextProf = { ...profile, logoDataUrl: String(reader.result || '') };
      void commitChanges(nextProf, settings, 'Company logo updated');
    };
    reader.readAsDataURL(file);
  };

  const handleSignatureUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const nextProf: BusinessProfile = {
        ...profile,
        signatureDataUrl: String(reader.result || ''),
        invoiceConfig: {
          ...profile.invoiceConfig,
          showSignature: true,
          signatureMode: 'image',
        },
      };
      void commitChanges(nextProf, settings, 'Uploaded digital signature image saved');
    };
    reader.readAsDataURL(file);
  };

  const getSigPos = (e: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleSigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture(e.pointerId);
    isDrawingSig.current = true;
    const { x, y } = getSigPos(e, canvas);
    ctx.strokeStyle = '#1E3A8A';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleSigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig.current) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getSigPos(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handleSigPointerUp = () => {
    isDrawingSig.current = false;
  };

  const clearSigCanvas = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const saveDrawnSigCanvas = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const nextProf: BusinessProfile = {
      ...profile,
      signatureDataUrl: dataUrl,
      invoiceConfig: {
        ...profile.invoiceConfig,
        showSignature: true,
        signatureMode: 'drawn',
      },
    };
    void commitChanges(nextProf, settings, 'Drawn digital signature saved for invoices & PDFs');
  };

  const fallbackSampleVoucher: Voucher = db.vouchers.find((v) => v.type === 'sale_invoice' && v.lines.length > 0) ||
    db.vouchers[0] || {
      id: 'sample_preview',
      type: 'sale_invoice',
      voucherNo: `${profile.prefixes.sale_invoice || 'INV-'}101`,
      date: todayISO(),
      dueDate: todayISO(),
      partyName: 'Classic Enterprises',
      partyGstin: '29AABCC1234D1Z5',
      placeOfSupply: profile.state,
      isInterState: false,
      lines: [
        {
          id: 's1',
          itemId: 'sample',
          itemName: 'Finolex 1.5 sqmm Wire',
          description: '90m Flame Retardant Coil',
          hsn: '8544',
          qty: 2,
          unit: 'COIL',
          mrp: 1650,
          rate: 1450,
          discountPct: 0,
          taxableAmount: 2900,
          taxRate: 18,
          cgst: 261,
          sgst: 261,
          igst: 0,
          cessRate: 0,
          cess: 0,
          total: 3422,
        },
      ],
      additionalCharges: 0,
      discountTotal: 0,
      roundOff: 0,
      subTotal: 2900,
      taxTotal: 522,
      grandTotal: 3422,
      paidAmount: 3422,
      paymentMode: 'UPI',
      status: 'paid',
      notes: 'Standard B2B Dispatch',
      createdAt: new Date().toISOString(),
    };

  const previewParty = fallbackSampleVoucher.partyId
    ? db.parties.find((p) => p.id === fallbackSampleVoucher.partyId)
    : undefined;
  const previewBank = db.bankAccounts.find((b) => b.type === 'bank') || db.bankAccounts[0];
  const recycleCount = (db.recycleBin || []).length;

  const zoomOptions = [70, 80, 90, 100, 110, 115, 120, 130];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row min-h-[720px] text-slate-800">
      {/* LEFT DARK VERTICAL SETTINGS NAVIGATION (Exact Vyapar Format) */}
      <aside className="w-full md:w-56 shrink-0 bg-[#151B28] text-white flex flex-col">
        <div className="px-4 py-4 flex items-center justify-between border-b border-white/10">
          {searchOpen ? (
            <div className="flex items-center gap-1.5 w-full bg-white/10 rounded-md px-2 py-1">
              <Search className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search settings..."
                className="w-full bg-transparent text-xs text-white placeholder-slate-400 focus:outline-none"
              />
              <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }}>
                <X className="w-3.5 h-3.5 text-slate-300" />
              </button>
            </div>
          ) : (
            <>
              <span className="text-base font-bold tracking-tight">Settings</span>
              <button
                onClick={() => setSearchOpen(true)}
                className="p-1 rounded hover:bg-white/10 text-slate-200"
                title="Search Settings"
              >
                <Search className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {filteredSidebar.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`w-full text-left px-4 py-3 text-[12px] tracking-wide flex items-center justify-between gap-2 transition-colors ${
                  active
                    ? 'bg-white text-slate-900 font-bold'
                    : 'text-slate-200 hover:bg-white/10 font-medium'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="truncate">{item.label}</span>
                  {item.badge && <Crown className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                </span>
                {item.id === 'RECYCLE_BIN' && recycleCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-blue-600 text-white">
                    {recycleCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 text-[11px] text-slate-400 flex items-center justify-between">
          <span>{saving ? 'Saving...' : 'Synced to SQLite'}</span>
          <span className="font-mono text-sky-300">{settings.general.zoomPct}%</span>
        </div>
      </aside>

      {/* RIGHT WHITE SETTINGS CONTENT PANE */}
      <div className="flex-1 bg-white flex flex-col min-w-0 relative">
        {notice && (
          <div className="px-5 py-2 bg-blue-50 border-b border-blue-200 text-blue-800 text-xs font-semibold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> {notice}
            </span>
            <button onClick={() => setNotice('')} className="underline text-[11px]">Dismiss</button>
          </div>
        )}

        {/* SECTION 1: GENERAL */}
        {section === 'GENERAL' && (
          <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Col 1: Application + More Transactions */}
            <div className="space-y-6">
              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Application
                </h3>
                <div className="space-y-2">
                  <CheckRow
                    checked={settings.general.enablePasscode}
                    onChange={(v) => {
                      if (!v) {
                        const next = {
                          ...settings,
                          general: { ...settings.general, enablePasscode: false, passcode: '' },
                        };
                        setPasscodeDraft('');
                        void commitChanges(profile, next, 'Passcode disabled and removed');
                      } else {
                        patchGeneral('enablePasscode', true);
                      }
                    }}
                    label="Enable Passcode"
                    tip="Lock access to Shobhit Invoice Pro using the top header Lock button or PIN"
                  />
                  {settings.general.enablePasscode && (
                    <div className="pl-6 space-y-2 py-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="password"
                          maxLength={12}
                          value={passcodeDraft}
                          onChange={(e) => setPasscodeDraft(e.target.value)}
                          placeholder="Enter PIN / Passcode"
                          className="px-2.5 py-1.5 border border-slate-300 rounded text-xs w-36 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = passcodeDraft.trim();
                            if (!clean) {
                              notify('Please enter a passcode before saving.');
                              return;
                            }
                            const next = {
                              ...settings,
                              general: { ...settings.general, enablePasscode: true, passcode: clean },
                            };
                            void commitChanges(profile, next, 'Passcode saved! Use header Lock button anytime.');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                        >
                          <Lock className="w-3 h-3" /> Save Passcode
                        </button>
                        {settings.general.passcode && (
                          <button
                            type="button"
                            onClick={() => {
                              setPasscodeDraft('');
                              const next = {
                                ...settings,
                                general: { ...settings.general, enablePasscode: false, passcode: '' },
                              };
                              void commitChanges(profile, next, 'Passcode removed successfully');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold"
                          >
                            Remove Passcode
                          </button>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {settings.general.passcode
                          ? 'Passcode active — click Lock in top bar to lock workspace immediately.'
                          : 'Enter digits/characters and click Save Passcode.'}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 py-1.5 text-[13px] text-slate-700">
                    <span className="flex items-center gap-1">
                      Business Currency <InfoTip text="Primary accounting currency symbol" />
                    </span>
                    <select
                      value={db.currencyRates[0]?.symbol || '₹'}
                      onChange={async (e) => {
                        const sym = e.target.value;
                        const code = sym === '₹' ? 'INR' : sym === '$' ? 'USD' : sym === '€' ? 'EUR' : 'AED';
                        await saveCurrencyRate({ code, name: code, symbol: sym, rateToInr: sym === '₹' ? 1 : 84, updatedAt: new Date().toISOString().slice(0, 10) });
                        notify(`Business currency updated to ${sym}`);
                      }}
                      className="px-2.5 py-1 border-b border-slate-300 text-xs font-semibold bg-white focus:outline-none"
                    >
                      <option value="₹">₹ (INR)</option>
                      <option value="$">$ (USD)</option>
                      <option value="€">€ (EUR)</option>
                      <option value="AED">AED</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-3 py-1.5 text-[13px] text-slate-700">
                    <div>
                      <div>Amount</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        (upto Decimal Places) <InfoTip text="Decimal precision for line totals" />
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={4}
                      value={settings.general.decimalPlaces}
                      onChange={(e) => patchGeneral('decimalPlaces', Math.max(0, Math.min(4, Number(e.target.value))))}
                      className="w-12 px-2 py-1 border border-slate-300 rounded text-xs text-center"
                    />
                    <span className="text-xs text-slate-500">
                      e.g. 0.{Array(settings.general.decimalPlaces).fill('0').join('') || '0'}
                    </span>
                  </div>

                  <CheckRow
                    checked={settings.general.enableGstin}
                    onChange={(v) => patchGeneral('enableGstin', v)}
                    label="GSTIN Number"
                    tip="Enable GSTIN field for company & parties"
                  />
                  <CheckRow
                    checked={settings.general.stopNegativeStock}
                    onChange={(v) => patchGeneral('stopNegativeStock', v)}
                    label="Stop Sale on Negative Stock"
                    tip="Block billing if item stock reaches zero"
                  />
                  <CheckRow
                    checked={settings.general.blockNewItemsFromTxn}
                    onChange={(v) => patchGeneral('blockNewItemsFromTxn', v)}
                    label="Block New Items from Txn Form"
                    tip="Require items to be created in Inventory master first"
                  />
                  <CheckRow
                    checked={settings.general.blockNewPartiesFromTxn}
                    onChange={(v) => patchGeneral('blockNewPartiesFromTxn', v)}
                    label="Block New Parties from Txn Form"
                    tip="Require parties to be created in Party master first"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  More Transactions
                </h3>
                <div className="space-y-1.5">
                  <CheckRow checked={settings.general.enableEstimate} onChange={(v) => patchGeneral('enableEstimate', v)} label="Estimate/Quotation" tip="Enable customer estimates & quotes" />
                  <CheckRow checked={settings.general.enableProforma} onChange={(v) => patchGeneral('enableProforma', v)} label="Proforma Invoice" tip="Enable proforma invoices" />
                  <CheckRow checked={settings.general.enableOrders} onChange={(v) => patchGeneral('enableOrders', v)} label="Sale/Purchase Order" tip="Track sales and purchase orders" />
                  <CheckRow checked={settings.general.enableOtherIncome} onChange={(v) => patchGeneral('enableOtherIncome', v)} label="Other Income" tip="Record indirect income receipts" />
                  <CheckRow checked={settings.general.enableFixedAssets} onChange={(v) => patchGeneral('enableFixedAssets', v)} label="Fixed Assets (FA)" tip="Fixed asset register tracking" />
                  <CheckRow checked={settings.general.enableDeliveryChallan} onChange={(v) => patchGeneral('enableDeliveryChallan', v)} label="Delivery Challan" tip="Enable dispatch delivery challans" />
                </div>
              </div>
            </div>

            {/* Col 2: Multi Firm + Stock Transfer Between Godowns */}
            <div className="space-y-8">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-3">
                  <label className="flex items-center gap-2 text-[14px] font-bold text-slate-900 cursor-pointer">
                    <input type="checkbox" checked readOnly className={SETTING_CHECKBOX_STYLE} />
                    Multi Firm
                  </label>
                  <button
                    onClick={() => setShowAddFirm((p) => !p)}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    + Add Firm <InfoTip text="Create and manage multiple companies/firms under one login" />
                  </button>
                </div>

                {showAddFirm && (
                  <div className="p-3 mb-3 rounded-lg border border-blue-200 bg-blue-50/40 space-y-2 text-xs">
                    <input
                      placeholder="New Firm / Company Name"
                      value={newFirm.companyName}
                      onChange={(e) => setNewFirm({ ...newFirm, companyName: e.target.value })}
                      className="w-full px-2.5 py-1.5 border rounded bg-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        placeholder="GSTIN (Optional)"
                        value={newFirm.gstin}
                        onChange={(e) => setNewFirm({ ...newFirm, gstin: e.target.value.toUpperCase() })}
                        className="px-2.5 py-1.5 border rounded bg-white font-mono"
                      />
                      <select
                        value={newFirm.state}
                        onChange={(e) => setNewFirm({ ...newFirm, state: e.target.value })}
                        className="px-2 py-1.5 border rounded bg-white"
                      >
                        {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowAddFirm(false)} className="px-2.5 py-1 text-slate-500">Cancel</button>
                      <button
                        onClick={async () => {
                          if (!newFirm.companyName.trim()) return;
                          await createCompany(newFirm);
                          setNewFirm({ companyName: '', gstin: '', state: 'Maharashtra', financialYear: '2026-27' });
                          setShowAddFirm(false);
                          notify(`Created and switched to ${newFirm.companyName}`);
                        }}
                        className="px-3 py-1 rounded bg-blue-600 text-white font-semibold"
                      >
                        Create Firm
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {db.companies.map((c) => {
                    const isActive = c.id === profile.id;
                    return (
                      <div
                        key={c.id}
                        onClick={() => !isActive && void switchCompany(c.id)}
                        className={`p-3 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition ${
                          isActive ? 'border-blue-500 bg-white' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isActive ? 'border-blue-600' : 'border-slate-300'}`}>
                            {isActive && <span className="w-2 h-2 rounded-full bg-blue-600" />}
                          </span>
                          <span className="text-[13px] font-semibold text-slate-800 truncate">{c.companyName}</span>
                          {isActive && (
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide shrink-0">
                              DEFAULT · <span className="text-blue-600">ALL DEVICES</span>
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSection('PRINT');
                          }}
                          className="p-1 text-slate-400 hover:text-blue-600"
                          title="Edit firm header details"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Stock Transfer Between Godowns
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed mb-3">
                  Manage all your stores/godowns and transfer stock seamlessly between them. Using this feature, you can transfer stock between stores/godowns and manage your inventory more efficiently.
                </p>
                <CheckRow
                  checked={settings.general.enableGodownTransfer}
                  onChange={(v) => patchGeneral('enableGodownTransfer', v)}
                  label="Godown management & Stock transfer"
                  tip="Enable multi-godown warehouse stock tracking"
                />
              </div>
            </div>

            {/* Col 3: Backup & History + Customize Your View */}
            <div className="space-y-8">
              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Backup &amp; History
                </h3>
                <div className="space-y-2.5">
                  <CheckRow
                    checked={settings.general.autoBackup}
                    onChange={(v) => patchGeneral('autoBackup', v)}
                    label="Auto Backup"
                    tip="Maintain snapshot backups automatically"
                  />
                  <div className="pl-6 text-xs text-slate-500 flex items-center gap-1.5">
                    <span>Last Backup {settings.general.lastBackupAt || '20/07/2025 | 01:07 AM'}</span>
                    <InfoTip text="Download full local JSON snapshot below" />
                  </div>
                  <CheckRow
                    checked={settings.general.auditTrail}
                    onChange={(v) => patchGeneral('auditTrail', v)}
                    label="Audit Trail"
                    tip="Track every create, update & delete activity"
                  />
                  <div className="pl-6 flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={handleBackupDownload}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600" /> Backup JSON
                    </button>
                    <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <Upload className="w-3.5 h-3.5 text-indigo-600" /> Restore
                      <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleRestoreFile(f);
                        }}
                      />
                    </label>
                    <button
                      onClick={() => setShowAuditModal(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <History className="w-3.5 h-3.5 text-slate-600" /> View Audit ({db.auditLogs.length})
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Customize Your View
                </h3>
                <div className="text-[13px] font-semibold text-slate-700 mb-1">Choose Your Screen Zoom/Scale</div>
                <p className="text-xs text-slate-500 mb-4">
                  You can use this setting to resize the Shobhit Invoice Pro screen, making it larger or smaller to fit your preferences.
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <input
                      type="range"
                      min={0}
                      max={zoomOptions.length - 1}
                      value={Math.max(0, zoomOptions.indexOf(settings.general.zoomPct))}
                      onChange={(e) => {
                        const pct = zoomOptions[Number(e.target.value)] || 100;
                        setSettings({ ...settings, general: { ...settings.general, zoomPct: pct } });
                      }}
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                      {zoomOptions.map((z) => (
                        <span key={z} className={settings.general.zoomPct === z ? 'font-bold text-blue-600' : ''}>
                          {z}%
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => commitChanges(profile, settings, `Applied screen scale ${settings.general.zoomPct}%`)}
                    className="px-4 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Dashboard Grid Visibility (ON / OFF)
                </h3>
                <p className="text-xs text-slate-500 mb-2">
                  Toggle which grid cards, charts &amp; widgets show below the header on the Dashboard.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {(
                    [
                      ['showQuickActions', 'Quick Action Buttons'],
                      ['showKpis', '8-Card Financial KPIs'],
                      ['showRevenueChart', 'Revenue vs Expense Chart'],
                      ['showPendingReminders', 'Payment Reminders'],
                      ['showTopProducts', 'Top-Selling Products'],
                      ['showTopCustomers', 'Top Customers'],
                      ['showLowStock', 'Low Stock Watchlist'],
                      ['showRecentVouchers', 'Recent Vouchers Table'],
                    ] as const
                  ).map(([key, label]) => {
                    const dw = {
                      showQuickActions: true,
                      showKpis: true,
                      showRevenueChart: true,
                      showPendingReminders: true,
                      showTopProducts: true,
                      showTopCustomers: true,
                      showLowStock: true,
                      showRecentVouchers: true,
                      ...(settings.general.dashboardWidgets || {}),
                    };
                    return (
                      <CheckRow
                        key={key}
                        checked={dw[key]}
                        onChange={(v) =>
                          patchGeneral('dashboardWidgets', {
                            ...dw,
                            [key]: v,
                          })
                        }
                        label={label}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: TRANSACTION */}
        {section === 'TRANSACTION' && (
          <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Col 1 */}
            <div className="space-y-6">
              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Transaction Header
                </h3>
                <div className="space-y-1.5">
                  <CheckRow checked={settings.transaction.showInvoiceNo} onChange={(v) => patchTxn('showInvoiceNo', v)} label="Invoice/Bill No." tip="Auto-assign sequential voucher numbers" />
                  <CheckRow checked={settings.transaction.addTimeOnTxn} onChange={(v) => patchTxn('addTimeOnTxn', v)} label="Add Time on Transactions" tip="Print exact timestamp on invoices" />
                  <CheckRow checked={settings.transaction.cashSaleByDefault} onChange={(v) => patchTxn('cashSaleByDefault', v)} label="Cash Sale by default" tip="Default POS & quick sales to Cash" />
                  <CheckRow checked={settings.transaction.billingNameOfParties} onChange={(v) => patchTxn('billingNameOfParties', v)} label="Billing Name of Parties" tip="Print alternate billing alias" />
                  <CheckRow checked={settings.transaction.customerPoDetails} onChange={(v) => patchTxn('customerPoDetails', v)} label="Customers P.O. Details on Transactions" tip="Show buyer purchase order ref" />
                </div>
              </div>

              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  More Transaction Features
                </h3>
                <div className="space-y-1.5">
                  <CheckRow checked={settings.transaction.ewayBillNo} onChange={(v) => patchTxn('ewayBillNo', v)} label="E-way bill no" tip="Include E-Way Bill No. on sales" />
                  <CheckRow checked={settings.transaction.quickEntry} onChange={(v) => patchTxn('quickEntry', v)} label="Quick Entry" tip="Streamlined rapid item entry mode" />
                  <CheckRow checked={settings.transaction.hideInvoicePreview} onChange={(v) => patchTxn('hideInvoicePreview', v)} label="Do not Show Invoice Preview" tip="Skip preview popup after saving" />
                  <CheckRow checked={settings.transaction.repeatInvoices} onChange={(v) => patchTxn('repeatInvoices', v)} label="Repeat Invoices" tip="Enable recurring invoice schedule" />
                  <CheckRow checked={settings.transaction.txnPasscode} onChange={(v) => patchTxn('txnPasscode', v)} label="Enable Passcode for transaction edit/delete" tip="Require passcode to modify past vouchers" />
                  <CheckRow checked={settings.transaction.discountDuringPayments} onChange={(v) => patchTxn('discountDuringPayments', v)} label="Discount During Payments" tip="Allow cash discount while settling bills" />
                  <CheckRow checked={settings.transaction.linkPaymentsToInvoices} onChange={(v) => patchTxn('linkPaymentsToInvoices', v)} label="Link Payments to Invoices" tip="Bill-by-bill receipt matching" />
                  <CheckRow checked={settings.transaction.dueDatesAndTerms} onChange={(v) => patchTxn('dueDatesAndTerms', v)} label="Due Dates and Payment Terms" tip="Track payment due dates & aging" />
                </div>
              </div>
            </div>

            {/* Col 2 */}
            <div className="space-y-6">
              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Items Table
                </h3>
                <div className="space-y-1.5">
                  <CheckRow checked={settings.transaction.inclusiveTaxOnRate} onChange={(v) => patchTxn('inclusiveTaxOnRate', v)} label="Inclusive/Exclusive Tax on Rate(Price/Unit)" tip="Toggle tax inclusive item pricing" />
                  <CheckRow checked={settings.transaction.displayPurchasePrice} onChange={(v) => patchTxn('displayPurchasePrice', v)} label="Display Purchase Price of Items" tip="Show purchase cost helper in billing" />
                  <CheckRow checked={settings.transaction.showLast5SalePrice} onChange={(v) => patchTxn('showLast5SalePrice', v)} label="Show last 5 Sale Price of Items" tip="Show historical party sale rates" />
                  <CheckRow checked={settings.transaction.showLast5PurchasePrice} onChange={(v) => patchTxn('showLast5PurchasePrice', v)} label="Show last 5 Purchase Price of Items" tip="Show historical supplier rates" />
                  <CheckRow checked={settings.transaction.freeItemQty} onChange={(v) => patchTxn('freeItemQty', v)} label="Free Item Quantity" tip="Allow bonus/free qty column" />
                  <CheckRow checked={settings.transaction.showCount} onChange={(v) => patchTxn('showCount', v)} label="Count" tip="Add package count column" />
                </div>
              </div>

              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Transaction Prefixes
                </h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Firm</label>
                    <input readOnly value={profile.companyName} className="w-full px-3 py-2 border border-slate-200 rounded bg-slate-50 font-medium" />
                  </div>
                  <div className="p-3 border border-slate-200 rounded-lg space-y-2.5">
                    <div className="text-[11px] font-semibold text-slate-500">Prefixes</div>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(
                        [
                          ['Sale', 'sale_invoice'],
                          ['Credit Note', 'credit_note'],
                          ['Sale Order', 'sale_order'],
                          ['Purchase Order', 'purchase_order'],
                          ['Estimate', 'estimate'],
                          ['Proforma Invoice', 'proforma'],
                          ['Delivery Challan', 'delivery_challan'],
                          ['Payment In', 'payment_in'],
                        ] as [string, VoucherType][]
                      ).map(([label, key]) => (
                        <div key={key}>
                          <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
                          <input
                            value={profile.prefixes[key] || ''}
                            onChange={(e) => {
                              const nextProf = {
                                ...profile,
                                prefixes: { ...profile.prefixes, [key]: e.target.value },
                              };
                              void commitChanges(nextProf, settings);
                            }}
                            placeholder="None"
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Col 3 */}
            <div className="space-y-6">
              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Taxes, Discount &amp; Totals
                </h3>
                <div className="space-y-2">
                  <CheckRow checked={settings.transaction.txnWiseTax} onChange={(v) => patchTxn('txnWiseTax', v)} label="Transaction wise Tax" tip="Apply flat GST rate on entire invoice" />
                  <CheckRow checked={settings.transaction.txnWiseDiscount} onChange={(v) => patchTxn('txnWiseDiscount', v)} label="Transaction wise Discount" tip="Allow bill-level extra discount" />
                  <CheckRow checked={settings.transaction.roundOffTotal} onChange={(v) => patchTxn('roundOffTotal', v)} label="Round Off Total" tip="Auto round invoice total to nearest rupee" />
                  {settings.transaction.roundOffTotal && (
                    <div className="flex items-center gap-2 pl-6 pt-1 text-xs">
                      <select
                        value={settings.transaction.roundOffMethod}
                        onChange={(e) => patchTxn('roundOffMethod', e.target.value as 'Nearest' | 'Up' | 'Down')}
                        className="px-2 py-1 border-b border-slate-300 bg-white"
                      >
                        <option>Nearest</option>
                        <option>Up</option>
                        <option>Down</option>
                      </select>
                      <span className="text-slate-500">To</span>
                      <select
                        value={settings.transaction.roundOffTo}
                        onChange={(e) => patchTxn('roundOffTo', Number(e.target.value))}
                        className="px-2 py-1 border-b border-slate-300 bg-white"
                      >
                        <option value={1}>1</option>
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Billing Type
                </h3>
                <div className="space-y-2 text-[13px]">
                  {[
                    { id: 'lite' as const, label: 'Lite Sale' },
                    { id: 'full' as const, label: 'Full Sale' },
                  ].map((opt) => (
                    <label key={opt.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                      <input
                        type="radio"
                        name="billing_type"
                        checked={settings.transaction.billingType === opt.id}
                        onChange={() => patchTxn('billingType', opt.id)}
                        className="accent-blue-600"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: PRINT + ALL 24 INVOICE DESIGNS + DIGITAL SIGNATURE + LIVE PREVIEW */}
        {section === 'PRINT' && (
          <div className="flex-1 flex flex-col lg:flex-row">
            {/* Left Settings Column */}
            <div className="w-full lg:w-[46%] p-6 border-b lg:border-b-0 lg:border-r border-slate-200 overflow-y-auto max-h-[820px] space-y-5">
              {/* Regular / Thermal Sub-tabs */}
              <div className="flex items-center justify-between border-b border-slate-200 text-xs font-bold">
                <div className="flex">
                  <button
                    onClick={() => {
                      const nextSet = { ...settings, print: { ...settings.print, printerMode: 'regular' as const } };
                      const nextProf: BusinessProfile = {
                        ...profile,
                        invoiceConfig: {
                          ...profile.invoiceConfig,
                          paperFormat: profile.invoiceConfig.paperFormat === 'thermal_80mm' ? 'A4' : profile.invoiceConfig.paperFormat,
                        },
                      };
                      void commitChanges(nextProf, nextSet);
                    }}
                    className={`px-4 py-2.5 border-b-2 transition ${
                      settings.print.printerMode === 'regular'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    REGULAR PRINTER
                  </button>
                  <button
                    onClick={() => {
                      const nextSet = { ...settings, print: { ...settings.print, printerMode: 'thermal' as const } };
                      const nextProf: BusinessProfile = {
                        ...profile,
                        invoiceConfig: { ...profile.invoiceConfig, paperFormat: 'thermal_80mm' },
                      };
                      void commitChanges(nextProf, nextSet);
                    }}
                    className={`px-4 py-2.5 border-b-2 transition ${
                      settings.print.printerMode === 'thermal'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    THERMAL PRINTER
                  </button>
                </div>
                <div className="flex items-center gap-1 pr-1">
                  {(['A4', 'A5', 'thermal_80mm'] as PaperFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => {
                        const nextSet = {
                          ...settings,
                          print: {
                            ...settings.print,
                            printerMode: fmt === 'thermal_80mm' ? ('thermal' as const) : ('regular' as const),
                          },
                        };
                        const nextProf: BusinessProfile = {
                          ...profile,
                          invoiceConfig: { ...profile.invoiceConfig, paperFormat: fmt },
                        };
                        void commitChanges(nextProf, nextSet, `Paper size: ${fmt}`);
                      }}
                      className={`px-2 py-1 rounded text-[10px] font-semibold ${
                        profile.invoiceConfig.paperFormat === fmt
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {fmt === 'thermal_80mm' ? '80mm' : fmt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Change Layout (All 24 Templates) / Colors & Fonts / Digital Signature & Seal */}
              <div className="space-y-3">
                <div className="flex border-b border-slate-200 text-[11px] font-bold">
                  <button
                    onClick={() => setPrintSubTab('layout')}
                    className={`px-3 py-2 border-b-2 ${printSubTab === 'layout' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}
                  >
                    TEMPLATES (24)
                  </button>
                  <button
                    onClick={() => setPrintSubTab('colors')}
                    className={`px-3 py-2 border-b-2 ${printSubTab === 'colors' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}
                  >
                    COLORS &amp; FONT
                  </button>
                  <button
                    onClick={() => setPrintSubTab('signature')}
                    className={`px-3 py-2 border-b-2 ${printSubTab === 'signature' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}
                  >
                    SIGNATURE &amp; SEAL
                  </button>
                </div>

                {printSubTab === 'layout' && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1">
                    {INVOICE_TEMPLATES.map((tpl) => {
                      const active = profile.invoiceConfig.templateId === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          onClick={() => {
                            const nextProf = {
                              ...profile,
                              invoiceConfig: {
                                ...profile.invoiceConfig,
                                templateId: tpl.id,
                                accentColor: tpl.defaultAccent,
                              },
                            };
                            void commitChanges(nextProf, settings, `Selected layout: ${tpl.name}`);
                          }}
                          className={`p-2 rounded-lg border text-left transition ${
                            active ? 'bg-blue-50/70 border-blue-600 ring-1 ring-blue-600' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className="h-5 rounded-xs mb-1 flex items-center justify-between px-1.5 text-[8px] font-bold"
                            style={{
                              backgroundColor: tpl.headerBg,
                              color: tpl.headerText,
                              border: `1px solid ${tpl.borderColor}`,
                            }}
                          >
                            <span className="truncate">{tpl.badgeLabel}</span>
                            {active && <Check className="w-2.5 h-2.5 shrink-0" />}
                          </div>
                          <div className="text-[10px] font-semibold text-slate-800 truncate">{tpl.name}</div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {printSubTab === 'colors' && (
                  <div className="space-y-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {['#1E40AF', '#0F172A', '#132B4F', '#15803D', '#0F766E', '#D97706', '#4338CA'].map((hex) => (
                        <button
                          key={hex}
                          onClick={() => {
                            const nextProf = {
                              ...profile,
                              invoiceConfig: { ...profile.invoiceConfig, accentColor: hex },
                            };
                            void commitChanges(nextProf, settings, 'Updated print accent color');
                          }}
                          className={`w-7 h-7 rounded-lg border-2 ${profile.invoiceConfig.accentColor === hex ? 'border-slate-900 scale-110' : 'border-white shadow'}`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                      <input
                        type="color"
                        value={profile.invoiceConfig.accentColor}
                        onChange={(e) => {
                          const nextProf = {
                            ...profile,
                            invoiceConfig: { ...profile.invoiceConfig, accentColor: e.target.value },
                          };
                          void commitChanges(nextProf, settings);
                        }}
                        className="h-7 w-9 rounded border border-slate-300 cursor-pointer"
                        title="Custom Accent Color"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Typography</label>
                        <select
                          value={profile.invoiceConfig.fontFamily}
                          onChange={(e) => {
                            const nextProf = {
                              ...profile,
                              invoiceConfig: {
                                ...profile.invoiceConfig,
                                fontFamily: e.target.value as InvoiceDesignConfig['fontFamily'],
                              },
                            };
                            void commitChanges(nextProf, settings, 'Updated invoice font');
                          }}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-xs"
                        >
                          <option value="sans">DM Sans (Clean)</option>
                          <option value="display">Plus Jakarta Sans</option>
                          <option value="mono">JetBrains Mono</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Stamp Text</label>
                        <input
                          value={profile.invoiceConfig.stampText}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              invoiceConfig: { ...profile.invoiceConfig, stampText: e.target.value },
                            })
                          }
                          onBlur={() => void commitChanges(profile, settings)}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1 pt-1">
                      <CheckRow
                        checked={profile.invoiceConfig.showHsn}
                        onChange={(v) =>
                          void commitChanges(
                            { ...profile, invoiceConfig: { ...profile.invoiceConfig, showHsn: v } },
                            settings
                          )
                        }
                        label="HSN / SAC Column"
                      />
                      <CheckRow
                        checked={profile.invoiceConfig.showDiscount}
                        onChange={(v) =>
                          void commitChanges(
                            { ...profile, invoiceConfig: { ...profile.invoiceConfig, showDiscount: v } },
                            settings
                          )
                        }
                        label="Discount %"
                      />
                      <CheckRow
                        checked={profile.invoiceConfig.showTaxColumns}
                        onChange={(v) =>
                          void commitChanges(
                            { ...profile, invoiceConfig: { ...profile.invoiceConfig, showTaxColumns: v } },
                            settings
                          )
                        }
                        label="GST Breakup Cols"
                      />
                      <CheckRow
                        checked={profile.invoiceConfig.showBatch}
                        onChange={(v) =>
                          void commitChanges(
                            { ...profile, invoiceConfig: { ...profile.invoiceConfig, showBatch: v } },
                            settings
                          )
                        }
                        label="Batch Number"
                      />
                      <CheckRow
                        checked={profile.invoiceConfig.showUpiQr}
                        onChange={(v) =>
                          void commitChanges(
                            { ...profile, invoiceConfig: { ...profile.invoiceConfig, showUpiQr: v } },
                            settings
                          )
                        }
                        label="UPI Payment QR"
                      />
                      <CheckRow
                        checked={profile.invoiceConfig.showBankDetails}
                        onChange={(v) =>
                          void commitChanges(
                            { ...profile, invoiceConfig: { ...profile.invoiceConfig, showBankDetails: v } },
                            settings
                          )
                        }
                        label="Bank Details"
                      />
                    </div>
                  </div>
                )}

                {printSubTab === 'signature' && (
                  <div className="space-y-3 text-xs p-3 rounded-xl border border-slate-200 bg-slate-50/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <PenTool className="w-3.5 h-3.5 text-blue-600" /> Digital Signature Setup
                      </span>
                      <CheckRow
                        checked={profile.invoiceConfig.showSignature}
                        onChange={(v) =>
                          void commitChanges(
                            { ...profile, invoiceConfig: { ...profile.invoiceConfig, showSignature: v } },
                            settings
                          )
                        }
                        label="Show on Invoice"
                      />
                    </div>

                    {/* Interactive Draw Pad */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-600">Draw Digital Signature (Mouse / Touch)</div>
                      <canvas
                        ref={sigCanvasRef}
                        width={320}
                        height={90}
                        onPointerDown={handleSigPointerDown}
                        onPointerMove={handleSigPointerMove}
                        onPointerUp={handleSigPointerUp}
                        onPointerLeave={handleSigPointerUp}
                        className="w-full h-24 bg-white border border-slate-300 rounded-lg cursor-crosshair touch-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={saveDrawnSigCanvas}
                          className="px-3 py-1 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
                        >
                          Apply Drawn Signature
                        </button>
                        <button
                          type="button"
                          onClick={clearSigCanvas}
                          className="px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-white"
                        >
                          Clear Pad
                        </button>
                        <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 cursor-pointer hover:bg-slate-50">
                          <Upload className="w-3 h-3" /> Upload PNG
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleSignatureUpload(e.target.files[0])}
                          />
                        </label>
                        {profile.signatureDataUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              void commitChanges(
                                { ...profile, signatureDataUrl: '' },
                                settings,
                                'Cleared uploaded/drawn signature image'
                              )
                            }
                            className="text-red-600 hover:underline font-medium"
                          >
                            Remove Image
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Cursive Typed Signature (Fallback)
                        </label>
                        <input
                          value={profile.digitalSignatureText || ''}
                          onChange={(e) => setProfile({ ...profile, digitalSignatureText: e.target.value })}
                          onBlur={() => void commitChanges(profile, settings, 'Saved typed digital signature')}
                          placeholder="e.g. R. Sharma / S. Verma"
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-xs italic font-serif"
                        />
                      </div>
                      <div className="flex flex-col justify-end">
                        <CheckRow
                          checked={Boolean(profile.invoiceConfig.showRoundSeal)}
                          onChange={(v) =>
                            void commitChanges(
                              { ...profile, invoiceConfig: { ...profile.invoiceConfig, showRoundSeal: v } },
                              settings,
                              'Updated round company seal setting'
                            )
                          }
                          label="Include Round Company Seal"
                        />
                        <CheckRow
                          checked={profile.invoiceConfig.showStamp}
                          onChange={(v) =>
                            void commitChanges(
                              { ...profile, invoiceConfig: { ...profile.invoiceConfig, showStamp: v } },
                              settings
                            )
                          }
                          label="Include Stamp Badge"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Print Company Info / Header */}
              <div className="space-y-2.5">
                <h3 className="text-[13px] font-bold text-slate-900 pb-1.5 border-b border-slate-200">
                  Print Company Info / Header
                </h3>
                <CheckRow checked={settings.print.makeRegularDefault} onChange={(v) => patchPrint('makeRegularDefault', v)} label="Make Regular Printer Default" />
                <CheckRow checked={settings.print.repeatHeaderAllPages} onChange={(v) => patchPrint('repeatHeaderAllPages', v)} label="Print repeat header in all pages" />

                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.print.showCompanyName} onChange={(e) => patchPrint('showCompanyName', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <input
                    value={profile.companyName}
                    onChange={(e) => setProfile({ ...profile, companyName: e.target.value })}
                    onBlur={() => void commitChanges(profile, settings)}
                    placeholder="Company Name"
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs font-medium"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={settings.print.showLogo} onChange={(e) => patchPrint('showLogo', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <span>Company Logo</span>
                  <label className="text-blue-600 font-semibold cursor-pointer hover:underline">
                    (Change)
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.print.showAddress} onChange={(e) => patchPrint('showAddress', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <input
                    value={profile.address}
                    onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                    onBlur={() => void commitChanges(profile, settings)}
                    placeholder="Address"
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.print.showEmail} onChange={(e) => patchPrint('showEmail', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <input
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    onBlur={() => void commitChanges(profile, settings)}
                    placeholder="Email"
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.print.showPhone} onChange={(e) => patchPrint('showPhone', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <input
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    onBlur={() => void commitChanges(profile, settings)}
                    placeholder="Phone Number"
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.print.showGstin} onChange={(e) => patchPrint('showGstin', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <input
                    value={profile.gstin}
                    onChange={(e) => setProfile({ ...profile, gstin: e.target.value.toUpperCase() })}
                    onBlur={() => void commitChanges(profile, settings)}
                    placeholder="GSTIN on Sale"
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>

                <CheckRow checked={settings.print.showBalanceAmount} onChange={(v) => patchPrint('showBalanceAmount', v)} label="Balance Amount" />
                <CheckRow checked={settings.print.showPartyCurrentBalance} onChange={(v) => patchPrint('showPartyCurrentBalance', v)} label="Current Balance of Party" />
                <CheckRow checked={settings.print.showTaxDetails} onChange={(v) => patchPrint('showTaxDetails', v)} label="Tax Details" />
                <CheckRow checked={settings.print.showYouSaved} onChange={(v) => patchPrint('showYouSaved', v)} label="You Saved" />
                <CheckRow checked={settings.print.amountGrouping} onChange={(v) => patchPrint('amountGrouping', v)} label="Print Amount with Grouping" />

                <div className="flex items-center gap-2 text-xs pt-1">
                  <span>Amount in Words</span>
                  <select
                    value={settings.print.amountInWords}
                    onChange={(e) => patchPrint('amountInWords', e.target.value as 'Indian' | 'International')}
                    className="px-2.5 py-1 border border-slate-300 rounded bg-white"
                  >
                    <option value="Indian">Indian</option>
                    <option value="International">International</option>
                  </select>
                </div>
              </div>

              {/* Footer */}
              <div className="space-y-1.5">
                <h3 className="text-[13px] font-bold text-slate-900 pb-1.5 border-b border-slate-200">Footer</h3>
                <CheckRow checked={settings.print.showDescription} onChange={(v) => patchPrint('showDescription', v)} label="Print Description" />
                <CheckRow checked={settings.print.showTerms} onChange={(v) => patchPrint('showTerms', v)} label="Print Terms and Conditions" />
                <CheckRow checked={settings.print.showReceivedBy} onChange={(v) => patchPrint('showReceivedBy', v)} label="Print Received by details" />
                <CheckRow checked={settings.print.showDeliveredBy} onChange={(v) => patchPrint('showDeliveredBy', v)} label="Print Delivered by details" />
                <div className="flex items-center gap-2 py-1">
                  <input type="checkbox" checked={settings.print.showSignatureText} onChange={(e) => patchPrint('showSignatureText', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <input
                    value={settings.print.signatureText}
                    onChange={(e) => patchPrint('signatureText', e.target.value)}
                    onBlur={() => void commitChanges({ ...profile, signatoryName: settings.print.signatureText }, settings)}
                    className="px-2.5 py-1 border border-slate-300 rounded text-xs w-44"
                  />
                </div>
                <CheckRow checked={settings.print.showPaymentMode} onChange={(v) => patchPrint('showPaymentMode', v)} label="Payment Mode" />
                <CheckRow checked={settings.print.showAcknowledgement} onChange={(v) => patchPrint('showAcknowledgement', v)} label="Print Acknowledgement" />
              </div>
            </div>

            {/* Right LIVE Invoice Preview using actual InvoiceRenderer (all 24 templates + Hindi/English + Digital Signature) */}
            <div className="flex-1 p-5 bg-slate-100 overflow-y-auto max-h-[820px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-700">
                  Live Preview: {INVOICE_TEMPLATES.find((t) => t.id === profile.invoiceConfig.templateId)?.name} ({profile.language === 'hi' ? 'हिंदी / Hindi' : 'English'})
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {profile.invoiceConfig.paperFormat}
                </span>
              </div>
              <div className="overflow-x-auto">
                <InvoiceRenderer
                  voucher={fallbackSampleVoucher}
                  profile={{ ...profile, appSettings: settings }}
                  party={previewParty}
                  bank={previewBank}
                  effectivePaid={getEffectivePaid(fallbackSampleVoucher)}
                  configOverride={profile.invoiceConfig}
                  elementId="settings-live-invoice-preview"
                />
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: TAXES & GST */}
        {section === 'TAXES_GST' && (
          <div className="p-6 md:p-8 max-w-2xl space-y-6">
            <div>
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                GST Settings
              </h3>
              <div className="space-y-2.5">
                <CheckRow checked={settings.gst.enableGst} onChange={(v) => patchGst('enableGst', v)} label="Enable GST" tip="Enable CGST/SGST/IGST calculations" />
                <CheckRow checked={settings.gst.enableHsnSac} onChange={(v) => patchGst('enableHsnSac', v)} label="Enable HSN/SAC Code" tip="Require HSN/SAC codes for GST returns" />
                <CheckRow checked={settings.gst.reverseCharge} onChange={(v) => patchGst('reverseCharge', v)} label="Reverse Charge" tip="Enable RCM toggle on purchase & expense vouchers" />
                <CheckRow checked={settings.gst.enablePlaceOfSupply} onChange={(v) => patchGst('enablePlaceOfSupply', v)} label="Enable Place of Supply" tip="Determine intra-state vs inter-state IGST automatically" />
                <CheckRow checked={settings.gst.compositeScheme} onChange={(v) => patchGst('compositeScheme', v)} label="Composite Scheme" tip="Apply composition taxpayer rules (1% flat)" />
                <CheckRow checked={settings.gst.enableTcs} onChange={(v) => patchGst('enableTcs', v)} label="Enable TCS" tip="Tax Collected at Source on high-value sales" />
                <CheckRow checked={settings.gst.enableTds} onChange={(v) => patchGst('enableTds', v)} label="Enable TDS" tip="Tax Deducted at Source for services & contracts" />
              </div>

              <button
                onClick={() => setShowTaxListModal((p) => !p)}
                className="mt-4 px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-600 text-xs font-bold hover:bg-blue-100"
              >
                Tax List &gt;
              </button>

              {showTaxListModal && (
                <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                  <div className="font-bold text-slate-800">Active Indian GST Slabs</div>
                  <div className="grid grid-cols-5 gap-2">
                    {['0% Exempt', '5% GST (2.5+2.5)', '12% GST (6+6)', '18% GST (9+9)', '28% GST (14+14)'].map((slab) => (
                      <div key={slab} className="p-2 rounded border bg-white text-center font-semibold text-slate-700">{slab}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 5: TRANSACTION MESSAGE */}
        {section === 'TRANSACTION_MESSAGE' && (
          <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 space-y-6">
              {/* Master ON / OFF Switch */}
              <div className="p-4 rounded-xl border border-slate-200 bg-[#E5EFF3]/60 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-bold text-[#243746]">
                    Transaction Message Automation
                  </h3>
                  <p className="text-xs text-[#84909D]">
                    Master switch: turn ON to auto-dispatch Real Invoice PDF / Image via WhatsApp on save.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => patchMsg('enabled', !settings.message.enabled)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-extrabold transition-colors ${
                    settings.message.enabled
                      ? 'bg-[#16A34A] text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {settings.message.enabled ? 'ON · Auto Send Active' : 'OFF · Disabled'}
                </button>
              </div>

              {/* Link WhatsApp via QR Code */}
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-[#243746]">
                      <QrCode className="w-4 h-4 text-[#168C88]" />
                      Link Business WhatsApp (Scan QR Code)
                    </div>
                    <p className="text-[11px] text-[#84909D] mt-0.5">
                      Scan the QR code from WhatsApp → Linked Devices → Link a Device so invoices &amp; OTPs send directly from your number.
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
                      waStatus.status === 'connected'
                        ? 'bg-[#16A34A] text-white'
                        : waStatus.status === 'qr_ready'
                        ? 'bg-[#F59E0B] text-white'
                        : waStatus.status === 'error'
                        ? 'bg-[#EF4444] text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {waStatus.status === 'connected'
                      ? 'Connected'
                      : waStatus.status === 'qr_ready'
                      ? 'Scan QR Ready'
                      : waStatus.status === 'connecting'
                      ? 'Starting Session...'
                      : waStatus.status === 'error'
                      ? 'Error'
                      : 'Not Linked'}
                  </span>
                </div>

                {waStatus.status === 'connected' ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-white border border-emerald-200 text-xs">
                    <div>
                      <div className="font-bold text-[#16A34A]">
                        Linked Number: +{waStatus.phoneNumber || 'Active Device'}
                        {waStatus.pushName ? ` (${waStatus.pushName})` : ''}
                      </div>
                      <div className="text-[11px] text-[#84909D]">
                        Ready to auto-send Real PDF &amp; PNG Invoice images.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const info = await disconnectWhatsApp();
                        setWaStatus(info);
                        notify('WhatsApp device unlinked.');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-[#EF4444] font-semibold hover:bg-red-50"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      Unlink WhatsApp
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="space-y-2 flex-1 min-w-[200px]">
                      <button
                        type="button"
                        disabled={waConnecting}
                        onClick={async () => {
                          setWaConnecting(true);
                          try {
                            const info = await connectWhatsApp();
                            setWaStatus(info);
                          } catch (err) {
                            notify((err as Error).message);
                          } finally {
                            setWaConnecting(false);
                          }
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white text-xs font-bold disabled:opacity-50"
                      >
                        <Link2 className="w-4 h-4" />
                        {waConnecting
                          ? 'Generating QR...'
                          : waStatus.qrDataUrl
                          ? 'Refresh WhatsApp QR Code'
                          : 'Link WhatsApp via QR Code'}
                      </button>
                      {waStatus.lastError && (
                        <div className="text-[11px] text-[#EF4444] font-medium">
                          {waStatus.lastError}
                        </div>
                      )}
                    </div>

                    {waStatus.qrDataUrl && (
                      <div className="p-2.5 bg-white rounded-xl border border-slate-200 text-center space-y-1">
                        <img
                          src={waStatus.qrDataUrl}
                          alt="WhatsApp Link QR Code"
                          className="w-40 h-40 object-contain mx-auto"
                        />
                        <div className="text-[10px] font-semibold text-[#243746]">
                          Scan in WhatsApp → Linked Devices
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Live Test Real PDF + Image Dispatch */}
                <div className="pt-3 border-t border-emerald-200/70 flex flex-wrap items-center gap-2 text-xs">
                  <input
                    type="tel"
                    value={waTestPhone}
                    onChange={(e) => setWaTestPhone(e.target.value)}
                    placeholder="Test mobile no (e.g. 9876543210)"
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-xs flex-1 min-w-[180px]"
                  />
                  <button
                    type="button"
                    disabled={waTestBusy || !waTestPhone.trim()}
                    onClick={async () => {
                      setWaTestBusy(true);
                      try {
                        const sampleVoucher =
                          db.vouchers.find((v) => v.type === 'sale_invoice') || db.vouchers[0];
                        if (!sampleVoucher) {
                          notify('Create at least one invoice first to test attachment dispatch.');
                          return;
                        }
                        const party = db.parties.find((p) => p.id === sampleVoucher.partyId);
                        const bank =
                          db.bankAccounts.find((b) => b.id === sampleVoucher.bankAccountId) ||
                          db.bankAccounts[0];
                        const effPaid = getEffectivePaid(sampleVoucher);
                        const fmt = settings.message.format || 'both';
                        const pdfObj =
                          fmt === 'pdf' || fmt === 'both'
                            ? getInvoicePdfBase64(sampleVoucher, profile, party, bank, effPaid)
                            : undefined;
                        const imageBase64 =
                          fmt === 'image' || fmt === 'both'
                            ? generateInvoicePngBase64(sampleVoucher, profile, party, bank, effPaid)
                            : undefined;
                        const res = await sendTransactionWhatsApp({
                          phone: waTestPhone.trim(),
                          text: `${settings.message.headerText}\nInvoice: ${sampleVoucher.voucherNo}\nTotal: ${formatINR(sampleVoucher.grandTotal)}\n${settings.message.footerText}`,
                          pdfBase64: pdfObj?.base64,
                          pdfFileName: pdfObj?.fileName || `${sampleVoucher.voucherNo.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
                          imageBase64,
                        });
                        notify(res.message);
                      } catch (err) {
                        notify((err as Error).message);
                      } finally {
                        setWaTestBusy(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#16A34A] hover:bg-emerald-700 text-white font-bold disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {waTestBusy ? 'Sending...' : 'Send Test PDF / Image'}
                  </button>
                </div>
              </div>

              {/* Attachment Format: PDF / Image / Both */}
              <div>
                <div className="text-xs font-semibold text-[#243746] mb-2">
                  Invoice Attachment Format (Real File Dispatch):
                </div>
                <div className="grid grid-cols-3 gap-2.5 text-xs">
                  {(
                    [
                      { id: 'pdf', label: 'Real PDF File', icon: FileText },
                      { id: 'image', label: 'Invoice PNG Image', icon: ImageIcon },
                      { id: 'both', label: 'Both PDF + Image', icon: Paperclip },
                    ] as const
                  ).map((opt) => {
                    const FmtIcon = opt.icon;
                    const activeFmt = (settings.message.format || 'both') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => patchMsg('format', opt.id)}
                        className={`px-3 py-2.5 rounded-lg border font-bold flex items-center justify-center gap-2 ${
                          activeFmt
                            ? 'border-[#168C88] bg-[#E5EFF3] text-[#116B68]'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <FmtIcon className="w-3.5 h-3.5" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-2">Select Message Channel:</div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => patchMsg('channel', 'whatsapp')}
                    className={`px-4 py-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 ${
                      settings.message.channel === 'whatsapp' ? 'border-[#16A34A] bg-emerald-50/40 text-slate-900' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Linked WhatsApp (QR Direct PDF/Image)
                    {settings.message.channel === 'whatsapp' && <Check className="w-3.5 h-3.5 text-[#16A34A]" />}
                  </button>
                  <button
                    onClick={() => patchMsg('channel', 'app')}
                    className={`px-4 py-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 relative ${
                      settings.message.channel === 'app' ? 'border-[#168C88] bg-[#E5EFF3] text-slate-900' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 text-[#168C88]" />
                    Send via Shobhit Invoice Pro
                    {settings.message.channel === 'app' && <Check className="w-3.5 h-3.5 text-[#168C88]" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-600 mb-2">Message Recipient Settings:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <CheckRow checked={settings.message.sendToParty} onChange={(v) => patchMsg('sendToParty', v)} label="Send Message to Party" tip="Notify customer/supplier on voucher save" />
                  <CheckRow checked={settings.message.sendTxnUpdate} onChange={(v) => patchMsg('sendTxnUpdate', v)} label="Send Transaction Update Message" tip="Send edit/cancellation updates" />
                  <CheckRow checked={settings.message.sendCopyToSelf} onChange={(v) => patchMsg('sendCopyToSelf', v)} label="Send Message Copy to Self" tip="Send blind copy to linked business WhatsApp" />
                  <CheckRow checked={settings.message.autoShareNetwork} onChange={(v) => patchMsg('autoShareNetwork', v)} label="Auto Share Invoices" tip="Automatically dispatch invoice attachments on save" />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-600 mb-2">Message Content:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <CheckRow checked={settings.message.includePartyBalance} onChange={(v) => patchMsg('includePartyBalance', v)} label="Party Current Balance in Message" />
                  <CheckRow checked={settings.message.includeWebLink} onChange={(v) => patchMsg('includeWebLink', v)} label="Web invoice link in Message" />
                  <CheckRow checked={settings.message.includePaymentLink} onChange={(v) => patchMsg('includePaymentLink', v)} label="Send payment link in Message" />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-600 mb-2">Send Automatic Message for:</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {Object.entries(settings.message.autoFor).map(([k, enabled]) => (
                    <CheckRow
                      key={k}
                      checked={enabled}
                      onChange={(v) =>
                        patchMsg('autoFor', { ...settings.message.autoFor, [k]: v })
                      }
                      label={k}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Edit Message + Live Green Preview */}
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Transaction Type :</span>
                <select
                  value={msgTxnType}
                  onChange={(e) => setMsgTxnType(e.target.value as 'Sales Transaction' | 'Payment In' | 'Estimate')}
                  className="px-3 py-1 rounded-full bg-[#E5EFF3] text-[#116B68] font-bold"
                >
                  <option>Sales Transaction</option>
                  <option>Payment In</option>
                  <option>Estimate</option>
                </select>
              </div>

              <div className="text-center font-bold text-slate-800 text-sm">Edit Message</div>

              <div className="border border-slate-200 rounded-xl p-3 space-y-2.5 bg-white">
                <textarea
                  rows={2}
                  value={settings.message.headerText}
                  onChange={(e) => setSettings({ ...settings, message: { ...settings.message, headerText: e.target.value } })}
                  onBlur={() => void commitChanges(profile, settings)}
                  className="w-full p-2.5 border border-slate-200 rounded-lg text-xs text-slate-700"
                />
                <div className="p-3 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-0.5 bg-slate-50/50">
                  <div>{msgTxnType === 'Payment In' ? 'Receipt Amount: ₹5,000' : 'Invoice Amount: ₹3,422'}</div>
                  <div>Received: ₹2,000</div>
                  <div>Balance: ₹1,422</div>
                  {settings.message.includePartyBalance && <div>Total Party Balance: ₹14,920</div>}
                </div>
                <input
                  value={settings.message.footerText}
                  onChange={(e) => setSettings({ ...settings, message: { ...settings.message, footerText: e.target.value } })}
                  onBlur={() => void commitChanges(profile, settings)}
                  placeholder="Footer"
                  className="w-full p-2.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-700"
                />
              </div>

              <div className="text-center font-bold text-slate-500 text-xs">Message Preview</div>
              <div className="rounded-xl bg-[#DDF9C8] border border-emerald-200 p-4 text-xs text-slate-800 space-y-2 shadow-xs">
                <div className="bg-emerald-100/80 text-[#116B68] font-semibold px-2.5 py-1.5 rounded flex items-center gap-1.5 text-[11px]">
                  <Paperclip className="w-3.5 h-3.5" />
                  {(settings.message.format || 'both') === 'pdf'
                    ? 'Real Invoice PDF Attached'
                    : (settings.message.format || 'both') === 'image'
                    ? 'High-Res Invoice PNG Attached'
                    : 'Real PDF + PNG Invoice Attached'}
                </div>
                <div className="whitespace-pre-line font-medium leading-relaxed">
                  {settings.message.headerText}
                  {'\n'}Purchase Details:
                  {'\n'}Invoice Amount: ₹3,422
                  {'\n'}Received: ₹2,000
                  {'\n'}Balance: ₹1,422
                  {settings.message.includePartyBalance ? '\nTotal Balance: ₹14,920' : ''}
                  {settings.message.includeWebLink ? '\nLink: https://shobhitinvoicepro.in/v/INV-101' : ''}
                  {settings.message.footerText ? `\n${settings.message.footerText}` : ''}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 6: PARTY */}
        {section === 'PARTY' && (
          <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div>
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                Party Settings
              </h3>
              <div className="space-y-2">
                <CheckRow checked={settings.party.partyGrouping} onChange={(v) => patchParty('partyGrouping', v)} label="Party Grouping" tip="Organize parties under Trade Debtors, Creditors, Wholesalers" />
                <CheckRow checked={settings.party.shippingAddress} onChange={(v) => patchParty('shippingAddress', v)} label="Shipping Address" tip="Store separate delivery address per party" />
                <CheckRow checked={settings.party.printShippingAddress} onChange={(v) => patchParty('printShippingAddress', v)} label="Print Shipping Address" tip="Print Ship-To block on invoices" />
                <CheckRow checked={settings.party.managePartyStatus} onChange={(v) => patchParty('managePartyStatus', v)} label="Manage Party Status" tip="Mark inactive or credit-hold parties" />
                <CheckRow checked={settings.party.enablePaymentReminder} onChange={(v) => patchParty('enablePaymentReminder', v)} label="Enable Payment Reminder" tip="Remind before or after due date" />
                <div className="flex items-center gap-2 text-xs text-slate-600 pt-1">
                  <span>Remind me for payment due in</span>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={settings.party.reminderDueDays}
                    onChange={(e) => patchParty('reminderDueDays', Number(e.target.value))}
                    className="w-12 px-2 py-1 border border-slate-300 rounded text-center"
                  />
                  <span>(days)</span>
                </div>
                <textarea
                  rows={2}
                  value={settings.party.reminderMessage}
                  onChange={(e) => setSettings({ ...settings, party: { ...settings.party, reminderMessage: e.target.value } })}
                  onBlur={() => void commitChanges(profile, settings)}
                  className="w-full mt-2 p-2.5 border border-slate-200 rounded-lg text-xs text-slate-600"
                />
              </div>
            </div>

            <div>
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3 flex items-center gap-1.5">
                Additional fields <InfoTip text="Custom metadata fields shown on Party profile & printed bills" />
              </h3>
              <div className="space-y-4">
                {settings.party.additionalFields.map((af, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={af.enabled}
                        onChange={(e) => {
                          const next = [...settings.party.additionalFields];
                          next[idx] = { ...af, enabled: e.target.checked };
                          patchParty('additionalFields', next);
                        }}
                        className={SETTING_CHECKBOX_STYLE}
                      />
                      <input
                        value={af.label}
                        onChange={(e) => {
                          const next = [...settings.party.additionalFields];
                          next[idx] = { ...af, label: e.target.value };
                          setSettings({ ...settings, party: { ...settings.party, additionalFields: next } });
                        }}
                        onBlur={() => void commitChanges(profile, settings)}
                        className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                      />
                    </div>
                    <div className="flex justify-end">
                      <ToggleSwitch
                        checked={af.showInPrint}
                        onChange={(v) => {
                          const next = [...settings.party.additionalFields];
                          next[idx] = { ...af, showInPrint: v };
                          patchParty('additionalFields', next);
                        }}
                        label="Show In Print"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                Enable Loyalty Point
              </h3>
              <CheckRow
                checked={settings.party.enableLoyaltyPoint}
                onChange={(v) => patchParty('enableLoyaltyPoint', v)}
                label="Enable Loyalty Point"
                tip="Award reward points on retail & B2B invoices"
                trailing={<Crown className="w-3.5 h-3.5 text-sky-500" />}
              />
            </div>
          </div>
        )}

        {/* SECTION 7: ITEM */}
        {section === 'ITEM' && (
          <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div>
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                Item Settings
              </h3>
              <div className="space-y-1.5">
                <CheckRow checked={settings.item.enableItem} onChange={(v) => patchItem('enableItem', v)} label="Enable Item" />
                <div className="flex items-center gap-2 py-1 text-xs text-slate-600">
                  <span>What do you sell?</span>
                  <select
                    value={settings.item.sellType}
                    onChange={(e) => patchItem('sellType', e.target.value as 'Product/Service' | 'Product' | 'Service')}
                    className="px-2 py-1 border-b border-slate-300 bg-white font-semibold"
                  >
                    <option value="Product/Service">Product/Service</option>
                    <option value="Product">Product Only</option>
                    <option value="Service">Service Only</option>
                  </select>
                </div>
                <CheckRow checked={settings.item.barcodeScan} onChange={(v) => patchItem('barcodeScan', v)} label="Barcode Scan" />
                <CheckRow checked={settings.item.stockMaintenance} onChange={(v) => patchItem('stockMaintenance', v)} label="Stock Maintenance" />
                <CheckRow checked={settings.item.showLowStockDialog} onChange={(v) => patchItem('showLowStockDialog', v)} label="Show Low Stock Dialog" />
                <CheckRow checked={settings.item.itemsUnit} onChange={(v) => patchItem('itemsUnit', v)} label="Items Unit" />
                <div className="flex items-center gap-2">
                  <CheckRow checked label="Default Unit" onChange={() => {}} />
                  <input
                    value={settings.item.defaultUnit}
                    onChange={(e) => patchItem('defaultUnit', e.target.value.toUpperCase())}
                    className="w-16 px-2 py-0.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
                <CheckRow checked={settings.item.itemCategory} onChange={(v) => patchItem('itemCategory', v)} label="Item Category" />
                <CheckRow checked={settings.item.partyWiseRate} onChange={(v) => patchItem('partyWiseRate', v)} label="Party Wise Item Rate" />
                <CheckRow checked={settings.item.description} onChange={(v) => patchItem('description', v)} label="Description" />
                <CheckRow checked={settings.item.itemWiseTax} onChange={(v) => patchItem('itemWiseTax', v)} label="Item wise Tax" />
                <CheckRow checked={settings.item.itemWiseDiscount} onChange={(v) => patchItem('itemWiseDiscount', v)} label="Item wise Discount" />
                <CheckRow checked={settings.item.updateSalePrice} onChange={(v) => patchItem('updateSalePrice', v)} label="Update Sale Price from Transaction" />
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                  Additional Item Fields
                </h3>
                <div className="text-xs font-bold text-slate-700 mb-2">MRP/Price</div>
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={settings.item.enableMrp} onChange={(e) => patchItem('enableMrp', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <span className="text-xs w-12">MRP</span>
                  <input value={settings.item.mrpLabel} onChange={(e) => patchItem('mrpLabel', e.target.value)} className="px-2 py-1 border border-slate-300 rounded text-xs w-28" />
                </div>
                <CheckRow checked={settings.item.taxOnMrp} onChange={(v) => patchItem('taxOnMrp', v)} label="Calculate Tax based on MRP" />

                <div className="text-xs font-bold text-slate-700 mt-5 mb-2">Serial No. Tracking</div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.item.enableSerialNo} onChange={(e) => patchItem('enableSerialNo', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                  <span className="text-xs">Serial No./ IMEI No.</span>
                  <input value={settings.item.serialLabel} onChange={(e) => patchItem('serialLabel', e.target.value)} className="px-2 py-1 border border-slate-300 rounded text-xs w-24" />
                </div>

                <div className="text-xs font-bold text-slate-700 mt-5 mb-2">Batch Tracking</div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={settings.item.enableBatchNo} onChange={(e) => patchItem('enableBatchNo', e.target.checked)} className={SETTING_CHECKBOX_STYLE} />
                    <span className="w-20">Batch No.</span>
                    <input value={settings.item.batchLabel} onChange={(e) => patchItem('batchLabel', e.target.value)} className="px-2 py-1 border border-slate-300 rounded text-xs w-28" />
                  </div>
                  <CheckRow checked={settings.item.enableExpDate} onChange={(v) => patchItem('enableExpDate', v)} label={`Exp Date (${settings.item.expFormat})`} />
                  <CheckRow checked={settings.item.enableMfgDate} onChange={(v) => patchItem('enableMfgDate', v)} label={`Mfg Date (${settings.item.mfgFormat})`} />
                  <CheckRow checked={settings.item.enableModelNo} onChange={(v) => patchItem('enableModelNo', v)} label="Model No." />
                  <CheckRow checked={settings.item.enableSize} onChange={(v) => patchItem('enableSize', v)} label="Size" />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200 mb-3">
                Item Custom Fields
              </h3>
              <div className="space-y-2 text-xs">
                {settings.item.customFields.map((cf, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 border rounded-lg">
                    <span className="font-medium">{cf}</span>
                    <button
                      onClick={() => patchItem('customFields', settings.item.customFields.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-amber-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <input
                    value={customItemFieldInput}
                    onChange={(e) => setCustomItemFieldInput(e.target.value)}
                    placeholder="e.g. Color / Brand / Voltage"
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                  />
                  <button
                    onClick={() => {
                      if (!customItemFieldInput.trim()) return;
                      patchItem('customFields', [...settings.item.customFields, customItemFieldInput.trim()]);
                      setCustomItemFieldInput('');
                    }}
                    className="px-3 py-1.5 rounded bg-blue-50 border border-blue-200 text-blue-700 font-bold"
                  >
                    + Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 8: SERVICE REMINDERS */}
        {section === 'SERVICE_REMINDERS' && (
          <div className="p-6 md:p-8 max-w-2xl space-y-5">
            <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200">
              Service, AMC &amp; Subscription Reminders
            </h3>
            <CheckRow
              checked={settings.serviceReminder.enabled}
              onChange={(v) => patchService('enabled', v)}
              label="Enable Automatic Service & AMC Renewal Reminders"
            />
            <CheckRow
              checked={settings.serviceReminder.autoWhatsApp}
              onChange={(v) => patchService('autoWhatsApp', v)}
              label="Send Renewal Alert on Party WhatsApp / SMS"
            />
            <div className="flex items-center gap-2 text-xs">
              <span>Trigger reminder before</span>
              <input
                type="number"
                min={1}
                max={60}
                value={settings.serviceReminder.daysBefore}
                onChange={(e) => patchService('daysBefore', Number(e.target.value))}
                className="w-16 px-2 py-1 border rounded text-center"
              />
              <span>days of due renewal date</span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Reminder Message Template</label>
              <textarea
                rows={3}
                value={settings.serviceReminder.template}
                onChange={(e) => setSettings({ ...settings, serviceReminder: { ...settings.serviceReminder, template: e.target.value } })}
                onBlur={() => void commitChanges(profile, settings)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-xs"
              />
            </div>
          </div>
        )}

        {/* SECTION 9: ACCOUNTING & DATA TOOLS */}
        {section === 'ACCOUNTING' && (
          <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200">
                Double-Entry &amp; Books Configuration
              </h3>
              <CheckRow
                checked={settings.accounting.doubleEntryAutoPost}
                onChange={(v) => patchAccounting('doubleEntryAutoPost', v)}
                label="Auto-Post Balanced Double-Entry Journal for Every Voucher & Payroll"
              />
              <CheckRow
                checked={settings.accounting.multiCurrencyEnabled}
                onChange={(v) => patchAccounting('multiCurrencyEnabled', v)}
                label="Enable Multi-Currency Ledger Conversion"
              />
              <div className="grid grid-cols-2 gap-3 text-xs pt-2">
                <div>
                  <label className="block text-slate-500 mb-1">Financial Year</label>
                  <input
                    value={profile.financialYear}
                    onChange={(e) => setProfile({ ...profile, financialYear: e.target.value })}
                    onBlur={() => void commitChanges(profile, settings)}
                    className="w-full px-2.5 py-1.5 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Books Lock Date</label>
                  <input
                    type="date"
                    value={settings.accounting.lockDate}
                    onChange={(e) => patchAccounting('lockDate', e.target.value)}
                    className="w-full px-2.5 py-1.5 border rounded"
                  />
                </div>
              </div>
              <div className="text-xs pt-2">
                <label className="block text-slate-500 mb-1">Default Invoice Style (24 Templates)</label>
                <select
                  value={profile.invoiceConfig.templateId}
                  onChange={(e) => {
                    const nextProf = {
                      ...profile,
                      invoiceConfig: { ...profile.invoiceConfig, templateId: e.target.value as BusinessProfile['invoiceConfig']['templateId'] },
                    };
                    void commitChanges(nextProf, settings, 'Updated default invoice template');
                  }}
                  className="w-full px-2.5 py-1.5 border rounded"
                >
                  {INVOICE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-[14px] font-bold text-slate-900 pb-2 border-b border-slate-200">
                Database Maintenance &amp; Demo Controls
              </h3>
              <p className="text-xs text-slate-500">
                Safely backup your SQLite company records, start with a clean empty ledger book, or restore complete demo vouchers &amp; payroll data.
              </p>
              <div className="flex flex-wrap gap-2.5 text-xs">
                <button
                  onClick={handleBackupDownload}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white font-semibold"
                >
                  <Save className="w-3.5 h-3.5" /> Download SQLite JSON Backup
                </button>
                <button
                  onClick={async () => {
                    await clearDemoData();
                    notify('Cleared sample vouchers & stock entries for clean production entry.');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Start Clean Books
                </button>
                <button
                  onClick={async () => {
                    await resetToDemo();
                    notify('Restored full demo vouchers, payroll & accounting dataset.');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Restore Demo Dataset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 10: MULTI CURRENCY */}
        {section === 'MULTI_CURRENCY' && (
          <div className="p-6 md:p-8 max-w-3xl space-y-5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" /> Multi-Currency Exchange Rates
              </h3>
              <span className="text-xs text-slate-500">Base Accounting Currency: INR (₹)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {db.currencyRates.map((c) => (
                <div key={c.code} className="p-3 rounded-xl border border-slate-200 space-y-1 text-xs">
                  <div className="font-bold text-slate-900">{c.code} ({c.symbol})</div>
                  <div className="text-slate-500">{c.name}</div>
                  <div className="font-mono font-bold text-blue-700">1 {c.code} = ₹{c.rateToInr}</div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs items-end">
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">Code</label>
                <input
                  value={newCurr.code}
                  onChange={(e) => {
                    const nextVal = e.target.value.toUpperCase();
                    if (nextVal.includes('SUBS')) {
                      setNewCurr({ ...newCurr, code: 'AED' });
                      setOpsAuthError('');
                      setOpsPasswordInput('');
                      setShowOpsPasswordModal(true);
                      return;
                    }
                    setNewCurr({ ...newCurr, code: nextVal });
                  }}
                  className="w-full px-2.5 py-1.5 border rounded bg-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">Name</label>
                <input value={newCurr.name} onChange={(e) => setNewCurr({ ...newCurr, name: e.target.value })} className="w-full px-2.5 py-1.5 border rounded bg-white" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">Symbol</label>
                <input value={newCurr.symbol} onChange={(e) => setNewCurr({ ...newCurr, symbol: e.target.value })} className="w-full px-2.5 py-1.5 border rounded bg-white" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">INR Rate</label>
                <input type="number" step="0.01" value={newCurr.rateToInr} onChange={(e) => setNewCurr({ ...newCurr, rateToInr: Number(e.target.value) })} className="w-full px-2.5 py-1.5 border rounded bg-white font-mono" />
              </div>
              <button
                onClick={async () => {
                  await saveCurrencyRate({ ...newCurr, updatedAt: new Date().toISOString().slice(0, 10) });
                  notify(`Saved exchange rate for ${newCurr.code}`);
                }}
                className="px-3 py-1.5 rounded bg-blue-600 text-white font-semibold flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Update
              </button>
            </div>
          </div>
        )}

        {/* SECTION 11: RECYCLE BIN */}
        {section === 'RECYCLE_BIN' && (
          <div className="p-6 md:p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-blue-600" /> Recycle Bin (Deleted Invoices &amp; Bank Accounts)
                </h3>
                <p className="text-xs text-slate-500">
                  Deleted sales/purchase vouchers and deleted bank accounts are archived here safely so you can restore them anytime.
                </p>
              </div>
              {recycleCount > 0 && (
                confirmEmptyBin ? (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg text-xs">
                    <span className="font-semibold text-red-700">Permanently empty {recycleCount} items?</span>
                    <button
                      onClick={async () => {
                        await emptyRecycleBin();
                        setConfirmEmptyBin(false);
                        notify('Recycle Bin emptied permanently.');
                      }}
                      className="px-2.5 py-1 rounded bg-red-600 text-white font-semibold"
                    >
                      Yes, Empty
                    </button>
                    <button
                      onClick={() => setConfirmEmptyBin(false)}
                      className="px-2.5 py-1 rounded border border-slate-300 text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmEmptyBin(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Empty Recycle Bin
                  </button>
                )
              )}
            </div>

            {recycleCount === 0 ? (
              <div className="py-16 text-center space-y-2 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <Trash2 className="w-8 h-8 text-slate-300 mx-auto" />
                <div className="text-sm font-semibold text-slate-700">Recycle Bin is empty</div>
                <div className="text-xs text-slate-500">
                  Deleted invoices, vouchers, or bank accounts will appear here for 1-click recovery.
                </div>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4 text-left">Type</th>
                      <th className="py-2.5 px-4 text-left">Document / Account</th>
                      <th className="py-2.5 px-4 text-right">Amount / Bal</th>
                      <th className="py-2.5 px-4 text-left">Deleted On</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(db.recycleBin || []).map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-semibold text-blue-700 uppercase text-[11px]">
                          {entry.entityType === 'bank_account' ? 'Bank Account' : 'Voucher / Invoice'}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{entry.title}</td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-800">
                          {formatINR(entry.amount || 0)}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-500">
                          {entry.deletedAt.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          <button
                            onClick={async () => {
                              await restoreFromRecycleBin(entry.id);
                              notify(`Restored "${entry.title}" back to live records!`);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                          >
                            <RotateCcw className="w-3 h-3" /> Restore
                          </button>
                          {confirmForeverId === entry.id ? (
                            <span className="inline-flex items-center gap-1">
                              <button
                                onClick={async () => {
                                  await deleteRecycleBinItem(entry.id);
                                  setConfirmForeverId(null);
                                  notify(`Permanently deleted "${entry.title}".`);
                                }}
                                className="px-2 py-1 rounded bg-red-600 text-white font-semibold"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmForeverId(null)}
                                className="px-2 py-1 rounded border border-slate-300 text-slate-600"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmForeverId(entry.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-200"
                            >
                              Delete Forever
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Audit Trail Viewer Modal */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between font-bold text-sm">
              <span>User Activity &amp; Compliance Audit Trail</span>
              <button onClick={() => setShowAuditModal(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 overflow-y-auto text-xs divide-y">
              {db.auditLogs.slice(0, 50).map((log) => (
                <div key={log.id} className="py-2 flex justify-between gap-4">
                  <div>
                    <span className="font-bold text-blue-700">{log.action}</span> · <span className="font-medium">{log.entityType}</span> — {log.details}
                  </div>
                  <div className="text-slate-400 font-mono shrink-0">{log.createdAt.slice(0, 16).replace('T', ' ')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Hidden Ops Admin Password Prompt */}
      {showOpsPasswordModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setOpsAuthError('');
              setOpsAuthBusy(true);
              try {
                const overview = await opsAuth(opsPasswordInput);
                setShowOpsPasswordModal(false);
                setOpsSession({ password: opsPasswordInput, overview });
                setOpsPasswordInput('');
              } catch (err) {
                setOpsAuthError(err instanceof Error ? err.message : 'Invalid Ops Password');
              } finally {
                setOpsAuthBusy(false);
              }
            }}
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                OPS Admin Verification
              </div>
              <button
                type="button"
                onClick={() => setShowOpsPasswordModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">
                Enter the Operations Console password to unlock payment verification, license issuance, and plan controls.
              </p>
              <input
                required
                type="password"
                autoFocus
                placeholder="Enter Ops Password"
                value={opsPasswordInput}
                onChange={(e) => setOpsPasswordInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono tracking-widest"
              />
              {opsAuthError && <div className="text-red-600 font-semibold">{opsAuthError}</div>}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowOpsPasswordModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={opsAuthBusy}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {opsAuthBusy ? 'Unlocking...' : 'Open Ops Dashboard'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Hidden Ops Admin Dashboard */}
      {opsSession && (
        <OpsDashboardModal
          opsPassword={opsSession.password}
          initialOverview={opsSession.overview}
          onClose={() => setOpsSession(null)}
        />
      )}
    </div>
  );
};
