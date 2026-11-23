import React, { useMemo, useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  FileCheck2,
  Truck,
  RotateCcw,
  ArrowDownLeft,
  ShoppingBag,
  ClipboardList,
  ArrowUpRight,
  Receipt,
  Users,
  Package,
  Landmark,
  BookOpen,
  BarChart3,
  Settings,
  Palette,
  Plus,
  Search,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  Building2,
  BadgeIndianRupee,
  Factory,
  Languages,
  Lock,
  Globe,
  Wrench,
  ChevronDown,
  ChevronRight,
  Printer,
  ScanLine,
  Crown,
  ShieldCheck,
  Maximize2,
} from 'lucide-react';
import { StoreProvider, useStore } from './context/StoreContext';
import { SubscriptionFeatureKey, Voucher, VoucherType } from './types/accounting';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { VoucherListView } from './components/VoucherListView';
import { POSView } from './components/POSView';
import { PartiesView } from './components/PartiesView';
import { InventoryView } from './components/InventoryView';
import { BankingView } from './components/BankingView';
import { AccountingView } from './components/AccountingView';
import { ReportsGSTView } from './components/ReportsGSTView';
import { GstPortalsView } from './components/GstPortalsView';
import { PayrollView } from './components/PayrollView';
import { OperationsERPView } from './components/OperationsERPView';
import { InvoiceDesignGallery } from './components/InvoiceDesignGallery';
import { OcrBulkToolsView } from './components/OcrBulkToolsView';
import { SubscriptionView } from './components/SubscriptionView';
import { UserAccessView } from './components/UserAccessView';
import { SettingsToolsView } from './components/SettingsToolsView';
import { VoucherEditorModal } from './components/VoucherEditorModal';
import { InvoicePrintModal } from './components/InvoicePrintModal';
import { BulkPrintModal } from './components/BulkPrintModal';
import { PasscodeLockOverlay } from './components/PasscodeLockOverlay';
import { formatINR, VOUCHER_LABELS } from './utils/formatters';
import { tr } from './utils/i18n';

type NavKey =
  | 'dashboard'
  | 'pos'
  | 'sales_invoices'
  | 'quotes_proforma'
  | 'orders_challans'
  | 'credit_notes'
  | 'payment_in'
  | 'purchase_bills'
  | 'purchase_orders'
  | 'debit_notes'
  | 'payment_out'
  | 'expenses'
  | 'parties'
  | 'inventory'
  | 'banking'
  | 'accounting'
  | 'reports_gst'
  | 'utilities'
  | 'ocr_bulk_tools'
  | 'gst_portals'
  | 'operations_erp'
  | 'payroll'
  | 'invoice_designs'
  | 'user_access'
  | 'subscription'
  | 'settings';

type NavItemDef = {
  id: NavKey;
  icon: React.ComponentType<{ className?: string }>;
  children?: { id: NavKey; icon: React.ComponentType<{ className?: string }> }[];
};

const NAV_TO_FEATURE: Partial<Record<NavKey, SubscriptionFeatureKey>> = {
  payroll: 'payroll',
  operations_erp: 'operations_erp',
  ocr_bulk_tools: 'ocr_bulk_tools',
  gst_portals: 'gst_portals',
  invoice_designs: 'invoice_designs',
  pos: 'core_billing',
  sales_invoices: 'core_billing',
  quotes_proforma: 'core_billing',
  orders_challans: 'core_billing',
  credit_notes: 'core_billing',
  payment_in: 'core_billing',
  purchase_bills: 'core_billing',
  purchase_orders: 'core_billing',
  debit_notes: 'core_billing',
  payment_out: 'core_billing',
  expenses: 'core_billing',
  parties: 'core_billing',
  inventory: 'core_billing',
  banking: 'core_billing',
  accounting: 'core_billing',
  reports_gst: 'core_billing',
};

const NAV_GROUPS: {
  headingKey: string;
  items: NavItemDef[];
}[] = [
  {
    headingKey: 'overview_group',
    items: [
      { id: 'dashboard', icon: LayoutDashboard },
      { id: 'pos', icon: ShoppingCart },
    ],
  },
  {
    headingKey: 'sales_group',
    items: [
      { id: 'sales_invoices', icon: FileText },
      { id: 'quotes_proforma', icon: FileCheck2 },
      { id: 'orders_challans', icon: Truck },
      { id: 'credit_notes', icon: RotateCcw },
      { id: 'payment_in', icon: ArrowDownLeft },
    ],
  },
  {
    headingKey: 'purchase_group',
    items: [
      { id: 'purchase_bills', icon: ShoppingBag },
      { id: 'purchase_orders', icon: ClipboardList },
      { id: 'debit_notes', icon: RotateCcw },
      { id: 'payment_out', icon: ArrowUpRight },
      { id: 'expenses', icon: Receipt },
    ],
  },
  {
    headingKey: 'masters_group',
    items: [
      { id: 'parties', icon: Users },
      { id: 'inventory', icon: Package },
      { id: 'banking', icon: Landmark },
    ],
  },
  {
    headingKey: 'erp_group',
    items: [
      { id: 'payroll', icon: BadgeIndianRupee },
      { id: 'accounting', icon: BookOpen },
      { id: 'reports_gst', icon: BarChart3 },
      {
        id: 'utilities',
        icon: Wrench,
        children: [
          { id: 'user_access', icon: ShieldCheck },
          { id: 'subscription', icon: Crown },
          { id: 'ocr_bulk_tools', icon: ScanLine },
          { id: 'gst_portals', icon: Globe },
          { id: 'operations_erp', icon: Factory },
          { id: 'invoice_designs', icon: Palette },
        ],
      },
      { id: 'settings', icon: Settings },
    ],
  },
];

const WorkspaceShell: React.FC = () => {
  const { db, loading, darkMode, toggleDarkMode, language, toggleLanguage, switchCompany, logout, isLocked, lockApp, hasFeature } = useStore();
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const [showBulkPrint, setShowBulkPrint] = useState(false);
  const [minimizedEditor, setMinimizedEditor] = useState(false);

  const [editorState, setEditorState] = useState<{
    open: boolean;
    type: VoucherType;
    editing?: Voucher | null;
    convertFrom?: Voucher | null;
  }>({ open: false, type: 'sale_invoice' });

  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null);

  const vouchers = db?.vouchers || [];
  const parties = db?.parties || [];
  const items = db?.items || [];

  const globalHits = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (q.length < 2) return null;
    return {
      vouchers: vouchers
        .filter(
          (v) =>
            v.voucherNo.toLowerCase().includes(q) ||
            (v.partyName || '').toLowerCase().includes(q)
        )
        .slice(0, 4),
      parties: parties
        .filter((p) => p.name.toLowerCase().includes(q) || p.phone.includes(q))
        .slice(0, 3),
      items: items
        .filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
        .slice(0, 3),
    };
  }, [globalQuery, vouchers, parties, items]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F3F5F7] dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-[#116B68] text-white font-bold flex items-center justify-center mx-auto">
            SI
          </div>
          <div className="text-sm font-semibold text-[#243746] dark:text-white">
            Loading Shobhit Invoice Pro...
          </div>
          <div className="text-xs text-[#84909D]">Connecting to SQLite Accounting Engine</div>
        </div>
      </div>
    );
  }

  if (!db) {
    return <AuthScreen />;
  }

  const isAdminUser = db.user.role === 'Admin';
  const hasPermission = (navId: NavKey): boolean => {
    if (isAdminUser) return true;
    const perms = db.user.permissions;
    if (!perms || perms.includes('*')) return true;
    if (navId === 'user_access' || navId === 'settings') return false;
    if (navId === 'utilities') {
      return ['subscription', 'ocr_bulk_tools', 'gst_portals', 'operations_erp', 'invoice_designs'].some((c) =>
        perms.includes(c)
      );
    }
    return perms.includes(navId);
  };

  const sub = db.subscription;
  const canTransact = sub ? sub.canTransact : true;

  const openNewVoucher = (type: VoucherType) => {
    if (!canTransact) {
      setUtilitiesOpen(true);
      setActiveNav('subscription');
      return;
    }
    setMinimizedEditor(false);
    setEditorState({ open: true, type, editing: null, convertFrom: null });
  };

  const openEditVoucher = (v: Voucher) => {
    if (!canTransact) {
      setUtilitiesOpen(true);
      setActiveNav('subscription');
      return;
    }
    setMinimizedEditor(false);
    setEditorState({ open: true, type: v.type, editing: v, convertFrom: null });
  };

  const openConvertVoucher = (source: Voucher, targetType: VoucherType) => {
    if (!canTransact) {
      setUtilitiesOpen(true);
      setActiveNav('subscription');
      return;
    }
    setMinimizedEditor(false);
    setEditorState({ open: true, type: targetType, editing: null, convertFrom: source });
  };

  const renderLockedGate = (featureLabel: string) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 max-w-xl mx-auto my-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center mx-auto">
        <Lock className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
        {sub?.isTrialExpired
          ? '7-Day Free Trial Expired — License Required'
          : `${featureLabel} is Locked in Your ${sub?.activeTier?.toUpperCase() || ''} Plan`}
      </h2>
      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        {sub?.isTrialExpired
          ? 'Your 7-day free trial has ended. Purchase a Silver, Gold, or Platinum subscription or log in with your Registered Mobile + OTP to attach your License ID.'
          : `Your current plan does not include ${featureLabel}. Upgrade to Gold or Platinum (or verify/attach a higher tier license) in Subscription & License.`}
      </p>
      <button
        type="button"
        onClick={() => {
          setUtilitiesOpen(true);
          setActiveNav('subscription');
        }}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white text-xs font-bold"
      >
        <Crown className="w-4 h-4" />
        Open Subscription &amp; License
      </button>
    </div>
  );

  const renderContent = () => {
    if (!hasPermission(activeNav)) {
      return (
        <DashboardView
          onNewVoucher={openNewVoucher}
          onOpenPOS={() => setActiveNav('pos')}
          onPrintVoucher={setPrintVoucher}
          onNavigate={(tab) => setActiveNav(tab as NavKey)}
        />
      );
    }
    const reqFeature = NAV_TO_FEATURE[activeNav];
    if (reqFeature && !hasFeature(reqFeature)) {
      return renderLockedGate(tr(language, activeNav));
    }
    switch (activeNav) {
      case 'dashboard':
        return (
          <DashboardView
            onNewVoucher={openNewVoucher}
            onOpenPOS={() => setActiveNav('pos')}
            onPrintVoucher={setPrintVoucher}
            onNavigate={(tab) => setActiveNav(tab as NavKey)}
          />
        );
      case 'pos':
        return <POSView onPrintVoucher={setPrintVoucher} />;
      case 'sales_invoices':
        return (
          <VoucherListView
            title="Sales Invoices (GST Tax Invoices)"
            subtitle="Create GST invoices, generate E-Way/IRN, track partial payments, and print any of 24 designs"
            voucherTypes={['sale_invoice']}
            defaultNewType="sale_invoice"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'quotes_proforma':
        return (
          <VoucherListView
            title="Estimates, Quotations & Proforma Invoices"
            subtitle="Send customer quotes and convert them to GST Sale Invoices in one click"
            voucherTypes={['estimate', 'proforma']}
            defaultNewType="estimate"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'orders_challans':
        return (
          <VoucherListView
            title="Sale Orders & Delivery Challans"
            subtitle="Manage customer orders, dispatch challans with vehicle details, and convert to Tax Invoices"
            voucherTypes={['sale_order', 'delivery_challan']}
            defaultNewType="sale_order"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'credit_notes':
        return (
          <VoucherListView
            title="Credit Notes (Sale Returns)"
            subtitle="Record customer goods returns — auto-restores stock inventory and reduces GST liability"
            voucherTypes={['credit_note']}
            defaultNewType="credit_note"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'payment_in':
        return (
          <VoucherListView
            title="Payment In (Customer Receipts)"
            subtitle="Record customer collections with bill-by-bill invoice settlement"
            voucherTypes={['payment_in']}
            defaultNewType="payment_in"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'purchase_bills':
        return (
          <VoucherListView
            title="Purchase Bills & Input Tax Credit"
            subtitle="Record supplier bills — auto-increases item stock and updates GSTR-2B ITC"
            voucherTypes={['purchase_bill']}
            defaultNewType="purchase_bill"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'purchase_orders':
        return (
          <VoucherListView
            title="Purchase Orders (PO)"
            subtitle="Issue POs to suppliers and convert received orders directly into Purchase Bills"
            voucherTypes={['purchase_order']}
            defaultNewType="purchase_order"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'debit_notes':
        return (
          <VoucherListView
            title="Debit Notes (Purchase Returns)"
            subtitle="Return goods to suppliers — auto-deducts stock and adjusts supplier payable"
            voucherTypes={['debit_note']}
            defaultNewType="debit_note"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'payment_out':
        return (
          <VoucherListView
            title="Payment Out (Supplier Payments)"
            subtitle="Settle vendor bills and record outgoing bank/cash disbursements"
            voucherTypes={['payment_out']}
            defaultNewType="payment_out"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'expenses':
        return (
          <VoucherListView
            title="Business Expenses & Overheads"
            subtitle="Track Rent, Electricity, Salaries, Freight, and Misc costs directly in Profit & Loss"
            voucherTypes={['expense']}
            defaultNewType="expense"
            onCreateNew={openNewVoucher}
            onEdit={openEditVoucher}
            onConvert={openConvertVoucher}
            onPrint={setPrintVoucher}
          />
        );
      case 'parties':
        return <PartiesView />;
      case 'inventory':
        return <InventoryView />;
      case 'banking':
        return <BankingView onNewContra={() => openNewVoucher('contra')} />;
      case 'accounting':
        return (
          <AccountingView
            onNewVoucher={openNewVoucher}
            onPrintVoucher={setPrintVoucher}
          />
        );
      case 'reports_gst':
        return <ReportsGSTView />;
      case 'utilities':
        return (
          <div className="space-y-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="text-xs font-medium text-indigo-700 dark:text-indigo-400">
                Shobhit Invoice Pro
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                {tr(language, 'utilities')}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Access Invoice OCR Scanner, Bulk Excel Import/Export (Items &amp; Parties), Government GST Portals, Manufacturing &amp; Invoice Designs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  setUtilitiesOpen(true);
                  setActiveNav('ocr_bulk_tools');
                }}
                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 rounded-xl p-5 space-y-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <ScanLine className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">OCR &amp; Bulk Excel (Items &amp; Parties)</div>
                      <div className="text-[11px] text-slate-500">Full Invoice OCR Scanner · Excel Bulk Import &amp; Export</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Extract complete invoice details with OCR into Bills &amp; Inventory, and bulk import or export Items &amp; Parties in Excel (.xlsx).
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUtilitiesOpen(true);
                  setActiveNav('gst_portals');
                }}
                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 rounded-xl p-5 space-y-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <Globe className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">GST Portal</div>
                      <div className="text-[11px] text-slate-500">GST Login · GSTR-1 · GSTR-3B · E-Way · IRP 1–6 · GSTIN &amp; IRN</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Open official GST Government Portals directly with real-time Server Online / Server Down status checks and filing audit logs.
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUtilitiesOpen(true);
                  setActiveNav('operations_erp');
                }}
                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 rounded-xl p-5 space-y-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                      <Factory className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">Manufacturing &amp; Commerce</div>
                      <div className="text-[11px] text-slate-500">BOM · Production · Job Work · Projects · Dispatch</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Manage manufacturing BOMs, production orders, job work challans, and warehouse dispatch logs.
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUtilitiesOpen(true);
                  setActiveNav('invoice_designs');
                }}
                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 rounded-xl p-5 space-y-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                      <Palette className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">Invoice Designs (24)</div>
                      <div className="text-[11px] text-slate-500">Tax Invoice Templates · Stamp &amp; Digital Signature</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Browse and customize all 24 invoice formats, colors, paper sizes, and round seals.
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUtilitiesOpen(true);
                  setActiveNav('subscription');
                }}
                className="text-left bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900 hover:border-indigo-500 rounded-xl p-5 space-y-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <Crown className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">Subscription &amp; License</div>
                      <div className="text-[11px] text-slate-500">Silver · Gold · Platinum · Phone + OTP License Attach</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  View live plan status, days remaining, purchase plans, download License Tax Invoice PDF, or attach/detach your License ID.
                </p>
              </button>

              {isAdminUser && (
                <button
                  type="button"
                  onClick={() => {
                    setUtilitiesOpen(true);
                    setActiveNav('user_access');
                  }}
                  className="text-left bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-900 hover:border-[#168C88] rounded-xl p-5 space-y-2 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-[#E5EFF3] dark:bg-slate-800 text-[#116B68] dark:text-teal-300 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[#243746] dark:text-white">User Access &amp; OTP Integrations</div>
                        <div className="text-[11px] text-[#84909D]">Stock Keeper · Biller · Salesman · Accountant · OTP Gateways</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#84909D]" />
                  </div>
                  <p className="text-xs text-[#84909D] dark:text-slate-300">
                    Add staff roles with mobile OTP login and configure Linked WhatsApp QR, SMTP Email, and SMS OTP providers.
                  </p>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (!hasFeature('bulk_print')) {
                    setUtilitiesOpen(true);
                    setActiveNav('subscription');
                    return;
                  }
                  setShowBulkPrint(true);
                }}
                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] rounded-xl p-5 space-y-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-[#243746] dark:text-slate-300 flex items-center justify-center">
                      <Printer className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[#243746] dark:text-white">Bulk Print &amp; Date-Filtered Export</div>
                      <div className="text-[11px] text-[#84909D]">Multi-Invoice PDF · Filtered GST &amp; Accounting Reports</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#84909D]" />
                </div>
                <p className="text-xs text-[#84909D] dark:text-slate-300">
                  Batch print invoices and download date-range filtered reports in one PDF file.
                </p>
              </button>
            </div>
          </div>
        );
      case 'user_access':
        return <UserAccessView />;
      case 'subscription':
        return <SubscriptionView />;
      case 'ocr_bulk_tools':
        return <OcrBulkToolsView />;
      case 'gst_portals':
        return <GstPortalsView />;
      case 'operations_erp':
        return <OperationsERPView />;
      case 'payroll':
        return <PayrollView />;
      case 'invoice_designs':
        return <InvoiceDesignGallery />;
      case 'settings':
        return <SettingsToolsView />;
      default:
        return null;
    }
  };

  const zoomPct = db.profile.appSettings?.general.zoomPct ?? 100;

  return (
    <div
      className="min-h-screen bg-[#F3F5F7] dark:bg-slate-950 text-[#243746] dark:text-slate-100 flex"
      style={zoomPct !== 100 ? { zoom: zoomPct / 100 } : undefined}
    >
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
        />
      )}

      {/* Workspace Sidebar (256px) - Dark Teal #116B68 */}
      <aside
        className={`no-print fixed lg:sticky top-0 left-0 z-40 h-screen w-64 shrink-0 bg-[#116B68] dark:bg-slate-900 dark:border-r dark:border-slate-800 text-white flex flex-col transition-transform duration-200 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-white/15 dark:border-slate-800 shrink-0">
          <button
            onClick={() => setActiveNav('dashboard')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0"
          >
            <div className="w-7 h-7 rounded-lg bg-[#168C88] border border-white/25 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
              SI
            </div>
            <span className="text-sm font-extrabold tracking-tight text-white">
              {tr(language, 'brand')}
            </span>
          </button>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-white/80 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((item) => hasPermission(item.id));
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.headingKey} className="space-y-1">
                <div className="px-3 text-[11px] font-semibold text-teal-200/80 dark:text-slate-500">
                  {tr(language, group.headingKey)}
                </div>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const permittedChildren = (item.children || []).filter((c) => hasPermission(c.id));
                  const hasChildren = permittedChildren.length > 0;
                  const childActive = permittedChildren.some((c) => c.id === activeNav);
                  const active = activeNav === item.id || (!utilitiesOpen && childActive);
                  const expanded = utilitiesOpen || childActive;

                  if (hasChildren) {
                    return (
                      <div key={item.id} className="space-y-1">
                        <button
                          onClick={() => {
                            setUtilitiesOpen((prev) => !prev);
                            setActiveNav(item.id);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-[#168C88] text-white font-semibold shadow-xs'
                              : 'text-teal-50/90 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="truncate">{tr(language, item.id)}</span>
                          </span>
                          {expanded ? (
                            <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-80" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-80" />
                          )}
                        </button>

                        {expanded && (
                          <div className="pl-4 ml-3 border-l border-white/20 space-y-1">
                            {permittedChildren.map((subNav) => {
                              const SubIcon = subNav.icon;
                              const subActive = activeNav === subNav.id;
                              const feat = NAV_TO_FEATURE[subNav.id];
                              const subLocked = Boolean(feat && !hasFeature(feat));
                              return (
                                <button
                                  key={subNav.id}
                                  onClick={() => {
                                    setActiveNav(subNav.id);
                                    setMobileMenuOpen(false);
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                                    subActive
                                      ? 'bg-[#168C88] text-white font-semibold shadow-xs'
                                      : 'text-teal-50/85 hover:text-white hover:bg-white/10'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 truncate">
                                    <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{tr(language, subNav.id)}</span>
                                  </span>
                                  {subLocked && <Lock className="w-3 h-3 text-teal-200/70 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const navFeat = NAV_TO_FEATURE[item.id];
                  const navLocked = Boolean(navFeat && !hasFeature(navFeat));
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveNav(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#168C88] text-white font-semibold shadow-xs'
                          : 'text-teal-50/90 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{tr(language, item.id)}</span>
                      </span>
                      {navLocked && <Lock className="w-3 h-3 text-teal-200/70 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Company Switcher + User Footer */}
        <div className="p-3 border-t border-white/15 dark:border-slate-800 space-y-2 text-[11px] bg-[#0E5B58] dark:bg-slate-900">
          <div className="flex items-center gap-1.5 text-teal-100">
            <Building2 className="w-3.5 h-3.5 text-white shrink-0" />
            <select
              value={db.profile.id}
              onChange={(e) => switchCompany(e.target.value)}
              disabled={!isAdminUser && db.companies.length <= 1}
              className="w-full bg-transparent font-semibold text-white focus:outline-none truncate"
            >
              {db.companies.map((c) => (
                <option key={c.id} value={c.id} className="bg-white text-[#243746]">
                  {c.companyName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between text-teal-100/80">
            <span className="font-mono truncate">
              {db.profile.gstin || 'No GSTIN'} · FY {db.profile.financialYear}
            </span>
          </div>
          <div className="pt-1.5 border-t border-white/15 flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-semibold text-white truncate">
                {db.user.name}
              </div>
              <div className="text-[10px] text-teal-200 truncate">
                {db.user.role}{db.user.phone ? ` · ${db.user.phone}` : ''}
              </div>
            </div>
            <button
              onClick={logout}
              title="Sign Out"
              className="p-1.5 rounded-lg text-teal-100 hover:text-white hover:bg-white/15"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="no-print sticky top-0 z-20 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 rounded-lg text-[#243746] dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs font-medium text-[#84909D] dark:text-slate-400 truncate whitespace-nowrap">
              {tr(language, 'brand')} <span className="mx-1.5">/</span>{' '}
              <span className="text-[#243746] dark:text-white font-semibold">
                {tr(language, activeNav)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="relative hidden md:block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search invoice, party, item..."
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white w-56"
              />
              {globalHits && (
                <div className="absolute right-0 mt-1.5 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-2 space-y-2 z-50 text-xs">
                  {globalHits.vouchers.length === 0 &&
                  globalHits.parties.length === 0 &&
                  globalHits.items.length === 0 ? (
                    <div className="p-3 text-center text-slate-500">No matches found</div>
                  ) : (
                    <>
                      {globalHits.vouchers.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setPrintVoucher(v);
                            setGlobalQuery('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between"
                        >
                          <span className="font-mono font-semibold">{v.voucherNo}</span>
                          <span className="text-slate-500 truncate ml-2">
                            {v.partyName || formatINR(v.grandTotal)}
                          </span>
                        </button>
                      ))}
                      {globalHits.parties.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setActiveNav('parties');
                            setGlobalQuery('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between"
                        >
                          <span className="font-medium">{p.name}</span>
                          <span className="text-slate-500">Party</span>
                        </button>
                      ))}
                      {globalHits.items.map((i) => (
                        <button
                          key={i.id}
                          onClick={() => {
                            setActiveNav('inventory');
                            setGlobalQuery('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between"
                        >
                          <span className="truncate">{i.name}</span>
                          <span className="font-mono text-slate-500 ml-2">{i.stockQty}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => void toggleLanguage()}
              aria-label="Toggle language"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#116B68] dark:text-teal-300 hover:bg-[#E5EFF3] dark:hover:bg-slate-800 shrink-0"
            >
              <Languages className="w-3.5 h-3.5" />
              {language === 'en' ? 'EN / हिंदी' : 'हिंदी / EN'}
            </button>

            <button
              onClick={toggleDarkMode}
              aria-label="Toggle theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[#243746] dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Live Subscription / Trial Indicator */}
            {sub && (
              <button
                type="button"
                onClick={() => {
                  setUtilitiesOpen(true);
                  setActiveNav('subscription');
                }}
                title="View Subscription & License Status"
                className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-colors shrink-0 ${
                  sub.isTrialExpired
                    ? 'border-red-300 bg-red-50 text-[#EF4444] dark:bg-red-950/50 dark:border-red-900 dark:text-red-300'
                    : sub.isLicensed
                    ? 'border-emerald-300 bg-emerald-50 text-[#16A34A] dark:bg-emerald-950/50 dark:border-emerald-900 dark:text-emerald-300'
                    : 'border-amber-300 bg-amber-50 text-[#F59E0B] dark:bg-amber-950/50 dark:border-amber-900 dark:text-amber-300'
                }`}
              >
                <Crown className="w-3.5 h-3.5" />
                {sub.isLicensed
                  ? `${sub.activeTier.toUpperCase()}`
                  : sub.isTrialExpired
                  ? 'Trial Expired'
                  : `Trial · ${sub.trialDaysLeft}d left`}
              </button>
            )}

            {/* Minimized Draft Restore Pill in Header */}
            {editorState.open && minimizedEditor && (
              <div className="inline-flex items-center rounded-lg bg-[#E5EFF3] border border-[#168C88] text-[#116B68] text-xs font-bold overflow-hidden shrink-0">
                <button
                  type="button"
                  onClick={() => setMinimizedEditor(false)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-teal-100"
                  title="Resume minimized voucher draft"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Resume {VOUCHER_LABELS[editorState.type]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMinimizedEditor(false);
                    setEditorState((prev) => ({ ...prev, open: false }));
                  }}
                  title="Discard minimized draft"
                  className="px-1.5 py-1.5 text-[#EF4444] hover:bg-red-50 border-l border-[#168C88]/30"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Small red IP logo next to Lock for Bulk Print & Date-Filtered Reports */}
            <button
              onClick={() => {
                if (!hasFeature('bulk_print')) {
                  setUtilitiesOpen(true);
                  setActiveNav('subscription');
                  return;
                }
                setShowBulkPrint(true);
              }}
              title="Bulk Print & Date-Filtered Reports / Invoices"
              aria-label="Bulk Print Center"
              className="px-2 py-1.5 rounded-lg bg-[#EF4444] hover:bg-red-700 text-white text-[11px] font-black tracking-wider shadow-xs transition-colors shrink-0"
            >
              IP
            </button>

            <button
              onClick={lockApp}
              title="Lock Shobhit Invoice Pro"
              aria-label="Lock Application"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#243746] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              <Lock className="w-3.5 h-3.5 text-[#168C88]" />
              <span className="hidden sm:inline">Lock</span>
            </button>

            <button
              onClick={() => openNewVoucher('sale_invoice')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {tr(language, 'new_invoice')}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {renderContent()}
        </main>
      </div>

      {editorState.open && (
        <div className={minimizedEditor ? 'hidden' : 'contents'}>
          <VoucherEditorModal
            initialType={editorState.type}
            editingVoucher={editorState.editing}
            convertSourceVoucher={editorState.convertFrom}
            onMinimize={() => setMinimizedEditor(true)}
            onClose={() => {
              setMinimizedEditor(false);
              setEditorState((prev) => ({ ...prev, open: false }));
            }}
            onSaved={(saved) => {
              if (saved.type === 'sale_invoice') {
                setPrintVoucher(saved);
              }
            }}
          />
        </div>
      )}

      {editorState.open && minimizedEditor && (
        <div className="no-print fixed bottom-5 right-5 z-40 flex items-center rounded-xl bg-[#116B68] text-white shadow-lg border border-white/20 overflow-hidden">
          <button
            type="button"
            onClick={() => setMinimizedEditor(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold hover:bg-[#168C88] transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
            <span>Minimized Draft: {VOUCHER_LABELS[editorState.type]} · Restore</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMinimizedEditor(false);
              setEditorState((prev) => ({ ...prev, open: false }));
            }}
            title="Discard Draft"
            className="px-3 py-2.5 text-white/80 hover:text-white hover:bg-red-600/80 border-l border-white/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {printVoucher && (
        <InvoicePrintModal
          voucher={printVoucher}
          onClose={() => setPrintVoucher(null)}
        />
      )}

      <BulkPrintModal isOpen={showBulkPrint} onClose={() => setShowBulkPrint(false)} />

      {isLocked && <PasscodeLockOverlay />}
    </div>
  );
};

export default function App() {
  return (
    <StoreProvider>
      <WorkspaceShell />
    </StoreProvider>
  );
}
