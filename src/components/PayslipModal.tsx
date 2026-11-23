import React, { useMemo } from 'react';
import { Download, Printer, ShieldCheck, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { PayrollRunRecord, StaffMember } from '../types/accounting';
import { formatINR, numberToIndianWords } from '../utils/formatters';
import { computeLiveSalaryBreakdown } from '../utils/payrollCalc';
import { downloadSalarySlipPDF } from '../utils/pdfGenerator';

interface PayslipModalProps {
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
  onClose: () => void;
}

export const PayslipModal: React.FC<PayslipModalProps> = ({
  member,
  month,
  runRecord,
  overrides,
  onClose,
}) => {
  const { db } = useStore();

  const b = useMemo(
    () =>
      computeLiveSalaryBreakdown({
        member,
        month,
        runRecord,
        advances: db?.employeeAdvances || [],
        reimbursements: db?.reimbursements || [],
        overrides,
      }),
    [member, month, runRecord, db?.employeeAdvances, db?.reimbursements, overrides]
  );

  // Compute YTD across processed payroll runs for this employee
  const ytd = useMemo(() => {
    const runs = (db?.payrollRuns || []).filter((r) => r.staffId === member.id);
    if (runs.length === 0) {
      return { gross: b.grossEarnings, pf: b.employeePf, tds: b.tds, net: b.netPay, months: 1 };
    }
    return {
      gross: runs.reduce((s, r) => s + r.grossEarnings, 0),
      pf: runs.reduce((s, r) => s + r.employeePf, 0),
      tds: runs.reduce((s, r) => s + r.tds, 0),
      net: runs.reduce((s, r) => s + r.netPay, 0),
      months: runs.length,
    };
  }, [db?.payrollRuns, member.id, b]);

  if (!db) return null;
  const profile = db.profile;

  const earningsList: { label: string; amount: number }[] = [
    { label: 'Basic Salary', amount: b.basic },
    { label: 'House Rent Allowance (HRA)', amount: b.hra },
    { label: 'Conveyance Allowance', amount: b.conveyance },
    { label: 'Special & Fixed Allowance', amount: b.specialAllowance },
  ];
  if (b.overtimePay > 0) earningsList.push({ label: 'Overtime Pay', amount: b.overtimePay });
  if (b.bonus > 0) earningsList.push({ label: 'Performance Bonus / Incentive', amount: b.bonus });
  if (b.commission > 0) earningsList.push({ label: 'Sales Commission Payout', amount: b.commission });
  if (b.arrears > 0) earningsList.push({ label: 'Salary Arrears', amount: b.arrears });
  if (b.reimbursement > 0) earningsList.push({ label: 'Expense Reimbursements', amount: b.reimbursement });

  const deductionsList: { label: string; amount: number }[] = [
    { label: 'Employees Provident Fund (EPF 12%)', amount: b.employeePf },
    { label: 'ESIC Employee Share (0.75%)', amount: b.employeeEsic },
    { label: 'Professional Tax (State PT)', amount: b.professionalTax },
    { label: 'TDS / Income Tax Withheld', amount: b.tds },
  ];
  if (b.advanceRecovery > 0) deductionsList.push({ label: 'Advance / Staff Loan EMI Recovery', amount: b.advanceRecovery });
  if (b.otherDeductions > 0) deductionsList.push({ label: 'Other Deductions / LOP Adj.', amount: b.otherDeductions });

  const maxRows = Math.max(earningsList.length, deductionsList.length);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-start justify-center p-3 md:p-6 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-4xl w-full overflow-hidden">
        {/* Modal Action Header */}
        <div className="no-print px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              Official Salary Payslip — {member.name} ({b.monthLabel})
            </div>
            <div className="text-[11px] text-slate-400">
              {runRecord ? `Disbursed Document #${b.payslipNo}` : 'Live Preview — Process payroll to lock & post journal'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadSalarySlipPDF(member, b.month, profile, runRecord)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              Download Payslip PDF
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800"
              aria-label="Close payslip modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Corporate A4 Payslip Sheet */}
        <div className="p-6 md:p-8 bg-white text-slate-900 text-xs space-y-5 print:p-4">
          {/* 1. Corporate HR Letterhead */}
          <div className="border-2 border-slate-900 p-4 flex flex-wrap items-start justify-between gap-4 bg-slate-50">
            <div className="flex items-start gap-3">
              {profile.logoDataUrl && (
                <img
                  src={profile.logoDataUrl}
                  alt={profile.companyName}
                  className="w-14 h-14 object-contain border border-slate-300 bg-white p-1"
                />
              )}
              <div className="space-y-0.5">
                <div className="text-lg font-extrabold tracking-tight text-slate-900">
                  {profile.companyName}
                </div>
                <div className="text-[11px] text-slate-600 max-w-md">{profile.address}</div>
                <div className="text-[11px] text-slate-600 font-medium">
                  Employer PAN: <span className="font-mono text-slate-900">{profile.pan || 'AAACS4921M'}</span> · HR Desk: {profile.phone} · {profile.email}
                </div>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="inline-block bg-slate-900 text-white px-3 py-1 font-bold tracking-wider text-[11px]">
                CONFIDENTIAL SALARY PAYSLIP
              </div>
              <div className="text-sm font-bold text-slate-900 pt-1">{b.monthLabel.toUpperCase()}</div>
              <div className="text-[11px] text-slate-600 font-mono">
                Payslip No: {b.payslipNo}
              </div>
              <div className="text-[11px] text-slate-600">
                Pay Date: <strong className="text-slate-900">{b.payDate}</strong>
              </div>
            </div>
          </div>

          {/* 2. Employee Particulars + Statutory + Bank + Attendance Grid */}
          <div className="border border-slate-300 overflow-hidden">
            <div className="grid grid-cols-2 bg-slate-100 border-b border-slate-300 font-bold text-[11px] text-slate-800 uppercase tracking-wide">
              <div className="px-3 py-1.5 border-r border-slate-300">Employee &amp; Employment Profile</div>
              <div className="px-3 py-1.5">Bank, Statutory &amp; Attendance Details</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-300">
              <div className="divide-y divide-slate-200">
                {[
                  ['Employee Name', member.name],
                  ['Employee Code', member.empCode || 'EMP-101'],
                  ['Designation', member.designation || member.role],
                  ['Department', member.department || 'Operations'],
                  ['Date of Joining', member.joiningDate || '2025-04-01'],
                  ['Employment Type', member.employmentType || 'Full-Time'],
                  ['Income Tax Regime', `${member.taxRegime || 'New'} Regime (${member.ptState || 'Maharashtra'})`],
                  ['Leave Balances (CL / SL / EL)', `${member.clBalance ?? 6} CL  |  ${member.slBalance ?? 6} SL  |  ${member.elBalance ?? 12} EL`],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-5 px-3 py-1.5">
                    <span className="col-span-2 text-slate-500 font-medium">{k}</span>
                    <span className="col-span-3 font-semibold text-slate-900">{v}</span>
                  </div>
                ))}
              </div>
              <div className="divide-y divide-slate-200">
                {[
                  ['PAN Number', member.pan || 'PENDING'],
                  ['EPF UAN Number', member.uan || 'Not Linked'],
                  ['ESIC Insurance No.', member.esicNo || 'Not Applicable'],
                  ['Bank Name', member.bankName || 'HDFC Bank Ltd'],
                  ['Bank Account No.', member.bankAccountNo ? `${member.bankAccountNo}` : 'Direct / Cash'],
                  ['IFSC Code', member.ifsc || '-'],
                  ['Payment Mode', member.paymentMode || 'Bank Transfer'],
                  ['Paid / LOP / Working Days', `${b.paidDays} Paid  /  ${b.lopDays} LOP  /  ${b.workingDays} Working Days`],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-5 px-3 py-1.5">
                    <span className="col-span-2 text-slate-500 font-medium">{k}</span>
                    <span className="col-span-3 font-semibold font-mono text-slate-900">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Side-by-Side Earnings & Deductions Comparison */}
          <div className="border border-slate-300 overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wide">
                  <th className="text-left px-3 py-2 border-r border-slate-700 w-[34%]">Earnings Head</th>
                  <th className="text-right px-3 py-2 border-r border-slate-700 w-[16%]">Amount (₹)</th>
                  <th className="text-left px-3 py-2 border-r border-slate-700 w-[34%]">Deductions &amp; Recoveries</th>
                  <th className="text-right px-3 py-2 w-[16%]">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {Array.from({ length: maxRows }).map((_, idx) => {
                  const earn = earningsList[idx];
                  const ded = deductionsList[idx];
                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2 border-r border-slate-200 text-slate-800">{earn ? earn.label : ''}</td>
                      <td className="px-3 py-2 border-r border-slate-300 text-right font-mono font-semibold text-slate-900">
                        {earn ? formatINR(earn.amount) : ''}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-200 text-slate-800">{ded ? ded.label : ''}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                        {ded ? formatINR(ded.amount) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-400 font-bold text-slate-900">
                  <td className="px-3 py-2.5 border-r border-slate-300">TOTAL GROSS EARNINGS (A)</td>
                  <td className="px-3 py-2.5 border-r border-slate-300 text-right font-mono text-sm">
                    {formatINR(b.grossEarnings)}
                  </td>
                  <td className="px-3 py-2.5 border-r border-slate-300">TOTAL DEDUCTIONS (B)</td>
                  <td className="px-3 py-2.5 text-right font-mono text-sm">
                    {formatINR(b.totalDeductions)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 4. Net Take-Home Pay Highlight Banner */}
          <div className="border-2 border-blue-800 bg-blue-50/70 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-blue-900">
                Net Take-Home Salary Credited (A - B)
              </div>
              <div className="text-xs font-medium text-slate-700">
                Amount in Words: <strong className="text-slate-900">{numberToIndianWords(b.netPay)}</strong>
              </div>
            </div>
            <div className="text-2xl font-extrabold font-mono text-blue-900">
              {formatINR(b.netPay)}
            </div>
          </div>

          {/* 5. Employer Share + YTD Summary Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-300">
              <div className="bg-slate-100 px-3 py-1.5 border-b border-slate-300 font-bold text-[11px] text-slate-700 uppercase">
                Employer Statutory Share &amp; Monthly CTC
              </div>
              <div className="divide-y divide-slate-200">
                <div className="flex justify-between px-3 py-1.5">
                  <span className="text-slate-600">Employer EPF Contribution (12%)</span>
                  <span className="font-mono font-semibold">{formatINR(b.employerPf)}</span>
                </div>
                <div className="flex justify-between px-3 py-1.5">
                  <span className="text-slate-600">Employer ESIC Contribution (3.25%)</span>
                  <span className="font-mono font-semibold">{formatINR(b.employerEsic)}</span>
                </div>
                <div className="flex justify-between px-3 py-2 bg-slate-50 font-bold">
                  <span>Monthly Cost to Company (CTC)</span>
                  <span className="font-mono">{formatINR(b.monthlyCtc)}</span>
                </div>
              </div>
            </div>

            <div className="border border-slate-300">
              <div className="bg-slate-100 px-3 py-1.5 border-b border-slate-300 font-bold text-[11px] text-slate-700 uppercase">
                FY {profile.financialYear} Cumulative YTD Summary ({ytd.months} Payslip{ytd.months > 1 ? 's' : ''})
              </div>
              <div className="divide-y divide-slate-200">
                <div className="flex justify-between px-3 py-1.5">
                  <span className="text-slate-600">YTD Gross Earnings</span>
                  <span className="font-mono font-semibold">{formatINR(ytd.gross)}</span>
                </div>
                <div className="flex justify-between px-3 py-1.5">
                  <span className="text-slate-600">YTD EPF &amp; TDS Deducted</span>
                  <span className="font-mono font-semibold">{formatINR(ytd.pf)} / {formatINR(ytd.tds)}</span>
                </div>
                <div className="flex justify-between px-3 py-2 bg-slate-50 font-bold">
                  <span>YTD Total Net Credited</span>
                  <span className="font-mono">{formatINR(ytd.net)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 6. Signatory & Verification Footer */}
          <div className="pt-4 border-t border-slate-300 flex flex-wrap items-end justify-between gap-4 text-[11px] text-slate-500">
            <div className="space-y-0.5 max-w-md">
              <div className="font-semibold text-slate-700">HR Verification &amp; Confidentiality Notice</div>
              <div>
                This is a computer-generated official salary statement issued by {profile.companyName} HR &amp; Payroll.
                Any discrepancy should be reported within 7 working days of salary disbursement.
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-slate-900">For {profile.companyName}</div>
              <div className="mt-5 pt-1 border-t border-slate-400 font-semibold text-slate-700">
                Authorized HR / Payroll Signatory
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
