import { GoogleGenAI, Type } from '@google/genai';
import type { ScannedInvoiceLine, ScannedInvoiceResult } from '../src/types/accounting.ts';

const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error(
      'GEMINI_API_KEY is not configured in Settings > Secrets. Configure a valid Gemini API key on the server to run OCR extraction.'
    ) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

export async function scanInvoiceDocument(input: {
  base64Data?: string;
  mimeType?: string;
  rawText?: string;
}): Promise<ScannedInvoiceResult> {
  const ai = getGeminiClient();
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  if (input.base64Data && input.mimeType) {
    parts.push({
      inlineData: {
        mimeType: input.mimeType,
        data: input.base64Data,
      },
    });
  }
  parts.push({
    text:
      'Perform full-detail Indian GST Invoice OCR extraction from this uploaded image, multi-page PDF, or text. Extract EVERY available field accurately:\n' +
      '- documentType: "purchase_bill" or "sale_invoice"\n' +
      '- partyName, partyGstin (15-char uppercase), partyPan (10-char uppercase), partyPhone, partyEmail, partyAddress, partyState\n' +
      '- invoiceNo, invoiceDate (YYYY-MM-DD), dueDate (YYYY-MM-DD or empty), placeOfSupply, paymentMode ("Cash", "UPI", "Bank Transfer", "Cheque", or "Card"), reverseCharge (boolean)\n' +
      '- ewayBillNo, vehicleNo, transporterName\n' +
      '- Every line item across all pages: itemName, description, hsn, sku, qty, unit (PCS/KG/BOX/MTR/LTR/COIL/NOS/SET), rate, mrp, discountPct, taxRate, taxableAmount, cgst, sgst, igst, total\n' +
      '- Totals: additionalCharges, discountTotal, roundOff, subTotal, taxTotal, grandTotal, paidAmount, notes, terms.' +
      (input.rawText ? `\n\nSUPPLIED INVOICE TEXT:\n${input.rawText}` : ''),
  });

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: { parts },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: { type: Type.STRING },
          partyName: { type: Type.STRING },
          partyGstin: { type: Type.STRING },
          partyPan: { type: Type.STRING },
          partyPhone: { type: Type.STRING },
          partyEmail: { type: Type.STRING },
          partyAddress: { type: Type.STRING },
          partyState: { type: Type.STRING },
          invoiceNo: { type: Type.STRING },
          invoiceDate: { type: Type.STRING },
          dueDate: { type: Type.STRING },
          placeOfSupply: { type: Type.STRING },
          paymentMode: { type: Type.STRING },
          reverseCharge: { type: Type.BOOLEAN },
          ewayBillNo: { type: Type.STRING },
          vehicleNo: { type: Type.STRING },
          transporterName: { type: Type.STRING },
          lines: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                itemName: { type: Type.STRING },
                description: { type: Type.STRING },
                hsn: { type: Type.STRING },
                sku: { type: Type.STRING },
                qty: { type: Type.NUMBER },
                unit: { type: Type.STRING },
                rate: { type: Type.NUMBER },
                mrp: { type: Type.NUMBER },
                discountPct: { type: Type.NUMBER },
                taxRate: { type: Type.NUMBER },
                taxableAmount: { type: Type.NUMBER },
                cgst: { type: Type.NUMBER },
                sgst: { type: Type.NUMBER },
                igst: { type: Type.NUMBER },
                total: { type: Type.NUMBER },
              },
            },
          },
          additionalCharges: { type: Type.NUMBER },
          discountTotal: { type: Type.NUMBER },
          roundOff: { type: Type.NUMBER },
          subTotal: { type: Type.NUMBER },
          taxTotal: { type: Type.NUMBER },
          grandTotal: { type: Type.NUMBER },
          paidAmount: { type: Type.NUMBER },
          notes: { type: Type.STRING },
          terms: { type: Type.STRING },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text || '{}').trim()) as Partial<ScannedInvoiceResult>;
  const allowedModes = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card'] as const;
  const rawMode = String(parsed.paymentMode || 'Bank Transfer');
  const paymentMode = allowedModes.includes(rawMode as (typeof allowedModes)[number])
    ? (rawMode as ScannedInvoiceResult['paymentMode'])
    : 'Bank Transfer';

  const lines: ScannedInvoiceLine[] = Array.isArray(parsed.lines)
    ? parsed.lines.map((l) => {
        const qty = Number(l.qty || 1);
        const rate = Number(l.rate || 0);
        const discountPct = Number(l.discountPct || 0);
        const taxable = Number(l.taxableAmount || qty * rate * (1 - discountPct / 100));
        const taxRate = Number(l.taxRate || 0);
        const cgst = Number(l.cgst || 0);
        const sgst = Number(l.sgst || 0);
        const igst = Number(l.igst || 0);
        const lineTax = cgst + sgst + igst > 0 ? cgst + sgst + igst : (taxable * taxRate) / 100;
        const total = Number(l.total || taxable + lineTax);
        return {
          itemName: String(l.itemName || 'Item'),
          description: String(l.description || ''),
          hsn: String(l.hsn || ''),
          sku: String(l.sku || ''),
          qty,
          unit: String(l.unit || 'PCS').toUpperCase(),
          rate,
          mrp: Number(l.mrp || 0),
          discountPct,
          taxRate,
          taxableAmount: Number(taxable.toFixed(2)),
          cgst: Number(cgst.toFixed(2)),
          sgst: Number(sgst.toFixed(2)),
          igst: Number(igst.toFixed(2)),
          total: Number(total.toFixed(2)),
        };
      })
    : [];

  return {
    documentType: parsed.documentType === 'sale_invoice' ? 'sale_invoice' : 'purchase_bill',
    partyName: parsed.partyName || 'Scanned Party',
    partyGstin: (parsed.partyGstin || '').toUpperCase().slice(0, 15),
    partyPan: (parsed.partyPan || '').toUpperCase().slice(0, 10),
    partyPhone: parsed.partyPhone || '',
    partyEmail: parsed.partyEmail || '',
    partyAddress: parsed.partyAddress || '',
    partyState: parsed.partyState || parsed.placeOfSupply || 'Maharashtra',
    invoiceNo: parsed.invoiceNo || `OCR-${Date.now().toString().slice(-4)}`,
    invoiceDate: parsed.invoiceDate || new Date().toISOString().slice(0, 10),
    dueDate: parsed.dueDate || '',
    placeOfSupply: parsed.placeOfSupply || parsed.partyState || 'Maharashtra',
    paymentMode,
    reverseCharge: Boolean(parsed.reverseCharge),
    ewayBillNo: parsed.ewayBillNo || '',
    vehicleNo: parsed.vehicleNo || '',
    transporterName: parsed.transporterName || '',
    lines,
    additionalCharges: Number(parsed.additionalCharges || 0),
    discountTotal: Number(parsed.discountTotal || 0),
    roundOff: Number(parsed.roundOff || 0),
    subTotal: Number(parsed.subTotal || 0),
    taxTotal: Number(parsed.taxTotal || 0),
    grandTotal: Number(parsed.grandTotal || 0),
    paidAmount: Number(parsed.paidAmount || 0),
    notes: parsed.notes || 'Extracted via AI Invoice OCR',
    terms: parsed.terms || '',
  };
}
