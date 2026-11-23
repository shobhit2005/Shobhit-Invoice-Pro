import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AppDatabase,
  ApprovalRule,
  BankAccount,
  BomRecipe,
  BudgetRecord,
  BusinessProfile,
  ChequeEntry,
  CommissionRule,
  ComplianceItem,
  CostCentre,
  CurrencyRate,
  CustomReportTemplate,
  DeviceScope,
  DocumentRecord,
  FixedAsset,
  Godown,
  GstApiIntegrationConfig,
  GstApiReadiness,
  Item,
  JobWorkOrder,
  LedgerAccount,
  LicenseRecord,
  LoanAccount,
  OtpIntegrationConfig,
  Party,
  PaymentMode,
  PlanDuration,
  PlanTier,
  PortalHealthResult,
  PricingRule,
  ProductionOrder,
  ProjectJob,
  ScannedInvoiceResult,
  SecuritySettings,
  StaffMember,
  StockAdjustment,
  StockTransfer,
  SubscriptionFeatureKey,
  SubscriptionPlan,
  SubscriptionPlanConfig,
  Voucher,
  VoucherStatus,
  VoucherType,
  WhatsAppStatusInfo,
  WorkflowRule,
  WorkspaceRole,
} from '../types/accounting';
import { mergeAppSettings } from '../utils/defaultAppSettings';
import { getInvoicePdfBase64 } from '../utils/pdfGenerator';
import { generateInvoicePngBase64 } from '../utils/invoiceImageGenerator';

export interface OpsOverviewPayload {
  licenses: LicenseRecord[];
  plans: SubscriptionPlanConfig[];
  settings: {
    detachPasscode: string;
    updatedAt?: string;
    linkedSheetId?: string;
    linkedSheetTitle?: string;
    linkedSheetUrl?: string;
    lastSheetSyncAt?: string;
    lastSheetSyncBy?: string;
  };
}

const TOKEN_KEY = 'shobhit_invoice_pro_token';
const API_BASE = ((import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const apiUrl = (path: string) => (path.startsWith('http') ? path : `${API_BASE}${path}`);

interface StoreContextValue {
  db: AppDatabase | null;
  loading: boolean;
  authError: string;
  darkMode: boolean;
  toggleDarkMode: () => void;
  language: 'en' | 'hi';
  toggleLanguage: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<boolean>;
  register: (payload: {
    name: string;
    phone?: string;
    email?: string;
    password: string;
    companyName?: string;
    gstin?: string;
    state?: string;
    withDemoData?: boolean;
  }) => Promise<boolean>;
  requestAuthOtp: (
    target: string,
    channel?: 'phone' | 'email'
  ) => Promise<{
    ok: boolean;
    userName: string;
    target: string;
    channel: 'phone' | 'email';
    deliveredVia: string[];
    externalSent: boolean;
    otpPreview?: string;
    warnings?: string[];
  }>;
  verifyAuthOtp: (target: string, channel: 'phone' | 'email', code: string) => Promise<boolean>;
  loginDemo: () => Promise<boolean>;
  logout: () => Promise<void>;
  createCompany: (payload: { companyName: string; gstin?: string; state?: string; financialYear?: string }) => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  createBranch: (payload: { name: string; code: string; address?: string; manager?: string }) => Promise<void>;
  getNextVoucherNo: (type: VoucherType) => string;
  getEffectivePaid: (v: Voucher) => number;
  getEffectiveStatus: (v: Voucher) => VoucherStatus;
  getPartyBalance: (partyId: string) => number;
  getBankBalance: (bankId: string) => number;
  getTotalCashBalance: () => number;
  getTotalBankBalance: () => number;
  getTotalStockValue: () => number;
  getPendingInvoicesForParty: (partyId: string, kind: 'receivable' | 'payable') => (Voucher & { balanceDue: number })[];
  saveVoucher: (voucher: Voucher, options?: { convertFromVoucherId?: string }) => Promise<Voucher>;
  cancelVoucher: (id: string) => Promise<void>;
  reconcileVoucher: (id: string, reconciled: boolean) => Promise<void>;
  deleteVoucher: (id: string) => Promise<void>;
  saveParty: (party: Party) => Promise<Party | undefined>;
  deleteParty: (id: string) => Promise<void>;
  saveItem: (item: Item) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  saveGodown: (godown: Godown) => Promise<void>;
  saveStockAdjustment: (adj: Omit<StockAdjustment, 'id'>) => Promise<void>;
  saveStockTransfer: (trf: Omit<StockTransfer, 'id' | 'transferNo'>) => Promise<void>;
  saveBankAccount: (acc: BankAccount) => Promise<void>;
  deleteBankAccount: (id: string) => Promise<void>;
  restoreFromRecycleBin: (id: string) => Promise<void>;
  deleteRecycleBinItem: (id: string) => Promise<void>;
  emptyRecycleBin: () => Promise<void>;
  isLocked: boolean;
  lockApp: () => void;
  unlockApp: (pin: string) => boolean;
  saveCheque: (cheque: ChequeEntry) => Promise<void>;
  updateChequeStatus: (id: string, status: 'pending' | 'cleared' | 'bounced') => Promise<void>;
  saveLoan: (loan: LoanAccount) => Promise<void>;
  payLoanEmi: (loanId: string) => Promise<void>;
  saveLedgerAccount: (payload: Omit<LedgerAccount, 'id' | 'isSystem'>) => Promise<void>;
  saveStaff: (member: StaffMember) => Promise<void>;
  deleteStaff: (id: string) => Promise<void>;
  payStaffSalary: (
    staffId: string,
    month: string,
    bankAccountId: string,
    overrides?: {
      attendanceDays?: number;
      overtimeHours?: number;
      bonusAmt?: number;
      arrearsAmt?: number;
      otherDeductions?: number;
      commissionAmt?: number;
      notes?: string;
    }
  ) => Promise<void>;
  runBulkPayroll: (month: string, bankAccountId: string) => Promise<number>;
  saveEmployeeAdvance: (payload: {
    staffId: string;
    staffName: string;
    date: string;
    type: 'Salary Advance' | 'Staff Loan';
    amount: number;
    monthlyEmi: number;
    reason: string;
  }) => Promise<void>;
  saveLeaveRequest: (payload: {
    staffId: string;
    staffName: string;
    leaveType: 'CL' | 'SL' | 'EL' | 'LOP';
    fromDate: string;
    toDate: string;
    days: number;
    reason: string;
  }) => Promise<void>;
  decideLeaveRequest: (id: string, status: 'Approved' | 'Rejected') => Promise<void>;
  saveReimbursement: (payload: {
    staffId: string;
    staffName: string;
    date: string;
    category: 'Travel' | 'Food' | 'Fuel' | 'Mobile/Internet' | 'Medical' | 'Other';
    amount: number;
    description: string;
  }) => Promise<void>;
  decideReimbursement: (id: string, status: 'Approved' | 'Paid') => Promise<void>;
  updateProfile: (profile: BusinessProfile) => Promise<void>;
  clearDemoData: () => Promise<void>;
  resetToDemo: () => Promise<void>;
  importDatabase: (data: AppDatabase) => Promise<void>;
  // Next-Gen ERP methods
  updateShipmentStatus: (voucherId: string, shipmentStatus: string, trackingNo?: string) => Promise<void>;
  saveCostCentre: (cc: Partial<CostCentre>) => Promise<void>;
  saveBudget: (budget: Partial<BudgetRecord>) => Promise<void>;
  saveFixedAsset: (asset: Partial<FixedAsset>) => Promise<void>;
  runDepreciation: (assetId: string) => Promise<void>;
  saveBom: (bom: Partial<BomRecipe>) => Promise<void>;
  saveProductionOrder: (ord: Partial<ProductionOrder>) => Promise<void>;
  completeProductionOrder: (orderId: string, payload?: { actualMaterialCost?: number; actualLabourOverhead?: number; wastagePct?: number }) => Promise<void>;
  saveJobWork: (jw: Partial<JobWorkOrder>) => Promise<void>;
  updateJobWork: (id: string, payload: { qtyReceivedBack: number; wastageQty: number; status: string }) => Promise<void>;
  saveProject: (prj: Partial<ProjectJob>) => Promise<void>;
  saveWorkflowRule: (wf: Partial<WorkflowRule>) => Promise<void>;
  saveApprovalRule: (rule: Partial<ApprovalRule>) => Promise<void>;
  decideApproval: (voucherId: string, decision: 'approved' | 'rejected') => Promise<void>;
  saveCurrencyRate: (cur: CurrencyRate) => Promise<void>;
  saveCommissionRule: (rule: Partial<CommissionRule>) => Promise<void>;
  savePricingRule: (rule: Partial<PricingRule>) => Promise<void>;
  saveSubscription: (sub: Partial<SubscriptionPlan>) => Promise<void>;
  runSubscriptions: (subId?: string) => Promise<void>;
  runRecurringVoucher: (voucherId: string) => Promise<string>;
  saveComplianceItem: (item: Partial<ComplianceItem>) => Promise<void>;
  updateComplianceStatus: (id: string, status: string, referenceNo?: string) => Promise<void>;
  saveDocument: (doc: Partial<DocumentRecord>) => Promise<void>;
  createApiKey: (label: string, scopes?: string[]) => Promise<void>;
  createWebhook: (event: string, targetUrl: string) => Promise<void>;
  testWebhook: (id: string) => Promise<void>;
  saveCustomReport: (report: Partial<CustomReportTemplate>) => Promise<void>;
  saveSecuritySettings: (sec: SecuritySettings) => Promise<void>;
  runMarketplaceSync: (channel: string) => Promise<string[]>;
  checkPortalsHealth: () => Promise<{ portals: PortalHealthResult[]; checkedAt: string }>;
  logPortalAction: (payload: {
    portalId: string;
    portalName: string;
    url?: string;
    action?: 'MANUAL_PORTAL_OPEN' | 'RETURN_JSON_PREPARED' | 'GSTIN_CHECKSUM_CHECK' | 'IRN_LOCAL_CHECK';
    statusNote?: string;
  }) => Promise<void>;
  getGstApiStatus: () => Promise<GstApiReadiness>;
  saveGstApiConfig: (config: Partial<GstApiIntegrationConfig>) => Promise<GstApiIntegrationConfig>;
  testGstApiConnection: (service: 'gstn' | 'irp' | 'ewb') => Promise<{ success: boolean; status: 'success' | 'failed'; message: string }>;
  getAiStatus: () => Promise<{ configured: boolean; model: string }>;
  scanInvoiceOcr: (payload: { base64Data?: string; mimeType?: string; rawText?: string }) => Promise<ScannedInvoiceResult>;
  bulkImportItems: (items: Partial<Item>[]) => Promise<{ importedCount: number; updatedCount: number }>;
  bulkImportParties: (parties: Partial<Party>[]) => Promise<{ importedCount: number; updatedCount: number }>;
  hasFeature: (feature: SubscriptionFeatureKey) => boolean;
  purchaseSubscription: (payload: {
    tier: PlanTier;
    deviceScope: DeviceScope;
    duration: PlanDuration;
    customerName: string;
    phone: string;
    gstin?: string;
    paymentMode?: PaymentMode;
    paymentRef?: string;
  }) => Promise<LicenseRecord>;
  requestSubscriptionOtp: (phone: string) => Promise<{ ok: boolean; phone: string; otpCode: string; licenseCount: number }>;
  verifySubscriptionOtp: (phone: string, otp: string) => Promise<LicenseRecord[]>;
  attachLicense: (payload: { licenseId?: string; licenseCode?: string }) => Promise<void>;
  detachLicense: (passcode: string) => Promise<void>;
  opsAuth: (password: string) => Promise<OpsOverviewPayload>;
  opsVerifyLicense: (
    opsPassword: string,
    licenseId: string,
    payload: { transactionId?: string; screenshotDataUrl?: string }
  ) => Promise<OpsOverviewPayload & { license: LicenseRecord }>;
  opsUpdateLicense: (
    opsPassword: string,
    licenseId: string,
    payload: { status?: 'active' | 'deactivated'; extendDays?: number; expiresAt?: string }
  ) => Promise<OpsOverviewPayload>;
  opsUpdatePlan: (
    opsPassword: string,
    tier: PlanTier,
    payload: Partial<SubscriptionPlanConfig>
  ) => Promise<OpsOverviewPayload>;
  opsUpdatePasscodes: (
    opsPassword: string,
    payload: { detachPasscode?: string; newOpsPassword?: string }
  ) => Promise<OpsOverviewPayload>;
  opsFetchTelemetry: (opsPassword: string) => Promise<{ ok: boolean; telemetry: import('../utils/googleWorkspaceSync').OpsTelemetryData }>;
  opsSaveSheetLink: (
    opsPassword: string,
    payload: {
      linkedSheetId: string;
      linkedSheetTitle: string;
      linkedSheetUrl: string;
      lastSheetSyncAt?: string;
      lastSheetSyncBy?: string;
    }
  ) => Promise<OpsOverviewPayload & { telemetry: import('../utils/googleWorkspaceSync').OpsTelemetryData }>;
  saveWorkspaceMember: (payload: {
    id?: string;
    name: string;
    phone: string;
    email?: string;
    role: WorkspaceRole;
    permissions?: string[];
    active?: boolean;
  }) => Promise<void>;
  deleteWorkspaceMember: (id: string) => Promise<void>;
  getOtpIntegrations: () => Promise<OtpIntegrationConfig>;
  saveOtpIntegrations: (payload: Partial<OtpIntegrationConfig>) => Promise<OtpIntegrationConfig>;
  testOtpIntegration: (
    target: string,
    channel?: 'phone' | 'email'
  ) => Promise<{
    target: string;
    channel: 'phone' | 'email';
    deliveredVia: string[];
    externalSent: boolean;
    otpPreview?: string;
    warnings?: string[];
  }>;
  getWhatsAppStatus: () => Promise<WhatsAppStatusInfo>;
  connectWhatsApp: () => Promise<WhatsAppStatusInfo>;
  disconnectWhatsApp: () => Promise<WhatsAppStatusInfo>;
  sendTransactionWhatsApp: (payload: {
    phone: string;
    text: string;
    pdfBase64?: string;
    pdfFileName?: string;
    imageBase64?: string;
    copyToSelf?: boolean;
  }) => Promise<{ ok: boolean; sentCount: number; message: string }>;
  dispatchAutoTransactionMessage: (voucher: Voucher, partyOverride?: Party) => Promise<{ sent: boolean; message?: string }>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || '');
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string>('');
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('shobhit_dark') === 'true');
  const [isLocked, setIsLocked] = useState<boolean>(() => localStorage.getItem('shobhit_app_locked') === 'true');

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('shobhit_dark', String(darkMode));
  }, [darkMode]);

  const apiFetch = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(apiUrl(url), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
        setDb(null);
      }
      throw new Error(body.error || 'Request failed');
    }
    return body as T;
  };

  // On initial boot: if token exists, hydrate from /api/bootstrap; else auto-login demo OR show login screen?
  // Wait: let's auto-bootstrap with demo session on first visit if user has never logged out, OR show crisp Auth gate if logged out!
  useEffect(() => {
    let active = true;
    async function init() {
      setLoading(true);
      try {
        if (token) {
          const res = await fetch(apiUrl('/api/bootstrap'), {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const json = await res.json();
            if (active) setDb(json.data);
          } else {
            localStorage.removeItem(TOKEN_KEY);
            if (active) setToken('');
          }
        } else if (!localStorage.getItem('shobhit_logged_out')) {
          const res = await fetch(apiUrl('/api/auth/demo'), { method: 'POST' });
          if (res.ok) {
            const json = await res.json();
            localStorage.setItem(TOKEN_KEY, json.token);
            if (active) {
              setToken(json.token);
              setDb(json.data);
            }
          }
        }
      } catch {
        // ignore network hiccup
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, []);

  const toggleDarkMode = () => setDarkMode((p) => !p);

  const language: 'en' | 'hi' = db?.profile.language === 'hi' ? 'hi' : 'en';
  const toggleLanguage = async () => {
    if (!db) return;
    const nextLang: 'en' | 'hi' = language === 'en' ? 'hi' : 'en';
    await updateProfile({ ...db.profile, language: nextLang });
  };

  const login = async (identifier: string, password: string): Promise<boolean> => {
    setAuthError('');
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, email: identifier, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(json.error || 'Login failed');
        return false;
      }
      localStorage.removeItem('shobhit_logged_out');
      localStorage.setItem(TOKEN_KEY, json.token);
      setToken(json.token);
      setDb(json.data);
      return true;
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Login failed');
      return false;
    }
  };

  const register = async (payload: {
    name: string;
    phone?: string;
    email?: string;
    password: string;
    companyName?: string;
    gstin?: string;
    state?: string;
    withDemoData?: boolean;
  }): Promise<boolean> => {
    setAuthError('');
    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(json.error || 'Registration failed');
        return false;
      }
      localStorage.removeItem('shobhit_logged_out');
      localStorage.setItem(TOKEN_KEY, json.token);
      setToken(json.token);
      setDb(json.data);
      return true;
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Registration failed');
      return false;
    }
  };

  const requestAuthOtp = async (target: string, channel?: 'phone' | 'email') => {
    setAuthError('');
    const res = await fetch(apiUrl('/api/auth/otp/request'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, channel }),
    });
    const json = await res.json();
    if (!res.ok) {
      setAuthError(json.error || 'Unable to send OTP');
      throw new Error(json.error || 'Unable to send OTP');
    }
    return json;
  };

  const verifyAuthOtp = async (target: string, channel: 'phone' | 'email', code: string): Promise<boolean> => {
    setAuthError('');
    try {
      const res = await fetch(apiUrl('/api/auth/otp/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, channel, code }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(json.error || 'Invalid or expired OTP');
        return false;
      }
      localStorage.removeItem('shobhit_logged_out');
      localStorage.setItem(TOKEN_KEY, json.token);
      setToken(json.token);
      setDb(json.data);
      return true;
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'OTP verification failed');
      return false;
    }
  };

  const loginDemo = async (): Promise<boolean> => {
    setAuthError('');
    try {
      const res = await fetch(apiUrl('/api/auth/demo'), { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(json.error || 'Demo login failed');
        return false;
      }
      localStorage.removeItem('shobhit_logged_out');
      localStorage.setItem(TOKEN_KEY, json.token);
      setToken(json.token);
      setDb(json.data);
      return true;
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Demo login failed');
      return false;
    }
  };

  const logout = async () => {
    try {
      if (token) await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.setItem('shobhit_logged_out', '1');
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setDb(null);
  };

  const createCompany = async (payload: {
    companyName: string;
    gstin?: string;
    state?: string;
    financialYear?: string;
  }) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/companies', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const switchCompany = async (companyId: string) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/companies/switch', {
      method: 'POST',
      body: JSON.stringify({ companyId }),
    });
    setDb(res.data);
  };

  const createBranch = async (payload: { name: string; code: string; address?: string; manager?: string }) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/branches', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const getNextVoucherNo = (type: VoucherType): string => {
    if (!db) return 'VCH-001';
    const prefix = db.profile.prefixes[type] || 'VCH-';
    const existing = db.vouchers.filter((v) => v.type === type);
    let idx = existing.length + 1;
    while (existing.some((v) => v.voucherNo === `${prefix}${String(idx).padStart(3, '0')}`)) {
      idx++;
    }
    return `${prefix}${String(idx).padStart(3, '0')}`;
  };

  const getEffectivePaid = (v: Voucher): number => {
    if (!db || (v.type !== 'sale_invoice' && v.type !== 'purchase_bill')) {
      return v.paidAmount;
    }
    const targetPaymentType: VoucherType = v.type === 'sale_invoice' ? 'payment_in' : 'payment_out';
    const settledViaReceipts = db.vouchers
      .filter(
        (p) =>
          p.status !== 'cancelled' &&
          p.type === targetPaymentType &&
          p.settledInvoices?.some((s) => s.voucherId === v.id)
      )
      .reduce((sum, p) => {
        const hit = p.settledInvoices?.find((s) => s.voucherId === v.id);
        return sum + (hit ? hit.amount : 0);
      }, 0);
    return Number((v.paidAmount + settledViaReceipts).toFixed(2));
  };

  const getEffectiveStatus = (v: Voucher): VoucherStatus => {
    if (v.status === 'converted' || v.status === 'cancelled') return v.status;
    if (
      v.type === 'estimate' ||
      v.type === 'proforma' ||
      v.type === 'sale_order' ||
      v.type === 'delivery_challan' ||
      v.type === 'purchase_order'
    ) {
      return v.status || 'open';
    }
    if (v.type !== 'sale_invoice' && v.type !== 'purchase_bill') return v.status || 'paid';
    const paid = getEffectivePaid(v);
    if (paid >= v.grandTotal - 0.5) return 'paid';
    if (paid > 0) return 'partial';
    return 'unpaid';
  };

  const getPartyBalance = (partyId: string): number => {
    if (!db) return 0;
    const party = db.parties.find((p) => p.id === partyId);
    if (!party) return 0;
    let bal = party.openingBalance * (party.openingType === 'receivable' ? 1 : -1);
    for (const v of db.vouchers) {
      if (v.partyId !== partyId || v.status === 'cancelled') continue;
      if (v.type === 'sale_invoice') bal += v.grandTotal - v.paidAmount;
      else if (v.type === 'credit_note') bal -= v.grandTotal - v.paidAmount;
      else if (v.type === 'payment_in') bal -= v.grandTotal;
      else if (v.type === 'purchase_bill') bal -= v.grandTotal - v.paidAmount;
      else if (v.type === 'debit_note') bal += v.grandTotal - v.paidAmount;
      else if (v.type === 'payment_out') bal += v.grandTotal;
    }
    return Number(bal.toFixed(2));
  };

  const getBankBalance = (bankId: string): number => {
    if (!db) return 0;
    const acc = db.bankAccounts.find((b) => b.id === bankId);
    if (!acc) return 0;
    let bal = acc.openingBalance;
    for (const v of db.vouchers) {
      if (v.status === 'cancelled') continue;
      if (v.type === 'contra') {
        if (v.contraToId === bankId) bal += v.grandTotal;
        if (v.contraFromId === bankId) bal -= v.grandTotal;
        continue;
      }
      if (v.bankAccountId !== bankId) continue;
      if (v.type === 'sale_invoice') bal += v.paidAmount;
      else if (v.type === 'payment_in') bal += v.grandTotal;
      else if (v.type === 'debit_note') bal += v.paidAmount;
      else if (v.type === 'purchase_bill') bal -= v.paidAmount;
      else if (v.type === 'payment_out') bal -= v.grandTotal;
      else if (v.type === 'expense') bal -= v.grandTotal;
      else if (v.type === 'credit_note') bal -= v.paidAmount;
    }
    return Number(bal.toFixed(2));
  };

  const getTotalCashBalance = () =>
    db ? db.bankAccounts.filter((b) => b.type === 'cash').reduce((s, b) => s + getBankBalance(b.id), 0) : 0;

  const getTotalBankBalance = () =>
    db ? db.bankAccounts.filter((b) => b.type !== 'cash').reduce((s, b) => s + getBankBalance(b.id), 0) : 0;

  const getTotalStockValue = () =>
    db
      ? db.items.filter((i) => i.type === 'product').reduce((s, i) => s + Math.max(0, i.stockQty) * i.purchasePrice, 0)
      : 0;

  const getPendingInvoicesForParty = (partyId: string, kind: 'receivable' | 'payable') => {
    if (!db) return [];
    const targetType: VoucherType = kind === 'receivable' ? 'sale_invoice' : 'purchase_bill';
    return db.vouchers
      .filter((v) => v.type === targetType && v.partyId === partyId && v.status !== 'cancelled')
      .map((v) => {
        const effPaid = getEffectivePaid(v);
        return { ...v, balanceDue: Number(Math.max(0, v.grandTotal - effPaid).toFixed(2)) };
      })
      .filter((v) => v.balanceDue > 0.5);
  };

  const saveVoucher = async (voucher: Voucher, options?: { convertFromVoucherId?: string }) => {
    const res = await apiFetch<{ data: AppDatabase; savedVoucher: Voucher }>('/api/vouchers', {
      method: 'POST',
      body: JSON.stringify({ voucher, convertFromVoucherId: options?.convertFromVoucherId }),
    });
    setDb(res.data);
    return res.savedVoucher;
  };

  const cancelVoucher = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/vouchers/${id}/cancel`, { method: 'POST' });
    setDb(res.data);
  };

  const reconcileVoucher = async (id: string, reconciled: boolean) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/vouchers/${id}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ reconciled }),
    });
    setDb(res.data);
  };

  const deleteVoucher = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/vouchers/${id}`, { method: 'DELETE' });
    setDb(res.data);
  };

  const saveParty = async (party: Party): Promise<Party | undefined> => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/parties', {
      method: 'POST',
      body: JSON.stringify(party),
    });
    setDb(res.data);
    return (
      res.data.parties.find((p) => p.id === party.id) ||
      res.data.parties.find((p) => p.name.trim().toLowerCase() === party.name.trim().toLowerCase())
    );
  };

  const deleteParty = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/parties/${id}`, { method: 'DELETE' });
    setDb(res.data);
  };

  const saveItem = async (item: Item) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/items', {
      method: 'POST',
      body: JSON.stringify(item),
    });
    setDb(res.data);
  };

  const deleteItem = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/items/${id}`, { method: 'DELETE' });
    setDb(res.data);
  };

  const saveGodown = async (godown: Godown) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/godowns', {
      method: 'POST',
      body: JSON.stringify(godown),
    });
    setDb(res.data);
  };

  const saveStockAdjustment = async (adj: Omit<StockAdjustment, 'id'>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/stock-adjustments', {
      method: 'POST',
      body: JSON.stringify(adj),
    });
    setDb(res.data);
  };

  const saveStockTransfer = async (trf: Omit<StockTransfer, 'id' | 'transferNo'>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/stock-transfers', {
      method: 'POST',
      body: JSON.stringify(trf),
    });
    setDb(res.data);
  };

  const saveBankAccount = async (acc: BankAccount) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/bank-accounts', {
      method: 'POST',
      body: JSON.stringify(acc),
    });
    setDb(res.data);
  };

  const deleteBankAccount = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/bank-accounts/${id}`, { method: 'DELETE' });
    setDb(res.data);
  };

  const restoreFromRecycleBin = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/recycle-bin/${id}/restore`, { method: 'POST' });
    setDb(res.data);
  };

  const deleteRecycleBinItem = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/recycle-bin/${id}`, { method: 'DELETE' });
    setDb(res.data);
  };

  const emptyRecycleBin = async () => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/recycle-bin', { method: 'DELETE' });
    setDb(res.data);
  };

  const lockApp = () => {
    localStorage.setItem('shobhit_app_locked', 'true');
    setIsLocked(true);
  };

  const unlockApp = (pin: string) => {
    const savedPin = db?.profile.appSettings?.general.passcode || '';
    if (!savedPin || pin === savedPin) {
      localStorage.removeItem('shobhit_app_locked');
      setIsLocked(false);
      return true;
    }
    return false;
  };

  const saveCheque = async (cheque: ChequeEntry) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/cheques', {
      method: 'POST',
      body: JSON.stringify(cheque),
    });
    setDb(res.data);
  };

  const updateChequeStatus = async (id: string, status: 'pending' | 'cleared' | 'bounced') => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/cheques/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setDb(res.data);
  };

  const saveLoan = async (loan: LoanAccount) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/loans', {
      method: 'POST',
      body: JSON.stringify(loan),
    });
    setDb(res.data);
  };

  const payLoanEmi = async (loanId: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/loans/${loanId}/pay-emi`, { method: 'POST' });
    setDb(res.data);
  };

  const saveLedgerAccount = async (payload: Omit<LedgerAccount, 'id' | 'isSystem'>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/ledgers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const saveStaff = async (member: StaffMember) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/staff', {
      method: 'POST',
      body: JSON.stringify(member),
    });
    setDb(res.data);
  };

  const deleteStaff = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/staff/${id}`, { method: 'DELETE' });
    setDb(res.data);
  };

  const payStaffSalary = async (
    staffId: string,
    month: string,
    bankAccountId: string,
    overrides?: {
      attendanceDays?: number;
      overtimeHours?: number;
      bonusAmt?: number;
      arrearsAmt?: number;
      otherDeductions?: number;
      commissionAmt?: number;
      notes?: string;
    }
  ) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/staff/${staffId}/pay-salary`, {
      method: 'POST',
      body: JSON.stringify({ month, bankAccountId, ...(overrides || {}) }),
    });
    setDb(res.data);
  };

  const runBulkPayroll = async (month: string, bankAccountId: string) => {
    const res = await apiFetch<{ data: AppDatabase; processedCount: number }>('/api/payroll/run-bulk', {
      method: 'POST',
      body: JSON.stringify({ month, bankAccountId }),
    });
    setDb(res.data);
    return res.processedCount;
  };

  const saveEmployeeAdvance = async (payload: {
    staffId: string;
    staffName: string;
    date: string;
    type: 'Salary Advance' | 'Staff Loan';
    amount: number;
    monthlyEmi: number;
    reason: string;
  }) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/payroll/advances', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const saveLeaveRequest = async (payload: {
    staffId: string;
    staffName: string;
    leaveType: 'CL' | 'SL' | 'EL' | 'LOP';
    fromDate: string;
    toDate: string;
    days: number;
    reason: string;
  }) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/payroll/leaves', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const decideLeaveRequest = async (id: string, status: 'Approved' | 'Rejected') => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/payroll/leaves/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setDb(res.data);
  };

  const saveReimbursement = async (payload: {
    staffId: string;
    staffName: string;
    date: string;
    category: 'Travel' | 'Food' | 'Fuel' | 'Mobile/Internet' | 'Medical' | 'Other';
    amount: number;
    description: string;
  }) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/payroll/reimbursements', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const decideReimbursement = async (id: string, status: 'Approved' | 'Paid') => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/payroll/reimbursements/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setDb(res.data);
  };

  const updateProfile = async (profile: BusinessProfile) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/companies/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    });
    setDb(res.data);
  };

  const clearDemoData = async () => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/data/clear-demo', { method: 'POST' });
    setDb(res.data);
  };

  const resetToDemo = async () => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/data/reset-demo', { method: 'POST' });
    setDb(res.data);
  };

  const importDatabase = async (data: AppDatabase) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/data/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setDb(res.data);
  };

  const updateShipmentStatus = async (voucherId: string, shipmentStatus: string, trackingNo?: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/vouchers/${voucherId}/shipment`, {
      method: 'POST',
      body: JSON.stringify({ shipmentStatus, trackingNo }),
    });
    setDb(res.data);
  };

  const saveCostCentre = async (cc: Partial<CostCentre>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/cost-centres', { method: 'POST', body: JSON.stringify(cc) });
    setDb(res.data);
  };

  const saveBudget = async (budget: Partial<BudgetRecord>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/budgets', { method: 'POST', body: JSON.stringify(budget) });
    setDb(res.data);
  };

  const saveFixedAsset = async (asset: Partial<FixedAsset>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/fixed-assets', { method: 'POST', body: JSON.stringify(asset) });
    setDb(res.data);
  };

  const runDepreciation = async (assetId: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/erp/fixed-assets/${assetId}/depreciate`, { method: 'POST' });
    setDb(res.data);
  };

  const saveBom = async (bom: Partial<BomRecipe>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/boms', { method: 'POST', body: JSON.stringify(bom) });
    setDb(res.data);
  };

  const saveProductionOrder = async (ord: Partial<ProductionOrder>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/production-orders', { method: 'POST', body: JSON.stringify(ord) });
    setDb(res.data);
  };

  const completeProductionOrder = async (orderId: string, payload?: { actualMaterialCost?: number; actualLabourOverhead?: number; wastagePct?: number }) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/erp/production-orders/${orderId}/complete`, { method: 'POST', body: JSON.stringify(payload || {}) });
    setDb(res.data);
  };

  const saveJobWork = async (jw: Partial<JobWorkOrder>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/job-works', { method: 'POST', body: JSON.stringify(jw) });
    setDb(res.data);
  };

  const updateJobWork = async (id: string, payload: { qtyReceivedBack: number; wastageQty: number; status: string }) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/erp/job-works/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    setDb(res.data);
  };

  const saveProject = async (prj: Partial<ProjectJob>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/projects', { method: 'POST', body: JSON.stringify(prj) });
    setDb(res.data);
  };

  const saveWorkflowRule = async (wf: Partial<WorkflowRule>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/workflows', { method: 'POST', body: JSON.stringify(wf) });
    setDb(res.data);
  };

  const saveApprovalRule = async (rule: Partial<ApprovalRule>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/approval-rules', { method: 'POST', body: JSON.stringify(rule) });
    setDb(res.data);
  };

  const decideApproval = async (voucherId: string, decision: 'approved' | 'rejected') => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/erp/approvals/${voucherId}`, { method: 'POST', body: JSON.stringify({ decision }) });
    setDb(res.data);
  };

  const saveCurrencyRate = async (cur: CurrencyRate) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/currencies', { method: 'POST', body: JSON.stringify(cur) });
    setDb(res.data);
  };

  const saveCommissionRule = async (rule: Partial<CommissionRule>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/commissions', { method: 'POST', body: JSON.stringify(rule) });
    setDb(res.data);
  };

  const savePricingRule = async (rule: Partial<PricingRule>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/pricing-rules', { method: 'POST', body: JSON.stringify(rule) });
    setDb(res.data);
  };

  const saveSubscription = async (sub: Partial<SubscriptionPlan>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/subscriptions', { method: 'POST', body: JSON.stringify(sub) });
    setDb(res.data);
  };

  const runSubscriptions = async (subId?: string) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/subscriptions/run', { method: 'POST', body: JSON.stringify({ subId }) });
    setDb(res.data);
  };

  const runRecurringVoucher = async (voucherId: string) => {
    const res = await apiFetch<{ data: AppDatabase; createdNo: string }>('/api/erp/recurring/run', { method: 'POST', body: JSON.stringify({ voucherId }) });
    setDb(res.data);
    return res.createdNo;
  };

  const saveComplianceItem = async (item: Partial<ComplianceItem>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/compliance', { method: 'POST', body: JSON.stringify(item) });
    setDb(res.data);
  };

  const updateComplianceStatus = async (id: string, status: string, referenceNo?: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/erp/compliance/${id}`, { method: 'PATCH', body: JSON.stringify({ status, referenceNo }) });
    setDb(res.data);
  };

  const saveDocument = async (doc: Partial<DocumentRecord>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/documents', { method: 'POST', body: JSON.stringify(doc) });
    setDb(res.data);
  };

  const createApiKey = async (label: string, scopes?: string[]) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/api-keys', { method: 'POST', body: JSON.stringify({ label, scopes }) });
    setDb(res.data);
  };

  const createWebhook = async (event: string, targetUrl: string) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/webhooks', { method: 'POST', body: JSON.stringify({ event, targetUrl }) });
    setDb(res.data);
  };

  const testWebhook = async (id: string) => {
    const res = await apiFetch<{ data: AppDatabase }>(`/api/erp/webhooks/${id}/test`, { method: 'POST' });
    setDb(res.data);
  };

  const saveCustomReport = async (report: Partial<CustomReportTemplate>) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/custom-reports', { method: 'POST', body: JSON.stringify(report) });
    setDb(res.data);
  };

  const saveSecuritySettings = async (sec: SecuritySettings) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/erp/security', { method: 'POST', body: JSON.stringify(sec) });
    setDb(res.data);
  };

  const runMarketplaceSync = async (channel: string) => {
    const res = await apiFetch<{ data: AppDatabase; importedNos: string[] }>('/api/erp/marketplace-sync', { method: 'POST', body: JSON.stringify({ channel }) });
    setDb(res.data);
    return res.importedNos;
  };

  const checkPortalsHealth = async () => {
    return apiFetch<{ portals: PortalHealthResult[]; checkedAt: string }>('/api/portals/health');
  };

  const logPortalAction = async (payload: {
    portalId: string;
    portalName: string;
    url?: string;
    action?: 'MANUAL_PORTAL_OPEN' | 'RETURN_JSON_PREPARED' | 'GSTIN_CHECKSUM_CHECK' | 'IRN_LOCAL_CHECK';
    statusNote?: string;
  }) => {
    const res = await apiFetch<{ data: AppDatabase }>('/api/portals/audit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const getGstApiStatus = async () => {
    return apiFetch<GstApiReadiness>('/api/portals/api-status');
  };

  const saveGstApiConfig = async (config: Partial<GstApiIntegrationConfig>) => {
    const res = await apiFetch<{ ok: boolean; config: GstApiIntegrationConfig; data: AppDatabase }>('/api/portals/api-config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    setDb(res.data);
    return res.config;
  };

  const testGstApiConnection = async (service: 'gstn' | 'irp' | 'ewb') => {
    const res = await apiFetch<{ success: boolean; status: 'success' | 'failed'; message: string; data: AppDatabase }>(
      '/api/portals/test-api',
      { method: 'POST', body: JSON.stringify({ service }) }
    );
    setDb(res.data);
    return { success: res.success, status: res.status, message: res.message };
  };

  const getAiStatus = async () => {
    return apiFetch<{ configured: boolean; model: string }>('/api/ai/status');
  };

  const scanInvoiceOcr = async (payload: { base64Data?: string; mimeType?: string; rawText?: string }) => {
    const res = await apiFetch<{ scanned: ScannedInvoiceResult }>('/api/ai/scan-invoice', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.scanned;
  };

  const bulkImportItems = async (items: Partial<Item>[]) => {
    const res = await apiFetch<{ importedCount: number; updatedCount: number; data: AppDatabase }>('/api/items/bulk', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    setDb(res.data);
    return { importedCount: res.importedCount, updatedCount: res.updatedCount };
  };

  const bulkImportParties = async (parties: Partial<Party>[]) => {
    const res = await apiFetch<{ importedCount: number; updatedCount: number; data: AppDatabase }>('/api/parties/bulk', {
      method: 'POST',
      body: JSON.stringify({ parties }),
    });
    setDb(res.data);
    return { importedCount: res.importedCount, updatedCount: res.updatedCount };
  };

  const hasFeature = (feature: SubscriptionFeatureKey): boolean => {
    if (!db?.subscription) return true;
    if (!db.subscription.canTransact) return false;
    return Boolean(db.subscription.unlockedFeatures?.[feature]);
  };

  const purchaseSubscription = async (payload: {
    tier: PlanTier;
    deviceScope: DeviceScope;
    duration: PlanDuration;
    customerName: string;
    phone: string;
    gstin?: string;
    paymentMode?: PaymentMode;
    paymentRef?: string;
  }): Promise<LicenseRecord> => {
    const res = await apiFetch<{ license: LicenseRecord; data: AppDatabase }>('/api/subscription/purchase', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
    return res.license;
  };

  const requestSubscriptionOtp = async (phone: string) => {
    return apiFetch<{ ok: boolean; phone: string; otpCode: string; licenseCount: number }>(
      '/api/subscription/otp/request',
      { method: 'POST', body: JSON.stringify({ phone }) }
    );
  };

  const verifySubscriptionOtp = async (phone: string, otp: string) => {
    const res = await apiFetch<{ ok: boolean; phone: string; licenses: LicenseRecord[] }>(
      '/api/subscription/otp/verify',
      { method: 'POST', body: JSON.stringify({ phone, otp }) }
    );
    return res.licenses;
  };

  const attachLicense = async (payload: { licenseId?: string; licenseCode?: string }) => {
    const res = await apiFetch<{ ok: boolean; data: AppDatabase }>('/api/subscription/attach', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const detachLicense = async (passcode: string) => {
    const res = await apiFetch<{ ok: boolean; data: AppDatabase }>('/api/subscription/detach', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
    setDb(res.data);
  };

  const opsAuth = async (password: string) => {
    return apiFetch<OpsOverviewPayload & { ok: boolean }>('/api/ops/auth', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  };

  const opsVerifyLicense = async (
    opsPassword: string,
    licenseId: string,
    payload: { transactionId?: string; screenshotDataUrl?: string }
  ) => {
    const res = await apiFetch<OpsOverviewPayload & { ok: boolean; license: LicenseRecord; data: AppDatabase }>(
      `/api/ops/licenses/${licenseId}/verify`,
      {
        method: 'POST',
        headers: { 'x-ops-password': opsPassword },
        body: JSON.stringify(payload),
      }
    );
    if (res.data) setDb(res.data);
    return res;
  };

  const opsUpdateLicense = async (
    opsPassword: string,
    licenseId: string,
    payload: { status?: 'active' | 'deactivated'; extendDays?: number; expiresAt?: string }
  ) => {
    const res = await apiFetch<OpsOverviewPayload & { ok: boolean; data: AppDatabase }>(
      `/api/ops/licenses/${licenseId}`,
      {
        method: 'PATCH',
        headers: { 'x-ops-password': opsPassword },
        body: JSON.stringify(payload),
      }
    );
    if (res.data) setDb(res.data);
    return res;
  };

  const opsUpdatePlan = async (
    opsPassword: string,
    tier: PlanTier,
    payload: Partial<SubscriptionPlanConfig>
  ) => {
    const res = await apiFetch<OpsOverviewPayload & { ok: boolean; data: AppDatabase }>(
      `/api/ops/plans/${tier}`,
      {
        method: 'PUT',
        headers: { 'x-ops-password': opsPassword },
        body: JSON.stringify(payload),
      }
    );
    if (res.data) setDb(res.data);
    return res;
  };

  const opsUpdatePasscodes = async (
    opsPassword: string,
    payload: { detachPasscode?: string; newOpsPassword?: string }
  ) => {
    return apiFetch<OpsOverviewPayload & { ok: boolean }>('/api/ops/passcodes', {
      method: 'PUT',
      headers: { 'x-ops-password': opsPassword },
      body: JSON.stringify(payload),
    });
  };

  const opsFetchTelemetry = async (opsPassword: string) => {
    return apiFetch<{ ok: boolean; telemetry: import('../utils/googleWorkspaceSync').OpsTelemetryData }>(
      '/api/ops/sheet-telemetry',
      {
        headers: { 'x-ops-password': opsPassword },
      }
    );
  };

  const opsSaveSheetLink = async (
    opsPassword: string,
    payload: {
      linkedSheetId: string;
      linkedSheetTitle: string;
      linkedSheetUrl: string;
      lastSheetSyncAt?: string;
      lastSheetSyncBy?: string;
    }
  ) => {
    return apiFetch<
      OpsOverviewPayload & { ok: boolean; telemetry: import('../utils/googleWorkspaceSync').OpsTelemetryData }
    >('/api/ops/sheet-link', {
      method: 'PUT',
      headers: { 'x-ops-password': opsPassword },
      body: JSON.stringify(payload),
    });
  };

  const saveWorkspaceMember = async (payload: {
    id?: string;
    name: string;
    phone: string;
    email?: string;
    role: WorkspaceRole;
    permissions?: string[];
    active?: boolean;
  }) => {
    const res = await apiFetch<{ ok: boolean; data: AppDatabase }>('/api/user-access', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDb(res.data);
  };

  const deleteWorkspaceMember = async (id: string) => {
    const res = await apiFetch<{ ok: boolean; data: AppDatabase }>(`/api/user-access/${id}`, {
      method: 'DELETE',
    });
    setDb(res.data);
  };

  const getOtpIntegrations = async () => {
    const res = await apiFetch<{ config: OtpIntegrationConfig }>('/api/otp-integrations');
    return res.config;
  };

  const saveOtpIntegrations = async (payload: Partial<OtpIntegrationConfig>) => {
    const res = await apiFetch<{ ok: boolean; config: OtpIntegrationConfig }>('/api/otp-integrations', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.config;
  };

  const testOtpIntegration = async (target: string, channel?: 'phone' | 'email') => {
    const res = await apiFetch<{
      ok: boolean;
      result: {
        target: string;
        channel: 'phone' | 'email';
        deliveredVia: string[];
        externalSent: boolean;
        otpPreview?: string;
        warnings?: string[];
      };
    }>('/api/otp-integrations/test', {
      method: 'POST',
      body: JSON.stringify({ target, channel }),
    });
    return res.result;
  };

  const getWhatsAppStatus = async () => {
    return apiFetch<WhatsAppStatusInfo>('/api/whatsapp/status');
  };

  const connectWhatsApp = async () => {
    return apiFetch<WhatsAppStatusInfo>('/api/whatsapp/connect', { method: 'POST' });
  };

  const disconnectWhatsApp = async () => {
    return apiFetch<WhatsAppStatusInfo>('/api/whatsapp/disconnect', { method: 'POST' });
  };

  const sendTransactionWhatsApp = async (payload: {
    phone: string;
    text: string;
    pdfBase64?: string;
    pdfFileName?: string;
    imageBase64?: string;
    copyToSelf?: boolean;
  }) => {
    return apiFetch<{ ok: boolean; sentCount: number; message: string }>('/api/whatsapp/send-transaction', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  };

  const dispatchAutoTransactionMessage = async (
    voucher: Voucher,
    partyOverride?: Party
  ): Promise<{ sent: boolean; message?: string }> => {
    if (!db) return { sent: false };
    const msgSet = mergeAppSettings(db.profile.appSettings).message;
    if (!msgSet.enabled || !msgSet.sendToParty) return { sent: false };

    const party =
      partyOverride ||
      db.parties.find((p) => p.id === voucher.partyId) ||
      db.parties.find((p) => voucher.partyName && p.name.toLowerCase() === voucher.partyName.toLowerCase());
    const recipientPhone = party?.phone || '';
    if (!recipientPhone || recipientPhone.replace(/\D/g, '').length < 10) {
      return { sent: false, message: 'No party phone number for WhatsApp message.' };
    }

    try {
      const waStatus = await getWhatsAppStatus();
      if (waStatus.status !== 'connected') {
        return { sent: false, message: 'WhatsApp not linked' };
      }

      const bank =
        db.bankAccounts.find((b) => b.id === voucher.bankAccountId) ||
        db.bankAccounts.find((b) => b.type === 'bank') ||
        db.bankAccounts[0];
      const effPaid = getEffectivePaid(voucher);
      const due = Math.max(0, voucher.grandTotal - effPaid);

      const header = msgSet.headerText ? `${msgSet.headerText}\n\n` : '';
      const footer = msgSet.footerText ? `\n\n${msgSet.footerText}` : '';
      const text =
        `${header}*${db.profile.companyName}*\n` +
        `Invoice/Voucher: *${voucher.voucherNo}* (${voucher.date})\n` +
        `Party: ${voucher.partyName || party?.name || 'Customer'}\n` +
        `Total Amount: ₹${voucher.grandTotal.toFixed(2)}\n` +
        `Paid: ₹${effPaid.toFixed(2)} | Balance Due: ₹${due.toFixed(2)}` +
        footer;

      let pdfBase64: string | undefined;
      let pdfFileName: string | undefined;
      let imageBase64: string | undefined;

      if (msgSet.format === 'pdf' || msgSet.format === 'both') {
        const pdfRes = getInvoicePdfBase64(voucher, db.profile, party, bank, effPaid);
        pdfBase64 = pdfRes.base64;
        pdfFileName = pdfRes.fileName;
      }
      if (msgSet.format === 'image' || msgSet.format === 'both') {
        imageBase64 = generateInvoicePngBase64(voucher, db.profile, party, bank, effPaid);
      }

      const res = await sendTransactionWhatsApp({
        phone: recipientPhone,
        text,
        pdfBase64,
        pdfFileName,
        imageBase64,
        copyToSelf: msgSet.sendCopyToSelf,
      });
      return { sent: true, message: res.message };
    } catch (err) {
      return { sent: false, message: err instanceof Error ? err.message : 'Auto-send failed' };
    }
  };

  const value = useMemo<StoreContextValue>(
    () => ({
      db,
      loading,
      authError,
      darkMode,
      toggleDarkMode,
      language,
      toggleLanguage,
      login,
      register,
      requestAuthOtp,
      verifyAuthOtp,
      loginDemo,
      logout,
      createCompany,
      switchCompany,
      createBranch,
      getNextVoucherNo,
      getEffectivePaid,
      getEffectiveStatus,
      getPartyBalance,
      getBankBalance,
      getTotalCashBalance,
      getTotalBankBalance,
      getTotalStockValue,
      getPendingInvoicesForParty,
      saveVoucher,
      cancelVoucher,
      reconcileVoucher,
      deleteVoucher,
      saveParty,
      deleteParty,
      saveItem,
      deleteItem,
      saveGodown,
      saveStockAdjustment,
      saveStockTransfer,
      saveBankAccount,
      deleteBankAccount,
      restoreFromRecycleBin,
      deleteRecycleBinItem,
      emptyRecycleBin,
      isLocked,
      lockApp,
      unlockApp,
      saveCheque,
      updateChequeStatus,
      saveLoan,
      payLoanEmi,
      saveLedgerAccount,
      saveStaff,
      deleteStaff,
      payStaffSalary,
      runBulkPayroll,
      saveEmployeeAdvance,
      saveLeaveRequest,
      decideLeaveRequest,
      saveReimbursement,
      decideReimbursement,
      updateProfile,
      clearDemoData,
      resetToDemo,
      importDatabase,
      updateShipmentStatus,
      saveCostCentre,
      saveBudget,
      saveFixedAsset,
      runDepreciation,
      saveBom,
      saveProductionOrder,
      completeProductionOrder,
      saveJobWork,
      updateJobWork,
      saveProject,
      saveWorkflowRule,
      saveApprovalRule,
      decideApproval,
      saveCurrencyRate,
      saveCommissionRule,
      savePricingRule,
      saveSubscription,
      runSubscriptions,
      runRecurringVoucher,
      saveComplianceItem,
      updateComplianceStatus,
      saveDocument,
      createApiKey,
      createWebhook,
      testWebhook,
      saveCustomReport,
      saveSecuritySettings,
      runMarketplaceSync,
      checkPortalsHealth,
      logPortalAction,
      getGstApiStatus,
      saveGstApiConfig,
      testGstApiConnection,
      getAiStatus,
      scanInvoiceOcr,
      bulkImportItems,
      bulkImportParties,
      hasFeature,
      purchaseSubscription,
      requestSubscriptionOtp,
      verifySubscriptionOtp,
      attachLicense,
      detachLicense,
      opsAuth,
      opsVerifyLicense,
      opsUpdateLicense,
      opsUpdatePlan,
      opsUpdatePasscodes,
      opsFetchTelemetry,
      opsSaveSheetLink,
      saveWorkspaceMember,
      deleteWorkspaceMember,
      getOtpIntegrations,
      saveOtpIntegrations,
      testOtpIntegration,
      getWhatsAppStatus,
      connectWhatsApp,
      disconnectWhatsApp,
      sendTransactionWhatsApp,
      dispatchAutoTransactionMessage,
    }),
    [db, loading, authError, darkMode, token, isLocked]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
