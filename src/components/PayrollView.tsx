import React, { useMemo, useState } from 'react';
import {
  BadgeIndianRupee,
  Building2,
  Calculator,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Landmark,
  Percent,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { PayrollRunRecord, StaffMember } from '../types/accounting';
import { exportToCSV, formatINR, uid } from '../utils/formatters';
import { computeLiveSalaryBreakdown, estimateMonthlyTDS, formatPayrollMonth } from '../utils/payrollCalc';
import { downloadReportPDF, downloadSalarySlipPDF, formatPdfAmount } from '../utils/pdfGenerator';
import { PayslipModal } from './PayslipModal';

type PayrollTab =
  | 'employees'
  | 'structure'
  | 'run_payroll'
  | 'payslips'
  | 'hr_requests'
  | 'statutory';

const DEPARTMENTS = ['Management', 'Accounts & Finance', 'Sales & Billing', 'Warehouse & Inventory', 'Operations', 'IT & Admin'];
const PT_STATES = ['Maharashtra', 'Karnataka', 'Gujarat', 'Delhi (No PT)', 'Uttar Pradesh (No PT)', 'Tamil Nadu'];

export const PayrollView: React.FC = () => {
  const {
    db,
    saveStaff,
    deleteStaff,
    payStaffSalary,
    runBulkPayroll,
    saveEmployeeAdvance,
    saveLeaveRequest,
    decideLeaveRequest,
    saveReimbursement,
    decideReimbursement,
    saveCommissionRule,
  } = useStore();

  const [tab, setTab] = useState<PayrollTab>('run_payroll');
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');

  // Active month & bank account for payroll runs
  const [payMonth, setPayMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [payBankId, setPayBankId] = useState('');

  // Per-employee monthly variable overrides in Run Payroll screen
  const [runOverrides, setRunOverrides] = useState<
    Record<
      string,
      {
        attendanceDays: number;
        overtimeHours: number;
        bonusAmt: number;
        arrearsAmt: number;
        otherDeductions: number;
      }
    >
  >({});

  // Payslip modal preview state
  const [payslipPreview, setPayslipPreview] = useState<{
    member: StaffMember;
    month: string;
    runRecord?: PayrollRunRecord;
    overrides?: {
      attendanceDays?: number;
      overtimeHours?: number;
      bonusAmt?: number;
      arrearsAmt?: number;
      otherDeductions?: number;
      commissionAmt?: number;
    };
  } | null>(null);

  // Employee Onboarding / Edit form state
  const [showEmpForm, setShowEmpForm] = useState(false);
  const [empForm, setEmpForm] = useState<StaffMember>({
    id: '',
    empCode: '',
    name: '',
    role: 'Accountant',
    designation: 'Accounts Executive',
    department: 'Accounts & Finance',
    joiningDate: new Date().toISOString().slice(0, 10),
    employmentType: 'Full-Time',
    phone: '',
    email: '',
    pan: '',
    uan: '',
    esicNo: '',
    bankName: 'HDFC Bank Ltd',
    bankAccountNo: '',
    ifsc: '',
    paymentMode: 'Bank Transfer',
    monthlySalary: 30000,
    hraPct: 20,
    conveyanceAmt: 1600,
    allowanceAmt: 2000,
    pfDeduction: 1800,
    esicDeduction: 0,
    ptDeduction: 200,
    tdsDeduction: 0,
    includePf: true,
    includeEsic: false,
    taxRegime: 'New',
    ptState: 'Maharashtra',
    attendanceDays: 26,
    lopDays: 0,
    overtimeHours: 0,
    overtimeRate: 250,
    bonusAmt: 0,
    arrearsAmt: 0,
    commissionPct: 1.5,
    clBalance: 6,
    slBalance: 6,
    elBalance: 12,
    status: 'active',
    permissions: ['billing', 'reports'],
  });

  // Selected staff for Salary Structure & Tax Builder
  const [structStaffId, setStructStaffId] = useState('');

  // Leaves, Advances, Reimbursements form state
  const [advForm, setAdvForm] = useState({
    staffId: '',
    type: 'Salary Advance' as 'Salary Advance' | 'Staff Loan',
    amount: 10000,
    monthlyEmi: 2500,
    reason: '',
  });
  const [leaveForm, setLeaveForm] = useState({
    staffId: '',
    leaveType: 'CL' as 'CL' | 'SL' | 'EL' | 'LOP',
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    days: 1,
    reason: '',
  });
  const [reimbForm, setReimbForm] = useState({
    staffId: '',
    category: 'Travel' as 'Travel' | 'Food' | 'Fuel' | 'Mobile/Internet' | 'Medical' | 'Other',
    amount: 1200,
    description: '',
  });

  // Sales Commission & F&F Settlement state
  const [commStaffId, setCommStaffId] = useState('');
  const [commRate, setCommRate] = useState(2.5);
  const [fnfStaffId, setFnfStaffId] = useState('');
  const [fnfLastDay, setFnfLastDay] = useState(new Date().toISOString().slice(0, 10));
  const [fnfWorkedDays, setFnfWorkedDays] = useState(18);
  const [fnfYearsService, setFnfYearsService] = useState(2);

  const staff = db?.staff || [];
  const payrollRuns = db?.payrollRuns || [];
  const advances = db?.employeeAdvances || [];
  const leaveRequests = db?.leaveRequests || [];
  const reimbursements = db?.reimbursements || [];

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staff.filter((m) => {
      const matchDept = deptFilter === 'All' || (m.department || 'Operations') === deptFilter;
      const matchQ =
        !q ||
        m.name.toLowerCase().includes(q) ||
        (m.empCode || '').toLowerCase().includes(q) ||
        (m.designation || m.role).toLowerCase().includes(q) ||
        m.phone.includes(q);
      return matchDept && matchQ;
    });
  }, [staff, searchQuery, deptFilter]);

  const monthRuns = useMemo(
    () => payrollRuns.filter((r) => r.month === payMonth),
    [payrollRuns, payMonth]
  );

  const activeBankId = useMemo(() => {
    if (payBankId) return payBankId;
    return db?.bankAccounts.find((b) => b.type === 'bank')?.id || db?.bankAccounts[0]?.id || '';
  }, [payBankId, db?.bankAccounts]);

  const structMember = useMemo(
    () => staff.find((m) => m.id === structStaffId) || staff[0],
    [staff, structStaffId]
  );

  const fnfMember = useMemo(
    () => staff.find((m) => m.id === fnfStaffId) || staff[0],
    [staff, fnfStaffId]
  );

  // KPI Metrics
  const kpis = useMemo(() => {
    const active = staff.filter((s) => s.status === 'active');
    const estGross = active.reduce((s, m) => s + computeLiveSalaryBreakdown({ member: m, month: payMonth, advances, reimbursements }).grossEarnings, 0);
    const estNet = active.reduce((s, m) => s + computeLiveSalaryBreakdown({ member: m, month: payMonth, advances, reimbursements }).netPay, 0);
    const totalAdvPending = advances.filter((a) => a.status === 'Active').reduce((s, a) => s + Math.max(0, a.amount - a.recoveredAmount), 0);
    const paidThisMonth = monthRuns.reduce((s, r) => s + r.netPay, 0);
    return {
      totalStaff: staff.length,
      activeCount: active.length,
      estGross,
      estNet,
      paidThisMonth,
      paidHeadcount: monthRuns.length,
      totalAdvPending,
      pendingLeaves: leaveRequests.filter((l) => l.status === 'Pending').length,
      pendingReimb: reimbursements.filter((r) => r.status !== 'Paid').length,
    };
  }, [staff, payMonth, advances, reimbursements, monthRuns, leaveRequests]);

  // Department Breakdown
  const deptBreakdown = useMemo(() => {
    const map = new Map<string, { headcount: number; gross: number; epf: number; net: number }>();
    for (const m of staff) {
      const dept = m.department || 'Operations';
      const b = computeLiveSalaryBreakdown({ member: m, month: payMonth, advances, reimbursements });
      const prev = map.get(dept) || { headcount: 0, gross: 0, epf: 0, net: 0 };
      prev.headcount += 1;
      prev.gross += b.grossEarnings;
      prev.epf += b.employeePf + b.employerPf;
      prev.net += b.netPay;
      map.set(dept, prev);
    }
    return Array.from(map.entries()).map(([dept, stats]) => ({ dept, ...stats }));
  }, [staff, payMonth, advances, reimbursements]);

  // Sales Rep Commission Summary from actual invoices
  const commissionSummary = useMemo(() => {
    if (!db) return [];
    const sales = db.vouchers.filter((v) => v.type === 'sale_invoice' && v.status !== 'cancelled');
    return staff.map((m) => {
      const repSales = sales.filter((v) => (v.salesRepName || '').toLowerCase() === m.name.toLowerCase());
      const repTotal = repSales.reduce((s, v) => s + v.subTotal, 0);
      const rule = db.commissionRules.find((r) => r.staffId === m.id);
      const ratePct = rule?.ratePct ?? m.commissionPct ?? 0;
      const earned = Math.round((repTotal * ratePct) / 100);
      return {
        staff: m,
        invoicesCount: repSales.length,
        salesTotal: repTotal,
        ratePct,
        earned,
      };
    });
  }, [db, staff]);

  if (!db) return null;

  const notify = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4500);
  };

  const getOverride = (m: StaffMember) =>
    runOverrides[m.id] || {
      attendanceDays: m.attendanceDays ?? 26,
      overtimeHours: m.overtimeHours ?? 0,
      bonusAmt: m.bonusAmt ?? 0,
      arrearsAmt: m.arrearsAmt ?? 0,
      otherDeductions: 0,
    };

  const setOverrideField = (
    m: StaffMember,
    field: 'attendanceDays' | 'overtimeHours' | 'bonusAmt' | 'arrearsAmt' | 'otherDeductions',
    val: number
  ) => {
    const cur = getOverride(m);
    setRunOverrides((prev) => ({
      ...prev,
      [m.id]: { ...cur, [field]: val },
    }));
  };

  const openNewEmployee = () => {
    setEmpForm({
      id: '',
      empCode: `EMP-${String(101 + staff.length)}`,
      name: '',
      role: 'Accountant',
      designation: 'Executive',
      department: 'Accounts & Finance',
      joiningDate: new Date().toISOString().slice(0, 10),
      employmentType: 'Full-Time',
      phone: '',
      email: '',
      pan: '',
      uan: '',
      esicNo: '',
      bankName: 'HDFC Bank Ltd',
      bankAccountNo: '',
      ifsc: '',
      paymentMode: 'Bank Transfer',
      monthlySalary: 28000,
      hraPct: 20,
      conveyanceAmt: 1600,
      allowanceAmt: 2000,
      pfDeduction: 1680,
      esicDeduction: 0,
      ptDeduction: 200,
      tdsDeduction: 0,
      includePf: true,
      includeEsic: false,
      taxRegime: 'New',
      ptState: 'Maharashtra',
      attendanceDays: 26,
      lopDays: 0,
      overtimeHours: 0,
      overtimeRate: 250,
      bonusAmt: 0,
      arrearsAmt: 0,
      commissionPct: 1.5,
      clBalance: 6,
      slBalance: 6,
      elBalance: 12,
      status: 'active',
      permissions: ['billing', 'reports'],
    });
    setShowEmpForm(true);
  };

  const openEditEmployee = (m: StaffMember) => {
    setEmpForm({ ...m });
    setShowEmpForm(true);
  };

  const exportBankTransferAdvice = () => {
    const targetRuns = monthRuns.length > 0 ? monthRuns : [];
    const headers = ['Payslip No', 'Emp Code', 'Employee Name', 'Bank Name', 'Account No', 'IFSC Code', 'Mode', 'Net Amount (INR)'];
    const rows =
      targetRuns.length > 0
        ? targetRuns.map((r) => {
            const st = staff.find((s) => s.id === r.staffId);
            return [
              r.payslipNo,
              r.empCode,
              r.staffName,
              st?.bankName || 'HDFC Bank Ltd',
              st?.bankAccountNo || '-',
              st?.ifsc || '-',
              r.paymentMode,
              r.netPay.toFixed(2),
            ];
          })
        : staff
            .filter((s) => s.status === 'active')
            .map((m) => {
              const b = computeLiveSalaryBreakdown({ member: m, month: payMonth, advances, reimbursements });
              return [
                b.payslipNo,
                m.empCode || '-',
                m.name,
                m.bankName || 'HDFC Bank Ltd',
                m.bankAccountNo || '-',
                m.ifsc || '-',
                m.paymentMode || 'Bank Transfer',
                b.netPay.toFixed(2),
              ];
            });
    exportToCSV(`Bank_NEFT_Salary_Sheet_${payMonth}.csv`, headers, rows);
    notify(`Exported NEFT Bank Salary Advice CSV for ${payMonth}`);
  };

  const exportBankAdvicePDF = () => {
    const sourceRows =
      monthRuns.length > 0
        ? monthRuns.map((r) => {
            const st = staff.find((s) => s.id === r.staffId);
            return [
              r.empCode,
              r.staffName,
              st?.bankName || 'HDFC Bank',
              st?.bankAccountNo || '-',
              st?.ifsc || '-',
              formatPdfAmount(r.netPay),
            ];
          })
        : staff.filter((s) => s.status === 'active').map((m) => {
            const b = computeLiveSalaryBreakdown({ member: m, month: payMonth, advances, reimbursements });
            return [m.empCode || '-', m.name, m.bankName || 'HDFC Bank', m.bankAccountNo || '-', m.ifsc || '-', formatPdfAmount(b.netPay)];
          });
    downloadReportPDF({
      title: `Bank NEFT / RTGS Salary Transfer Advice — ${formatPayrollMonth(payMonth)}`,
      subtitle: `Company: ${db.profile.companyName} | Employer PAN: ${db.profile.pan || '-'} | Total Employees: ${sourceRows.length}`,
      companyName: db.profile.companyName,
      headers: ['Emp Code', 'Beneficiary Name', 'Bank Name', 'Account No.', 'IFSC', 'Net Transfer'],
      rows: sourceRows,
      filename: `Bank_NEFT_Advice_${payMonth}.pdf`,
    });
  };

  const exportStatutoryECR = () => {
    const rows = staff.map((m) => {
      const b = computeLiveSalaryBreakdown({
        member: m,
        month: payMonth,
        runRecord: monthRuns.find((r) => r.staffId === m.id),
        advances,
        reimbursements,
      });
      return [
        m.uan || '-',
        m.empCode || '-',
        m.name,
        formatPdfAmount(b.grossEarnings),
        formatPdfAmount(b.basic),
        formatPdfAmount(b.employeePf),
        formatPdfAmount(b.employerPf),
        formatPdfAmount(b.employeeEsic + b.employerEsic),
        formatPdfAmount(b.professionalTax),
        formatPdfAmount(b.tds),
      ];
    });
    downloadReportPDF({
      title: `Statutory Compliance Register (EPF ECR, ESIC, PT & TDS) — ${formatPayrollMonth(payMonth)}`,
      companyName: db.profile.companyName,
      headers: ['UAN', 'Code', 'Employee', 'Gross', 'EPF Wages', 'Emp PF', 'Er PF', 'Total ESIC', 'Prof. Tax', 'TDS'],
      rows,
      landscape: true,
      filename: `Statutory_PF_ESIC_TDS_${payMonth}.pdf`,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-900 rounded-2xl p-5 text-white shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-sky-200 font-semibold">
            Payroll, HR &amp; Statutory Compliance Suite (20 Modules)
          </div>
          <h2 className="text-xl md:text-2xl font-bold mt-1">
            Employee Payroll, Authentic Corporate Payslips, EPF/ESIC/TDS &amp; Bank NEFT
          </h2>
          <p className="text-xs text-slate-300 mt-1">
            Full Accounting Journal auto-posting · LOP &amp; Overtime proration · Advance EMI auto-recovery · Leave &amp; F&amp;F Settlement
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs">
            <CalendarDays className="w-3.5 h-3.5 text-sky-300" />
            <span>Pay Month:</span>
            <input
              type="month"
              value={payMonth}
              onChange={(e) => setPayMonth(e.target.value)}
              className="bg-transparent font-bold text-white focus:outline-none"
            />
          </div>
          <button
            onClick={openNewEmployee}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-indigo-900 text-xs font-bold shadow hover:bg-sky-50"
          >
            <UserPlus className="w-3.5 h-3.5" />
            + Add Employee
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 text-xs font-semibold flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="underline text-[11px]">Dismiss</button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-indigo-600" /> Active Headcount
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {kpis.activeCount} <span className="text-xs font-normal text-slate-500">/ {kpis.totalStaff} total</span>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-blue-600" /> Est. Monthly Net Payroll
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">{formatINR(kpis.estNet)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Disbursed ({payMonth})
          </div>
          <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
            {formatINR(kpis.paidThisMonth)}
          </div>
          <div className="text-[10px] text-slate-500">{kpis.paidHeadcount} payslips processed</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-amber-600" /> Pending Staff Advances
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">{formatINR(kpis.totalAdvPending)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5 text-indigo-600" /> Pending HR Approvals
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {kpis.pendingLeaves + kpis.pendingReimb}
          </div>
          <div className="text-[10px] text-slate-500">
            {kpis.pendingLeaves} leaves · {kpis.pendingReimb} claims
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'run_payroll' as const, label: 'Run Monthly Payroll & Attendance', icon: BadgeIndianRupee },
          { id: 'payslips' as const, label: 'Payslips Archive & Bank NEFT', icon: FileText },
          { id: 'employees' as const, label: 'Employees, PAN/UAN & Bank Details', icon: Users },
          { id: 'structure' as const, label: 'Salary Structure & TDS Slab Builder', icon: Calculator },
          { id: 'hr_requests' as const, label: 'Leaves, Advances & Reimbursements', icon: CalendarDays },
          { id: 'statutory' as const, label: 'PF ECR / ESIC, Commissions & F&F', icon: ShieldCheck },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                tab === t.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* TAB: RUN MONTHLY PAYROLL */}
      {tab === 'run_payroll' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Monthly Payroll Sheet — {formatPayrollMonth(payMonth)}
              </h3>
              <p className="text-xs text-slate-500">
                Adjust Paid Days (LOP auto-prorated), Overtime Hours, Bonus &amp; Arrears. Preview authentic Corporate Payslip or Post Journal in one click.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 text-slate-500" />
                <select
                  value={activeBankId}
                  onChange={(e) => setPayBankId(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {db.bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      Disburse via: {b.bankName}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={async () => {
                  const processed = await runBulkPayroll(payMonth, activeBankId);
                  notify(`Bulk Payroll processed for ${processed} active employee(s) for ${payMonth} & posted Accounting Journals.`);
                }}
                className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                Run Bulk Payroll ({staff.filter((s) => s.status === 'active' && s.lastPaidMonth !== payMonth).length} Pending)
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                  <th className="py-2.5 px-2">Employee</th>
                  <th className="py-2.5 px-2 text-center">Paid Days /26</th>
                  <th className="py-2.5 px-2 text-center">OT Hrs</th>
                  <th className="py-2.5 px-2 text-center">Bonus (₹)</th>
                  <th className="py-2.5 px-2 text-center">Arrears (₹)</th>
                  <th className="py-2.5 px-2 text-right">Gross Pay</th>
                  <th className="py-2.5 px-2 text-right">PF+ESIC+PT+TDS+Adv</th>
                  <th className="py-2.5 px-2 text-right">Net Pay</th>
                  <th className="py-2.5 px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {staff.map((m) => {
                  const ov = getOverride(m);
                  const existingRun = monthRuns.find((r) => r.staffId === m.id);
                  const preview = computeLiveSalaryBreakdown({
                    member: m,
                    month: payMonth,
                    runRecord: existingRun,
                    advances,
                    reimbursements,
                    overrides: ov,
                  });
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-2">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {m.name} <span className="font-mono text-[10px] text-slate-400">({m.empCode || 'EMP'})</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {m.designation || m.role} · {m.department || 'Operations'}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <input
                          type="number"
                          min={0}
                          max={26}
                          disabled={Boolean(existingRun)}
                          value={existingRun ? existingRun.paidDays : ov.attendanceDays}
                          onChange={(e) => setOverrideField(m, 'attendanceDays', Number(e.target.value))}
                          className="w-14 px-1.5 py-1 text-center border rounded bg-white dark:bg-slate-800 disabled:opacity-60"
                        />
                        {preview.lopDays > 0 && (
                          <div className="text-[10px] text-amber-700 dark:text-amber-400">LOP: {preview.lopDays}d</div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <input
                          type="number"
                          min={0}
                          disabled={Boolean(existingRun)}
                          value={ov.overtimeHours}
                          onChange={(e) => setOverrideField(m, 'overtimeHours', Number(e.target.value))}
                          className="w-14 px-1.5 py-1 text-center border rounded bg-white dark:bg-slate-800 disabled:opacity-60"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <input
                          type="number"
                          min={0}
                          disabled={Boolean(existingRun)}
                          value={ov.bonusAmt}
                          onChange={(e) => setOverrideField(m, 'bonusAmt', Number(e.target.value))}
                          className="w-20 px-1.5 py-1 text-right border rounded bg-white dark:bg-slate-800 disabled:opacity-60"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <input
                          type="number"
                          min={0}
                          disabled={Boolean(existingRun)}
                          value={ov.arrearsAmt}
                          onChange={(e) => setOverrideField(m, 'arrearsAmt', Number(e.target.value))}
                          className="w-20 px-1.5 py-1 text-right border rounded bg-white dark:bg-slate-800 disabled:opacity-60"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-semibold">{formatINR(preview.grossEarnings)}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                        -{formatINR(preview.totalDeductions)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold text-blue-700 dark:text-blue-400">
                        {formatINR(preview.netPay)}
                      </td>
                      <td className="py-2.5 px-2 text-right space-x-1 whitespace-nowrap">
                        <button
                          onClick={() =>
                            setPayslipPreview({
                              member: m,
                              month: payMonth,
                              runRecord: existingRun,
                              overrides: ov,
                            })
                          }
                          className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
                        >
                          Payslip
                        </button>
                        {existingRun ? (
                          <span className="inline-block px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                            Paid
                          </span>
                        ) : (
                          <button
                            onClick={async () => {
                              await payStaffSalary(m.id, payMonth, activeBankId, ov);
                              notify(`Salary paid & Accounting Journal posted for ${m.name} (${payMonth})`);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                          >
                            Pay &amp; Post
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: PAYSLIPS ARCHIVE & BANK NEFT */}
      {tab === 'payslips' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Generated Salary Payslips &amp; Bank NEFT Transfer Sheet
              </h3>
              <p className="text-xs text-slate-500">
                Authentic Corporate Salary Statements (separate from tax invoices) + Bank NEFT/RTGS upload advice.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={exportBankTransferAdvice}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                Export NEFT CSV
              </button>
              <button
                onClick={exportBankAdvicePDF}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Bank NEFT Advice PDF
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                  <th className="py-2.5 px-2">Payslip No.</th>
                  <th className="py-2.5 px-2">Month</th>
                  <th className="py-2.5 px-2">Employee</th>
                  <th className="py-2.5 px-2">Dept / Role</th>
                  <th className="py-2.5 px-2 text-center">Paid Days</th>
                  <th className="py-2.5 px-2 text-right">Gross</th>
                  <th className="py-2.5 px-2 text-right">Deductions</th>
                  <th className="py-2.5 px-2 text-right">Net Pay</th>
                  <th className="py-2.5 px-2 text-right">Payslip Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {payrollRuns.map((r) => {
                  const member = staff.find((s) => s.id === r.staffId);
                  return (
                    <tr key={r.id}>
                      <td className="py-2.5 px-2 font-mono font-bold text-indigo-700 dark:text-indigo-400">{r.payslipNo}</td>
                      <td className="py-2.5 px-2 font-medium">{formatPayrollMonth(r.month)}</td>
                      <td className="py-2.5 px-2 font-bold">{r.staffName} ({r.empCode})</td>
                      <td className="py-2.5 px-2 text-slate-500">{r.department} · {r.designation}</td>
                      <td className="py-2.5 px-2 text-center">{r.paidDays}/{r.workingDays}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatINR(r.grossEarnings)}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-slate-500">-{formatINR(r.totalDeductions)}</td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">{formatINR(r.netPay)}</td>
                      <td className="py-2.5 px-2 text-right space-x-1.5 whitespace-nowrap">
                        {member && (
                          <>
                            <button
                              onClick={() => setPayslipPreview({ member, month: r.month, runRecord: r })}
                              className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              View / Print
                            </button>
                            <button
                              onClick={() => downloadSalarySlipPDF(member, r.month, db.profile, r)}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                            >
                              PDF
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {payrollRuns.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      No payslips generated yet. Go to Run Monthly Payroll to process salaries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: EMPLOYEES & ONBOARDING */}
      {tab === 'employees' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name, Emp Code, phone..."
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="All">All Departments</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={openNewEmployee}
                className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Employee Profile
              </button>
            </div>

            {showEmpForm && (
              <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-slate-800/50 space-y-3 text-xs">
                <div className="flex items-center justify-between font-bold text-indigo-900 dark:text-indigo-300">
                  <span>{empForm.id ? `Edit Employee: ${empForm.name}` : 'New Employee Onboarding'}</span>
                  <button onClick={() => setShowEmpForm(false)} className="text-slate-500 underline">Cancel</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Emp Code</label>
                    <input value={empForm.empCode || ''} onChange={(e) => setEmpForm({ ...empForm, empCode: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Full Name *</label>
                    <input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} placeholder="e.g. Ananya Sharma" className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Designation</label>
                    <input value={empForm.designation || ''} onChange={(e) => setEmpForm({ ...empForm, designation: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Department</label>
                    <select value={empForm.department || 'Operations'} onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900">
                      {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Phone</label>
                    <input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Email</label>
                    <input value={empForm.email} onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Date of Joining</label>
                    <input type="date" value={empForm.joiningDate || ''} onChange={(e) => setEmpForm({ ...empForm, joiningDate: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Monthly Base Salary (₹)</label>
                    <input type="number" value={empForm.monthlySalary} onChange={(e) => setEmpForm({ ...empForm, monthlySalary: Number(e.target.value) })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">PAN Number</label>
                    <input value={empForm.pan || ''} onChange={(e) => setEmpForm({ ...empForm, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900 font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">EPF UAN Number</label>
                    <input value={empForm.uan || ''} onChange={(e) => setEmpForm({ ...empForm, uan: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900 font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Bank Name</label>
                    <input value={empForm.bankName || ''} onChange={(e) => setEmpForm({ ...empForm, bankName: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Bank Account No.</label>
                    <input value={empForm.bankAccountNo || ''} onChange={(e) => setEmpForm({ ...empForm, bankAccountNo: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900 font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">IFSC Code</label>
                    <input value={empForm.ifsc || ''} onChange={(e) => setEmpForm({ ...empForm, ifsc: e.target.value.toUpperCase() })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900 font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Payment Mode</label>
                    <select value={empForm.paymentMode || 'Bank Transfer'} onChange={(e) => setEmpForm({ ...empForm, paymentMode: e.target.value as StaffMember['paymentMode'] })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900">
                      <option>Bank Transfer</option>
                      <option>UPI</option>
                      <option>Cheque</option>
                      <option>Cash</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Tax Regime</label>
                    <select value={empForm.taxRegime || 'New'} onChange={(e) => setEmpForm({ ...empForm, taxRegime: e.target.value as 'New' | 'Old' })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900">
                      <option value="New">New Regime (FY 26-27)</option>
                      <option value="Old">Old Regime</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Employment Status</label>
                    <select value={empForm.status} onChange={(e) => setEmpForm({ ...empForm, status: e.target.value as 'active' | 'inactive' })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-900">
                      <option value="active">Active</option>
                      <option value="inactive">Inactive / Exited</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={async () => {
                      if (!empForm.name.trim()) return;
                      await saveStaff({ ...empForm, id: empForm.id || uid('stf') });
                      setShowEmpForm(false);
                      notify(`Saved employee profile for ${empForm.name}`);
                    }}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold"
                  >
                    Save Employee Record
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                    <th className="py-2.5 px-2">Emp Code &amp; Name</th>
                    <th className="py-2.5 px-2">Department / Designation</th>
                    <th className="py-2.5 px-2">PAN &amp; EPF UAN</th>
                    <th className="py-2.5 px-2">Bank &amp; IFSC</th>
                    <th className="py-2.5 px-2 text-right">Monthly Salary</th>
                    <th className="py-2.5 px-2 text-center">Status</th>
                    <th className="py-2.5 px-2 text-right">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredStaff.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 px-2">
                        <div className="font-bold text-slate-900 dark:text-white">{m.name}</div>
                        <div className="text-[11px] font-mono text-slate-500">{m.empCode || 'EMP'} · {m.phone}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-medium">{m.designation || m.role}</div>
                        <div className="text-[11px] text-slate-500">{m.department || 'Operations'} · DOJ {m.joiningDate || '2025-04-01'}</div>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-[11px]">
                        <div>PAN: {m.pan || '-'}</div>
                        <div className="text-slate-500">UAN: {m.uan || '-'}</div>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-[11px]">
                        <div>{m.bankName || '-'} ({m.bankAccountNo || '-'})</div>
                        <div className="text-slate-500">IFSC: {m.ifsc || '-'}</div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold">{formatINR(m.monthlySalary)}</td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${m.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                          {m.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right space-x-1 whitespace-nowrap">
                        <button
                          onClick={() => openEditEmployee(m)}
                          className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="Edit employee"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            await deleteStaff(m.id);
                            notify(`Removed ${m.name} from directory`);
                          }}
                          className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 hover:text-amber-700"
                          title="Remove employee"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: SALARY STRUCTURE & TDS SLAB BUILDER */}
      {tab === 'structure' && structMember && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">CTC Structure &amp; Statutory Configuration</h3>
              <select
                value={structMember.id}
                onChange={(e) => setStructStaffId(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
              >
                {staff.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.empCode || 'EMP'})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Base Monthly Pay (₹)</label>
                <input
                  type="number"
                  value={structMember.monthlySalary}
                  onChange={(e) => saveStaff({ ...structMember, monthlySalary: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">HRA (%)</label>
                <input
                  type="number"
                  value={structMember.hraPct ?? 20}
                  onChange={(e) => saveStaff({ ...structMember, hraPct: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Conveyance Allowance (₹)</label>
                <input
                  type="number"
                  value={structMember.conveyanceAmt ?? 1600}
                  onChange={(e) => saveStaff({ ...structMember, conveyanceAmt: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Fixed Special Allowance (₹)</label>
                <input
                  type="number"
                  value={structMember.allowanceAmt ?? 2000}
                  onChange={(e) => saveStaff({ ...structMember, allowanceAmt: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">State Professional Tax (₹)</label>
                <input
                  type="number"
                  value={structMember.ptDeduction ?? 200}
                  onChange={(e) => saveStaff({ ...structMember, ptDeduction: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">PT Work State</label>
                <select
                  value={structMember.ptState || 'Maharashtra'}
                  onChange={(e) => {
                    const st = e.target.value;
                    const autoPt = st.includes('No PT') ? 0 : 200;
                    saveStaff({ ...structMember, ptState: st, ptDeduction: autoPt });
                  }}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800"
                >
                  {PT_STATES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Overtime Rate (₹ / Hr)</label>
                <input
                  type="number"
                  value={structMember.overtimeRate ?? 250}
                  onChange={(e) => saveStaff({ ...structMember, overtimeRate: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Monthly TDS Deducted (₹)</label>
                <input
                  type="number"
                  value={structMember.tdsDeduction ?? 0}
                  onChange={(e) => saveStaff({ ...structMember, tdsDeduction: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800 font-mono"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-2 border-t">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={structMember.includePf !== false}
                  onChange={(e) => saveStaff({ ...structMember, includePf: e.target.checked })}
                />
                Enable Statutory EPF (12% capped ₹1,800)
              </label>
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={Boolean(structMember.includeEsic)}
                  onChange={(e) => saveStaff({ ...structMember, includeEsic: e.target.checked })}
                />
                Enable ESIC (0.75% Emp / 3.25% Employer)
              </label>
            </div>

            {/* TDS Auto Slab Helper */}
            {(() => {
              const br = computeLiveSalaryBreakdown({ member: structMember, month: payMonth });
              const estTds = estimateMonthlyTDS(br.grossEarnings * 12, structMember.taxRegime || 'New');
              return (
                <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-slate-800 border border-blue-200 dark:border-slate-700 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-blue-900 dark:text-blue-300">
                      FY 2026-27 Income Tax TDS Calculator ({structMember.taxRegime || 'New'} Regime)
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Annualized Gross: {formatINR(br.grossEarnings * 12)} → Suggested Monthly TDS: <strong>{formatINR(estTds)}</strong>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      await saveStaff({ ...structMember, tdsDeduction: estTds });
                      notify(`Applied monthly TDS of ${formatINR(estTds)} for ${structMember.name}`);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold shrink-0"
                  >
                    Apply TDS
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Live Breakup Card */}
          {(() => {
            const br = computeLiveSalaryBreakdown({ member: structMember, month: payMonth, advances, reimbursements });
            return (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-sm font-bold">Monthly Salary &amp; CTC Breakup — {structMember.name}</h3>
                  <button
                    onClick={() => setPayslipPreview({ member: structMember, month: payMonth })}
                    className="text-indigo-600 font-semibold underline"
                  >
                    Open Full Payslip
                  </button>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[
                    ['Basic Salary (50%)', formatINR(br.basic), 'Earning'],
                    [`HRA (${structMember.hraPct ?? 20}%)`, formatINR(br.hra), 'Earning'],
                    ['Conveyance Allowance', formatINR(br.conveyance), 'Earning'],
                    ['Special & Fixed Allowance', formatINR(br.specialAllowance), 'Earning'],
                    ['Gross Monthly Earnings (A)', formatINR(br.grossEarnings), 'Total'],
                    ['Employee EPF Deduction', `-${formatINR(br.employeePf)}`, 'Deduction'],
                    ['Employee ESIC Deduction', `-${formatINR(br.employeeEsic)}`, 'Deduction'],
                    ['Professional Tax + TDS', `-${formatINR(br.professionalTax + br.tds)}`, 'Deduction'],
                    ['Employer EPF + ESIC Share', formatINR(br.employerPf + br.employerEsic), 'CTC Add-on'],
                    ['Annual Cost to Company (CTC)', formatINR(br.monthlyCtc * 12), 'Annual'],
                  ].map(([k, v, tag]) => (
                    <div key={k} className={`flex justify-between py-2 ${tag === 'Total' ? 'font-bold bg-slate-50 dark:bg-slate-800/40 px-2 rounded' : ''}`}>
                      <span>{k}</span>
                      <span className="font-mono font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 flex justify-between items-center">
                  <span className="font-bold text-emerald-900 dark:text-emerald-300">Net Take-Home Pay</span>
                  <span className="text-lg font-extrabold font-mono text-emerald-800 dark:text-emerald-300">{formatINR(br.netPay)}</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB: LEAVES, ADVANCES & REIMBURSEMENTS */}
      {tab === 'hr_requests' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 text-xs">
          {/* Leave Balances & Requests */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-indigo-600" /> Leave Management (CL/SL/EL/LOP)
            </h3>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {leaveRequests.map((lv) => (
                <div key={lv.id} className="p-2.5 rounded-xl border flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold">{lv.staffName} · {lv.leaveType} ({lv.days}d)</div>
                    <div className="text-[11px] text-slate-500">{lv.fromDate} → {lv.toDate} · {lv.reason}</div>
                  </div>
                  {lv.status === 'Pending' ? (
                    <div className="flex gap-1">
                      <button
                        onClick={async () => {
                          await decideLeaveRequest(lv.id, 'Approved');
                          notify(`Approved ${lv.days}d ${lv.leaveType} for ${lv.staffName}`);
                        }}
                        className="px-2 py-1 rounded bg-emerald-600 text-white font-semibold"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => decideLeaveRequest(lv.id, 'Rejected')}
                        className="px-2 py-1 rounded bg-slate-200 text-slate-700 font-semibold"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${lv.status === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                      {lv.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="pt-2 border-t space-y-2">
              <select value={leaveForm.staffId || staff[0]?.id || ''} onChange={(e) => setLeaveForm({ ...leaveForm, staffId: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                {staff.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} (CL:{m.clBalance ?? 6} SL:{m.slBalance ?? 6} EL:{m.elBalance ?? 12})</option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <select value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value as 'CL' | 'SL' | 'EL' | 'LOP' })} className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                  <option value="CL">CL</option>
                  <option value="SL">SL</option>
                  <option value="EL">EL</option>
                  <option value="LOP">LOP (Unpaid)</option>
                </select>
                <input type="number" min={1} value={leaveForm.days} onChange={(e) => setLeaveForm({ ...leaveForm, days: Number(e.target.value) })} placeholder="Days" className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
                <input type="date" value={leaveForm.fromDate} onChange={(e) => setLeaveForm({ ...leaveForm, fromDate: e.target.value })} className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
              </div>
              <input value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="Leave reason..." className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
              <button
                onClick={async () => {
                  const target = staff.find((m) => m.id === (leaveForm.staffId || staff[0]?.id));
                  if (!target) return;
                  await saveLeaveRequest({ ...leaveForm, staffId: target.id, staffName: target.name, toDate: leaveForm.fromDate });
                  setLeaveForm({ ...leaveForm, reason: '' });
                  notify(`Recorded leave request for ${target.name}`);
                }}
                className="w-full py-2 rounded-xl bg-indigo-600 text-white font-semibold"
              >
                + Submit Leave Request
              </button>
            </div>
          </div>

          {/* Salary Advances & Loans */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <CreditCard className="w-4 h-4 text-amber-600" /> Advances &amp; Auto-EMI Recovery
            </h3>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {advances.map((a) => (
                <div key={a.id} className="p-2.5 rounded-xl border space-y-0.5">
                  <div className="flex justify-between font-bold">
                    <span>{a.staffName} ({a.type})</span>
                    <span className="font-mono">{formatINR(a.amount)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Recovered: {formatINR(a.recoveredAmount)} · EMI: {formatINR(a.monthlyEmi)}</span>
                    <span className={`font-bold ${a.status === 'Settled' ? 'text-emerald-700' : 'text-amber-700'}`}>{a.status}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t space-y-2">
              <select value={advForm.staffId || staff[0]?.id || ''} onChange={(e) => setAdvForm({ ...advForm, staffId: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                {staff.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <select value={advForm.type} onChange={(e) => setAdvForm({ ...advForm, type: e.target.value as 'Salary Advance' | 'Staff Loan' })} className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                  <option>Salary Advance</option>
                  <option>Staff Loan</option>
                </select>
                <input type="number" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: Number(e.target.value) })} placeholder="Amount" className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
                <input type="number" value={advForm.monthlyEmi} onChange={(e) => setAdvForm({ ...advForm, monthlyEmi: Number(e.target.value) })} placeholder="EMI/mo" className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
              </div>
              <input value={advForm.reason} onChange={(e) => setAdvForm({ ...advForm, reason: e.target.value })} placeholder="Advance purpose..." className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
              <button
                onClick={async () => {
                  const target = staff.find((m) => m.id === (advForm.staffId || staff[0]?.id));
                  if (!target) return;
                  await saveEmployeeAdvance({
                    staffId: target.id,
                    staffName: target.name,
                    date: new Date().toISOString().slice(0, 10),
                    type: advForm.type,
                    amount: advForm.amount,
                    monthlyEmi: advForm.monthlyEmi,
                    reason: advForm.reason || 'Salary Advance',
                  });
                  setAdvForm({ ...advForm, reason: '' });
                  notify(`Issued ${formatINR(advForm.amount)} ${advForm.type} to ${target.name} (Auto-recovers via EMI)`);
                }}
                className="w-full py-2 rounded-xl bg-indigo-600 text-white font-semibold"
              >
                + Issue Advance / Staff Loan
              </button>
            </div>
          </div>

          {/* Expense Reimbursements */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-emerald-600" /> Expense Reimbursements
            </h3>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {reimbursements.map((r) => (
                <div key={r.id} className="p-2.5 rounded-xl border flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold">{r.staffName} · {r.category} ({formatINR(r.amount)})</div>
                    <div className="text-[11px] text-slate-500">{r.date} · {r.description}</div>
                  </div>
                  {r.status === 'Pending' ? (
                    <button
                      onClick={async () => {
                        await decideReimbursement(r.id, 'Approved');
                        notify(`Approved ${formatINR(r.amount)} claim — will auto-credit on next payroll`);
                      }}
                      className="px-2 py-1 rounded bg-indigo-600 text-white font-semibold"
                    >
                      Approve
                    </button>
                  ) : (
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${r.status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                      {r.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="pt-2 border-t space-y-2">
              <select value={reimbForm.staffId || staff[0]?.id || ''} onChange={(e) => setReimbForm({ ...reimbForm, staffId: e.target.value })} className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                {staff.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select value={reimbForm.category} onChange={(e) => setReimbForm({ ...reimbForm, category: e.target.value as 'Travel' | 'Food' | 'Fuel' | 'Mobile/Internet' | 'Medical' | 'Other' })} className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                  <option>Travel</option>
                  <option>Food</option>
                  <option>Fuel</option>
                  <option>Mobile/Internet</option>
                  <option>Medical</option>
                  <option>Other</option>
                </select>
                <input type="number" value={reimbForm.amount} onChange={(e) => setReimbForm({ ...reimbForm, amount: Number(e.target.value) })} placeholder="Amount" className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
              </div>
              <input value={reimbForm.description} onChange={(e) => setReimbForm({ ...reimbForm, description: e.target.value })} placeholder="Claim details (bill ref)..." className="w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
              <button
                onClick={async () => {
                  const target = staff.find((m) => m.id === (reimbForm.staffId || staff[0]?.id));
                  if (!target) return;
                  await saveReimbursement({
                    staffId: target.id,
                    staffName: target.name,
                    date: new Date().toISOString().slice(0, 10),
                    category: reimbForm.category,
                    amount: reimbForm.amount,
                    description: reimbForm.description || 'Field expense claim',
                  });
                  setReimbForm({ ...reimbForm, description: '' });
                  notify(`Submitted reimbursement claim for ${target.name}`);
                }}
                className="w-full py-2 rounded-xl bg-indigo-600 text-white font-semibold"
              >
                + Submit Claim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB: STATUTORY ECR, COMMISSIONS, F&F & ANALYTICS */}
      {tab === 'statutory' && (
        <div className="space-y-5 text-xs">
          {/* Statutory EPF / ESIC / PT / TDS Summary + Department Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" /> Statutory Register (EPF ECR, ESIC, PT, TDS)
                </h3>
                <button
                  onClick={exportStatutoryECR}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> ECR Challan PDF
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="py-2">Employee (UAN)</th>
                      <th className="py-2 text-right">Emp PF</th>
                      <th className="py-2 text-right">Er PF</th>
                      <th className="py-2 text-right">ESIC</th>
                      <th className="py-2 text-right">PT</th>
                      <th className="py-2 text-right">TDS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {staff.map((m) => {
                      const b = computeLiveSalaryBreakdown({
                        member: m,
                        month: payMonth,
                        runRecord: monthRuns.find((r) => r.staffId === m.id),
                        advances,
                        reimbursements,
                      });
                      return (
                        <tr key={m.id}>
                          <td className="py-2">
                            <div className="font-bold">{m.name}</div>
                            <div className="font-mono text-[10px] text-slate-500">{m.uan || 'No UAN'}</div>
                          </td>
                          <td className="py-2 text-right font-mono">{formatINR(b.employeePf)}</td>
                          <td className="py-2 text-right font-mono">{formatINR(b.employerPf)}</td>
                          <td className="py-2 text-right font-mono">{formatINR(b.employeeEsic + b.employerEsic)}</td>
                          <td className="py-2 text-right font-mono">{formatINR(b.professionalTax)}</td>
                          <td className="py-2 text-right font-mono">{formatINR(b.tds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-blue-600" /> Department-wise Payroll Cost Analytics
              </h3>
              <div className="space-y-2.5">
                {deptBreakdown.map((d) => {
                  const pct = kpis.estGross > 0 ? Math.round((d.gross / kpis.estGross) * 100) : 0;
                  return (
                    <div key={d.dept} className="p-3 rounded-xl border space-y-1.5">
                      <div className="flex justify-between font-bold">
                        <span>{d.dept} ({d.headcount} Staff)</span>
                        <span className="font-mono">{formatINR(d.gross)} ({pct}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[11px] text-slate-500 flex justify-between">
                        <span>Total PF Pool: {formatINR(d.epf)}</span>
                        <span>Net Payout: {formatINR(d.net)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sales Commissions + Full & Final Settlement Calculator */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Percent className="w-4 h-4 text-indigo-600" /> Sales Rep Commission Rules &amp; Earnings
              </h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {commissionSummary.map((c) => (
                  <div key={c.staff.id} className="p-2.5 rounded-xl border flex justify-between items-center">
                    <div>
                      <div className="font-bold">{c.staff.name} ({c.ratePct}% on Revenue)</div>
                      <div className="text-[11px] text-slate-500">{c.invoicesCount} Invoice(s) · Sales: {formatINR(c.salesTotal)}</div>
                    </div>
                    <div className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {formatINR(c.earned)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-2 border-t">
                <select value={commStaffId} onChange={(e) => setCommStaffId(e.target.value)} className="flex-1 px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                  <option value="">Select Employee</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="number" step="0.5" value={commRate} onChange={(e) => setCommRate(Number(e.target.value))} className="w-20 px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
                <button
                  onClick={async () => {
                    const st = staff.find((s) => s.id === commStaffId) || staff[0];
                    if (!st) return;
                    await saveCommissionRule({
                      staffId: st.id,
                      staffName: st.name,
                      basis: 'Revenue',
                      ratePct: commRate,
                      monthlyTarget: 150000,
                      bonusOnTarget: 4000,
                    });
                    notify(`Updated commission rule: ${commRate}% for ${st.name}`);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold"
                >
                  Save Rule
                </button>
              </div>
            </div>

            {/* Full & Final Settlement Calculator */}
            {fnfMember && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-slate-700 dark:text-slate-300" /> Full &amp; Final (F&amp;F) Exit Settlement Calculator
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <select value={fnfMember.id} onChange={(e) => setFnfStaffId(e.target.value)} className="col-span-2 px-2.5 py-1.5 border rounded-lg bg-white dark:bg-slate-800">
                    {staff.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.empCode})</option>)}
                  </select>
                  <input type="date" value={fnfLastDay} onChange={(e) => setFnfLastDay(e.target.value)} className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
                  <input type="number" min={0} max={31} value={fnfWorkedDays} onChange={(e) => setFnfWorkedDays(Number(e.target.value))} placeholder="Worked days" className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-800" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Completed Years of Service (for Gratuity ≥ 5 yrs):</span>
                  <input type="number" min={0} value={fnfYearsService} onChange={(e) => setFnfYearsService(Number(e.target.value))} className="w-20 px-2 py-1 border rounded bg-white dark:bg-slate-800" />
                </div>
                {(() => {
                  const proRataSalary = Math.round((fnfMember.monthlySalary / 26) * fnfWorkedDays);
                  const elDays = fnfMember.elBalance ?? 12;
                  const leaveEncashment = Math.round(((fnfMember.monthlySalary * 0.5) / 26) * elDays);
                  const gratuity = fnfYearsService >= 5 ? Math.round(((fnfMember.monthlySalary * 0.5) * 15 * fnfYearsService) / 26) : 0;
                  const advPending = advances
                    .filter((a) => a.staffId === fnfMember.id && a.status === 'Active')
                    .reduce((s, a) => s + Math.max(0, a.amount - a.recoveredAmount), 0);
                  const netFnf = Math.max(0, proRataSalary + leaveEncashment + gratuity - advPending);
                  return (
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border space-y-1.5">
                      <div className="flex justify-between"><span>Pro-Rata Salary ({fnfWorkedDays}/26 days)</span><span className="font-mono font-semibold">{formatINR(proRataSalary)}</span></div>
                      <div className="flex justify-between"><span>Earned Leave Encashment ({elDays} EL days)</span><span className="font-mono font-semibold">{formatINR(leaveEncashment)}</span></div>
                      <div className="flex justify-between"><span>Statutory Gratuity ({fnfYearsService} yrs)</span><span className="font-mono font-semibold">{formatINR(gratuity)}</span></div>
                      <div className="flex justify-between text-amber-700 dark:text-amber-400"><span>Less: Unrecovered Advance Balance</span><span className="font-mono font-semibold">-{formatINR(advPending)}</span></div>
                      <div className="flex justify-between pt-2 border-t font-bold text-sm text-indigo-700 dark:text-indigo-400">
                        <span>Net Full &amp; Final Payable (Exit: {fnfLastDay})</span>
                        <span className="font-mono">{formatINR(netFnf)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Authentic Corporate Payslip Modal */}
      {payslipPreview && (
        <PayslipModal
          member={payslipPreview.member}
          month={payslipPreview.month}
          runRecord={payslipPreview.runRecord}
          overrides={payslipPreview.overrides}
          onClose={() => setPayslipPreview(null)}
        />
      )}
    </div>
  );
};
