import { sqlite, uid, hashPassword, recordAudit, runTransaction, ensureSaasDefaults } from './db.ts';
import { createSeedDatabase } from '../src/data/seedDatabase.ts';
import {
  DeviceScope,
  InvoiceDesignConfig,
  LicenseRecord,
  PaymentMode,
  PlanDuration,
  PlanTier,
  SubscriptionFeatureKey,
  SubscriptionPlanConfig,
  SubscriptionRuntimeState,
  Voucher,
  VoucherType,
} from '../src/types/accounting.ts';
import { mergeAppSettings } from '../src/utils/defaultAppSettings.ts';

export const DEFAULT_INVOICE_CONFIG: InvoiceDesignConfig = {
  templateId: 'corporate_blue',
  paperFormat: 'A4',
  accentColor: '#1E40AF',
  fontFamily: 'sans',
  showHsn: true,
  showDiscount: true,
  showTaxColumns: true,
  showBatch: false,
  showUpiQr: true,
  showBankDetails: true,
  showSignature: true,
  showStamp: true,
  stampText: 'VERIFIED & AUTHORIZED',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  Admin: ['*'],
  'Stock Keeper': [
    'dashboard',
    'inventory',
    'purchase_bills',
    'purchase_orders',
    'orders_challans',
    'ocr_bulk_tools',
    'settings',
  ],
  Biller: [
    'dashboard',
    'pos',
    'sales_invoices',
    'quotes_proforma',
    'orders_challans',
    'credit_notes',
    'payment_in',
    'parties',
  ],
  Salesman: [
    'dashboard',
    'sales_invoices',
    'quotes_proforma',
    'orders_challans',
    'parties',
    'inventory',
  ],
  Accountant: [
    'dashboard',
    'sales_invoices',
    'purchase_bills',
    'payment_in',
    'payment_out',
    'expenses',
    'banking',
    'accounting',
    'reports_gst',
    'payroll',
    'gst_portals',
    'parties',
  ],
};

export function cleanDisplayEmail(raw: string): string {
  const s = String(raw || '');
  if (s.endsWith('@noemail.local') || s.endsWith('@staff.local')) return '';
  return s;
}

const SYSTEM_LEDGERS = [
  { name: 'Cash-in-Hand', group: 'Cash-in-Hand', nature: 'Assets', drCr: 'Dr' },
  { name: 'Bank Accounts', group: 'Bank Accounts', nature: 'Assets', drCr: 'Dr' },
  { name: 'Sundry Debtors', group: 'Current Assets', nature: 'Assets', drCr: 'Dr' },
  { name: 'Sundry Creditors', group: 'Current Liabilities', nature: 'Liabilities', drCr: 'Cr' },
  { name: 'Sales Account', group: 'Sales Accounts', nature: 'Income', drCr: 'Cr' },
  { name: 'Sales Return Account', group: 'Sales Accounts', nature: 'Income', drCr: 'Dr' },
  { name: 'Purchase Account', group: 'Purchase Accounts', nature: 'Expenses', drCr: 'Dr' },
  { name: 'Purchase Return Account', group: 'Purchase Accounts', nature: 'Expenses', drCr: 'Cr' },
  { name: 'Output CGST', group: 'Duties & Taxes', nature: 'Liabilities', drCr: 'Cr' },
  { name: 'Output SGST', group: 'Duties & Taxes', nature: 'Liabilities', drCr: 'Cr' },
  { name: 'Output IGST', group: 'Duties & Taxes', nature: 'Liabilities', drCr: 'Cr' },
  { name: 'Input CGST (ITC)', group: 'Duties & Taxes', nature: 'Assets', drCr: 'Dr' },
  { name: 'Input SGST (ITC)', group: 'Duties & Taxes', nature: 'Assets', drCr: 'Dr' },
  { name: 'Input IGST (ITC)', group: 'Duties & Taxes', nature: 'Assets', drCr: 'Dr' },
  { name: 'Closing Stock Inventory', group: 'Current Assets', nature: 'Assets', drCr: 'Dr' },
  { name: 'Owner Capital Account', group: 'Capital Account', nature: 'Equity', drCr: 'Cr' },
  { name: 'Depreciation Expense', group: 'Indirect Expenses', nature: 'Expenses', drCr: 'Dr' },
  { name: 'Accumulated Depreciation', group: 'Fixed Assets', nature: 'Assets', drCr: 'Cr' },
  { name: 'Warehouse Fixtures & Racks', group: 'Fixed Assets', nature: 'Assets', drCr: 'Dr' },
  { name: 'Finished Goods Inventory', group: 'Current Assets', nature: 'Assets', drCr: 'Dr' },
  { name: 'WIP Production Control', group: 'Direct Expenses', nature: 'Expenses', drCr: 'Cr' },
  { name: 'Staff Salary & Wages', group: 'Indirect Expenses', nature: 'Expenses', drCr: 'Dr' },
  { name: 'PF & TDS Payable', group: 'Duties & Taxes', nature: 'Liabilities', drCr: 'Cr' },
  { name: 'FX Gain / Loss', group: 'Indirect Income', nature: 'Income', drCr: 'Cr' },
];

export function ensureSystemLedgers(companyId: string): void {
  const stmt = sqlite.prepare(
    `INSERT OR IGNORE INTO ledger_accounts (id, company_id, name, group_name, nature, opening_balance, opening_type, is_system)
     VALUES (?, ?, ?, ?, ?, 0, ?, 1)`
  );
  for (const l of SYSTEM_LEDGERS) {
    stmt.run(uid('ldg'), companyId, l.name, l.group, l.nature, l.drCr);
  }
}

export function postJournalForVoucher(companyId: string, v: Voucher): void {
  // Always clean existing journal entry for this voucher (idempotent, no duplicates)
  sqlite.prepare(`DELETE FROM journal_entries WHERE voucher_id = ?`).run(v.id);

  if (v.status === 'cancelled') return;
  const nonPostingTypes: VoucherType[] = [
    'estimate',
    'proforma',
    'sale_order',
    'delivery_challan',
    'purchase_order',
  ];
  if (nonPostingTypes.includes(v.type)) return;

  const lines: { ledgerName: string; accountGroup: string; debit: number; credit: number; narration?: string }[] = [];

  const cgstSum = v.lines.reduce((s, l) => s + l.cgst, 0);
  const sgstSum = v.lines.reduce((s, l) => s + l.sgst, 0);
  const igstSum = v.lines.reduce((s, l) => s + l.igst + l.cess, 0);
  const bankLabel =
    (sqlite.prepare(`SELECT bank_name FROM bank_accounts WHERE id = ?`).get(v.bankAccountId || '') as { bank_name?: string } | undefined)
      ?.bank_name || (v.paymentMode === 'Cash' ? 'Cash-in-Hand' : 'Bank Accounts');

  if (v.type === 'sale_invoice') {
    const paid = Math.max(0, Number(v.paidAmount.toFixed(2)));
    const unpaid = Math.max(0, Number((v.grandTotal - paid).toFixed(2)));
    const excessAdvance = Math.max(0, Number((paid - v.grandTotal).toFixed(2)));
    if (paid > 0) {
      lines.push({ ledgerName: bankLabel, accountGroup: 'Cash/Bank', debit: paid, credit: 0 });
    }
    if (unpaid > 0) {
      lines.push({
        ledgerName: v.partyName || 'Sundry Debtors',
        accountGroup: 'Sundry Debtors',
        debit: unpaid,
        credit: 0,
      });
    }
    if (excessAdvance > 0) {
      lines.push({
        ledgerName: v.partyName || 'Sundry Debtors',
        accountGroup: 'Sundry Debtors',
        debit: 0,
        credit: excessAdvance,
      });
    }
    const baseCredit = Number((v.subTotal + v.additionalCharges + v.roundOff).toFixed(2));
    if (baseCredit > 0) {
      lines.push({ ledgerName: 'Sales Account', accountGroup: 'Sales Accounts', debit: 0, credit: baseCredit });
    } else if (baseCredit < 0) {
      lines.push({ ledgerName: 'Sales Account', accountGroup: 'Sales Accounts', debit: Math.abs(baseCredit), credit: 0 });
    }
    if (cgstSum > 0) lines.push({ ledgerName: 'Output CGST', accountGroup: 'Duties & Taxes', debit: 0, credit: Number(cgstSum.toFixed(2)) });
    if (sgstSum > 0) lines.push({ ledgerName: 'Output SGST', accountGroup: 'Duties & Taxes', debit: 0, credit: Number(sgstSum.toFixed(2)) });
    if (igstSum > 0) lines.push({ ledgerName: 'Output IGST', accountGroup: 'Duties & Taxes', debit: 0, credit: Number(igstSum.toFixed(2)) });
  } else if (v.type === 'credit_note') {
    const baseDebit = Number((v.subTotal + v.additionalCharges + v.roundOff).toFixed(2));
    if (baseDebit >= 0) {
      lines.push({ ledgerName: 'Sales Return Account', accountGroup: 'Sales Accounts', debit: baseDebit, credit: 0 });
    } else {
      lines.push({ ledgerName: 'Sales Return Account', accountGroup: 'Sales Accounts', debit: 0, credit: Math.abs(baseDebit) });
    }
    if (cgstSum > 0) lines.push({ ledgerName: 'Output CGST', accountGroup: 'Duties & Taxes', debit: Number(cgstSum.toFixed(2)), credit: 0 });
    if (sgstSum > 0) lines.push({ ledgerName: 'Output SGST', accountGroup: 'Duties & Taxes', debit: Number(sgstSum.toFixed(2)), credit: 0 });
    if (igstSum > 0) lines.push({ ledgerName: 'Output IGST', accountGroup: 'Duties & Taxes', debit: Number(igstSum.toFixed(2)), credit: 0 });
    lines.push({ ledgerName: v.partyName || 'Sundry Debtors', accountGroup: 'Sundry Debtors', debit: 0, credit: Number(v.grandTotal.toFixed(2)) });
  } else if (v.type === 'purchase_bill') {
    const baseDebit = Number((v.subTotal + v.additionalCharges + v.roundOff).toFixed(2));
    lines.push({ ledgerName: 'Purchase Account', accountGroup: 'Purchase Accounts', debit: Math.max(0, baseDebit), credit: 0 });
    if (cgstSum > 0) lines.push({ ledgerName: 'Input CGST (ITC)', accountGroup: 'Duties & Taxes', debit: Number(cgstSum.toFixed(2)), credit: 0 });
    if (sgstSum > 0) lines.push({ ledgerName: 'Input SGST (ITC)', accountGroup: 'Duties & Taxes', debit: Number(sgstSum.toFixed(2)), credit: 0 });
    if (igstSum > 0) lines.push({ ledgerName: 'Input IGST (ITC)', accountGroup: 'Duties & Taxes', debit: Number(igstSum.toFixed(2)), credit: 0 });
    const paid = Math.max(0, Number(v.paidAmount.toFixed(2)));
    const unpaid = Math.max(0, Number((v.grandTotal - paid).toFixed(2)));
    const excessAdvance = Math.max(0, Number((paid - v.grandTotal).toFixed(2)));
    if (paid > 0) lines.push({ ledgerName: bankLabel, accountGroup: 'Cash/Bank', debit: 0, credit: paid });
    if (unpaid > 0) lines.push({ ledgerName: v.partyName || 'Sundry Creditors', accountGroup: 'Sundry Creditors', debit: 0, credit: unpaid });
    if (excessAdvance > 0) lines.push({ ledgerName: v.partyName || 'Sundry Creditors', accountGroup: 'Sundry Creditors', debit: excessAdvance, credit: 0 });
  } else if (v.type === 'debit_note') {
    lines.push({ ledgerName: v.partyName || 'Sundry Creditors', accountGroup: 'Sundry Creditors', debit: Number(v.grandTotal.toFixed(2)), credit: 0 });
    const baseCredit = Number((v.subTotal + v.additionalCharges + v.roundOff).toFixed(2));
    if (baseCredit >= 0) {
      lines.push({ ledgerName: 'Purchase Return Account', accountGroup: 'Purchase Accounts', debit: 0, credit: baseCredit });
    } else {
      lines.push({ ledgerName: 'Purchase Return Account', accountGroup: 'Purchase Accounts', debit: Math.abs(baseCredit), credit: 0 });
    }
    if (cgstSum > 0) lines.push({ ledgerName: 'Input CGST (ITC)', accountGroup: 'Duties & Taxes', debit: 0, credit: Number(cgstSum.toFixed(2)) });
    if (sgstSum > 0) lines.push({ ledgerName: 'Input SGST (ITC)', accountGroup: 'Duties & Taxes', debit: 0, credit: Number(sgstSum.toFixed(2)) });
    if (igstSum > 0) lines.push({ ledgerName: 'Input IGST (ITC)', accountGroup: 'Duties & Taxes', debit: 0, credit: Number(igstSum.toFixed(2)) });
  } else if (v.type === 'payment_in') {
    lines.push({ ledgerName: bankLabel, accountGroup: 'Cash/Bank', debit: v.grandTotal, credit: 0 });
    lines.push({ ledgerName: v.partyName || 'Sundry Debtors', accountGroup: 'Sundry Debtors', debit: 0, credit: v.grandTotal });
  } else if (v.type === 'payment_out') {
    lines.push({ ledgerName: v.partyName || 'Sundry Creditors', accountGroup: 'Sundry Creditors', debit: v.grandTotal, credit: 0 });
    lines.push({ ledgerName: bankLabel, accountGroup: 'Cash/Bank', debit: 0, credit: v.grandTotal });
  } else if (v.type === 'expense') {
    lines.push({ ledgerName: v.expenseCategory || 'Indirect Expenses', accountGroup: 'Indirect Expenses', debit: v.grandTotal, credit: 0 });
    lines.push({ ledgerName: bankLabel, accountGroup: 'Cash/Bank', debit: 0, credit: v.grandTotal });
  } else if (v.type === 'contra') {
    const fromName =
      (sqlite.prepare(`SELECT bank_name FROM bank_accounts WHERE id = ?`).get(v.contraFromId || '') as { bank_name?: string } | undefined)
        ?.bank_name || 'Cash-in-Hand';
    const toName =
      (sqlite.prepare(`SELECT bank_name FROM bank_accounts WHERE id = ?`).get(v.contraToId || '') as { bank_name?: string } | undefined)
        ?.bank_name || 'Bank Accounts';
    lines.push({ ledgerName: toName, accountGroup: 'Cash/Bank', debit: v.grandTotal, credit: 0 });
    lines.push({ ledgerName: fromName, accountGroup: 'Cash/Bank', debit: 0, credit: v.grandTotal });
  } else if (v.type === 'journal' && v.journalLines) {
    for (const jl of v.journalLines) {
      lines.push({
        ledgerName: jl.accountName,
        accountGroup: jl.accountGroup,
        debit: jl.debit,
        credit: jl.credit,
        narration: jl.narration,
      });
    }
  }

  if (lines.length === 0) return;

  const entryId = uid('je');
  sqlite
    .prepare(
      `INSERT INTO journal_entries (id, company_id, voucher_id, date, voucher_no, voucher_type, narration, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(entryId, companyId, v.id, v.date, v.voucherNo, v.type, v.notes || v.voucherNo, new Date().toISOString());

  const lineStmt = sqlite.prepare(
    `INSERT INTO journal_lines (id, journal_entry_id, ledger_name, account_group, debit, credit, narration)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const l of lines) {
    lineStmt.run(uid('jl'), entryId, l.ledgerName, l.accountGroup, l.debit, l.credit, l.narration || '');
  }
}

export function applyVoucherStockDelta(companyId: string, v: Voucher, direction: 1 | -1): void {
  if (v.status === 'cancelled') return;
  let mult = 0;
  if (v.type === 'sale_invoice' || v.type === 'debit_note') mult = -1 * direction;
  else if (v.type === 'purchase_bill' || v.type === 'credit_note') mult = 1 * direction;
  if (mult === 0) return;

  const getItem = sqlite.prepare(`SELECT id, type, stock_qty, godown_id, godown_stock_json FROM items WHERE id = ? AND company_id = ?`);
  const updItem = sqlite.prepare(`UPDATE items SET stock_qty = ?, godown_stock_json = ? WHERE id = ? AND company_id = ?`);

  for (const line of v.lines) {
    if (!line.itemId) continue;
    const item = getItem.get(line.itemId, companyId) as
      | { id: string; type: string; stock_qty: number; godown_id: string; godown_stock_json: string }
      | undefined;
    if (!item || item.type !== 'product') continue;
    const delta = line.qty * mult;
    const nextQty = Math.max(0, Number((item.stock_qty + delta).toFixed(2)));
    let gs: Record<string, number> = {};
    try {
      gs = JSON.parse(item.godown_stock_json || '{}');
    } catch {
      gs = {};
    }
    const gId = item.godown_id || 'g1';
    gs[gId] = Math.max(0, Number(((gs[gId] || 0) + delta).toFixed(2)));
    updItem.run(nextQty, JSON.stringify(gs), item.id, companyId);
  }
}

export function postJournalForAdjustmentEntry(
  companyId: string,
  userId: string,
  date: string,
  voucherNo: string,
  narration: string,
  lines: { accountName: string; accountGroup: string; debit: number; credit: number; narration?: string }[]
): void {
  const dr = Number(lines.reduce((s, l) => s + l.debit, 0).toFixed(2));
  const cr = Number(lines.reduce((s, l) => s + l.credit, 0).toFixed(2));
  if (Math.abs(dr - cr) > 0.05 || dr <= 0) {
    throw new Error(`Adjustment journal ${voucherNo} unbalanced (Dr=${dr}, Cr=${cr})`);
  }
  const jVoucher: Voucher = {
    id: uid('v'),
    type: 'journal',
    voucherNo,
    date,
    lines: [],
    additionalCharges: 0,
    discountTotal: 0,
    roundOff: 0,
    subTotal: dr,
    taxTotal: 0,
    grandTotal: dr,
    paidAmount: dr,
    status: 'paid',
    approvalStatus: 'approved',
    journalLines: lines.map((l, idx) => ({ id: `jl_${idx}_${Date.now()}`, ...l })),
    notes: narration,
    createdAt: new Date().toISOString(),
  };
  insertVoucherFull(companyId, jVoucher, userId);
  postJournalForVoucher(companyId, jVoucher);
}

export function insertVoucherFull(companyId: string, v: Voucher, userId: string): void {
  sqlite
    .prepare(
      `INSERT INTO vouchers (
        id, company_id, branch_id, type, voucher_no, date, due_date, party_id, party_name, party_gstin,
        place_of_supply, is_inter_state, additional_charges, discount_total, round_off, sub_total, tax_total,
        grand_total, paid_amount, payment_mode, bank_account_id, split_details_json, status, linked_voucher_id,
        settled_invoices_json, eway_bill_no, vehicle_no, transporter_name, distance_km, irn, is_reverse_charge,
        is_recurring, recurring_interval, expense_category, contra_from_id, contra_to_id, journal_lines_json,
        reconciled, reconciled_date, sales_channel, cost_centre_id, project_id, currency, exchange_rate,
        fx_gain_loss, freight_cost, insurance_cost, customs_cost, approval_status, approved_by,
        shipment_status, tracking_no, sales_rep_name, notes, terms, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.id,
      companyId,
      v.branchId || null,
      v.type,
      v.voucherNo,
      v.date,
      v.dueDate || null,
      v.partyId || null,
      v.partyName || null,
      v.partyGstin || null,
      v.placeOfSupply || null,
      v.isInterState ? 1 : 0,
      v.additionalCharges || 0,
      v.discountTotal || 0,
      v.roundOff || 0,
      v.subTotal || 0,
      v.taxTotal || 0,
      v.grandTotal || 0,
      v.paidAmount || 0,
      v.paymentMode || null,
      v.bankAccountId || null,
      v.splitDetails ? JSON.stringify(v.splitDetails) : null,
      v.status || 'paid',
      v.linkedVoucherId || null,
      v.settledInvoices ? JSON.stringify(v.settledInvoices) : null,
      v.ewayBillNo || null,
      v.vehicleNo || null,
      v.transporterName || null,
      v.distanceKm || null,
      v.irn || null,
      v.isReverseCharge ? 1 : 0,
      v.isRecurring ? 1 : 0,
      v.recurringInterval || null,
      v.expenseCategory || null,
      v.contraFromId || null,
      v.contraToId || null,
      v.journalLines ? JSON.stringify(v.journalLines) : null,
      v.reconciled ? 1 : 0,
      v.reconciledDate || null,
      v.salesChannel || 'Direct B2B',
      v.costCentreId || null,
      v.projectId || null,
      v.currency || 'INR',
      v.exchangeRate || 1,
      v.fxGainLoss || 0,
      v.freightCost || 0,
      v.insuranceCost || 0,
      v.customsCost || 0,
      v.approvalStatus || 'approved',
      v.approvedBy || null,
      v.shipmentStatus || 'Delivered',
      v.trackingNo || null,
      v.salesRepName || null,
      v.notes || null,
      v.terms || null,
      userId,
      v.createdAt || new Date().toISOString()
    );

  const lineStmt = sqlite.prepare(
    `INSERT INTO voucher_lines (
      id, voucher_id, item_id, item_name, hsn, qty, unit, rate, discount_pct, tax_rate, cess_rate,
      taxable_amount, cgst, sgst, igst, cess, total, batch_no, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const l of v.lines) {
    const metaJson = JSON.stringify({
      description: l.description || '',
      mrp: l.mrp ?? undefined,
      serialNo: l.serialNo || '',
      mfgDate: l.mfgDate || '',
      expDate: l.expDate || '',
      modelNo: l.modelNo || '',
      size: l.size || '',
      customValues: l.customValues || undefined,
    });
    lineStmt.run(
      l.id || uid('vl'),
      v.id,
      l.itemId,
      l.itemName,
      l.hsn || '',
      l.qty,
      l.unit,
      l.rate,
      l.discountPct || 0,
      l.taxRate || 0,
      l.cessRate || 0,
      l.taxableAmount,
      l.cgst || 0,
      l.sgst || 0,
      l.igst || 0,
      l.cess || 0,
      l.total,
      l.batchNo || null,
      metaJson
    );
  }
}

export function seedCompanyDemoRecords(companyId: string, userId: string, userName: string): void {
  const seed = createSeedDatabase();
  const branchId = `br_${companyId}_main`;

  sqlite
    .prepare(`INSERT OR IGNORE INTO branches (id, company_id, name, code, address, manager, is_default) VALUES (?, ?, ?, ?, ?, ?, 1)`)
    .run(branchId, companyId, 'Head Office (Mumbai)', 'HO-01', seed.profile.address, userName);

  ensureSystemLedgers(companyId);

  const gMap = new Map<string, string>();
  for (const g of seed.godowns) {
    const gid = `${companyId}_${g.id}`;
    gMap.set(g.id, gid);
    sqlite
      .prepare(`INSERT INTO godowns (id, company_id, branch_id, name, location, manager, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(gid, companyId, branchId, g.name, g.location, g.manager, g.isDefault ? 1 : 0);
  }

  const bMap = new Map<string, string>();
  for (const b of seed.bankAccounts) {
    const bid = `${companyId}_${b.id}`;
    bMap.set(b.id, bid);
    sqlite
      .prepare(
        `INSERT INTO bank_accounts (id, company_id, bank_name, account_no, ifsc, branch, upi_id, opening_balance, type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(bid, companyId, b.bankName, b.accountNo, b.ifsc, b.branch, b.upiId, b.openingBalance, b.type);
  }

  const pMap = new Map<string, string>();
  for (const p of seed.parties) {
    const pid = `${companyId}_${p.id}`;
    pMap.set(p.id, pid);
    sqlite
      .prepare(
        `INSERT INTO parties (id, company_id, name, type, phone, email, gstin, pan, state, billing_address, shipping_address, opening_balance, opening_type, credit_limit, credit_days, group_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pid,
        companyId,
        p.name,
        p.type,
        p.phone,
        p.email,
        p.gstin,
        p.pan,
        p.state,
        p.billingAddress,
        p.shippingAddress,
        p.openingBalance,
        p.openingType,
        p.creditLimit,
        p.creditDays,
        p.group,
        p.createdAt
      );
  }

  const iMap = new Map<string, string>();
  for (const it of seed.items) {
    const iid = `${companyId}_${it.id}`;
    iMap.set(it.id, iid);
    const mappedGs: Record<string, number> = {};
    if (it.godownStock) {
      for (const [k, qty] of Object.entries(it.godownStock)) {
        mappedGs[gMap.get(k) || k] = qty;
      }
    }
    sqlite
      .prepare(
        `INSERT INTO items (id, company_id, name, type, sku, barcode, hsn, category, subcategory, unit, secondary_unit, conversion_rate, sale_price, purchase_price, mrp, wholesale_price, tax_rate, cess_rate, tax_inclusive, opening_stock, stock_qty, min_stock_alert, godown_id, godown_stock_json, track_batch, batches_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        iid,
        companyId,
        it.name,
        it.type,
        it.sku,
        it.barcode,
        it.hsn,
        it.category,
        '',
        it.unit.toUpperCase(),
        it.secondaryUnit || '',
        it.conversionRate || 1,
        it.salePrice,
        it.purchasePrice,
        it.mrp,
        it.wholesalePrice,
        it.taxRate,
        it.cessRate,
        it.taxInclusive ? 1 : 0,
        it.stockQty,
        it.stockQty,
        it.minStockAlert,
        gMap.get(it.godownId) || '',
        JSON.stringify(mappedGs),
        it.trackBatch ? 1 : 0,
        JSON.stringify(it.batches || [])
      );
  }

  const demoChannels = ['Direct B2B', 'Wholesale', 'Online Store', 'Retail POS Counter'];
  let invIdx = 0;
  for (const v of seed.vouchers) {
    const vid = `${companyId}_${v.id}`;
    const channel = v.type === 'sale_invoice' ? demoChannels[invIdx++ % demoChannels.length] : 'Direct B2B';
    const isFx = v.id === 'v3';
    const mappedVoucher: Voucher = {
      ...v,
      id: vid,
      branchId,
      partyId: v.partyId ? pMap.get(v.partyId) || v.partyId : undefined,
      bankAccountId: v.bankAccountId ? bMap.get(v.bankAccountId) || v.bankAccountId : undefined,
      contraFromId: v.contraFromId ? bMap.get(v.contraFromId) || v.contraFromId : undefined,
      contraToId: v.contraToId ? bMap.get(v.contraToId) || v.contraToId : undefined,
      reconciled: v.paymentMode === 'Bank Transfer' || v.paymentMode === 'UPI',
      salesChannel: (channel as Voucher['salesChannel']),
      costCentreId: `${companyId}_cc_${v.id === 'v4' ? '2' : '1'}`,
      projectId: v.id === 'v2' ? `${companyId}_prj1` : undefined,
      currency: isFx ? 'USD' : 'INR',
      exchangeRate: isFx ? 84.5 : 1,
      fxGainLoss: isFx ? 1420 : 0,
      freightCost: v.type === 'purchase_bill' ? 850 : 0,
      insuranceCost: v.type === 'purchase_bill' ? 220 : 0,
      customsCost: v.id === 'v6' ? 400 : 0,
      approvalStatus: 'approved',
      shipmentStatus: v.type === 'sale_invoice' ? (v.id === 'v3' ? 'Dispatched' : 'Delivered') : 'Delivered',
      trackingNo: v.id === 'v3' ? 'VRL-9928410' : undefined,
      salesRepName: v.id === 'v1' || v.id === 'v3' ? 'Rohan Verma' : 'Rajesh Sharma',
      lines: v.lines.map((l) => ({
        ...l,
        id: `${vid}_${l.id}`,
        itemId: iMap.get(l.itemId) || l.itemId,
      })),
    };
    insertVoucherFull(companyId, mappedVoucher, userId);
    postJournalForVoucher(companyId, mappedVoucher);
  }

  for (const ch of seed.cheques) {
    sqlite
      .prepare(
        `INSERT INTO cheques (id, company_id, cheque_no, date, clearance_date, party_id, party_name, bank_account_id, amount, direction, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `${companyId}_${ch.id}`,
        companyId,
        ch.chequeNo,
        ch.date,
        ch.clearanceDate || null,
        pMap.get(ch.partyId) || ch.partyId,
        ch.partyName,
        bMap.get(ch.bankAccountId) || ch.bankAccountId,
        ch.amount,
        ch.direction,
        ch.status,
        ch.notes
      );
  }

  for (const ln of seed.loans) {
    sqlite
      .prepare(
        `INSERT INTO loans (id, company_id, lender_name, account_no, principal, interest_rate, emi_amount, start_date, tenure_months, paid_emis, bank_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `${companyId}_${ln.id}`,
        companyId,
        ln.lenderName,
        ln.accountNo,
        ln.principal,
        ln.interestRate,
        ln.emiAmount,
        ln.startDate,
        ln.tenureMonths,
        ln.paidEmis,
        bMap.get(ln.bankAccountId) || ln.bankAccountId
      );
  }

  for (const sa of seed.stockAdjustments) {
    sqlite
      .prepare(
        `INSERT INTO stock_adjustments (id, company_id, date, item_id, item_name, type, qty, reason, cost_per_unit, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `${companyId}_${sa.id}`,
        companyId,
        sa.date,
        iMap.get(sa.itemId) || sa.itemId,
        sa.itemName,
        sa.type,
        sa.qty,
        sa.reason,
        sa.costPerUnit,
        sa.notes
      );
  }

  for (const st of seed.stockTransfers) {
    sqlite
      .prepare(
        `INSERT INTO stock_transfers (id, company_id, transfer_no, date, from_godown_id, to_godown_id, items_json, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `${companyId}_${st.id}`,
        companyId,
        st.transferNo,
        st.date,
        gMap.get(st.fromGodownId) || st.fromGodownId,
        gMap.get(st.toGodownId) || st.toGodownId,
        JSON.stringify(
          st.items.map((x) => ({ ...x, itemId: iMap.get(x.itemId) || x.itemId }))
        ),
        st.notes
      );
  }

  let sIdx = 1;
  for (const m of seed.staff) {
    const depts = ['Management', 'Accounts & Finance', 'Sales & Billing', 'Warehouse & Inventory'];
    const desigs = ['Director', 'Senior Accountant', 'POS Billing Executive', 'Inventory Supervisor'];
    const empCode = `EMP-${String(100 + sIdx)}`;
    const basic = Math.round(m.monthlySalary * 0.5);
    const pf = Math.round(basic * 0.12);
    sqlite
      .prepare(
        `INSERT INTO staff_members (
          id, company_id, emp_code, name, role, designation, department, joining_date, employment_type,
          phone, email, pan, uan, esic_no, bank_name, bank_account_no, ifsc, payment_mode,
          monthly_salary, hra_pct, conveyance_amt, allowance_amt, pf_deduction, esic_deduction, pt_deduction, tds_deduction,
          include_pf, include_esic, tax_regime, pt_state, attendance_days, lop_days, overtime_hours, overtime_rate,
          bonus_amt, arrears_amt, commission_pct, cl_balance, sl_balance, el_balance, status, last_paid_month, permissions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `${companyId}_${m.id}`,
        companyId,
        empCode,
        m.name,
        m.role,
        desigs[(sIdx - 1) % desigs.length],
        depts[(sIdx - 1) % depts.length],
        '2025-04-01',
        'Full-Time',
        m.phone,
        m.email,
        `ABCDE${1020 + sIdx}F`,
        `10129845${1000 + sIdx}`,
        m.monthlySalary <= 21000 ? `31-00-${450000 + sIdx}` : '',
        'HDFC Bank Ltd',
        `50100${492010 + sIdx}`,
        'HDFC0000240',
        'Bank Transfer',
        m.monthlySalary,
        20,
        1600,
        2000,
        pf,
        m.monthlySalary <= 21000 ? Math.round(m.monthlySalary * 0.0075) : 0,
        200,
        m.monthlySalary > 50000 ? Math.round((m.monthlySalary - 50000) * 0.1) : 0,
        1,
        m.monthlySalary <= 21000 ? 1 : 0,
        'New',
        'Maharashtra',
        26,
        0,
        sIdx === 3 ? 6 : 0,
        250,
        sIdx === 2 ? 2500 : 0,
        0,
        1.5,
        6,
        6,
        12,
        m.status,
        m.lastPaidMonth || null,
        JSON.stringify(m.permissions)
      );
    sIdx += 1;
  }

  ensureCompanyErpSeed(companyId, userName);
  recordAudit(companyId, userId, userName, 'SEED_DEMO', 'Company', companyId, 'Initialized Shobhit Invoice Pro demo dataset');
}

export function ensureCompanyPayrollSeed(companyId: string): void {
  const staffRows = sqlite.prepare(`SELECT * FROM staff_members WHERE company_id = ?`).all(companyId) as Array<Record<string, unknown>>;
  if (staffRows.length === 0) return;

  // Backfill HR/Bank/PAN/UAN on pre-existing staff rows missing emp_code
  const depts = ['Management', 'Accounts & Finance', 'Sales & Billing', 'Warehouse & Inventory'];
  const desigs = ['Director', 'Senior Accountant', 'POS Billing Executive', 'Inventory Supervisor'];
  staffRows.forEach((st, idx) => {
    if (!st.emp_code || !st.bank_account_no) {
      const empCode = `EMP-${String(101 + idx)}`;
      const basic = Math.round(Number(st.monthly_salary || 25000) * 0.5);
      const pf = Math.round(basic * 0.12);
      sqlite.prepare(
        `UPDATE staff_members SET
          emp_code = COALESCE(NULLIF(emp_code, ''), ?),
          designation = COALESCE(NULLIF(designation, ''), ?),
          department = COALESCE(NULLIF(department, ''), ?),
          joining_date = COALESCE(NULLIF(joining_date, ''), '2025-04-01'),
          employment_type = COALESCE(NULLIF(employment_type, ''), 'Full-Time'),
          pan = COALESCE(NULLIF(pan, ''), ?),
          uan = COALESCE(NULLIF(uan, ''), ?),
          bank_name = COALESCE(NULLIF(bank_name, ''), 'HDFC Bank Ltd'),
          bank_account_no = COALESCE(NULLIF(bank_account_no, ''), ?),
          ifsc = COALESCE(NULLIF(ifsc, ''), 'HDFC0000240'),
          payment_mode = COALESCE(NULLIF(payment_mode, ''), 'Bank Transfer'),
          pf_deduction = CASE WHEN pf_deduction IS NULL OR pf_deduction = 0 THEN ? ELSE pf_deduction END,
          pt_deduction = CASE WHEN pt_deduction IS NULL THEN 200 ELSE pt_deduction END
        WHERE id = ?`
      ).run(
        empCode,
        desigs[idx % desigs.length],
        depts[idx % depts.length],
        `ABCDE${1021 + idx}F`,
        `10129845${1001 + idx}`,
        `50100${492011 + idx}`,
        pf,
        String(st.id)
      );
    }
  });

  const prCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM payroll_runs WHERE company_id = ?`).get(companyId) as { c: number }).c;
  if (prCount === 0) {
    const refreshed = sqlite.prepare(`SELECT * FROM staff_members WHERE company_id = ? LIMIT 3`).all(companyId) as Array<Record<string, unknown>>;
    refreshed.forEach((st, idx) => {
      const base = Number(st.monthly_salary || 25000);
      const basic = Math.round(base * 0.5);
      const hra = Math.round(base * 0.2);
      const conv = Number(st.conveyance_amt || 1600);
      const spec = Math.max(0, base - basic - hra - conv) + Number(st.allowance_amt || 2000);
      const gross = basic + hra + conv + spec;
      const empPf = Math.min(1800, Math.round(basic * 0.12));
      const pt = 200;
      const tds = Number(st.tds_deduction || 0);
      const net = Math.max(0, gross - empPf - pt - tds);
      sqlite.prepare(
        `INSERT INTO payroll_runs (
          id, company_id, payslip_no, staff_id, staff_name, emp_code, department, designation, month, pay_date,
          working_days, paid_days, lop_days, basic, hra, conveyance, special_allowance, overtime_pay, bonus, commission,
          arrears, reimbursement, gross_earnings, employee_pf, employee_esic, professional_tax, tds, advance_recovery,
          other_deductions, total_deductions, employer_pf, employer_esic, net_pay, payment_mode, bank_account_id, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10', '2026-10-31', 26, 26, 0, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, 0, ?, ?, 0, 0, ?, ?, 0, ?, 'Bank Transfer', '', 'Paid', 'October 2026 Salary Credited')`
      ).run(
        uid('prun'), companyId, `PAY-2610-${String(idx + 1).padStart(3, '0')}`,
        String(st.id), String(st.name), String(st.emp_code || `EMP-10${idx + 1}`),
        String(st.department || 'Operations'), String(st.designation || st.role),
        basic, hra, conv, spec, gross, empPf, pt, tds, empPf + pt + tds, empPf, net
      );
    });
    if (refreshed[1]) {
      sqlite.prepare(
        `INSERT INTO employee_advances (id, company_id, staff_id, staff_name, date, type, amount, monthly_emi, recovered_amount, reason, status)
         VALUES (?, ?, ?, ?, '2026-10-15', 'Salary Advance', 10000, 2500, 2500, 'Festival Medical Advance', 'Active')`
      ).run(uid('adv'), companyId, String(refreshed[1].id), String(refreshed[1].name));
      sqlite.prepare(
        `INSERT INTO leave_requests (id, company_id, staff_id, staff_name, leave_type, from_date, to_date, days, reason, status)
         VALUES (?, ?, ?, ?, 'CL', '2026-11-20', '2026-11-21', 2, 'Family function', 'Pending')`
      ).run(uid('lv'), companyId, String(refreshed[1].id), String(refreshed[1].name));
      sqlite.prepare(
        `INSERT INTO reimbursements (id, company_id, staff_id, staff_name, date, category, amount, description, status)
         VALUES (?, ?, ?, ?, '2026-11-12', 'Travel', 1450, 'Client site visit conveyance & toll', 'Approved')`
      ).run(uid('rmb'), companyId, String(refreshed[1].id), String(refreshed[1].name));
    }
  }
}

export function ensureCompanyErpSeed(companyId: string, ownerName = 'Shobhit Mishra'): void {
  ensureCompanyPayrollSeed(companyId);
  const existingCc = (sqlite.prepare(`SELECT COUNT(*) as c FROM cost_centres WHERE company_id = ?`).get(companyId) as { c: number }).c;
  if (existingCc > 0) return;

  ensureSystemLedgers(companyId);

  const items = sqlite.prepare(`SELECT id, name, sku, purchase_price FROM items WHERE company_id = ?`).all(companyId) as Array<{
    id: string; name: string; sku: string; purchase_price: number;
  }>;
  const parties = sqlite.prepare(`SELECT id, name, type FROM parties WHERE company_id = ?`).all(companyId) as Array<{
    id: string; name: string; type: string;
  }>;
  const staff = sqlite.prepare(`SELECT id, name FROM staff_members WHERE company_id = ?`).all(companyId) as Array<{
    id: string; name: string;
  }>;

  const cust = parties.find((p) => p.type === 'customer') || parties[0];
  const cust2 = parties.filter((p) => p.type === 'customer')[1] || cust;
  const sup = parties.find((p) => p.type === 'supplier') || parties[0];
  const it1 = items[0];
  const it2 = items[1] || items[0];
  const it5 = items[4] || items[0];
  const it7 = items[6] || items[0];

  // 1. Cost Centres
  const ccData = [
    { id: `${companyId}_cc_1`, code: 'CC-B2B', name: 'B2B Wholesale Division', type: 'Department', mgr: ownerName, limit: 250000 },
    { id: `${companyId}_cc_2`, code: 'CC-POS', name: 'Mumbai Retail Counter', type: 'Branch', mgr: 'Rohan Verma', limit: 100000 },
    { id: `${companyId}_cc_3`, code: 'CC-PRJ', name: 'Industrial Contracting', type: 'Project', mgr: 'Vikram Patel', limit: 350000 },
  ];
  for (const cc of ccData) {
    sqlite.prepare(`INSERT OR IGNORE INTO cost_centres (id, company_id, code, name, type, manager, budget_limit, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(cc.id, companyId, cc.code, cc.name, cc.type, cc.mgr, cc.limit);
  }

  // 2. Budgets
  const budgets = [
    { name: 'FY 2026-27 Revenue Target', cat: 'Sales Account', cc: ccData[0].id, period: 'FY 2026-27', type: 'Income', amt: 1500000 },
    { name: 'Warehouse Rent & Utilities', cat: 'Office Rent', cc: ccData[0].id, period: 'Nov 2026', type: 'Expense', amt: 35000 },
    { name: 'Monthly Inventory Procurement', cat: 'Purchase Account', cc: ccData[0].id, period: 'Nov 2026', type: 'Purchase', amt: 250000 },
    { name: 'Net Profit Goal Q3', cat: 'Overall Profit', cc: ccData[2].id, period: 'Q3 2026', type: 'Profit', amt: 180000 },
  ];
  for (const b of budgets) {
    sqlite.prepare(`INSERT INTO budgets (id, company_id, name, category, cost_centre_id, period, budget_type, planned_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`)
      .run(uid('bud'), companyId, b.name, b.cat, b.cc, b.period, b.type, b.amt);
  }

  // 3. Fixed Assets
  const assets = [
    { code: 'FA-001', name: 'Cable Winding & Cutting Machine', cat: 'Plant & Machinery', date: '2025-04-15', cost: 240000, salvage: 20000, life: 8, method: 'SLM', rate: 12.5, dep: 27500, loc: 'Bhiwandi Depot', to: 'Vikram Patel' },
    { code: 'FA-002', name: 'Tata Ace Gold Delivery Van', cat: 'Vehicles', date: '2025-08-01', cost: 620000, salvage: 80000, life: 8, method: 'WDV', rate: 15, dep: 78000, loc: 'Andheri Hub', to: 'Logistics Team' },
    { code: 'FA-003', name: 'POS Terminals & ERP Workstations', cat: 'IT & Computers', date: '2026-01-10', cost: 135000, salvage: 10000, life: 3, method: 'WDV', rate: 40, dep: 24000, loc: 'Head Office', to: 'Priya Deshmukh' },
  ];
  for (const a of assets) {
    sqlite.prepare(`INSERT INTO fixed_assets (id, company_id, asset_code, name, category, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, depreciation_rate_pct, accumulated_dep, location, assigned_to, status, last_depreciated_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', '2026-10-31')`)
      .run(uid('fa'), companyId, a.code, a.name, a.cat, a.date, a.cost, a.salvage, a.life, a.method, a.rate, a.dep, a.loc, a.to);
  }

  // 4. BOMs & Production Orders
  if (it1 && it2 && it5 && it7) {
    const bomId = uid('bom');
    const comps = [
      { itemId: it2.id, itemName: it2.name, qtyPerUnit: 2, unitCost: it2.purchase_price },
      { itemId: it5.id, itemName: it5.name, qtyPerUnit: 10, unitCost: it5.purchase_price },
      { itemId: it7.id, itemName: it7.name, qtyPerUnit: 1, unitCost: it7.purchase_price },
    ];
    sqlite.prepare(`INSERT INTO boms (id, company_id, finished_item_id, finished_item_name, sku, output_qty, labour_cost_per_batch, overhead_cost_per_batch, components_json) VALUES (?, ?, ?, ?, ?, 1, 650, 350, ?)`)
      .run(bomId, companyId, it1.id, `${it1.name} (Pre-Wired Kit)`, it1.sku || 'KIT-01', JSON.stringify(comps));

    const unitMat = comps.reduce((s, c) => s + c.qtyPerUnit * c.unitCost, 0);
    sqlite.prepare(`INSERT INTO production_orders (id, company_id, order_no, bom_id, finished_item_id, finished_item_name, planned_qty, completed_qty, start_date, due_date, status, planned_material_cost, actual_material_cost, planned_labour_overhead, actual_labour_overhead, wastage_pct, notes) VALUES (?, ?, 'MFG-2627-001', ?, ?, ?, 10, 10, '2026-10-12', '2026-10-18', 'Completed', ?, ?, 10000, 10800, 2.5, 'Delivered to B2B batch')`)
      .run(uid('prd'), companyId, bomId, it1.id, `${it1.name} (Pre-Wired Kit)`, unitMat * 10, unitMat * 10 * 1.04);
    sqlite.prepare(`INSERT INTO production_orders (id, company_id, order_no, bom_id, finished_item_id, finished_item_name, planned_qty, completed_qty, start_date, due_date, status, planned_material_cost, actual_material_cost, planned_labour_overhead, actual_labour_overhead, wastage_pct, notes) VALUES (?, ?, 'MFG-2627-002', ?, ?, ?, 15, 6, '2026-11-10', '2026-11-22', 'In-Progress (WIP)', ?, ?, 15000, 9200, 1.8, 'Floor Line 2 Active')`)
      .run(uid('prd'), companyId, bomId, it1.id, `${it1.name} (Pre-Wired Kit)`, unitMat * 15, unitMat * 6.2);
  }

  // 5. Job Works & Projects
  if (sup && it5) {
    sqlite.prepare(`INSERT INTO job_works (id, company_id, challan_no, vendor_party_id, vendor_name, date, material_sent_item_id, material_sent_name, qty_sent, qty_received_back, wastage_qty, processing_charge, status, notes) VALUES (?, ?, 'JW-001', ?, ?, '2026-11-05', ?, ?, 100, 60, 2, 4500, 'Partially Received', 'Custom powder-coated enclosure assembly')`)
      .run(uid('jw'), companyId, sup.id, sup.name, it5.id, it5.name);
  }
  if (cust2) {
    sqlite.prepare(`INSERT INTO projects (id, company_id, code, name, client_party_id, client_name, cost_centre_id, start_date, end_date, contract_value, material_cost, labour_cost, overhead_cost, billed_amount, status) VALUES (?, ?, 'PRJ-HJV2', 'Hinjewadi Phase 2 LT Panel Setup', ?, ?, ?, '2026-09-01', '2026-12-30', 245000, 98000, 32000, 14500, 140500, 'Active')`)
      .run(`${companyId}_prj1`, companyId, cust2.id, cust2.name, ccData[2].id);
  }

  // 6. Workflow Rules, Approval Rules, Currencies, Commissions, Pricing Rules, Subscriptions
  sqlite.prepare(`INSERT INTO workflow_rules (id, company_id, name, trigger_event, condition_text, action_text, enabled, executions_count, last_triggered_at) VALUES (?, ?, 'Overdue Payment Reminder', 'Invoice > 30 Days Unpaid', 'balanceDue > 0 AND days > 30', 'Send WhatsApp & Email Payment Link', 1, 14, '2026-11-14')`)
    .run(uid('wf'), companyId);
  sqlite.prepare(`INSERT INTO workflow_rules (id, company_id, name, trigger_event, condition_text, action_text, enabled, executions_count, last_triggered_at) VALUES (?, ?, 'Low Stock Auto-PO Alert', 'Stock <= Min Alert', 'stockQty <= minStockAlert', 'Draft Purchase Order for Preferred Supplier', 1, 6, '2026-11-15')`)
    .run(uid('wf'), companyId);

  sqlite.prepare(`INSERT INTO approval_rules (id, company_id, document_type, threshold_amount, approver_role, enabled) VALUES (?, ?, 'purchase_bill', 50000, 'Admin', 1)`).run(uid('apr'), companyId);
  sqlite.prepare(`INSERT INTO approval_rules (id, company_id, document_type, threshold_amount, approver_role, enabled) VALUES (?, ?, 'expense', 25000, 'Admin', 1)`).run(uid('apr'), companyId);

  const currencies = [
    { code: 'INR', name: 'Indian Rupee', sym: 'Rs.', rate: 1 },
    { code: 'USD', name: 'US Dollar', sym: '$', rate: 84.5 },
    { code: 'EUR', name: 'Euro', sym: 'EUR', rate: 90.2 },
    { code: 'GBP', name: 'British Pound', sym: 'GBP', rate: 106.8 },
    { code: 'AED', name: 'UAE Dirham', sym: 'AED', rate: 23.0 },
  ];
  for (const c of currencies) {
    sqlite.prepare(`INSERT OR IGNORE INTO currency_rates (id, company_id, code, name, symbol, rate_to_inr, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-11-15')`)
      .run(uid('cur'), companyId, c.code, c.name, c.sym, c.rate);
  }

  for (const st of staff.slice(0, 2)) {
    sqlite.prepare(`INSERT INTO commission_rules (id, company_id, staff_id, staff_name, basis, rate_pct, monthly_target, bonus_on_target) VALUES (?, ?, ?, ?, 'Revenue', 2.0, 120000, 5000)`)
      .run(uid('com'), companyId, st.id, st.name);
  }

  sqlite.prepare(`INSERT INTO pricing_rules (id, company_id, name, category, min_qty, discount_pct, target_margin_pct, channel, active) VALUES (?, ?, 'Bulk Wire Coil Tier (20+)', 'Cables & Wires', 20, 5, 16, 'Wholesale', 1)`).run(uid('pr'), companyId);
  sqlite.prepare(`INSERT INTO pricing_rules (id, company_id, name, category, min_qty, discount_pct, target_margin_pct, channel, active) VALUES (?, ?, 'Switchgear Volume Rebate (50+)', 'Switchgear', 50, 7.5, 18, 'Direct B2B', 1)`).run(uid('pr'), companyId);

  if (cust) {
    sqlite.prepare(`INSERT INTO subscription_plans (id, company_id, plan_name, party_id, party_name, amount, interval, next_billing_date, status, auto_renew) VALUES (?, ?, 'Annual Electrical AMC Retainer', ?, ?, 12500, 'Monthly', '2026-11-01', 'Active', 1)`)
      .run(uid('sub'), companyId, cust.id, cust.name);
  }

  // 7. Compliance, Documents, API Key, Webhook, Custom Report
  const compItems = [
    { title: 'GSTR-1 Monthly Return (Oct 2026)', cat: 'GST', due: '2026-11-11', status: 'Filed', ref: 'AA271126004912K' },
    { title: 'GSTR-3B Summary & Tax Payment', cat: 'GST', due: '2026-11-20', status: 'Upcoming', ref: '' },
    { title: 'TDS Challan 281 Deposit (Sec 194C/194J)', cat: 'TDS', due: '2026-12-07', status: 'Upcoming', ref: '' },
    { title: 'Advance Tax Q3 Installment (75%)', cat: 'Income Tax', due: '2026-12-15', status: 'Upcoming', ref: '' },
  ];
  for (const ci of compItems) {
    sqlite.prepare(`INSERT INTO compliance_items (id, company_id, title, category, due_date, status, reference_no, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'Statutory Compliance Tracker')`)
      .run(uid('cmpi'), companyId, ci.title, ci.cat, ci.due, ci.status, ci.ref);
  }

  sqlite.prepare(`INSERT INTO documents (id, company_id, title, category, linked_voucher_no, uploaded_at, signed_by, signature_hash, file_type, preview_text) VALUES (?, ?, 'GST Registration Certificate (REG-06)', 'GST Certificate', '', '2026-04-02', ?, 'sha256:9f84b2c1a09e7712d4b5e1a9f', 'PDF', 'Verified GSTIN 27AABCA9281K1Z5 - Apex Bharat Enterprises')`)
    .run(uid('doc'), companyId, ownerName);

  sqlite.prepare(`INSERT INTO api_keys (id, company_id, label, api_key, scopes_json, active, created_at) VALUES (?, ?, 'Primary ERP Sync Key', ?, ?, 1, ?)`)
    .run(uid('key'), companyId, `sip_live_${companyId.slice(-6)}_992841`, JSON.stringify(['invoices:read', 'parties:read', 'items:read']), new Date().toISOString());

  sqlite.prepare(`INSERT INTO webhooks (id, company_id, event, target_url, active, last_status, last_delivered_at) VALUES (?, ?, 'invoice.created', 'https://hooks.shobhitinvoicepro.in/erp-sync', 1, 200, '2026-11-12T10:30:00Z')`)
    .run(uid('wh'), companyId);

  sqlite.prepare(`INSERT INTO custom_reports (id, company_id, name, dataset, columns_json, group_by, metric_formula, chart_type, schedule_cron, created_at) VALUES (?, ?, 'Channel Revenue & Tax Breakdown', 'vouchers', ?, 'salesChannel', 'SUM(grandTotal)', 'bar', 'Weekly Mon 09:00', ?)`)
    .run(uid('cr'), companyId, JSON.stringify(['voucherNo', 'date', 'partyName', 'salesChannel', 'subTotal', 'taxTotal', 'grandTotal']), new Date().toISOString());

  // 8. Seed initial Payroll Run, Advance, Leave & Reimbursement records for demo
  const firstStaff = sqlite.prepare(`SELECT * FROM staff_members WHERE company_id = ? LIMIT 3`).all(companyId) as Array<Record<string, unknown>>;
  firstStaff.forEach((st, idx) => {
    const base = Number(st.monthly_salary || 25000);
    const basic = Math.round(base * 0.5);
    const hra = Math.round(base * 0.2);
    const conv = Number(st.conveyance_amt || 1600);
    const spec = Math.max(0, base - basic - hra - conv) + Number(st.allowance_amt || 2000);
    const gross = basic + hra + conv + spec;
    const empPf = Math.round(basic * 0.12);
    const pt = 200;
    const tds = Number(st.tds_deduction || 0);
    const net = Math.max(0, gross - empPf - pt - tds);
    sqlite.prepare(
      `INSERT INTO payroll_runs (
        id, company_id, payslip_no, staff_id, staff_name, emp_code, department, designation, month, pay_date,
        working_days, paid_days, lop_days, basic, hra, conveyance, special_allowance, overtime_pay, bonus, commission,
        arrears, reimbursement, gross_earnings, employee_pf, employee_esic, professional_tax, tds, advance_recovery,
        other_deductions, total_deductions, employer_pf, employer_esic, net_pay, payment_mode, bank_account_id, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10', '2026-10-31', 26, 26, 0, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, 0, ?, ?, 0, 0, ?, ?, 0, ?, 'Bank Transfer', '', 'Paid', 'October 2026 Salary Credited')`
    ).run(
      uid('prun'), companyId, `PAY-2610-${String(idx + 1).padStart(3, '0')}`,
      String(st.id), String(st.name), String(st.emp_code || `EMP-10${idx + 1}`),
      String(st.department || 'Operations'), String(st.designation || st.role),
      basic, hra, conv, spec, gross, empPf, pt, tds, empPf + pt + tds, empPf, net
    );
  });
  if (firstStaff[1]) {
    sqlite.prepare(
      `INSERT INTO employee_advances (id, company_id, staff_id, staff_name, date, type, amount, monthly_emi, recovered_amount, reason, status)
       VALUES (?, ?, ?, ?, '2026-10-15', 'Salary Advance', 10000, 2500, 2500, 'Festival Medical Advance', 'Active')`
    ).run(uid('adv'), companyId, String(firstStaff[1].id), String(firstStaff[1].name));
    sqlite.prepare(
      `INSERT INTO leave_requests (id, company_id, staff_id, staff_name, leave_type, from_date, to_date, days, reason, status)
       VALUES (?, ?, ?, ?, 'CL', '2026-11-20', '2026-11-21', 2, 'Family function', 'Pending')`
    ).run(uid('lv'), companyId, String(firstStaff[1].id), String(firstStaff[1].name));
    sqlite.prepare(
      `INSERT INTO reimbursements (id, company_id, staff_id, staff_name, date, category, amount, description, status)
       VALUES (?, ?, ?, ?, '2026-11-12', 'Travel', 1450, 'Client site visit conveyance & toll', 'Approved')`
    ).run(uid('rmb'), companyId, String(firstStaff[1].id), String(firstStaff[1].name));
  }
}

export function ensureDemoAccount(): { userId: string; companyId: string } {
  const existing = sqlite.prepare(`SELECT id FROM users WHERE email = ?`).get('shobhit@shobhitinvoicepro.in') as
    | { id: string }
    | undefined;
  if (existing) {
    const comp = sqlite.prepare(`SELECT id FROM companies WHERE owner_user_id = ? LIMIT 1`).get(existing.id) as
      | { id: string }
      | undefined;
    if (comp) {
      ensureCompanyErpSeed(comp.id, 'Shobhit Mishra');
      return { userId: existing.id, companyId: comp.id };
    }
  }

  return runTransaction(() => {
    const userId = uid('usr');
    const companyId = uid('cmp');
    const seed = createSeedDatabase();

    sqlite
      .prepare(`INSERT INTO users (id, name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, 'Shobhit Mishra', 'shobhit@shobhitinvoicepro.in', hashPassword('Admin@123'), 'Admin', 'active', new Date().toISOString());

    sqlite
      .prepare(
        `INSERT INTO companies (
          id, owner_user_id, company_name, tagline, gstin, pan, state, address, phone, email, upi_id,
          financial_year, signatory_name, default_terms, logo_data_url, invoice_config_json, prefixes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        userId,
        'Shobhit Enterprises Pvt Ltd',
        'Wholesale Electricals, Hardware & Industrial Supplies',
        seed.profile.gstin,
        seed.profile.pan,
        seed.profile.state,
        seed.profile.address,
        seed.profile.phone,
        seed.profile.email,
        seed.profile.upiId,
        seed.profile.financialYear,
        'Shobhit Mishra (Managing Director)',
        seed.profile.defaultTerms,
        '',
        JSON.stringify(DEFAULT_INVOICE_CONFIG),
        JSON.stringify(seed.profile.prefixes),
        new Date().toISOString()
      );

    seedCompanyDemoRecords(companyId, userId, 'Shobhit Mishra');
    return { userId, companyId };
  });
}

export function buildBootstrapPayload(userId: string, companyId: string) {
  const user = sqlite
    .prepare(`SELECT id, name, email, phone, role, status, created_at, assigned_company_id FROM users WHERE id = ?`)
    .get(userId) as Record<string, unknown>;

  const ownedCompanies = sqlite
    .prepare(`SELECT id, company_name, gstin, state, financial_year FROM companies WHERE owner_user_id = ?`)
    .all(userId);
  const memberCompanies = sqlite
    .prepare(
      `SELECT c.id, c.company_name, c.gstin, c.state, c.financial_year
       FROM companies c
       JOIN workspace_members wm ON wm.company_id = c.id
       WHERE wm.user_id = ? AND wm.active = 1`
    )
    .all(userId);

  const compMap = new Map<string, { id: string; companyName: string; gstin: string; state: string; financialYear: string }>();
  for (const c of [...ownedCompanies, ...memberCompanies]) {
    compMap.set(String(c.id), {
      id: String(c.id),
      companyName: String(c.company_name),
      gstin: String(c.gstin),
      state: String(c.state),
      financialYear: String(c.financial_year),
    });
  }
  const companies = Array.from(compMap.values());

  const memberRecord = sqlite
    .prepare(`SELECT role, permissions_json, phone, email FROM workspace_members WHERE company_id = ? AND user_id = ? AND active = 1 LIMIT 1`)
    .get(companyId, userId) as { role?: string; permissions_json?: string; phone?: string; email?: string } | undefined;

  let effectivePermissions: string[] = ['*'];
  const userRoleStr = String(memberRecord?.role || user.role || 'Admin');
  if (userRoleStr !== 'Admin') {
    let parsedPerms: string[] = [];
    try {
      parsedPerms = JSON.parse(String(memberRecord?.permissions_json || '[]'));
    } catch {
      parsedPerms = [];
    }
    effectivePermissions =
      Array.isArray(parsedPerms) && parsedPerms.length > 0
        ? parsedPerms
        : DEFAULT_ROLE_PERMISSIONS[userRoleStr] || ['dashboard'];
  }

  const comp = sqlite.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId) as Record<string, unknown>;
  const subscription = getSubscriptionRuntimeState(companyId);

  const branches = sqlite
    .prepare(`SELECT * FROM branches WHERE company_id = ?`)
    .all(companyId)
    .map((b) => ({
      id: String(b.id),
      name: String(b.name),
      code: String(b.code),
      address: String(b.address),
      manager: String(b.manager),
      isDefault: Boolean(b.is_default),
    }));

  const godowns = sqlite
    .prepare(`SELECT * FROM godowns WHERE company_id = ?`)
    .all(companyId)
    .map((g) => ({
      id: String(g.id),
      branchId: g.branch_id ? String(g.branch_id) : undefined,
      name: String(g.name),
      location: String(g.location),
      manager: String(g.manager),
      isDefault: Boolean(g.is_default),
    }));

  const parties = sqlite
    .prepare(`SELECT * FROM parties WHERE company_id = ? ORDER BY name ASC`)
    .all(companyId)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name),
      type: String(p.type),
      phone: String(p.phone),
      email: String(p.email),
      gstin: String(p.gstin),
      pan: String(p.pan),
      state: String(p.state),
      billingAddress: String(p.billing_address),
      shippingAddress: String(p.shipping_address),
      openingBalance: Number(p.opening_balance),
      openingType: String(p.opening_type),
      creditLimit: Number(p.credit_limit),
      creditDays: Number(p.credit_days),
      group: String(p.group_name),
      riskCategory: String(p.risk_category || 'Low'),
      creditHold: Boolean(p.credit_hold),
      avgDeliveryDays: Number(p.avg_delivery_days ?? 3),
      qualityRating: Number(p.quality_rating ?? 4.5),
      createdAt: String(p.created_at),
    }));

  const items = sqlite
    .prepare(`SELECT * FROM items WHERE company_id = ? ORDER BY name ASC`)
    .all(companyId)
    .map((i) => ({
      id: String(i.id),
      name: String(i.name),
      type: String(i.type),
      sku: String(i.sku),
      barcode: String(i.barcode),
      hsn: String(i.hsn),
      category: String(i.category),
      subcategory: String(i.subcategory || ''),
      unit: String(i.unit),
      secondaryUnit: String(i.secondary_unit || ''),
      conversionRate: Number(i.conversion_rate || 1),
      salePrice: Number(i.sale_price),
      purchasePrice: Number(i.purchase_price),
      mrp: Number(i.mrp),
      wholesalePrice: Number(i.wholesale_price),
      taxRate: Number(i.tax_rate),
      cessRate: Number(i.cess_rate),
      taxInclusive: Boolean(i.tax_inclusive),
      openingStock: Number(i.opening_stock || 0),
      stockQty: Number(i.stock_qty),
      minStockAlert: Number(i.min_stock_alert),
      maxStock: Number(i.max_stock ?? 250),
      leadTimeDays: Number(i.lead_time_days ?? 5),
      safetyStock: Number(i.safety_stock ?? 15),
      binLocation: String(i.bin_location || 'RACK-A1'),
      godownId: String(i.godown_id),
      godownStock: JSON.parse(String(i.godown_stock_json || '{}')),
      trackBatch: Boolean(i.track_batch),
      batches: JSON.parse(String(i.batches_json || '[]')),
    }));

  const rawVouchers = sqlite
    .prepare(`SELECT * FROM vouchers WHERE company_id = ? ORDER BY date DESC, created_at DESC`)
    .all(companyId);

  const lineStmt = sqlite.prepare(`SELECT * FROM voucher_lines WHERE voucher_id = ?`);
  const vouchers = rawVouchers.map((v) => {
    const vLines = lineStmt.all(String(v.id)).map((l) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(String(l.meta_json || '{}'));
      } catch {
        meta = {};
      }
      return {
        id: String(l.id),
        itemId: String(l.item_id),
        itemName: String(l.item_name),
        description: meta.description ? String(meta.description) : undefined,
        hsn: String(l.hsn),
        qty: Number(l.qty),
        unit: String(l.unit),
        rate: Number(l.rate),
        mrp: meta.mrp !== undefined ? Number(meta.mrp) : undefined,
        discountPct: Number(l.discount_pct),
        taxRate: Number(l.tax_rate),
        cessRate: Number(l.cess_rate),
        taxableAmount: Number(l.taxable_amount),
        cgst: Number(l.cgst),
        sgst: Number(l.sgst),
        igst: Number(l.igst),
        cess: Number(l.cess),
        total: Number(l.total),
        batchNo: l.batch_no ? String(l.batch_no) : undefined,
        serialNo: meta.serialNo ? String(meta.serialNo) : undefined,
        mfgDate: meta.mfgDate ? String(meta.mfgDate) : undefined,
        expDate: meta.expDate ? String(meta.expDate) : undefined,
        modelNo: meta.modelNo ? String(meta.modelNo) : undefined,
        size: meta.size ? String(meta.size) : undefined,
        customValues: meta.customValues && typeof meta.customValues === 'object' ? (meta.customValues as Record<string, string>) : undefined,
      };
    });

    return {
      id: String(v.id),
      branchId: v.branch_id ? String(v.branch_id) : undefined,
      type: String(v.type),
      voucherNo: String(v.voucher_no),
      date: String(v.date),
      dueDate: v.due_date ? String(v.due_date) : undefined,
      partyId: v.party_id ? String(v.party_id) : undefined,
      partyName: v.party_name ? String(v.party_name) : undefined,
      partyGstin: v.party_gstin ? String(v.party_gstin) : undefined,
      placeOfSupply: v.place_of_supply ? String(v.place_of_supply) : undefined,
      isInterState: Boolean(v.is_inter_state),
      lines: vLines,
      additionalCharges: Number(v.additional_charges),
      discountTotal: Number(v.discount_total),
      roundOff: Number(v.round_off),
      subTotal: Number(v.sub_total),
      taxTotal: Number(v.tax_total),
      grandTotal: Number(v.grand_total),
      paidAmount: Number(v.paid_amount),
      paymentMode: v.payment_mode ? String(v.payment_mode) : undefined,
      bankAccountId: v.bank_account_id ? String(v.bank_account_id) : undefined,
      splitDetails: v.split_details_json ? JSON.parse(String(v.split_details_json)) : undefined,
      status: String(v.status),
      linkedVoucherId: v.linked_voucher_id ? String(v.linked_voucher_id) : undefined,
      settledInvoices: v.settled_invoices_json ? JSON.parse(String(v.settled_invoices_json)) : undefined,
      ewayBillNo: v.eway_bill_no ? String(v.eway_bill_no) : undefined,
      vehicleNo: v.vehicle_no ? String(v.vehicle_no) : undefined,
      transporterName: v.transporter_name ? String(v.transporter_name) : undefined,
      distanceKm: v.distance_km ? Number(v.distance_km) : undefined,
      irn: v.irn ? String(v.irn) : undefined,
      isReverseCharge: Boolean(v.is_reverse_charge),
      isRecurring: Boolean(v.is_recurring),
      recurringInterval: v.recurring_interval ? String(v.recurring_interval) : undefined,
      expenseCategory: v.expense_category ? String(v.expense_category) : undefined,
      contraFromId: v.contra_from_id ? String(v.contra_from_id) : undefined,
      contraToId: v.contra_to_id ? String(v.contra_to_id) : undefined,
      journalLines: v.journal_lines_json ? JSON.parse(String(v.journal_lines_json)) : undefined,
      reconciled: Boolean(v.reconciled),
      reconciledDate: v.reconciled_date ? String(v.reconciled_date) : undefined,
      salesChannel: String(v.sales_channel || 'Direct B2B'),
      costCentreId: v.cost_centre_id ? String(v.cost_centre_id) : undefined,
      projectId: v.project_id ? String(v.project_id) : undefined,
      currency: String(v.currency || 'INR'),
      exchangeRate: Number(v.exchange_rate ?? 1),
      fxGainLoss: Number(v.fx_gain_loss ?? 0),
      freightCost: Number(v.freight_cost ?? 0),
      insuranceCost: Number(v.insurance_cost ?? 0),
      customsCost: Number(v.customs_cost ?? 0),
      approvalStatus: String(v.approval_status || 'approved'),
      approvedBy: v.approved_by ? String(v.approved_by) : undefined,
      shipmentStatus: String(v.shipment_status || 'Delivered'),
      trackingNo: v.tracking_no ? String(v.tracking_no) : undefined,
      salesRepName: v.sales_rep_name ? String(v.sales_rep_name) : undefined,
      notes: v.notes ? String(v.notes) : undefined,
      terms: v.terms ? String(v.terms) : undefined,
      createdBy: v.created_by ? String(v.created_by) : undefined,
      createdAt: String(v.created_at),
    };
  });

  const ledgers = sqlite
    .prepare(`SELECT * FROM ledger_accounts WHERE company_id = ? ORDER BY nature, group_name, name`)
    .all(companyId)
    .map((l) => ({
      id: String(l.id),
      name: String(l.name),
      groupName: String(l.group_name),
      nature: String(l.nature),
      openingBalance: Number(l.opening_balance),
      openingType: String(l.opening_type),
      isSystem: Boolean(l.is_system),
    }));

  const rawJes = sqlite
    .prepare(`SELECT * FROM journal_entries WHERE company_id = ? ORDER BY date DESC, created_at DESC`)
    .all(companyId);
  const jlStmt = sqlite.prepare(`SELECT * FROM journal_lines WHERE journal_entry_id = ?`);
  const journalEntries = rawJes.map((je) => ({
    id: String(je.id),
    voucherId: je.voucher_id ? String(je.voucher_id) : undefined,
    date: String(je.date),
    voucherNo: String(je.voucher_no),
    voucherType: String(je.voucher_type),
    narration: String(je.narration),
    createdAt: String(je.created_at),
    lines: jlStmt.all(String(je.id)).map((l) => ({
      id: String(l.id),
      accountName: String(l.ledger_name),
      accountGroup: String(l.account_group),
      debit: Number(l.debit),
      credit: Number(l.credit),
      narration: l.narration ? String(l.narration) : undefined,
    })),
  }));

  const bankAccounts = sqlite
    .prepare(`SELECT * FROM bank_accounts WHERE company_id = ?`)
    .all(companyId)
    .map((b) => ({
      id: String(b.id),
      bankName: String(b.bank_name),
      accountNo: String(b.account_no),
      ifsc: String(b.ifsc),
      branch: String(b.branch),
      upiId: String(b.upi_id),
      openingBalance: Number(b.opening_balance),
      type: String(b.type),
    }));

  const cheques = sqlite
    .prepare(`SELECT * FROM cheques WHERE company_id = ? ORDER BY date DESC`)
    .all(companyId)
    .map((c) => ({
      id: String(c.id),
      chequeNo: String(c.cheque_no),
      date: String(c.date),
      clearanceDate: c.clearance_date ? String(c.clearance_date) : undefined,
      partyId: String(c.party_id),
      partyName: String(c.party_name),
      bankAccountId: String(c.bank_account_id),
      amount: Number(c.amount),
      direction: String(c.direction),
      status: String(c.status),
      notes: String(c.notes || ''),
    }));

  const loans = sqlite
    .prepare(`SELECT * FROM loans WHERE company_id = ?`)
    .all(companyId)
    .map((l) => ({
      id: String(l.id),
      lenderName: String(l.lender_name),
      accountNo: String(l.account_no),
      principal: Number(l.principal),
      interestRate: Number(l.interest_rate),
      emiAmount: Number(l.emi_amount),
      startDate: String(l.start_date),
      tenureMonths: Number(l.tenure_months),
      paidEmis: Number(l.paid_emis),
      bankAccountId: String(l.bank_account_id),
    }));

  const stockAdjustments = sqlite
    .prepare(`SELECT * FROM stock_adjustments WHERE company_id = ? ORDER BY date DESC`)
    .all(companyId)
    .map((a) => ({
      id: String(a.id),
      date: String(a.date),
      itemId: String(a.item_id),
      itemName: String(a.item_name),
      type: String(a.type),
      qty: Number(a.qty),
      reason: String(a.reason),
      costPerUnit: Number(a.cost_per_unit),
      notes: String(a.notes || ''),
    }));

  const stockTransfers = sqlite
    .prepare(`SELECT * FROM stock_transfers WHERE company_id = ? ORDER BY date DESC`)
    .all(companyId)
    .map((t) => ({
      id: String(t.id),
      transferNo: String(t.transfer_no),
      date: String(t.date),
      fromGodownId: String(t.from_godown_id),
      toGodownId: String(t.to_godown_id),
      items: JSON.parse(String(t.items_json || '[]')),
      notes: String(t.notes || ''),
    }));

  const staff = sqlite
    .prepare(`SELECT * FROM staff_members WHERE company_id = ?`)
    .all(companyId)
    .map((s) => ({
      id: String(s.id),
      empCode: String(s.emp_code || ''),
      name: String(s.name),
      role: String(s.role),
      designation: String(s.designation || s.role),
      department: String(s.department || 'Operations'),
      joiningDate: String(s.joining_date || '2025-04-01'),
      employmentType: String(s.employment_type || 'Full-Time'),
      phone: String(s.phone || ''),
      email: String(s.email || ''),
      pan: String(s.pan || ''),
      uan: String(s.uan || ''),
      esicNo: String(s.esic_no || ''),
      bankName: String(s.bank_name || 'HDFC Bank Ltd'),
      bankAccountNo: String(s.bank_account_no || ''),
      ifsc: String(s.ifsc || ''),
      paymentMode: String(s.payment_mode || 'Bank Transfer'),
      monthlySalary: Number(s.monthly_salary),
      hraPct: Number(s.hra_pct ?? 20),
      conveyanceAmt: Number(s.conveyance_amt ?? 1600),
      allowanceAmt: Number(s.allowance_amt ?? 2000),
      pfDeduction: Number(s.pf_deduction ?? 1800),
      esicDeduction: Number(s.esic_deduction ?? 0),
      ptDeduction: Number(s.pt_deduction ?? 200),
      tdsDeduction: Number(s.tds_deduction ?? 0),
      includePf: s.include_pf !== undefined ? Boolean(s.include_pf) : true,
      includeEsic: Boolean(s.include_esic),
      taxRegime: (String(s.tax_regime || 'New') === 'Old' ? 'Old' : 'New') as 'New' | 'Old',
      ptState: String(s.pt_state || 'Maharashtra'),
      attendanceDays: Number(s.attendance_days ?? 26),
      lopDays: Number(s.lop_days ?? 0),
      overtimeHours: Number(s.overtime_hours ?? 0),
      overtimeRate: Number(s.overtime_rate ?? 250),
      bonusAmt: Number(s.bonus_amt ?? 0),
      arrearsAmt: Number(s.arrears_amt ?? 0),
      commissionPct: Number(s.commission_pct ?? 1.5),
      clBalance: Number(s.cl_balance ?? 6),
      slBalance: Number(s.sl_balance ?? 6),
      elBalance: Number(s.el_balance ?? 12),
      status: String(s.status),
      lastPaidMonth: s.last_paid_month ? String(s.last_paid_month) : undefined,
      permissions: JSON.parse(String(s.permissions_json || '[]')),
    }));

  const auditLogs = sqlite
    .prepare(`SELECT * FROM audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(companyId)
    .map((a) => ({
      id: String(a.id),
      userId: String(a.user_id),
      userName: String(a.user_name),
      action: String(a.action),
      entityType: String(a.entity_type),
      entityId: String(a.entity_id),
      details: String(a.details),
      createdAt: String(a.created_at),
    }));

  const costCentres = sqlite.prepare(`SELECT * FROM cost_centres WHERE company_id = ?`).all(companyId).map((c) => ({
    id: String(c.id), code: String(c.code), name: String(c.name), type: String(c.type),
    manager: String(c.manager), budgetLimit: Number(c.budget_limit), status: String(c.status),
  }));

  const budgets = sqlite.prepare(`SELECT * FROM budgets WHERE company_id = ?`).all(companyId).map((b) => ({
    id: String(b.id), name: String(b.name), category: String(b.category),
    costCentreId: b.cost_centre_id ? String(b.cost_centre_id) : undefined,
    period: String(b.period), budgetType: String(b.budget_type), plannedAmount: Number(b.planned_amount),
    notes: String(b.notes || ''),
  }));

  const fixedAssets = sqlite.prepare(`SELECT * FROM fixed_assets WHERE company_id = ?`).all(companyId).map((a) => ({
    id: String(a.id), assetCode: String(a.asset_code), name: String(a.name), category: String(a.category),
    purchaseDate: String(a.purchase_date), purchaseCost: Number(a.purchase_cost), salvageValue: Number(a.salvage_value),
    usefulLifeYears: Number(a.useful_life_years), depreciationMethod: String(a.depreciation_method),
    depreciationRatePct: Number(a.depreciation_rate_pct), accumulatedDep: Number(a.accumulated_dep),
    location: String(a.location), assignedTo: String(a.assigned_to), status: String(a.status),
    lastDepreciatedDate: a.last_depreciated_date ? String(a.last_depreciated_date) : undefined,
  }));

  const boms = sqlite.prepare(`SELECT * FROM boms WHERE company_id = ?`).all(companyId).map((b) => ({
    id: String(b.id), finishedItemId: String(b.finished_item_id), finishedItemName: String(b.finished_item_name),
    sku: String(b.sku), outputQty: Number(b.output_qty), labourCostPerBatch: Number(b.labour_cost_per_batch),
    overheadCostPerBatch: Number(b.overhead_cost_per_batch), components: JSON.parse(String(b.components_json || '[]')),
  }));

  const productionOrders = sqlite.prepare(`SELECT * FROM production_orders WHERE company_id = ? ORDER BY start_date DESC`).all(companyId).map((p) => ({
    id: String(p.id), orderNo: String(p.order_no), bomId: String(p.bom_id), finishedItemId: String(p.finished_item_id),
    finishedItemName: String(p.finished_item_name), plannedQty: Number(p.planned_qty), completedQty: Number(p.completed_qty),
    startDate: String(p.start_date), dueDate: String(p.due_date), status: String(p.status),
    plannedMaterialCost: Number(p.planned_material_cost), actualMaterialCost: Number(p.actual_material_cost),
    plannedLabourOverhead: Number(p.planned_labour_overhead), actualLabourOverhead: Number(p.actual_labour_overhead),
    wastagePct: Number(p.wastage_pct), notes: String(p.notes || ''),
  }));

  const jobWorks = sqlite.prepare(`SELECT * FROM job_works WHERE company_id = ? ORDER BY date DESC`).all(companyId).map((j) => ({
    id: String(j.id), challanNo: String(j.challan_no), vendorPartyId: String(j.vendor_party_id), vendorName: String(j.vendor_name),
    date: String(j.date), materialSentItemId: String(j.material_sent_item_id), materialSentName: String(j.material_sent_name),
    qtySent: Number(j.qty_sent), qtyReceivedBack: Number(j.qty_received_back), wastageQty: Number(j.wastage_qty),
    processingCharge: Number(j.processing_charge), status: String(j.status), notes: String(j.notes || ''),
  }));

  const projects = sqlite.prepare(`SELECT * FROM projects WHERE company_id = ?`).all(companyId).map((p) => ({
    id: String(p.id), code: String(p.code), name: String(p.name), clientPartyId: String(p.client_party_id),
    clientName: String(p.client_name), costCentreId: p.cost_centre_id ? String(p.cost_centre_id) : undefined,
    startDate: String(p.start_date), endDate: String(p.end_date), contractValue: Number(p.contract_value),
    materialCost: Number(p.material_cost), labourCost: Number(p.labour_cost), overheadCost: Number(p.overhead_cost),
    billedAmount: Number(p.billed_amount), status: String(p.status),
  }));

  const workflowRules = sqlite.prepare(`SELECT * FROM workflow_rules WHERE company_id = ?`).all(companyId).map((w) => ({
    id: String(w.id), name: String(w.name), triggerEvent: String(w.trigger_event), conditionText: String(w.condition_text),
    actionText: String(w.action_text), enabled: Boolean(w.enabled), executionsCount: Number(w.executions_count),
    lastTriggeredAt: w.last_triggered_at ? String(w.last_triggered_at) : undefined,
  }));

  const approvalRules = sqlite.prepare(`SELECT * FROM approval_rules WHERE company_id = ?`).all(companyId).map((r) => ({
    id: String(r.id), documentType: String(r.document_type), thresholdAmount: Number(r.threshold_amount),
    approverRole: String(r.approver_role), enabled: Boolean(r.enabled),
  }));

  const currencyRates = sqlite.prepare(`SELECT * FROM currency_rates WHERE company_id = ?`).all(companyId).map((c) => ({
    code: String(c.code), name: String(c.name), symbol: String(c.symbol), rateToInr: Number(c.rate_to_inr),
    updatedAt: String(c.updated_at),
  }));

  const commissionRules = sqlite.prepare(`SELECT * FROM commission_rules WHERE company_id = ?`).all(companyId).map((c) => ({
    id: String(c.id), staffId: String(c.staff_id), staffName: String(c.staff_name), basis: String(c.basis),
    ratePct: Number(c.rate_pct), monthlyTarget: Number(c.monthly_target), bonusOnTarget: Number(c.bonus_on_target),
  }));

  const pricingRules = sqlite.prepare(`SELECT * FROM pricing_rules WHERE company_id = ?`).all(companyId).map((r) => ({
    id: String(r.id), name: String(r.name), category: String(r.category), minQty: Number(r.min_qty),
    discountPct: Number(r.discount_pct), targetMarginPct: Number(r.target_margin_pct), channel: String(r.channel),
    active: Boolean(r.active),
  }));

  const subscriptions = sqlite.prepare(`SELECT * FROM subscription_plans WHERE company_id = ?`).all(companyId).map((s) => ({
    id: String(s.id), planName: String(s.plan_name), partyId: String(s.party_id), partyName: String(s.party_name),
    amount: Number(s.amount), interval: String(s.interval), nextBillingDate: String(s.next_billing_date),
    status: String(s.status), autoRenew: Boolean(s.auto_renew),
  }));

  const complianceItems = sqlite.prepare(`SELECT * FROM compliance_items WHERE company_id = ? ORDER BY due_date ASC`).all(companyId).map((c) => ({
    id: String(c.id), title: String(c.title), category: String(c.category), dueDate: String(c.due_date),
    status: String(c.status), referenceNo: String(c.reference_no || ''), notes: String(c.notes || ''),
  }));

  const documents = sqlite.prepare(`SELECT * FROM documents WHERE company_id = ? ORDER BY uploaded_at DESC`).all(companyId).map((d) => ({
    id: String(d.id), title: String(d.title), category: String(d.category), linkedVoucherNo: String(d.linked_voucher_no || ''),
    uploadedAt: String(d.uploaded_at), signedBy: String(d.signed_by || ''), signatureHash: String(d.signature_hash || ''),
    fileType: String(d.file_type), previewText: String(d.preview_text || ''),
  }));

  const apiKeys = sqlite.prepare(`SELECT * FROM api_keys WHERE company_id = ?`).all(companyId).map((k) => ({
    id: String(k.id), label: String(k.label), apiKey: String(k.api_key),
    scopes: JSON.parse(String(k.scopes_json || '[]')), active: Boolean(k.active),
    createdAt: String(k.created_at), lastUsedAt: k.last_used_at ? String(k.last_used_at) : undefined,
  }));

  const webhooks = sqlite.prepare(`SELECT * FROM webhooks WHERE company_id = ?`).all(companyId).map((w) => ({
    id: String(w.id), event: String(w.event), targetUrl: String(w.target_url), active: Boolean(w.active),
    lastStatus: w.last_status ? Number(w.last_status) : undefined,
    lastDeliveredAt: w.last_delivered_at ? String(w.last_delivered_at) : undefined,
  }));

  const customReports = sqlite.prepare(`SELECT * FROM custom_reports WHERE company_id = ? ORDER BY created_at DESC`).all(companyId).map((r) => ({
    id: String(r.id), name: String(r.name), dataset: String(r.dataset),
    columns: JSON.parse(String(r.columns_json || '[]')), groupBy: String(r.group_by),
    metricFormula: String(r.metric_formula), chartType: String(r.chart_type),
    scheduleCron: String(r.schedule_cron || ''), createdAt: String(r.created_at),
  }));

  let securitySettings = {
    twoFactorEnabled: false,
    ipAllowlist: '',
    sessionTimeoutMins: 120,
    digitalSignatureSigner: String(comp.signatory_name || ''),
  };
  try {
    const parsedSec = JSON.parse(String(comp.security_settings_json || '{}'));
    if (parsedSec && typeof parsedSec === 'object') {
      securitySettings = { ...securitySettings, ...parsedSec };
    }
  } catch {
    // keep defaults
  }

  const payrollRuns = sqlite
    .prepare(`SELECT * FROM payroll_runs WHERE company_id = ? ORDER BY month DESC, pay_date DESC`)
    .all(companyId)
    .map((r) => ({
      id: String(r.id),
      payslipNo: String(r.payslip_no),
      staffId: String(r.staff_id),
      staffName: String(r.staff_name),
      empCode: String(r.emp_code || ''),
      department: String(r.department || ''),
      designation: String(r.designation || ''),
      month: String(r.month),
      payDate: String(r.pay_date),
      workingDays: Number(r.working_days),
      paidDays: Number(r.paid_days),
      lopDays: Number(r.lop_days),
      basic: Number(r.basic),
      hra: Number(r.hra),
      conveyance: Number(r.conveyance),
      specialAllowance: Number(r.special_allowance),
      overtimePay: Number(r.overtime_pay),
      bonus: Number(r.bonus),
      commission: Number(r.commission),
      arrears: Number(r.arrears),
      reimbursement: Number(r.reimbursement),
      grossEarnings: Number(r.gross_earnings),
      employeePf: Number(r.employee_pf),
      employeeEsic: Number(r.employee_esic),
      professionalTax: Number(r.professional_tax),
      tds: Number(r.tds),
      advanceRecovery: Number(r.advance_recovery),
      otherDeductions: Number(r.other_deductions),
      totalDeductions: Number(r.total_deductions),
      employerPf: Number(r.employer_pf),
      employerEsic: Number(r.employer_esic),
      netPay: Number(r.net_pay),
      paymentMode: String(r.payment_mode || 'Bank Transfer'),
      bankAccountId: String(r.bank_account_id || ''),
      status: String(r.status || 'Paid'),
      notes: String(r.notes || ''),
    }));

  const employeeAdvances = sqlite
    .prepare(`SELECT * FROM employee_advances WHERE company_id = ? ORDER BY date DESC`)
    .all(companyId)
    .map((a) => ({
      id: String(a.id),
      staffId: String(a.staff_id),
      staffName: String(a.staff_name),
      date: String(a.date),
      type: String(a.type),
      amount: Number(a.amount),
      monthlyEmi: Number(a.monthly_emi),
      recoveredAmount: Number(a.recovered_amount),
      reason: String(a.reason || ''),
      status: String(a.status),
    }));

  const leaveRequests = sqlite
    .prepare(`SELECT * FROM leave_requests WHERE company_id = ? ORDER BY from_date DESC`)
    .all(companyId)
    .map((l) => ({
      id: String(l.id),
      staffId: String(l.staff_id),
      staffName: String(l.staff_name),
      leaveType: String(l.leave_type),
      fromDate: String(l.from_date),
      toDate: String(l.to_date),
      days: Number(l.days),
      reason: String(l.reason || ''),
      status: String(l.status),
    }));

  const reimbursements = sqlite
    .prepare(`SELECT * FROM reimbursements WHERE company_id = ? ORDER BY date DESC`)
    .all(companyId)
    .map((r) => ({
      id: String(r.id),
      staffId: String(r.staff_id),
      staffName: String(r.staff_name),
      date: String(r.date),
      category: String(r.category),
      amount: Number(r.amount),
      description: String(r.description || ''),
      status: String(r.status),
    }));

  let parsedAppSettings = null;
  try {
    parsedAppSettings = JSON.parse(String(comp.app_settings_json || '{}'));
  } catch {
    parsedAppSettings = null;
  }

  const recycleBin = sqlite
    .prepare(`SELECT id, entity_type, entity_id, title, subtitle, amount, deleted_by, deleted_at FROM recycle_bin WHERE company_id = ? ORDER BY deleted_at DESC`)
    .all(companyId)
    .map((r) => ({
      id: String(r.id),
      entityType: (String(r.entity_type) === 'bank_account' ? 'bank_account' : 'voucher') as 'voucher' | 'bank_account',
      entityId: String(r.entity_id),
      title: String(r.title),
      subtitle: String(r.subtitle || ''),
      amount: Number(r.amount || 0),
      deletedBy: String(r.deleted_by || ''),
      deletedAt: String(r.deleted_at),
    }));

  const workspaceMembers = sqlite
    .prepare(`SELECT * FROM workspace_members WHERE company_id = ? ORDER BY created_at DESC`)
    .all(companyId)
    .map((m) => {
      let perms: string[] = [];
      try {
        perms = JSON.parse(String(m.permissions_json || '[]'));
      } catch {
        perms = [];
      }
      return {
        id: String(m.id),
        companyId: String(m.company_id),
        userId: String(m.user_id),
        name: String(m.name),
        phone: String(m.phone || ''),
        email: cleanDisplayEmail(String(m.email || '')),
        role: String(m.role || 'Biller'),
        permissions: perms,
        active: Boolean(m.active),
        createdAt: String(m.created_at || ''),
        updatedAt: String(m.updated_at || ''),
      };
    });

  return {
    user: {
      id: String(user.id),
      name: String(user.name),
      email: cleanDisplayEmail(String(memberRecord?.email || user.email || '')),
      phone: String(memberRecord?.phone || user.phone || ''),
      role: userRoleStr,
      permissions: effectivePermissions,
      status: String(user.status),
      createdAt: String(user.created_at),
    },
    companies,
    activeBranchId: branches[0]?.id || '',
    branches,
    profile: {
      id: String(comp.id),
      companyName: String(comp.company_name),
      tagline: String(comp.tagline),
      gstin: String(comp.gstin),
      pan: String(comp.pan),
      state: String(comp.state),
      address: String(comp.address),
      phone: String(comp.phone),
      email: String(comp.email),
      upiId: String(comp.upi_id),
      financialYear: String(comp.financial_year),
      signatoryName: String(comp.signatory_name),
      defaultTerms: String(comp.default_terms),
      logoDataUrl: String(comp.logo_data_url || ''),
      signatureDataUrl: String(comp.signature_data_url || ''),
      digitalSignatureText: String(comp.digital_signature_text || ''),
      language: (comp.language === 'hi' ? 'hi' : 'en') as 'en' | 'hi',
      regionLocale: String(comp.region_locale || 'en-IN'),
      baseCurrency: String(comp.base_currency || 'INR'),
      invoiceConfig: JSON.parse(String(comp.invoice_config_json)),
      prefixes: JSON.parse(String(comp.prefixes_json)),
      appSettings: mergeAppSettings(parsedAppSettings),
    },
    parties,
    items,
    godowns,
    stockTransfers,
    stockAdjustments,
    vouchers,
    ledgers,
    journalEntries,
    bankAccounts,
    cheques,
    loans,
    staff,
    auditLogs,
    costCentres,
    budgets,
    fixedAssets,
    boms,
    productionOrders,
    jobWorks,
    projects,
    workflowRules,
    approvalRules,
    currencyRates,
    commissionRules,
    pricingRules,
    subscriptions,
    complianceItems,
    documents,
    apiKeys,
    webhooks,
    customReports,
    securitySettings,
    payrollRuns,
    employeeAdvances,
    leaveRequests,
    reimbursements,
    recycleBin,
    subscription,
    workspaceMembers,
  };
}

const ALL_TRUE_FEATURES: Record<SubscriptionFeatureKey, boolean> = {
  core_billing: true,
  payroll: true,
  operations_erp: true,
  ocr_bulk_tools: true,
  gst_portals: true,
  invoice_designs: true,
  bulk_print: true,
  multi_currency: true,
};

const ALL_FALSE_FEATURES: Record<SubscriptionFeatureKey, boolean> = {
  core_billing: false,
  payroll: false,
  operations_erp: false,
  ocr_bulk_tools: false,
  gst_portals: false,
  invoice_designs: false,
  bulk_print: false,
  multi_currency: false,
};

export function mapPlanConfigRow(r: Record<string, unknown>): SubscriptionPlanConfig {
  let parsedFeatures: Partial<Record<SubscriptionFeatureKey, boolean>> = {};
  try {
    parsedFeatures = JSON.parse(String(r.features_json || '{}'));
  } catch {
    parsedFeatures = {};
  }
  return {
    tier: (String(r.tier) as PlanTier) || 'silver',
    name: String(r.name || 'Silver'),
    tagline: String(r.tagline || ''),
    priceDesktop1Y: Number(r.price_desktop_1y || 0),
    priceDesktop3Y: Number(r.price_desktop_3y || 0),
    priceCombo1Y: Number(r.price_combo_1y || 0),
    priceCombo3Y: Number(r.price_combo_3y || 0),
    features: {
      core_billing: parsedFeatures.core_billing ?? true,
      payroll: parsedFeatures.payroll ?? false,
      operations_erp: parsedFeatures.operations_erp ?? false,
      ocr_bulk_tools: parsedFeatures.ocr_bulk_tools ?? false,
      gst_portals: parsedFeatures.gst_portals ?? false,
      invoice_designs: parsedFeatures.invoice_designs ?? false,
      bulk_print: parsedFeatures.bulk_print ?? false,
      multi_currency: parsedFeatures.multi_currency ?? false,
    },
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

export function mapLicenseRow(r: Record<string, unknown>): LicenseRecord {
  return {
    id: String(r.id),
    companyId: r.company_id ? String(r.company_id) : undefined,
    licenseCode: String(r.license_code || ''),
    invoiceNo: String(r.invoice_no || ''),
    tier: (String(r.tier) as PlanTier) || 'silver',
    deviceScope: (String(r.device_scope) as DeviceScope) || 'desktop',
    duration: (String(r.duration) as PlanDuration) || '1_year',
    amount: Number(r.amount || 0),
    taxAmount: Number(r.tax_amount || 0),
    totalAmount: Number(r.total_amount || 0),
    customerName: String(r.customer_name || ''),
    phone: String(r.phone || ''),
    gstin: String(r.gstin || ''),
    paymentMode: (String(r.payment_mode || 'UPI') as PaymentMode),
    paymentRef: String(r.payment_ref || ''),
    transactionId: String(r.transaction_id || ''),
    screenshotDataUrl: String(r.screenshot_data_url || ''),
    status: (String(r.status || 'pending_verification') as LicenseRecord['status']),
    validFrom: r.valid_from ? String(r.valid_from) : undefined,
    expiresAt: r.expires_at ? String(r.expires_at) : undefined,
    createdAt: String(r.created_at || ''),
    verifiedAt: r.verified_at ? String(r.verified_at) : undefined,
    verifiedBy: r.verified_by ? String(r.verified_by) : undefined,
  };
}

export function getSaasPlans(): SubscriptionPlanConfig[] {
  ensureSaasDefaults();
  const rows = sqlite
    .prepare(
      `SELECT * FROM saas_plan_configs
       ORDER BY CASE tier WHEN 'silver' THEN 1 WHEN 'gold' THEN 2 WHEN 'platinum' THEN 3 ELSE 4 END`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapPlanConfigRow);
}

export function getSubscriptionRuntimeState(companyId: string): SubscriptionRuntimeState {
  ensureSaasDefaults();
  const plans = getSaasPlans();
  const comp = sqlite
    .prepare(`SELECT id, trial_started_at, attached_license_id FROM companies WHERE id = ?`)
    .get(companyId) as { id: string; trial_started_at?: string; attached_license_id?: string } | undefined;

  let trialStartedAt = comp?.trial_started_at || '';
  if (!trialStartedAt) {
    trialStartedAt = new Date().toISOString();
    sqlite.prepare(`UPDATE companies SET trial_started_at = ? WHERE id = ?`).run(trialStartedAt, companyId);
  }

  const trialDaysTotal = 7;
  const elapsedMs = Math.max(0, Date.now() - new Date(trialStartedAt).getTime());
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  const trialDaysLeft = Math.max(0, trialDaysTotal - elapsedDays);

  let attachedLicense: LicenseRecord | null = null;
  if (comp?.attached_license_id) {
    const licRow = sqlite
      .prepare(`SELECT * FROM saas_licenses WHERE id = ?`)
      .get(comp.attached_license_id) as Record<string, unknown> | undefined;
    if (licRow) {
      attachedLicense = mapLicenseRow(licRow);
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const licenseCurrentlyValid = Boolean(
    attachedLicense &&
      attachedLicense.status === 'active' &&
      (!attachedLicense.expiresAt || attachedLicense.expiresAt >= todayIso)
  );

  let activeTier: 'free_trial' | PlanTier = 'free_trial';
  let activeScope: DeviceScope | undefined = undefined;
  let unlockedFeatures: Record<SubscriptionFeatureKey, boolean> = { ...ALL_TRUE_FEATURES };
  let isLicensed = false;
  let isTrialExpired = false;
  let canTransact = true;

  if (licenseCurrentlyValid && attachedLicense) {
    isLicensed = true;
    activeTier = attachedLicense.tier;
    activeScope = attachedLicense.deviceScope;
    const planObj = plans.find((p) => p.tier === attachedLicense!.tier);
    unlockedFeatures = planObj ? { ...planObj.features } : { ...ALL_TRUE_FEATURES };
    canTransact = true;
  } else if (trialDaysLeft > 0) {
    activeTier = 'free_trial';
    unlockedFeatures = { ...ALL_TRUE_FEATURES };
    canTransact = true;
  } else {
    isTrialExpired = true;
    activeTier = 'free_trial';
    unlockedFeatures = { ...ALL_FALSE_FEATURES };
    canTransact = false;
  }

  const invRow = sqlite
    .prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ?`)
    .get(companyId) as { c: number };

  const companyOrders = sqlite
    .prepare(`SELECT * FROM saas_licenses WHERE company_id = ? ORDER BY created_at DESC LIMIT 25`)
    .all(companyId) as Array<Record<string, unknown>>;

  return {
    trialStartedAt,
    trialDaysTotal,
    trialDaysLeft,
    isTrialExpired,
    isLicensed,
    activeTier,
    activeScope,
    attachedLicense,
    plans,
    invoiceCount: Number(invRow?.c || 0),
    unlockedFeatures,
    canTransact,
    ordersForCompany: companyOrders.map(mapLicenseRow),
  };
}

