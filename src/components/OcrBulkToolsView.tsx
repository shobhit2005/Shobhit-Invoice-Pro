import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Package,
  Plus,
  ScanLine,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import {
  calculateVoucherLine,
  formatINR,
  INDIAN_STATES,
  ITEM_UNITS,
  todayISO,
  uid,
} from '../utils/formatters';
import {
  Item,
  Party,
  PaymentMode,
  ScannedInvoiceLine,
  ScannedInvoiceResult,
  Voucher,
} from '../types/accounting';

type ToolTab = 'ocr' | 'bulk_items' | 'bulk_parties';

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCol(row: Record<string, unknown>, candidates: string[]): unknown {
  const entries = Object.entries(row);
  for (const cand of candidates) {
    const target = normalizeKey(cand);
    const hit = entries.find(([key]) => normalizeKey(key) === target);
    if (hit !== undefined && hit[1] !== undefined && hit[1] !== '') return hit[1];
  }
  return undefined;
}

export const OcrBulkToolsView: React.FC = () => {
  const {
    db,
    getAiStatus,
    scanInvoiceOcr,
    saveVoucher,
    saveParty,
    getNextVoucherNo,
    bulkImportItems,
    bulkImportParties,
  } = useStore();

  const [tab, setTab] = useState<ToolTab>('ocr');
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string } | null>(null);

  // --- OCR STATE ---
  const [ocrText, setOcrText] = useState('');
  const [ocrImagePreview, setOcrImagePreview] = useState('');
  const [ocrMime, setOcrMime] = useState('');
  const [ocrFileName, setOcrFileName] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrSavedMsg, setOcrSavedMsg] = useState('');
  const [autoSaveParty, setAutoSaveParty] = useState(true);
  const [scanned, setScanned] = useState<ScannedInvoiceResult | null>(null);

  // --- BULK ITEMS STATE ---
  const [parsedItems, setParsedItems] = useState<Partial<Item>[]>([]);
  const [itemsFileName, setItemsFileName] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [itemsMsg, setItemsMsg] = useState('');
  const [itemsImporting, setItemsImporting] = useState(false);

  // --- BULK PARTIES STATE ---
  const [parsedParties, setParsedParties] = useState<Partial<Party>[]>([]);
  const [partiesFileName, setPartiesFileName] = useState('');
  const [partiesError, setPartiesError] = useState('');
  const [partiesMsg, setPartiesMsg] = useState('');
  const [partiesImporting, setPartiesImporting] = useState(false);

  useEffect(() => {
    let active = true;
    getAiStatus()
      .then((s) => {
        if (active) setAiStatus(s);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [getAiStatus]);

  const existingItemLookup = useMemo(() => {
    const skus = new Set((db?.items || []).map((i) => i.sku.trim().toLowerCase()).filter(Boolean));
    const names = new Set((db?.items || []).map((i) => i.name.trim().toLowerCase()));
    return { skus, names };
  }, [db?.items]);

  const existingPartyLookup = useMemo(() => {
    const gstins = new Set((db?.parties || []).map((p) => p.gstin.trim().toUpperCase()).filter(Boolean));
    const names = new Set((db?.parties || []).map((p) => p.name.trim().toLowerCase()));
    return { gstins, names };
  }, [db?.parties]);

  if (!db) return null;

  // --- OCR HANDLERS ---
  const handleOcrFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrError('');
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setOcrError('Please upload a PDF, PNG, JPEG, or WEBP invoice.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setOcrError('File must be under 15 MB.');
      return;
    }
    setOcrFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setOcrImagePreview(String(reader.result || ''));
      setOcrMime(file.type);
    };
    reader.readAsDataURL(file);
  };

  const handleRunOcr = async () => {
    setOcrError('');
    setOcrSavedMsg('');
    if (!ocrImagePreview && !ocrText.trim()) {
      setOcrError('Upload an invoice PDF/photo or paste invoice text first.');
      return;
    }
    setOcrLoading(true);
    try {
      const base64Data = ocrImagePreview ? ocrImagePreview.split(',')[1] : undefined;
      const result = await scanInvoiceOcr({
        base64Data,
        mimeType: ocrImagePreview ? ocrMime : undefined,
        rawText: ocrText.trim() || undefined,
      });
      setScanned(result);
    } catch (err) {
      setOcrError((err as Error).message);
    } finally {
      setOcrLoading(false);
    }
  };

  const recalcScannedTotals = (draft: ScannedInvoiceResult): ScannedInvoiceResult => {
    const ownStateCode = (db.profile.gstin || '').slice(0, 2);
    const partyStateCode = (draft.partyGstin || '').slice(0, 2);
    const isInterState =
      Boolean(ownStateCode && partyStateCode && ownStateCode !== partyStateCode) ||
      (draft.placeOfSupply.trim().toLowerCase() !== db.profile.state.trim().toLowerCase() &&
        Boolean(draft.placeOfSupply.trim()));

    const updatedLines: ScannedInvoiceLine[] = draft.lines.map((l) => {
      const taxable = Number((l.qty * l.rate * (1 - (l.discountPct || 0) / 100)).toFixed(2));
      const gstAmt = Number(((taxable * (l.taxRate || 0)) / 100).toFixed(2));
      const cgst = isInterState ? 0 : Number((gstAmt / 2).toFixed(2));
      const sgst = isInterState ? 0 : Number((gstAmt / 2).toFixed(2));
      const igst = isInterState ? gstAmt : 0;
      const total = Number((taxable + gstAmt).toFixed(2));
      return { ...l, taxableAmount: taxable, cgst, sgst, igst, total };
    });

    const subTotal = Number(updatedLines.reduce((s, l) => s + l.taxableAmount, 0).toFixed(2));
    const taxTotal = Number(updatedLines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0).toFixed(2));
    const grandTotal = Number(
      (subTotal + taxTotal + Number(draft.additionalCharges || 0) - Number(draft.discountTotal || 0) + Number(draft.roundOff || 0)).toFixed(2)
    );
    return { ...draft, lines: updatedLines, subTotal, taxTotal, grandTotal };
  };

  const updateLine = (idx: number, patch: Partial<ScannedInvoiceLine>) => {
    if (!scanned) return;
    const nextLines = scanned.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    setScanned(recalcScannedTotals({ ...scanned, lines: nextLines }));
  };

  const addEmptyLine = () => {
    if (!scanned) return;
    const nextLines: ScannedInvoiceLine[] = [
      ...scanned.lines,
      {
        itemName: 'New Item',
        description: '',
        hsn: '8500',
        sku: '',
        qty: 1,
        unit: 'PCS',
        rate: 0,
        mrp: 0,
        discountPct: 0,
        taxRate: 18,
        taxableAmount: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 0,
      },
    ];
    setScanned(recalcScannedTotals({ ...scanned, lines: nextLines }));
  };

  const handleSaveOcrVoucher = async () => {
    if (!scanned) return;
    setOcrError('');
    setOcrSavedMsg('');

    let matchedParty = db.parties.find(
      (p) =>
        (scanned.partyGstin && p.gstin.toUpperCase() === scanned.partyGstin.toUpperCase()) ||
        p.name.toLowerCase() === scanned.partyName.trim().toLowerCase()
    );

    if (autoSaveParty && scanned.partyName.trim()) {
      const partyPayload: Party = matchedParty
        ? {
            ...matchedParty,
            gstin: scanned.partyGstin || matchedParty.gstin,
            pan: scanned.partyPan || matchedParty.pan,
            phone: scanned.partyPhone || matchedParty.phone,
            email: scanned.partyEmail || matchedParty.email,
            billingAddress: scanned.partyAddress || matchedParty.billingAddress,
            state: scanned.partyState || matchedParty.state,
          }
        : {
            id: uid('p'),
            name: scanned.partyName.trim(),
            type: scanned.documentType === 'sale_invoice' ? 'customer' : 'supplier',
            phone: scanned.partyPhone || '',
            email: scanned.partyEmail || '',
            gstin: scanned.partyGstin || '',
            pan: scanned.partyPan || '',
            state: scanned.partyState || db.profile.state,
            billingAddress: scanned.partyAddress || '',
            shippingAddress: scanned.partyAddress || '',
            openingBalance: 0,
            openingType: scanned.documentType === 'sale_invoice' ? 'receivable' : 'payable',
            creditLimit: 0,
            creditDays: 30,
            group: scanned.documentType === 'sale_invoice' ? 'Sundry Debtors' : 'Sundry Creditors',
            createdAt: todayISO(),
          };
      await saveParty(partyPayload);
      matchedParty = partyPayload;
    }

    const ownStateCode = (db.profile.gstin || '').slice(0, 2);
    const partyStateCode = (scanned.partyGstin || '').slice(0, 2);
    const isInterState =
      Boolean(ownStateCode && partyStateCode && ownStateCode !== partyStateCode) ||
      (scanned.placeOfSupply.trim().toLowerCase() !== db.profile.state.trim().toLowerCase() &&
        Boolean(scanned.placeOfSupply.trim()));

    const lines = scanned.lines.map((l, idx) => {
      const matchedItem = db.items.find(
        (i) =>
          (l.sku && i.sku.toLowerCase() === l.sku.toLowerCase()) ||
          i.name.toLowerCase() === l.itemName.trim().toLowerCase()
      );
      return calculateVoucherLine({
        id: uid('ln'),
        itemId: matchedItem?.id || `new_ocr_${idx}`,
        itemName: l.itemName || `Scanned Item ${idx + 1}`,
        description: l.description,
        hsn: l.hsn || '8500',
        qty: Number(l.qty) || 1,
        unit: l.unit || 'PCS',
        rate: Number(l.rate) || 0,
        mrp: l.mrp || undefined,
        discountPct: Number(l.discountPct) || 0,
        taxRate: Number(l.taxRate) || 0,
        isInterState,
        newItemMeta: matchedItem
          ? undefined
          : {
              salePrice:
                scanned.documentType === 'purchase_bill'
                  ? Number((Number(l.rate || 0) * 1.2).toFixed(2))
                  : Number(l.rate || 0),
              mrp: Number(l.mrp || 0),
              sku: l.sku || undefined,
              category: 'OCR Imported',
            },
      });
    });

    const subTotal = Number(lines.reduce((s, l) => s + l.taxableAmount, 0).toFixed(2));
    const taxTotal = Number(lines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0).toFixed(2));
    const grandTotal = Number(
      (
        subTotal +
        taxTotal +
        Number(scanned.additionalCharges || 0) -
        Number(scanned.discountTotal || 0) +
        Number(scanned.roundOff || 0)
      ).toFixed(2)
    );
    const paidAmount = Math.min(grandTotal, Math.max(0, Number(scanned.paidAmount || 0)));

    const v: Voucher = {
      id: uid('v'),
      branchId: db.activeBranchId,
      type: scanned.documentType,
      voucherNo: scanned.invoiceNo || getNextVoucherNo(scanned.documentType),
      date: scanned.invoiceDate || todayISO(),
      dueDate: scanned.dueDate || undefined,
      partyId: matchedParty?.id,
      partyName: scanned.partyName || 'Scanned Party',
      partyGstin: scanned.partyGstin || '',
      placeOfSupply: scanned.placeOfSupply || db.profile.state,
      isInterState,
      lines,
      additionalCharges: Number(scanned.additionalCharges || 0),
      discountTotal: Number(scanned.discountTotal || 0),
      roundOff: Number(scanned.roundOff || 0),
      subTotal,
      taxTotal,
      grandTotal,
      paidAmount,
      paymentMode: (scanned.paymentMode as PaymentMode) || 'Bank Transfer',
      isReverseCharge: scanned.reverseCharge,
      ewayBillNo: scanned.ewayBillNo || undefined,
      vehicleNo: scanned.vehicleNo || undefined,
      transporterName: scanned.transporterName || undefined,
      status: paidAmount >= grandTotal ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
      expenseCategory: scanned.documentType === 'purchase_bill' ? 'Inventory Purchase' : undefined,
      notes: scanned.notes || 'Created via AI Invoice Scanner (OCR)',
      terms: scanned.terms || db.profile.defaultTerms,
      createdAt: new Date().toISOString(),
    };

    await saveVoucher(v);
    setOcrSavedMsg(
      `${v.type === 'sale_invoice' ? 'Sale Invoice' : 'Purchase Bill'} ${v.voucherNo} (${formatINR(
        v.grandTotal
      )}) saved cleanly with party & inventory updated.`
    );
  };

  // --- BULK EXCEL: ITEMS ---
  const downloadItemTemplate = () => {
    const rows = [
      {
        Name: 'Havells 2.5 sqmm Copper Wire (90m)',
        Type: 'product',
        SKU: 'HAV-WIRE-25',
        Barcode: '8901234500112',
        HSN: '8544',
        Category: 'Electrical Wires',
        Subcategory: 'FR PVC Cable',
        Unit: 'COIL',
        'Sale Price': 2450,
        'Purchase Price': 1980,
        MRP: 2790,
        'Wholesale Price': 2250,
        'Tax Rate': 18,
        'Cess Rate': 0,
        'Tax Inclusive': 'No',
        'Stock Qty': 45,
        'Min Stock Alert': 10,
        'Max Stock': 200,
        'Bin Location': 'RACK-A2',
      },
      {
        Name: 'Electrical Installation Service',
        Type: 'service',
        SKU: 'SRV-INST-01',
        Barcode: '',
        HSN: '9987',
        Category: 'Services',
        Subcategory: 'Installation',
        Unit: 'JOB',
        'Sale Price': 1500,
        'Purchase Price': 0,
        MRP: 1500,
        'Wholesale Price': 1500,
        'Tax Rate': 18,
        'Cess Rate': 0,
        'Tax Inclusive': 'No',
        'Stock Qty': 0,
        'Min Stock Alert': 0,
        'Max Stock': 0,
        'Bin Location': '',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items_Template');
    XLSX.writeFile(wb, 'ShobhitInvoicePro_Items_Template.xlsx');
  };

  const exportItemsExcel = () => {
    const rows = db.items.map((i) => ({
      Name: i.name,
      Type: i.type,
      SKU: i.sku,
      Barcode: i.barcode,
      HSN: i.hsn,
      Category: i.category,
      Subcategory: i.subcategory || '',
      Unit: i.unit,
      'Sale Price': i.salePrice,
      'Purchase Price': i.purchasePrice,
      MRP: i.mrp,
      'Wholesale Price': i.wholesalePrice,
      'Tax Rate': i.taxRate,
      'Cess Rate': i.cessRate,
      'Tax Inclusive': i.taxInclusive ? 'Yes' : 'No',
      'Stock Qty': i.stockQty,
      'Min Stock Alert': i.minStockAlert,
      'Max Stock': i.maxStock ?? 250,
      'Bin Location': i.binLocation || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    XLSX.writeFile(wb, `ShobhitInvoicePro_Items_${todayISO()}.xlsx`);
  };

  const handleItemsFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setItemsError('');
    setItemsMsg('');
    setItemsFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error('Excel file contains no sheets.');
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet]);
      const mapped: Partial<Item>[] = rawRows
        .map((r) => {
          const name = String(getCol(r, ['Name', 'Item Name', 'Product Name', 'Description']) || '').trim();
          if (!name) return null;
          const taxIncRaw = String(getCol(r, ['Tax Inclusive', 'Inclusive']) || 'no').toLowerCase();
          return {
            name,
            type: String(getCol(r, ['Type']) || 'product').toLowerCase() === 'service' ? 'service' : 'product',
            sku: String(getCol(r, ['SKU', 'Item Code', 'Code']) || ''),
            barcode: String(getCol(r, ['Barcode', 'EAN']) || ''),
            hsn: String(getCol(r, ['HSN', 'HSN/SAC', 'SAC']) || ''),
            category: String(getCol(r, ['Category']) || 'General'),
            subcategory: String(getCol(r, ['Subcategory', 'Sub Category']) || ''),
            unit: String(getCol(r, ['Unit', 'UOM']) || 'PCS').toUpperCase(),
            salePrice: Number(getCol(r, ['Sale Price', 'Selling Price', 'Rate', 'Price']) || 0),
            purchasePrice: Number(getCol(r, ['Purchase Price', 'Cost Price', 'Cost']) || 0),
            mrp: Number(getCol(r, ['MRP']) || 0),
            wholesalePrice: Number(getCol(r, ['Wholesale Price']) || 0),
            taxRate: Number(getCol(r, ['Tax Rate', 'GST %', 'GST', 'Tax']) ?? 18),
            cessRate: Number(getCol(r, ['Cess Rate', 'Cess']) || 0),
            taxInclusive: taxIncRaw === 'yes' || taxIncRaw === 'true' || taxIncRaw === '1',
            stockQty: Number(getCol(r, ['Stock Qty', 'Opening Stock', 'Qty', 'Stock']) || 0),
            minStockAlert: Number(getCol(r, ['Min Stock Alert', 'Min Stock', 'Reorder Level']) ?? 10),
            maxStock: Number(getCol(r, ['Max Stock']) ?? 250),
            binLocation: String(getCol(r, ['Bin Location', 'Rack', 'Bin']) || 'RACK-A1'),
          } as Partial<Item>;
        })
        .filter((x): x is Partial<Item> => x !== null);

      if (mapped.length === 0) {
        throw new Error('No valid item rows found. Ensure a "Name" or "Item Name" column exists.');
      }
      setParsedItems(mapped);
    } catch (err) {
      setItemsError((err as Error).message);
      setParsedItems([]);
    }
  };

  const handleConfirmImportItems = async () => {
    if (parsedItems.length === 0) return;
    setItemsImporting(true);
    setItemsError('');
    setItemsMsg('');
    try {
      const res = await bulkImportItems(parsedItems);
      setItemsMsg(
        `Bulk import complete: ${res.importedCount} new item(s) added, ${res.updatedCount} existing item(s) updated.`
      );
      setParsedItems([]);
      setItemsFileName('');
    } catch (err) {
      setItemsError((err as Error).message);
    } finally {
      setItemsImporting(false);
    }
  };

  // --- BULK EXCEL: PARTIES ---
  const downloadPartyTemplate = () => {
    const rows = [
      {
        Name: 'Shree Ganesh Enterprises',
        Type: 'customer',
        Phone: '9876543210',
        Email: 'accounts@shreeganesh.in',
        GSTIN: '27AABCS1429B1Z1',
        PAN: 'AABCS1429B',
        State: 'Maharashtra',
        'Billing Address': 'Shop 14, Lamington Road, Mumbai 400007',
        'Shipping Address': 'Shop 14, Lamington Road, Mumbai 400007',
        'Opening Balance': 15000,
        'Opening Type': 'receivable',
        'Credit Limit': 100000,
        'Credit Days': 30,
        Group: 'Sundry Debtors',
      },
      {
        Name: 'Apex Industrial Suppliers',
        Type: 'supplier',
        Phone: '9811223344',
        Email: 'billing@apexsuppliers.com',
        GSTIN: '07AAACA8891K1Z5',
        PAN: 'AAACA8891K',
        State: 'Delhi',
        'Billing Address': 'Plot 42, Okhla Industrial Area Phase II, New Delhi',
        'Shipping Address': 'Plot 42, Okhla Industrial Area Phase II, New Delhi',
        'Opening Balance': 25000,
        'Opening Type': 'payable',
        'Credit Limit': 250000,
        'Credit Days': 45,
        Group: 'Sundry Creditors',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Parties_Template');
    XLSX.writeFile(wb, 'ShobhitInvoicePro_Parties_Template.xlsx');
  };

  const exportPartiesExcel = () => {
    const rows = db.parties.map((p) => ({
      Name: p.name,
      Type: p.type,
      Phone: p.phone,
      Email: p.email,
      GSTIN: p.gstin,
      PAN: p.pan,
      State: p.state,
      'Billing Address': p.billingAddress,
      'Shipping Address': p.shippingAddress,
      'Opening Balance': p.openingBalance,
      'Opening Type': p.openingType,
      'Credit Limit': p.creditLimit,
      'Credit Days': p.creditDays,
      Group: p.group,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Parties');
    XLSX.writeFile(wb, `ShobhitInvoicePro_Parties_${todayISO()}.xlsx`);
  };

  const handlePartiesFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPartiesError('');
    setPartiesMsg('');
    setPartiesFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error('Excel file contains no sheets.');
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet]);
      const mapped: Partial<Party>[] = rawRows
        .map((r) => {
          const name = String(getCol(r, ['Name', 'Party Name', 'Customer Name', 'Supplier Name']) || '').trim();
          if (!name) return null;
          const rawType = String(getCol(r, ['Type', 'Party Type']) || 'customer').toLowerCase();
          const type: Party['type'] =
            rawType === 'supplier' || rawType === 'vendor'
              ? 'supplier'
              : rawType === 'both'
              ? 'both'
              : 'customer';
          const openTypeRaw = String(
            getCol(r, ['Opening Type']) || (type === 'supplier' ? 'payable' : 'receivable')
          ).toLowerCase();
          return {
            name,
            type,
            phone: String(getCol(r, ['Phone', 'Mobile', 'Contact']) || ''),
            email: String(getCol(r, ['Email', 'E-mail']) || ''),
            gstin: String(getCol(r, ['GSTIN', 'GST No']) || '').toUpperCase(),
            pan: String(getCol(r, ['PAN', 'PAN No']) || '').toUpperCase(),
            state: String(getCol(r, ['State']) || db.profile.state),
            billingAddress: String(getCol(r, ['Billing Address', 'Address']) || ''),
            shippingAddress: String(getCol(r, ['Shipping Address', 'Billing Address', 'Address']) || ''),
            openingBalance: Number(getCol(r, ['Opening Balance', 'Balance']) || 0),
            openingType: openTypeRaw === 'payable' ? 'payable' : 'receivable',
            creditLimit: Number(getCol(r, ['Credit Limit']) || 0),
            creditDays: Number(getCol(r, ['Credit Days']) || 30),
            group: String(
              getCol(r, ['Group', 'Ledger Group']) ||
                (type === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors')
            ),
          } as Partial<Party>;
        })
        .filter((x): x is Partial<Party> => x !== null);

      if (mapped.length === 0) {
        throw new Error('No valid party rows found. Ensure a "Name" or "Party Name" column exists.');
      }
      setParsedParties(mapped);
    } catch (err) {
      setPartiesError((err as Error).message);
      setParsedParties([]);
    }
  };

  const handleConfirmImportParties = async () => {
    if (parsedParties.length === 0) return;
    setPartiesImporting(true);
    setPartiesError('');
    setPartiesMsg('');
    try {
      const res = await bulkImportParties(parsedParties);
      setPartiesMsg(
        `Bulk import complete: ${res.importedCount} new party(ies) added, ${res.updatedCount} existing party(ies) updated.`
      );
      setParsedParties([]);
      setPartiesFileName('');
    } catch (err) {
      setPartiesError((err as Error).message);
    } finally {
      setPartiesImporting(false);
    }
  };

  const TABS: { id: ToolTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'ocr', label: 'AI Invoice Scanner (OCR)', icon: ScanLine },
    { id: 'bulk_items', label: `Bulk Items Excel (${db.items.length})`, icon: Package },
    { id: 'bulk_parties', label: `Bulk Parties Excel (${db.parties.length})`, icon: Users },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
            Utilities / OCR Scanner &amp; Bulk Excel Import-Export
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
            Invoice OCR &amp; Excel Bulk Tools
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Scan bills with full GST/Party/Transport/Line details via OCR, and bulk import or export Items &amp; Parties in Excel (.xlsx).
          </p>
        </div>

        {aiStatus && tab === 'ocr' && (
          <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs flex items-center gap-2 shrink-0">
            <span
              className={`w-2 h-2 rounded-full ${
                aiStatus.configured ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {aiStatus.configured ? `OCR Engine Ready (${aiStatus.model})` : 'OCR Server Key Not Set'}
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: FULL-DETAIL INVOICE OCR SCANNER */}
      {tab === 'ocr' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 h-fit">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Upload Invoice PDF / Photo or Paste Bill Text
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Supports PDF bills &amp; images. Extracts party GSTIN/PAN/phone/address, invoice &amp; due dates, E-Way/vehicle info, line HSN/MRP/discounts/GST split, and totals.
              </p>
            </div>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-5 text-center space-y-2">
              <Upload className="w-7 h-7 text-[#168C88] mx-auto" />
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Invoice PDF or Photo (PDF, PNG, JPEG, WEBP · Max 15MB)
              </div>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={handleOcrFileChange}
                className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#E5EFF3] file:text-[#116B68] hover:file:bg-teal-100"
              />
              {ocrImagePreview && (
                <div className="pt-2 space-y-1.5">
                  {ocrMime === 'application/pdf' ? (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800">
                      <div className="px-3 py-2 flex items-center justify-center gap-2 text-xs font-semibold text-[#116B68] dark:text-teal-300 bg-[#E5EFF3] dark:bg-slate-800">
                        <FileText className="w-4 h-4 shrink-0" />
                        <span className="truncate">{ocrFileName || 'Uploaded Invoice.pdf'}</span>
                      </div>
                      <iframe
                        src={ocrImagePreview}
                        title="Uploaded PDF invoice preview"
                        className="w-full h-48 border-0"
                      />
                    </div>
                  ) : (
                    <img
                      src={ocrImagePreview}
                      alt="Uploaded invoice preview"
                      className="max-h-44 mx-auto rounded-lg border border-slate-200 dark:border-slate-700 object-contain"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setOcrImagePreview('');
                      setOcrMime('');
                      setOcrFileName('');
                    }}
                    className="mt-1 text-[11px] text-red-600 hover:underline"
                  >
                    Remove File
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Or Paste Raw Bill Text
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setOcrText(
                      `TAX INVOICE (Original for Recipient)\nSeller: Apex Hardware & Cables Pvt Ltd\nGSTIN: 27AABCA9182F1Z4 | PAN: AABCA9182F\nPhone: 9820112233 | Email: sales@apexhardware.in\nAddress: Plot 18, MIDC Bhosari, Pune, Maharashtra 411026\nInvoice No: AHD/26-27/892 | Date: ${todayISO()} | Due Date: 2026-12-21\nPlace of Supply: Maharashtra | Payment Mode: Bank Transfer\nE-Way Bill: EWB-4410982311 | Vehicle No: MH12PQ4490 | Transporter: VRL Logistics\nItems:\n1) Copper Armoured Cable 4C (SKU: CAB-4C, HSN 8544) - Qty 12 COIL, MRP 2800, Rate 2450, Disc 5%, GST 18%\n2) Modular MCB 32A Double Pole (SKU: MCB-32D, HSN 8536) - Qty 25 PCS, MRP 380, Rate 320, Disc 0%, GST 18%\nFreight & Packing Charges: Rs 450\nTerms: Payment within 30 days. Subject to Pune Jurisdiction.`
                    )
                  }
                  className="text-[11px] font-semibold text-[#2676A8] hover:underline"
                >
                  Load Full Sample Bill
                </button>
              </div>
              <textarea
                rows={6}
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                placeholder="Paste supplier or customer invoice text here..."
                className="w-full p-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>

            {ocrError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {ocrError}
              </div>
            )}

            <button
              type="button"
              onClick={handleRunOcr}
              disabled={ocrLoading}
              className="w-full py-2.5 rounded-lg bg-[#168C88] hover:bg-[#116B68] disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
            >
              {ocrLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              {ocrLoading ? 'Extracting All Invoice Details...' : 'Extract Full Invoice with AI OCR'}
            </button>
          </div>

          <div className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Complete Extracted Invoice Details (Editable)
              </h2>
              {scanned && (
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSaveParty}
                    onChange={(e) => setAutoSaveParty(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  Auto-save/update Party Master
                </label>
              )}
            </div>

            {!scanned ? (
              <div className="py-20 text-center text-xs text-slate-500">
                Upload an invoice image or load/paste bill text on the left to extract all party, transport, tax, and line-item details.
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Document & Dates */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[11px] text-slate-500">Voucher Type</label>
                    <select
                      value={scanned.documentType}
                      onChange={(e) =>
                        setScanned({
                          ...scanned,
                          documentType: e.target.value === 'sale_invoice' ? 'sale_invoice' : 'purchase_bill',
                        })
                      }
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <option value="purchase_bill">Purchase Bill</option>
                      <option value="sale_invoice">Sale Invoice</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Invoice No</label>
                    <input
                      value={scanned.invoiceNo}
                      onChange={(e) => setScanned({ ...scanned, invoiceNo: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Invoice Date</label>
                    <input
                      type="date"
                      value={scanned.invoiceDate}
                      onChange={(e) => setScanned({ ...scanned, invoiceDate: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Due Date</label>
                    <input
                      type="date"
                      value={scanned.dueDate}
                      onChange={(e) => setScanned({ ...scanned, dueDate: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                </div>

                {/* Party Full Details */}
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    Party / Supplier Details
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[11px] text-slate-500">Party Name</label>
                      <input
                        value={scanned.partyName}
                        onChange={(e) => setScanned({ ...scanned, partyName: e.target.value })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500">GSTIN</label>
                      <input
                        value={scanned.partyGstin}
                        onChange={(e) =>
                          setScanned(recalcScannedTotals({ ...scanned, partyGstin: e.target.value.toUpperCase() }))
                        }
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500">PAN</label>
                      <input
                        value={scanned.partyPan}
                        onChange={(e) => setScanned({ ...scanned, partyPan: e.target.value.toUpperCase() })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500">Phone</label>
                      <input
                        value={scanned.partyPhone}
                        onChange={(e) => setScanned({ ...scanned, partyPhone: e.target.value })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500">Email</label>
                      <input
                        value={scanned.partyEmail}
                        onChange={(e) => setScanned({ ...scanned, partyEmail: e.target.value })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500">Place of Supply / State</label>
                      <select
                        value={scanned.placeOfSupply}
                        onChange={(e) =>
                          setScanned(
                            recalcScannedTotals({
                              ...scanned,
                              placeOfSupply: e.target.value,
                              partyState: e.target.value,
                            })
                          )
                        }
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        {INDIAN_STATES.map((s) => (
                          <option key={s.code} value={s.name}>
                            {s.name} ({s.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Billing Address</label>
                    <input
                      value={scanned.partyAddress}
                      onChange={(e) => setScanned({ ...scanned, partyAddress: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>

                {/* Transport & Payment Metadata */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div>
                    <label className="text-[11px] text-slate-500">Payment Mode</label>
                    <select
                      value={scanned.paymentMode}
                      onChange={(e) =>
                        setScanned({
                          ...scanned,
                          paymentMode: e.target.value as ScannedInvoiceResult['paymentMode'],
                        })
                      }
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="UPI">UPI</option>
                      <option value="Cash">Cash</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Card">Card</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">E-Way Bill No</label>
                    <input
                      value={scanned.ewayBillNo}
                      onChange={(e) => setScanned({ ...scanned, ewayBillNo: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Vehicle No</label>
                    <input
                      value={scanned.vehicleNo}
                      onChange={(e) => setScanned({ ...scanned, vehicleNo: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Transporter</label>
                    <input
                      value={scanned.transporterName}
                      onChange={(e) => setScanned({ ...scanned, transporterName: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div className="flex items-end pb-1.5">
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scanned.reverseCharge}
                        onChange={(e) => setScanned({ ...scanned, reverseCharge: e.target.checked })}
                        className="rounded border-slate-300 text-indigo-600"
                      />
                      Reverse Charge (RCM)
                    </label>
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      Line Items ({scanned.lines.length})
                    </span>
                    <button
                      type="button"
                      onClick={addEmptyLine}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline"
                    >
                      <Plus className="w-3 h-3" /> Add Line
                    </button>
                  </div>
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-[11px] text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500">
                        <tr>
                          <th className="p-2 min-w-[140px]">Item &amp; SKU</th>
                          <th className="p-2">HSN</th>
                          <th className="p-2 text-right">Qty</th>
                          <th className="p-2">Unit</th>
                          <th className="p-2 text-right">Rate</th>
                          <th className="p-2 text-right">MRP</th>
                          <th className="p-2 text-right">Disc%</th>
                          <th className="p-2 text-right">GST%</th>
                          <th className="p-2 text-right">Total</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {scanned.lines.map((l, idx) => (
                          <tr key={idx}>
                            <td className="p-1.5 space-y-1">
                              <input
                                value={l.itemName}
                                onChange={(e) => updateLine(idx, { itemName: e.target.value })}
                                className="w-full px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent font-medium"
                              />
                              <input
                                value={l.sku}
                                placeholder="SKU (optional)"
                                onChange={(e) => updateLine(idx, { sku: e.target.value })}
                                className="w-full px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-transparent font-mono text-[10px]"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                value={l.hsn}
                                onChange={(e) => updateLine(idx, { hsn: e.target.value })}
                                className="w-16 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent font-mono"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                value={l.qty}
                                onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                                className="w-14 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent text-right font-mono"
                              />
                            </td>
                            <td className="p-1.5">
                              <select
                                value={l.unit}
                                onChange={(e) => updateLine(idx, { unit: e.target.value })}
                                className="px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              >
                                {Array.from(new Set([l.unit, ...ITEM_UNITS])).map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                value={l.rate}
                                onChange={(e) => updateLine(idx, { rate: Number(e.target.value) })}
                                className="w-20 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent text-right font-mono"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                value={l.mrp}
                                onChange={(e) => updateLine(idx, { mrp: Number(e.target.value) })}
                                className="w-18 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent text-right font-mono"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                value={l.discountPct}
                                onChange={(e) => updateLine(idx, { discountPct: Number(e.target.value) })}
                                className="w-12 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent text-right font-mono"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                value={l.taxRate}
                                onChange={(e) => updateLine(idx, { taxRate: Number(e.target.value) })}
                                className="w-12 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent text-right font-mono"
                              />
                            </td>
                            <td className="p-1.5 text-right font-mono font-semibold tabular-nums">
                              {formatINR(l.total)}
                            </td>
                            <td className="p-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  const rem = scanned.lines.filter((_, i) => i !== idx);
                                  setScanned(recalcScannedTotals({ ...scanned, lines: rem }));
                                }}
                                className="p-1 text-slate-400 hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Charges, Paid, Notes & Totals */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[11px] text-slate-500">Additional / Freight</label>
                    <input
                      type="number"
                      value={scanned.additionalCharges}
                      onChange={(e) =>
                        setScanned(recalcScannedTotals({ ...scanned, additionalCharges: Number(e.target.value) }))
                      }
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Extra Discount</label>
                    <input
                      type="number"
                      value={scanned.discountTotal}
                      onChange={(e) =>
                        setScanned(recalcScannedTotals({ ...scanned, discountTotal: Number(e.target.value) }))
                      }
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Round Off</label>
                    <input
                      type="number"
                      step="0.01"
                      value={scanned.roundOff}
                      onChange={(e) =>
                        setScanned(recalcScannedTotals({ ...scanned, roundOff: Number(e.target.value) }))
                      }
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Paid Amount</label>
                    <input
                      type="number"
                      value={scanned.paidAmount}
                      onChange={(e) => setScanned({ ...scanned, paidAmount: Number(e.target.value) })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-slate-500">Notes / Narration</label>
                    <input
                      value={scanned.notes}
                      onChange={(e) => setScanned({ ...scanned, notes: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Terms &amp; Conditions</label>
                    <input
                      value={scanned.terms}
                      onChange={(e) => setScanned({ ...scanned, terms: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 font-mono text-xs">
                  <span>Taxable Subtotal: {formatINR(scanned.subTotal)}</span>
                  <span>Total GST: {formatINR(scanned.taxTotal)}</span>
                  <span className="font-bold text-indigo-700 dark:text-indigo-400">
                    Grand Total: {formatINR(scanned.grandTotal)}
                  </span>
                </div>

                {ocrSavedMsg && (
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{ocrSavedMsg}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSaveOcrVoucher}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                >
                  Save {scanned.documentType === 'sale_invoice' ? 'Sale Invoice' : 'Purchase Bill'} &amp; Update Stock + Party
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: BULK ITEMS EXCEL IMPORT & EXPORT */}
      {tab === 'bulk_items' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Bulk Items Import &amp; Export in Excel (.xlsx)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Download sample Excel format, export all {db.items.length} inventory items, or upload an Excel sheet to bulk create/update stock items.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadItemTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                Download Sample Excel
              </button>
              <button
                type="button"
                onClick={exportItemsExcel}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Export All Items (.xlsx)
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center space-y-2">
              <Upload className="w-7 h-7 text-indigo-600 mx-auto" />
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Upload Items Excel Workbook (.xlsx, .xls, or .csv)
              </div>
              <p className="text-[11px] text-slate-500">
                Existing items matching SKU or Name are updated cleanly; new names are inserted into Inventory.
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleItemsFileUpload}
                className="text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              {itemsFileName && (
                <div className="text-xs font-mono text-indigo-600 pt-1">Loaded: {itemsFileName}</div>
              )}
            </div>

            {itemsError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {itemsError}
              </div>
            )}
            {itemsMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{itemsMsg}</span>
              </div>
            )}

            {parsedItems.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Preview ({parsedItems.length} item rows ready to import)
                  </span>
                  <button
                    type="button"
                    disabled={itemsImporting}
                    onClick={handleConfirmImportItems}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    {itemsImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {itemsImporting ? 'Importing to SQLite...' : `Import ${parsedItems.length} Items`}
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg max-h-96">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] text-slate-500 sticky top-0">
                      <tr>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5">SKU</th>
                        <th className="p-2.5">HSN</th>
                        <th className="p-2.5">Unit</th>
                        <th className="p-2.5 text-right">Sale Price</th>
                        <th className="p-2.5 text-right">Purchase</th>
                        <th className="p-2.5 text-right">GST%</th>
                        <th className="p-2.5 text-right">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {parsedItems.slice(0, 100).map((it, idx) => {
                        const isUpdate =
                          (it.sku && existingItemLookup.skus.has(it.sku.trim().toLowerCase())) ||
                          existingItemLookup.names.has((it.name || '').trim().toLowerCase());
                        return (
                          <tr key={idx}>
                            <td className="p-2.5 font-semibold">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] ${
                                  isUpdate
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                }`}
                              >
                                {isUpdate ? 'Update' : 'New'}
                              </span>
                            </td>
                            <td className="p-2.5 font-medium">{it.name}</td>
                            <td className="p-2.5 font-mono">{it.sku || 'Auto'}</td>
                            <td className="p-2.5 font-mono">{it.hsn || '-'}</td>
                            <td className="p-2.5">{it.unit}</td>
                            <td className="p-2.5 text-right font-mono tabular-nums">{formatINR(it.salePrice || 0)}</td>
                            <td className="p-2.5 text-right font-mono tabular-nums">{formatINR(it.purchasePrice || 0)}</td>
                            <td className="p-2.5 text-right font-mono">{it.taxRate}%</td>
                            <td className="p-2.5 text-right font-mono tabular-nums">{it.stockQty}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: BULK PARTIES EXCEL IMPORT & EXPORT */}
      {tab === 'bulk_parties' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Bulk Parties Import &amp; Export in Excel (.xlsx)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Download sample Excel format, export all {db.parties.length} customers &amp; suppliers, or upload an Excel file to bulk import parties.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadPartyTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                Download Sample Excel
              </button>
              <button
                type="button"
                onClick={exportPartiesExcel}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Export All Parties (.xlsx)
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center space-y-2">
              <Upload className="w-7 h-7 text-indigo-600 mx-auto" />
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Upload Parties Excel Workbook (.xlsx, .xls, or .csv)
              </div>
              <p className="text-[11px] text-slate-500">
                Existing parties matching GSTIN or Name are updated cleanly; new parties are added to Sundry Debtors / Creditors.
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handlePartiesFileUpload}
                className="text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              {partiesFileName && (
                <div className="text-xs font-mono text-indigo-600 pt-1">Loaded: {partiesFileName}</div>
              )}
            </div>

            {partiesError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {partiesError}
              </div>
            )}
            {partiesMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{partiesMsg}</span>
              </div>
            )}

            {parsedParties.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Preview ({parsedParties.length} party rows ready to import)
                  </span>
                  <button
                    type="button"
                    disabled={partiesImporting}
                    onClick={handleConfirmImportParties}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    {partiesImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {partiesImporting ? 'Importing to SQLite...' : `Import ${parsedParties.length} Parties`}
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg max-h-96">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] text-slate-500 sticky top-0">
                      <tr>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5">Type</th>
                        <th className="p-2.5">Phone</th>
                        <th className="p-2.5">GSTIN</th>
                        <th className="p-2.5">State</th>
                        <th className="p-2.5 text-right">Opening Bal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {parsedParties.slice(0, 100).map((p, idx) => {
                        const isUpdate =
                          (p.gstin && existingPartyLookup.gstins.has(p.gstin.trim().toUpperCase())) ||
                          existingPartyLookup.names.has((p.name || '').trim().toLowerCase());
                        return (
                          <tr key={idx}>
                            <td className="p-2.5 font-semibold">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] ${
                                  isUpdate
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                }`}
                              >
                                {isUpdate ? 'Update' : 'New'}
                              </span>
                            </td>
                            <td className="p-2.5 font-medium">{p.name}</td>
                            <td className="p-2.5 capitalize">{p.type}</td>
                            <td className="p-2.5 font-mono">{p.phone || '-'}</td>
                            <td className="p-2.5 font-mono">{p.gstin || 'Unregistered'}</td>
                            <td className="p-2.5">{p.state}</td>
                            <td className="p-2.5 text-right font-mono tabular-nums">
                              {formatINR(p.openingBalance || 0)} ({p.openingType === 'payable' ? 'Cr' : 'Dr'})
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
