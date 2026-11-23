import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X, CheckCircle2, AlertTriangle, FileCheck2, Eye, Edit3, PackagePlus, Minus, UserPlus } from 'lucide-react';
import {
  JournalLine,
  Party,
  PaymentMode,
  SalesChannel,
  SettledInvoiceRef,
  Voucher,
  VoucherLine,
  VoucherType,
} from '../types/accounting';
import { useStore } from '../context/StoreContext';
import {
  addDaysISO,
  calculateVoucherLine,
  EXPENSE_CATEGORIES,
  formatINR,
  INDIAN_STATES,
  SALES_CHANNELS,
  todayISO,
  uid,
  VOUCHER_LABELS,
} from '../utils/formatters';
import { DEFAULT_APP_SETTINGS, mergeAppSettings } from '../utils/defaultAppSettings';
import { InvoiceRenderer } from './InvoiceRenderer';

interface VoucherEditorModalProps {
  initialType: VoucherType;
  editingVoucher?: Voucher | null;
  convertSourceVoucher?: Voucher | null;
  onClose: () => void;
  onMinimize?: () => void;
  onSaved?: (saved: Voucher) => void;
}

const ITEM_VOUCHER_TYPES: VoucherType[] = [
  'sale_invoice',
  'estimate',
  'proforma',
  'sale_order',
  'delivery_challan',
  'credit_note',
  'purchase_bill',
  'purchase_order',
  'debit_note',
];

const FALLBACK_LEDGERS = [
  { name: 'Depreciation Expense', groupName: 'Indirect Expenses' },
  { name: 'Warehouse Fixtures & Racks', groupName: 'Fixed Assets' },
  { name: 'Interest on Business Loan', groupName: 'Indirect Expenses' },
  { name: 'TDS Receivable', groupName: 'Current Assets' },
  { name: 'TDS Payable', groupName: 'Current Liabilities' },
  { name: 'Owner Capital Account', groupName: 'Capital Account' },
  { name: 'Sales Account', groupName: 'Sales Accounts' },
  { name: 'Purchase Account', groupName: 'Purchase Accounts' },
];

export const VoucherEditorModal: React.FC<VoucherEditorModalProps> = ({
  initialType,
  editingVoucher,
  convertSourceVoucher,
  onClose,
  onMinimize,
  onSaved,
}) => {
  const {
    db,
    getNextVoucherNo,
    getPartyBalance,
    getPendingInvoicesForParty,
    saveVoucher,
    saveParty,
    dispatchAutoTransactionMessage,
  } = useStore();

  const parties = db?.parties || [];
  const items = db?.items || [];
  const bankAccounts = db?.bankAccounts || [];
  const profileState = db?.profile.state || 'Maharashtra';
  const ledgerList = useMemo(() => {
    const dynamic = (db?.ledgers || []).map((l) => ({ name: l.name, groupName: l.groupName }));
    const seen = new Set(dynamic.map((d) => d.name));
    for (const f of FALLBACK_LEDGERS) {
      if (!seen.has(f.name)) dynamic.push(f);
    }
    return dynamic;
  }, [db?.ledgers]);

  const vType: VoucherType = editingVoucher?.type || initialType;
  const isItemVoucher = ITEM_VOUCHER_TYPES.includes(vType);
  const isPurchaseSide =
    vType === 'purchase_bill' || vType === 'purchase_order' || vType === 'debit_note' || vType === 'payment_out';

  const source = editingVoucher || convertSourceVoucher;

  const [voucherNo, setVoucherNo] = useState<string>(
    editingVoucher?.voucherNo || getNextVoucherNo(vType)
  );
  const [date, setDate] = useState<string>(editingVoucher?.date || todayISO());
  const [dueDate, setDueDate] = useState<string>(
    editingVoucher?.dueDate || addDaysISO(todayISO(), 30)
  );
  const [partyId, setPartyId] = useState<string>(
    source?.partyId ||
      (isPurchaseSide
        ? parties.find((p) => p.type === 'supplier' || p.type === 'both')?.id || parties[0]?.id || ''
        : parties.find((p) => p.type === 'customer' || p.type === 'both')?.id || parties[0]?.id || '')
  );

  const selectedParty = parties.find((p) => p.id === partyId);
  const [partyNameInput, setPartyNameInput] = useState<string>(
    source?.partyName || selectedParty?.name || ''
  );
  const [partyPhoneInput, setPartyPhoneInput] = useState<string>(
    selectedParty?.phone || ''
  );
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(
    source?.placeOfSupply || selectedParty?.state || profileState
  );

  const isInterState = placeOfSupply !== profileState;

  const appSettings = useMemo(
    () => mergeAppSettings(db?.profile.appSettings || DEFAULT_APP_SETTINGS),
    [db?.profile.appSettings]
  );
  const itemSet = appSettings.item;
  const txnSet = appSettings.transaction;

  const [rawLines, setRawLines] = useState<
    {
      id: string;
      itemId: string;
      itemName: string;
      hsn: string;
      qty: number;
      unit: string;
      rate: number;
      discountPct: number;
      taxRate: number;
      cessRate: number;
      taxInclusive: boolean;
      batchNo?: string;
      description?: string;
      mrp?: number;
      serialNo?: string;
      mfgDate?: string;
      expDate?: string;
      modelNo?: string;
      size?: string;
      customValues?: Record<string, string>;
      isNewItem?: boolean;
      newSalePrice?: number;
      newCategory?: string;
    }[]
  >(() => {
    if (source && source.lines.length > 0) {
      return source.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        itemName: l.itemName,
        hsn: l.hsn,
        qty: l.qty,
        unit: l.unit,
        rate: l.rate,
        discountPct: l.discountPct,
        taxRate: l.taxRate,
        cessRate: l.cessRate || 0,
        taxInclusive: false,
        batchNo: l.batchNo,
        description: l.description || '',
        mrp: l.mrp,
        serialNo: l.serialNo || '',
        mfgDate: l.mfgDate || '',
        expDate: l.expDate || '',
        modelNo: l.modelNo || '',
        size: l.size || '',
        customValues: l.customValues || {},
      }));
    }
    const firstItem = items[0];
    return firstItem
      ? [
          {
            id: `ln_${Date.now()}`,
            itemId: firstItem.id,
            itemName: firstItem.name,
            hsn: firstItem.hsn,
            qty: 1,
            unit: firstItem.unit || itemSet.defaultUnit || 'PCS',
            rate: isPurchaseSide ? firstItem.purchasePrice : firstItem.salePrice,
            discountPct: 0,
            taxRate: firstItem.taxRate,
            cessRate: firstItem.cessRate,
            taxInclusive: firstItem.taxInclusive,
            description: '',
            mrp: firstItem.mrp || firstItem.salePrice,
            batchNo: firstItem.batches[0]?.batchNo || '',
            mfgDate: firstItem.batches[0]?.mfgDate || '',
            expDate: firstItem.batches[0]?.expiryDate || '',
            serialNo: '',
            modelNo: '',
            size: '',
            customValues: {},
          },
        ]
      : [];
  });

  const [additionalCharges, setAdditionalCharges] = useState<number>(
    source?.additionalCharges || 0
  );
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    editingVoucher?.paymentMode || 'Bank Transfer'
  );
  const [bankAccountId, setBankAccountId] = useState<string>(
    editingVoucher?.bankAccountId ||
      bankAccounts.find((b) => b.type === 'bank')?.id ||
      bankAccounts[0]?.id ||
      ''
  );
  const [paidAmount, setPaidAmount] = useState<number>(
    editingVoucher ? editingVoucher.paidAmount : 0
  );
  const [simpleAmount, setSimpleAmount] = useState<number>(
    editingVoucher ? editingVoucher.grandTotal : 0
  );
  const [expenseCategory, setExpenseCategory] = useState<string>(
    editingVoucher?.expenseCategory || EXPENSE_CATEGORIES[0]
  );
  const [contraFromId, setContraFromId] = useState<string>(
    editingVoucher?.contraFromId || bankAccounts[0]?.id || ''
  );
  const [contraToId, setContraToId] = useState<string>(
    editingVoucher?.contraToId || bankAccounts[1]?.id || bankAccounts[0]?.id || ''
  );
  const [vehicleNo, setVehicleNo] = useState<string>(source?.vehicleNo || '');
  const [ewayBillNo, setEwayBillNo] = useState<string>(editingVoucher?.ewayBillNo || '');
  const [irn, setIrn] = useState<string>(editingVoucher?.irn || '');
  const [isReverseCharge, setIsReverseCharge] = useState<boolean>(
    Boolean(editingVoucher?.isReverseCharge)
  );
  const [isRecurring, setIsRecurring] = useState<boolean>(
    Boolean(editingVoucher?.isRecurring)
  );
  const [recurringInterval, setRecurringInterval] = useState<'Monthly' | 'Quarterly' | 'Yearly'>(
    editingVoucher?.recurringInterval || 'Monthly'
  );
  const [salesChannel, setSalesChannel] = useState<SalesChannel>(
    editingVoucher?.salesChannel || 'Direct B2B'
  );
  const [currency, setCurrency] = useState<string>(
    editingVoucher?.currency || db?.profile.baseCurrency || 'INR'
  );
  const [costCentreId, setCostCentreId] = useState<string>(
    editingVoucher?.costCentreId || ''
  );
  const [projectId, setProjectId] = useState<string>(
    editingVoucher?.projectId || ''
  );
  const [salesRepName, setSalesRepName] = useState<string>(
    editingVoucher?.salesRepName || ''
  );
  const [freightCost, setFreightCost] = useState<number>(
    editingVoucher?.freightCost || 0
  );
  const [insuranceCost, setInsuranceCost] = useState<number>(
    editingVoucher?.insuranceCost || 0
  );
  const [customsCost, setCustomsCost] = useState<number>(
    editingVoucher?.customsCost || 0
  );
  const [notes, setNotes] = useState<string>(source?.notes || '');

  const [settledInvoices, setSettledInvoices] = useState<SettledInvoiceRef[]>(
    editingVoucher?.settledInvoices || []
  );

  const [journalLines, setJournalLines] = useState<JournalLine[]>(
    editingVoucher?.journalLines || [
      { id: 'jl_1', accountName: ledgerList[0]?.name || 'Depreciation Expense', accountGroup: ledgerList[0]?.groupName || 'Indirect Expenses', debit: 1000, credit: 0, narration: '' },
      { id: 'jl_2', accountName: ledgerList[1]?.name || 'Warehouse Fixtures & Racks', accountGroup: ledgerList[1]?.groupName || 'Fixed Assets', debit: 0, credit: 1000, narration: '' },
    ]
  );

  const [errorMsg, setErrorMsg] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const computedLines: VoucherLine[] = useMemo(
    () =>
      rawLines.map((rl) =>
        calculateVoucherLine({
          ...rl,
          discountPct: itemSet.itemWiseDiscount ? rl.discountPct : 0,
          taxRate: itemSet.itemWiseTax ? rl.taxRate : 0,
          taxOnMrp: itemSet.enableMrp && itemSet.taxOnMrp,
          isInterState,
          newItemMeta:
            rl.isNewItem && vType === 'purchase_bill'
              ? {
                  salePrice: rl.newSalePrice || Math.round(rl.rate * 1.2),
                  mrp: rl.mrp || rl.newSalePrice || Math.round(rl.rate * 1.25),
                  category: rl.newCategory || 'General',
                }
              : undefined,
        })
      ),
    [rawLines, isInterState, itemSet.itemWiseDiscount, itemSet.itemWiseTax, itemSet.enableMrp, itemSet.taxOnMrp, vType]
  );

  const subTotal = Number(computedLines.reduce((s, l) => s + l.taxableAmount, 0).toFixed(2));
  const taxTotal = Number(
    computedLines.reduce((s, l) => s + l.cgst + l.sgst + l.igst + l.cess, 0).toFixed(2)
  );
  const discountTotal = Number(
    computedLines.reduce((s, l) => s + (l.qty * l.rate * l.discountPct) / 100, 0).toFixed(2)
  );
  const exactTotal = subTotal + taxTotal + Number(additionalCharges || 0);
  const grandTotal = Math.round(exactTotal);
  const roundOff = Number((grandTotal - exactTotal).toFixed(2));

  const pendingBills = useMemo(() => {
    if ((vType !== 'payment_in' && vType !== 'payment_out') || !partyId) return [];
    return getPendingInvoicesForParty(partyId, vType === 'payment_in' ? 'receivable' : 'payable');
  }, [vType, partyId, getPendingInvoicesForParty]);

  const journalTotals = useMemo(() => {
    const dr = journalLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = journalLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { dr, cr, balanced: Math.abs(dr - cr) < 0.01 && dr > 0 };
  }, [journalLines]);

  if (!db) return null;

  const selectedCurrencyRate =
    db.currencyRates?.find((r) => r.code === currency)?.rateToInr || 1;
  const partyCurrentBal = partyId ? getPartyBalance(partyId) : 0;
  const creditLimitExceeded =
    vType === 'sale_invoice' &&
    Boolean(selectedParty) &&
    (selectedParty?.creditLimit || 0) > 0 &&
    partyCurrentBal + Math.max(0, grandTotal - (Number(paidAmount) || 0)) >
      (selectedParty?.creditLimit || 0);
  const partyOnHold = vType === 'sale_invoice' && Boolean(selectedParty?.creditHold);

  const handlePartyChange = (nextPartyId: string) => {
    setPartyId(nextPartyId);
    const p = db.parties.find((x) => x.id === nextPartyId);
    if (p) {
      setPlaceOfSupply(p.state);
      setPartyNameInput(p.name);
      setPartyPhoneInput(p.phone || '');
    } else {
      setPartyNameInput('');
      setPartyPhoneInput('');
    }
    setSettledInvoices([]);
  };

  const resolveOrCreateParty = async (): Promise<Party | undefined> => {
    const cleanName = partyNameInput.trim();
    const cleanPhone = partyPhoneInput.trim();
    const cleanDigits = cleanPhone.replace(/\D/g, '').slice(-10);

    // If a stored party is selected
    if (partyId && selectedParty) {
      const nameChanged = cleanName && cleanName !== selectedParty.name;
      const phoneChanged = cleanPhone && cleanPhone !== selectedParty.phone;
      if (nameChanged || phoneChanged) {
        // Check if user typed a completely different person's name while dropdown was on another party
        if (nameChanged) {
          const existingMatch = db.parties.find(
            (p) =>
              p.name.trim().toLowerCase() === cleanName.toLowerCase() ||
              (cleanDigits.length >= 10 && p.phone.replace(/\D/g, '').slice(-10) === cleanDigits)
          );
          if (existingMatch) {
            if (cleanPhone && cleanPhone !== existingMatch.phone) {
              return await saveParty({ ...existingMatch, phone: cleanPhone });
            }
            return existingMatch;
          }
          // Create brand new party because user typed a new name right inside the invoice form
          const created = await saveParty({
            id: uid('pty'),
            name: cleanName,
            type: isPurchaseSide ? 'supplier' : 'customer',
            phone: cleanPhone,
            email: '',
            gstin: '',
            pan: '',
            state: placeOfSupply || profileState,
            billingAddress: '',
            shippingAddress: '',
            openingBalance: 0,
            openingType: isPurchaseSide ? 'payable' : 'receivable',
            creditLimit: 0,
            creditDays: 30,
            group: isPurchaseSide ? 'Suppliers' : 'Sundry Debtors',
            createdAt: new Date().toISOString(),
          });
          return created;
        }
        if (phoneChanged) {
          return await saveParty({ ...selectedParty, phone: cleanPhone });
        }
      }
      return selectedParty;
    }

    // No dropdown party selected ("Walk-in / Quick Entry")
    if (!cleanName && cleanDigits.length < 10) {
      return undefined;
    }

    const existing = db.parties.find(
      (p) =>
        (cleanName && p.name.trim().toLowerCase() === cleanName.toLowerCase()) ||
        (cleanDigits.length >= 10 && p.phone.replace(/\D/g, '').slice(-10) === cleanDigits)
    );
    if (existing) {
      if (cleanPhone && !existing.phone) {
        return await saveParty({ ...existing, phone: cleanPhone });
      }
      return existing;
    }

    return await saveParty({
      id: uid('pty'),
      name: cleanName || `Customer ${cleanDigits}`,
      type: isPurchaseSide ? 'supplier' : 'customer',
      phone: cleanPhone,
      email: '',
      gstin: '',
      pan: '',
      state: placeOfSupply || profileState,
      billingAddress: '',
      shippingAddress: '',
      openingBalance: 0,
      openingType: isPurchaseSide ? 'payable' : 'receivable',
      creditLimit: 0,
      creditDays: 30,
      group: isPurchaseSide ? 'Suppliers' : 'Sundry Debtors',
      createdAt: new Date().toISOString(),
    });
  };

  const handleLineItemChange = (lineId: string, itemId: string) => {
    if (itemId === '__CREATE_NEW__') {
      setRawLines((prev) =>
        prev.map((l) =>
          l.id === lineId
            ? {
                ...l,
                isNewItem: true,
                itemId: `new_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                itemName: '',
                hsn: '8544',
                unit: itemSet.defaultUnit || 'PCS',
                rate: 0,
                mrp: 0,
                newSalePrice: 0,
                newCategory: 'General',
              }
            : l
        )
      );
      return;
    }
    const item = db.items.find((i) => i.id === itemId);
    if (!item) return;
    setRawLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? {
              ...l,
              isNewItem: false,
              itemId: item.id,
              itemName: item.name,
              hsn: item.hsn,
              unit: item.unit,
              rate: isPurchaseSide ? item.purchasePrice : item.salePrice,
              taxRate: item.taxRate,
              cessRate: item.cessRate,
              taxInclusive: item.taxInclusive,
              description: '',
              mrp: item.mrp || item.salePrice,
              batchNo: item.batches[0]?.batchNo || '',
              mfgDate: item.batches[0]?.mfgDate || '',
              expDate: item.batches[0]?.expiryDate || '',
            }
          : l
      )
    );
  };

  const toggleSettleInvoice = (invId: string, invNo: string, dueAmt: number) => {
    setSettledInvoices((prev) => {
      const exists = prev.find((s) => s.voucherId === invId);
      let next: SettledInvoiceRef[];
      if (exists) {
        next = prev.filter((s) => s.voucherId !== invId);
      } else {
        next = [...prev, { voucherId: invId, voucherNo: invNo, amount: dueAmt }];
      }
      const sum = next.reduce((s, x) => s + x.amount, 0);
      setSimpleAmount(Number(sum.toFixed(2)));
      return next;
    });
  };

  const handleGenerateComplianceIds = () => {
    if (!ewayBillNo) {
      setEwayBillNo(`EWB-${Math.floor(100000000000 + Math.random() * 899999999999)}`);
    }
    if (!irn) {
      const chars = 'abcdef0123456789';
      let gen = '';
      for (let i = 0; i < 40; i++) gen += chars[Math.floor(Math.random() * chars.length)];
      setIrn(gen);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setErrorMsg('');
    setSaving(true);

    try {
      if (isItemVoucher) {
        if (computedLines.length === 0) {
          setErrorMsg('Please add at least one item line (or create an item in Inventory first).');
          setSaving(false);
          return;
        }
        const effPaid =
          vType === 'estimate' ||
          vType === 'proforma' ||
          vType === 'sale_order' ||
          vType === 'delivery_challan' ||
          vType === 'purchase_order'
            ? 0
            : Math.min(grandTotal, Math.max(0, Number(paidAmount) || 0));

        const status =
          vType === 'estimate' ||
          vType === 'proforma' ||
          vType === 'sale_order' ||
          vType === 'delivery_challan' ||
          vType === 'purchase_order'
            ? 'open'
            : effPaid >= grandTotal - 0.5
            ? 'paid'
            : effPaid > 0
            ? 'partial'
            : 'unpaid';

        const resolvedParty = await resolveOrCreateParty();
        const resolvedPartyId = resolvedParty?.id || partyId || undefined;
        const resolvedPartyName =
          resolvedParty?.name || partyNameInput.trim() || 'Walk-in Customer';

        const saved = await saveVoucher(
          {
            id: editingVoucher?.id || '',
            type: vType,
            voucherNo,
            date,
            dueDate,
            partyId: resolvedPartyId,
            partyName: resolvedPartyName,
            partyGstin: resolvedParty?.gstin || '',
            placeOfSupply,
            isInterState,
            lines: computedLines,
            additionalCharges: Number(additionalCharges) || 0,
            discountTotal,
            roundOff,
            subTotal,
            taxTotal,
            grandTotal,
            paidAmount: effPaid,
            paymentMode,
            bankAccountId: bankAccountId || undefined,
            status,
            ewayBillNo: ewayBillNo || undefined,
            vehicleNo: vehicleNo || undefined,
            irn: irn || undefined,
            isReverseCharge: vType === 'purchase_bill' ? isReverseCharge : false,
            isRecurring: vType === 'sale_invoice' ? isRecurring : false,
            recurringInterval: vType === 'sale_invoice' && isRecurring ? recurringInterval : undefined,
            salesChannel,
            currency,
            exchangeRate: selectedCurrencyRate,
            costCentreId: costCentreId || undefined,
            projectId: projectId || undefined,
            salesRepName: salesRepName || undefined,
            freightCost: vType === 'purchase_bill' ? Number(freightCost) || 0 : undefined,
            insuranceCost: vType === 'purchase_bill' ? Number(insuranceCost) || 0 : undefined,
            customsCost: vType === 'purchase_bill' ? Number(customsCost) || 0 : undefined,
            linkedVoucherId: convertSourceVoucher?.id,
            notes,
            createdAt: editingVoucher?.createdAt || new Date().toISOString(),
          },
          convertSourceVoucher ? { convertFromVoucherId: convertSourceVoucher.id } : undefined
        );
        void dispatchAutoTransactionMessage(saved, resolvedParty);
        onSaved?.(saved);
        onClose();
        return;
      }

      if (vType === 'payment_in' || vType === 'payment_out') {
        const resolvedParty = await resolveOrCreateParty();
        const effectivePartyId = resolvedParty?.id || partyId;
        if (!effectivePartyId || simpleAmount <= 0) {
          setErrorMsg('Please select or enter a party name/phone and a valid amount.');
          setSaving(false);
          return;
        }
        const saved = await saveVoucher({
          id: editingVoucher?.id || '',
          type: vType,
          voucherNo,
          date,
          partyId: effectivePartyId,
          partyName: resolvedParty?.name || partyNameInput.trim() || '',
          lines: [],
          additionalCharges: 0,
          discountTotal: 0,
          roundOff: 0,
          subTotal: simpleAmount,
          taxTotal: 0,
          grandTotal: simpleAmount,
          paidAmount: simpleAmount,
          paymentMode,
          bankAccountId: bankAccountId || undefined,
          settledInvoices,
          status: 'paid',
          notes,
          createdAt: editingVoucher?.createdAt || new Date().toISOString(),
        });
        void dispatchAutoTransactionMessage(saved, resolvedParty);
        onSaved?.(saved);
        onClose();
        return;
      }

      if (vType === 'expense') {
        if (simpleAmount <= 0) {
          setErrorMsg('Please enter an expense amount.');
          setSaving(false);
          return;
        }
        const saved = await saveVoucher({
          id: editingVoucher?.id || '',
          type: 'expense',
          voucherNo,
          date,
          expenseCategory,
          lines: [],
          additionalCharges: 0,
          discountTotal: 0,
          roundOff: 0,
          subTotal: simpleAmount,
          taxTotal: 0,
          grandTotal: simpleAmount,
          paidAmount: simpleAmount,
          paymentMode,
          bankAccountId: bankAccountId || undefined,
          status: 'paid',
          notes,
          createdAt: editingVoucher?.createdAt || new Date().toISOString(),
        });
        onSaved?.(saved);
        onClose();
        return;
      }

      if (vType === 'contra') {
        if (!contraFromId || !contraToId || contraFromId === contraToId || simpleAmount <= 0) {
          setErrorMsg('Select two different accounts and enter a valid transfer amount.');
          setSaving(false);
          return;
        }
        const saved = await saveVoucher({
          id: editingVoucher?.id || '',
          type: 'contra',
          voucherNo,
          date,
          contraFromId,
          contraToId,
          lines: [],
          additionalCharges: 0,
          discountTotal: 0,
          roundOff: 0,
          subTotal: simpleAmount,
          taxTotal: 0,
          grandTotal: simpleAmount,
          paidAmount: simpleAmount,
          paymentMode: 'Bank Transfer',
          status: 'paid',
          notes,
          createdAt: editingVoucher?.createdAt || new Date().toISOString(),
        });
        onSaved?.(saved);
        onClose();
        return;
      }

      if (vType === 'journal') {
        if (!journalTotals.balanced) {
          setErrorMsg('Total Debit must equal Total Credit and be greater than zero.');
          setSaving(false);
          return;
        }
        const saved = await saveVoucher({
          id: editingVoucher?.id || '',
          type: 'journal',
          voucherNo,
          date,
          lines: [],
          additionalCharges: 0,
          discountTotal: 0,
          roundOff: 0,
          subTotal: journalTotals.dr,
          taxTotal: 0,
          grandTotal: journalTotals.dr,
          paidAmount: journalTotals.dr,
          status: 'paid',
          journalLines,
          notes,
          createdAt: editingVoucher?.createdAt || new Date().toISOString(),
        });
        onSaved?.(saved);
        onClose();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save voucher.');
    } finally {
      setSaving(false);
    }
  };

  const buildPreviewVoucher = (): Voucher => {
    const effPaid = isItemVoucher
      ? vType === 'sale_invoice' || vType === 'purchase_bill'
        ? Math.min(grandTotal, Math.max(0, Number(paidAmount) || 0))
        : 0
      : simpleAmount;
    const totalAmt = isItemVoucher
      ? grandTotal
      : vType === 'journal'
      ? journalTotals.dr
      : simpleAmount;

    return {
      id: editingVoucher?.id || 'preview_draft',
      type: vType,
      voucherNo,
      date,
      dueDate,
      partyId: partyId || undefined,
      partyName: partyNameInput.trim() || selectedParty?.name || 'Walk-in Customer',
      partyGstin: selectedParty?.gstin || '',
      placeOfSupply,
      isInterState,
      lines: isItemVoucher ? computedLines : [],
      additionalCharges: isItemVoucher ? Number(additionalCharges) || 0 : 0,
      discountTotal: isItemVoucher ? discountTotal : 0,
      roundOff: isItemVoucher ? roundOff : 0,
      subTotal: isItemVoucher ? subTotal : totalAmt,
      taxTotal: isItemVoucher ? taxTotal : 0,
      grandTotal: totalAmt,
      paidAmount: effPaid,
      paymentMode,
      bankAccountId: bankAccountId || undefined,
      expenseCategory: vType === 'expense' ? expenseCategory : undefined,
      vehicleNo: vehicleNo || undefined,
      ewayBillNo: ewayBillNo || undefined,
      irn: irn || undefined,
      status: effPaid >= totalAmt - 0.5 ? 'paid' : effPaid > 0 ? 'partial' : 'unpaid',
      notes: notes || (vType === 'journal' ? 'Journal Voucher Draft' : ''),
      createdAt: new Date().toISOString(),
    };
  };

  const hasExtraItemMeta =
    itemSet.description ||
    itemSet.enableSerialNo ||
    itemSet.enableBatchNo ||
    itemSet.enableMfgDate ||
    itemSet.enableExpDate ||
    itemSet.enableModelNo ||
    itemSet.enableSize ||
    itemSet.customFields.length > 0;

  const previewBank =
    db.bankAccounts.find((b) => b.id === bankAccountId) ||
    db.bankAccounts.find((b) => b.type === 'bank') ||
    db.bankAccounts[0];

  const previewParty: Party | undefined = selectedParty
    ? {
        ...selectedParty,
        name: partyNameInput.trim() || selectedParty.name,
        phone: partyPhoneInput.trim() || selectedParty.phone,
      }
    : partyNameInput.trim()
    ? {
        id: 'preview_party',
        name: partyNameInput.trim(),
        type: isPurchaseSide ? 'supplier' : 'customer',
        phone: partyPhoneInput.trim(),
        email: '',
        gstin: '',
        pan: '',
        state: placeOfSupply,
        billingAddress: '',
        shippingAddress: '',
        openingBalance: 0,
        openingType: isPurchaseSide ? 'payable' : 'receivable',
        creditLimit: 0,
        creditDays: 30,
        group: isPurchaseSide ? 'Suppliers' : 'Sundry Debtors',
        createdAt: new Date().toISOString(),
      }
    : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-slate-900 flex flex-col w-screen h-screen">
      <div className="w-full h-full flex flex-col">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-[#116B68] text-white shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">
              {editingVoucher ? 'Edit' : convertSourceVoucher ? 'Convert to' : 'New'} {VOUCHER_LABELS[vType]}
            </h2>
            <p className="text-xs text-teal-100">
              {convertSourceVoucher
                ? `Converting from ${convertSourceVoucher.voucherNo}`
                : 'Auto-posts double-entry Dr/Cr journals, stock movements & GST registers'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                showPreview
                  ? 'bg-white text-[#116B68] border-white'
                  : 'border-white/30 text-white bg-white/10 hover:bg-white/20'
              }`}
            >
              {showPreview ? <Edit3 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPreview ? 'Back to Edit' : 'Live Preview'}
            </button>
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                title="Minimize Invoice Draft"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-white/30 text-white bg-white/10 hover:bg-white/20"
              >
                <Minus className="w-3.5 h-3.5" />
                Minimize
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close Invoice Editor"
              className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/15"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showPreview ? (
          <div className="flex-1 overflow-y-auto p-6 bg-[#F3F5F7] dark:bg-slate-950 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <span className="font-semibold text-[#243746] dark:text-slate-200">
                Live Format Preview ({db.profile.invoiceConfig.templateId.replace(/_/g, ' ').toUpperCase()} · {db.profile.language === 'hi' ? 'Hindi' : 'English'})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                >
                  Edit Voucher
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const fakeEvt = { preventDefault: () => {} } as React.FormEvent;
                    void handleSubmit(fakeEvt);
                  }}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white font-semibold"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : `Save ${VOUCHER_LABELS[vType]}`}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto pb-4">
              <InvoiceRenderer
                voucher={buildPreviewVoucher()}
                profile={db.profile}
                party={previewParty}
                bank={previewBank}
                effectivePaid={
                  isItemVoucher
                    ? vType === 'sale_invoice' || vType === 'purchase_bill'
                      ? Math.min(grandTotal, Math.max(0, Number(paidAmount) || 0))
                      : 0
                    : simpleAmount
                }
                elementId="voucher-draft-preview"
              />
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {(partyOnHold || creditLimitExceeded) && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>
                {partyOnHold
                  ? `Credit Hold Active on ${selectedParty?.name}: Review outstanding balance (${formatINR(partyCurrentBal)}) before releasing stock.`
                  : `Credit Limit Alert: New balance (${formatINR(partyCurrentBal + Math.max(0, grandTotal - (Number(paidAmount) || 0)))}) exceeds ${selectedParty?.name}'s limit of ${formatINR(selectedParty?.creditLimit || 0)}.`}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Voucher No
              </label>
              <input
                type="text"
                required
                value={voucherNo}
                onChange={(e) => setVoucherNo(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Date
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            {isItemVoucher && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {isPurchaseSide ? 'Existing Supplier / Party' : 'Existing Customer / Party'}
                  </label>
                  <select
                    value={partyId}
                    onChange={(e) => handlePartyChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">+ New / Walk-in Party (Enter Below)</option>
                    {db.parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.state})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Place of Supply ({isInterState ? 'IGST' : 'CGST + SGST'})
                  </label>
                  <select
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {INDIAN_STATES.map((s) => (
                      <option key={s.code} value={s.name}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Inline Customer / Party Name & Phone (Auto-adds to Parties on Save) */}
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-[#116B68] dark:text-teal-300 mb-1">
                    <UserPlus className="w-3.5 h-3.5" />
                    {isPurchaseSide ? 'Supplier Name (Auto-adds to Parties)' : 'Customer / Party Name (Auto-adds to Parties)'}
                  </label>
                  <input
                    type="text"
                    value={partyNameInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPartyNameInput(val);
                      if (partyId && selectedParty && val.trim() !== selectedParty.name) {
                        // keep editable; resolveOrCreateParty handles updating/creating cleanly
                      }
                    }}
                    placeholder="Type customer or supplier name..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-teal-200 dark:border-teal-800 bg-[#E5EFF3]/40 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#116B68] dark:text-teal-300 mb-1">
                    Customer / Party Phone Number (For Party Master &amp; WhatsApp)
                  </label>
                  <input
                    type="tel"
                    value={partyPhoneInput}
                    onChange={(e) => setPartyPhoneInput(e.target.value)}
                    placeholder="10-digit WhatsApp / Mobile number..."
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-teal-200 dark:border-teal-800 bg-[#E5EFF3]/40 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </>
            )}
          </div>

          {isItemVoucher && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Line Items &amp; GST Calculation
                  </h3>
                  {vType === 'purchase_bill' && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      Tip: Adding a new item in Purchase Bill automatically creates it in Inventory with purchased stock.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {vType === 'purchase_bill' && (
                    <button
                      type="button"
                      onClick={() => {
                        setRawLines((prev) => [
                          ...prev,
                          {
                            id: `ln_${Date.now()}_${prev.length}`,
                            itemId: `new_${Date.now()}_${prev.length}`,
                            isNewItem: true,
                            itemName: '',
                            hsn: '8544',
                            qty: 1,
                            unit: itemSet.defaultUnit || 'PCS',
                            rate: 0,
                            mrp: 0,
                            newSalePrice: 0,
                            newCategory: 'General',
                            discountPct: 0,
                            taxRate: 18,
                            cessRate: 0,
                            taxInclusive: false,
                            description: '',
                            serialNo: '',
                            batchNo: '',
                            mfgDate: '',
                            expDate: '',
                            modelNo: '',
                            size: '',
                            customValues: {},
                          },
                        ]);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      + New Purchase Item (Auto Inventory)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const fallback = db.items[0];
                      setRawLines((prev) => [
                        ...prev,
                        fallback
                          ? {
                              id: `ln_${Date.now()}_${prev.length}`,
                              itemId: fallback.id,
                              itemName: fallback.name,
                              hsn: fallback.hsn,
                              qty: 1,
                              unit: fallback.unit || itemSet.defaultUnit || 'PCS',
                              rate: isPurchaseSide ? fallback.purchasePrice : fallback.salePrice,
                              discountPct: 0,
                              taxRate: fallback.taxRate,
                              cessRate: fallback.cessRate,
                              taxInclusive: fallback.taxInclusive,
                              description: '',
                              mrp: fallback.mrp || fallback.salePrice,
                              batchNo: fallback.batches[0]?.batchNo || '',
                              mfgDate: fallback.batches[0]?.mfgDate || '',
                              expDate: fallback.batches[0]?.expiryDate || '',
                              serialNo: '',
                              modelNo: '',
                              size: '',
                              customValues: {},
                            }
                          : {
                              id: `ln_${Date.now()}_${prev.length}`,
                              itemId: `new_${Date.now()}_${prev.length}`,
                              isNewItem: vType === 'purchase_bill',
                              itemName: '',
                              hsn: '8544',
                              qty: 1,
                              unit: itemSet.defaultUnit || 'PCS',
                              rate: 0,
                              mrp: 0,
                              newSalePrice: 0,
                              discountPct: 0,
                              taxRate: 18,
                              cessRate: 0,
                              taxInclusive: false,
                            },
                      ]);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Row
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                      <th className="py-2.5 px-3 text-left min-w-[200px]">Item / Service</th>
                      <th className="py-2.5 px-2 text-left w-20">HSN</th>
                      <th className="py-2.5 px-2 text-right w-20">Qty</th>
                      {itemSet.itemsUnit && <th className="py-2.5 px-2 text-left w-16">Unit</th>}
                      {itemSet.enableMrp && <th className="py-2.5 px-2 text-right w-20">{itemSet.mrpLabel || 'MRP'}</th>}
                      <th className="py-2.5 px-2 text-right w-24">Rate (₹)</th>
                      {itemSet.itemWiseDiscount && <th className="py-2.5 px-2 text-right w-16">Disc%</th>}
                      {itemSet.itemWiseTax && <th className="py-2.5 px-2 text-right w-20">GST%</th>}
                      <th className="py-2.5 px-3 text-right w-28">Total (₹)</th>
                      <th className="py-2.5 px-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawLines.map((rl, idx) => {
                      const calc = computedLines[idx];
                      return (
                        <React.Fragment key={rl.id}>
                          <tr className="border-b border-slate-100 dark:border-slate-800/80 last:border-0">
                            <td className="p-2">
                              {rl.isNewItem && vType === 'purchase_bill' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      required
                                      placeholder="Enter new item name..."
                                      value={rl.itemName}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, itemName: e.target.value } : x))
                                        )
                                      }
                                      className="flex-1 px-2 py-1.5 rounded border border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20 text-slate-900 dark:text-white font-medium"
                                    />
                                    {db.items.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => handleLineItemChange(rl.id, db.items[0].id)}
                                        className="px-1.5 py-1 text-[10px] rounded border border-slate-300 text-slate-600"
                                        title="Switch back to existing catalog item"
                                      >
                                        Catalog
                                      </button>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                                    <input
                                      type="number"
                                      min="0"
                                      placeholder="Sale Price (₹)"
                                      value={rl.newSalePrice || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) =>
                                            x.id === rl.id ? { ...x, newSalePrice: Number(e.target.value) } : x
                                          )
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Category"
                                      value={rl.newCategory || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) =>
                                            x.id === rl.id ? { ...x, newCategory: e.target.value } : x
                                          )
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <select
                                  value={rl.itemId}
                                  onChange={(e) => handleLineItemChange(rl.id, e.target.value)}
                                  className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                >
                                  {db.items.map((it) => (
                                    <option key={it.id} value={it.id}>
                                      {it.name} {it.type === 'product' ? `(Stk: ${it.stockQty})` : '(Service)'}
                                    </option>
                                  ))}
                                  {vType === 'purchase_bill' && !txnSet.quickEntry && !appSettings.general.blockNewItemsFromTxn && (
                                    <option value="__CREATE_NEW__">+ Create &amp; Add New Item to Inventory...</option>
                                  )}
                                </select>
                              )}
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={rl.hsn}
                                onChange={(e) =>
                                  setRawLines((prev) =>
                                    prev.map((x) => (x.id === rl.id ? { ...x, hsn: e.target.value } : x))
                                  )
                                }
                                className="w-full px-2 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                value={rl.qty}
                                onChange={(e) =>
                                  setRawLines((prev) =>
                                    prev.map((x) =>
                                      x.id === rl.id ? { ...x, qty: Number(e.target.value) } : x
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              />
                            </td>
                            {itemSet.itemsUnit && (
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={rl.unit}
                                  onChange={(e) =>
                                    setRawLines((prev) =>
                                      prev.map((x) =>
                                        x.id === rl.id ? { ...x, unit: e.target.value.toUpperCase() } : x
                                      )
                                    )
                                  }
                                  className="w-full px-1.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                />
                              </td>
                            )}
                            {itemSet.enableMrp && (
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={rl.mrp ?? 0}
                                  onChange={(e) =>
                                    setRawLines((prev) =>
                                      prev.map((x) =>
                                        x.id === rl.id ? { ...x, mrp: Number(e.target.value) } : x
                                      )
                                    )
                                  }
                                  className="w-full px-2 py-1.5 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                />
                              </td>
                            )}
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={rl.rate}
                                onChange={(e) =>
                                  setRawLines((prev) =>
                                    prev.map((x) =>
                                      x.id === rl.id ? { ...x, rate: Number(e.target.value) } : x
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              />
                            </td>
                            {itemSet.itemWiseDiscount && (
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="any"
                                  value={rl.discountPct}
                                  onChange={(e) =>
                                    setRawLines((prev) =>
                                      prev.map((x) =>
                                        x.id === rl.id ? { ...x, discountPct: Number(e.target.value) } : x
                                      )
                                    )
                                  }
                                  className="w-full px-2 py-1.5 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                />
                              </td>
                            )}
                            {itemSet.itemWiseTax && (
                              <td className="p-2">
                                <select
                                  value={rl.taxRate}
                                  onChange={(e) =>
                                    setRawLines((prev) =>
                                      prev.map((x) =>
                                        x.id === rl.id ? { ...x, taxRate: Number(e.target.value) } : x
                                      )
                                    )
                                  }
                                  className="w-full px-2 py-1.5 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                >
                                  {[0, 5, 12, 18, 28].map((r) => (
                                    <option key={r} value={r}>
                                      {r}%
                                    </option>
                                  ))}
                                </select>
                              </td>
                            )}
                            <td className="p-2 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                              {formatINR(calc?.total || 0)}
                            </td>
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                disabled={rawLines.length === 1}
                                onClick={() =>
                                  setRawLines((prev) => prev.filter((x) => x.id !== rl.id))
                                }
                                className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>

                          {hasExtraItemMeta && (
                            <tr className="bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-800">
                              <td colSpan={10} className="px-3 py-2">
                                <div className="flex flex-wrap gap-2 text-[11px]">
                                  {itemSet.description && (
                                    <input
                                      type="text"
                                      placeholder="Item Description"
                                      value={rl.description || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, description: e.target.value } : x))
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 min-w-[160px] flex-1"
                                    />
                                  )}
                                  {itemSet.enableBatchNo && (
                                    <input
                                      type="text"
                                      placeholder={itemSet.batchLabel || 'Batch No.'}
                                      value={rl.batchNo || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, batchNo: e.target.value } : x))
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-28 font-mono"
                                    />
                                  )}
                                  {itemSet.enableSerialNo && (
                                    <input
                                      type="text"
                                      placeholder={itemSet.serialLabel || 'Serial / IMEI'}
                                      value={rl.serialNo || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, serialNo: e.target.value } : x))
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-32 font-mono"
                                    />
                                  )}
                                  {itemSet.enableMfgDate && (
                                    <input
                                      type="text"
                                      placeholder={`Mfg (${itemSet.mfgFormat || 'MM/YYYY'})`}
                                      value={rl.mfgDate || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, mfgDate: e.target.value } : x))
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-28 font-mono"
                                    />
                                  )}
                                  {itemSet.enableExpDate && (
                                    <input
                                      type="text"
                                      placeholder={`Exp (${itemSet.expFormat || 'MM/YYYY'})`}
                                      value={rl.expDate || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, expDate: e.target.value } : x))
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-28 font-mono"
                                    />
                                  )}
                                  {itemSet.enableModelNo && (
                                    <input
                                      type="text"
                                      placeholder="Model No."
                                      value={rl.modelNo || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, modelNo: e.target.value } : x))
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-28"
                                    />
                                  )}
                                  {itemSet.enableSize && (
                                    <input
                                      type="text"
                                      placeholder="Size"
                                      value={rl.size || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) => (x.id === rl.id ? { ...x, size: e.target.value } : x))
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-24"
                                    />
                                  )}
                                  {itemSet.customFields.map((cf) => (
                                    <input
                                      key={cf}
                                      type="text"
                                      placeholder={cf}
                                      value={rl.customValues?.[cf] || ''}
                                      onChange={(e) =>
                                        setRawLines((prev) =>
                                          prev.map((x) =>
                                            x.id === rl.id
                                              ? {
                                                  ...x,
                                                  customValues: {
                                                    ...(x.customValues || {}),
                                                    [cf]: e.target.value,
                                                  },
                                                }
                                              : x
                                          )
                                        )
                                      }
                                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-28"
                                    />
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                <div className="lg:col-span-7 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Due / Valid Till Date
                      </label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Freight / Additional (₹)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={additionalCharges}
                        onChange={(e) => setAdditionalCharges(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Vehicle / Transport No
                      </label>
                      <input
                        type="text"
                        placeholder="MH-02-AB-1234"
                        value={vehicleNo}
                        onChange={(e) => setVehicleNo(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  {(vType === 'sale_invoice' || vType === 'purchase_bill') && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          {isPurchaseSide ? 'Paid Amount (₹)' : 'Received Amount (₹)'}
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={paidAmount}
                            onChange={(e) => setPaidAmount(Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setPaidAmount(grandTotal)}
                            className="px-2 py-1 text-[11px] font-medium rounded border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 whitespace-nowrap"
                          >
                            Full
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Payment Mode
                        </label>
                        <select
                          value={paymentMode}
                          onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        >
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                          <option value="Cheque">Cheque</option>
                          <option value="Card">Card</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Deposit / Pay Account
                        </label>
                        <select
                          value={bankAccountId}
                          onChange={(e) => setBankAccountId(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        >
                          {db.bankAccounts.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.bankName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {vType === 'sale_invoice' && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                        <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                          {ewayBillNo ? `EWB: ${ewayBillNo}` : 'No E-Way Bill'} ·{' '}
                          {irn ? `IRN: ${irn.slice(0, 14)}...` : 'No E-Invoice IRN'}
                        </div>
                        <button
                          type="button"
                          onClick={handleGenerateComplianceIds}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                        >
                          <FileCheck2 className="w-3.5 h-3.5 text-indigo-600" />
                          Generate E-Way & IRN
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                        <label className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isRecurring}
                            onChange={(e) => setIsRecurring(e.target.checked)}
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          Enable Recurring Billing Schedule
                        </label>
                        {isRecurring && (
                          <select
                            value={recurringInterval}
                            onChange={(e) =>
                              setRecurringInterval(e.target.value as 'Monthly' | 'Quarterly' | 'Yearly')
                            }
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          >
                            <option value="Monthly">Monthly</option>
                            <option value="Quarterly">Quarterly</option>
                            <option value="Yearly">Yearly</option>
                          </select>
                        )}
                      </div>
                    </div>
                  )}

                  {vType === 'purchase_bill' && (
                    <div className="space-y-2.5">
                      <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isReverseCharge}
                          onChange={(e) => setIsReverseCharge(e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        Reverse Charge Mechanism (RCM) Applicable — GSTR-3B Section 3.1(d)
                      </label>
                      <div className="grid grid-cols-3 gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Landed Freight (₹)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={freightCost}
                            onChange={(e) => setFreightCost(Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Transit Insurance (₹)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={insuranceCost}
                            onChange={(e) => setInsuranceCost(Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Customs / Clearing (₹)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={customsCost}
                            onChange={(e) => setCustomsCost(Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Sales Channel
                      </label>
                      <select
                        value={salesChannel}
                        onChange={(e) => setSalesChannel(e.target.value as SalesChannel)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        {SALES_CHANNELS.map((ch) => (
                          <option key={ch} value={ch}>
                            {ch}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Currency (Fx: {selectedCurrencyRate})
                      </label>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        {(db.currencyRates?.length ? db.currencyRates : [{ code: 'INR', rateToInr: 1 }]).map(
                          (c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} (1 = ₹{c.rateToInr})
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Cost Centre
                      </label>
                      <select
                        value={costCentreId}
                        onChange={(e) => setCostCentreId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        <option value="">Default / Unassigned</option>
                        {(db.costCentres || []).map((cc) => (
                          <option key={cc.id} value={cc.id}>
                            {cc.code} - {cc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Project / Sales Rep
                      </label>
                      <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        <option value="">No Project</option>
                        {(db.projects || []).map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Sales Rep / Staff Attribution
                      </label>
                      <input
                        type="text"
                        placeholder="Optional rep name for commissions"
                        value={salesRepName}
                        onChange={(e) => setSalesRepName(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Notes / Narration
                      </label>
                      <input
                        type="text"
                        placeholder="Optional delivery or billing note..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2 text-xs font-mono">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Taxable Subtotal</span>
                    <span>{formatINR(subTotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>{isInterState ? 'IGST Total' : 'CGST + SGST Total'}</span>
                    <span>{formatINR(taxTotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Additional Charges</span>
                    <span>{formatINR(Number(additionalCharges) || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Round Off</span>
                    <span>{formatINR(roundOff, true)}</span>
                  </div>
                  <div className="flex justify-between pt-2.5 border-t border-slate-200 dark:border-slate-700 text-base font-bold text-slate-900 dark:text-white">
                    <span>Grand Total</span>
                    <span>{formatINR(grandTotal)}</span>
                  </div>
                  {(vType === 'sale_invoice' || vType === 'purchase_bill') && (
                    <div className="flex justify-between text-amber-700 dark:text-amber-400 font-semibold pt-1">
                      <span>Balance Due</span>
                      <span>{formatINR(Math.max(0, grandTotal - (Number(paidAmount) || 0)))}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {(vType === 'payment_in' || vType === 'payment_out') && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Existing Party
                  </label>
                  <select
                    value={partyId}
                    onChange={(e) => handlePartyChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">+ New Party (Type Below)</option>
                    {db.parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#116B68] dark:text-teal-300 mb-1">
                    Party Name
                  </label>
                  <input
                    type="text"
                    value={partyNameInput}
                    onChange={(e) => setPartyNameInput(e.target.value)}
                    placeholder="Party name..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-teal-200 dark:border-teal-800 bg-[#E5EFF3]/40 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#116B68] dark:text-teal-300 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={partyPhoneInput}
                    onChange={(e) => setPartyPhoneInput(e.target.value)}
                    placeholder="Mobile number..."
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-teal-200 dark:border-teal-800 bg-[#E5EFF3]/40 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Amount (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={simpleAmount}
                    onChange={(e) => setSimpleAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Account
                  </label>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {db.bankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bankName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Link Pending Invoices (Bill-by-Bill Settlement)
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    Linked: {formatINR(settledInvoices.reduce((s, x) => s + x.amount, 0))}
                  </span>
                </div>
                {pendingBills.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500">
                    No unpaid invoices pending for this party. You can still record an on-account advance.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 px-3 text-left">Link</th>
                        <th className="py-2 px-3 text-left">Voucher No</th>
                        <th className="py-2 px-3 text-left">Date</th>
                        <th className="py-2 px-3 text-right">Invoice Total</th>
                        <th className="py-2 px-3 text-right">Pending Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingBills.map((inv) => {
                        const checked = settledInvoices.some((s) => s.voucherId === inv.id);
                        return (
                          <tr
                            key={inv.id}
                            className="border-b border-slate-100 dark:border-slate-800/60 last:border-0"
                          >
                            <td className="py-2 px-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  toggleSettleInvoice(inv.id, inv.voucherNo, inv.balanceDue)
                                }
                                className="rounded border-slate-300"
                              />
                            </td>
                            <td className="py-2 px-3 font-mono font-medium">{inv.voucherNo}</td>
                            <td className="py-2 px-3 font-mono text-slate-500">{inv.date}</td>
                            <td className="py-2 px-3 text-right font-mono">{formatINR(inv.grandTotal)}</td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-amber-700 dark:text-amber-400">
                              {formatINR(inv.balanceDue)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Reference / Narration
                </label>
                <input
                  type="text"
                  placeholder="NEFT Ref / UTR / Cheque No..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {vType === 'expense' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Expense Category
                </label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Amount (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={simpleAmount}
                  onChange={(e) => setSimpleAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Paid From Account
                </label>
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {db.bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  placeholder="Bill number or description"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {vType === 'contra' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  From Account (Credit)
                </label>
                <select
                  value={contraFromId}
                  onChange={(e) => setContraFromId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {db.bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  To Account (Debit)
                </label>
                <select
                  value={contraToId}
                  onChange={(e) => setContraToId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {db.bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Transfer Amount (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={simpleAmount}
                  onChange={(e) => setSimpleAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Narration
                </label>
                <input
                  type="text"
                  placeholder="Cash deposit / withdrawal / internal transfer"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {vType === 'journal' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  Double-Entry Journal Lines
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setJournalLines((prev) => [
                      ...prev,
                      {
                        id: `jl_${Date.now()}`,
                        accountName: ledgerList[0]?.name || 'Depreciation Expense',
                        accountGroup: ledgerList[0]?.groupName || 'Indirect Expenses',
                        debit: 0,
                        credit: 0,
                        narration: '',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Line
                </button>
              </div>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 px-3 text-left">Ledger Account</th>
                      <th className="py-2 px-3 text-left">Narration</th>
                      <th className="py-2 px-3 text-right w-32">Debit (₹)</th>
                      <th className="py-2 px-3 text-right w-32">Credit (₹)</th>
                      <th className="py-2 px-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalLines.map((jl) => (
                      <tr key={jl.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <td className="p-2">
                          <select
                            value={jl.accountName}
                            onChange={(e) => {
                              const found = ledgerList.find((a) => a.name === e.target.value);
                              setJournalLines((prev) =>
                                prev.map((x) =>
                                  x.id === jl.id
                                    ? {
                                        ...x,
                                        accountName: e.target.value,
                                        accountGroup: found?.groupName || 'General',
                                      }
                                    : x
                                )
                              );
                            }}
                            className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          >
                            {ledgerList.map((a) => (
                              <option key={a.name} value={a.name}>
                                {a.name} ({a.groupName})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={jl.narration || ''}
                            onChange={(e) =>
                              setJournalLines((prev) =>
                                prev.map((x) => (x.id === jl.id ? { ...x, narration: e.target.value } : x))
                              )
                            }
                            className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={jl.debit}
                            onChange={(e) =>
                              setJournalLines((prev) =>
                                prev.map((x) =>
                                  x.id === jl.id ? { ...x, debit: Number(e.target.value), credit: 0 } : x
                                )
                              )
                            }
                            className="w-full px-2 py-1.5 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={jl.credit}
                            onChange={(e) =>
                              setJournalLines((prev) =>
                                prev.map((x) =>
                                  x.id === jl.id ? { ...x, credit: Number(e.target.value), debit: 0 } : x
                                )
                              )
                            }
                            className="w-full px-2 py-1.5 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            disabled={journalLines.length <= 2}
                            onClick={() =>
                              setJournalLines((prev) => prev.filter((x) => x.id !== jl.id))
                            }
                            className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-xs font-mono p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <span>
                  Total Dr: <strong>{formatINR(journalTotals.dr)}</strong> · Total Cr:{' '}
                  <strong>{formatINR(journalTotals.cr)}</strong>
                </span>
                <span className={journalTotals.balanced ? 'text-emerald-600' : 'text-red-600'}>
                  {journalTotals.balanced ? 'Balanced (Dr = Cr)' : 'Unbalanced'}
                </span>
              </div>
              <input
                type="text"
                placeholder="Overall journal voucher narration..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-teal-200 dark:border-teal-800 bg-[#E5EFF3] dark:bg-slate-800 text-[#116B68] dark:text-teal-300 hover:bg-teal-100"
              >
                <Eye className="w-4 h-4" />
                Preview Format
              </button>
              {onMinimize && (
                <button
                  type="button"
                  onClick={onMinimize}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-[#243746] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Minus className="w-4 h-4" />
                  Minimize Draft
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {saving ? 'Saving...' : `Save ${VOUCHER_LABELS[vType]}`}
              </button>
            </div>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
