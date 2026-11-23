import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Printer,
  Edit3,
  Trash2,
  Download,
  ArrowRightCircle,
  Copy,
  Ban,
  FileDown,
} from 'lucide-react';
import { Voucher, VoucherType } from '../types/accounting';
import { useStore } from '../context/StoreContext';
import { exportToCSV, formatINR, todayISO, VOUCHER_LABELS } from '../utils/formatters';
import { downloadInvoicePDF } from '../utils/pdfGenerator';

interface VoucherListViewProps {
  title: string;
  subtitle: string;
  voucherTypes: VoucherType[];
  defaultNewType: VoucherType;
  onCreateNew: (type: VoucherType) => void;
  onEdit: (voucher: Voucher) => void;
  onConvert: (source: Voucher, targetType: VoucherType) => void;
  onPrint: (voucher: Voucher) => void;
}

export const VoucherListView: React.FC<VoucherListViewProps> = ({
  title,
  subtitle,
  voucherTypes,
  defaultNewType,
  onCreateNew,
  onEdit,
  onConvert,
  onPrint,
}) => {
  const { db, getEffectivePaid, getEffectiveStatus, getNextVoucherNo, saveVoucher, cancelVoucher, deleteVoucher } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [typeTab, setTypeTab] = useState<VoucherType | 'all'>(
    voucherTypes.length === 1 ? voucherTypes[0] : 'all'
  );

  const filtered = useMemo(() => {
    if (!db) return [];
    return db.vouchers
      .filter((v) => voucherTypes.includes(v.type))
      .filter((v) => (typeTab === 'all' ? true : v.type === typeTab))
      .filter((v) => (fromDate ? v.date >= fromDate : true))
      .filter((v) => (toDate ? v.date <= toDate : true))
      .filter((v) => {
        if (statusFilter === 'all') return true;
        return getEffectiveStatus(v) === statusFilter;
      })
      .filter((v) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          v.voucherNo.toLowerCase().includes(q) ||
          (v.partyName || '').toLowerCase().includes(q) ||
          (v.expenseCategory || '').toLowerCase().includes(q) ||
          (v.notes || '').toLowerCase().includes(q)
        );
      });
  }, [db, voucherTypes, typeTab, fromDate, toDate, statusFilter, search, getEffectiveStatus]);

  if (!db) return null;

  const totalSum = filtered.filter((v) => v.status !== 'cancelled').reduce((s, v) => s + v.grandTotal, 0);
  const totalDue = filtered
    .filter((v) => v.status !== 'cancelled')
    .reduce((s, v) => {
      if (v.type !== 'sale_invoice' && v.type !== 'purchase_bill') return s;
      return s + Math.max(0, v.grandTotal - getEffectivePaid(v));
    }, 0);

  const handleDuplicate = async (v: Voucher) => {
    const cloned: Voucher = {
      ...v,
      id: '',
      voucherNo: getNextVoucherNo(v.type),
      date: todayISO(),
      paidAmount: 0,
      status:
        v.type === 'sale_invoice' || v.type === 'purchase_bill'
          ? 'unpaid'
          : v.type === 'estimate' || v.type === 'proforma' || v.type === 'sale_order' || v.type === 'purchase_order'
          ? 'open'
          : 'paid',
      lines: v.lines.map((l, idx) => ({ ...l, id: `dup_${Date.now()}_${idx}` })),
      createdAt: new Date().toISOString(),
    };
    await saveVoucher(cloned);
  };

  const handleExport = () => {
    exportToCSV(
      `${defaultNewType}_register.csv`,
      ['Date', 'Voucher No', 'Type', 'Party / Category', 'Taxable', 'GST', 'Grand Total', 'Paid', 'Status'],
      filtered.map((v) => [
        v.date,
        v.voucherNo,
        VOUCHER_LABELS[v.type],
        v.partyName || v.expenseCategory || '-',
        v.subTotal,
        v.taxTotal,
        v.grandTotal,
        getEffectivePaid(v),
        getEffectiveStatus(v),
      ])
    );
  };

  const getConversionTarget = (type: VoucherType): VoucherType | null => {
    if (type === 'estimate' || type === 'proforma' || type === 'sale_order' || type === 'delivery_challan') {
      return 'sale_invoice';
    }
    if (type === 'purchase_order') return 'purchase_bill';
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">{title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Excel / CSV
          </button>
          {voucherTypes.map((vt) => (
            <button
              key={vt}
              onClick={() => onCreateNew(vt)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                vt === defaultNewType
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              New {VOUCHER_LABELS[vt]}
            </button>
          ))}
        </div>
      </div>

      {/* Filters & Totals */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search voucher #, party..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white w-52"
            />
          </div>

          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />

          {voucherTypes.length > 1 && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              <button
                onClick={() => setTypeTab('all')}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                  typeTab === 'all'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                All
              </button>
              {voucherTypes.map((vt) => (
                <button
                  key={vt}
                  onClick={() => setTypeTab(vt)}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                    typeTab === vt
                      ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {VOUCHER_LABELS[vt]}
                </button>
              ))}
            </div>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <option value="all">All Status</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
            <option value="open">Open</option>
            <option value="converted">Converted</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-slate-500">
            Count: <strong className="text-slate-900 dark:text-white">{filtered.length}</strong>
          </span>
          <span className="text-slate-500">
            Total: <strong className="text-slate-900 dark:text-white">{formatINR(totalSum)}</strong>
          </span>
          {totalDue > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              Pending: <strong>{formatINR(totalDue)}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Data Grid */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-3 px-4 text-left">Date</th>
                <th className="py-3 px-3 text-left">Voucher #</th>
                <th className="py-3 px-3 text-left">Type</th>
                <th className="py-3 px-3 text-left">Party / Particular</th>
                <th className="py-3 px-3 text-right">Tax</th>
                <th className="py-3 px-3 text-right">Total</th>
                <th className="py-3 px-3 text-right">Balance</th>
                <th className="py-3 px-3 text-left">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No vouchers match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((v) => {
                  const effPaid = getEffectivePaid(v);
                  const effStatus = getEffectiveStatus(v);
                  const due =
                    v.status !== 'cancelled' && (v.type === 'sale_invoice' || v.type === 'purchase_bill')
                      ? Math.max(0, v.grandTotal - effPaid)
                      : 0;
                  const convTarget =
                    effStatus !== 'converted' && effStatus !== 'cancelled'
                      ? getConversionTarget(v.type)
                      : null;

                  const statusColor =
                    effStatus === 'paid' || effStatus === 'converted'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : effStatus === 'partial' || effStatus === 'open'
                      ? 'text-amber-700 dark:text-amber-400'
                      : effStatus === 'cancelled'
                      ? 'text-slate-400 line-through'
                      : 'text-red-700 dark:text-red-400';

                  return (
                    <tr
                      key={v.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                        effStatus === 'cancelled' ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">{v.date}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold whitespace-nowrap">{v.voucherNo}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{VOUCHER_LABELS[v.type]}</td>
                      <td className="py-2.5 px-3 max-w-[200px] truncate">
                        <div>{v.partyName || v.expenseCategory || v.notes || 'Ledger'}</div>
                        {(v.salesChannel || v.approvalStatus === 'pending_approval') && (
                          <div className="text-[10px] text-slate-400">
                            {v.salesChannel || ''}
                            {v.approvalStatus === 'pending_approval' ? ' · Pending Approval' : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500 whitespace-nowrap">
                        {formatINR(v.taxTotal)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold whitespace-nowrap">
                        {formatINR(v.grandTotal)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                        {formatINR(due)}
                      </td>
                      <td className={`py-2.5 px-3 font-medium capitalize whitespace-nowrap ${statusColor}`}>
                        {effStatus}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {convTarget && (
                            <button
                              onClick={() => onConvert(v, convTarget)}
                              title={`Convert to ${VOUCHER_LABELS[convTarget]}`}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                            >
                              <ArrowRightCircle className="w-3 h-3" />
                              Convert
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const party = db.parties.find((p) => p.id === v.partyId);
                              const bank = db.bankAccounts.find((b) => b.id === v.bankAccountId) || db.bankAccounts[0];
                              downloadInvoicePDF(v, db.profile, party, bank, effPaid);
                            }}
                            title="Download Vector PDF"
                            className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onPrint(v)}
                            title="Print / 15-Template Preview"
                            className="p-1.5 rounded text-slate-500 hover:text-indigo-600"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDuplicate(v)}
                            title="Duplicate Voucher"
                            className="p-1.5 rounded text-slate-500 hover:text-indigo-600"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {effStatus !== 'cancelled' && (
                            <>
                              <button
                                onClick={() => onEdit(v)}
                                title="Edit Voucher"
                                className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => cancelVoucher(v.id)}
                                title="Cancel Voucher (Reverses stock & ledger)"
                                className="p-1.5 rounded text-slate-500 hover:text-amber-600"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => deleteVoucher(v.id)}
                            title="Delete Permanently"
                            className="p-1.5 rounded text-slate-500 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
