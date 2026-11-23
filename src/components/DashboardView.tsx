import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  ShoppingCart,
  AlertTriangle,
  MessageSquare,
  Printer,
  Package,
  Landmark,
  TrendingUp,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { formatCompactINR, formatINR, todayISO, VOUCHER_LABELS } from '../utils/formatters';
import { Voucher, VoucherType } from '../types/accounting';

interface DashboardViewProps {
  onNewVoucher: (type: VoucherType) => void;
  onOpenPOS: () => void;
  onPrintVoucher: (v: Voucher) => void;
  onNavigate: (tab: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNewVoucher,
  onOpenPOS,
  onPrintVoucher,
  onNavigate,
}) => {
  const {
    db,
    getEffectivePaid,
    getEffectiveStatus,
    getPartyBalance,
    getTotalBankBalance,
    getTotalCashBalance,
    getTotalStockValue,
  } = useStore();

  const [periodMode, setPeriodMode] = useState<'fy' | 'month'>('fy');

  const metrics = useMemo(() => {
    const empty = {
      netSalesGross: 0,
      purchases: 0,
      expenses: 0,
      grossProfit: 0,
      netProfit: 0,
      receivable: 0,
      payable: 0,
      cashBal: 0,
      bankBal: 0,
      stockVal: 0,
      growthPct: 0,
      topItems: [] as { name: string; qty: number; revenue: number }[],
      topCustomers: [] as { name: string; total: number; count: number }[],
    };
    if (!db) return empty;
    const activeMonth = todayISO().slice(0, 7);
    const inPeriod = (dateStr: string) => (periodMode === 'month' ? dateStr.startsWith(activeMonth) : true);

    const salesVouchers = db.vouchers.filter(
      (v) => v.type === 'sale_invoice' && v.status !== 'cancelled' && inPeriod(v.date)
    );
    const creditNotes = db.vouchers.filter(
      (v) => v.type === 'credit_note' && v.status !== 'cancelled' && inPeriod(v.date)
    );
    const purchases = db.vouchers
      .filter((v) => v.type === 'purchase_bill' && v.status !== 'cancelled' && inPeriod(v.date))
      .reduce((s, v) => s + v.grandTotal, 0);
    const expenses = db.vouchers
      .filter((v) => v.type === 'expense' && v.status !== 'cancelled' && inPeriod(v.date))
      .reduce((s, v) => s + v.grandTotal, 0);

    const netSalesGross = salesVouchers.reduce((s, v) => s + v.grandTotal, 0) - creditNotes.reduce((s, v) => s + v.grandTotal, 0);
    const netSalesTaxable = salesVouchers.reduce((s, v) => s + v.subTotal, 0) - creditNotes.reduce((s, v) => s + v.subTotal, 0);

    let cogs = 0;
    const itemStats = new Map<string, { name: string; qty: number; revenue: number }>();
    const customerStats = new Map<string, { name: string; total: number; count: number }>();

    for (const v of salesVouchers) {
      if (v.partyName) {
        const prev = customerStats.get(v.partyName) || { name: v.partyName, total: 0, count: 0 };
        prev.total += v.grandTotal;
        prev.count += 1;
        customerStats.set(v.partyName, prev);
      }
      for (const l of v.lines) {
        const it = db.items.find((x) => x.id === l.itemId);
        if (it) cogs += l.qty * it.purchasePrice;
        const p = itemStats.get(l.itemName) || { name: l.itemName, qty: 0, revenue: 0 };
        p.qty += l.qty;
        p.revenue += l.taxableAmount;
        itemStats.set(l.itemName, p);
      }
    }

    const grossProfit = netSalesTaxable - cogs;
    const netProfit = grossProfit - expenses;

    let receivable = 0;
    let payable = 0;
    for (const p of db.parties) {
      const bal = getPartyBalance(p.id);
      if (bal > 0) receivable += bal;
      else if (bal < 0) payable += Math.abs(bal);
    }

    // Month-over-Month Growth Calculation
    const thisMonthSales = db.vouchers
      .filter((v) => v.type === 'sale_invoice' && v.status !== 'cancelled' && v.date.startsWith('2026-11'))
      .reduce((s, v) => s + v.grandTotal, 0);
    const prevMonthSales = db.vouchers
      .filter((v) => v.type === 'sale_invoice' && v.status !== 'cancelled' && v.date.startsWith('2026-10'))
      .reduce((s, v) => s + v.grandTotal, 0);
    const growthPct =
      prevMonthSales > 0 ? ((thisMonthSales - prevMonthSales) / prevMonthSales) * 100 : 0;

    return {
      netSalesGross,
      purchases,
      expenses,
      grossProfit,
      netProfit,
      receivable,
      payable,
      cashBal: getTotalCashBalance(),
      bankBal: getTotalBankBalance(),
      stockVal: getTotalStockValue(),
      growthPct,
      topItems: Array.from(itemStats.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      topCustomers: Array.from(customerStats.values()).sort((a, b) => b.total - a.total).slice(0, 5),
    };
  }, [db, periodMode, getPartyBalance, getTotalBankBalance, getTotalCashBalance, getTotalStockValue]);

  const monthlySeries = useMemo(() => {
    const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
    const labels = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
    const vList = db?.vouchers || [];
    return months.map((m, i) => {
      const s = vList
        .filter((v) => v.type === 'sale_invoice' && v.status !== 'cancelled' && v.date.startsWith(m))
        .reduce((sum, v) => sum + v.grandTotal, 0);
      const p = vList
        .filter(
          (v) =>
            (v.type === 'purchase_bill' || v.type === 'expense') &&
            v.status !== 'cancelled' &&
            v.date.startsWith(m)
        )
        .reduce((sum, v) => sum + v.grandTotal, 0);
      return { month: labels[i], sales: s, outflow: p };
    });
  }, [db?.vouchers]);

  const maxChartVal = Math.max(50000, ...monthlySeries.map((m) => Math.max(m.sales, m.outflow)));

  const lowStockItems = useMemo(
    () => (db?.items || []).filter((i) => i.type === 'product' && i.stockQty <= i.minStockAlert),
    [db?.items]
  );

  const pendingInvoices = useMemo(
    () =>
      (db?.vouchers || [])
        .filter((v) => v.type === 'sale_invoice' && v.status !== 'cancelled' && getEffectiveStatus(v) !== 'paid')
        .map((v) => ({ ...v, dueAmount: Math.max(0, v.grandTotal - getEffectivePaid(v)) }))
        .sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date)),
    [db?.vouchers, getEffectivePaid, getEffectiveStatus]
  );

  if (!db) return null;

  const widgets = db.profile.appSettings?.general.dashboardWidgets || {
    showQuickActions: true,
    showKpis: true,
    showRevenueChart: true,
    showPendingReminders: true,
    showTopProducts: true,
    showTopCustomers: true,
    showLowStock: true,
    showRecentVouchers: true,
  };
  const allWidgetsHidden = Object.values(widgets).every((v) => !v);

  const sendWhatsAppReminder = (v: Voucher & { dueAmount: number }) => {
    const party = db.parties.find((p) => p.id === v.partyId);
    const phone = (party?.phone || '').replace(/\D/g, '');
    const msg = `Payment Reminder from ${db.profile.companyName}:\nInvoice ${v.voucherNo} (${v.date}) pending balance: ${formatINR(
      v.dueAmount
    )}.\nPay via UPI: ${db.profile.upiId}`;
    const url = phone
      ? `https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-6">
      {/* Unified Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#243746] dark:text-white tracking-tight">
            {db.profile.companyName}
          </h1>
          <p className="text-xs text-[#84909D] dark:text-slate-400">
            FY {db.profile.financialYear} · GSTIN {db.profile.gstin || 'Unregistered'} · {db.profile.state}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs mr-1">
            <button
              onClick={() => setPeriodMode('fy')}
              className={`px-2.5 py-1 rounded-md font-semibold whitespace-nowrap ${
                periodMode === 'fy'
                  ? 'bg-[#168C88] text-white shadow-xs'
                  : 'text-[#84909D] dark:text-slate-400 hover:text-[#243746]'
              }`}
            >
              Full FY
            </button>
            <button
              onClick={() => setPeriodMode('month')}
              className={`px-2.5 py-1 rounded-md font-semibold whitespace-nowrap ${
                periodMode === 'month'
                  ? 'bg-[#168C88] text-white shadow-xs'
                  : 'text-[#84909D] dark:text-slate-400 hover:text-[#243746]'
              }`}
            >
              This Month
            </button>
          </div>

          {widgets.showQuickActions && (
            <>
              <button
                onClick={() => onNewVoucher('sale_invoice')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Sale Invoice
              </button>
              <button
                onClick={onOpenPOS}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#243746] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <ShoppingCart className="w-3.5 h-3.5 text-[#168C88] dark:text-teal-400" />
                POS Counter
              </button>
              <button
                onClick={() => onNewVoucher('purchase_bill')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#243746] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-[#168C88]" />
                Purchase
              </button>
            </>
          )}
        </div>
      </div>

      {allWidgetsHidden && (
        <div className="p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
          <div className="text-sm font-semibold text-[#243746] dark:text-slate-200">
            All Dashboard Grid Widgets are currently turned off
          </div>
          <p className="text-xs text-[#84909D]">
            Turn dashboard KPIs, charts, and lists back ON from Settings → General → Dashboard Grid Visibility.
          </p>
          <button
            onClick={() => onNavigate('settings')}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white"
          >
            Open Dashboard Settings
          </button>
        </div>
      )}

      {/* Unified 8-Metric Financial Strip */}
      {widgets.showKpis && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => onNavigate('sales_invoices')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-[#84909D]">
            <span>Total Sales (Net)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#168C88]" />
          </div>
          <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#243746] dark:text-white">
            {formatINR(metrics.netSalesGross)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-[#84909D]">
            MoM Growth: {metrics.growthPct >= 0 ? '+' : ''}
            {metrics.growthPct.toFixed(1)}%
          </div>
        </button>

        <button
          onClick={() => onNavigate('purchase_bills')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-[#84909D]">
            <span>Purchases & Expenses</span>
            <ArrowDownLeft className="w-3.5 h-3.5 text-[#84909D]" />
          </div>
          <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#243746] dark:text-white">
            {formatINR(metrics.purchases + metrics.expenses)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-[#84909D]">
            Pur: {formatCompactINR(metrics.purchases)} · Exp: {formatCompactINR(metrics.expenses)}
          </div>
        </button>

        <button
          onClick={() => onNavigate('accounting')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-[#84909D]">
            <span>Gross & Net Profit</span>
            <TrendingUp className="w-3.5 h-3.5 text-[#16A34A]" />
          </div>
          <div
            className={`mt-1.5 text-lg font-bold font-mono tabular-nums ${
              metrics.netProfit >= 0 ? 'text-[#16A34A] dark:text-emerald-400' : 'text-[#EF4444]'
            }`}
          >
            {formatINR(metrics.netProfit)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-[#84909D]">
            Gross Profit: {formatCompactINR(metrics.grossProfit)}
          </div>
        </button>

        <button
          onClick={() => onNavigate('banking')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-[#84909D]">
            <span>Cash & Bank Balance</span>
            <Landmark className="w-3.5 h-3.5 text-[#168C88]" />
          </div>
          <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#243746] dark:text-white">
            {formatINR(metrics.cashBal + metrics.bankBal)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-[#84909D]">
            Cash: {formatCompactINR(metrics.cashBal)} · Bank: {formatCompactINR(metrics.bankBal)}
          </div>
        </button>

        <button
          onClick={() => onNavigate('parties')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="text-xs text-[#84909D]">Receivables (To Collect)</div>
          <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#16A34A] dark:text-emerald-400">
            {formatINR(metrics.receivable)}
          </div>
          <div className="mt-1 text-[11px] text-[#84909D]">{pendingInvoices.length} open invoices</div>
        </button>

        <button
          onClick={() => onNavigate('parties')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="text-xs text-[#84909D]">Payables (To Pay)</div>
          <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#EF4444] dark:text-red-400">
            {formatINR(metrics.payable)}
          </div>
          <div className="mt-1 text-[11px] text-[#84909D]">Supplier balances</div>
        </button>

        <button
          onClick={() => onNavigate('inventory')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-[#84909D]">
            <span>Stock Valuation</span>
            <Package className="w-3.5 h-3.5 text-[#84909D]" />
          </div>
          <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#243746] dark:text-white">
            {formatINR(metrics.stockVal)}
          </div>
          <div className="mt-1 text-[11px] text-[#84909D]">{db.items.length} catalog SKUs</div>
        </button>

        <button
          onClick={() => onNavigate('inventory')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#168C88] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-[#84909D]">
            <span>Low Stock Alerts</span>
            <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />
          </div>
          <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#F59E0B]">
            {lowStockItems.length} Items
          </div>
          <div className="mt-1 text-[11px] text-[#84909D]">Below threshold level</div>
        </button>
      </div>
      )}

      {/* Main Analytics Split */}
      {(widgets.showRevenueChart || widgets.showPendingReminders) && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {widgets.showRevenueChart && (
        <div className={`${widgets.showPendingReminders ? 'lg:col-span-7' : 'lg:col-span-12'} p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#243746] dark:text-white">
                Monthly Revenue vs Purchases & Expenses
              </h2>
              <p className="text-xs text-[#84909D]">Live figures from relational voucher ledger</p>
            </div>
          </div>

          <div className="h-56 w-full">
            <svg viewBox="0 0 600 210" className="w-full h-full overflow-visible">
              {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                const y = 175 - t * 145;
                return (
                  <g key={idx}>
                    <line
                      x1="45"
                      y1={y}
                      x2="585"
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                      strokeDasharray="3 3"
                    />
                    <text x="40" y={y + 4} textAnchor="end" className="fill-[#84909D] text-[10px] font-mono">
                      {Math.round((maxChartVal * t) / 1000)}k
                    </text>
                  </g>
                );
              })}

              {monthlySeries.map((pt, idx) => {
                const groupX = 68 + idx * 86;
                const salesH = Math.max(4, (pt.sales / maxChartVal) * 145);
                const outH = Math.max(4, (pt.outflow / maxChartVal) * 145);
                return (
                  <g key={pt.month}>
                    <rect
                      x={groupX}
                      y={175 - salesH}
                      width="24"
                      height={salesH}
                      rx="3"
                      fill="#168C88"
                    >
                      <title>{`${pt.month} Sales: ${formatINR(pt.sales)}`}</title>
                    </rect>
                    <rect
                      x={groupX + 28}
                      y={175 - outH}
                      width="24"
                      height={outH}
                      rx="3"
                      fill="#CBD5E1"
                    >
                      <title>{`${pt.month} Outflow: ${formatINR(pt.outflow)}`}</title>
                    </rect>
                    <text x={groupX + 26} y="196" textAnchor="middle" className="fill-[#84909D] text-[11px]">
                      {pt.month}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex items-center gap-6 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-[#84909D] dark:text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-[#168C88] inline-block" />
              Sales Revenue
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-slate-300 dark:bg-slate-700 inline-block" />
              Purchases & Expenses
            </span>
          </div>
        </div>
        )}

        {/* Pending Collections */}
        {widgets.showPendingReminders && (
        <div className={`${widgets.showRevenueChart ? 'lg:col-span-5' : 'lg:col-span-12'} p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-[#243746] dark:text-white">
                Outstanding Payment Reminders
              </h2>
              <p className="text-xs text-[#84909D]">Unpaid & partial invoices</p>
            </div>
            <button
              onClick={() => onNavigate('reports_gst')}
              className="text-xs font-medium text-[#2676A8] hover:underline"
            >
              Aging Report
            </button>
          </div>

          <div className="flex-1 divide-y divide-slate-100 dark:divide-slate-800">
            {pendingInvoices.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#84909D]">No pending collections.</div>
            ) : (
              pendingInvoices.slice(0, 5).map((inv) => (
                <div key={inv.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#243746] dark:text-white truncate">
                      {inv.partyName}
                    </div>
                    <div className="text-[11px] font-mono text-[#84909D]">
                      {inv.voucherNo} · Due {inv.dueDate || inv.date}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono font-semibold text-[#F59E0B]">
                      {formatINR(inv.dueAmount)}
                    </span>
                    <button
                      onClick={() => sendWhatsAppReminder(inv)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <MessageSquare className="w-3 h-3 text-[#16A34A]" />
                      Remind
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        )}
      </div>
      )}

      {/* Top Products, Top Customers & Low Stock */}
      {(widgets.showTopProducts || widgets.showTopCustomers || widgets.showLowStock) && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {widgets.showTopProducts && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold text-[#243746] dark:text-white">Top-Selling Products</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {metrics.topItems.length === 0 ? (
              <div className="py-6 text-center text-[#84909D]">No sales recorded yet.</div>
            ) : (
              metrics.topItems.map((it) => (
                <div key={it.name} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[#243746] dark:text-slate-100 truncate">{it.name}</div>
                    <div className="text-[11px] font-mono text-[#84909D]">Qty sold: {it.qty}</div>
                  </div>
                  <span className="font-mono font-semibold text-[#243746] dark:text-white shrink-0">{formatINR(it.revenue)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        {widgets.showTopCustomers && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold text-[#243746] dark:text-white">Top Customers</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {metrics.topCustomers.length === 0 ? (
              <div className="py-6 text-center text-[#84909D]">No customer sales yet.</div>
            ) : (
              metrics.topCustomers.map((c) => (
                <div key={c.name} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[#243746] dark:text-slate-100 truncate">{c.name}</div>
                    <div className="text-[11px] font-mono text-[#84909D]">{c.count} invoices</div>
                  </div>
                  <span className="font-mono font-semibold text-[#243746] dark:text-white shrink-0">{formatINR(c.total)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        {widgets.showLowStock && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#243746] dark:text-white">Low Stock Watchlist</h2>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-[#2676A8] hover:underline"
            >
              Inventory
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {lowStockItems.length === 0 ? (
              <div className="py-6 text-center text-[#84909D]">All products are sufficiently stocked.</div>
            ) : (
              lowStockItems.map((it) => (
                <div key={it.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[#243746] dark:text-slate-100 truncate">{it.name}</div>
                    <div className="text-[11px] font-mono text-[#84909D]">Min: {it.minStockAlert} {it.unit}</div>
                  </div>
                  <span className="font-mono font-semibold text-[#EF4444] shrink-0">
                    {it.stockQty} {it.unit}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        )}
      </div>
      )}

      {/* Recent Transactions */}
      {widgets.showRecentVouchers && (
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#243746] dark:text-white">
            Recent Vouchers & Transactions
          </h2>
          <button
            onClick={() => onNavigate('accounting')}
            className="text-xs font-medium text-[#2676A8] hover:underline"
          >
            Open Day Book
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#E5EFF3] dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[#243746] dark:text-slate-200">
                <th className="py-2.5 px-3 text-left font-bold">Date</th>
                <th className="py-2.5 px-3 text-left font-bold">Voucher #</th>
                <th className="py-2.5 px-3 text-left font-bold">Type</th>
                <th className="py-2.5 px-3 text-left font-bold">Party / Head</th>
                <th className="py-2.5 px-3 text-right font-bold">Amount</th>
                <th className="py-2.5 px-3 text-right font-bold">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {db.vouchers.slice(0, 8).map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-mono text-[#84909D]">{v.date}</td>
                  <td className="py-2.5 px-3 font-mono font-semibold text-[#243746] dark:text-white">{v.voucherNo}</td>
                  <td className="py-2.5 px-3 text-[#243746] dark:text-slate-300">{VOUCHER_LABELS[v.type]}</td>
                  <td className="py-2.5 px-3 truncate max-w-[220px] text-[#243746] dark:text-slate-300">
                    {v.partyName || v.expenseCategory || v.notes || 'Ledger'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#243746] dark:text-white">{formatINR(v.grandTotal)}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => onPrintVoucher(v)}
                      className="p-1 text-[#84909D] hover:text-[#168C88]"
                    >
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
    </div>
  );
};
