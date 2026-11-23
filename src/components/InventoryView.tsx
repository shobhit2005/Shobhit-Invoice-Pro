import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  ArrowLeftRight,
  SlidersHorizontal,
  Barcode,
  Printer,
  Calendar,
  History,
  X,
  Download,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Item } from '../types/accounting';
import { formatINR, generateCode39Bars, ITEM_UNITS, todayISO, VOUCHER_LABELS } from '../utils/formatters';
import { downloadReportPDF, formatPdfAmount } from '../utils/pdfGenerator';

type InvTab = 'items' | 'adjustments' | 'batches' | 'godowns' | 'timeline' | 'barcodes';

export const InventoryView: React.FC = () => {
  const {
    db,
    saveItem,
    deleteItem,
    saveStockAdjustment,
    saveGodown,
    saveStockTransfer,
  } = useStore();

  const [tab, setTab] = useState<InvTab>('items');
  const [search, setSearch] = useState('');
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  const items = db?.items || [];
  const godowns = db?.godowns || [];
  const vouchers = db?.vouchers || [];
  const stockAdjustments = db?.stockAdjustments || [];

  const [adjItemId, setAdjItemId] = useState(items[0]?.id || '');
  const [adjType, setAdjType] = useState<'add' | 'reduce'>('add');
  const [adjQty, setAdjQty] = useState(5);
  const [adjReason, setAdjReason] = useState('Physical Audit Correction');

  const [newGodownName, setNewGodownName] = useState('');
  const [newGodownLoc, setNewGodownLoc] = useState('');
  const [trfFrom, setTrfFrom] = useState(godowns[0]?.id || '');
  const [trfTo, setTrfTo] = useState(godowns[1]?.id || godowns[0]?.id || '');
  const [trfItemId, setTrfItemId] = useState(items[0]?.id || '');
  const [trfQty, setTrfQty] = useState(5);

  const [timelineItemId, setTimelineItemId] = useState(items[0]?.id || '');
  const [barcodeItemIds, setBarcodeItemIds] = useState<string[]>(
    items.slice(0, 4).map((i) => i.id)
  );

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim();
    return items.filter(
      (i) =>
        !q ||
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.hsn.includes(q) ||
        i.category.toLowerCase().includes(q)
    );
  }, [items, search]);

  const timelineRows = useMemo(() => {
    const rows: { date: string; ref: string; event: string; change: number }[] = [];
    for (const v of vouchers) {
      if (v.status === 'cancelled') continue;
      for (const l of v.lines) {
        if (l.itemId !== timelineItemId) continue;
        let change = 0;
        if (v.type === 'sale_invoice' || v.type === 'debit_note') change = -l.qty;
        else if (v.type === 'purchase_bill' || v.type === 'credit_note') change = l.qty;
        if (change !== 0) {
          rows.push({
            date: v.date,
            ref: v.voucherNo,
            event: `${VOUCHER_LABELS[v.type]} (${v.partyName || ''})`,
            change,
          });
        }
      }
    }
    for (const a of stockAdjustments) {
      if (a.itemId === timelineItemId) {
        rows.push({
          date: a.date,
          ref: 'ADJ',
          event: `Stock Adjustment: ${a.reason}`,
          change: a.type === 'add' ? a.qty : -a.qty,
        });
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [vouchers, stockAdjustments, timelineItemId]);

  if (!db) return null;

  const openNewItem = () => {
    setEditingItem({
      id: '',
      name: '',
      type: 'product',
      sku: `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      barcode: `890${Math.floor(100000000 + Math.random() * 899999999)}`,
      hsn: '8536',
      category: 'General',
      subcategory: '',
      unit: 'PCS',
      secondaryUnit: 'BOX',
      conversionRate: 10,
      salePrice: 100,
      purchasePrice: 75,
      mrp: 120,
      wholesalePrice: 90,
      taxRate: 18,
      cessRate: 0,
      taxInclusive: false,
      openingStock: 0,
      stockQty: 0,
      minStockAlert: 10,
      godownId: db.godowns[0]?.id || 'g1',
      trackBatch: false,
      batches: [],
    });
    setShowItemModal(true);
  };

  const handleSaveItemForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.name.trim()) return;
    await saveItem({
      ...editingItem,
      id: editingItem.id || `i_${Date.now()}`,
      openingStock: editingItem.openingStock ?? editingItem.stockQty,
      godownStock: editingItem.godownStock || { [editingItem.godownId]: editingItem.stockQty },
    });
    setShowItemModal(false);
    setEditingItem(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Inventory, Godowns & Barcode Studio
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Items, Categories, Multiple Units (PCS/KG/BOX/LTR/MTR), Batches & Expiry, Multi-Warehouse & Code-39 Barcodes
          </p>
        </div>

        <button
          onClick={openNewItem}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item / Service
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        {[
          { id: 'items', label: 'Items & Pricing' },
          { id: 'adjustments', label: 'Stock Adjustments' },
          { id: 'batches', label: 'Batch & Expiry' },
          { id: 'godowns', label: 'Godowns & Transfers' },
          { id: 'timeline', label: 'Item Timeline' },
          { id: 'barcodes', label: 'Barcode Labels' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as InvTab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search item, SKU, HSN, category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <button
              onClick={() => {
                const totalVal = filteredItems.reduce(
                  (s, it) => s + (it.type === 'product' ? it.stockQty * it.purchasePrice : 0),
                  0
                );
                downloadReportPDF({
                  title: 'Inventory Stock Valuation Report',
                  subtitle: `Items: ${filteredItems.length} | Total Cost Valuation: ${formatPdfAmount(totalVal)}`,
                  companyName: db.profile.companyName,
                  headers: ['SKU', 'Item Name', 'HSN', 'Bin', 'Stock Qty', 'Cost Rate', 'Stock Value'],
                  rows: filteredItems.map((it) => [
                    it.sku,
                    it.name,
                    it.hsn,
                    it.binLocation || '-',
                    it.type === 'product' ? `${it.stockQty} ${it.unit}` : 'Service',
                    formatPdfAmount(it.purchasePrice),
                    it.type === 'product' ? formatPdfAmount(it.stockQty * it.purchasePrice) : '-',
                  ]),
                  filename: `Stock_Valuation_${todayISO()}.pdf`,
                });
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Download className="w-3.5 h-3.5" />
              Stock Valuation PDF
            </button>
          </div>

          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2.5 px-4 text-left">Item / SKU</th>
                    <th className="py-2.5 px-3 text-left">HSN / GST</th>
                    <th className="py-2.5 px-3 text-right">Purchase</th>
                    <th className="py-2.5 px-3 text-right">Sale / Wholesale</th>
                    <th className="py-2.5 px-3 text-right">MRP</th>
                    <th className="py-2.5 px-3 text-right">Stock Qty</th>
                    <th className="py-2.5 px-3 text-right">Stock Value</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredItems.map((item) => {
                    const isLow = item.type === 'product' && item.stockQty <= item.minStockAlert;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white">{item.name}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {item.sku} · {item.category}{item.subcategory ? ` / ${item.subcategory}` : ''}
                            {item.secondaryUnit
                              ? ` · 1 ${item.secondaryUnit} = ${item.conversionRate} ${item.unit}`
                              : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                          {item.hsn} · {item.taxRate}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(item.purchasePrice)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          <div className="font-semibold">{formatINR(item.salePrice)}</div>
                          <div className="text-[10px] text-slate-500">WS: {formatINR(item.wholesalePrice)}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                          {formatINR(item.mrp)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                            isLow ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {item.type === 'product' ? `${item.stockQty} ${item.unit}` : 'Service'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {item.type === 'product'
                            ? formatINR(item.stockQty * item.purchasePrice)
                            : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              setEditingItem(item);
                              setShowItemModal(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="p-1.5 text-slate-500 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'adjustments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3.5">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
              Record Stock Adjustment
            </h2>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-500 mb-1">Item</label>
                <select
                  value={adjItemId}
                  onChange={(e) => setAdjItemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {db.items.filter((i) => i.type === 'product').map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (Curr: {i.stockQty})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-500 mb-1">Action</label>
                  <select
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as 'add' | 'reduce')}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="add">Add Stock (+)</option>
                    <option value="reduce">Reduce Stock (-)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-500 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={adjQty}
                    onChange={(e) => setAdjQty(Number(e.target.value))}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Reason</label>
                <input
                  type="text"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <button
                onClick={async () => {
                  const it = db.items.find((x) => x.id === adjItemId);
                  if (!it || adjQty <= 0) return;
                  await saveStockAdjustment({
                    date: todayISO(),
                    itemId: it.id,
                    itemName: it.name,
                    type: adjType,
                    qty: adjQty,
                    reason: adjReason,
                    costPerUnit: it.purchasePrice,
                    notes: adjReason,
                  });
                }}
                className="w-full py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Apply Stock Adjustment
              </button>
            </div>
          </div>

          <div className="lg:col-span-8 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold mb-3">Adjustment & Wastage History</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Item</th>
                  <th className="py-2 text-left">Reason</th>
                  <th className="py-2 text-right">Qty Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {db.stockAdjustments.map((sa) => (
                  <tr key={sa.id}>
                    <td className="py-2.5 font-mono text-slate-500">{sa.date}</td>
                    <td className="py-2.5 font-medium">{sa.itemName}</td>
                    <td className="py-2.5 text-slate-600 dark:text-slate-400">{sa.reason}</td>
                    <td
                      className={`py-2.5 text-right font-mono font-semibold tabular-nums ${
                        sa.type === 'add' ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {sa.type === 'add' ? `+${sa.qty}` : `-${sa.qty}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'batches' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-indigo-600" />
            Batch & Expiry Tracking Register
          </h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Item</th>
                <th className="py-2 text-left">Batch No</th>
                <th className="py-2 text-left">Mfg Date</th>
                <th className="py-2 text-left">Expiry Date</th>
                <th className="py-2 text-right">Batch Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {db.items
                .filter((i) => i.batches.length > 0)
                .flatMap((i) =>
                  i.batches.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 font-medium">{i.name}</td>
                      <td className="py-2.5 font-mono">{b.batchNo}</td>
                      <td className="py-2.5 font-mono text-slate-500">{b.mfgDate}</td>
                      <td className="py-2.5 font-mono text-amber-700 dark:text-amber-400 font-semibold">
                        {b.expiryDate}
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold">
                        {b.qty} {i.unit}
                      </td>
                    </tr>
                  ))
                )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'godowns' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {db.godowns.map((g) => {
              const totalUnits = db.items.reduce(
                (s, it) => s + (it.godownStock?.[g.id] || 0),
                0
              );
              return (
                <div
                  key={g.id}
                  className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1"
                >
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{g.name}</div>
                  <div className="text-xs text-slate-500">{g.location} · Mgr: {g.manager}</div>
                  <div className="pt-2 text-xs font-mono font-semibold text-indigo-700 dark:text-indigo-400">
                    Total Stock Units: {totalUnits}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-indigo-600" />
                Inter-Godown Stock Transfer
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 mb-1">From Godown</label>
                  <select
                    value={trfFrom}
                    onChange={(e) => setTrfFrom(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {db.godowns.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">To Godown</label>
                  <select
                    value={trfTo}
                    onChange={(e) => setTrfTo(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {db.godowns.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-slate-500 mb-1">Item</label>
                  <select
                    value={trfItemId}
                    onChange={(e) => setTrfItemId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {db.items.filter((i) => i.type === 'product').map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={trfQty}
                    onChange={(e) => setTrfQty(Number(e.target.value))}
                    className="w-full px-2.5 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <button
                onClick={async () => {
                  const it = db.items.find((x) => x.id === trfItemId);
                  if (!it || trfFrom === trfTo || trfQty <= 0) return;
                  await saveStockTransfer({
                    date: todayISO(),
                    fromGodownId: trfFrom,
                    toGodownId: trfTo,
                    items: [{ itemId: it.id, itemName: it.name, qty: trfQty }],
                    notes: 'Warehouse rebalancing',
                  });
                }}
                className="w-full py-2 font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Execute Godown Transfer
              </button>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="font-semibold">Add New Warehouse / Godown</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Godown Name"
                    value={newGodownName}
                    onChange={(e) => setNewGodownName(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <input
                    type="text"
                    placeholder="City/Area"
                    value={newGodownLoc}
                    onChange={(e) => setNewGodownLoc(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <button
                    onClick={async () => {
                      if (!newGodownName.trim()) return;
                      await saveGodown({
                        id: `g_${Date.now()}`,
                        name: newGodownName,
                        location: newGodownLoc || 'Main City',
                        manager: 'Store Admin',
                        isDefault: false,
                      });
                      setNewGodownName('');
                      setNewGodownLoc('');
                    }}
                    className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-semibold mb-3">Stock Transfer Vouchers</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 text-left">Transfer #</th>
                    <th className="py-2 text-left">Date</th>
                    <th className="py-2 text-left">Route</th>
                    <th className="py-2 text-left">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {db.stockTransfers.map((st) => {
                    const fromName = db.godowns.find((g) => g.id === st.fromGodownId)?.name || '';
                    const toName = db.godowns.find((g) => g.id === st.toGodownId)?.name || '';
                    return (
                      <tr key={st.id}>
                        <td className="py-2.5 font-mono font-semibold">{st.transferNo}</td>
                        <td className="py-2.5 font-mono text-slate-500">{st.date}</td>
                        <td className="py-2.5">
                          {fromName} → {toName}
                        </td>
                        <td className="py-2.5 font-mono">
                          {st.items.map((x) => `${x.itemName} (${x.qty})`).join(', ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-600" />
              Item Stock Movement Timeline
            </h2>
            <select
              value={timelineItemId}
              onChange={(e) => setTimelineItemId(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              {db.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (Current: {i.stockQty} {i.unit})
                </option>
              ))}
            </select>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-left">Voucher / Ref</th>
                <th className="py-2 text-left">Movement Type</th>
                <th className="py-2 text-right">Qty In / Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {timelineRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No stock movements recorded yet for this item.
                  </td>
                </tr>
              ) : (
                timelineRows.map((r, idx) => (
                  <tr key={`${r.ref}_${idx}`}>
                    <td className="py-2.5 font-mono text-slate-500">{r.date}</td>
                    <td className="py-2.5 font-mono font-medium">{r.ref}</td>
                    <td className="py-2.5">{r.event}</td>
                    <td
                      className={`py-2.5 text-right font-mono font-semibold ${
                        r.change > 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {r.change > 0 ? `+${r.change}` : r.change}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'barcodes' && (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <Barcode className="w-4 h-4 text-indigo-600" />
              <span className="font-semibold">Select Items to Print Code-39 Barcode Labels:</span>
            </div>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Barcode Sheet
            </button>
          </div>

          <div className="no-print flex flex-wrap gap-2">
            {db.items.map((it) => {
              const active = barcodeItemIds.includes(it.id);
              return (
                <button
                  key={it.id}
                  onClick={() =>
                    setBarcodeItemIds((prev) =>
                      active ? prev.filter((x) => x !== it.id) : [...prev, it.id]
                    )
                  }
                  className={`px-3 py-1.5 text-xs rounded-lg border ${
                    active
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600'
                  }`}
                >
                  {it.sku}
                </button>
              );
            })}
          </div>

          <div
            id="printable-barcode"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {db.items
              .filter((it) => barcodeItemIds.includes(it.id))
              .map((it) => {
                const bars = generateCode39Bars(it.barcode || it.sku);
                const totalW = bars.length > 0 ? bars[bars.length - 1].x + bars[bars.length - 1].w : 100;
                return (
                  <div
                    key={it.id}
                    className="p-3.5 rounded-lg bg-white text-slate-900 border border-slate-300 text-center space-y-1.5"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wide truncate">
                      {db.profile.companyName}
                    </div>
                    <div className="text-xs font-semibold truncate">{it.name}</div>
                    <svg
                      viewBox={`0 0 ${totalW} 40`}
                      className="w-full h-11 mx-auto"
                      preserveAspectRatio="none"
                    >
                      {bars.map((b, idx) => (
                        <rect key={idx} x={b.x} y={0} width={b.w} height={40} fill="#0f172a" />
                      ))}
                    </svg>
                    <div className="font-mono text-[10px] tracking-widest">{it.barcode || it.sku}</div>
                    <div className="flex justify-between text-[11px] font-mono font-bold pt-1 border-t border-slate-200">
                      <span>MRP: {formatINR(it.mrp)}</span>
                      <span>Sale: {formatINR(it.salePrice)}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {showItemModal && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveItemForm}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold">{editingItem.id ? 'Edit Item' : 'Add Item / Service'}</h3>
              <button type="button" onClick={() => setShowItemModal(false)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-500 mb-1">Item / Service Name *</label>
                <input
                  type="text"
                  required
                  value={editingItem.name}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Type</label>
                <select
                  value={editingItem.type}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, type: e.target.value as 'product' | 'service' })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="product">Product (Inventory)</option>
                  <option value="service">Service (SAC)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-500 mb-1">Category</label>
                <input
                  type="text"
                  value={editingItem.category}
                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Subcategory</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={editingItem.subcategory || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, subcategory: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Primary Unit</label>
                <select
                  value={editingItem.unit}
                  onChange={(e) => setEditingItem({ ...editingItem, unit: e.target.value })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {ITEM_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-500 mb-1">SKU</label>
                <input
                  type="text"
                  value={editingItem.sku}
                  onChange={(e) => setEditingItem({ ...editingItem, sku: e.target.value })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Barcode</label>
                <input
                  type="text"
                  value={editingItem.barcode}
                  onChange={(e) => setEditingItem({ ...editingItem, barcode: e.target.value })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">HSN / SAC</label>
                <input
                  type="text"
                  value={editingItem.hsn}
                  onChange={(e) => setEditingItem({ ...editingItem, hsn: e.target.value })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-500 mb-1">Sale Price (₹)</label>
                <input
                  type="number"
                  step="any"
                  value={editingItem.salePrice}
                  onChange={(e) => setEditingItem({ ...editingItem, salePrice: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Purchase Price (₹)</label>
                <input
                  type="number"
                  step="any"
                  value={editingItem.purchasePrice}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, purchasePrice: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">MRP (₹)</label>
                <input
                  type="number"
                  step="any"
                  value={editingItem.mrp}
                  onChange={(e) => setEditingItem({ ...editingItem, mrp: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-500 mb-1">GST Tax Rate (%)</label>
                <select
                  value={editingItem.taxRate}
                  onChange={(e) => setEditingItem({ ...editingItem, taxRate: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {[0, 5, 12, 18, 28].map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Current Stock Qty</label>
                <input
                  type="number"
                  value={editingItem.stockQty}
                  onChange={(e) => setEditingItem({ ...editingItem, stockQty: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Low Stock Alert</label>
                <input
                  type="number"
                  value={editingItem.minStockAlert}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, minStockAlert: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Warehouse Bin Location</label>
                <input
                  type="text"
                  placeholder="RACK-A1"
                  value={editingItem.binLocation || ''}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, binLocation: e.target.value })
                  }
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Max Stock Level</label>
                <input
                  type="number"
                  value={editingItem.maxStock ?? 100}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, maxStock: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Lead Time / Safety Stock</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="number"
                    placeholder="Days"
                    value={editingItem.leadTimeDays ?? 5}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, leadTimeDays: Number(e.target.value) })
                    }
                    className="w-full px-2 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <input
                    type="number"
                    placeholder="Safety"
                    value={editingItem.safetyStock ?? 5}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, safetyStock: Number(e.target.value) })
                    }
                    className="w-full px-2 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowItemModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Save Item
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
