import React, { useMemo, useState } from 'react';
import {
  Plus,
  Landmark,
  Wallet,
  ArrowLeftRight,
  CreditCard,
  Check,
  X,
  Download,
  QrCode,
  Trash2,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { formatINR, todayISO, VOUCHER_LABELS } from '../utils/formatters';
import { downloadReportPDF, formatPdfAmount } from '../utils/pdfGenerator';
import { VoucherType } from '../types/accounting';

interface BankingViewProps {
  onNewContra: () => void;
}

export const BankingView: React.FC<BankingViewProps> = ({ onNewContra }) => {
  const {
    db,
    getBankBalance,
    saveBankAccount,
    deleteBankAccount,
    saveCheque,
    updateChequeStatus,
    saveLoan,
    payLoanEmi,
  } = useStore();

  const [tab, setTab] = useState<'accounts' | 'cheques' | 'loans'>('accounts');
  const [selectedAccId, setSelectedAccId] = useState(db?.bankAccounts[0]?.id || '');
  const [confirmDeleteBankId, setConfirmDeleteBankId] = useState<string | null>(null);
  const [deleteToast, setDeleteToast] = useState('');

  const [showAddBank, setShowAddBank] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [openingBal, setOpeningBal] = useState(0);

  const [chqNo, setChqNo] = useState('');
  const [chqPartyId, setChqPartyId] = useState(db?.parties[0]?.id || '');
  const [chqBankId, setChqBankId] = useState(
    db?.bankAccounts.find((b) => b.type !== 'cash')?.id || db?.bankAccounts[0]?.id || ''
  );
  const [chqAmt, setChqAmt] = useState(0);
  const [chqDir, setChqDir] = useState<'received' | 'issued'>('received');

  const [loanLender, setLoanLender] = useState('');
  const [loanPrincipal, setLoanPrincipal] = useState(200000);
  const [loanRate, setLoanRate] = useState(11);
  const [loanEmi, setLoanEmi] = useState(9500);
  const [loanTenure, setLoanTenure] = useState(24);

  const bankAccounts = db?.bankAccounts || [];
  const vouchers = db?.vouchers || [];
  const activeAccId = bankAccounts.some((b) => b.id === selectedAccId)
    ? selectedAccId
    : bankAccounts[0]?.id || '';

  const getTransactionsForAccount = (targetAccId: string) => {
    const rows: { id: string; date: string; ref: string; detail: string; amount: number; type: 'in' | 'out' }[] = [];
    for (const v of vouchers) {
      if (v.status === 'cancelled') continue;
      if (v.type === 'contra') {
        if (v.contraToId === targetAccId) {
          rows.push({
            id: v.id,
            date: v.date,
            ref: v.voucherNo,
            detail: `Contra In: ${v.notes || 'Transfer'}`,
            amount: v.grandTotal,
            type: 'in',
          });
        } else if (v.contraFromId === targetAccId) {
          rows.push({
            id: v.id,
            date: v.date,
            ref: v.voucherNo,
            detail: `Contra Out: ${v.notes || 'Transfer'}`,
            amount: v.grandTotal,
            type: 'out',
          });
        }
        continue;
      }
      if (v.bankAccountId !== targetAccId) continue;
      if (v.type === 'sale_invoice' && v.paidAmount > 0) {
        rows.push({
          id: v.id,
          date: v.date,
          ref: v.voucherNo,
          detail: `Sale Receipt: ${v.partyName}`,
          amount: v.paidAmount,
          type: 'in',
        });
      } else if (v.type === 'payment_in') {
        rows.push({
          id: v.id,
          date: v.date,
          ref: v.voucherNo,
          detail: `Payment In: ${v.partyName}`,
          amount: v.grandTotal,
          type: 'in',
        });
      } else if (
        (v.type === 'purchase_bill' && v.paidAmount > 0) ||
        v.type === 'payment_out' ||
        v.type === 'expense'
      ) {
        const amt = v.type === 'purchase_bill' ? v.paidAmount : v.grandTotal;
        rows.push({
          id: v.id,
          date: v.date,
          ref: v.voucherNo,
          detail: `${VOUCHER_LABELS[v.type as VoucherType]}: ${
            v.partyName || v.expenseCategory || v.notes || ''
          }`,
          amount: amt,
          type: 'out',
        });
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  };

  const accountLedger = useMemo(() => {
    const acc = bankAccounts.find((b) => b.id === activeAccId);
    if (!acc) return [];
    return getTransactionsForAccount(activeAccId);
  }, [vouchers, bankAccounts, activeAccId]);

  if (!db) return null;

  const activeAcc = db.bankAccounts.find((b) => b.id === activeAccId);

  const handleDownloadAndDeleteBank = async (accId: string) => {
    const target = db.bankAccounts.find((b) => b.id === accId);
    if (!target || target.type === 'cash') return;
    const txRows = getTransactionsForAccount(target.id);
    downloadReportPDF({
      title: `Final Bank Archive Statement — ${target.bankName}`,
      subtitle: `A/c: ${target.accountNo} | IFSC: ${target.ifsc} | Closing Balance: ${formatPdfAmount(getBankBalance(target.id))}`,
      companyName: db.profile.companyName,
      headers: ['Date', 'Voucher', 'Description', 'Type', 'Amount'],
      rows:
        txRows.length > 0
          ? txRows.map((r) => [
              r.date,
              r.ref,
              r.detail,
              r.type === 'in' ? 'Credit (+)' : 'Debit (-)',
              formatPdfAmount(r.amount),
            ])
          : [['-', '-', 'Opening Balance Archive (No Voucher Movements)', '-', formatPdfAmount(target.openingBalance)]],
      filename: `Bank_Archive_${target.bankName.replace(/\s+/g, '_')}_${todayISO()}.pdf`,
    });
    await deleteBankAccount(target.id);
    setConfirmDeleteBankId(null);
    setSelectedAccId(db.bankAccounts.find((b) => b.id !== target.id)?.id || '');
    setDeleteToast(`Statement PDF downloaded & "${target.bankName}" moved to Settings → Recycle Bin.`);
    setTimeout(() => setDeleteToast(''), 4500);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Cash, Bank Accounts, Cheques & Loans
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live Cash Register, Bank Ledgers, Contra Transfers, PDC Cheque Clearing & Loan EMIs
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onNewContra}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Contra Transfer
          </button>
          <button
            onClick={() => setShowAddBank(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Bank Account
          </button>
        </div>
      </div>

      {deleteToast && (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          {deleteToast}
        </div>
      )}

      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        {[
          { id: 'accounts', label: 'Cash & Bank Registers' },
          { id: 'cheques', label: `Cheque Tracker (${db.cheques.length})` },
          { id: 'loans', label: `Loans & EMIs (${db.loans.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap ${
              tab === t.id
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 space-y-3">
            {db.bankAccounts.map((acc) => {
              const bal = getBankBalance(acc.id);
              const active = acc.id === activeAccId;
              return (
                <div
                  key={acc.id}
                  onClick={() => setSelectedAccId(acc.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                    active
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-600'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2 min-w-0 truncate">
                      {acc.type === 'cash' ? (
                        <Wallet className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Landmark className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      )}
                      <span className="truncate">{acc.bankName}</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] font-mono uppercase text-slate-500">{acc.type}</span>
                      {acc.type !== 'cash' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteBankId(acc.id);
                          }}
                          title="Download Statement PDF & Delete Bank Account"
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {formatINR(bal)}
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-slate-500">
                    A/c: {acc.accountNo} {acc.ifsc !== '-' ? `· ${acc.ifsc}` : ''}
                  </div>
                </div>
              );
            })}

            <div className="p-3.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/60 text-xs space-y-1">
              <div className="font-semibold text-indigo-800 dark:text-indigo-300 flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5" />
                UPI Instant Collection Gateway
              </div>
              <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                VPA: {db.profile.upiId || 'shobhit@okhdfcbank'}
              </div>
              <div className="text-[11px] text-slate-500">
                Embedded automatically as dynamic UPI QR on all A4/A5/Thermal invoices.
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold">
                Account Transactions — {activeAcc?.bankName}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {activeAcc && activeAcc.type !== 'cash' && (
                  confirmDeleteBankId === activeAcc.id ? (
                    <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded-lg text-[11px]">
                      <span className="text-red-700 dark:text-red-300 font-medium">
                        Download PDF &amp; Move to Recycle Bin?
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDownloadAndDeleteBank(activeAcc.id)}
                        className="px-2 py-0.5 rounded bg-red-600 text-white font-semibold hover:bg-red-700"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteBankId(null)}
                        className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteBankId(activeAcc.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Bank (PDF + Bin)
                    </button>
                  )
                )}
                <button
                  onClick={() => {
                    downloadReportPDF({
                      title: `Account Statement — ${activeAcc?.bankName || 'Account'}`,
                      subtitle: `A/c: ${activeAcc?.accountNo || '-'} | Closing Balance: ${formatPdfAmount(getBankBalance(activeAccId))}`,
                      companyName: db.profile.companyName,
                      headers: ['Date', 'Voucher', 'Description', 'Type', 'Amount'],
                      rows: accountLedger.map((r) => [
                        r.date,
                        r.ref,
                        r.detail,
                        r.type === 'in' ? 'Credit (+)' : 'Debit (-)',
                        formatPdfAmount(r.amount),
                      ]),
                      filename: `Bank_Statement_${(activeAcc?.bankName || 'Account').replace(/\s+/g, '_')}.pdf`,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  Statement PDF
                </button>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Voucher</th>
                  <th className="py-2 text-left">Description</th>
                  <th className="py-2 text-right">In / Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {accountLedger.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-500">
                      No transactions recorded for this account yet.
                    </td>
                  </tr>
                ) : (
                  accountLedger.map((r) => (
                    <tr key={`${r.id}_${r.type}`}>
                      <td className="py-2.5 font-mono text-slate-500">{r.date}</td>
                      <td className="py-2.5 font-mono font-medium">{r.ref}</td>
                      <td className="py-2.5">{r.detail}</td>
                      <td
                        className={`py-2.5 text-right font-mono font-semibold tabular-nums ${
                          r.type === 'in'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {r.type === 'in' ? `+${formatINR(r.amount)}` : `-${formatINR(r.amount)}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'cheques' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
            <h3 className="text-sm font-semibold">Record New Cheque (PDC)</h3>
            <input
              type="text"
              placeholder="Cheque Number (6 digits)"
              value={chqNo}
              onChange={(e) => setChqNo(e.target.value)}
              className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <select
              value={chqDir}
              onChange={(e) => setChqDir(e.target.value as 'received' | 'issued')}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="received">Cheque Received (Customer)</option>
              <option value="issued">Cheque Issued (Supplier)</option>
            </select>
            <select
              value={chqPartyId}
              onChange={(e) => setChqPartyId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              {db.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={chqBankId}
              onChange={(e) => setChqBankId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              {db.bankAccounts
                .filter((b) => b.type !== 'cash')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bankName}
                  </option>
                ))}
            </select>
            <input
              type="number"
              placeholder="Amount (₹)"
              value={chqAmt || ''}
              onChange={(e) => setChqAmt(Number(e.target.value))}
              className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <button
              onClick={async () => {
                const party = db.parties.find((p) => p.id === chqPartyId);
                if (!chqNo || !party || chqAmt <= 0) return;
                await saveCheque({
                  id: `chq_${Date.now()}`,
                  chequeNo: chqNo,
                  date: todayISO(),
                  partyId: party.id,
                  partyName: party.name,
                  bankAccountId: chqBankId,
                  amount: chqAmt,
                  direction: chqDir,
                  status: 'pending',
                  notes: 'Recorded in Cheque Tracker',
                });
                setChqNo('');
                setChqAmt(0);
              }}
              className="w-full py-2 font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Add Cheque Entry
            </button>
          </div>

          <div className="lg:col-span-8 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold mb-3">
              Cheque Register (Clearing auto-posts Receipt/Payment Voucher)
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 text-left">Cheque #</th>
                  <th className="py-2 text-left">Party</th>
                  <th className="py-2 text-left">Type</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-left pl-3">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {db.cheques.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 font-mono font-semibold">{c.chequeNo}</td>
                    <td className="py-2.5">{c.partyName}</td>
                    <td className="py-2.5 capitalize">{c.direction}</td>
                    <td className="py-2.5 text-right font-mono font-semibold tabular-nums">
                      {formatINR(c.amount)}
                    </td>
                    <td
                      className={`py-2.5 pl-3 capitalize font-medium ${
                        c.status === 'cleared'
                          ? 'text-emerald-600'
                          : c.status === 'bounced'
                          ? 'text-red-600'
                          : 'text-amber-600'
                      }`}
                    >
                      {c.status}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap space-x-1">
                      {c.status === 'pending' && (
                        <>
                          <button
                            onClick={() => updateChequeStatus(c.id, 'cleared')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
                          >
                            <Check className="w-3 h-3" /> Clear
                          </button>
                          <button
                            onClick={() => updateChequeStatus(c.id, 'bounced')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50"
                          >
                            <X className="w-3 h-3" /> Bounce
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'loans' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-600" />
              Add Business Loan Account
            </h3>
            <input
              type="text"
              placeholder="Lender / Bank Name"
              value={loanLender}
              onChange={(e) => setLoanLender(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-500 mb-1">Principal (₹)</label>
                <input
                  type="number"
                  value={loanPrincipal}
                  onChange={(e) => setLoanPrincipal(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">EMI Amount (₹)</label>
                <input
                  type="number"
                  value={loanEmi}
                  onChange={(e) => setLoanEmi(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Interest % p.a.</label>
                <input
                  type="number"
                  step="0.1"
                  value={loanRate}
                  onChange={(e) => setLoanRate(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Tenure (Months)</label>
                <input
                  type="number"
                  value={loanTenure}
                  onChange={(e) => setLoanTenure(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>
            <button
              onClick={async () => {
                if (!loanLender.trim()) return;
                await saveLoan({
                  id: `ln_${Date.now()}`,
                  lenderName: loanLender,
                  accountNo: `LN-${Math.floor(100000 + Math.random() * 900000)}`,
                  principal: loanPrincipal,
                  interestRate: loanRate,
                  emiAmount: loanEmi,
                  startDate: todayISO(),
                  tenureMonths: loanTenure,
                  paidEmis: 0,
                  bankAccountId: db.bankAccounts.find((b) => b.type === 'bank')?.id || db.bankAccounts[0]?.id || '',
                });
                setLoanLender('');
              }}
              className="w-full py-2 font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Save Loan Account
            </button>
          </div>

          <div className="lg:col-span-8 space-y-3">
            {db.loans.map((ln) => {
              const totalRepayable = ln.emiAmount * ln.tenureMonths;
              const paidTotal = ln.emiAmount * ln.paidEmis;
              const remaining = Math.max(0, totalRepayable - paidTotal);
              return (
                <div
                  key={ln.id}
                  className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {ln.lenderName}
                    </div>
                    <div className="text-xs font-mono text-slate-500">
                      A/c: {ln.accountNo} · Principal: {formatINR(ln.principal)} · {ln.interestRate}% p.a.
                    </div>
                    <div className="text-xs font-mono text-slate-700 dark:text-slate-300">
                      EMIs Paid: {ln.paidEmis} / {ln.tenureMonths} · Monthly EMI: {formatINR(ln.emiAmount)}
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <div className="text-sm font-bold font-mono text-indigo-700 dark:text-indigo-400 tabular-nums">
                      Outstanding: {formatINR(remaining)}
                    </div>
                    <button
                      disabled={ln.paidEmis >= ln.tenureMonths}
                      onClick={() => payLoanEmi(ln.id)}
                      className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40"
                    >
                      Pay Next EMI ({formatINR(ln.emiAmount)})
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showAddBank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold">Add Bank Account</h3>
              <button onClick={() => setShowAddBank(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              placeholder="Bank Name (e.g. SBI Current A/c)"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <input
              type="text"
              placeholder="Account Number"
              value={accountNo}
              onChange={(e) => setAccountNo(e.target.value)}
              className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <input
              type="text"
              placeholder="IFSC Code"
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <input
              type="number"
              placeholder="Opening Balance (₹)"
              value={openingBal}
              onChange={(e) => setOpeningBal(Number(e.target.value))}
              className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <button
              onClick={async () => {
                if (!bankName.trim()) return;
                await saveBankAccount({
                  id: `bank_${Date.now()}`,
                  bankName,
                  accountNo: accountNo || '0000000000',
                  ifsc: ifsc || 'SBIN0000100',
                  branch: 'Main Branch',
                  upiId: db.profile.upiId,
                  openingBalance: openingBal,
                  type: 'bank',
                });
                setShowAddBank(false);
                setBankName('');
                setAccountNo('');
                setIfsc('');
                setOpeningBal(0);
              }}
              className="w-full py-2 font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Save Bank Account
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
