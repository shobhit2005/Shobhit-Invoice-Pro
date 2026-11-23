import React, { useMemo, useState } from 'react';
import { Calendar, Download, FileText, Printer, X, BarChart3, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { VoucherType } from '../types/accounting';
import { formatINR, todayISO, VOUCHER_LABELS } from '../utils/formatters';
import {
  downloadBulkVouchersPDF,
  downloadReportPDF,
  formatPdfAmount,
} from '../utils/pdfGenerator';

interface BulkPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ReportKind =
  | 'daybook'
  | 'sale_register'
  | 'purchase_register'
  | 'cash_bank_book'
  | 'gstr1'
  | 'pnl'
  | 'stock_summary'
  | 'expense_register';

export const BulkPrintModal: React.FC<BulkPrintModalProps> = ({ isOpen, onClose }) => {
  const { db, getEffectivePaid, getTotalStockValue, getTotalBankBalance, getTotalCashBalance } =
    useStore();

  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [tab, setTab] = useState<'vouchers' | 'reports'>('vouchers');
  const [fromDate, setFromDate] = useState<string>('2026-04-01');
  const [toDate, setToDate] = useState<string>(today);
  const [voucherTypeFilter, setVoucherTypeFilter] = useState<'all' | VoucherType>('all');
  const [reportKind, setReportKind] = useState<ReportKind>('sale_register');
  const [statusMsg, setStatusMsg] = useState('');

  const filteredVouchers = useMemo(() => {
    const all = db?.vouchers || [];
    return all
      .filter((v) => v.status !== 'cancelled')
      .filter((v) => (!fromDate || v.date >= fromDate) && (!toDate || v.date <= toDate))
      .filter((v) => voucherTypeFilter === 'all' || v.type === voucherTypeFilter)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db?.vouchers, fromDate, toDate, voucherTypeFilter]);

  if (!isOpen || !db) return null;

  const setPreset = (preset: 'today' | '7d' | 'month' | 'fy') => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    if (preset === 'today') {
      setFromDate(to);
      setToDate(to);
    } else if (preset === '7d') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      setFromDate(d.toISOString().slice(0, 10));
      setToDate(to);
    } else if (preset === 'month') {
      setFromDate(monthStart);
      setToDate(to);
    } else {
      setFromDate('2026-04-01');
      setToDate(to);
    }
  };

  const totalMatchingAmt = filteredVouchers.reduce((s, v) => s + v.grandTotal, 0);

  const handleBulkVoucherPdf = () => {
    if (filteredVouchers.length === 0) return;
    downloadBulkVouchersPDF({
      vouchers: filteredVouchers,
      profile: db.profile,
      parties: db.parties,
      bankAccounts: db.bankAccounts,
      getEffectivePaid,
      filename: `Bulk_${voucherTypeFilter}_${fromDate}_to_${toDate}.pdf`,
    });
    setStatusMsg(`Downloaded multi-page PDF (${filteredVouchers.length} vouchers).`);
    setTimeout(() => setStatusMsg(''), 3500);
  };

  const handleBulkVoucherRegisterPdf = () => {
    if (filteredVouchers.length === 0) return;
    downloadReportPDF({
      title: `Voucher Register (${voucherTypeFilter === 'all' ? 'All Vouchers' : VOUCHER_LABELS[voucherTypeFilter]})`,
      subtitle: `Period: ${fromDate} to ${toDate} | Count: ${filteredVouchers.length}`,
      companyName: db.profile.companyName,
      headers: ['Date', 'Voucher #', 'Type', 'Party / Ledger', 'Taxable', 'GST', 'Total', 'Paid'],
      rows: filteredVouchers.map((v) => [
        v.date,
        v.voucherNo,
        VOUCHER_LABELS[v.type],
        v.partyName || v.expenseCategory || 'Cash/Ledger',
        formatPdfAmount(v.subTotal),
        formatPdfAmount(v.taxTotal),
        formatPdfAmount(v.grandTotal),
        formatPdfAmount(getEffectivePaid(v)),
      ]),
      summaryCards: [
        { label: 'Vouchers', value: String(filteredVouchers.length) },
        { label: 'Total Amount', value: formatPdfAmount(totalMatchingAmt) },
      ],
      filename: `Voucher_Summary_${fromDate}_to_${toDate}.pdf`,
      landscape: true,
    });
    setStatusMsg('Downloaded filtered summary register PDF.');
    setTimeout(() => setStatusMsg(''), 3500);
  };

  const buildFilteredReport = () => {
    const periodVouchers = db.vouchers.filter(
      (v) => v.status !== 'cancelled' && (!fromDate || v.date >= fromDate) && (!toDate || v.date <= toDate)
    );
    const sub = `Period: ${fromDate} to ${toDate} | GSTIN: ${db.profile.gstin || 'Unregistered'}`;

    if (reportKind === 'daybook') {
      return {
        title: 'Day Book (All Vouchers)',
        subtitle: sub,
        headers: ['Date', 'Voucher #', 'Type', 'Party / Particulars', 'Mode', 'Amount'],
        rows: periodVouchers.map((v) => [
          v.date,
          v.voucherNo,
          VOUCHER_LABELS[v.type],
          v.partyName || v.expenseCategory || v.notes || 'Ledger',
          v.paymentMode || '-',
          formatPdfAmount(v.grandTotal),
        ]),
        filename: `DayBook_${fromDate}_${toDate}.pdf`,
      };
    }

    if (reportKind === 'sale_register') {
      const sales = periodVouchers.filter((v) => v.type === 'sale_invoice');
      return {
        title: 'Sale Register (GST Tax Invoices)',
        subtitle: sub,
        headers: ['Date', 'Invoice #', 'Customer', 'GSTIN', 'Taxable', 'GST', 'Grand Total'],
        rows: sales.map((v) => [
          v.date,
          v.voucherNo,
          v.partyName || 'Walk-in',
          v.partyGstin || 'URD',
          formatPdfAmount(v.subTotal),
          formatPdfAmount(v.taxTotal),
          formatPdfAmount(v.grandTotal),
        ]),
        summaryCards: [
          { label: 'Invoices', value: String(sales.length) },
          { label: 'Taxable Sales', value: formatPdfAmount(sales.reduce((s, v) => s + v.subTotal, 0)) },
          { label: 'Total GST', value: formatPdfAmount(sales.reduce((s, v) => s + v.taxTotal, 0)) },
          { label: 'Gross Sales', value: formatPdfAmount(sales.reduce((s, v) => s + v.grandTotal, 0)) },
        ],
        filename: `Sale_Register_${fromDate}_${toDate}.pdf`,
      };
    }

    if (reportKind === 'purchase_register') {
      const pur = periodVouchers.filter((v) => v.type === 'purchase_bill');
      return {
        title: 'Purchase Register & Input Tax Credit',
        subtitle: sub,
        headers: ['Date', 'Bill #', 'Supplier', 'GSTIN', 'Taxable', 'ITC GST', 'Bill Total'],
        rows: pur.map((v) => [
          v.date,
          v.voucherNo,
          v.partyName || '-',
          v.partyGstin || 'URD',
          formatPdfAmount(v.subTotal),
          formatPdfAmount(v.taxTotal),
          formatPdfAmount(v.grandTotal),
        ]),
        summaryCards: [
          { label: 'Bills', value: String(pur.length) },
          { label: 'Taxable Purchase', value: formatPdfAmount(pur.reduce((s, v) => s + v.subTotal, 0)) },
          { label: 'Eligible ITC', value: formatPdfAmount(pur.reduce((s, v) => s + v.taxTotal, 0)) },
          { label: 'Total Purchases', value: formatPdfAmount(pur.reduce((s, v) => s + v.grandTotal, 0)) },
        ],
        filename: `Purchase_Register_${fromDate}_${toDate}.pdf`,
      };
    }

    if (reportKind === 'cash_bank_book') {
      const cashBankVouchers = periodVouchers.filter(
        (v) => v.paidAmount > 0 || v.type === 'contra' || v.type === 'expense'
      );
      return {
        title: 'Cash & Bank Movement Book',
        subtitle: `${sub} | Live Cash: ${formatPdfAmount(getTotalCashBalance())} | Bank: ${formatPdfAmount(getTotalBankBalance())}`,
        headers: ['Date', 'Voucher #', 'Type', 'Party / Category', 'Mode', 'Amount'],
        rows: cashBankVouchers.map((v) => [
          v.date,
          v.voucherNo,
          VOUCHER_LABELS[v.type],
          v.partyName || v.expenseCategory || v.notes || '-',
          v.paymentMode || '-',
          formatPdfAmount(v.type === 'sale_invoice' || v.type === 'purchase_bill' ? v.paidAmount : v.grandTotal),
        ]),
        filename: `Cash_Bank_Book_${fromDate}_${toDate}.pdf`,
      };
    }

    if (reportKind === 'gstr1') {
      const sales = periodVouchers.filter((v) => v.type === 'sale_invoice');
      return {
        title: 'GSTR-1 Outward Supplies Summary',
        subtitle: sub,
        headers: ['Date', 'Invoice #', 'Party', 'GSTIN', 'Place of Supply', 'Taxable', 'CGST+SGST/IGST'],
        rows: sales.map((v) => [
          v.date,
          v.voucherNo,
          v.partyName || 'Walk-in',
          v.partyGstin || 'B2C',
          v.placeOfSupply || db.profile.state,
          formatPdfAmount(v.subTotal),
          formatPdfAmount(v.taxTotal),
        ]),
        filename: `GSTR1_Summary_${fromDate}_${toDate}.pdf`,
      };
    }

    if (reportKind === 'pnl') {
      const salesTaxable = periodVouchers
        .filter((v) => v.type === 'sale_invoice')
        .reduce((s, v) => s + v.subTotal, 0);
      const purchaseTaxable = periodVouchers
        .filter((v) => v.type === 'purchase_bill')
        .reduce((s, v) => s + v.subTotal, 0);
      const exp = periodVouchers
        .filter((v) => v.type === 'expense')
        .reduce((s, v) => s + v.grandTotal, 0);
      const net = salesTaxable - purchaseTaxable - exp;
      return {
        title: 'Profit & Loss Statement (Period Summary)',
        subtitle: sub,
        headers: ['Particulars', 'Category', 'Amount'],
        rows: [
          ['Sales Revenue (Taxable)', 'Direct Income', formatPdfAmount(salesTaxable)],
          ['Purchases (Taxable)', 'Direct Expense', formatPdfAmount(purchaseTaxable)],
          ['Indirect Operating Expenses', 'Indirect Expense', formatPdfAmount(exp)],
          ['Closing Stock Valuation', 'Asset Valuation', formatPdfAmount(getTotalStockValue())],
          ['Estimated Net Period Surplus', net >= 0 ? 'Net Profit' : 'Net Loss', formatPdfAmount(net)],
        ],
        filename: `Profit_And_Loss_${fromDate}_${toDate}.pdf`,
      };
    }

    if (reportKind === 'stock_summary') {
      return {
        title: 'Inventory Stock Valuation Summary',
        subtitle: `As of ${toDate} | Total Stock Value: ${formatPdfAmount(getTotalStockValue())}`,
        headers: ['Item', 'SKU', 'HSN', 'Stock Qty', 'Unit', 'Purchase Rate', 'Stock Value'],
        rows: db.items
          .filter((i) => i.type === 'product')
          .map((i) => [
            i.name,
            i.sku,
            i.hsn,
            i.stockQty,
            i.unit,
            formatPdfAmount(i.purchasePrice),
            formatPdfAmount(i.stockQty * i.purchasePrice),
          ]),
        filename: `Stock_Valuation_${toDate}.pdf`,
      };
    }

    const expRows = periodVouchers.filter((v) => v.type === 'expense');
    return {
      title: 'Expense Register',
      subtitle: sub,
      headers: ['Date', 'Voucher #', 'Expense Head', 'Mode', 'Notes', 'Amount'],
      rows: expRows.map((v) => [
        v.date,
        v.voucherNo,
        v.expenseCategory || 'General',
        v.paymentMode || '-',
        v.notes || '-',
        formatPdfAmount(v.grandTotal),
      ]),
      filename: `Expense_Register_${fromDate}_${toDate}.pdf`,
    };
  };

  const handleDownloadReportPdf = () => {
    const rpt = buildFilteredReport();
    downloadReportPDF({
      ...rpt,
      companyName: db.profile.companyName,
      landscape: rpt.headers.length > 6,
    });
    setStatusMsg(`Downloaded ${rpt.title} PDF.`);
    setTimeout(() => setStatusMsg(''), 3500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-600 text-white font-black text-xs flex items-center justify-center tracking-wider">
              IP
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Bulk Print &amp; Date-Filtered Download Center
              </h2>
              <p className="text-xs text-slate-500">
                Download multi-page Invoice PDFs or GST &amp; Accounting Reports for any custom date range
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {statusMsg && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMsg}</span>
            </div>
          )}

          {/* Shared Date Range Picker & Presets */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Date Filter Range
              </span>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {[
                  { id: 'today' as const, label: 'Today' },
                  { id: '7d' as const, label: 'Last 7 Days' },
                  { id: 'month' as const, label: 'This Month' },
                  { id: 'fy' as const, label: 'Full FY' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-indigo-500 font-medium"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit text-xs">
            <button
              onClick={() => setTab('vouchers')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold ${
                tab === 'vouchers'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Bulk Invoices &amp; Vouchers ({filteredVouchers.length})
            </button>
            <button
              onClick={() => setTab('reports')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold ${
                tab === 'reports'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Date-Filtered Reports
            </button>
          </div>

          {tab === 'vouchers' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs items-end">
                <div>
                  <label className="block text-slate-500 mb-1 font-medium">Voucher Type Filter</label>
                  <select
                    value={voucherTypeFilter}
                    onChange={(e) => setVoucherTypeFilter(e.target.value as 'all' | VoucherType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="all">All Voucher Types</option>
                    {Object.entries(VOUCHER_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-slate-500">Matched Vouchers:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {filteredVouchers.length} ({formatINR(totalMatchingAmt)})
                  </span>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3 text-left">Date</th>
                      <th className="py-2 px-3 text-left">Voucher #</th>
                      <th className="py-2 px-3 text-left">Type</th>
                      <th className="py-2 px-3 text-left">Party / Head</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredVouchers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No vouchers found in the selected date range.
                        </td>
                      </tr>
                    ) : (
                      filteredVouchers.slice(0, 40).map((v) => (
                        <tr key={v.id}>
                          <td className="py-2 px-3 font-mono text-slate-500">{v.date}</td>
                          <td className="py-2 px-3 font-mono font-semibold">{v.voucherNo}</td>
                          <td className="py-2 px-3">{VOUCHER_LABELS[v.type]}</td>
                          <td className="py-2 px-3 truncate max-w-[180px]">
                            {v.partyName || v.expenseCategory || 'Ledger'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">
                            {formatINR(v.grandTotal)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={filteredVouchers.length === 0}
                  onClick={handleBulkVoucherRegisterPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Download Summary Table PDF
                </button>
                <button
                  type="button"
                  disabled={filteredVouchers.length === 0}
                  onClick={handleBulkVoucherPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Multi-Page Invoice PDF ({filteredVouchers.length})
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                {[
                  { id: 'daybook' as const, label: 'Day Book' },
                  { id: 'sale_register' as const, label: 'Sale Register' },
                  { id: 'purchase_register' as const, label: 'Purchase Register' },
                  { id: 'cash_bank_book' as const, label: 'Cash & Bank Book' },
                  { id: 'gstr1' as const, label: 'GSTR-1 Summary' },
                  { id: 'pnl' as const, label: 'Profit & Loss' },
                  { id: 'stock_summary' as const, label: 'Stock Valuation' },
                  { id: 'expense_register' as const, label: 'Expense Register' },
                ].map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setReportKind(r.id)}
                    className={`p-3 rounded-xl border text-left font-semibold transition ${
                      reportKind === r.id
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleDownloadReportPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Filtered Report PDF
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
