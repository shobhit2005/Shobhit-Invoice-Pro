import React, { useMemo, useState } from 'react';
import { Plus, Download, Printer, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { exportToCSV, formatINR, VOUCHER_LABELS } from '../utils/formatters';
import { downloadReportPDF, formatPdfAmount } from '../utils/pdfGenerator';
import { LedgerAccount, Voucher, VoucherType } from '../types/accounting';

interface AccountingViewProps {
  onNewVoucher: (type: VoucherType) => void;
  onPrintVoucher: (v: Voucher) => void;
}

type AccTab =
  | 'daybook'
  | 'journal_register'
  | 'general_ledger'
  | 'chart_accounts'
  | 'brs'
  | 'trial_balance'
  | 'pnl'
  | 'balance_sheet';

export const AccountingView: React.FC<AccountingViewProps> = ({
  onNewVoucher,
  onPrintVoucher,
}) => {
  const {
    db,
    getPartyBalance,
    getTotalBankBalance,
    getTotalCashBalance,
    getTotalStockValue,
    reconcileVoucher,
    saveLedgerAccount,
  } = useStore();

  const [tab, setTab] = useState<AccTab>('daybook');
  const [dayTypeFilter, setDayTypeFilter] = useState<string>('all');
  const [selectedLedger, setSelectedLedger] = useState<string>('Sales Account');

  // Create custom ledger form
  const [newLedgerName, setNewLedgerName] = useState('');
  const [newLedgerGroup, setNewLedgerGroup] = useState('Indirect Expenses');
  const [newLedgerNature, setNewLedgerNature] = useState<LedgerAccount['nature']>('Expenses');

  const dayBookRows = useMemo(() => {
    return (db?.vouchers || [])
      .filter((v) => v.status !== 'cancelled')
      .filter((v) => (dayTypeFilter === 'all' ? true : v.type === dayTypeFilter))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db?.vouchers, dayTypeFilter]);

  const allLedgerNames = useMemo(() => {
    const set = new Set<string>((db?.ledgers || []).map((l) => l.name));
    for (const je of db?.journalEntries || []) {
      for (const l of je.lines) set.add(l.accountName);
    }
    return Array.from(set).sort();
  }, [db?.ledgers, db?.journalEntries]);

  const generalLedgerLines = useMemo(() => {
    const rows: {
      date: string;
      voucherNo: string;
      voucherType: VoucherType;
      narration: string;
      debit: number;
      credit: number;
      running: number;
    }[] = [];
    const sorted = [...(db?.journalEntries || [])].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    for (const je of sorted) {
      for (const l of je.lines) {
        if (l.accountName !== selectedLedger) continue;
        running = Number((running + l.debit - l.credit).toFixed(2));
        rows.push({
          date: je.date,
          voucherNo: je.voucherNo,
          voucherType: je.voucherType,
          narration: l.narration || je.narration,
          debit: l.debit,
          credit: l.credit,
          running,
        });
      }
    }
    return rows;
  }, [db?.journalEntries, selectedLedger]);

  const bankVouchersForBrs = useMemo(() => {
    return (db?.vouchers || []).filter(
      (v) =>
        v.status !== 'cancelled' &&
        v.paymentMode &&
        v.paymentMode !== 'Cash' &&
        ['sale_invoice', 'purchase_bill', 'payment_in', 'payment_out', 'expense', 'contra'].includes(v.type)
    );
  }, [db?.vouchers]);

  const financials = useMemo(() => {
    const active = (db?.vouchers || []).filter((v) => v.status !== 'cancelled');
    const grossSales = active.filter((v) => v.type === 'sale_invoice').reduce((s, v) => s + v.subTotal, 0);
    const creditNotes = active.filter((v) => v.type === 'credit_note').reduce((s, v) => s + v.subTotal, 0);
    const netSales = grossSales - creditNotes;

    const grossPurchases = active.filter((v) => v.type === 'purchase_bill').reduce((s, v) => s + v.subTotal, 0);
    const debitNotes = active.filter((v) => v.type === 'debit_note').reduce((s, v) => s + v.subTotal, 0);
    const netPurchases = grossPurchases - debitNotes;

    let cogs = 0;
    for (const v of active) {
      if (v.type !== 'sale_invoice') continue;
      for (const l of v.lines) {
        const item = (db?.items || []).find((i) => i.id === l.itemId);
        if (item) cogs += l.qty * item.purchasePrice;
      }
    }

    const expensesByHead = new Map<string, number>();
    for (const v of active) {
      if (v.type === 'expense') {
        const head = v.expenseCategory || 'Miscellaneous';
        expensesByHead.set(head, (expensesByHead.get(head) || 0) + v.grandTotal);
      }
      if (v.type === 'journal' && v.journalLines) {
        for (const jl of v.journalLines) {
          if (jl.accountGroup.includes('Expense') && jl.debit > 0) {
            expensesByHead.set(jl.accountName, (expensesByHead.get(jl.accountName) || 0) + jl.debit);
          }
        }
      }
    }
    const totalExpenses = Array.from(expensesByHead.values()).reduce((s, n) => s + n, 0);
    const grossProfit = netSales - cogs;
    const netProfit = grossProfit - totalExpenses;

    const outputGst =
      active.filter((v) => v.type === 'sale_invoice').reduce((s, v) => s + v.taxTotal, 0) -
      active.filter((v) => v.type === 'credit_note').reduce((s, v) => s + v.taxTotal, 0);
    const inputGst =
      active.filter((v) => v.type === 'purchase_bill' && !v.isReverseCharge).reduce((s, v) => s + v.taxTotal, 0) -
      active.filter((v) => v.type === 'debit_note').reduce((s, v) => s + v.taxTotal, 0);
    const netGstPayable = outputGst - inputGst;

    let debtors = 0;
    let creditors = 0;
    for (const p of db?.parties || []) {
      const bal = getPartyBalance(p.id);
      if (bal > 0) debtors += bal;
      else if (bal < 0) creditors += Math.abs(bal);
    }

    const cash = getTotalCashBalance();
    const bank = getTotalBankBalance();
    const closingStock = getTotalStockValue();
    const loanLiabilities = (db?.loans || []).reduce(
      (s, ln) => s + Math.max(0, ln.principal - ln.paidEmis * (ln.principal / ln.tenureMonths)),
      0
    );
    const totalAssets = cash + bank + debtors + closingStock;
    const balancingCapital = totalAssets - (creditors + loanLiabilities + netGstPayable + netProfit);

    return {
      grossSales,
      creditNotes,
      netSales,
      netPurchases,
      cogs,
      grossProfit,
      expensesByHead,
      totalExpenses,
      netProfit,
      netGstPayable,
      debtors,
      creditors,
      cash,
      bank,
      closingStock,
      loanLiabilities,
      balancingCapital,
      totalAssets,
    };
  }, [db, getPartyBalance, getTotalBankBalance, getTotalCashBalance, getTotalStockValue]);

  const trialBalanceRows = useMemo(() => {
    const rows = [
      { ledger: 'Cash-in-Hand', group: 'Current Assets', dr: Math.max(0, financials.cash), cr: financials.cash < 0 ? Math.abs(financials.cash) : 0 },
      { ledger: 'Bank Accounts', group: 'Current Assets', dr: Math.max(0, financials.bank), cr: financials.bank < 0 ? Math.abs(financials.bank) : 0 },
      { ledger: 'Sundry Debtors (Receivables)', group: 'Current Assets', dr: financials.debtors, cr: 0 },
      { ledger: 'Closing Inventory Value', group: 'Current Assets', dr: financials.closingStock, cr: 0 },
      { ledger: 'Sundry Creditors (Payables)', group: 'Current Liabilities', dr: 0, cr: financials.creditors },
      { ledger: 'Business Loans', group: 'Loans (Liability)', dr: 0, cr: financials.loanLiabilities },
      {
        ledger: 'GST Duties & Taxes (Net)',
        group: 'Duties & Taxes',
        dr: financials.netGstPayable < 0 ? Math.abs(financials.netGstPayable) : 0,
        cr: financials.netGstPayable >= 0 ? financials.netGstPayable : 0,
      },
      { ledger: 'Sales Account (Net)', group: 'Sales Accounts', dr: 0, cr: financials.netSales },
      { ledger: 'Cost of Goods Sold', group: 'Direct Expenses', dr: financials.cogs, cr: 0 },
      { ledger: 'Indirect Expenses', group: 'Indirect Expenses', dr: financials.totalExpenses, cr: 0 },
    ];
    const sumDr = rows.reduce((s, r) => s + r.dr, 0);
    const sumCr = rows.reduce((s, r) => s + r.cr, 0);
    const diff = sumDr - sumCr;
    rows.push({
      ledger: 'Capital & Opening Reserves',
      group: 'Capital Account',
      dr: diff < 0 ? Math.abs(diff) : 0,
      cr: diff >= 0 ? diff : 0,
    });
    return rows;
  }, [financials]);

  if (!db) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Double-Entry Accounting Suite
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Day Book, Auto-Posted Journal Register, General Ledger, Chart of Accounts, Bank Reconciliation, Trial Balance, P&L & Balance Sheet
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNewVoucher('journal')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            New Journal (F7)
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Statement
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        {[
          { id: 'daybook', label: 'Day Book' },
          { id: 'journal_register', label: `Journal Register (${db.journalEntries.length})` },
          { id: 'general_ledger', label: 'General Ledger' },
          { id: 'chart_accounts', label: 'Chart of Accounts' },
          { id: 'brs', label: 'Bank Reconciliation' },
          { id: 'trial_balance', label: 'Trial Balance' },
          { id: 'pnl', label: 'Profit & Loss' },
          { id: 'balance_sheet', label: 'Balance Sheet' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as AccTab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap ${
              tab === t.id
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'daybook' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              value={dayTypeFilter}
              onChange={(e) => setDayTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="all">All Active Vouchers ({dayBookRows.length})</option>
              {(Object.keys(VOUCHER_LABELS) as VoucherType[]).map((vt) => (
                <option key={vt} value={vt}>
                  {VOUCHER_LABELS[vt]}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                exportToCSV(
                  'daybook.csv',
                  ['Date', 'Voucher No', 'Type', 'Particular', 'Amount'],
                  dayBookRows.map((v) => [
                    v.date,
                    v.voucherNo,
                    VOUCHER_LABELS[v.type],
                    v.partyName || v.expenseCategory || v.notes || 'Ledger',
                    v.grandTotal,
                  ])
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <Download className="w-3.5 h-3.5" /> Excel / CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Voucher #</th>
                  <th className="py-2 text-left">Type</th>
                  <th className="py-2 text-left">Particulars</th>
                  <th className="py-2 text-right">Amount (₹)</th>
                  <th className="py-2 text-right">Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {dayBookRows.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 font-mono text-slate-500">{v.date}</td>
                    <td className="py-2.5 font-mono font-semibold">{v.voucherNo}</td>
                    <td className="py-2.5">{VOUCHER_LABELS[v.type]}</td>
                    <td className="py-2.5">{v.partyName || v.expenseCategory || v.notes || 'Transfer'}</td>
                    <td className="py-2.5 text-right font-mono font-semibold">{formatINR(v.grandTotal)}</td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => onPrintVoucher(v)} className="p-1 text-slate-500 hover:text-indigo-600">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'journal_register' && (
        <div className="space-y-4">
          {db.journalEntries.map((je) => (
            <div
              key={je.id}
              className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between text-xs">
                <div className="font-mono font-bold text-slate-900 dark:text-white">
                  {je.date} · {je.voucherNo} · {VOUCHER_LABELS[je.voucherType]}
                </div>
                <div className="text-slate-500">{je.narration}</div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-1.5 text-left">Ledger Account</th>
                    <th className="py-1.5 text-left">Group</th>
                    <th className="py-1.5 text-right">Debit (₹)</th>
                    <th className="py-1.5 text-right">Credit (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {je.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1.5 font-medium">{l.accountName}</td>
                      <td className="py-1.5 text-slate-500">{l.accountGroup}</td>
                      <td className="py-1.5 text-right font-mono">{l.debit > 0 ? formatINR(l.debit) : '-'}</td>
                      <td className="py-1.5 text-right font-mono">{l.credit > 0 ? formatINR(l.credit) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'general_ledger' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold">Select Ledger Account:</span>
              <select
                value={selectedLedger}
                onChange={(e) => setSelectedLedger(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                {allLedgerNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  downloadReportPDF({
                    title: `General Ledger — ${selectedLedger}`,
                    subtitle: `FY ${db.profile.financialYear} | Entries: ${generalLedgerLines.length}`,
                    companyName: db.profile.companyName,
                    headers: ['Date', 'Voucher #', 'Narration', 'Debit', 'Credit', 'Balance'],
                    rows: generalLedgerLines.map((r) => [
                      r.date,
                      r.voucherNo,
                      r.narration,
                      r.debit > 0 ? formatPdfAmount(r.debit) : '-',
                      r.credit > 0 ? formatPdfAmount(r.credit) : '-',
                      `${formatPdfAmount(Math.abs(r.running))} ${r.running >= 0 ? 'Dr' : 'Cr'}`,
                    ]),
                    filename: `General_Ledger_${selectedLedger.replace(/\s+/g, '_')}.pdf`,
                  })
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              <button
                onClick={() =>
                  exportToCSV(
                    `ledger_${selectedLedger}.csv`,
                    ['Date', 'Voucher', 'Narration', 'Debit', 'Credit', 'Balance'],
                    generalLedgerLines.map((r) => [r.date, r.voucherNo, r.narration, r.debit, r.credit, r.running])
                  )
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-left">Voucher #</th>
                <th className="py-2 text-left">Narration</th>
                <th className="py-2 text-right">Debit (₹)</th>
                <th className="py-2 text-right">Credit (₹)</th>
                <th className="py-2 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {generalLedgerLines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No postings recorded for {selectedLedger} yet.
                  </td>
                </tr>
              ) : (
                generalLedgerLines.map((r, i) => (
                  <tr key={`${r.voucherNo}_${i}`}>
                    <td className="py-2 font-mono text-slate-500">{r.date}</td>
                    <td className="py-2 font-mono font-medium">{r.voucherNo}</td>
                    <td className="py-2">{r.narration}</td>
                    <td className="py-2 text-right font-mono">{r.debit > 0 ? formatINR(r.debit) : '-'}</td>
                    <td className="py-2 text-right font-mono">{r.credit > 0 ? formatINR(r.credit) : '-'}</td>
                    <td className="py-2 text-right font-mono font-semibold">
                      {formatINR(Math.abs(r.running))} {r.running >= 0 ? 'Dr' : 'Cr'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'chart_accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
            <h3 className="text-sm font-semibold">Create Custom Ledger Account</h3>
            <input
              type="text"
              placeholder="Ledger Name (e.g. HDFC Loan Interest)"
              value={newLedgerName}
              onChange={(e) => setNewLedgerName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <input
              type="text"
              placeholder="Account Group (e.g. Indirect Expenses)"
              value={newLedgerGroup}
              onChange={(e) => setNewLedgerGroup(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <select
              value={newLedgerNature}
              onChange={(e) => setNewLedgerNature(e.target.value as LedgerAccount['nature'])}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="Assets">Assets</option>
              <option value="Liabilities">Liabilities</option>
              <option value="Income">Income</option>
              <option value="Expenses">Expenses</option>
              <option value="Equity">Equity / Capital</option>
            </select>
            <button
              onClick={async () => {
                if (!newLedgerName.trim()) return;
                await saveLedgerAccount({
                  name: newLedgerName.trim(),
                  groupName: newLedgerGroup.trim(),
                  nature: newLedgerNature,
                  openingBalance: 0,
                  openingType: newLedgerNature === 'Assets' || newLedgerNature === 'Expenses' ? 'Dr' : 'Cr',
                });
                setNewLedgerName('');
              }}
              className="w-full py-2 font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Add Ledger Account
            </button>
          </div>

          <div className="lg:col-span-8 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold mb-3">Chart of Accounts ({db.ledgers.length} Ledgers)</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 text-left">Ledger Name</th>
                  <th className="py-2 text-left">Group</th>
                  <th className="py-2 text-left">Nature</th>
                  <th className="py-2 text-right">Drill-down</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {db.ledgers.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 font-medium">{l.name}</td>
                    <td className="py-2 text-slate-500">{l.groupName}</td>
                    <td className="py-2">{l.nature}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => {
                          setSelectedLedger(l.name);
                          setTab('general_ledger');
                        }}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        View Ledger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'brs' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Bank Reconciliation Statement (BRS)</h2>
              <p className="text-xs text-slate-500">
                Match bank/UPI/cheque vouchers against your actual bank statement
              </p>
            </div>
            <div className="text-xs font-mono space-x-4">
              <span>
                Reconciled: <strong>{bankVouchersForBrs.filter((v) => v.reconciled).length}</strong>
              </span>
              <span className="text-amber-700 dark:text-amber-400">
                Unreconciled: <strong>{bankVouchersForBrs.filter((v) => !v.reconciled).length}</strong>
              </span>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-left">Voucher #</th>
                <th className="py-2 text-left">Party / Particular</th>
                <th className="py-2 text-left">Mode</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Bank Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {bankVouchersForBrs.map((v) => (
                <tr key={v.id}>
                  <td className="py-2.5 font-mono text-slate-500">{v.date}</td>
                  <td className="py-2.5 font-mono font-medium">{v.voucherNo}</td>
                  <td className="py-2.5">{v.partyName || v.expenseCategory || v.notes}</td>
                  <td className="py-2.5">{v.paymentMode}</td>
                  <td className="py-2.5 text-right font-mono font-semibold">
                    {formatINR(v.type === 'sale_invoice' || v.type === 'purchase_bill' ? v.paidAmount : v.grandTotal)}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => reconcileVoucher(v.id, !v.reconciled)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border ${
                        v.reconciled
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {v.reconciled ? 'Reconciled' : 'Pending Match'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'trial_balance' && (
        <div
          id="printable-report"
          className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold">{db.profile.companyName} — Trial Balance</h2>
              <p className="text-xs text-slate-500">FY {db.profile.financialYear}</p>
            </div>
            <div className="flex items-center gap-2 no-print">
              <button
                onClick={() =>
                  downloadReportPDF({
                    title: 'Trial Balance',
                    subtitle: `FY ${db.profile.financialYear}`,
                    companyName: db.profile.companyName,
                    headers: ['Ledger / Account Head', 'Primary Group', 'Debit', 'Credit'],
                    rows: [
                      ...trialBalanceRows.map((r) => [
                        r.ledger,
                        r.group,
                        r.dr > 0 ? formatPdfAmount(r.dr) : '-',
                        r.cr > 0 ? formatPdfAmount(r.cr) : '-',
                      ]),
                      [
                        'Grand Total (Balanced)',
                        '',
                        formatPdfAmount(trialBalanceRows.reduce((s, r) => s + r.dr, 0)),
                        formatPdfAmount(trialBalanceRows.reduce((s, r) => s + r.cr, 0)),
                      ],
                    ],
                    filename: `Trial_Balance_${db.profile.financialYear}.pdf`,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              <button
                onClick={() =>
                  exportToCSV(
                    'trial_balance.csv',
                    ['Ledger / Group', 'Parent Group', 'Debit', 'Credit'],
                    trialBalanceRows.map((r) => [r.ledger, r.group, r.dr, r.cr])
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Ledger / Account Head</th>
                <th className="py-2 text-left">Primary Group</th>
                <th className="py-2 text-right">Debit (₹)</th>
                <th className="py-2 text-right">Credit (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {trialBalanceRows.map((r) => (
                <tr key={r.ledger}>
                  <td className="py-2.5 font-medium">{r.ledger}</td>
                  <td className="py-2.5 text-slate-500">{r.group}</td>
                  <td className="py-2.5 text-right font-mono">{r.dr > 0 ? formatINR(r.dr) : '-'}</td>
                  <td className="py-2.5 text-right font-mono">{r.cr > 0 ? formatINR(r.cr) : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 dark:border-slate-700 font-bold font-mono text-sm">
                <td className="py-3" colSpan={2}>
                  Grand Total (Balanced)
                </td>
                <td className="py-3 text-right">{formatINR(trialBalanceRows.reduce((s, r) => s + r.dr, 0))}</td>
                <td className="py-3 text-right">{formatINR(trialBalanceRows.reduce((s, r) => s + r.cr, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {tab === 'pnl' && (
        <div
          id="printable-report"
          className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold">{db.profile.companyName} — Trading & Profit & Loss Account</h2>
              <p className="text-xs text-slate-500">Taxable Values (Excl. GST) · FY {db.profile.financialYear}</p>
            </div>
            <button
              onClick={() =>
                downloadReportPDF({
                  title: 'Trading & Profit & Loss Account',
                  subtitle: `FY ${db.profile.financialYear} (Taxable Values Excl. GST)`,
                  companyName: db.profile.companyName,
                  headers: ['Particulars', 'Category', 'Amount'],
                  rows: [
                    ['Gross Sales Revenue', 'Income', formatPdfAmount(financials.grossSales)],
                    ['Less: Credit Notes (Returns)', 'Income Adj', `-${formatPdfAmount(financials.creditNotes)}`],
                    ['Net Sales Revenue', 'Subtotal', formatPdfAmount(financials.netSales)],
                    ['Cost of Goods Sold (COGS)', 'Direct Cost', formatPdfAmount(financials.cogs)],
                    ['Gross Profit', 'Margin', formatPdfAmount(financials.grossProfit)],
                    ...Array.from(financials.expensesByHead.entries()).map(([k, v]) => [
                      k,
                      'Indirect Expense',
                      formatPdfAmount(v),
                    ]),
                    ['NET PROFIT / (LOSS)', 'Bottom Line', formatPdfAmount(financials.netProfit)],
                  ],
                  summaryCards: [
                    { label: 'Net Sales', value: formatPdfAmount(financials.netSales) },
                    { label: 'Gross Profit', value: formatPdfAmount(financials.grossProfit) },
                    { label: 'Total Expenses', value: formatPdfAmount(financials.totalExpenses) },
                    { label: 'Net Profit', value: formatPdfAmount(financials.netProfit) },
                  ],
                  filename: `Profit_And_Loss_${db.profile.financialYear}.pdf`,
                })
              }
              className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Download className="w-3.5 h-3.5" /> P&L PDF
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="font-bold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200 dark:border-slate-800">
                Dr. Cost of Goods Sold & Expenses
              </div>
              <div className="flex justify-between py-1">
                <span>Cost of Goods Sold (COGS)</span>
                <span className="font-mono">{formatINR(financials.cogs)}</span>
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 font-semibold">Indirect Expenses</div>
              {Array.from(financials.expensesByHead.entries()).map(([cat, amt]) => (
                <div key={cat} className="flex justify-between py-0.5 pl-2">
                  <span>{cat}</span>
                  <span className="font-mono">{formatINR(amt)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 border-t border-slate-200 dark:border-slate-800 font-bold text-sm">
                <span>Net Profit</span>
                <span className={`font-mono ${financials.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatINR(financials.netProfit)}
                </span>
              </div>
            </div>

            <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="font-bold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200 dark:border-slate-800">
                Cr. Revenue & Margins
              </div>
              <div className="flex justify-between py-1">
                <span>Gross Sales (Taxable)</span>
                <span className="font-mono">{formatINR(financials.grossSales)}</span>
              </div>
              <div className="flex justify-between py-1 text-red-600">
                <span>Less: Credit Notes (Returns)</span>
                <span className="font-mono">-{formatINR(financials.creditNotes)}</span>
              </div>
              <div className="flex justify-between py-2 border-t border-slate-200 dark:border-slate-800 font-semibold">
                <span>Net Sales Revenue</span>
                <span className="font-mono">{formatINR(financials.netSales)}</span>
              </div>
              <div className="flex justify-between py-2 text-indigo-700 dark:text-indigo-400 font-semibold">
                <span>Gross Profit</span>
                <span className="font-mono">{formatINR(financials.grossProfit)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'balance_sheet' && (
        <div
          id="printable-report"
          className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold">{db.profile.companyName} — Balance Sheet</h2>
              <p className="text-xs text-slate-500">FY {db.profile.financialYear}</p>
            </div>
            <button
              onClick={() =>
                downloadReportPDF({
                  title: 'Balance Sheet',
                  subtitle: `As of FY ${db.profile.financialYear}`,
                  companyName: db.profile.companyName,
                  headers: ['Side', 'Account Head', 'Amount'],
                  rows: [
                    ['Liability & Capital', 'Capital & Opening Reserves', formatPdfAmount(financials.balancingCapital)],
                    ['Liability & Capital', 'Net Profit', formatPdfAmount(financials.netProfit)],
                    ['Liability & Capital', 'Business Loans', formatPdfAmount(financials.loanLiabilities)],
                    ['Liability & Capital', 'Sundry Creditors (Payables)', formatPdfAmount(financials.creditors)],
                    ['Liability & Capital', 'Net GST Payable', formatPdfAmount(financials.netGstPayable)],
                    ['TOTAL LIABILITIES', '', formatPdfAmount(financials.totalAssets)],
                    ['Asset', 'Closing Stock Inventory', formatPdfAmount(financials.closingStock)],
                    ['Asset', 'Sundry Debtors (Receivables)', formatPdfAmount(financials.debtors)],
                    ['Asset', 'Bank Balances', formatPdfAmount(financials.bank)],
                    ['Asset', 'Cash-in-Hand', formatPdfAmount(financials.cash)],
                    ['TOTAL ASSETS', '', formatPdfAmount(financials.totalAssets)],
                  ],
                  filename: `Balance_Sheet_${db.profile.financialYear}.pdf`,
                })
              }
              className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Download className="w-3.5 h-3.5" /> Balance Sheet PDF
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2">
              <div className="font-bold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200 dark:border-slate-800">
                Liabilities & Capital
              </div>
              <div className="flex justify-between py-1">
                <span>Capital & Opening Reserves</span>
                <span className="font-mono">{formatINR(financials.balancingCapital)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Net Profit</span>
                <span className="font-mono">{formatINR(financials.netProfit)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Business Loans</span>
                <span className="font-mono">{formatINR(financials.loanLiabilities)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Sundry Creditors (Payables)</span>
                <span className="font-mono">{formatINR(financials.creditors)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Net GST Payable</span>
                <span className="font-mono">{formatINR(financials.netGstPayable)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-slate-300 dark:border-slate-700 font-bold text-sm">
                <span>Total Liabilities</span>
                <span className="font-mono">{formatINR(financials.totalAssets)}</span>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2">
              <div className="font-bold text-slate-500 uppercase tracking-wider pb-2 border-b border-slate-200 dark:border-slate-800">
                Assets
              </div>
              <div className="flex justify-between py-1">
                <span>Closing Stock Inventory</span>
                <span className="font-mono">{formatINR(financials.closingStock)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Sundry Debtors (Receivables)</span>
                <span className="font-mono">{formatINR(financials.debtors)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Bank Balances</span>
                <span className="font-mono">{formatINR(financials.bank)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Cash-in-Hand</span>
                <span className="font-mono">{formatINR(financials.cash)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-slate-300 dark:border-slate-700 font-bold text-sm">
                <span>Total Assets</span>
                <span className="font-mono">{formatINR(financials.totalAssets)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
