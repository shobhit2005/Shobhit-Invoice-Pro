import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Mail,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Edit3,
  AlertTriangle,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { OtpIntegrationConfig, WorkspaceMember, WorkspaceRole } from '../types/accounting';

const ROLE_OPTIONS: WorkspaceRole[] = ['Stock Keeper', 'Biller', 'Salesman', 'Accountant'];

const ALL_MODULES: { id: string; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'POS Billing Counter' },
  { id: 'sales_invoices', label: 'Sales Invoices' },
  { id: 'quotes_proforma', label: 'Estimates & Proforma' },
  { id: 'orders_challans', label: 'Orders & Challans' },
  { id: 'credit_notes', label: 'Credit Notes' },
  { id: 'payment_in', label: 'Payment In' },
  { id: 'purchase_bills', label: 'Purchase Bills' },
  { id: 'purchase_orders', label: 'Purchase Orders' },
  { id: 'debit_notes', label: 'Debit Notes' },
  { id: 'payment_out', label: 'Payment Out' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'parties', label: 'Parties & Ledgers' },
  { id: 'inventory', label: 'Inventory & Stock' },
  { id: 'banking', label: 'Cash & Bank' },
  { id: 'payroll', label: 'Payroll & Staff' },
  { id: 'accounting', label: 'Accounting & Journals' },
  { id: 'reports_gst', label: 'Reports & GST' },
  { id: 'ocr_bulk_tools', label: 'OCR & Bulk Excel' },
  { id: 'gst_portals', label: 'GST Portals' },
  { id: 'operations_erp', label: 'Manufacturing & ERP' },
  { id: 'invoice_designs', label: 'Invoice Designs' },
];

const ROLE_DEFAULT_PERMS: Record<WorkspaceRole, string[]> = {
  'Stock Keeper': [
    'dashboard',
    'inventory',
    'purchase_bills',
    'purchase_orders',
    'debit_notes',
    'orders_challans',
    'ocr_bulk_tools',
    'operations_erp',
  ],
  Biller: [
    'dashboard',
    'pos',
    'sales_invoices',
    'quotes_proforma',
    'orders_challans',
    'credit_notes',
    'payment_in',
    'parties',
    'inventory',
    'invoice_designs',
  ],
  Salesman: [
    'dashboard',
    'pos',
    'sales_invoices',
    'quotes_proforma',
    'orders_challans',
    'payment_in',
    'parties',
    'inventory',
  ],
  Accountant: [
    'dashboard',
    'sales_invoices',
    'purchase_bills',
    'expenses',
    'payment_in',
    'payment_out',
    'parties',
    'banking',
    'accounting',
    'reports_gst',
    'gst_portals',
    'payroll',
    'ocr_bulk_tools',
  ],
};

export const UserAccessView: React.FC = () => {
  const {
    db,
    saveWorkspaceMember,
    deleteWorkspaceMember,
    getOtpIntegrations,
    saveOtpIntegrations,
    testOtpIntegration,
  } = useStore();

  const [tab, setTab] = useState<'members' | 'otp'>('members');
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Staff Form State
  const [editingId, setEditingId] = useState<string>('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('Biller');
  const [permissions, setPermissions] = useState<string[]>(ROLE_DEFAULT_PERMS.Biller);
  const [active, setActive] = useState(true);
  const [savingMember, setSavingMember] = useState(false);

  // OTP Integration State
  const [otpConfig, setOtpConfig] = useState<OtpIntegrationConfig | null>(null);
  const [loadingOtp, setLoadingOtp] = useState(false);
  const [savingOtp, setSavingOtp] = useState(false);

  // Test OTP State
  const [testTarget, setTestTarget] = useState('');
  const [testChannel, setTestChannel] = useState<'phone' | 'email'>('phone');
  const [testingOtp, setTestingOtp] = useState(false);
  const [testResult, setTestResult] = useState<{
    deliveredVia: string[];
    externalSent: boolean;
    otpPreview?: string;
    warnings?: string[];
  } | null>(null);

  useEffect(() => {
    if (tab === 'otp' && !otpConfig) {
      setLoadingOtp(true);
      getOtpIntegrations()
        .then((cfg) => setOtpConfig(cfg))
        .catch((err) => setNotice({ type: 'err', text: (err as Error).message }))
        .finally(() => setLoadingOtp(false));
    }
  }, [tab, otpConfig, getOtpIntegrations]);

  if (!db) return null;

  const isAdmin = db.user.role === 'Admin';
  const members = db.workspaceMembers || [];

  const resetForm = (nextRole: WorkspaceRole = 'Biller') => {
    setEditingId('');
    setName('');
    setPhone('');
    setEmail('');
    setRole(nextRole);
    setPermissions(ROLE_DEFAULT_PERMS[nextRole]);
    setActive(true);
  };

  const handleRoleSelect = (nextRole: WorkspaceRole) => {
    setRole(nextRole);
    if (!editingId) {
      setPermissions(ROLE_DEFAULT_PERMS[nextRole]);
    }
  };

  const togglePermission = (modId: string) => {
    setPermissions((prev) =>
      prev.includes(modId) ? prev.filter((x) => x !== modId) : [...prev, modId]
    );
  };

  const startEdit = (m: WorkspaceMember) => {
    setEditingId(m.id);
    setName(m.name);
    setPhone(m.phone);
    setEmail(m.email || '');
    setRole(m.role);
    setPermissions(m.permissions.length > 0 ? m.permissions : ROLE_DEFAULT_PERMS[m.role]);
    setActive(m.active);
    setNotice(null);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!name.trim() || phone.replace(/\D/g, '').length < 10) {
      setNotice({ type: 'err', text: 'Enter full name and a valid 10-digit phone number.' });
      return;
    }
    setSavingMember(true);
    try {
      await saveWorkspaceMember({
        id: editingId || undefined,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        role,
        permissions,
        active,
      });
      setNotice({
        type: 'ok',
        text: editingId
          ? `${name} (${role}) access updated.`
          : `${name} (${role}) added. Staff can now login using Phone/Email + OTP.`,
      });
      resetForm(role);
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setSavingMember(false);
    }
  };

  const handleDeleteMember = async (m: WorkspaceMember) => {
    setNotice(null);
    try {
      await deleteWorkspaceMember(m.id);
      if (editingId === m.id) resetForm();
      setNotice({ type: 'ok', text: `Removed access for ${m.name}.` });
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    }
  };

  const handleSaveOtpConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpConfig) return;
    setSavingOtp(true);
    setNotice(null);
    try {
      const updated = await saveOtpIntegrations(otpConfig);
      setOtpConfig(updated);
      setNotice({ type: 'ok', text: 'OTP delivery & gateway integrations saved.' });
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setSavingOtp(false);
    }
  };

  const handleRunTestOtp = async () => {
    if (!testTarget.trim()) {
      setNotice({ type: 'err', text: 'Enter a test phone number or email address.' });
      return;
    }
    setTestingOtp(true);
    setNotice(null);
    setTestResult(null);
    try {
      const res = await testOtpIntegration(testTarget.trim(), testChannel);
      setTestResult(res);
      setNotice({ type: 'ok', text: `Test OTP dispatched to ${res.target}.` });
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setTestingOtp(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 max-w-lg mx-auto text-center space-y-3">
        <ShieldCheck className="w-8 h-8 text-[#168C88] mx-auto" />
        <h2 className="text-base font-bold text-[#243746] dark:text-white">
          Admin Access Required
        </h2>
        <p className="text-xs text-[#84909D]">
          Only the business Admin can add or manage Stock Keeper, Biller, Salesman, and Accountant accounts or OTP integrations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-[#168C88]">Utilities · Role-Based Access &amp; OTP</div>
          <h1 className="text-xl font-bold text-[#243746] dark:text-white mt-0.5">
            User Access Control &amp; OTP Integrations
          </h1>
          <p className="text-xs text-[#84909D] mt-0.5">
            Assign Stock Keeper, Biller, Salesman, and Accountant logins with Phone Number + OTP (Email optional) and configure SMS, WhatsApp QR, &amp; SMTP OTP gateways.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setTab('members')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md font-semibold transition-colors ${
              tab === 'members'
                ? 'bg-[#168C88] text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Staff Access ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('otp')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md font-semibold transition-colors ${
              tab === 'otp'
                ? 'bg-[#168C88] text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            OTP Integrations
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-medium ${
            notice.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300'
          }`}
        >
          {notice.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#16A34A]" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#EF4444]" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {tab === 'members' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Left: Add / Edit Staff Form */}
          <form
            onSubmit={handleSaveMember}
            className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 h-fit"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#168C88]" />
                <h2 className="text-sm font-bold text-[#243746] dark:text-white">
                  {editingId ? 'Edit Staff Member' : 'Add Staff User'}
                </h2>
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={() => resetForm()}
                  className="text-xs text-[#2676A8] hover:underline font-medium"
                >
                  + New User
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#243746] dark:text-slate-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rajesh Sharma"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#243746] dark:text-slate-300 mb-1">
                  Mobile Number (OTP Login) *
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9876543210"
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#243746] dark:text-slate-300 mb-1">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="staff@company.in"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#243746] dark:text-slate-300 mb-1.5">
                  Staff Role *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ROLE_OPTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleRoleSelect(r)}
                      className={`py-2 px-2 rounded-lg border text-[11px] font-bold transition-colors ${
                        role === r
                          ? 'bg-[#168C88] border-[#168C88] text-white'
                          : 'border-slate-200 dark:border-slate-700 text-[#243746] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#243746] dark:text-slate-300">
                  Allowed Modules ({permissions.length})
                </span>
                <button
                  type="button"
                  onClick={() => setPermissions(ROLE_DEFAULT_PERMS[role])}
                  className="text-[11px] text-[#2676A8] hover:underline font-medium"
                >
                  Reset {role} Defaults
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto p-2 rounded-lg bg-[#F3F5F7] dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                {ALL_MODULES.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 text-[11px] text-[#243746] dark:text-slate-300 cursor-pointer py-1 px-1.5 rounded hover:bg-white dark:hover:bg-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={permissions.includes(m.id)}
                      onChange={() => togglePermission(m.id)}
                      className="rounded border-slate-300 accent-[#168C88]"
                    />
                    <span className="truncate">{m.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#243746] dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-slate-300 accent-[#168C88]"
              />
              Active login access enabled
            </label>

            <button
              type="submit"
              disabled={savingMember}
              className="w-full py-2.5 px-4 rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {savingMember ? 'Saving...' : editingId ? 'Update User Access' : 'Grant Access & Enable OTP Login'}
            </button>
          </form>

          {/* Right: Existing Staff Access List */}
          <div className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#243746] dark:text-white">
                  Authorized Staff Users ({members.length})
                </h2>
                <p className="text-[11px] text-[#84909D]">
                  Staff members sign in from the Login screen with their Mobile Number (or Email) + 6-digit OTP.
                </p>
              </div>
            </div>

            {members.length === 0 ? (
              <div className="py-16 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                <UserCheck className="w-8 h-8 text-[#84909D] mx-auto" />
                <div className="text-xs font-semibold text-[#243746] dark:text-white">
                  No staff roles configured yet
                </div>
                <p className="text-[11px] text-[#84909D] max-w-sm mx-auto">
                  Add a Stock Keeper, Biller, Salesman, or Accountant on the left so they can log in securely with OTP.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#E5EFF3] dark:bg-slate-800 text-[#243746] dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2.5 px-3 text-left font-bold">Staff Member</th>
                      <th className="py-2.5 px-3 text-left font-bold">Phone / Email</th>
                      <th className="py-2.5 px-3 text-left font-bold">Role</th>
                      <th className="py-2.5 px-3 text-left font-bold">Modules</th>
                      <th className="py-2.5 px-3 text-left font-bold">Status</th>
                      <th className="py-2.5 px-3 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2.5 px-3 font-semibold text-[#243746] dark:text-white">
                          {m.name}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-mono text-[#243746] dark:text-slate-200">{m.phone}</div>
                          {m.email && <div className="text-[10px] text-[#84909D]">{m.email}</div>}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-[#E5EFF3] text-[#116B68] font-bold text-[11px]">
                            {m.role}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#84909D]">{m.permissions.length} tabs</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.active
                                ? 'bg-emerald-50 text-[#16A34A]'
                                : 'bg-red-50 text-[#EF4444]'
                            }`}
                          >
                            {m.active ? 'Active' : 'Suspended'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(m)}
                              title="Edit Access"
                              className="p-1.5 rounded-lg text-[#2676A8] hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteMember(m)}
                              title="Remove Access"
                              className="p-1.5 rounded-lg text-[#EF4444] hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'otp' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <form
            onSubmit={handleSaveOtpConfig}
            className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5"
          >
            {loadingOtp || !otpConfig ? (
              <div className="py-12 text-center text-xs text-[#84909D]">
                Loading OTP integration settings...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-[#168C88]">
                    <input
                      type="checkbox"
                      checked={otpConfig.whatsappOtpEnabled}
                      onChange={(e) =>
                        setOtpConfig({ ...otpConfig, whatsappOtpEnabled: e.target.checked })
                      }
                      className="mt-0.5 rounded border-slate-300 accent-[#168C88]"
                    />
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#243746] dark:text-white">
                        <MessageSquare className="w-3.5 h-3.5 text-[#16A34A]" />
                        Linked WhatsApp QR Auto-OTP
                      </div>
                      <p className="text-[11px] text-[#84909D] mt-0.5">
                        Automatically send 6-digit login OTPs via your linked WhatsApp number from Settings → Transaction Message.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-[#168C88]">
                    <input
                      type="checkbox"
                      checked={otpConfig.firebasePhoneEnabled}
                      onChange={(e) =>
                        setOtpConfig({ ...otpConfig, firebasePhoneEnabled: e.target.checked })
                      }
                      className="mt-0.5 rounded border-slate-300 accent-[#168C88]"
                    />
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#243746] dark:text-white">
                        <Smartphone className="w-3.5 h-3.5 text-[#F59E0B]" />
                        Firebase Phone Auth Mode
                      </div>
                      <p className="text-[11px] text-[#84909D] mt-0.5">
                        Enable Firebase SMS OTP bridge alongside server SMS &amp; WhatsApp fallback.
                      </p>
                    </div>
                  </label>
                </div>

                {/* SMS Gateway Provider */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
                  <div className="font-bold text-[#243746] dark:text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-[#168C88]" />
                    SMS Gateway Provider
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {(
                      [
                        { id: 'builtin', label: 'Built-in Instant' },
                        { id: 'fast2sms', label: 'Fast2SMS' },
                        { id: 'msg91', label: 'MSG91' },
                        { id: 'twilio', label: 'Twilio' },
                        { id: 'custom_webhook', label: 'Webhook' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setOtpConfig({ ...otpConfig, smsProvider: p.id })}
                        className={`py-2 px-2.5 rounded-lg border font-semibold ${
                          otpConfig.smsProvider === p.id
                            ? 'bg-[#168C88] border-[#168C88] text-white'
                            : 'border-slate-200 dark:border-slate-700 text-[#243746] dark:text-slate-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {(otpConfig.smsProvider === 'fast2sms' || otpConfig.smsProvider === 'msg91') && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          API Key {otpConfig.hasSmsApiKey ? '(Saved)' : ''}
                        </label>
                        <input
                          type="password"
                          value={otpConfig.smsApiKey || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smsApiKey: e.target.value })}
                          placeholder={otpConfig.hasSmsApiKey ? '••••••••••••' : 'Paste gateway API key'}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">Sender ID</label>
                        <input
                          type="text"
                          value={otpConfig.smsSenderId || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smsSenderId: e.target.value })}
                          placeholder="SHOBHT"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">DLT Template ID</label>
                        <input
                          type="text"
                          value={otpConfig.smsTemplateId || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smsTemplateId: e.target.value })}
                          placeholder="Optional"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                    </div>
                  )}

                  {otpConfig.smsProvider === 'twilio' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">Account SID</label>
                        <input
                          type="text"
                          value={otpConfig.twilioAccountSid || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, twilioAccountSid: e.target.value })}
                          placeholder="ACxxxxxxxx..."
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Auth Token {otpConfig.hasTwilioAuthToken ? '(Saved)' : ''}
                        </label>
                        <input
                          type="password"
                          value={otpConfig.twilioAuthToken || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, twilioAuthToken: e.target.value })}
                          placeholder={otpConfig.hasTwilioAuthToken ? '••••••••••••' : 'Auth Token'}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">From Number</label>
                        <input
                          type="text"
                          value={otpConfig.twilioFromNumber || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, twilioFromNumber: e.target.value })}
                          placeholder="+1234567890"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                    </div>
                  )}

                  {otpConfig.smsProvider === 'custom_webhook' && (
                    <div className="pt-2">
                      <label className="block text-[11px] font-semibold mb-1">
                        POST Webhook URL (receives {'{ target, channel, code, message }'})
                      </label>
                      <input
                        type="url"
                        value={otpConfig.customWebhookUrl || ''}
                        onChange={(e) => setOtpConfig({ ...otpConfig, customWebhookUrl: e.target.value })}
                        placeholder="https://your-gateway.example/send-otp"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>
                  )}
                </div>

                {/* SMTP Email OTP */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-[#243746] dark:text-white flex items-center gap-2">
                      <Mail className="w-4 h-4 text-[#2676A8]" />
                      SMTP Email OTP Delivery
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer font-semibold">
                      <input
                        type="checkbox"
                        checked={otpConfig.emailEnabled}
                        onChange={(e) => setOtpConfig({ ...otpConfig, emailEnabled: e.target.checked })}
                        className="rounded border-slate-300 accent-[#168C88]"
                      />
                      Enable Email OTP
                    </label>
                  </div>

                  {otpConfig.emailEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">SMTP Host</label>
                        <input
                          type="text"
                          value={otpConfig.smtpHost || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smtpHost: e.target.value })}
                          placeholder="smtp.gmail.com"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">Port</label>
                        <input
                          type="number"
                          value={otpConfig.smtpPort || 587}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smtpPort: Number(e.target.value) })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">From Address</label>
                        <input
                          type="email"
                          value={otpConfig.smtpFrom || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smtpFrom: e.target.value })}
                          placeholder="no-reply@yourcompany.in"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">SMTP Username</label>
                        <input
                          type="text"
                          value={otpConfig.smtpUser || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smtpUser: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          SMTP Password {otpConfig.hasSmtpPass ? '(Saved)' : ''}
                        </label>
                        <input
                          type="password"
                          value={otpConfig.smtpPass || ''}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smtpPass: e.target.value })}
                          placeholder={otpConfig.hasSmtpPass ? '••••••••••••' : 'App password'}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <label className="flex items-center gap-2 pt-5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(otpConfig.smtpSecure)}
                          onChange={(e) => setOtpConfig({ ...otpConfig, smtpSecure: e.target.checked })}
                          className="rounded border-slate-300 accent-[#168C88]"
                        />
                        SSL / TLS (Port 465)
                      </label>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingOtp}
                    className="px-5 py-2.5 rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white text-xs font-bold"
                  >
                    {savingOtp ? 'Saving Integrations...' : 'Save OTP Integrations'}
                  </button>
                </div>
              </>
            )}
          </form>

          {/* Right: Live Test OTP Dispatcher */}
          <div className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 h-fit">
            <h3 className="text-sm font-bold text-[#243746] dark:text-white">
              Live Test OTP Dispatcher
            </h3>
            <p className="text-xs text-[#84909D]">
              Verify WhatsApp QR, SMS Gateway, or SMTP Email delivery before staff members sign in.
            </p>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setTestChannel('phone')}
                className={`flex-1 py-1.5 rounded-md font-semibold ${
                  testChannel === 'phone' ? 'bg-[#168C88] text-white' : 'text-slate-600'
                }`}
              >
                Phone OTP
              </button>
              <button
                type="button"
                onClick={() => setTestChannel('email')}
                className={`flex-1 py-1.5 rounded-md font-semibold ${
                  testChannel === 'email' ? 'bg-[#168C88] text-white' : 'text-slate-600'
                }`}
              >
                Email OTP
              </button>
            </div>

            <input
              type={testChannel === 'email' ? 'email' : 'tel'}
              value={testTarget}
              onChange={(e) => setTestTarget(e.target.value)}
              placeholder={testChannel === 'email' ? 'user@company.in' : '9876543210'}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />

            <button
              type="button"
              onClick={handleRunTestOtp}
              disabled={testingOtp}
              className="w-full py-2.5 rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {testingOtp ? 'Dispatching...' : 'Send Test OTP'}
            </button>

            {testResult && (
              <div className="p-3.5 rounded-xl bg-[#E5EFF3] dark:bg-slate-800 text-xs space-y-1.5">
                <div className="font-bold text-[#116B68] dark:text-teal-300">
                  Delivered via: {testResult.deliveredVia.join(', ')}
                </div>
                {testResult.otpPreview && (
                  <div className="font-mono font-bold text-sm text-[#243746] dark:text-white">
                    Test Code: {testResult.otpPreview}
                  </div>
                )}
                {testResult.warnings && testResult.warnings.length > 0 && (
                  <div className="text-[11px] text-[#F59E0B]">
                    {testResult.warnings.join(' · ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
