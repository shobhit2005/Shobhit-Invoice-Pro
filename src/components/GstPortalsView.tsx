import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  Globe,
  History,
  KeyRound,
  Landmark,
  Lock,
  RefreshCw,
  Search,
  ServerCrash,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import {
  ComplianceItem,
  GstApiIntegrationConfig,
  GstApiReadiness,
  PortalHealthResult,
} from '../types/accounting';
import { INDIAN_STATES } from '../utils/formatters';

type PortalTab = 'portals' | 'filing_audit' | 'api_integration';

interface GstServiceCardDef {
  id: string;
  healthId: string;
  title: string;
  categoryLabel: string;
  description: string;
  officialUrl: string;
  altUrl?: { label: string; url: string; healthId: string };
  irpList?: { label: string; url: string; healthId: string }[];
  navigationPath?: string;
  features: string[];
}

const SERVICE_CARDS: GstServiceCardDef[] = [
  {
    id: 'gov_services',
    healthId: 'gst_login',
    title: 'Government Services — GST Portal Login',
    categoryLabel: 'Central GSTN Taxpayer Portal',
    description:
      'Official Goods and Services Tax taxpayer login for returns, electronic ledgers, payments, notices, and registration.',
    officialUrl: 'https://services.gst.gov.in/services/login',
    navigationPath: 'https://services.gst.gov.in/services/login',
    features: [
      'GST Login',
      'GSTR-1 Filing',
      'GSTR-3B Filing',
      'GST Returns Dashboard',
      'GST Payment (PMT-06)',
      'GST Notices & Orders',
      'GST Registration Services',
    ],
  },
  {
    id: 'gst_returns',
    healthId: 'gst_login',
    title: 'GST Returns Dashboard',
    categoryLabel: 'Monthly / Quarterly Compliance',
    description:
      'Access period-wise return dashboard, GSTR-2A / GSTR-2B ITC statements, electronic credit & cash ledgers, and challans.',
    officialUrl: 'https://services.gst.gov.in/services/login',
    navigationPath: 'Login → Services → Returns → Returns Dashboard',
    features: [
      'View Filed & Pending Return Periods',
      'Download GSTR-2A & GSTR-2B Statements',
      'Electronic Cash & Credit Ledger Balance',
      'Create Tax Payment Challan (PMT-06)',
      'Track Late Fees & Interest Liability',
    ],
  },
  {
    id: 'gstr1_filing',
    healthId: 'gst_login',
    title: 'GSTR-1 Filing',
    categoryLabel: 'Outward Supplies Return',
    description:
      'Prepare, validate, and upload B2B, B2C, Credit/Debit Notes, Export invoices, and HSN summaries directly on GSTN.',
    officialUrl: 'https://services.gst.gov.in/services/login',
    navigationPath:
      'Login → Services → Returns → Returns Dashboard → Select Financial Year and Period → GSTR-1',
    features: [
      'GSTR-1 Return Filing',
      'Sales Invoice Data Preparation',
      'B2B Sales',
      'B2C Sales',
      'Credit Notes',
      'Debit Notes',
      'Export Invoices',
      'HSN Summary',
      'Save and Submit Return',
    ],
  },
  {
    id: 'gstr3b_filing',
    healthId: 'gst_login',
    title: 'GSTR-3B Filing',
    categoryLabel: 'Monthly Summary & Tax Payment',
    description:
      'File monthly or QRMP tax summary declaring outward taxable supplies, eligible Input Tax Credit (ITC), RCM, and offset payment.',
    officialUrl: 'https://services.gst.gov.in/services/login',
    navigationPath:
      'Login → Services → Returns → Returns Dashboard → Select Period → GSTR-3B',
    features: [
      'GSTR-3B Return Preparation',
      'Outward Taxable Supplies',
      'Input Tax Credit (ITC)',
      'Reverse Charge',
      'Tax Liability Calculation',
      'Interest and Late Fee',
      'Tax Payment',
      'Submit and File Return',
    ],
  },
  {
    id: 'eway_bill',
    healthId: 'eway_1',
    title: 'E-Way Bill Generation',
    categoryLabel: 'NIC E-Way Bill System',
    description:
      'Generate, print, extend validity, cancel, or update vehicle/transporter details on E-Way Bills (with NIC Mirror 2 failover).',
    officialUrl: 'https://ewaybillgst.gov.in/',
    altUrl: {
      label: 'Open Mirror Portal (NIC 2)',
      url: 'https://ewaybill2.gst.gov.in/',
      healthId: 'eway_2',
    },
    features: [
      'Generate New E-Way Bill',
      'Generate E-Way Bill From Invoice',
      'Update Vehicle Number',
      'Update Transporter Details',
      'Extend Validity',
      'Cancel E-Way Bill',
      'Print E-Way Bill',
      'Search E-Way Bill',
      'Consolidated E-Way Bill',
    ],
  },
  {
    id: 'einvoice_irp',
    healthId: 'irp_1',
    title: 'E-Invoice / IRN Generation (IRP 1 – IRP 6)',
    categoryLabel: 'Invoice Registration Portals',
    description:
      'Generate IRN, Acknowledgement Number, and digitally signed QR codes across all 6 authorized GSTN Invoice Registration Portals.',
    officialUrl: 'https://einvoice1.gst.gov.in/',
    irpList: [
      { label: 'IRP 1 (NIC)', url: 'https://einvoice1.gst.gov.in/', healthId: 'irp_1' },
      { label: 'IRP 2 (NIC 2)', url: 'https://einvoice2.gst.gov.in/', healthId: 'irp_2' },
      { label: 'IRP 3 (Cygnet)', url: 'https://einvoice3.gst.gov.in/', healthId: 'irp_3' },
      { label: 'IRP 4 (Defmacro)', url: 'https://einvoice4.gst.gov.in/', healthId: 'irp_4' },
      { label: 'IRP 5 (EY)', url: 'https://einvoice5.gst.gov.in/', healthId: 'irp_5' },
      { label: 'IRP 6 (IRIS)', url: 'https://einvoice6.gst.gov.in/', healthId: 'irp_6' },
    ],
    features: [
      'Generate E-Invoice',
      'Generate Invoice Reference Number (IRN)',
      'Generate Acknowledgement Number',
      'Generate Signed QR Code',
      'Download Signed Invoice',
      'Cancel E-Invoice',
      'Search IRN',
      'Verify IRN',
    ],
  },
  {
    id: 'gstin_verify',
    healthId: 'gstin_search',
    title: 'GSTIN Verification',
    categoryLabel: 'Public Taxpayer Search',
    description:
      'Verify counterparty GSTIN active status, legal name, trade name, taxpayer type, state jurisdiction, and registration date.',
    officialUrl: 'https://services.gst.gov.in/services/searchtp',
    features: [
      'Enter GSTIN',
      'Verify GSTIN',
      'Display Registered Business Name',
      'Display Legal Name',
      'Display Registration Status',
      'Display Taxpayer Type',
      'Display State and Registration Date',
    ],
  },
  {
    id: 'irn_verify',
    healthId: 'irn_search',
    title: 'IRN Verification',
    categoryLabel: 'Official E-Invoice IRN Search',
    description:
      'Search and authenticate any 64-character Invoice Reference Number (IRN) or signed invoice on the official IRP lookup portal.',
    officialUrl: 'https://einvoice.gst.gov.in/einvoice/search-irn',
    features: [
      'Verify 64-Character IRN Hash',
      'Confirm Signed Invoice Authenticity',
      'Verify Acknowledgement Number & Date',
      'Validate QR Code Integrity',
    ],
  },
];

// Mod-36 GSTIN checksum validation helper (pure client-side structural check)
function validateGstinChecksum(rawGstin: string) {
  const gstin = rawGstin.trim().toUpperCase();
  const formatRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!formatRegex.test(gstin)) {
    return { valid: false, gstin, error: 'Must be 15 characters in standard GSTIN format (e.g. 27AABCU9603R1ZM).' };
  }
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = chars.indexOf(gstin[i]);
    if (val === -1) return { valid: false, gstin, error: 'Invalid character in GSTIN.' };
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = val * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  const checkIdx = (36 - (sum % 36)) % 36;
  const expectedChar = chars[checkIdx];
  const checksumMatch = expectedChar === gstin[14];
  const stateCode = gstin.slice(0, 2);
  const stateName = INDIAN_STATES.find((s) => s.code === stateCode)?.name || `State Code ${stateCode}`;
  const pan = gstin.slice(2, 12);
  return {
    valid: checksumMatch,
    gstin,
    stateCode,
    stateName,
    pan,
    entityNumber: gstin[12],
    error: checksumMatch ? '' : `Checksum digit mismatch (expected '${expectedChar}', got '${gstin[14]}').`,
  };
}

export const GstPortalsView: React.FC = () => {
  const {
    db,
    language,
    checkPortalsHealth,
    logPortalAction,
    getGstApiStatus,
    saveGstApiConfig,
    testGstApiConnection,
    saveComplianceItem,
    updateComplianceStatus,
  } = useStore();

  const [tab, setTab] = useState<PortalTab>('portals');
  const [healthMap, setHealthMap] = useState<Record<string, PortalHealthResult>>({});
  const [checkedAt, setCheckedAt] = useState<string>('');
  const [probing, setProbing] = useState<boolean>(false);
  const [probeError, setProbeError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Quick GSTIN & IRN pre-check tools
  const [gstinInput, setGstinInput] = useState<string>('');
  const [irnInput, setIrnInput] = useState<string>('');

  // Filing status form state
  const [newFilingTitle, setNewFilingTitle] = useState<string>('GSTR-1 Return');
  const [newFilingDue, setNewFilingDue] = useState<string>(new Date().toISOString().slice(0, 10));
  const [newFilingStatus, setNewFilingStatus] = useState<ComplianceItem['status']>('Pending Portal');
  const [newFilingRef, setNewFilingRef] = useState<string>('');
  const [newFilingNotes, setNewFilingNotes] = useState<string>('');
  const [arnInputs, setArnInputs] = useState<Record<string, string>>({});

  // Authorized GSP / API state
  const [apiReadiness, setApiReadiness] = useState<GstApiReadiness | null>(null);
  const [apiConfigForm, setApiConfigForm] = useState<GstApiIntegrationConfig>({
    gspProvider: 'Unassigned (Manual Portal Mode)',
    environment: 'sandbox',
    authorizedGstin: '',
    apiModeEnabled: false,
  });
  const [apiTestResult, setApiTestResult] = useState<{ status: 'success' | 'failed'; message: string } | null>(null);
  const [testingService, setTestingService] = useState<string>('');

  const showToast = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 5000);
  };

  const refreshHealth = useCallback(async () => {
    setProbing(true);
    setProbeError('');
    try {
      const res = await checkPortalsHealth();
      const next: Record<string, PortalHealthResult> = {};
      for (const p of res.portals) {
        next[p.id] = p;
      }
      setHealthMap(next);
      setCheckedAt(res.checkedAt);
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Unable to probe government portals right now.');
    } finally {
      setProbing(false);
    }
  }, [checkPortalsHealth]);

  useEffect(() => {
    void refreshHealth();
    void getGstApiStatus()
      .then((res) => {
        setApiReadiness(res);
        setApiConfigForm(res.config);
      })
      .catch(() => {
        // Ignore initial load error
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taxSummary = useMemo(() => {
    const active = (db?.vouchers || []).filter((v) => v.status !== 'cancelled');
    const sales = active.filter((v) => v.type === 'sale_invoice');
    const cns = active.filter((v) => v.type === 'credit_note');
    const purchases = active.filter((v) => v.type === 'purchase_bill');
    const dns = active.filter((v) => v.type === 'debit_note');
    const outwardTax =
      sales.reduce((s, v) => s + v.taxTotal, 0) - cns.reduce((s, v) => s + v.taxTotal, 0);
    const itcTax =
      purchases.filter((p) => !p.isReverseCharge).reduce((s, v) => s + v.taxTotal, 0) -
      dns.reduce((s, v) => s + v.taxTotal, 0);
    const ewayPending = sales.filter((v) => v.grandTotal >= 50000 && !v.ewayBillNo);
    const irnPending = sales.filter((v) => Boolean(v.partyGstin) && !v.irn);
    const irnIssued = sales.filter((v) => Boolean(v.irn));
    return {
      b2bCount: sales.filter((v) => Boolean(v.partyGstin)).length,
      b2cCount: sales.filter((v) => !v.partyGstin).length,
      cnCount: cns.length,
      outwardTax,
      itcTax,
      netPayable: outwardTax - itcTax,
      ewayPendingCount: ewayPending.length,
      ewayPending,
      irnPendingCount: irnPending.length,
      irnIssued,
    };
  }, [db?.vouchers]);

  const portalAuditLogs = useMemo(() => {
    return (db?.auditLogs || []).filter(
      (a) =>
        a.entityType === 'GovernmentPortal' ||
        a.entityType === 'Compliance' ||
        a.action.includes('PORTAL') ||
        a.action.includes('GST') ||
        a.action.includes('FILING') ||
        a.action.includes('IRN')
    );
  }, [db?.auditLogs]);

  const gstComplianceItems = useMemo(() => {
    return (db?.complianceItems || []).filter((c) => c.category === 'GST');
  }, [db?.complianceItems]);

  const healthCounts = useMemo(() => {
    const vals = Object.values(healthMap);
    return {
      total: vals.length,
      online: vals.filter((v) => v.status === 'online').length,
      degraded: vals.filter((v) => v.status === 'degraded').length,
      down: vals.filter((v) => v.status === 'down').length,
    };
  }, [healthMap]);

  if (!db) return null;

  const handlePortalLaunch = async (portalId: string, portalName: string, url: string) => {
    try {
      await logPortalAction({
        portalId,
        portalName,
        url,
        action: 'MANUAL_PORTAL_OPEN',
        statusNote: 'Opened official government portal manually in browser tab (Return status remains Pending/Unfiled until ARN verified)',
      });
    } catch {
      // Non-blocking audit record
    }
  };

  const handleExportGstr1Json = async () => {
    const sales = db.vouchers.filter((v) => v.type === 'sale_invoice' && v.status !== 'cancelled');
    const b2b = sales.filter((v) => Boolean(v.partyGstin));
    const b2c = sales.filter((v) => !v.partyGstin);
    const payload = {
      gstin: db.profile.gstin,
      legal_name: db.profile.companyName,
      fp: new Date().toISOString().slice(0, 7).replace('-', ''),
      generatedAt: new Date().toISOString(),
      b2b: b2b.map((inv) => ({
        ctin: inv.partyGstin,
        inv: [
          {
            inum: inv.voucherNo,
            idt: inv.date,
            val: inv.grandTotal,
            pos: inv.placeOfSupply || db.profile.state,
            rchrg: inv.isReverseCharge ? 'Y' : 'N',
            itms: inv.lines.map((l, idx) => ({
              num: idx + 1,
              itm_det: {
                txval: l.taxableAmount,
                rt: l.taxRate,
                camt: l.cgst,
                samt: l.sgst,
                iamt: l.igst,
                csamt: l.cess,
              },
            })),
          },
        ],
      })),
      b2cs: b2c.map((inv) => ({
        sply_ty: inv.isInterState ? 'INTER' : 'INTRA',
        pos: inv.placeOfSupply || db.profile.state,
        txval: inv.subTotal,
        tax: inv.taxTotal,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_Prepared_${db.profile.gstin || 'Draft'}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await logPortalAction({
      portalId: 'gstr1_filing',
      portalName: 'GSTR-1 JSON Export',
      action: 'RETURN_JSON_PREPARED',
      statusNote: `Prepared GSTR-1 JSON (${b2b.length} B2B, ${b2c.length} B2C invoices) — ready for manual upload on services.gst.gov.in`,
    });
    showToast(`GSTR-1 JSON downloaded (${b2b.length} B2B, ${b2c.length} B2C). Upload on Official GST Portal to complete filing.`);
  };

  const handleExportEwayJson = async () => {
    const bills = taxSummary.ewayPending;
    const payload = {
      version: '1.0.0421',
      billLists: bills.map((v) => ({
        userGstin: db.profile.gstin,
        supplyType: 'O',
        subSupplyType: 1,
        docType: 'INV',
        docNo: v.voucherNo,
        docDate: v.date,
        toGstin: v.partyGstin || 'URP',
        toTrdName: v.partyName || 'Customer',
        toStateCode: v.placeOfSupply || db.profile.state,
        totalValue: v.subTotal,
        totInvValue: v.grandTotal,
        transMode: 1,
        vehicleNo: v.vehicleNo || '',
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EWayBill_Bulk_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await logPortalAction({
      portalId: 'eway_bill',
      portalName: 'E-Way Bill JSON Export',
      action: 'RETURN_JSON_PREPARED',
      statusNote: `Prepared bulk E-Way JSON for ${bills.length} pending invoice(s) >= Rs.50,000`,
    });
    showToast(`E-Way Bill JSON downloaded for ${bills.length} invoice(s). Upload at ewaybillgst.gov.in.`);
  };

  const renderServerStatusPill = (healthId: string, compact = false) => {
    const res = healthMap[healthId];
    if (probing && !res) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <RefreshCw className="w-3 h-3 animate-spin" /> Checking...
        </span>
      );
    }
    if (!res) {
      return <span className="text-[11px] text-slate-400">Not checked yet</span>;
    }
    if (res.status === 'online') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
          <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
          {compact ? `Up · ${res.latencyMs}ms` : `Server Online · HTTP ${res.httpStatus ?? 200} · ${res.latencyMs}ms`}
        </span>
      );
    }
    if (res.status === 'degraded') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 font-mono tabular-nums">
          <span className="w-2 h-2 rounded-full bg-amber-600 shrink-0" />
          {compact ? `Slow · ${res.latencyMs}ms` : `Slow Response · ${res.latencyMs}ms`}
        </span>
      );
    }
    return (
      <span
        title={res.error || 'Server Down / Timed Out'}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-400 font-mono tabular-nums"
      >
        <span className="w-2 h-2 rounded-full bg-rose-600 shrink-0" />
        {compact ? 'Server Down' : `Server Down / Unreachable`}
      </span>
    );
  };

  const gstinCheck = gstinInput.trim() ? validateGstinChecksum(gstinInput) : null;
  const matchedLocalParty = gstinCheck
    ? db.parties.find((p) => (p.gstin || '').toUpperCase() === gstinCheck.gstin)
    : undefined;

  const cleanIrn = irnInput.trim().toLowerCase();
  const irnValidFormat = /^[0-9a-f]{64}$/.test(cleanIrn);
  const matchedLocalIrnVoucher = cleanIrn
    ? db.vouchers.find((v) => (v.irn || '').toLowerCase() === cleanIrn)
    : undefined;

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SERVICE_CARDS;
    return SERVICE_CARDS.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.officialUrl.toLowerCase().includes(q) ||
        c.features.some((f) => f.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  const isHi = language === 'hi';

  return (
    <div className="space-y-6">
      {/* Header Banner (Neutral Enterprise Surface — Single Elevation) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-medium text-indigo-700 dark:text-indigo-400">
            {isHi ? 'सरकारी जीएसटी एकीकरण केंद्र' : 'Government Compliance & Official Portals'}
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            {isHi ? 'GST सरकारी पोर्टल व लाइव सर्वर मॉनिटर' : 'Government GST Portal Integration Centre'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
            {isHi
              ? 'सभी आधिकारिक GST, GSTR-1, GSTR-3B, E-Way Bill, E-Invoice (IRP 1–6), GSTIN और IRN सत्यापन पोर्टल यहीं से खोलें और रियल-टाइम सर्वर स्थिति देखें।'
              : 'Direct official links to GSTN Returns, E-Way Bill, E-Invoice (IRP 1–6), GSTIN & IRN verification portals with real-time server health probes and filing audit tracking.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void refreshHealth()}
            disabled={probing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
            {probing ? 'Checking Servers...' : isHi ? 'लाइव सर्वर स्थिति जांचें' : 'Check Live Server Status'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-indigo-900 dark:text-indigo-200 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-xs font-semibold underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {probeError && (
        <div className="px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" />
          <span>{probeError}</span>
        </div>
      )}

      {/* Real-Time Server Summary & Quick Portal Launch Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Important Links — Live Government Portal Monitor
            </span>
            <span className="text-slate-400" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
              {healthCounts.online}/{healthCounts.total || 11} Online
            </span>
            {healthCounts.degraded > 0 && (
              <>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400 font-semibold">
                  {healthCounts.degraded} Slow
                </span>
              </>
            )}
            {healthCounts.down > 0 && (
              <>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-rose-700 dark:text-rose-400 font-semibold">
                  {healthCounts.down} Server Down
                </span>
              </>
            )}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500">
            {checkedAt ? `Last probed: ${new Date(checkedAt).toLocaleTimeString('en-IN')}` : 'Probing official domains...'}
          </div>
        </div>

        {/* Direct 1-Click Launch Strip */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {[
            { id: 'gst_login', label: 'GST Portal Login', url: 'https://services.gst.gov.in/services/login' },
            { id: 'gstin_search', label: 'GSTIN Verification', url: 'https://services.gst.gov.in/services/searchtp' },
            { id: 'eway_1', label: 'E-Way Bill', url: 'https://ewaybillgst.gov.in/' },
            { id: 'eway_2', label: 'E-Way Mirror 2', url: 'https://ewaybill2.gst.gov.in/' },
            { id: 'irp_1', label: 'E-Invoice IRP 1', url: 'https://einvoice1.gst.gov.in/' },
            { id: 'irn_search', label: 'Search IRN', url: 'https://einvoice.gst.gov.in/einvoice/search-irn' },
          ].map((quick) => (
            <a
              key={quick.id}
              href={quick.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void handlePortalLaunch(quick.id, quick.label, quick.url)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:border-indigo-400 dark:hover:border-indigo-500 text-xs transition-colors whitespace-nowrap"
            >
              <span className="font-semibold text-slate-900 dark:text-white">{quick.label}</span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              {renderServerStatusPill(quick.id, true)}
              <ArrowUpRight className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Navigation Segmented Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('portals')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'portals'
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Official Portals &amp; Verification (8)
          </button>
          <button
            type="button"
            onClick={() => setTab('filing_audit')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'filing_audit'
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Filing Tracker &amp; Audit Log ({portalAuditLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('api_integration')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'api_integration'
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Authorized GSTN / IRP API Setup
          </button>
        </div>

        {tab === 'portals' && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter portals or features..."
              className="pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 w-64"
            />
          </div>
        )}
      </div>

      {/* TAB 1: OFFICIAL PORTALS (8 SERVICE CARDS + TOOLS) */}
      {tab === 'portals' && (
        <div className="space-y-4">
          {/* 8 Compact Service Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredCards.map((card) => (
              <div
                key={card.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {card.categoryLabel}
                      </div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                        {card.title}
                      </h3>
                    </div>
                    {renderServerStatusPill(card.healthId)}
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {card.description}
                  </p>

                  {/* Official URL Box */}
                  <div className="text-xs font-mono text-indigo-700 dark:text-indigo-400 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 rounded-lg break-all flex items-center justify-between gap-2">
                    <span>{card.officialUrl}</span>
                    <a
                      href={card.officialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => void handlePortalLaunch(card.id, card.title, card.officialUrl)}
                      aria-label={`Open ${card.officialUrl}`}
                      className="text-indigo-600 hover:text-indigo-800 shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  {card.navigationPath && (
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Direct Navigation:{' '}
                      </span>
                      {card.navigationPath}
                    </div>
                  )}

                  {/* Features List (Clean unboxed typography, zero static pills) */}
                  <div className="pt-1">
                    <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Portal Capabilities
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                      {card.features.map((feat) => (
                        <div key={feat} className="truncate">
                          · {feat}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* All 6 IRP Portals Status & Direct Launch for E-Invoice Card */}
                  {card.irpList && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        All 6 Official IRP Portals — Real-Time Server Status
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {card.irpList.map((irp) => (
                          <a
                            key={irp.healthId}
                            href={irp.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => void handlePortalLaunch(irp.healthId, irp.label, irp.url)}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-400 text-xs transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 dark:text-white truncate">
                                {irp.label}
                              </div>
                              <div className="text-[10px] font-mono text-slate-500 truncate">
                                {irp.url.replace('https://', '')}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {renderServerStatusPill(irp.healthId, true)}
                              <ExternalLink className="w-3 h-3 text-indigo-600" />
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Built-in GSTIN Format & Checksum Helper inside GSTIN Verification card */}
                  {card.id === 'gstin_verify' && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Pre-Check GSTIN Format &amp; Local Party Match (Official Lookup Opens on Portal)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={15}
                          value={gstinInput}
                          onChange={(e) => setGstinInput(e.target.value.toUpperCase())}
                          placeholder="Enter 15-digit GSTIN (e.g. 27AABCU9603R1ZM)"
                          className="flex-1 px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        />
                        {gstinCheck && (
                          <button
                            type="button"
                            onClick={() =>
                              void logPortalAction({
                                portalId: 'gstin_verify',
                                portalName: `GSTIN Check ${gstinCheck.gstin}`,
                                action: 'GSTIN_CHECKSUM_CHECK',
                                statusNote: gstinCheck.valid
                                  ? `Valid structure (${gstinCheck.stateName}, PAN ${gstinCheck.pan})`
                                  : gstinCheck.error,
                              })
                            }
                            className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Log Check
                          </button>
                        )}
                      </div>
                      {gstinCheck && (
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 text-xs space-y-1">
                          {gstinCheck.valid ? (
                            <>
                              <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Valid 15-Digit GSTIN Checksum
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                                State: {gstinCheck.stateName} ({gstinCheck.stateCode}) · PAN: {gstinCheck.pan}
                              </div>
                              {matchedLocalParty ? (
                                <div className="text-[11px] text-indigo-700 dark:text-indigo-400 font-medium">
                                  Matched Local Party: {matchedLocalParty.name} ({matchedLocalParty.type})
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-500">
                                  Click Open Portal below to fetch Registered Legal Name, Status &amp; Filing Date on services.gst.gov.in.
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-rose-700 dark:text-rose-400 font-medium flex items-center gap-1.5">
                              <XCircle className="w-3.5 h-3.5 shrink-0" /> {gstinCheck.error}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Built-in IRN Format & Local Invoice Search inside IRN Verification card */}
                  {card.id === 'irn_verify' && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Check 64-Character IRN Hash / Local Invoice Register
                      </label>
                      <input
                        type="text"
                        maxLength={64}
                        value={irnInput}
                        onChange={(e) => setIrnInput(e.target.value)}
                        placeholder="Paste 64-char IRN hex hash to check format & local invoice..."
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      />
                      {cleanIrn.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 text-[11px] space-y-1">
                          {irnValidFormat ? (
                            <div className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Valid 64-character SHA-256 IRN structure
                            </div>
                          ) : (
                            <div className="text-amber-700 dark:text-amber-400 font-medium">
                              Length: {cleanIrn.length}/64 hex characters
                            </div>
                          )}
                          {matchedLocalIrnVoucher && (
                            <div className="text-indigo-700 dark:text-indigo-400 font-medium">
                              Local Voucher Match: {matchedLocalIrnVoucher.voucherNo} ({matchedLocalIrnVoucher.partyName})
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Footer */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  <a
                    href={card.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => void handlePortalLaunch(card.id, card.title, card.officialUrl)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
                  >
                    Open Portal
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  {card.altUrl && (
                    <a
                      href={card.altUrl.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        void handlePortalLaunch(card.altUrl!.healthId, card.altUrl!.label, card.altUrl!.url)
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap"
                    >
                      {card.altUrl.label} ({renderServerStatusPill(card.altUrl.healthId, true)})
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  {card.id === 'gstr1_filing' && (
                    <button
                      type="button"
                      onClick={() => void handleExportGstr1Json()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-indigo-600" />
                      Prepare GSTR-1 JSON
                    </button>
                  )}

                  {card.id === 'eway_bill' && (
                    <button
                      type="button"
                      onClick={() => void handleExportEwayJson()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap"
                    >
                      <Truck className="w-3.5 h-3.5 text-indigo-600" />
                      Export Pending E-Way JSON ({taxSummary.ewayPendingCount})
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: FILING TRACKER & AUDIT LOG */}
      {tab === 'filing_audit' && (
        <div className="space-y-6">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Honest Filing Status Guarantee</div>
              <p className="mt-0.5">
                Opening an official government website logs manual portal navigation only — Shobhit Invoice Pro never marks a GST return as <strong>Filed</strong> unless you record a verified ARN / Acknowledgement Number or complete an authorized GSP API submission.
              </p>
            </div>
          </div>

          {/* Add GST Return Period Tracker */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-indigo-600" />
              GST Return Period Tracker &amp; ARN Verification
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
              <input
                type="text"
                value={newFilingTitle}
                onChange={(e) => setNewFilingTitle(e.target.value)}
                placeholder="Return (e.g. GSTR-1 Nov 2026)"
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
              <input
                type="date"
                value={newFilingDue}
                onChange={(e) => setNewFilingDue(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
              <select
                value={newFilingStatus}
                onChange={(e) => setNewFilingStatus(e.target.value as ComplianceItem['status'])}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="Upcoming">Upcoming</option>
                <option value="Prepared">Prepared (JSON Ready)</option>
                <option value="Pending Portal">Pending Portal Upload</option>
                <option value="Filed">Filed (ARN Verified)</option>
                <option value="Failed">Failed / Validation Error</option>
              </select>
              <input
                type="text"
                value={newFilingRef}
                onChange={(e) => setNewFilingRef(e.target.value)}
                placeholder="ARN / Ack No. (if filed)"
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!newFilingTitle.trim()) return;
                  if (newFilingStatus === 'Filed' && !newFilingRef.trim()) {
                    showToast('Enter the official GST ARN / Acknowledgement No. before marking as Filed.');
                    return;
                  }
                  await saveComplianceItem({
                    title: newFilingTitle.trim(),
                    category: 'GST',
                    dueDate: newFilingDue,
                    status: newFilingStatus,
                    referenceNo: newFilingRef.trim(),
                    notes: newFilingNotes.trim() || 'Tracked via GST Portals Integration Centre',
                  });
                  setNewFilingRef('');
                  setNewFilingNotes('');
                  showToast('GST Filing record saved & added to audit log.');
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Add Return Record
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                    <th className="py-2.5 px-2">Return / Period</th>
                    <th className="py-2.5 px-2">Due Date</th>
                    <th className="py-2.5 px-2">Current Status</th>
                    <th className="py-2.5 px-2">ARN / Reference No.</th>
                    <th className="py-2.5 px-2 text-right">Update Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {gstComplianceItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500">
                        No GST return periods logged yet. Add GSTR-1 or GSTR-3B above.
                      </td>
                    </tr>
                  ) : (
                    gstComplianceItems.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 px-2 font-semibold text-slate-900 dark:text-white">
                          {item.title}
                        </td>
                        <td className="py-2.5 px-2 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {item.dueDate}
                        </td>
                        <td className="py-2.5 px-2">
                          <span
                            className={`font-semibold ${
                              item.status === 'Filed'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : item.status === 'Failed' || item.status === 'Overdue'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : item.status === 'Pending Portal' || item.status === 'Prepared'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-2">
                          <input
                            type="text"
                            value={arnInputs[item.id] ?? item.referenceNo ?? ''}
                            onChange={(e) =>
                              setArnInputs((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            placeholder="Enter ARN..."
                            className="px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 w-44"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-right space-x-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              void updateComplianceStatus(
                                item.id,
                                'Pending Portal',
                                arnInputs[item.id] ?? item.referenceNo ?? ''
                              )
                            }
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Pending
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const arn = (arnInputs[item.id] ?? item.referenceNo ?? '').trim();
                              if (!arn) {
                                showToast('Enter official GST ARN / Reference No. before marking Filed.');
                                return;
                              }
                              void updateComplianceStatus(item.id, 'Filed', arn);
                              showToast(`Marked ${item.title} as Filed (ARN: ${arn}).`);
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                          >
                            Verify &amp; File
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void updateComplianceStatus(
                                item.id,
                                'Failed',
                                arnInputs[item.id] ?? item.referenceNo ?? ''
                              )
                            }
                            className="px-2.5 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400"
                          >
                            Mark Failed
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Portal & API Audit Trail */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                Portal Navigation, Export &amp; API Audit Log
              </h3>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {portalAuditLogs.length} event(s)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                    <th className="py-2 px-2">Timestamp</th>
                    <th className="py-2 px-2">User</th>
                    <th className="py-2 px-2">Action</th>
                    <th className="py-2 px-2">Details &amp; Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {portalAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500">
                        No government portal events logged yet. Opening any official portal or preparing JSON will log an audit record here.
                      </td>
                    </tr>
                  ) : (
                    portalAuditLogs.slice(0, 40).map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 px-2 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('en-IN')}
                        </td>
                        <td className="py-2 px-2 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {log.userName}
                        </td>
                        <td className="py-2 px-2 font-mono font-semibold text-indigo-700 dark:text-indigo-400 whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-2 px-2 text-slate-600 dark:text-slate-300">{log.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: AUTHORIZED GSP / IRP API INTEGRATION */}
      {tab === 'api_integration' && (
        <div className="space-y-6">
          {/* Manual Portal vs Authorized API Distinction */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2.5">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                Mode A — Direct Manual Government Portal Access (Active Now)
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Official Browser Filing &amp; JSON Offline Upload
              </h3>
              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 pt-1">
                <li>· Opens exact official NIC/GSTN URLs in a secure browser tab.</li>
                <li>· Export GSTR-1 &amp; E-Way JSON directly from your Shobhit Invoice Pro vouchers.</li>
                <li>· Login directly on gst.gov.in with EVC OTP or DSC — Shobhit Invoice Pro never handles or stores your GST Portal password or OTPs.</li>
                <li>· Real-time probe monitors whether GSTN, E-Way Bill, or IRP 1–6 servers are reachable before you start filing.</li>
              </ul>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2.5">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-indigo-600" />
                Mode B — Authorized GSP / IRP / E-Way API Integration
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Server-Side GSP Credentials &amp; Security Policy
              </h3>
              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 pt-1">
                <li>· Live GSP APIs require registered GST Suvidha Provider (GSP) or NIC Client ID &amp; Client Secret stored strictly in server environment variables.</li>
                <li>· Never stores plain-text GST passwords, PINs, or SMS OTPs in browser or SQLite database.</li>
                <li>· Every API readiness check and gateway test records explicit Success or Failure in Audit Logs.</li>
              </ul>
            </div>
          </div>

          {/* Server Environment Credential Readiness & GSP Metadata */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  Authorized GSTN / IRP / E-Way API Server Status
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live inspection of server-side environment credentials (`GSTN_GSP_CLIENT_ID`, `IRP_CLIENT_ID`, `EWB_CLIENT_ID`). No mock endpoints are simulated.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {[
                {
                  key: 'gstn' as const,
                  title: 'GSTN Return Filing API (GSP)',
                  configured: apiReadiness?.serverCredentials.gstnConfigured ?? false,
                  envVar: 'GSTN_GSP_CLIENT_ID / SECRET',
                },
                {
                  key: 'irp' as const,
                  title: 'E-Invoice IRP API (NIC / IRP)',
                  configured: apiReadiness?.serverCredentials.irpConfigured ?? false,
                  envVar: 'IRP_CLIENT_ID / SECRET',
                },
                {
                  key: 'ewb' as const,
                  title: 'E-Way Bill API (NIC)',
                  configured: apiReadiness?.serverCredentials.ewbConfigured ?? false,
                  envVar: 'EWB_CLIENT_ID / SECRET',
                },
              ].map((svc) => (
                <div
                  key={svc.key}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-900 dark:text-white">{svc.title}</div>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        svc.configured
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {svc.configured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">Env: {svc.envVar}</div>
                  <button
                    type="button"
                    disabled={testingService === svc.key}
                    onClick={async () => {
                      setTestingService(svc.key);
                      try {
                        const res = await testGstApiConnection(svc.key);
                        setApiTestResult({ status: res.status, message: res.message });
                      } finally {
                        setTestingService('');
                      }
                    }}
                    className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-slate-800 dark:text-slate-200"
                  >
                    {testingService === svc.key ? 'Checking...' : 'Test Server Credentials'}
                  </button>
                </div>
              ))}
            </div>

            {apiTestResult && (
              <div
                className={`p-3.5 rounded-lg border text-xs flex items-start gap-2 ${
                  apiTestResult.status === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200'
                    : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-200'
                }`}
              >
                {apiTestResult.status === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{apiTestResult.message}</span>
              </div>
            )}

            {/* Authorized Taxpayer Profile Metadata (Zero Passwords / Zero OTPs) */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Landmark className="w-4 h-4 text-indigo-600" />
                Taxpayer GSP Preference (Non-Secret Metadata Only)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Authorized GSP Provider</label>
                  <select
                    value={apiConfigForm.gspProvider}
                    onChange={(e) =>
                      setApiConfigForm((p) => ({ ...p, gspProvider: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="Unassigned (Manual Portal Mode)">Unassigned (Manual Portal Mode)</option>
                    <option value="NIC Direct IRP / EWB Gateway">NIC Direct IRP / EWB Gateway</option>
                    <option value="Cygnet GSP">Cygnet GSP</option>
                    <option value="IRIS Business GSP">IRIS Business GSP</option>
                    <option value="ClearTax / Defmacro GSP">ClearTax / Defmacro GSP</option>
                    <option value="Masters India GSP">Masters India GSP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Environment</label>
                  <select
                    value={apiConfigForm.environment}
                    onChange={(e) =>
                      setApiConfigForm((p) => ({
                        ...p,
                        environment: e.target.value === 'production' ? 'production' : 'sandbox',
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="sandbox">Sandbox / Testing</option>
                    <option value="production">Production (Live GSTN)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Registered GSTIN</label>
                  <input
                    type="text"
                    maxLength={15}
                    value={apiConfigForm.authorizedGstin}
                    onChange={(e) =>
                      setApiConfigForm((p) => ({
                        ...p,
                        authorizedGstin: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder={db.profile.gstin || '27AABCU9603R1ZM'}
                    className="w-full px-3 py-2 font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={async () => {
                      const saved = await saveGstApiConfig(apiConfigForm);
                      setApiConfigForm(saved);
                      showToast('Saved Authorized GSP preferences (no passwords/OTPs stored).');
                    }}
                    className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Save Metadata
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
