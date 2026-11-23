import { EmployeeAdvance, PayrollRunRecord, ReimbursementClaim, StaffMember } from '../types/accounting';

export interface SalaryBreakdown {
  payslipNo: string;
  month: string;
  monthLabel: string;
  payDate: string;
  workingDays: number;
  paidDays: number;
  lopDays: number;
  basic: number;
  hra: number;
  conveyance: number;
  specialAllowance: number;
  overtimePay: number;
  bonus: number;
  commission: number;
  arrears: number;
  reimbursement: number;
  grossEarnings: number;
  employeePf: number;
  employeeEsic: number;
  professionalTax: number;
  tds: number;
  advanceRecovery: number;
  otherDeductions: number;
  totalDeductions: number;
  employerPf: number;
  employerEsic: number;
  monthlyCtc: number;
  netPay: number;
}

export function formatPayrollMonth(yyyyMm: string): string {
  if (!yyyyMm || !/^\d{4}-\d{2}/.test(yyyyMm)) return yyyyMm || 'Current Month';
  const [y, m] = yyyyMm.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const idx = Math.max(0, Math.min(11, Number(m) - 1));
  return `${names[idx]} ${y}`;
}

export function computeLiveSalaryBreakdown(params: {
  member: StaffMember;
  month: string;
  runRecord?: PayrollRunRecord;
  advances?: EmployeeAdvance[];
  reimbursements?: ReimbursementClaim[];
  overrides?: {
    attendanceDays?: number;
    overtimeHours?: number;
    bonusAmt?: number;
    arrearsAmt?: number;
    otherDeductions?: number;
    commissionAmt?: number;
  };
}): SalaryBreakdown {
  const { member, month, runRecord, advances = [], reimbursements = [], overrides } = params;

  if (runRecord) {
    return {
      payslipNo: runRecord.payslipNo,
      month: runRecord.month,
      monthLabel: formatPayrollMonth(runRecord.month),
      payDate: runRecord.payDate,
      workingDays: runRecord.workingDays || 26,
      paidDays: runRecord.paidDays,
      lopDays: runRecord.lopDays,
      basic: runRecord.basic,
      hra: runRecord.hra,
      conveyance: runRecord.conveyance,
      specialAllowance: runRecord.specialAllowance,
      overtimePay: runRecord.overtimePay,
      bonus: runRecord.bonus,
      commission: runRecord.commission,
      arrears: runRecord.arrears,
      reimbursement: runRecord.reimbursement,
      grossEarnings: runRecord.grossEarnings,
      employeePf: runRecord.employeePf,
      employeeEsic: runRecord.employeeEsic,
      professionalTax: runRecord.professionalTax,
      tds: runRecord.tds,
      advanceRecovery: runRecord.advanceRecovery,
      otherDeductions: runRecord.otherDeductions,
      totalDeductions: runRecord.totalDeductions,
      employerPf: runRecord.employerPf,
      employerEsic: runRecord.employerEsic,
      monthlyCtc: runRecord.grossEarnings + runRecord.employerPf + runRecord.employerEsic,
      netPay: runRecord.netPay,
    };
  }

  const workingDays = 26;
  const paidDays = Math.max(0, Math.min(31, Number(overrides?.attendanceDays ?? member.attendanceDays ?? 26)));
  const lopDays = Math.max(0, workingDays - paidDays);
  const ratio = Math.min(1, paidDays / workingDays);

  const ctcMonthly = Number(member.monthlySalary || 0);
  const baseFull = Math.round(ctcMonthly * 0.5);
  const hraFull = Math.round((ctcMonthly * Number(member.hraPct ?? 20)) / 100);
  const convFull = Number(member.conveyanceAmt ?? 1600);
  const specFull = Math.max(0, ctcMonthly - baseFull - hraFull - convFull) + Number(member.allowanceAmt ?? 0);

  const basic = Math.round(baseFull * ratio);
  const hra = Math.round(hraFull * ratio);
  const conveyance = Math.round(convFull * ratio);
  const specialAllowance = Math.round(specFull * ratio);
  const otHrs = Number(overrides?.overtimeHours ?? member.overtimeHours ?? 0);
  const overtimePay = Math.round(otHrs * Number(member.overtimeRate ?? 250));
  const bonus = Math.round(Number(overrides?.bonusAmt ?? member.bonusAmt ?? 0));
  const arrears = Math.round(Number(overrides?.arrearsAmt ?? member.arrearsAmt ?? 0));
  const commission = Math.round(Number(overrides?.commissionAmt ?? 0));
  const reimbursement = Math.round(
    reimbursements
      .filter((r) => r.staffId === member.id && r.status === 'Approved')
      .reduce((s, r) => s + Number(r.amount || 0), 0)
  );

  const grossEarnings = basic + hra + conveyance + specialAllowance + overtimePay + bonus + arrears + commission + reimbursement;

  const includePf = member.includePf !== false;
  const includeEsic = Boolean(member.includeEsic) || (grossEarnings > 0 && grossEarnings <= 21000);
  const employeePf = includePf ? Math.min(1800, Math.round(basic * 0.12)) : 0;
  const employerPf = employeePf;
  const employeeEsic = includeEsic ? Math.ceil(grossEarnings * 0.0075) : 0;
  const employerEsic = includeEsic ? Math.ceil(grossEarnings * 0.0325) : 0;
  const professionalTax = grossEarnings >= 10000 ? Number(member.ptDeduction ?? 200) : 0;
  const tds = Number(member.tdsDeduction ?? 0);
  const otherDeductions = Math.round(Number(overrides?.otherDeductions ?? 0));

  const activeAdv = advances.find((a) => a.staffId === member.id && a.status === 'Active');
  const advanceRecovery = activeAdv
    ? Math.min(Math.max(0, activeAdv.amount - activeAdv.recoveredAmount), activeAdv.monthlyEmi || activeAdv.amount)
    : 0;

  const totalDeductions = employeePf + employeeEsic + professionalTax + tds + advanceRecovery + otherDeductions;
  const netPay = Math.max(0, grossEarnings - totalDeductions);

  return {
    payslipNo: `PAY-${month.replace('-', '').slice(2)}-PREVIEW`,
    month,
    monthLabel: formatPayrollMonth(month),
    payDate: new Date().toISOString().slice(0, 10),
    workingDays,
    paidDays,
    lopDays,
    basic,
    hra,
    conveyance,
    specialAllowance,
    overtimePay,
    bonus,
    commission,
    arrears,
    reimbursement,
    grossEarnings,
    employeePf,
    employeeEsic,
    professionalTax,
    tds,
    advanceRecovery,
    otherDeductions,
    totalDeductions,
    employerPf,
    employerEsic,
    monthlyCtc: grossEarnings + employerPf + employerEsic,
    netPay,
  };
}

export function estimateMonthlyTDS(annualGross: number, regime: 'New' | 'Old' = 'New'): number {
  const stdDed = regime === 'New' ? 75000 : 50000;
  const taxable = Math.max(0, annualGross - stdDed);
  let tax = 0;
  if (regime === 'New') {
    if (taxable <= 700000) return 0; // Sec 87A rebate
    if (taxable > 400000) tax += Math.min(400000, taxable - 400000) * 0.05;
    if (taxable > 800000) tax += Math.min(400000, taxable - 800000) * 0.10;
    if (taxable > 1200000) tax += Math.min(400000, taxable - 1200000) * 0.15;
    if (taxable > 1600000) tax += Math.min(400000, taxable - 1600000) * 0.20;
    if (taxable > 2000000) tax += Math.min(400000, taxable - 2000000) * 0.25;
    if (taxable > 2400000) tax += (taxable - 2400000) * 0.30;
  } else {
    if (taxable <= 500000) return 0;
    if (taxable > 250000) tax += Math.min(250000, taxable - 250000) * 0.05;
    if (taxable > 500000) tax += Math.min(500000, taxable - 500000) * 0.20;
    if (taxable > 1000000) tax += (taxable - 1000000) * 0.30;
  }
  const withCess = tax * 1.04;
  return Math.round(withCess / 12);
}
