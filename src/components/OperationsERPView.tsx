import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Factory,
  FolderKanban,
  Globe,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { SalesChannel } from '../types/accounting';
import { formatCurrency, SALES_CHANNELS } from '../utils/formatters';
import { downloadReportPDF } from '../utils/pdfGenerator';

type OpsTab =
  | 'manufacturing'
  | 'job_work'
  | 'projects'
  | 'logistics'
  | 'pricing_marketplace'
  | 'portals';

export const OperationsERPView: React.FC = () => {
  const {
    db,
    saveBom,
    saveProductionOrder,
    completeProductionOrder,
    saveJobWork,
    updateJobWork,
    saveProject,
    updateShipmentStatus,
    savePricingRule,
    runMarketplaceSync,
    getPartyBalance,
  } = useStore();

  const [tab, setTab] = useState<OpsTab>('manufacturing');
  const [notice, setNotice] = useState('');

  // Manufacturing state
  const [bomFinItemId, setBomFinItemId] = useState('');
  const [bomCompItemId, setBomCompItemId] = useState('');
  const [bomCompQty, setBomCompQty] = useState(2);
  const [poBomId, setPoBomId] = useState('');
  const [poQty, setPoQty] = useState(10);

  // Job work state
  const [jwPartyId, setJwPartyId] = useState('');
  const [jwItemId, setJwItemId] = useState('');
  const [jwQty, setJwQty] = useState(15);

  // Project state
  const [projName, setProjName] = useState('');
  const [projClientId, setProjClientId] = useState('');
  const [projValue, setProjValue] = useState(250000);

  // Pricing Rule & Logistics
  const [ruleName, setRuleName] = useState('');
  const [ruleMinQty, setRuleMinQty] = useState(10);
  const [ruleDisc, setRuleDisc] = useState(7.5);
  const [ruleChannel, setRuleChannel] = useState<SalesChannel | 'All'>('Wholesale');

  // Portal Viewer
  const [portalMode, setPortalMode] = useState<'customer' | 'vendor'>('customer');
  const [portalPartyId, setPortalPartyId] = useState('');

  const dispatchVouchers = useMemo(() => {
    if (!db) return [];
    return db.vouchers.filter((v) => v.type === 'sale_invoice' || v.type === 'delivery_challan');
  }, [db]);

  const portalParty = useMemo(() => {
    if (!db) return undefined;
    const pool = db.parties.filter((p) => (portalMode === 'customer' ? p.type !== 'supplier' : p.type !== 'customer'));
    return pool.find((p) => p.id === portalPartyId) || pool[0];
  }, [db, portalMode, portalPartyId]);

  const portalVouchers = useMemo(() => {
    if (!db || !portalParty) return [];
    return db.vouchers.filter((v) => v.partyId === portalParty.id && v.status !== 'cancelled');
  }, [db, portalParty]);

  if (!db) return null;

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  };

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-slate-900 via-indigo-900 to-blue-800 rounded-2xl p-5 text-white shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-indigo-200 font-semibold">
            Enterprise Operations &amp; Commerce
          </div>
          <h2 className="text-xl md:text-2xl font-bold mt-1">
            Manufacturing, Job Work, Projects, Logistics &amp; Portals
          </h2>
        </div>
        {notice && (
          <div className="px-3.5 py-2 rounded-xl bg-white text-indigo-800 text-xs font-bold shadow">{notice}</div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'manufacturing' as const, label: 'Manufacturing & BOMs', icon: Factory },
          { id: 'job_work' as const, label: 'Job Work Challans', icon: PackageCheck },
          { id: 'projects' as const, label: 'Projects & Job Costing', icon: FolderKanban },
          { id: 'logistics' as const, label: 'Warehouse Bins & Dispatch', icon: Truck },
          { id: 'pricing_marketplace' as const, label: 'Dynamic Pricing & Marketplaces', icon: ShoppingBag },
          { id: 'portals' as const, label: 'Customer & Vendor Portals', icon: Globe },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                tab === t.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 1. MANUFACTURING */}
      {tab === 'manufacturing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-3 text-xs">
            <h3 className="text-sm font-bold">Bill of Materials (BOM) Recipes</h3>
            <div className="space-y-2">
              {db.boms.map((b) => (
                <div key={b.id} className="p-3 rounded-xl border space-y-1">
                  <div className="flex justify-between font-bold">
                    <span>{b.finishedItemName} ({b.sku})</span>
                    <span>Output: {b.outputQty} Unit</span>
                  </div>
                  <div className="text-slate-500">
                    Components: {b.components.map((c) => `${c.itemName} × ${c.qtyPerUnit}`).join(', ')}
                  </div>
                  <div className="text-indigo-700 dark:text-indigo-400 font-semibold">
                    Labour + Overhead: {formatCurrency(b.labourCostPerBatch + b.overheadCostPerBatch)}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t">
              <select value={bomFinItemId} onChange={(e) => setBomFinItemId(e.target.value)} className="px-2 py-2 rounded border">
                <option value="">Finished Product</option>
                {db.items.filter((i) => i.type === 'product').map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              <select value={bomCompItemId} onChange={(e) => setBomCompItemId(e.target.value)} className="px-2 py-2 rounded border">
                <option value="">Raw Component</option>
                {db.items.filter((i) => i.type === 'product').map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              <input type="number" value={bomCompQty} onChange={(e) => setBomCompQty(Number(e.target.value))} className="px-2 py-2 rounded border" />
            </div>
            <button
              onClick={async () => {
                const fin = db.items.find((i) => i.id === bomFinItemId) || db.items[0];
                const comp = db.items.find((i) => i.id === bomCompItemId) || db.items[1] || fin;
                if (!fin || !comp) return;
                await saveBom({
                  finishedItemId: fin.id,
                  finishedItemName: fin.name,
                  sku: fin.sku,
                  outputQty: 1,
                  labourCostPerBatch: 500,
                  overheadCostPerBatch: 300,
                  components: [{ itemId: comp.id, itemName: comp.name, qtyPerUnit: bomCompQty, unitCost: comp.purchasePrice }],
                });
                showNotice(`BOM created for ${fin.name}`);
              }}
              className="w-full py-2 rounded-xl bg-indigo-600 text-white font-semibold"
            >
              + Save BOM Recipe
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-3 text-xs">
            <h3 className="text-sm font-bold">Production Orders, WIP &amp; Cost Variance</h3>
            <div className="space-y-2.5">
              {db.productionOrders.map((po) => {
                const variance = po.actualMaterialCost + po.actualLabourOverhead - (po.plannedMaterialCost + po.plannedLabourOverhead);
                return (
                  <div key={po.id} className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold">{po.orderNo} — {po.finishedItemName} ({po.plannedQty} Qty)</div>
                      <div className="text-slate-500">
                        Status: <strong>{po.status}</strong> | Variance: <span className={variance > 0 ? 'text-red-700' : 'text-emerald-700'}>{formatCurrency(variance)}</span>
                      </div>
                    </div>
                    {po.status !== 'Completed' ? (
                      <button
                        onClick={async () => {
                          await completeProductionOrder(po.id, { wastagePct: 1.5 });
                          showNotice(`Completed ${po.orderNo} & posted Finished Goods journal!`);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold"
                      >
                        Complete &amp; Post WIP
                      </button>
                    ) : (
                      <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 font-bold">Completed</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <select value={poBomId} onChange={(e) => setPoBomId(e.target.value)} className="flex-1 px-2.5 py-2 rounded-lg border">
                <option value="">Select BOM Recipe</option>
                {db.boms.map((b) => (
                  <option key={b.id} value={b.id}>{b.finishedItemName}</option>
                ))}
              </select>
              <input type="number" value={poQty} onChange={(e) => setPoQty(Number(e.target.value))} className="w-20 px-2.5 py-2 rounded-lg border" />
              <button
                onClick={async () => {
                  const bom = db.boms.find((b) => b.id === poBomId) || db.boms[0];
                  if (!bom) return;
                  const mat = bom.components.reduce((s, c) => s + c.qtyPerUnit * c.unitCost, 0) * poQty;
                  const lbr = (bom.labourCostPerBatch + bom.overheadCostPerBatch) * poQty;
                  await saveProductionOrder({
                    bomId: bom.id,
                    finishedItemId: bom.finishedItemId,
                    finishedItemName: bom.finishedItemName,
                    plannedQty: poQty,
                    plannedMaterialCost: mat,
                    actualMaterialCost: mat,
                    plannedLabourOverhead: lbr,
                    actualLabourOverhead: lbr,
                  });
                  showNotice('Production order released to shopfloor.');
                }}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold"
              >
                + Launch Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. JOB WORK */}
      {tab === 'job_work' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-4 text-xs">
          <h3 className="text-sm font-bold">Subcontract / Job Work Outward &amp; Return Tracking</h3>
          <div className="overflow-x-auto border rounded-xl">
            <table className="w-full">
              <thead className="bg-indigo-600 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">Challan #</th>
                  <th className="px-3 py-2 text-left">Job Worker</th>
                  <th className="px-3 py-2 text-left">Material Sent</th>
                  <th className="px-3 py-2 text-right">Sent / Recv / Waste</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {db.jobWorks.map((jw) => (
                  <tr key={jw.id} className="border-b">
                    <td className="px-3 py-2 font-bold">{jw.challanNo}</td>
                    <td className="px-3 py-2">{jw.vendorName}</td>
                    <td className="px-3 py-2">{jw.materialSentName}</td>
                    <td className="px-3 py-2 text-right">{jw.qtySent} / {jw.qtyReceivedBack} / {jw.wastageQty}</td>
                    <td className="px-3 py-2 text-center font-semibold">{jw.status}</td>
                    <td className="px-3 py-2 text-right">
                      {jw.status !== 'Completed' && (
                        <button
                          onClick={async () => {
                            await updateJobWork(jw.id, { qtyReceivedBack: jw.qtySent - 1, wastageQty: 1, status: 'Completed' });
                            showNotice(`Received finished goods back on ${jw.challanNo}`);
                          }}
                          className="px-3 py-1 rounded-lg bg-indigo-600 text-white font-semibold"
                        >
                          Receive Return
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <select value={jwPartyId} onChange={(e) => setJwPartyId(e.target.value)} className="px-3 py-2 rounded-lg border">
              <option value="">Select Job Worker Vendor</option>
              {db.parties.filter((p) => p.type !== 'customer').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={jwItemId} onChange={(e) => setJwItemId(e.target.value)} className="px-3 py-2 rounded-lg border">
              <option value="">Select Raw Material</option>
              {db.items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <input type="number" value={jwQty} onChange={(e) => setJwQty(Number(e.target.value))} className="px-3 py-2 rounded-lg border" />
            <button
              onClick={async () => {
                const v = db.parties.find((p) => p.id === jwPartyId) || db.parties.find((p) => p.type !== 'customer') || db.parties[0];
                const it = db.items.find((i) => i.id === jwItemId) || db.items[0];
                if (!v || !it) return;
                await saveJobWork({
                  vendorPartyId: v.id,
                  vendorName: v.name,
                  materialSentItemId: it.id,
                  materialSentName: it.name,
                  qtySent: jwQty,
                  processingCharge: jwQty * 120,
                });
                showNotice('Job work challan issued.');
              }}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold"
            >
              Issue Job Work Challan
            </button>
          </div>
        </div>
      )}

      {/* 3. PROJECTS & JOB COSTING */}
      {tab === 'projects' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-4 text-xs">
          <h3 className="text-sm font-bold">Project Profitability &amp; Job Costing</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {db.projects.map((p) => {
              const totalCost = p.materialCost + p.labourCost + p.overheadCost;
              const profit = p.contractValue - totalCost;
              const marginPct = p.contractValue > 0 ? ((profit / p.contractValue) * 100).toFixed(1) : '0.0';
              return (
                <div key={p.id} className="p-4 rounded-xl border space-y-2">
                  <div className="flex justify-between font-bold text-sm">
                    <span>{p.code}: {p.name}</span>
                    <span className="text-indigo-700 dark:text-indigo-400">{marginPct}% Margin</span>
                  </div>
                  <div className="text-slate-500">Client: {p.clientName} | Status: {p.status}</div>
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg">
                    <div>Contract: <strong>{formatCurrency(p.contractValue)}</strong></div>
                    <div>Cost: <strong>{formatCurrency(totalCost)}</strong></div>
                    <div>Profit: <strong className="text-emerald-700">{formatCurrency(profit)}</strong></div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2 border-t">
            <input value={projName} onChange={(e) => setProjName(e.target.value)} placeholder="New Project Name" className="px-3 py-2 rounded-lg border" />
            <select value={projClientId} onChange={(e) => setProjClientId(e.target.value)} className="px-3 py-2 rounded-lg border">
              <option value="">Select Client</option>
              {db.parties.filter((p) => p.type !== 'supplier').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="number" value={projValue} onChange={(e) => setProjValue(Number(e.target.value))} className="px-3 py-2 rounded-lg border" />
            <button
              onClick={async () => {
                if (!projName.trim()) return;
                const c = db.parties.find((p) => p.id === projClientId) || db.parties[0];
                await saveProject({
                  name: projName,
                  clientPartyId: c?.id || '',
                  clientName: c?.name || 'Client',
                  contractValue: projValue,
                  materialCost: Math.round(projValue * 0.45),
                  labourCost: Math.round(projValue * 0.18),
                  overheadCost: Math.round(projValue * 0.08),
                });
                setProjName('');
                showNotice('Project registered.');
              }}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold"
            >
              + Create Project
            </button>
          </div>
        </div>
      )}

      {/* 4. PAYROLL + PAYSLIP PDF + COMMISSIONS */}
      {/* 5. WAREHOUSE LOGISTICS & DISPATCH */}
      {tab === 'logistics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-3">
            <h3 className="text-sm font-bold">Sales Shipment &amp; Delivery Tracking Pipeline</h3>
            <div className="space-y-2">
              {dispatchVouchers.map((v) => (
                <div key={v.id} className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold">{v.voucherNo} — {v.partyName}</div>
                    <div className="text-slate-500">Tracking: {v.trackingNo || 'Pending AWB'} | Total: {formatCurrency(v.grandTotal)}</div>
                  </div>
                  <select
                    value={v.shipmentStatus || 'Pending'}
                    onChange={async (e) => {
                      await updateShipmentStatus(v.id, e.target.value, v.trackingNo || `AWB-${v.voucherNo}`);
                      showNotice(`Updated ${v.voucherNo} shipment to ${e.target.value}`);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border font-semibold text-indigo-700"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Packed">Packed</option>
                    <option value="Dispatched">Dispatched</option>
                    <option value="Delivered">Delivered</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-3">
            <h3 className="text-sm font-bold">Warehouse Bin Locations &amp; Lead Times</h3>
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full">
                <thead className="bg-indigo-600 text-white">
                  <tr>
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">Bin Rack</th>
                    <th className="px-3 py-2 text-right">Stock / Safety</th>
                  </tr>
                </thead>
                <tbody>
                  {db.items.filter((i) => i.type === 'product').map((i) => (
                    <tr key={i.id} className="border-b">
                      <td className="px-3 py-2 font-mono">{i.sku}</td>
                      <td className="px-3 py-2 font-semibold">{i.name}</td>
                      <td className="px-3 py-2">{i.binLocation || 'RACK-A1'}</td>
                      <td className="px-3 py-2 text-right">{i.stockQty} / {i.safetyStock ?? i.minStockAlert} {i.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 6. DYNAMIC PRICING & MARKETPLACES */}
      {tab === 'pricing_marketplace' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-3">
            <h3 className="text-sm font-bold">Dynamic Volume &amp; Channel Pricing Rules</h3>
            <div className="space-y-2">
              {db.pricingRules.map((pr) => (
                <div key={pr.id} className="p-3 rounded-xl border flex justify-between">
                  <div>
                    <div className="font-bold">{pr.name}</div>
                    <div className="text-slate-500">Channel: {pr.channel} | Min Qty: {pr.minQty} | Target Margin: {pr.targetMarginPct}%</div>
                  </div>
                  <span className="font-bold text-indigo-700 dark:text-indigo-400">{pr.discountPct}% OFF</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t">
              <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Rule Name" className="px-2.5 py-2 rounded border" />
              <input type="number" value={ruleMinQty} onChange={(e) => setRuleMinQty(Number(e.target.value))} placeholder="Min Qty" className="px-2.5 py-2 rounded border" />
              <input type="number" value={ruleDisc} onChange={(e) => setRuleDisc(Number(e.target.value))} placeholder="Disc %" className="px-2.5 py-2 rounded border" />
              <select value={ruleChannel} onChange={(e) => setRuleChannel(e.target.value as SalesChannel | 'All')} className="px-2.5 py-2 rounded border">
                <option value="All">All Channels</option>
                {SALES_CHANNELS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <button
              onClick={async () => {
                if (!ruleName.trim()) return;
                await savePricingRule({ name: ruleName, minQty: ruleMinQty, discountPct: ruleDisc, channel: ruleChannel, category: 'All', targetMarginPct: 18, active: true });
                setRuleName('');
                showNotice('Pricing rule activated.');
              }}
              className="w-full py-2 rounded-xl bg-indigo-600 text-white font-semibold"
            >
              + Add Dynamic Pricing Rule
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-3">
            <h3 className="text-sm font-bold">Omnichannel E-Commerce &amp; Marketplace Sync</h3>
            <p className="text-slate-500">One-click sync pulls orders as GST Sales Invoices &amp; deducts warehouse stock automatically.</p>
            <div className="grid grid-cols-2 gap-3">
              {['Amazon India', 'Flipkart Seller', 'Shopify D2C', 'Meesho / ONDC'].map((ch) => (
                <button
                  key={ch}
                  onClick={async () => {
                    const nos = await runMarketplaceSync(ch);
                    showNotice(`Synced ${ch}: Imported ${nos.join(', ')}`);
                  }}
                  className="p-4 rounded-xl border hover:border-indigo-500 text-left space-y-1 transition"
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>{ch}</span>
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
                  </div>
                  <div className="text-[11px] text-slate-500">Pull New Orders &amp; Tax Invoices</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 7. CUSTOMER & VENDOR PORTALS */}
      {tab === 'portals' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setPortalMode('customer');
                  setPortalPartyId('');
                }}
                className={`px-3.5 py-2 rounded-xl font-semibold ${portalMode === 'customer' ? 'bg-indigo-600 text-white' : 'border'}`}
              >
                Customer Self-Service Portal
              </button>
              <button
                onClick={() => {
                  setPortalMode('vendor');
                  setPortalPartyId('');
                }}
                className={`px-3.5 py-2 rounded-xl font-semibold ${portalMode === 'vendor' ? 'bg-indigo-600 text-white' : 'border'}`}
              >
                Vendor Self-Service Portal
              </button>
            </div>
            {portalParty && (
              <div className="flex items-center gap-2">
                <select
                  value={portalParty.id}
                  onChange={(e) => setPortalPartyId(e.target.value)}
                  className="px-3 py-2 rounded-xl border font-semibold"
                >
                  {db.parties
                    .filter((p) => (portalMode === 'customer' ? p.type !== 'supplier' : p.type !== 'customer'))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
                <button
                  onClick={() =>
                    downloadReportPDF({
                      title: `${portalMode === 'customer' ? 'Customer' : 'Vendor'} Portal Statement — ${portalParty.name}`,
                      subtitle: `GSTIN: ${portalParty.gstin || 'Unregistered'} | Closing Balance: ${formatCurrency(Math.abs(getPartyBalance(portalParty.id)))}`,
                      companyName: db.profile.companyName,
                      headers: ['Voucher #', 'Date', 'Type', 'Amount', 'Paid', 'Status'],
                      rows: portalVouchers.map((v) => [
                        v.voucherNo,
                        v.date,
                        v.type,
                        formatCurrency(v.grandTotal),
                        formatCurrency(v.paidAmount),
                        v.status,
                      ]),
                      filename: `portal_statement_${portalParty.name.replace(/\s+/g, '_')}.pdf`,
                    })
                  }
                  className="px-3 py-2 rounded-xl bg-indigo-600 text-white font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Statement PDF
                </button>
              </div>
            )}
          </div>

          {portalParty && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200">
                  <div className="text-slate-500">Account Holder</div>
                  <div className="font-bold text-sm text-indigo-800">{portalParty.name}</div>
                  <div className="text-[11px] text-slate-600">{portalParty.email} | {portalParty.phone}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border">
                  <div className="text-slate-500">Net Outstanding Balance</div>
                  <div className="font-bold text-base">{formatCurrency(Math.abs(getPartyBalance(portalParty.id)))}</div>
                  <div className="text-[11px] text-slate-500">{getPartyBalance(portalParty.id) >= 0 ? 'Receivable' : 'Payable'}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-slate-500">Instant Online Payment</div>
                  <div className="font-bold text-emerald-800 flex items-center gap-1 mt-1">
                    <CheckCircle2 className="w-4 h-4" /> UPI Ready: {db.profile.upiId}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto border rounded-xl">
                <table className="w-full">
                  <thead className="bg-indigo-600 text-white">
                    <tr>
                      <th className="px-3 py-2 text-left">Voucher #</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-center">Shipment</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portalVouchers.map((v) => (
                      <tr key={v.id} className="border-b">
                        <td className="px-3 py-2 font-bold">{v.voucherNo}</td>
                        <td className="px-3 py-2">{v.date}</td>
                        <td className="px-3 py-2">{v.type}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(v.grandTotal)}</td>
                        <td className="px-3 py-2 text-center">{v.shipmentStatus || 'N/A'}</td>
                        <td className="px-3 py-2 text-center">{v.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
