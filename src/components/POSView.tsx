import React, { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  CheckCircle2,
  Barcode,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { PaymentMode, Voucher } from '../types/accounting';
import { calculateVoucherLine, formatINR, todayISO } from '../utils/formatters';
import { downloadInvoicePDF } from '../utils/pdfGenerator';

interface POSViewProps {
  onPrintVoucher: (v: Voucher) => void;
}

interface CartRow {
  itemId: string;
  qty: number;
  discountPct: number;
  customRate?: number;
}

export const POSView: React.FC<POSViewProps> = ({ onPrintVoucher }) => {
  const { db, getNextVoucherNo, saveVoucher } = useStore();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [partyId, setPartyId] = useState(
    db?.parties.find((p) => p.name.includes('Walk-in'))?.id || db?.parties[0]?.id || ''
  );
  const [cart, setCart] = useState<CartRow[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [splitCash, setSplitCash] = useState(0);
  const [splitUpi, setSplitUpi] = useState(0);
  const [splitCard, setSplitCard] = useState(0);
  const [bankAccountId, setBankAccountId] = useState(
    db?.bankAccounts.find((b) => b.type === 'cash')?.id || db?.bankAccounts[0]?.id || ''
  );
  const [lastSavedMsg, setLastSavedMsg] = useState('');
  const [lastSavedVoucher, setLastSavedVoucher] = useState<Voucher | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const items = db?.items || [];
  const parties = db?.parties || [];
  const bankAccounts = db?.bankAccounts || [];
  const profileState = db?.profile.state || 'Maharashtra';

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    items.forEach((i) => set.add(i.category || 'General'));
    return Array.from(set);
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== 'All' && i.category !== category) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.barcode.toLowerCase().includes(q)
      );
    });
  }, [items, category, search]);

  const selectedParty = parties.find((p) => p.id === partyId);
  const isInterState = Boolean(selectedParty && selectedParty.state !== profileState);

  const activePricingDiscount = (_itemId: string, qty: number, categoryName: string) => {
    const rule = (db?.pricingRules || []).find(
      (r) =>
        r.active &&
        qty >= r.minQty &&
        (r.channel === 'All' || r.channel === 'Retail POS Counter') &&
        (r.category === 'All' || r.category === 'All Items' || r.category === categoryName)
    );
    return rule ? rule.discountPct : 0;
  };

  const addToCart = (itemId: string) => {
    const targetItem = items.find((i) => i.id === itemId);
    setCart((prev) => {
      const hit = prev.find((c) => c.itemId === itemId);
      if (hit) {
        const nextQty = hit.qty + 1;
        const ruleDisc = targetItem ? activePricingDiscount(itemId, nextQty, targetItem.category) : hit.discountPct;
        return prev.map((c) =>
          c.itemId === itemId
            ? { ...c, qty: nextQty, discountPct: Math.max(c.discountPct, ruleDisc) }
            : c
        );
      }
      const ruleDisc = targetItem ? activePricingDiscount(itemId, 1, targetItem.category) : 0;
      return [...prev, { itemId, qty: 1, discountPct: ruleDisc }];
    });
  };

  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !search.trim()) return;
    const q = search.trim().toLowerCase();
    const exact = items.find(
      (i) => i.barcode.toLowerCase() === q || i.sku.toLowerCase() === q
    );
    if (exact) {
      addToCart(exact.id);
      setSearch('');
    }
  };

  const computedLines = useMemo(() => {
    return cart
      .map((row) => {
        const item = items.find((i) => i.id === row.itemId);
        if (!item) return null;
        return calculateVoucherLine({
          id: `pos_${item.id}`,
          itemId: item.id,
          itemName: item.name,
          hsn: item.hsn,
          qty: row.qty,
          unit: item.unit,
          rate: row.customRate ?? item.salePrice,
          discountPct: row.discountPct,
          taxRate: item.taxRate,
          cessRate: item.cessRate,
          taxInclusive: item.taxInclusive,
          isInterState,
        });
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [cart, items, isInterState]);

  const subTotal = Number(computedLines.reduce((s, l) => s + l.taxableAmount, 0).toFixed(2));
  const taxTotal = Number(
    computedLines.reduce((s, l) => s + l.cgst + l.sgst + l.igst + l.cess, 0).toFixed(2)
  );
  const exactTotal = subTotal + taxTotal;
  const grandTotal = Math.round(exactTotal);
  const roundOff = Number((grandTotal - exactTotal).toFixed(2));

  if (!db) return null;

  const completeSale = async (andPrint: boolean) => {
    if (computedLines.length === 0 || saving) return;
    setErrorMsg('');
    setSaving(true);
    try {
      const paid =
        paymentMode === 'Split'
          ? Math.min(grandTotal, splitCash + splitUpi + splitCard)
          : grandTotal;

      const saved = await saveVoucher({
        id: '',
        type: 'sale_invoice',
        voucherNo: getNextVoucherNo('sale_invoice'),
        date: todayISO(),
        dueDate: todayISO(),
        partyId: partyId || undefined,
        partyName: selectedParty?.name || 'Walk-in Cash Customer',
        partyGstin: selectedParty?.gstin || '',
        placeOfSupply: selectedParty?.state || db.profile.state,
        isInterState,
        lines: computedLines,
        additionalCharges: 0,
        discountTotal: Number(
          computedLines.reduce((s, l) => s + (l.qty * l.rate * l.discountPct) / 100, 0).toFixed(2)
        ),
        roundOff,
        subTotal,
        taxTotal,
        grandTotal,
        paidAmount: paid,
        paymentMode,
        bankAccountId:
          paymentMode === 'Cash'
            ? bankAccounts.find((b) => b.type === 'cash')?.id || bankAccountId
            : bankAccounts.find((b) => b.type === 'bank')?.id || bankAccountId,
        splitDetails:
          paymentMode === 'Split' ? { cash: splitCash, upi: splitUpi, card: splitCard } : undefined,
        status: paid >= grandTotal - 0.5 ? 'paid' : 'partial',
        salesChannel: 'Retail POS Counter',
        notes: 'POS Counter Quick Bill',
        createdAt: new Date().toISOString(),
      });

      setCart([]);
      setSplitCash(0);
      setSplitUpi(0);
      setSplitCard(0);
      setLastSavedVoucher(saved);
      setLastSavedMsg(`Saved ${saved.voucherNo} (${formatINR(saved.grandTotal)})`);
      if (andPrint) onPrintVoucher(saved);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save POS bill.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left: Item Catalog & Barcode Scanner */}
      <div className="lg:col-span-7 space-y-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              POS Quick Billing Counter
            </h1>
            {lastSavedMsg && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  {lastSavedMsg}
                </span>
                {lastSavedVoucher && (
                  <button
                    onClick={() => {
                      const p = parties.find((x) => x.id === lastSavedVoucher.partyId);
                      const b = bankAccounts.find((x) => x.id === lastSavedVoucher.bankAccountId);
                      downloadInvoicePDF(
                        lastSavedVoucher,
                        db.profile,
                        p,
                        b,
                        lastSavedVoucher.paidAmount
                      );
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Download className="w-3 h-3" />
                    Receipt PDF
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="relative">
            <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Scan barcode, type SKU, or search item name (Press Enter on exact SKU/Barcode)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleBarcodeEnter}
              className="w-full pl-9 pr-9 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                  category === cat
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              onClick={() => addToCart(item.id)}
              className="text-left p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-600 dark:hover:border-indigo-500 transition-colors flex flex-col justify-between gap-2"
            >
              <div>
                <div className="text-[11px] font-mono text-slate-500">
                  {item.sku} · GST {item.taxRate}%
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-white line-clamp-2">
                  {item.name}
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-sm font-bold font-mono text-indigo-700 dark:text-indigo-400">
                  {formatINR(item.salePrice)}
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {item.type === 'product' ? `${item.stockQty} ${item.unit}` : 'Service'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Cart & Split Checkout */}
      <div className="lg:col-span-5 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 sticky top-20">
        {errorMsg && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Customer</label>
          <select
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          >
            <option value="">Walk-in Cash Customer</option>
            {parties
              .filter((p) => p.type === 'customer' || p.type === 'both')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.phone})
                </option>
              ))}
          </select>
          {selectedParty?.creditHold && (
            <div className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Credit Hold Flagged on this customer — collect full payment at counter.
            </div>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Tap items on the left or scan a barcode to start billing.
            </div>
          ) : (
            cart.map((row, idx) => {
              const line = computedLines[idx];
              if (!line) return null;
              return (
                <div key={row.itemId} className="p-3 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 dark:text-white truncate">
                      {line.itemName}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {formatINR(line.rate)} × {line.qty} + {line.taxRate}% GST
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() =>
                        setCart((prev) =>
                          prev
                            .map((c) => (c.itemId === row.itemId ? { ...c, qty: c.qty - 1 } : c))
                            .filter((c) => c.qty > 0)
                        )
                      }
                      className="p-1 rounded border border-slate-200 dark:border-slate-700"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center font-mono font-semibold">{row.qty}</span>
                    <button
                      onClick={() =>
                        setCart((prev) =>
                          prev.map((c) => (c.itemId === row.itemId ? { ...c, qty: c.qty + 1 } : c))
                        )
                      }
                      className="p-1 rounded border border-slate-200 dark:border-slate-700"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <span className="w-20 text-right font-mono font-semibold tabular-nums">
                      {formatINR(line.total)}
                    </span>
                    <button
                      onClick={() => setCart((prev) => prev.filter((c) => c.itemId !== row.itemId))}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Totals */}
        <div className="space-y-1.5 text-xs font-mono pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex justify-between text-slate-500">
            <span>Taxable Subtotal</span>
            <span>{formatINR(subTotal)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>GST ({isInterState ? 'IGST' : 'CGST+SGST'})</span>
            <span>{formatINR(taxTotal)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-slate-900 dark:text-white pt-1.5 border-t border-slate-200 dark:border-slate-800">
            <span>Payable Total</span>
            <span>{formatINR(grandTotal)}</span>
          </div>
        </div>

        {/* Payment Mode & Split */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-5 gap-1.5">
            {(['Cash', 'UPI', 'Card', 'Bank Transfer', 'Split'] as PaymentMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setPaymentMode(mode);
                  if (mode === 'Split') {
                    setSplitCash(Math.floor(grandTotal / 2));
                    setSplitUpi(grandTotal - Math.floor(grandTotal / 2));
                    setSplitCard(0);
                  }
                }}
                className={`py-2 px-1 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  paymentMode === mode
                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {paymentMode === 'Split' && (
            <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-xs">
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Cash</label>
                <input
                  type="number"
                  value={splitCash}
                  onChange={(e) => setSplitCash(Number(e.target.value))}
                  className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">UPI</label>
                <input
                  type="number"
                  value={splitUpi}
                  onChange={(e) => setSplitUpi(Number(e.target.value))}
                  className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Card</label>
                <input
                  type="number"
                  value={splitCard}
                  onChange={(e) => setSplitCard(Number(e.target.value))}
                  className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>
          )}

          {paymentMode !== 'Cash' && paymentMode !== 'Split' && (
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  Credit to: {b.bankName}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            disabled={cart.length === 0 || saving}
            onClick={() => completeSale(false)}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Save Bill
          </button>
          <button
            disabled={cart.length === 0 || saving}
            onClick={() => completeSale(true)}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40"
          >
            <Printer className="w-4 h-4" />
            Save & Print
          </button>
        </div>
      </div>
    </div>
  );
};
