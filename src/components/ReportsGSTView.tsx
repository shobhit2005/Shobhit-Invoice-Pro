import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, FileJson, Printer, AlertCircle, Download } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { exportToCSV, formatINR } from '../utils/formatters';
import { downloadReportPDF, formatPdfAmount } from '../utils/pdfGenerator';

type RepTab =
  | 'gstr1'
  | 'gstr2b'
  | 'gstr3b'
  | 'aging'
  | 'party_reports'
  | 'stock_movement'
  | 'cash_flow'
  | 'eway';

export const ReportsGSTView: React.FC = () => {
  const { db, getEffectivePaid } = useStore();
  const [tab, setTab] = useState<RepTab>('gstr1');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const inRange = (d: string) => {
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  };

  const gstrData = useMemo(() => {
    const active = (db?.vouchers || []).filter((v) => v.status !== 'cancelled' && inRange(v.date));
    const sales = active.filter((v) => v.type === 'sale_invoice');
    const cns = active.filter((v) => v.type === 'credit_note');
    const purchases = active.filter((v) => v.type === 'purchase_bill');
    const dns = active.filter((v) => v.type === 'debit_note');

    const b2b = sales.filter((v) => Boolean(v.partyGstin));
    const b2c = sales.filter((v) => !v.partyGstin);
    const rcmBills = purchases.filter((v) => Boolean(v.isReverseCharge));

    const sumTax = (list: typeof sales) => {
      let taxable = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;
      for (const v of list) {
        taxable += v.subTotal;
        for (const l of v.lines) {
          cgst += l.cgst;
          sgst += l.sgst;
          igst += l.igst + l.cess;
        }
      }
      return { taxable, cgst, sgst, igst, totalTax: cgst + sgst + igst };
    };

    const outward = sumTax(sales);
    const cnTax = sumTax(cns);
    const inward = sumTax(purchases.filter((p) => !p.isReverseCharge));
    const dnTax = sumTax(dns);

    const netOutward = {
      taxable: outward.taxable - cnTax.taxable,
      cgst: outward.cgst - cnTax.cgst,
      sgst: outward.sgst - cnTax.sgst,
      igst: outward.igst - cnTax.igst,
      totalTax: outward.totalTax - cnTax.totalTax,
    };

    const netItc = {
      taxable: inward.taxable - dnTax.taxable,
      cgst: inward.cgst - dnTax.cgst,
      sgst: inward.sgst - dnTax.sgst,
      igst: inward.igst - dnTax.igst,
      totalTax: inward.totalTax - dnTax.totalTax,
    };

    const hsnMap = new Map<
      string,
      { hsn: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number }
    >();
    for (const v of sales) {
      for (const l of v.lines) {
        const key = l.hsn || 'NA';
        const prev = hsnMap.get(key) || { hsn: key, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        prev.qty += l.qty;
        prev.taxable += l.taxableAmount;
        prev.cgst += l.cgst;
        prev.sgst += l.sgst;
        prev.igst += l.igst;
        hsnMap.set(key, prev);
      }
    }

    const validationWarnings: string[] = [];
    for (const v of sales) {
      if (v.grandTotal >= 50000 && !v.ewayBillNo) {
        validationWarnings.push(`${v.voucherNo} (₹${v.grandTotal}) is >= ₹50,000 without E-Way Bill No.`);
      }
      if (v.partyGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v.partyGstin)) {
        validationWarnings.push(`${v.voucherNo} has invalid Party GSTIN format (${v.partyGstin}).`);
      }
    }

    return {
      b2b,
      b2c,
      cns,
      purchases,
      rcmBills,
      netOutward,
      netItc,
      hsnSummary: Array.from(hsnMap.values()),
      validationWarnings,
    };
  }, [db?.vouchers, fromDate, toDate]);

  const agingRows = useMemo(() => {
    const today = new Date();
    const map = new Map<
      string,
      { party: string; b0_30: number; b31_60: number; b61_90: number; b90plus: number; total: number }
    >();
    for (const v of db?.vouchers || []) {
      if (v.type !== 'sale_invoice' || v.status === 'cancelled') continue;
      const due = Math.max(0, v.grandTotal - getEffectivePaid(v));
      if (due <= 0.5) continue;
      const refDate = new Date(v.dueDate || v.date);
      const diffDays = Math.max(0, Math.floor((today.getTime() - refDate.getTime()) / 86400000));
      const key = v.partyName || 'Unknown';
      const entry = map.get(key) || { party: key, b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 };
      if (diffDays <= 30) entry.b0_30 += due;
      else if (diffDays <= 60) entry.b31_60 += due;
      else if (diffDays <= 90) entry.b61_90 += due;
      else entry.b90plus += due;
      entry.total += due;
      map.set(key, entry);
    }
    return Array.from(map.values());
  }, [db?.vouchers, getEffectivePaid]);

  const stockVelocity = useMemo(() => {
    const soldMap = new Map<string, { qty: number; revenue: number }>();
    for (const v of db?.vouchers || []) {
      if (v.type !== 'sale_invoice' || v.status === 'cancelled' || !inRange(v.date)) continue;
      for (const l of v.lines) {
        const prev = soldMap.get(l.itemId) || { qty: 0, revenue: 0 };
        prev.qty += l.qty;
        prev.revenue += l.taxableAmount;
        soldMap.set(l.itemId, prev);
      }
    }
    return (db?.items || [])
      .filter((i) => i.type === 'product')
      .map((i) => {
        const s = soldMap.get(i.id) || { qty: 0, revenue: 0 };
        const profit = s.revenue - s.qty * i.purchasePrice;
        const speed = s.qty >= 15 ? 'Fast-Moving' : s.qty > 0 ? 'Slow-Moving' : 'Dead Stock';
        return { item: i, soldQty: s.qty, revenue: s.revenue, profit, speed };
      })
      .sort((a, b) => b.soldQty - a.soldQty);
  }, [db?.items, db?.vouchers, fromDate, toDate]);

  const partySummaries = useMemo(() => {
    const map = new Map<string, { name: string; sales: number; purchases: number; receipts: number }>();
    for (const v of db?.vouchers || []) {
      if (v.status === 'cancelled' || !v.partyName || !inRange(v.date)) continue;
      const entry = map.get(v.partyName) || { name: v.partyName, sales: 0, purchases: 0, receipts: 0 };
      if (v.type === 'sale_invoice') {
        entry.sales += v.grandTotal;
        entry.receipts += v.paidAmount;
      } else if (v.type === 'payment_in') {
        entry.receipts += v.grandTotal;
      } else if (v.type === 'purchase_bill') {
        entry.purchases += v.grandTotal;
      }
      map.set(v.partyName, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [db?.vouchers, fromDate, toDate]);

  const cashFlowSummary = useMemo(() => {
    let operatingIn = 0;
    let operatingOut = 0;
    let financingOut = 0;
    for (const v of db?.vouchers || []) {
      if (v.status === 'cancelled' || !inRange(v.date)) continue;
      if (v.type === 'sale_invoice') operatingIn += v.paidAmount;
      else if (v.type === 'payment_in') operatingIn += v.grandTotal;
      else if (v.type === 'purchase_bill') operatingOut += v.paidAmount;
      else if (v.type === 'payment_out') operatingOut += v.grandTotal;
      else if (v.type === 'expense') {
        if ((v.notes || '').includes('Loan EMI')) financingOut += v.grandTotal;
        else operatingOut += v.grandTotal;
      }
    }
    return {
      operatingIn,
      operatingOut,
      netOperating: operatingIn - operatingOut,
      financingOut,
      netCashFlow: operatingIn - operatingOut - financingOut,
    };
  }, [db?.vouchers, fromDate, toDate]);

  if (!db) return null;

  const handleDownloadActivePdf = () => {
    if (tab === 'gstr1') {
      downloadReportPDF({
        title: 'GSTR-1 Outward Supplies & HSN Summary',
        subtitle: `GSTIN: ${db.profile.gstin} | B2B Invoices: ${gstrData.b2b.length} | B2C: ${gstrData.b2c.length}`,
        companyName: db.profile.companyName,
        headers: ['HSN/SAC', 'Qty', 'Taxable Value', 'CGST', 'SGST', 'IGST'],
        rows: gstrData.hsnSummary.map((h) => [
          h.hsn,
          h.qty,
          formatPdfAmount(h.taxable),
          formatPdfAmount(h.cgst),
          formatPdfAmount(h.sgst),
          formatPdfAmount(h.igst),
        ]),
        filename: 'GSTR1_HSN_Summary.pdf',
      });
    } else if (tab === 'gstr2b') {
      downloadReportPDF({
        title: 'GSTR-2B Purchase ITC & RCM Register',
        subtitle: `Eligible ITC: ${formatPdfAmount(gstrData.netItc.totalTax)}`,
        companyName: db.profile.companyName,
        headers: ['Date', 'Bill #', 'Supplier', 'GSTIN', 'Mode', 'Taxable', 'Input GST'],
        rows: gstrData.purchases.map((p) => [
          p.date,
          p.voucherNo,
          p.partyName || '-',
          p.partyGstin || '-',
          p.isReverseCharge ? 'RCM' : 'Regular',
          formatPdfAmount(p.subTotal),
          formatPdfAmount(p.taxTotal),
        ]),
        filename: 'GSTR2B_ITC_Register.pdf',
      });
    } else if (tab === 'gstr3b') {
      downloadReportPDF({
        title: 'GSTR-3B Data Preparation Summary',
        subtitle: `GSTIN: ${db.profile.gstin} | FY ${db.profile.financialYear}`,
        companyName: db.profile.companyName,
        headers: ['Section', 'Taxable', 'IGST', 'CGST', 'SGST', 'Total Tax'],
        rows: [
          [
            '3.1 Outward Supplies (Net)',
            formatPdfAmount(gstrData.netOutward.taxable),
            formatPdfAmount(gstrData.netOutward.igst),
            formatPdfAmount(gstrData.netOutward.cgst),
            formatPdfAmount(gstrData.netOutward.sgst),
            formatPdfAmount(gstrData.netOutward.totalTax),
          ],
          [
            '4. Eligible Input Tax Credit (ITC)',
            formatPdfAmount(gstrData.netItc.taxable),
            `-${formatPdfAmount(gstrData.netItc.igst)}`,
            `-${formatPdfAmount(gstrData.netItc.cgst)}`,
            `-${formatPdfAmount(gstrData.netItc.sgst)}`,
            `-${formatPdfAmount(gstrData.netItc.totalTax)}`,
          ],
          [
            '6.1 Net GST Payable',
            '-',
            formatPdfAmount(gstrData.netOutward.igst - gstrData.netItc.igst),
            formatPdfAmount(gstrData.netOutward.cgst - gstrData.netItc.cgst),
            formatPdfAmount(gstrData.netOutward.sgst - gstrData.netItc.sgst),
            formatPdfAmount(gstrData.netOutward.totalTax - gstrData.netItc.totalTax),
          ],
        ],
        filename: 'GSTR3B_Summary.pdf',
      });
    } else if (tab === 'aging') {
      downloadReportPDF({
        title: 'Receivables Overdue Aging Analysis',
        companyName: db.profile.companyName,
        headers: ['Customer', '0-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'Total Due'],
        rows: agingRows.map((r) => [
          r.party,
          formatPdfAmount(r.b0_30),
          formatPdfAmount(r.b31_60),
          formatPdfAmount(r.b61_90),
          formatPdfAmount(r.b90plus),
          formatPdfAmount(r.total),
        ]),
        filename: 'Receivables_Aging_Report.pdf',
      });
    } else if (tab === 'stock_movement') {
      downloadReportPDF({
        title: 'Fast / Slow / Dead Stock Velocity Report',
        companyName: db.profile.companyName,
        headers: ['Item', 'Stock', 'Qty Sold', 'Revenue', 'Gross Profit', 'Velocity'],
        rows: stockVelocity.map((r) => [
          r.item.name,
          r.item.stockQty,
          r.soldQty,
          formatPdfAmount(r.revenue),
          formatPdfAmount(r.profit),
          r.speed,
        ]),
        filename: 'Stock_Velocity_Report.pdf',
      });
    } else if (tab === 'party_reports') {
      downloadReportPDF({
        title: 'Customer-Wise Sales & Supplier-Wise Purchases',
        companyName: db.profile.companyName,
        headers: ['Party Name', 'Total Sales', 'Payments Collected', 'Total Purchases'],
        rows: partySummaries.map((p) => [
          p.name,
          formatPdfAmount(p.sales),
          formatPdfAmount(p.receipts),
          formatPdfAmount(p.purchases),
        ]),
        filename: 'Party_Wise_Summary.pdf',
      });
    } else if (tab === 'cash_flow') {
      downloadReportPDF({
        title: 'Cash Flow & Fund Flow Summary',
        companyName: db.profile.companyName,
        headers: ['Cash Flow Activity', 'Amount'],
        rows: [
          ['Operating Cash Inflow (Sales & Receipts)', formatPdfAmount(cashFlowSummary.operatingIn)],
          ['Operating Cash Outflow (Purchases & Expenses)', `-${formatPdfAmount(cashFlowSummary.operatingOut)}`],
          ['Financing Outflow (Loan EMIs)', `-${formatPdfAmount(cashFlowSummary.financingOut)}`],
          ['Net Cash Flow', formatPdfAmount(cashFlowSummary.netCashFlow)],
        ],
        filename: 'Cash_Flow_Statement.pdf',
      });
    } else {
      const ewayRows = db.vouchers.filter(
        (v) => v.type === 'sale_invoice' && (v.ewayBillNo || v.irn || v.grandTotal >= 50000)
      );
      downloadReportPDF({
        title: 'E-Way Bill & E-Invoice IRN Register',
        companyName: db.profile.companyName,
        headers: ['Invoice #', 'Party', 'E-Way Bill No', 'Vehicle No', 'IRN', 'Value'],
        rows: ewayRows.map((v) => [
          v.voucherNo,
          v.partyName || '-',
          v.ewayBillNo || 'Pending',
          v.vehicleNo || '-',
          v.irn || '-',
          formatPdfAmount(v.grandTotal),
        ]),
        filename: 'EWay_EInvoice_Register.pdf',
      });
    }
  };

  const exportGstr1Json = () => {
    const payload = {
      gstin: db.profile.gstin,
      fp: db.profile.financialYear,
      note: 'Portal-compatible GSTR-1 preparation JSON from Shobhit Invoice Pro (for verification & upload)',
      b2b: gstrData.b2b.map((v) => ({
        ctin: v.partyGstin,
        invNo: v.voucherNo,
        date: v.date,
        val: v.grandTotal,
        pos: v.placeOfSupply,
        txval: v.subTotal,
      })),
      hsn: gstrData.hsnSummary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_Prep_${db.profile.gstin || 'Export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Reports Centre & GST Tax Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            GSTR-1 / 2B / 3B Data Preparation, RCM, Aging, Fast/Slow/Dead Stock, Customer/Supplier Reports & Cash Flow
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <button
            onClick={handleDownloadActivePdf}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
          <button
            onClick={exportGstr1Json}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-950/30 hover:bg-indigo-100"
          >
            <FileJson className="w-3.5 h-3.5" />
            Export GSTR-1 JSON
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        {[
          { id: 'gstr1', label: 'GSTR-1 Prep' },
          { id: 'gstr2b', label: 'GSTR-2B & RCM' },
          { id: 'gstr3b', label: 'GSTR-3B Summary' },
          { id: 'aging', label: 'Aging (0-90+ Days)' },
          { id: 'stock_movement', label: 'Fast / Slow / Dead Stock' },
          { id: 'party_reports', label: 'Customer & Supplier' },
          { id: 'cash_flow', label: 'Cash & Fund Flow' },
          { id: 'eway', label: 'E-Way & E-Invoice' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as RepTab)}
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

      {tab === 'gstr1' && (
        <div className="space-y-4">
          {gstrData.validationWarnings.length > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" />
                GST Validation Checks (Fix before uploading GSTR-1 JSON to portal):
              </div>
              {gstrData.validationWarnings.map((w, i) => (
                <div key={i} className="pl-5">• {w}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">B2B Taxable ({gstrData.b2b.length} Invoices)</div>
              <div className="mt-1 text-lg font-bold font-mono">
                {formatINR(gstrData.b2b.reduce((s, v) => s + v.subTotal, 0))}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">B2C Taxable ({gstrData.b2c.length} Invoices)</div>
              <div className="mt-1 text-lg font-bold font-mono">
                {formatINR(gstrData.b2c.reduce((s, v) => s + v.subTotal, 0))}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Net Outward GST Liability</div>
              <div className="mt-1 text-lg font-bold font-mono text-indigo-700 dark:text-indigo-400">
                {formatINR(gstrData.netOutward.totalTax)}
              </div>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">HSN / SAC Summary (GSTR-1 Table 12)</h2>
              <button
                onClick={() =>
                  exportToCSV(
                    'gstr1_hsn.csv',
                    ['HSN', 'Qty', 'Taxable Value', 'CGST', 'SGST', 'IGST'],
                    gstrData.hsnSummary.map((h) => [h.hsn, h.qty, h.taxable, h.cgst, h.sgst, h.igst])
                  )
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel/CSV
              </button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 text-left">HSN/SAC</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Taxable</th>
                  <th className="py-2 text-right">CGST</th>
                  <th className="py-2 text-right">SGST</th>
                  <th className="py-2 text-right">IGST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {gstrData.hsnSummary.map((h) => (
                  <tr key={h.hsn}>
                    <td className="py-2.5 font-semibold">{h.hsn}</td>
                    <td className="py-2.5 text-right">{h.qty}</td>
                    <td className="py-2.5 text-right">{formatINR(h.taxable)}</td>
                    <td className="py-2.5 text-right">{formatINR(h.cgst)}</td>
                    <td className="py-2.5 text-right">{formatINR(h.sgst)}</td>
                    <td className="py-2.5 text-right">{formatINR(h.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'gstr2b' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              GSTR-2B Purchase ITC Reconciliation ({gstrData.rcmBills.length} Reverse Charge Bills)
            </h2>
            <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">
              Eligible ITC: {formatINR(gstrData.netItc.totalTax)}
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-left">Bill #</th>
                <th className="py-2 text-left">Supplier</th>
                <th className="py-2 text-left">GSTIN</th>
                <th className="py-2 text-left">RCM</th>
                <th className="py-2 text-right">Taxable</th>
                <th className="py-2 text-right">Input GST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {gstrData.purchases.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 font-mono text-slate-500">{p.date}</td>
                  <td className="py-2.5 font-mono font-medium">{p.voucherNo}</td>
                  <td className="py-2.5">{p.partyName}</td>
                  <td className="py-2.5 font-mono text-slate-500">{p.partyGstin || '-'}</td>
                  <td className="py-2.5 font-mono">{p.isReverseCharge ? 'RCM' : 'Regular'}</td>
                  <td className="py-2.5 text-right font-mono">{formatINR(p.subTotal)}</td>
                  <td className="py-2.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatINR(p.taxTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'gstr3b' && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div>
            <h2 className="text-base font-bold">GSTR-3B Data Preparation Summary</h2>
            <p className="text-xs text-slate-500">
              Prepared for portal reference & CA review (not an official portal submission)
            </p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2.5 text-left">Section</th>
                <th className="py-2.5 text-right">Taxable</th>
                <th className="py-2.5 text-right">IGST</th>
                <th className="py-2.5 text-right">CGST</th>
                <th className="py-2.5 text-right">SGST</th>
                <th className="py-2.5 text-right">Total Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              <tr>
                <td className="py-3 font-sans font-semibold">3.1 Outward Supplies (Net)</td>
                <td className="py-3 text-right">{formatINR(gstrData.netOutward.taxable)}</td>
                <td className="py-3 text-right">{formatINR(gstrData.netOutward.igst)}</td>
                <td className="py-3 text-right">{formatINR(gstrData.netOutward.cgst)}</td>
                <td className="py-3 text-right">{formatINR(gstrData.netOutward.sgst)}</td>
                <td className="py-3 text-right font-semibold">{formatINR(gstrData.netOutward.totalTax)}</td>
              </tr>
              <tr>
                <td className="py-3 font-sans font-semibold text-emerald-700 dark:text-emerald-400">
                  4. Eligible Input Tax Credit (ITC)
                </td>
                <td className="py-3 text-right">{formatINR(gstrData.netItc.taxable)}</td>
                <td className="py-3 text-right text-emerald-700 dark:text-emerald-400">-{formatINR(gstrData.netItc.igst)}</td>
                <td className="py-3 text-right text-emerald-700 dark:text-emerald-400">-{formatINR(gstrData.netItc.cgst)}</td>
                <td className="py-3 text-right text-emerald-700 dark:text-emerald-400">-{formatINR(gstrData.netItc.sgst)}</td>
                <td className="py-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                  -{formatINR(gstrData.netItc.totalTax)}
                </td>
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold text-sm">
                <td className="py-3.5 font-sans">6.1 Net GST Payable</td>
                <td className="py-3.5 text-right">-</td>
                <td className="py-3.5 text-right">{formatINR(gstrData.netOutward.igst - gstrData.netItc.igst)}</td>
                <td className="py-3.5 text-right">{formatINR(gstrData.netOutward.cgst - gstrData.netItc.cgst)}</td>
                <td className="py-3.5 text-right">{formatINR(gstrData.netOutward.sgst - gstrData.netItc.sgst)}</td>
                <td className="py-3.5 text-right text-indigo-700 dark:text-indigo-400">
                  {formatINR(gstrData.netOutward.totalTax - gstrData.netItc.totalTax)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'aging' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold">Receivables Overdue Aging Analysis</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Customer</th>
                <th className="py-2 text-right">0–30 Days</th>
                <th className="py-2 text-right">31–60 Days</th>
                <th className="py-2 text-right">61–90 Days</th>
                <th className="py-2 text-right">90+ Days</th>
                <th className="py-2 text-right">Total Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {agingRows.map((r) => (
                <tr key={r.party}>
                  <td className="py-2.5 font-sans font-semibold">{r.party}</td>
                  <td className="py-2.5 text-right">{formatINR(r.b0_30)}</td>
                  <td className="py-2.5 text-right">{formatINR(r.b31_60)}</td>
                  <td className="py-2.5 text-right">{formatINR(r.b61_90)}</td>
                  <td className="py-2.5 text-right text-red-600">{formatINR(r.b90plus)}</td>
                  <td className="py-2.5 text-right font-bold">{formatINR(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stock_movement' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Fast-Moving, Slow-Moving & Dead Stock Profitability</h2>
            <button
              onClick={() =>
                exportToCSV(
                  'stock_velocity_profit.csv',
                  ['Item', 'Category', 'Current Stock', 'Qty Sold', 'Revenue', 'Profit', 'Classification'],
                  stockVelocity.map((r) => [
                    r.item.name,
                    r.item.category,
                    r.item.stockQty,
                    r.soldQty,
                    r.revenue,
                    r.profit,
                    r.speed,
                  ])
                )
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Item</th>
                <th className="py-2 text-right">Stock</th>
                <th className="py-2 text-right">Qty Sold</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">Gross Profit</th>
                <th className="py-2 text-left pl-4">Velocity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {stockVelocity.map((r) => (
                <tr key={r.item.id}>
                  <td className="py-2.5 font-sans font-medium">{r.item.name}</td>
                  <td className="py-2.5 text-right">{r.item.stockQty}</td>
                  <td className="py-2.5 text-right">{r.soldQty}</td>
                  <td className="py-2.5 text-right">{formatINR(r.revenue)}</td>
                  <td className="py-2.5 text-right text-emerald-700 dark:text-emerald-400 font-semibold">
                    {formatINR(r.profit)}
                  </td>
                  <td
                    className={`py-2.5 pl-4 font-sans font-semibold ${
                      r.speed === 'Fast-Moving'
                        ? 'text-emerald-600'
                        : r.speed === 'Slow-Moving'
                        ? 'text-amber-600'
                        : 'text-red-600'
                    }`}
                  >
                    {r.speed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'party_reports' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold">Customer-Wise Sales & Supplier-Wise Purchases</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Party Name</th>
                <th className="py-2 text-right">Total Sales</th>
                <th className="py-2 text-right">Payments Collected</th>
                <th className="py-2 text-right">Total Purchases</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {partySummaries.map((p) => (
                <tr key={p.name}>
                  <td className="py-2.5 font-sans font-semibold">{p.name}</td>
                  <td className="py-2.5 text-right">{formatINR(p.sales)}</td>
                  <td className="py-2.5 text-right text-emerald-700 dark:text-emerald-400">{formatINR(p.receipts)}</td>
                  <td className="py-2.5 text-right">{formatINR(p.purchases)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'cash_flow' && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 max-w-2xl">
          <h2 className="text-base font-bold">Cash Flow & Fund Flow Summary</h2>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="font-sans">Operating Cash Inflow (Sales & Receipts)</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                +{formatINR(cashFlowSummary.operatingIn)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="font-sans">Operating Cash Outflow (Purchases & Expenses)</span>
              <span className="text-red-600 font-semibold">-{formatINR(cashFlowSummary.operatingOut)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="font-sans">Financing Outflow (Loan EMIs)</span>
              <span className="text-red-600">-{formatINR(cashFlowSummary.financingOut)}</span>
            </div>
            <div className="flex justify-between pt-3 text-sm font-bold">
              <span className="font-sans">Net Cash Flow</span>
              <span className={cashFlowSummary.netCashFlow >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                {formatINR(cashFlowSummary.netCashFlow)}
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === 'eway' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold">E-Way Bill & E-Invoice IRN Register</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Invoice #</th>
                <th className="py-2 text-left">Party</th>
                <th className="py-2 text-left">E-Way Bill No</th>
                <th className="py-2 text-left">Vehicle No</th>
                <th className="py-2 text-left">IRN</th>
                <th className="py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {db.vouchers
                .filter((v) => v.type === 'sale_invoice' && (v.ewayBillNo || v.irn || v.grandTotal >= 50000))
                .map((v) => (
                  <tr key={v.id}>
                    <td className="py-2.5 font-mono font-semibold">{v.voucherNo}</td>
                    <td className="py-2.5">{v.partyName}</td>
                    <td className="py-2.5 font-mono">{v.ewayBillNo || 'Pending'}</td>
                    <td className="py-2.5 font-mono">{v.vehicleNo || '-'}</td>
                    <td className="py-2.5 font-mono text-slate-500">{v.irn ? `${v.irn.slice(0, 18)}...` : '-'}</td>
                    <td className="py-2.5 text-right font-mono font-semibold">{formatINR(v.grandTotal)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
