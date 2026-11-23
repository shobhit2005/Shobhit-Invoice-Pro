import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  FileText,
  Download,
  MessageSquare,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Party } from '../types/accounting';
import {
  exportToCSV,
  formatINR,
  INDIAN_STATES,
  todayISO,
  validateGSTIN,
  VOUCHER_LABELS,
} from '../utils/formatters';
import { downloadReportPDF, formatPdfAmount } from '../utils/pdfGenerator';

export const PartiesView: React.FC = () => {
  const { db, getPartyBalance, saveParty, deleteParty } = useStore();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'customer' | 'supplier'>('all');
  const [selectedPartyId, setSelectedPartyId] = useState<string>(db?.parties[0]?.id || '');
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [showModal, setShowModal] = useState(false);

  const parties = db?.parties || [];
  const vouchers = db?.vouchers || [];

  const filteredParties = useMemo(() => {
    return parties
      .filter((p) => {
        if (filterType === 'customer') return p.type === 'customer' || p.type === 'both';
        if (filterType === 'supplier') return p.type === 'supplier' || p.type === 'both';
        return true;
      })
      .filter((p) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.phone.includes(q) ||
          p.gstin.toLowerCase().includes(q)
        );
      });
  }, [parties, filterType, search]);

  const activeParty = parties.find((p) => p.id === selectedPartyId) || filteredParties[0];

  const partyStatement = useMemo(() => {
    if (!activeParty) return { rows: [], closing: 0 };
    const opening =
      activeParty.openingBalance * (activeParty.openingType === 'receivable' ? 1 : -1);

    const txns = vouchers
      .filter((v) => v.partyId === activeParty.id && v.status !== 'cancelled')
      .filter((v) =>
        ['sale_invoice', 'credit_note', 'payment_in', 'purchase_bill', 'debit_note', 'payment_out'].includes(
          v.type
        )
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    let running = opening;
    const rows: {
      id: string;
      date: string;
      voucherNo: string;
      particular: string;
      debit: number;
      credit: number;
      balance: number;
    }[] = [
      {
        id: 'opening',
        date: '2026-04-01',
        voucherNo: 'OP-BAL',
        particular: 'Opening Balance',
        debit: opening > 0 ? opening : 0,
        credit: opening < 0 ? Math.abs(opening) : 0,
        balance: running,
      },
    ];

    for (const v of txns) {
      let dr = 0;
      let cr = 0;
      if (v.type === 'sale_invoice') {
        dr = v.grandTotal;
        cr = v.paidAmount;
      } else if (v.type === 'credit_note') {
        cr = v.grandTotal - v.paidAmount;
      } else if (v.type === 'payment_in') {
        cr = v.grandTotal;
      } else if (v.type === 'purchase_bill') {
        cr = v.grandTotal;
        dr = v.paidAmount;
      } else if (v.type === 'debit_note') {
        dr = v.grandTotal - v.paidAmount;
      } else if (v.type === 'payment_out') {
        dr = v.grandTotal;
      }
      running = Number((running + dr - cr).toFixed(2));
      rows.push({
        id: v.id,
        date: v.date,
        voucherNo: v.voucherNo,
        particular: `${VOUCHER_LABELS[v.type]}${v.notes ? ` · ${v.notes}` : ''}`,
        debit: dr,
        credit: cr,
        balance: running,
      });
    }

    return { rows, closing: running };
  }, [activeParty, vouchers]);

  if (!db) return null;

  const openNewPartyModal = () => {
    setEditingParty({
      id: '',
      name: '',
      type: 'customer',
      phone: '',
      email: '',
      gstin: '',
      pan: '',
      state: db.profile.state,
      billingAddress: '',
      shippingAddress: '',
      openingBalance: 0,
      openingType: 'receivable',
      creditLimit: 100000,
      creditDays: 30,
      group: 'Sundry Debtors',
      createdAt: todayISO(),
    });
    setShowModal(true);
  };

  const handleSavePartyForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingParty || !editingParty.name.trim()) return;
    await saveParty({
      ...editingParty,
      id: editingParty.id || `p_${Date.now()}`,
      pan: editingParty.gstin ? editingParty.gstin.slice(2, 12).toUpperCase() : editingParty.pan,
    });
    setShowModal(false);
    setEditingParty(null);
  };

  const handleWhatsApp = (party: Party, bal: number) => {
    const phone = party.phone.replace(/\D/g, '');
    const msg = `Dear ${party.name},\nYour current ledger balance with ${db.profile.companyName} is ${formatINR(
      Math.abs(bal)
    )} (${bal >= 0 ? 'Receivable' : 'Payable'}).\nUPI ID: ${db.profile.upiId}`;
    const url = phone
      ? `https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Parties &amp; Accounting Ledger Statements
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Customers, Suppliers, Credit Limits, GSTINs, and Chronological Dr/Cr Ledgers
          </p>
        </div>

        <button
          onClick={openNewPartyModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          Add New Party
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search party name, phone, GSTIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              {(['all', 'customer', 'supplier'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`flex-1 py-1 px-2 rounded-md font-medium capitalize ${
                    filterType === t
                      ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t === 'all' ? 'All Parties' : `${t}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
            {filteredParties.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No parties found. Click "Add New Party" to create one.
              </div>
            ) : (
              filteredParties.map((p) => {
                const bal = getPartyBalance(p.id);
                const isSelected = activeParty?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPartyId(p.id)}
                    className={`w-full text-left p-3.5 flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate">
                        {p.type.toUpperCase()} · {p.state} {p.gstin ? `· ${p.gstin}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`text-xs font-mono font-semibold tabular-nums ${
                          bal > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : bal < 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {formatINR(Math.abs(bal))}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {bal > 0 ? 'To Collect' : bal < 0 ? 'To Pay' : 'Settled'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-5">
          {!activeParty ? (
            <div className="py-16 text-center text-xs text-slate-500">
              Select a party to inspect their details and double-entry ledger statement.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    {activeParty.name}
                  </h2>
                  <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                    Ph: {activeParty.phone || '-'} · State: {activeParty.state} · GSTIN:{' '}
                    {activeParty.gstin || 'Unregistered'}
                  </div>
                  <div className="text-xs text-slate-500">{activeParty.billingAddress}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    Credit Limit: {formatINR(activeParty.creditLimit)} · Credit Period:{' '}
                    {activeParty.creditDays} days · Risk: {activeParty.riskCategory || 'Low'}
                    {activeParty.creditHold ? ' · CREDIT HOLD' : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleWhatsApp(activeParty, partyStatement.closing)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    WhatsApp
                  </button>
                  <button
                    onClick={() =>
                      downloadReportPDF({
                        title: `Party Ledger Statement — ${activeParty.name}`,
                        subtitle: `GSTIN: ${activeParty.gstin || 'Unregistered'} | State: ${activeParty.state} | Closing: ${formatPdfAmount(Math.abs(partyStatement.closing))} ${partyStatement.closing >= 0 ? 'Dr' : 'Cr'}`,
                        companyName: db.profile.companyName,
                        headers: ['Date', 'Voucher', 'Particular', 'Debit', 'Credit', 'Balance'],
                        rows: partyStatement.rows.map((r) => [
                          r.date,
                          r.voucherNo,
                          r.particular,
                          r.debit > 0 ? formatPdfAmount(r.debit) : '-',
                          r.credit > 0 ? formatPdfAmount(r.credit) : '-',
                          `${formatPdfAmount(Math.abs(r.balance))} ${r.balance >= 0 ? 'Dr' : 'Cr'}`,
                        ]),
                        filename: `${activeParty.name.replace(/\s+/g, '_')}_Ledger.pdf`,
                      })
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Ledger PDF
                  </button>
                  <button
                    onClick={() =>
                      exportToCSV(
                        `${activeParty.name.replace(/\s+/g, '_')}_ledger.csv`,
                        ['Date', 'Voucher', 'Particular', 'Debit', 'Credit', 'Balance'],
                        partyStatement.rows.map((r) => [
                          r.date,
                          r.voucherNo,
                          r.particular,
                          r.debit,
                          r.credit,
                          r.balance,
                        ])
                      )
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    CSV
                  </button>
                  <button
                    onClick={() => {
                      setEditingParty(activeParty);
                      setShowModal(true);
                    }}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    title="Edit Party"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteParty(activeParty.id)}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600"
                    title="Delete Party"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    Ledger Statement (Dr / Cr Running Balance)
                  </h3>
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                    Closing: {formatINR(Math.abs(partyStatement.closing))}{' '}
                    {partyStatement.closing >= 0 ? 'Dr' : 'Cr'}
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 px-3 text-left">Date</th>
                        <th className="py-2 px-3 text-left">Vch #</th>
                        <th className="py-2 px-3 text-left">Particular</th>
                        <th className="py-2 px-3 text-right">Debit (₹)</th>
                        <th className="py-2 px-3 text-right">Credit (₹)</th>
                        <th className="py-2 px-3 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {partyStatement.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">
                            {r.date}
                          </td>
                          <td className="py-2 px-3 font-mono font-medium whitespace-nowrap">
                            {r.voucherNo}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300 max-w-[200px] truncate">
                            {r.particular}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                            {r.debit > 0 ? formatINR(r.debit) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                            {r.credit > 0 ? formatINR(r.credit) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                            {formatINR(Math.abs(r.balance))} {r.balance >= 0 ? 'Dr' : 'Cr'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showModal && editingParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSavePartyForm}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingParty.id ? 'Edit Party' : 'Add New Party'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Party Name *
                </label>
                <input
                  type="text"
                  required
                  value={editingParty.name}
                  onChange={(e) => setEditingParty({ ...editingParty, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Party Type
                </label>
                <select
                  value={editingParty.type}
                  onChange={(e) =>
                    setEditingParty({
                      ...editingParty,
                      type: e.target.value as Party['type'],
                      group: e.target.value === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors',
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="customer">Customer (Debtor)</option>
                  <option value="supplier">Supplier (Creditor)</option>
                  <option value="both">Both Customer & Supplier</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={editingParty.phone}
                  onChange={(e) => setEditingParty({ ...editingParty, phone: e.target.value })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  GSTIN (15-char)
                </label>
                <input
                  type="text"
                  placeholder="27AABCA9281K1Z5"
                  value={editingParty.gstin}
                  onChange={(e) =>
                    setEditingParty({ ...editingParty, gstin: e.target.value.toUpperCase() })
                  }
                  className={`w-full px-3 py-2 font-mono rounded-lg border bg-white dark:bg-slate-800 ${
                    validateGSTIN(editingParty.gstin)
                      ? 'border-slate-200 dark:border-slate-700'
                      : 'border-red-500'
                  }`}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  State
                </label>
                <select
                  value={editingParty.state}
                  onChange={(e) => setEditingParty({ ...editingParty, state: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Opening Balance (₹)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={editingParty.openingBalance}
                    onChange={(e) =>
                      setEditingParty({ ...editingParty, openingBalance: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <select
                    value={editingParty.openingType}
                    onChange={(e) =>
                      setEditingParty({
                        ...editingParty,
                        openingType: e.target.value as 'receivable' | 'payable',
                      })
                    }
                    className="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="receivable">To Collect</option>
                    <option value="payable">To Pay</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Credit Limit (₹)
                </label>
                <input
                  type="number"
                  value={editingParty.creditLimit}
                  onChange={(e) =>
                    setEditingParty({ ...editingParty, creditLimit: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Credit Period (Days)
                </label>
                <input
                  type="number"
                  value={editingParty.creditDays}
                  onChange={(e) =>
                    setEditingParty({ ...editingParty, creditDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Risk Category
                </label>
                <select
                  value={editingParty.riskCategory || 'Low'}
                  onChange={(e) =>
                    setEditingParty({
                      ...editingParty,
                      riskCategory: e.target.value as 'Low' | 'Medium' | 'High',
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="Low">Low Risk</option>
                  <option value="Medium">Medium Risk</option>
                  <option value="High">High Risk</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Avg Delivery (Days)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingParty.avgDeliveryDays ?? 3}
                    onChange={(e) =>
                      setEditingParty({ ...editingParty, avgDeliveryDays: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Quality Rating (1-5)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    step="0.1"
                    value={editingParty.qualityRating ?? 4.5}
                    onChange={(e) =>
                      setEditingParty({ ...editingParty, qualityRating: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingParty.creditHold)}
                    onChange={(e) =>
                      setEditingParty({ ...editingParty, creditHold: e.target.checked })
                    }
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  Place Credit Hold (Warn before issuing credit sales invoices)
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Billing Address
                </label>
                <input
                  type="text"
                  value={editingParty.billingAddress}
                  onChange={(e) =>
                    setEditingParty({
                      ...editingParty,
                      billingAddress: e.target.value,
                      shippingAddress: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Save Party
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
