import {
  IndianState,
  InvoiceTemplateId,
  SalesChannel,
  VoucherLine,
  VoucherType,
} from '../types/accounting';

export const INDIAN_STATES: IndianState[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
];

export const ITEM_UNITS = ['PCS', 'KG', 'BOX', 'LTR', 'MTR', 'COIL', 'SET', 'PACK', 'JOB'];

export const SALES_CHANNELS: SalesChannel[] = [
  'Direct B2B',
  'Retail POS Counter',
  'Wholesale',
  'Online Store',
  'Marketplace',
  'Field Sales',
];

export const VOUCHER_LABELS: Record<VoucherType, string> = {
  sale_invoice: 'Sale Invoice',
  estimate: 'Estimate / Quotation',
  proforma: 'Proforma Invoice',
  sale_order: 'Sale Order',
  delivery_challan: 'Delivery Challan',
  credit_note: 'Credit Note (Sale Return)',
  purchase_bill: 'Purchase Bill',
  purchase_order: 'Purchase Order',
  debit_note: 'Debit Note (Purchase Return)',
  payment_in: 'Payment In (Receipt)',
  payment_out: 'Payment Out (Payment)',
  expense: 'Expense',
  journal: 'Journal Voucher',
  contra: 'Contra Entry',
};

export const EXPENSE_CATEGORIES = [
  'Office Rent',
  'Electricity & Utilities',
  'Staff Salary & Wages',
  'Freight & Logistics',
  'Packaging Material',
  'Marketing & Ads',
  'Software & Cloud',
  'Travel & Conveyance',
  'Repairs & Maintenance',
  'Bank Charges',
  'Miscellaneous',
];

export interface InvoiceTemplateMeta {
  id: InvoiceTemplateId;
  name: string;
  subtitle: string;
  layoutTag: string;
  defaultAccent: string;
  headerBg: string;
  headerText: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  borderColor: string;
  pageBg: string;
  badgeLabel: string;
}

export const INVOICE_TEMPLATES: InvoiceTemplateMeta[] = [
  {
    id: 'classic_white',
    name: '01. Classic White',
    subtitle: 'Centered masthead & double-bordered Accounting GST grid',
    layoutTag: 'Boxed Accounting Grid',
    defaultAccent: '#1E293B',
    headerBg: '#FFFFFF',
    headerText: '#0F172A',
    tableHeaderBg: '#F1F5F9',
    tableHeaderText: '#0F172A',
    borderColor: '#1E293B',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'corporate_blue',
    name: '02. Corporate Blue',
    subtitle: 'Enterprise banner header with 3 floating metadata KPI cards',
    layoutTag: 'Floating Card Strip',
    defaultAccent: '#1E40AF',
    headerBg: '#1E3A8A',
    headerText: '#FFFFFF',
    tableHeaderBg: '#EFF6FF',
    tableHeaderText: '#1E3A8A',
    borderColor: '#BFDBFE',
    pageBg: '#FFFFFF',
    badgeLabel: 'CORPORATE TAX INVOICE',
  },
  {
    id: 'premium_black_gold',
    name: '03. Premium Black and Gold',
    subtitle: 'VIP Obsidian ribbon seal with dual gold-lined summary',
    layoutTag: 'VIP Crest Seal',
    defaultAccent: '#B45309',
    headerBg: '#09090B',
    headerText: '#FDE68A',
    tableHeaderBg: '#FEF3C7',
    tableHeaderText: '#78350F',
    borderColor: '#D97706',
    pageBg: '#FFFFFF',
    badgeLabel: 'PREMIUM INVOICE',
  },
  {
    id: 'modern_green',
    name: '04. Modern Green',
    subtitle: 'Left vertical sidebar column (Seller, QR & Bank) + main grid',
    layoutTag: 'Left Vertical Rail',
    defaultAccent: '#15803D',
    headerBg: '#14532D',
    headerText: '#FFFFFF',
    tableHeaderBg: '#F0FDF4',
    tableHeaderText: '#14532D',
    borderColor: '#BBF7D0',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'retail_invoice',
    name: '05. Retail Invoice',
    subtitle: 'Store cash-memo with MRP Savings & Tender Breakdown box',
    layoutTag: 'Retail Cash-Memo',
    defaultAccent: '#1E40AF',
    headerBg: '#F8FAFC',
    headerText: '#0F172A',
    tableHeaderBg: '#1E293B',
    tableHeaderText: '#FFFFFF',
    borderColor: '#CBD5E1',
    pageBg: '#FFFFFF',
    badgeLabel: 'RETAIL BILL',
  },
  {
    id: 'gst_standard',
    name: '06. GST Standard',
    subtitle: 'Strict Rule-46 format with per-row CGST / SGST / IGST columns',
    layoutTag: 'Rule-46 Tax Split',
    defaultAccent: '#1E3A8A',
    headerBg: '#FFFFFF',
    headerText: '#0F172A',
    tableHeaderBg: '#E2E8F0',
    tableHeaderText: '#0F172A',
    borderColor: '#0F172A',
    pageBg: '#FFFFFF',
    badgeLabel: 'ORIGINAL FOR RECIPIENT',
  },
  {
    id: 'luxury_beige',
    name: '07. Luxury Beige',
    subtitle: 'Editorial centered crest with warm parchment bands & borderless rows',
    layoutTag: 'Editorial Crest',
    defaultAccent: '#78350F',
    headerBg: '#F5EFE6',
    headerText: '#451A03',
    tableHeaderBg: '#EDE0D4',
    tableHeaderText: '#451A03',
    borderColor: '#D6C7B2',
    pageBg: '#FFFDF9',
    badgeLabel: 'INVOICE',
  },
  {
    id: 'dark_modern',
    name: '08. Dark Modern',
    subtitle: 'Full charcoal hero card showcasing Grand Total at top right',
    layoutTag: 'Hero Amount Top',
    defaultAccent: '#334155',
    headerBg: '#0F172A',
    headerText: '#F8FAFC',
    tableHeaderBg: '#1E293B',
    tableHeaderText: '#F8FAFC',
    borderColor: '#475569',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'minimal_bw',
    name: '09. Minimal Black and White',
    subtitle: 'Swiss brutalist grid, oversized top-left voucher #, 1/3 - 2/3 split',
    layoutTag: 'Swiss Typographic',
    defaultAccent: '#000000',
    headerBg: '#FFFFFF',
    headerText: '#000000',
    tableHeaderBg: '#FFFFFF',
    tableHeaderText: '#000000',
    borderColor: '#000000',
    pageBg: '#FFFFFF',
    badgeLabel: 'INVOICE',
  },
  {
    id: 'contractor_invoice',
    name: '10. Contractor Invoice',
    subtitle: 'Site / Work-Order BOQ layout with measurement particulars & retention',
    layoutTag: 'Work-Order BOQ',
    defaultAccent: '#374151',
    headerBg: '#1F2937',
    headerText: '#FFFFFF',
    tableHeaderBg: '#F3F4F6',
    tableHeaderText: '#111827',
    borderColor: '#9CA3AF',
    pageBg: '#FFFFFF',
    badgeLabel: 'PROJECT / WORK BILL',
  },
  {
    id: 'ecommerce_invoice',
    name: '11. E-Commerce Invoice',
    subtitle: '3-col Sold By / Bill To / Ship To, AWB dispatch & tear-off slip',
    layoutTag: '3-Col Fulfillment',
    defaultAccent: '#4338CA',
    headerBg: '#312E81',
    headerText: '#FFFFFF',
    tableHeaderBg: '#EEF2FF',
    tableHeaderText: '#312E81',
    borderColor: '#C7D2FE',
    pageBg: '#FFFFFF',
    badgeLabel: 'ONLINE ORDER INVOICE',
  },
  {
    id: 'service_invoice',
    name: '12. Service Invoice',
    subtitle: 'Consulting SAC narrative banner replacing Qty with Billing Scope',
    layoutTag: 'SAC Engagement Brief',
    defaultAccent: '#0F766E',
    headerBg: '#134E4A',
    headerText: '#FFFFFF',
    tableHeaderBg: '#F0FDFA',
    tableHeaderText: '#134E4A',
    borderColor: '#99F6E4',
    pageBg: '#FFFFFF',
    badgeLabel: 'SERVICE TAX INVOICE',
  },
  {
    id: 'modern_orange',
    name: '13. Modern Orange',
    subtitle: 'Stepped accent band with bold KPI boxes above trade table',
    layoutTag: 'Stepped KPI Header',
    defaultAccent: '#C2410C',
    headerBg: '#9A3412',
    headerText: '#FFFFFF',
    tableHeaderBg: '#FFF7ED',
    tableHeaderText: '#9A3412',
    borderColor: '#FED7AA',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'executive_grey',
    name: '14. Executive Grey',
    subtitle: 'Summary-first top dashboard panel (Amount + UPI QR on top)',
    layoutTag: 'Executive Summary-Top',
    defaultAccent: '#475569',
    headerBg: '#334155',
    headerText: '#FFFFFF',
    tableHeaderBg: '#F1F5F9',
    tableHeaderText: '#334155',
    borderColor: '#CBD5E1',
    pageBg: '#FFFFFF',
    badgeLabel: 'EXECUTIVE INVOICE',
  },
  {
    id: 'creative_premium',
    name: '15. Creative Premium',
    subtitle: 'Asymmetric 2-tone indigo masthead with angled badge & split footer',
    layoutTag: 'Asymmetric Split',
    defaultAccent: '#4F46E5',
    headerBg: '#EEF2FF',
    headerText: '#312E81',
    tableHeaderBg: '#3730A3',
    tableHeaderText: '#FFFFFF',
    borderColor: '#C7D2FE',
    pageBg: '#FFFFFF',
    badgeLabel: 'OFFICIAL INVOICE',
  },
  {
    id: 'rz_navy_cyan',
    name: '16. Navy Header Split',
    subtitle: 'Deep navy masthead banner, sky-blue Bill To & dark-navy Grand Total bar',
    layoutTag: 'Navy & Sky Split',
    defaultAccent: '#0F294A',
    headerBg: '#0F294A',
    headerText: '#FFFFFF',
    tableHeaderBg: '#DCEEF5',
    tableHeaderText: '#0F172A',
    borderColor: '#0F172A',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'export_blue_grid',
    name: '17. Export & Consignee Grid',
    subtitle: 'Full boxed GSTIN masthead, shaded banner, Bill To / Ship To & IGST columns',
    layoutTag: 'Export GST Box',
    defaultAccent: '#1E40AF',
    headerBg: '#CBE1F5',
    headerText: '#0F172A',
    tableHeaderBg: '#CBE1F5',
    tableHeaderText: '#0F172A',
    borderColor: '#1E293B',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'blue_commercial_sheet',
    name: '18. Royal Commercial Sheet',
    subtitle: 'Royal-blue section headers (From / Ship To / Sold To) & grey-zebra grid',
    layoutTag: 'Commercial Matrix',
    defaultAccent: '#2B5EA8',
    headerBg: '#2B5EA8',
    headerText: '#FFFFFF',
    tableHeaderBg: '#2B5EA8',
    tableHeaderText: '#FFFFFF',
    borderColor: '#475569',
    pageBg: '#FFFFFF',
    badgeLabel: 'INVOICE',
  },
  {
    id: 'tally_prime_classic',
    name: '19. Classic Accounting Sheet',
    subtitle: 'Traditional bordered GST grid with inline tax summary & HSN breakup table',
    layoutTag: 'HSN Accounting Box',
    defaultAccent: '#111827',
    headerBg: '#FFFFFF',
    headerText: '#111827',
    tableHeaderBg: '#F8FAFC',
    tableHeaderText: '#111827',
    borderColor: '#111827',
    pageBg: '#FFFFFF',
    badgeLabel: 'Tax Invoice',
  },
  {
    id: 'sharma_monogram_sig',
    name: '20. Monogram Crest & Signature',
    subtitle: 'Circular emblem badge, CGST/SGST HSN breakup, UPI QR & cursive signature',
    layoutTag: 'Emblem & UPI QR',
    defaultAccent: '#1E3A8A',
    headerBg: '#1E3A8A',
    headerText: '#FFFFFF',
    tableHeaderBg: '#F8FAFC',
    tableHeaderText: '#0F172A',
    borderColor: '#1E293B',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'saffron_grid_box',
    name: '21. Amber Dispatch Grid',
    subtitle: 'Bold amber header + LOGO slot, 6-row dispatch matrix & peach-tinted rows',
    layoutTag: 'Dispatch Box Grid',
    defaultAccent: '#D97706',
    headerBg: '#EA580C',
    headerText: '#FFFFFF',
    tableHeaderBg: '#FED7AA',
    tableHeaderText: '#0F172A',
    borderColor: '#1E293B',
    pageBg: '#FFFFFF',
    badgeLabel: 'Tax Invoice',
  },
  {
    id: 'teal_ribbon_freight',
    name: '22. Teal Ribbon Logistics',
    subtitle: 'Bold title + teal tagline ribbon, Challan/E-Way grid & bank QR panel',
    layoutTag: 'Teal Freight Ribbon',
    defaultAccent: '#0D9488',
    headerBg: '#0D9488',
    headerText: '#FFFFFF',
    tableHeaderBg: '#F8FAFC',
    tableHeaderText: '#0F172A',
    borderColor: '#1E293B',
    pageBg: '#FFFFFF',
    badgeLabel: 'TAX INVOICE',
  },
  {
    id: 'sleek_tabular_pro',
    name: '23. Tabular GST Strip',
    subtitle: 'Wide compact header, 3-col PIN/GST/PAN strip, full CGST/SGST/IGST HSN breakup',
    layoutTag: 'Tabular GST Breakup',
    defaultAccent: '#0284C7',
    headerBg: '#FFFFFF',
    headerText: '#0F172A',
    tableHeaderBg: '#F1F5F9',
    tableHeaderText: '#0F172A',
    borderColor: '#0F172A',
    pageBg: '#FFFFFF',
    badgeLabel: 'Tax Invoice',
  },
  {
    id: 'sunstar_seal_b2b',
    name: '24. Industrial Seal B2B',
    subtitle: 'Dense item code/taxable-rate/final-rate table & stamped company seal footer',
    layoutTag: 'Round Seal & B2B',
    defaultAccent: '#4338CA',
    headerBg: '#FFFFFF',
    headerText: '#0F172A',
    tableHeaderBg: '#F8FAFC',
    tableHeaderText: '#0F172A',
    borderColor: '#334155',
    pageBg: '#FFFFFF',
    badgeLabel: 'Tax Invoice',
  },
];

export function formatINR(amount: number, showSign = false): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safe);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (safe < 0) return `-₹${formatted}`;
  if (showSign && safe > 0) return `+₹${formatted}`;
  return `₹${formatted}`;
}

export function formatCurrency(amount: number, currency = 'INR', rateToInr = 1): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (currency === 'INR' || !rateToInr) return formatINR(safe);
  const converted = safe / rateToInr;
  const sym =
    currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'AED' ? 'AED ' : `${currency} `;
  return `${sym}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(converted)}`;
}

export function formatCompactINR(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function numberToIndianWords(num: number): string {
  const safe = Math.round(Math.abs(num));
  if (safe === 0) return 'Rupees Zero Only';
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (n: number): string => {
    if (n < 20) return ones[n];
    return `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`.trim();
  };

  const threeDigits = (n: number): string => {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    return `${h ? ones[h] + ' Hundred' : ''}${h && rem ? ' ' : ''}${rem ? twoDigits(rem) : ''}`.trim();
  };

  const crore = Math.floor(safe / 10000000);
  const lakh = Math.floor((safe % 10000000) / 100000);
  const thousand = Math.floor((safe % 100000) / 1000);
  const rest = safe % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));

  return `Rupees ${parts.join(' ')} Only`;
}

export function calculateVoucherLine(params: {
  id: string;
  itemId: string;
  itemName: string;
  description?: string;
  hsn: string;
  qty: number;
  unit: string;
  rate: number;
  mrp?: number;
  discountPct: number;
  taxRate: number;
  cessRate?: number;
  taxInclusive?: boolean;
  taxOnMrp?: boolean;
  isInterState: boolean;
  batchNo?: string;
  serialNo?: string;
  mfgDate?: string;
  expDate?: string;
  modelNo?: string;
  size?: string;
  customValues?: Record<string, string>;
  newItemMeta?: VoucherLine['newItemMeta'];
}): VoucherLine {
  const qty = Math.max(0, Number(params.qty) || 0);
  const rate = Math.max(0, Number(params.rate) || 0);
  const mrp = params.mrp !== undefined ? Math.max(0, Number(params.mrp) || 0) : undefined;
  const discountPct = Math.min(100, Math.max(0, Number(params.discountPct) || 0));
  const taxRate = Math.max(0, Number(params.taxRate) || 0);
  const cessRate = Math.max(0, Number(params.cessRate) || 0);

  const effectiveUnitRate = params.taxOnMrp && mrp && mrp > 0 ? mrp : rate;
  const gross = qty * effectiveUnitRate;
  const afterDiscount = gross * (1 - discountPct / 100);
  const totalTaxPct = taxRate + cessRate;

  let taxableAmount = afterDiscount;
  if (params.taxInclusive && totalTaxPct > 0) {
    taxableAmount = afterDiscount / (1 + totalTaxPct / 100);
  }

  const gstAmount = (taxableAmount * taxRate) / 100;
  const cessAmount = (taxableAmount * cessRate) / 100;
  const cgst = params.isInterState ? 0 : gstAmount / 2;
  const sgst = params.isInterState ? 0 : gstAmount / 2;
  const igst = params.isInterState ? gstAmount : 0;
  const total = taxableAmount + gstAmount + cessAmount;

  return {
    id: params.id,
    itemId: params.itemId,
    itemName: params.itemName,
    description: params.description,
    hsn: params.hsn,
    qty,
    unit: params.unit,
    rate: Number(rate.toFixed(2)),
    mrp,
    discountPct,
    taxRate,
    cessRate,
    taxableAmount: Number(taxableAmount.toFixed(2)),
    cgst: Number(cgst.toFixed(2)),
    sgst: Number(sgst.toFixed(2)),
    igst: Number(igst.toFixed(2)),
    cess: Number(cessAmount.toFixed(2)),
    total: Number(total.toFixed(2)),
    batchNo: params.batchNo,
    serialNo: params.serialNo,
    mfgDate: params.mfgDate,
    expDate: params.expDate,
    modelNo: params.modelNo,
    size: params.size,
    customValues: params.customValues,
    newItemMeta: params.newItemMeta,
  };
}

export function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function validateGSTIN(gstin: string): boolean {
  if (!gstin.trim()) return true;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim().toUpperCase());
}

export function generateDeterministicQRGrid(seed: string, size = 21): boolean[][] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const border = r === 0 || r === 6 || c === 0 || c === 6;
        const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = border || inner;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inFinder =
        (r < 8 && c < 8) ||
        (r < 8 && c >= size - 8) ||
        (r >= size - 8 && c < 8);
      if (!inFinder) {
        hash ^= (r * 31 + c * 17) & 0xff;
        hash = Math.imul(hash, 16777619);
        grid[r][c] = (hash >>> 0) % 2 === 0;
      }
    }
  }
  return grid;
}

const CODE39_MAP: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
};

export function generateCode39Bars(raw: string): { x: number; w: number }[] {
  const clean = `*${raw.toUpperCase().replace(/[^0-9A-Z\-. ]/g, '')}*`;
  const bars: { x: number; w: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < clean.length; i++) {
    const pattern = CODE39_MAP[clean[i]] || CODE39_MAP['-'];
    for (let j = 0; j < pattern.length; j++) {
      const width = pattern[j] === 'w' ? 3 : 1;
      if (j % 2 === 0) {
        bars.push({ x: cursor, w: width });
      }
      cursor += width;
    }
    cursor += 1;
  }
  return bars;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

