import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BankAccount,
  BusinessProfile,
  InvoiceDesignConfig,
  LicenseRecord,
  Party,
  PayrollRunRecord,
  StaffMember,
  Voucher,
  VoucherLine,
} from '../types/accounting';
import {
  generateDeterministicQRGrid,
  INVOICE_TEMPLATES,
  numberToIndianWords,
  VOUCHER_LABELS,
} from './formatters';
import { invTr } from './i18n';
import { DEFAULT_APP_SETTINGS, mergeAppSettings } from './defaultAppSettings';
import { computeLiveSalaryBreakdown } from './payrollCalc';

// Standard PDF built-in fonts (Helvetica/Times/Courier) cannot render ₹ (U+20B9), so format cleanly with Rs.
export function formatPdfAmount(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safe);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return `${safe < 0 ? '-' : ''}Rs. ${formatted}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [30, 64, 175];
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [Number.isNaN(r) ? 30 : r, Number.isNaN(g) ? 64 : g, Number.isNaN(b) ? 175 : b];
}

function hasNonAscii(str: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\u0000-\u00FF]/.test(str);
}

function renderCanvasTextPng(
  text: string,
  opts?: { fontSizePt?: number; bold?: boolean; color?: string; italic?: boolean; maxW?: number }
): { dataUrl: string; wMm: number; hMm: number } | null {
  if (typeof document === 'undefined' || !text) return null;
  try {
    const scale = 3;
    const pt = opts?.fontSizePt || 10;
    const px = pt * 1.333 * scale;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const fontStr = `${opts?.italic ? 'italic ' : ''}${opts?.bold ? '700 ' : '500 '}${px}px "Noto Sans Devanagari", "Plus Jakarta Sans", "Segoe UI", Georgia, sans-serif`;
    ctx.font = fontStr;
    const measured = Math.ceil(ctx.measureText(text).width);
    const w = Math.max(20, Math.min(measured + 12 * scale, (opts?.maxW || 180) * 3.78 * scale));
    const h = Math.ceil(px * 1.45);
    canvas.width = w;
    canvas.height = h;
    ctx.font = fontStr;
    ctx.fillStyle = opts?.color || '#0F172A';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 2 * scale, h / 2);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      wMm: w / (3.78 * scale),
      hMm: h / (3.78 * scale),
    };
  } catch {
    return null;
  }
}

function drawSmartText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  opts?: { align?: 'left' | 'right' | 'center'; fontSizePt?: number; bold?: boolean; colorHex?: string; maxW?: number }
): void {
  const clean = text.replace(/₹/g, 'Rs. ');
  if (!hasNonAscii(clean)) {
    if (opts?.align) doc.text(clean, x, y, { align: opts.align });
    else doc.text(clean, x, y);
    return;
  }
  const png = renderCanvasTextPng(clean, {
    fontSizePt: opts?.fontSizePt || doc.getFontSize() || 9,
    bold: opts?.bold,
    color: opts?.colorHex || '#0F172A',
    maxW: opts?.maxW || 150,
  });
  if (!png) {
    doc.text(clean.replace(/[^\x20-\x7E]/g, ''), x, y);
    return;
  }
  let drawX = x;
  if (opts?.align === 'right') drawX = x - png.wMm;
  else if (opts?.align === 'center') drawX = x - png.wMm / 2;
  doc.addImage(png.dataUrl, 'PNG', drawX, y - png.hMm * 0.72, png.wMm, png.hMm);
}

function drawQrOnPdf(doc: jsPDF, seed: string, x: number, y: number, sizeMm: number) {
  const grid = generateDeterministicQRGrid(seed, 21);
  const cell = sizeMm / 21;
  doc.setFillColor(15, 23, 42);
  grid.forEach((row, r) => {
    row.forEach((on, c) => {
      if (on) {
        doc.rect(x + c * cell, y + r * cell, cell, cell, 'F');
      }
    });
  });
}

function drawRoundSealOnPdf(doc: jsPDF, cx: number, cy: number, companyName: string, stampText: string, rgb: [number, number, number]) {
  doc.setDrawColor(...rgb);
  doc.setTextColor(...rgb);
  doc.setLineWidth(0.55);
  doc.circle(cx, cy, 10, 'S');
  doc.setLineWidth(0.2);
  doc.circle(cx, cy, 8.2, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.text(companyName.slice(0, 14).toUpperCase(), cx, cy - 3.2, { align: 'center' });
  doc.setFontSize(5.5);
  doc.text((stampText || 'AUTHORIZED').slice(0, 12).toUpperCase(), cx, cy + 0.8, { align: 'center' });
  doc.setFontSize(4.5);
  doc.text('VERIFIED', cx, cy + 4.5, { align: 'center' });
}

function buildLineSubDetails(l: VoucherLine, appSet: ReturnType<typeof mergeAppSettings>, showBatchCfg: boolean): string {
  const itemSet = appSet.item;
  const parts: string[] = [];
  if (itemSet.description && appSet.print.showDescription && l.description) parts.push(l.description);
  if ((showBatchCfg || itemSet.enableBatchNo) && l.batchNo) parts.push(`${itemSet.batchLabel || 'Batch'}: ${l.batchNo}`);
  if (itemSet.enableSerialNo && l.serialNo) parts.push(`${itemSet.serialLabel || 'Serial'}: ${l.serialNo}`);
  if (itemSet.enableMfgDate && l.mfgDate) parts.push(`Mfg: ${l.mfgDate}`);
  if (itemSet.enableExpDate && l.expDate) parts.push(`Exp: ${l.expDate}`);
  if (itemSet.enableModelNo && l.modelNo) parts.push(`Model: ${l.modelNo}`);
  if (itemSet.enableSize && l.size) parts.push(`Size: ${l.size}`);
  if (itemSet.customFields?.length && l.customValues) {
    for (const f of itemSet.customFields) {
      if (l.customValues[f]) parts.push(`${f}: ${l.customValues[f]}`);
    }
  }
  return parts.length ? `${l.itemName}\n(${parts.join(' | ')})` : l.itemName;
}

function renderVoucherOnDoc(
  doc: jsPDF,
  voucher: Voucher,
  profile: BusinessProfile,
  party?: Party,
  bank?: BankAccount,
  effectivePaid = 0,
  configOverride?: InvoiceDesignConfig
): void {
  const cfg = configOverride || profile.invoiceConfig;
  const tpl = INVOICE_TEMPLATES.find((t) => t.id === cfg.templateId) || INVOICE_TEMPLATES[0];
  const accentRgb = hexToRgb(cfg.accentColor || tpl.defaultAccent);
  const headerBgRgb = hexToRgb(tpl.headerBg);
  const headerTxtRgb = hexToRgb(tpl.headerText);
  const tblHdrBgRgb = hexToRgb(tpl.tableHeaderBg);
  const tblHdrTxtRgb = hexToRgb(tpl.tableHeaderText);
  const balanceDue = Math.max(0, voucher.grandTotal - effectivePaid);
  const lang = profile.language || 'en';
  const appSet = mergeAppSettings(profile.appSettings || DEFAULT_APP_SETTINGS);
  const itemSet = appSet.item;
  const printSet = appSet.print;

  const voucherLabel = invTr(lang, `${voucher.type}_title`, VOUCHER_LABELS[voucher.type] || tpl.badgeLabel);
  const voucherLabelAscii = VOUCHER_LABELS[voucher.type] || 'TAX INVOICE';

  const showUnit = itemSet.itemsUnit;
  const showMrp = itemSet.enableMrp;
  const showDisc = cfg.showDiscount && itemSet.itemWiseDiscount;
  const showTax = cfg.showTaxColumns && itemSet.itemWiseTax && printSet.showTaxDetails;

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  const fontChoice = cfg.fontFamily === 'mono' ? 'courier' : 'helvetica';

  // Background tint for Luxury Beige
  if (cfg.templateId === 'luxury_beige') {
    doc.setFillColor(255, 253, 249);
    doc.rect(0, 0, pageW, pageH, 'F');
  }

  // Full Outer Frame for Classic / GST / Tally / Export / Monogram / Saffron / Teal / Sleek / Sunstar
  const boxedTemplates = new Set([
    'classic_white', 'gst_standard', 'rz_navy_cyan', 'export_blue_grid',
    'tally_prime_classic', 'sharma_monogram_sig', 'saffron_grid_box',
    'teal_ribbon_freight', 'sleek_tabular_pro', 'sunstar_seal_b2b',
  ]);
  if (boxedTemplates.has(cfg.templateId)) {
    doc.setDrawColor(...hexToRgb(tpl.borderColor));
    doc.setLineWidth(0.5);
    doc.rect(8, 8, pageW - 16, pageH - 16);
    if (cfg.templateId === 'classic_white') {
      doc.setLineWidth(0.2);
      doc.rect(9.5, 9.5, pageW - 19, pageH - 19);
    }
  }

  let cursorY = 12;

  // Bilingual Header Banner Helper when Hindi is active
  const renderHindiBanner = (yPos: number) => {
    if (lang === 'hi') {
      drawSmartText(doc, voucherLabel, pageW / 2, yPos, {
        align: 'center',
        fontSizePt: 11,
        bold: true,
        colorHex: tpl.headerBg === '#FFFFFF' ? '#0F172A' : '#FFFFFF',
      });
    }
  };

  if (cfg.templateId === 'modern_green') {
    doc.setFillColor(...headerBgRgb);
    doc.rect(0, 0, 54, pageH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(12);
    const compLines = doc.splitTextToSize(profile.companyName, 44);
    doc.text(compLines, 5, 18);
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(7.5);
    const addrLines = doc.splitTextToSize(profile.address, 44);
    doc.text(addrLines, 5, 30);
    doc.text(`GSTIN: ${profile.gstin || 'N/A'}`, 5, 45);
    doc.text(`Ph: ${profile.phone}`, 5, 50);

    if (cfg.showBankDetails && bank) {
      doc.setFont(fontChoice, 'bold');
      doc.text('BANK DETAILS', 5, 65);
      doc.setFont(fontChoice, 'normal');
      doc.text(bank.bankName.slice(0, 24), 5, 70);
      doc.text(`A/c: ${bank.accountNo}`, 5, 74);
      doc.text(`IFSC: ${bank.ifsc}`, 5, 78);
    }
    if (cfg.showUpiQr) {
      doc.setFillColor(255, 255, 255);
      doc.rect(5, 86, 26, 26, 'F');
      drawQrOnPdf(doc, `upi://pay?pa=${profile.upiId}&am=${(balanceDue || voucher.grandTotal).toFixed(2)}`, 7, 88, 22);
      doc.text('Scan to Pay', 18, 117, { align: 'center' });
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(14);
    drawSmartText(doc, lang === 'hi' ? voucherLabel : voucherLabelAscii.toUpperCase(), 60, 18, { fontSizePt: 14, bold: true });
    doc.setFontSize(10);
    doc.text(`#${voucher.voucherNo}`, pageW - 10, 18, { align: 'right' });
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(8.5);
    doc.text(`Date: ${voucher.date}  |  Due: ${voucher.dueDate || voucher.date}`, pageW - 10, 24, { align: 'right' });

    doc.setDrawColor(187, 247, 208);
    doc.line(60, 28, pageW - 10, 28);
    doc.setFont(fontChoice, 'bold');
    doc.text(`BILL TO: ${voucher.partyName || 'Cash Customer'}`, 60, 35);
    doc.setFont(fontChoice, 'normal');
    doc.text(doc.splitTextToSize(party?.billingAddress || '', 110), 60, 40);
    doc.text(`GSTIN: ${voucher.partyGstin || party?.gstin || 'Unregistered'} | POS: ${voucher.placeOfSupply || profile.state}`, 60, 50);

    autoTable(doc, {
      startY: 56,
      margin: { left: 60, right: 10 },
      headStyles: { fillColor: tblHdrBgRgb, textColor: tblHdrTxtRgb, fontStyle: 'bold', fontSize: 7.5 },
      styles: { font: fontChoice, fontSize: 7.5, cellPadding: 2 },
      head: [['#', 'Item', ...(cfg.showHsn ? ['HSN'] : []), 'Qty', 'Rate', ...(showTax ? ['GST'] : []), 'Total']],
      body: voucher.lines.map((l, idx) => [
        idx + 1,
        buildLineSubDetails(l, appSet, cfg.showBatch),
        ...(cfg.showHsn ? [l.hsn] : []),
        showUnit ? `${l.qty} ${l.unit}` : `${l.qty}`,
        l.rate.toFixed(2),
        ...(showTax ? [`${l.taxRate}%`] : []),
        formatPdfAmount(l.total),
      ]),
    });

    const fy = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 130;
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...accentRgb);
    doc.text(`Grand Total: ${formatPdfAmount(voucher.grandTotal)}`, pageW - 10, fy + 10, { align: 'right' });
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    doc.setFont(fontChoice, 'normal');
    doc.text(`Paid: ${formatPdfAmount(effectivePaid)}  |  Balance Due: ${formatPdfAmount(balanceDue)}`, pageW - 10, fy + 16, { align: 'right' });
    doc.text(`Words: ${numberToIndianWords(voucher.grandTotal)}`, 60, fy + 24);
    if (cfg.showSignature) {
      if (profile.signatureDataUrl && profile.signatureDataUrl.startsWith('data:image')) {
        try { doc.addImage(profile.signatureDataUrl, 'PNG', pageW - 44, fy + 24, 32, 11); } catch { /* ignore */ }
      }
      doc.text(`For ${profile.companyName}`, pageW - 10, fy + 38, { align: 'right' });
      doc.text(profile.signatoryName, pageW - 10, fy + 43, { align: 'right' });
    }
    return;
  }

  // Standard & New Full-Width Masthead Variations
  if (cfg.templateId === 'minimal_bw') {
    doc.setTextColor(0, 0, 0);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(22);
    doc.text(`#${voucher.voucherNo}`, margin, 22);
    doc.setFontSize(9);
    drawSmartText(doc, lang === 'hi' ? voucherLabel : voucherLabelAscii.toUpperCase(), margin, 28, { fontSizePt: 9, bold: true });

    doc.setFontSize(11);
    doc.text(profile.companyName, pageW - margin, 17, { align: 'right' });
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(8);
    doc.text(profile.address.slice(0, 58), pageW - margin, 22, { align: 'right' });
    doc.text(`GSTIN: ${profile.gstin} | Date: ${voucher.date}`, pageW - margin, 27, { align: 'right' });
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.7);
    doc.line(margin, 32, pageW - margin, 32);
    cursorY = 38;
  } else if (cfg.templateId === 'classic_white' || cfg.templateId === 'luxury_beige' || cfg.templateId === 'tally_prime_classic') {
    if (cfg.templateId === 'luxury_beige') {
      doc.setFillColor(...headerBgRgb);
      doc.rect(margin, 12, contentW, 28, 'F');
    }
    doc.setTextColor(...headerTxtRgb);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(14);
    doc.text(profile.companyName.toUpperCase(), pageW / 2, 20, { align: 'center' });
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(8);
    doc.text(profile.address.slice(0, 85), pageW / 2, 25, { align: 'center' });
    doc.text(`GSTIN: ${profile.gstin} | Phone: ${profile.phone} | Email: ${profile.email}`, pageW / 2, 29.5, { align: 'center' });
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...accentRgb);
    drawSmartText(
      doc,
      lang === 'hi' ? `${voucherLabel} - #${voucher.voucherNo} (${voucher.date})` : `${tpl.badgeLabel}  —  ${voucher.voucherNo}  (${voucher.date})`,
      pageW / 2,
      36.5,
      { align: 'center', fontSizePt: 10, bold: true, colorHex: cfg.accentColor || tpl.defaultAccent }
    );
    doc.setDrawColor(...hexToRgb(tpl.borderColor));
    doc.line(margin, 41, pageW - margin, 41);
    cursorY = 46;
  } else if (cfg.templateId === 'creative_premium') {
    doc.setFillColor(...headerBgRgb);
    doc.rect(margin, 12, contentW * 0.62, 26, 'F');
    doc.setFillColor(...accentRgb);
    doc.rect(margin + contentW * 0.62, 12, contentW * 0.38, 26, 'F');
    doc.setTextColor(...headerTxtRgb);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(13);
    doc.text(profile.companyName, margin + 4, 21);
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(7.5);
    doc.text(profile.address.slice(0, 52), margin + 4, 26.5);
    doc.text(`GSTIN: ${profile.gstin}`, margin + 4, 31.5);

    doc.setTextColor(255, 255, 255);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(11);
    drawSmartText(doc, lang === 'hi' ? voucherLabel : voucherLabelAscii.toUpperCase(), pageW - margin - 4, 20, { align: 'right', fontSizePt: 10, bold: true, colorHex: '#FFFFFF' });
    doc.setFontSize(10);
    doc.text(`#${voucher.voucherNo}`, pageW - margin - 4, 26.5, { align: 'right' });
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(8);
    doc.text(`Date: ${voucher.date}`, pageW - margin - 4, 32, { align: 'right' });
    cursorY = 43;
  } else if (cfg.templateId === 'rz_navy_cyan' || cfg.templateId === 'saffron_grid_box' || cfg.templateId === 'teal_ribbon_freight' || cfg.templateId === 'blue_commercial_sheet') {
    // Bold Color Header Ribbon (Navy / Amber / Teal / Royal Blue)
    doc.setFillColor(...headerBgRgb);
    doc.rect(margin, 12, contentW, 11, 'F');
    doc.setTextColor(...headerTxtRgb);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(12);
    drawSmartText(doc, lang === 'hi' ? voucherLabel : tpl.badgeLabel, margin + 4, 19, { fontSizePt: 11, bold: true, colorHex: tpl.headerText });
    doc.setFontSize(8.5);
    doc.text(`#${voucher.voucherNo}  |  ${voucher.date}`, pageW - margin - 4, 19, { align: 'right' });

    doc.setTextColor(15, 23, 42);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(13);
    doc.text(profile.companyName.toUpperCase(), pageW / 2, 29, { align: 'center' });
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(7.5);
    doc.text(profile.address.slice(0, 82), pageW / 2, 33.5, { align: 'center' });
    doc.text(`GSTIN: ${profile.gstin || 'N/A'}  |  PAN: ${profile.pan || 'N/A'}  |  Ph: ${profile.phone}`, pageW / 2, 38, { align: 'center' });
    doc.setDrawColor(...hexToRgb(tpl.borderColor));
    doc.line(margin, 41, pageW - margin, 41);
    cursorY = 45;
  } else {
    const bannerH = 27;
    if (tpl.headerBg !== '#FFFFFF') {
      doc.setFillColor(...headerBgRgb);
      doc.rect(margin, 12, contentW, bannerH, 'F');
    } else {
      doc.setDrawColor(...hexToRgb(tpl.borderColor));
      doc.rect(margin, 12, contentW, bannerH);
    }
    doc.setTextColor(...headerTxtRgb);
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(13);
    doc.text(profile.companyName, margin + 4, 20);
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(7.5);
    doc.text(profile.address.slice(0, 62), margin + 4, 25);
    doc.text(`GSTIN: ${profile.gstin || 'N/A'} | ${profile.state} | ${profile.phone}`, margin + 4, 30);

    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(11);
    if (lang === 'hi') {
      renderHindiBanner(19);
    } else {
      doc.text(tpl.badgeLabel, pageW - margin - 4, 19.5, { align: 'right' });
    }
    doc.setFontSize(10);
    doc.text(`#${voucher.voucherNo}`, pageW - margin - 4, 25.5, { align: 'right' });
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(8);
    if (cfg.templateId === 'dark_modern') {
      doc.setFont(fontChoice, 'bold');
      doc.setFontSize(11);
      doc.text(`TOTAL: ${formatPdfAmount(voucher.grandTotal)}`, pageW - margin - 4, 33, { align: 'right' });
    } else {
      doc.text(`Date: ${voucher.date} | Due: ${voucher.dueDate || voucher.date}`, pageW - margin - 4, 31.5, { align: 'right' });
    }
    cursorY = 44;
  }

  doc.setTextColor(15, 23, 42);
  if (cfg.templateId === 'corporate_blue' || cfg.templateId === 'modern_orange') {
    const cardW = (contentW - 6) / 3;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...hexToRgb(tpl.borderColor));
    [
      ['INVOICE NO / DATE', `${voucher.voucherNo} (${voucher.date})`],
      ['BILL TO', voucher.partyName || 'Cash Customer'],
      ['INVOICE TOTAL', formatPdfAmount(voucher.grandTotal)],
    ].forEach(([lbl, val], i) => {
      const cx = margin + i * (cardW + 3);
      doc.rect(cx, cursorY, cardW, 13, 'FD');
      doc.setFont(fontChoice, 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(lbl, cx + 2.5, cursorY + 4.5);
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(val.slice(0, 28), cx + 2.5, cursorY + 10);
    });
    cursorY += 17;
  }

  // Party & Dispatch block
  doc.setFontSize(8);
  if (cfg.templateId === 'ecommerce_invoice' || cfg.templateId === 'export_blue_grid' || cfg.templateId === 'sleek_tabular_pro') {
    const colW = contentW / 3;
    doc.setFont(fontChoice, 'bold');
    doc.text('BILL TO', margin, cursorY);
    doc.text('SHIP TO', margin + colW, cursorY);
    doc.text('ORDER & DISPATCH', margin + colW * 2, cursorY);
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(7.5);
    doc.text(voucher.partyName || 'Customer', margin, cursorY + 4.5);
    doc.text(doc.splitTextToSize(party?.billingAddress || profile.state, colW - 4), margin, cursorY + 8.5);
    doc.text(doc.splitTextToSize(party?.shippingAddress || party?.billingAddress || profile.state, colW - 4), margin + colW, cursorY + 4.5);
    doc.text(`Ref: ${voucher.voucherNo} (${voucher.date})`, margin + colW * 2, cursorY + 4.5);
    doc.text(`Mode: ${voucher.paymentMode || 'Credit'}`, margin + colW * 2, cursorY + 8.5);
    doc.text(`EWB/Veh: ${voucher.ewayBillNo || voucher.vehicleNo || '-'}`, margin + colW * 2, cursorY + 12.5);
    cursorY += 21;
  } else {
    doc.setFont(fontChoice, 'bold');
    doc.text(cfg.templateId === 'contractor_invoice' ? 'CLIENT & SITE DETAILS' : 'BILL TO', margin, cursorY);
    doc.text(
      cfg.templateId === 'contractor_invoice' ? 'WORK ORDER & MILESTONE' : 'TAX & DISPATCH DETAILS',
      pageW - margin,
      cursorY,
      { align: 'right' }
    );
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(8);
    doc.text(voucher.partyName || 'Cash / General Ledger', margin, cursorY + 4.5);
    doc.text((party?.billingAddress || '').slice(0, 62), margin, cursorY + 8.5);
    doc.text(
      `GSTIN: ${voucher.partyGstin || party?.gstin || 'Unregistered'} | State: ${voucher.placeOfSupply || profile.state}`,
      margin,
      cursorY + 12.5
    );

    doc.text(`Supply Type: ${voucher.isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST+SGST)'}`, pageW - margin, cursorY + 4.5, { align: 'right' });
    doc.text(
      cfg.templateId === 'contractor_invoice'
        ? `Work Order: WO-${voucher.voucherNo}`
        : `Payment Mode: ${voucher.paymentMode || 'Credit'}`,
      pageW - margin,
      cursorY + 8.5,
      { align: 'right' }
    );
    if (voucher.ewayBillNo || voucher.vehicleNo) {
      doc.text(`EWB: ${voucher.ewayBillNo || '-'} | Veh: ${voucher.vehicleNo || '-'}`, pageW - margin, cursorY + 12.5, { align: 'right' });
    }
    cursorY += 17;
  }

  if (cfg.templateId === 'executive_grey') {
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, cursorY, contentW, 14, 'F');
    doc.setFont(fontChoice, 'bold');
    doc.setFontSize(8.5);
    doc.text(`Taxable: ${formatPdfAmount(voucher.subTotal)}`, margin + 4, cursorY + 6);
    doc.text(`GST: ${formatPdfAmount(voucher.taxTotal)}`, margin + 52, cursorY + 6);
    doc.text(`Paid: ${formatPdfAmount(effectivePaid)}`, margin + 96, cursorY + 6);
    doc.setTextColor(...accentRgb);
    doc.text(`Payable: ${formatPdfAmount(voucher.grandTotal)}`, pageW - margin - 4, cursorY + 6, { align: 'right' });
    doc.setTextColor(15, 23, 42);
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(7.5);
    doc.text(`In Words: ${numberToIndianWords(voucher.grandTotal)}`, margin + 4, cursorY + 11.5);
    cursorY += 18;
  }

  const isGstStd = cfg.templateId === 'gst_standard' || cfg.templateId === 'sharma_monogram_sig' || cfg.templateId === 'sunstar_seal_b2b';
  const isService = cfg.templateId === 'service_invoice';
  const isRetail = cfg.templateId === 'retail_invoice';

  const headRow = isGstStd
    ? ['#', 'Item Description', ...(cfg.showHsn ? ['HSN'] : []), 'Qty', ...(showMrp ? [itemSet.mrpLabel || 'MRP'] : []), 'Rate', 'Taxable', ...(showTax ? (voucher.isInterState ? ['IGST'] : ['CGST', 'SGST']) : []), 'Total']
    : isService
    ? ['#', 'Consulting / Service Scope', ...(cfg.showHsn ? ['SAC'] : []), 'Units', 'Fee', 'Taxable', ...(showTax ? ['GST'] : []), 'Amount']
    : isRetail
    ? ['#', 'Product', 'Qty', showMrp ? (itemSet.mrpLabel || 'MRP') : 'Rate', 'Rate', ...(showDisc ? ['Disc%'] : []), 'Taxable', ...(showTax ? ['GST'] : []), 'Net Amt']
    : [
        '#',
        cfg.templateId === 'contractor_invoice' ? 'BOQ Item / Milestone Work' : 'Item Description',
        ...(cfg.showHsn ? ['HSN/SAC'] : []),
        'Qty',
        ...(showMrp ? [itemSet.mrpLabel || 'MRP'] : []),
        'Rate',
        ...(showDisc ? ['Disc%'] : []),
        'Taxable',
        ...(showTax ? ['GST'] : []),
        'Total',
      ];

  const bodyRows = voucher.lines.map((l, idx) => {
    const itemDesc = buildLineSubDetails(l, appSet, cfg.showBatch);
    const qtyTxt = showUnit ? `${l.qty} ${l.unit}` : `${l.qty}`;
    if (isGstStd) {
      return [
        idx + 1,
        itemDesc,
        ...(cfg.showHsn ? [l.hsn] : []),
        qtyTxt,
        ...(showMrp ? [(l.mrp || l.rate).toFixed(2)] : []),
        l.rate.toFixed(2),
        l.taxableAmount.toFixed(2),
        ...(showTax
          ? voucher.isInterState
            ? [`${l.igst.toFixed(2)}`]
            : [`${l.cgst.toFixed(2)}`, `${l.sgst.toFixed(2)}`]
          : []),
        formatPdfAmount(l.total),
      ];
    }
    if (isService) {
      return [
        idx + 1,
        itemDesc,
        ...(cfg.showHsn ? [l.hsn] : []),
        qtyTxt,
        l.rate.toFixed(2),
        l.taxableAmount.toFixed(2),
        ...(showTax ? [`${l.taxRate}%`] : []),
        formatPdfAmount(l.total),
      ];
    }
    if (isRetail) {
      return [
        idx + 1,
        itemDesc,
        qtyTxt,
        (l.mrp || l.rate).toFixed(2),
        l.rate.toFixed(2),
        ...(showDisc ? [`${l.discountPct}%`] : []),
        l.taxableAmount.toFixed(2),
        ...(showTax ? [`${l.taxRate}%`] : []),
        formatPdfAmount(l.total),
      ];
    }
    return [
      idx + 1,
      itemDesc,
      ...(cfg.showHsn ? [l.hsn] : []),
      qtyTxt,
      ...(showMrp ? [(l.mrp || l.rate).toFixed(2)] : []),
      l.rate.toFixed(2),
      ...(showDisc ? [`${l.discountPct}%`] : []),
      l.taxableAmount.toFixed(2),
      ...(showTax ? [`${l.taxRate}% (${(l.cgst + l.sgst + l.igst).toFixed(0)})`] : []),
      formatPdfAmount(l.total),
    ];
  });

  if (voucher.lines.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: boxedTemplates.has(cfg.templateId) ? 'grid' : 'striped',
      headStyles: { fillColor: tblHdrBgRgb, textColor: tblHdrTxtRgb, fontStyle: 'bold', fontSize: 7.5 },
      styles: { font: fontChoice, fontSize: 7.5, cellPadding: 2 },
      head: [headRow],
      body: bodyRows,
    });
    cursorY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursorY + 40) + 6;
  } else {
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, cursorY, contentW, 18, 'F');
    doc.setFont(fontChoice, 'bold');
    doc.text('Voucher Narration:', margin + 4, cursorY + 6);
    doc.setFont(fontChoice, 'normal');
    doc.text(voucher.notes || voucherLabelAscii, margin + 4, cursorY + 12);
    cursorY += 24;
  }

  // Bilingual Hindi Subheading indicator if Hindi selected
  if (lang === 'hi') {
    drawSmartText(doc, `${invTr('hi', 'grand_total')}: ${formatPdfAmount(voucher.grandTotal)} | ${invTr('hi', 'balance_due')}: ${formatPdfAmount(balanceDue)}`, margin, cursorY, {
      fontSizePt: 8.5,
      bold: true,
      colorHex: cfg.accentColor || '#1E3A8A',
    });
    cursorY += 5;
  }

  // Summary Block
  const summaryX = pageW - margin - 68;
  doc.setFont(fontChoice, 'normal');
  doc.setFontSize(8);
  doc.text('Amount in Words:', margin, cursorY + 4);
  doc.setFont(fontChoice, 'bold');
  doc.text(doc.splitTextToSize(numberToIndianWords(voucher.grandTotal), contentW - 76), margin, cursorY + 9);
  if (voucher.notes) {
    doc.setFont(fontChoice, 'normal');
    doc.setFontSize(7.5);
    doc.text(`Notes: ${voucher.notes.slice(0, 75)}`, margin, cursorY + 18);
  }

  doc.setDrawColor(...hexToRgb(tpl.borderColor));
  doc.setFillColor(248, 250, 252);
  doc.rect(summaryX, cursorY, 68, 34, 'FD');
  doc.setFont(fontChoice, 'normal');
  doc.setFontSize(8);
  doc.text('Taxable Subtotal', summaryX + 3, cursorY + 5.5);
  doc.text(formatPdfAmount(voucher.subTotal), pageW - margin - 3, cursorY + 5.5, { align: 'right' });
  doc.text('Total GST', summaryX + 3, cursorY + 10.5);
  doc.text(formatPdfAmount(voucher.taxTotal), pageW - margin - 3, cursorY + 10.5, { align: 'right' });
  doc.text('Charges / Round Off', summaryX + 3, cursorY + 15.5);
  doc.text(formatPdfAmount(voucher.additionalCharges + voucher.roundOff), pageW - margin - 3, cursorY + 15.5, { align: 'right' });
  doc.setFont(fontChoice, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...accentRgb);
  doc.text('Grand Total', summaryX + 3, cursorY + 22);
  doc.text(formatPdfAmount(voucher.grandTotal), pageW - margin - 3, cursorY + 22, { align: 'right' });
  doc.setTextColor(21, 128, 61);
  doc.setFontSize(8);
  doc.text('Paid', summaryX + 3, cursorY + 27);
  doc.text(formatPdfAmount(effectivePaid), pageW - margin - 3, cursorY + 27, { align: 'right' });
  doc.setTextColor(15, 23, 42);
  doc.text('Balance Due', summaryX + 3, cursorY + 31.5);
  doc.text(formatPdfAmount(balanceDue), pageW - margin - 3, cursorY + 31.5, { align: 'right' });

  cursorY += 42;

  // Footer: Bank + UPI QR + Seal + Digital Signature
  if (cursorY < pageH - 42) {
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, cursorY, pageW - margin, cursorY);
    cursorY += 5;

    if (cfg.showBankDetails && bank) {
      doc.setFont(fontChoice, 'bold');
      doc.setFontSize(7.5);
      doc.text('BANK & PAYMENT DETAILS', margin, cursorY);
      doc.setFont(fontChoice, 'normal');
      doc.text(bank.bankName, margin, cursorY + 4);
      doc.text(`A/c: ${bank.accountNo} | IFSC: ${bank.ifsc}`, margin, cursorY + 8);
      doc.text(`UPI ID: ${profile.upiId || bank.upiId}`, margin, cursorY + 12);
    }

    if (cfg.showUpiQr) {
      const upiUri = `upi://pay?pa=${encodeURIComponent(profile.upiId || 'merchant@upi')}&pn=${encodeURIComponent(profile.companyName)}&am=${(balanceDue || voucher.grandTotal).toFixed(2)}&cu=INR`;
      drawQrOnPdf(doc, upiUri, pageW / 2 - 9, cursorY - 1, 18);
      doc.setFontSize(6.5);
      doc.text('Scan & Pay UPI', pageW / 2, cursorY + 20, { align: 'center' });
    }

    const showSeal = Boolean(cfg.showRoundSeal || cfg.templateId === 'sunstar_seal_b2b');
    if (showSeal) {
      drawRoundSealOnPdf(doc, pageW - margin - 52, cursorY + 10, profile.companyName, cfg.stampText, accentRgb);
    } else if (cfg.showStamp) {
      doc.setDrawColor(...accentRgb);
      doc.setTextColor(...accentRgb);
      doc.rect(pageW - margin - 42, cursorY, 42, 7);
      doc.setFont(fontChoice, 'bold');
      doc.setFontSize(6.5);
      doc.text((cfg.stampText || 'AUTHORIZED').slice(0, 22), pageW - margin - 21, cursorY + 4.5, { align: 'center' });
    }

    if (cfg.showSignature) {
      if (profile.signatureDataUrl && profile.signatureDataUrl.startsWith('data:image')) {
        try {
          doc.addImage(profile.signatureDataUrl, 'PNG', pageW - margin - 38, cursorY + 6, 36, 10);
        } catch {
          // ignore
        }
      } else {
        const sigText = profile.digitalSignatureText || cfg.digitalSignatureText || profile.signatoryName;
        const sigPng = renderCanvasTextPng(sigText, { fontSizePt: 13, italic: true, color: '#1E3A8A', maxW: 48 });
        if (sigPng) {
          doc.addImage(sigPng.dataUrl, 'PNG', pageW - margin - sigPng.wMm, cursorY + 7, sigPng.wMm, sigPng.hMm);
        }
      }
      doc.setTextColor(15, 23, 42);
      doc.setFont(fontChoice, 'bold');
      doc.setFontSize(7.5);
      doc.text(`For ${profile.companyName}`, pageW - margin, cursorY + 19, { align: 'right' });
      doc.setFont(fontChoice, 'normal');
      doc.text(printSet.signatureText || profile.signatoryName, pageW - margin, cursorY + 23.5, { align: 'right' });
    }
  }

  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  const terms = (voucher.terms || profile.defaultTerms).replace(/\n/g, ' | ').slice(0, 150);
  doc.text(`Terms: ${terms}`, margin, pageH - 12);
}

function buildInvoicePdfDoc(
  voucher: Voucher,
  profile: BusinessProfile,
  party?: Party,
  bank?: BankAccount,
  effectivePaid = 0,
  configOverride?: InvoiceDesignConfig
): { doc: jsPDF; fileName: string } {
  const cfg = configOverride || profile.invoiceConfig;
  const lang = profile.language || 'en';

  if (cfg.paperFormat === 'thermal_80mm') {
    const estHeight = Math.max(150, 95 + voucher.lines.length * 10);
    const doc = new jsPDF({ unit: 'mm', format: [80, estHeight] });
    const balanceDue = Math.max(0, voucher.grandTotal - effectivePaid);
    const voucherLabel = invTr(lang, `${voucher.type}_title`, VOUCHER_LABELS[voucher.type] || 'INVOICE');
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.text(profile.companyName, 40, 8, { align: 'center' });
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.text(profile.address.slice(0, 46), 40, 12, { align: 'center' });
    doc.text(`GSTIN: ${profile.gstin || 'N/A'} | Ph: ${profile.phone}`, 40, 15.5, { align: 'center' });
    doc.line(4, 18, 76, 18);

    doc.setFont('courier', 'bold');
    drawSmartText(doc, `${voucherLabel} #${voucher.voucherNo}`, 4, 22, { fontSizePt: 8, bold: true });
    doc.setFont('courier', 'normal');
    doc.text(`Date: ${voucher.date}  Mode: ${voucher.paymentMode || 'Cash'}`, 4, 25.5);
    doc.text(`Party: ${voucher.partyName || 'Walk-in Customer'}`, 4, 29);

    autoTable(doc, {
      startY: 32,
      margin: { left: 3, right: 3 },
      theme: 'plain',
      styles: { font: 'courier', fontSize: 6.5, cellPadding: 1 },
      head: [['Item', 'Qty', 'Rate', 'Amt']],
      body: voucher.lines.map((l) => [l.itemName.slice(0, 22), `${l.qty}`, l.rate.toFixed(0), l.total.toFixed(2)]),
    });

    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 70;
    doc.line(4, finalY + 2, 76, finalY + 2);
    doc.setFontSize(7.5);
    doc.text(`Taxable: ${formatPdfAmount(voucher.subTotal)}`, 4, finalY + 6);
    doc.text(`GST: ${formatPdfAmount(voucher.taxTotal)}`, 4, finalY + 9.5);
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.text(`TOTAL: ${formatPdfAmount(voucher.grandTotal)}`, 4, finalY + 14);
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.text(`Paid: ${formatPdfAmount(effectivePaid)}  Bal: ${formatPdfAmount(balanceDue)}`, 4, finalY + 18);
    if (cfg.showUpiQr && profile.upiId) {
      const upiStr = `upi://pay?pa=${profile.upiId}&pn=${profile.companyName}&am=${(balanceDue || voucher.grandTotal).toFixed(2)}&cu=INR`;
      drawQrOnPdf(doc, upiStr, 30, finalY + 21, 18);
      doc.text(`UPI: ${profile.upiId}`, 40, finalY + 42, { align: 'center' });
    }
    return { doc, fileName: `${voucher.voucherNo}_80mm.pdf` };
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: cfg.paperFormat === 'A5' ? 'a5' : 'a4',
  });
  renderVoucherOnDoc(doc, voucher, profile, party, bank, effectivePaid, configOverride);
  return { doc, fileName: `${voucher.voucherNo}.pdf` };
}

export function downloadInvoicePDF(
  voucher: Voucher,
  profile: BusinessProfile,
  party?: Party,
  bank?: BankAccount,
  effectivePaid = 0,
  configOverride?: InvoiceDesignConfig
): void {
  const { doc, fileName } = buildInvoicePdfDoc(voucher, profile, party, bank, effectivePaid, configOverride);
  doc.save(fileName);
}

export function getInvoicePdfBase64(
  voucher: Voucher,
  profile: BusinessProfile,
  party?: Party,
  bank?: BankAccount,
  effectivePaid = 0,
  configOverride?: InvoiceDesignConfig
): { base64: string; fileName: string } {
  const { doc, fileName } = buildInvoicePdfDoc(voucher, profile, party, bank, effectivePaid, configOverride);
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  return { base64, fileName };
}

export function downloadBulkVouchersPDF(params: {
  vouchers: Voucher[];
  profile: BusinessProfile;
  parties: Party[];
  bankAccounts: BankAccount[];
  getEffectivePaid: (v: Voucher) => number;
  filename?: string;
}): void {
  const { vouchers, profile, parties, bankAccounts, getEffectivePaid, filename } = params;
  if (vouchers.length === 0) return;
  const format = profile.invoiceConfig.paperFormat === 'A5' ? 'a5' : 'a4';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format });
  vouchers.forEach((v, idx) => {
    if (idx > 0) doc.addPage(format, 'portrait');
    const party = parties.find((p) => p.id === v.partyId);
    const bank = bankAccounts.find((b) => b.id === v.bankAccountId) || bankAccounts.find((b) => b.type === 'bank');
    renderVoucherOnDoc(doc, v, profile, party, bank, getEffectivePaid(v));
  });
  doc.save(filename || `Bulk_Invoices_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function downloadReportPDF(params: {
  title: string;
  subtitle?: string;
  companyName: string;
  headers: string[];
  rows: (string | number)[][];
  summaryCards?: { label: string; value: string }[];
  filename?: string;
  landscape?: boolean;
}): void {
  const { title, subtitle, companyName, headers, rows, summaryCards, filename, landscape } = params;
  const doc = new jsPDF({
    orientation: landscape || headers.length > 6 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;

  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(companyName || 'Shobhit Invoice Pro', margin, 9);
  doc.setFontSize(10);
  doc.text(title, margin, 15.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, pageW - margin, 15.5, { align: 'right' });

  let cursorY = 25;
  if (subtitle) {
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8.5);
    doc.text(subtitle, margin, cursorY);
    cursorY += 5;
  }

  if (summaryCards && summaryCards.length > 0) {
    const visible = summaryCards.slice(0, 4);
    const gap = 3;
    const cardW = (pageW - margin * 2 - gap * (visible.length - 1)) / visible.length;
    visible.forEach((card, i) => {
      const cx = margin + i * (cardW + gap);
      doc.setFillColor(239, 246, 255);
      doc.setDrawColor(191, 219, 254);
      doc.rect(cx, cursorY, cardW, 13, 'FD');
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.text(card.label.slice(0, 30), cx + 2.5, cursorY + 4.5);
      doc.setTextColor(30, 58, 138);
      doc.setFontSize(9);
      doc.text(card.value.replace(/₹/g, 'Rs. '), cx + 2.5, cursorY + 10.5);
    });
    cursorY += 17;
  }

  const sanitizedRows = rows.map((r) =>
    r.map((cell) => (typeof cell === 'string' ? cell.replace(/₹/g, 'Rs. ') : cell))
  );

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2 },
    head: [headers],
    body: sanitizedRows,
  });

  const safeName = (filename || `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`);
  doc.save(safeName);
}

export function downloadSalarySlipPDF(
  member: StaffMember,
  month: string,
  profile: BusinessProfile,
  runRecord?: PayrollRunRecord
): void {
  const b = computeLiveSalaryBreakdown({ member, month, runRecord });
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  doc.rect(margin, margin, contentW, 28, 'FD');

  let leftX = margin + 4;
  if (profile.logoDataUrl && profile.logoDataUrl.startsWith('data:image')) {
    try {
      doc.addImage(profile.logoDataUrl, 'PNG', margin + 3, margin + 4, 20, 20);
      leftX = margin + 26;
    } catch {
      // ignore invalid logo
    }
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.text(profile.companyName || 'Shobhit Enterprises Pvt Ltd', leftX, margin + 8.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(doc.splitTextToSize(profile.address || '', 96).slice(0, 2), leftX, margin + 13.5);
  doc.text(`Employer PAN: ${profile.pan || 'AAACS4921M'}  |  HR Contact: ${profile.phone || '-'}`, leftX, margin + 23.5);

  doc.setFillColor(15, 23, 42);
  doc.rect(pageW - margin - 60, margin + 3.5, 56, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('SALARY PAYSLIP', pageW - margin - 32, margin + 9, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(b.monthLabel.toUpperCase(), pageW - margin - 4, margin + 17.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Slip No: ${b.payslipNo}  |  Paid: ${b.payDate}`, pageW - margin - 4, margin + 23.5, { align: 'right' });

  let y = margin + 32;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.2, lineColor: [203, 213, 225], lineWidth: 0.25 },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    head: [['EMPLOYEE PARTICULARS', '', 'STATUTORY, BANK & ATTENDANCE', '']],
    body: [
      ['Employee Name', member.name, 'Employee Code', member.empCode || 'EMP-101'],
      ['Designation', member.designation || member.role, 'Department', member.department || 'Operations'],
      ['Date of Joining', member.joiningDate || '2025-04-01', 'Tax Regime', `${member.taxRegime || 'New'} Regime (${member.ptState || 'MH'})`],
      ['PAN Number', member.pan || 'PENDING', 'EPF UAN Number', member.uan || 'Not Linked'],
      ['ESIC Insurance No.', member.esicNo || 'N/A', 'Payment Mode', member.paymentMode || 'Bank Transfer'],
      ['Bank Name', member.bankName || 'HDFC Bank Ltd', 'Bank Account No.', member.bankAccountNo ? `XXXX-${member.bankAccountNo.slice(-4)} (${member.bankAccountNo})` : 'Cash / Direct'],
      ['IFSC Code', member.ifsc || '-', 'Paid / LOP / Working Days', `${b.paidDays} Paid / ${b.lopDays} LOP / ${b.workingDays} Days`],
      ['Leave Balances', `CL: ${member.clBalance ?? 6}  |  SL: ${member.slBalance ?? 6}  |  EL: ${member.elBalance ?? 12}`, 'Pay Period', `${b.month} (Credited ${b.payDate})`],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [71, 85, 105], cellWidth: 34, fillColor: [248, 250, 252] },
      1: { fontStyle: 'bold', textColor: [15, 23, 42], cellWidth: 59 },
      2: { fontStyle: 'bold', textColor: [71, 85, 105], cellWidth: 40, fillColor: [248, 250, 252] },
      3: { fontStyle: 'bold', textColor: [15, 23, 42], cellWidth: 53 },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 5;

  const earningRows: [string, string][] = [
    ['Basic Salary', formatPdfAmount(b.basic)],
    ['House Rent Allowance (HRA)', formatPdfAmount(b.hra)],
    ['Conveyance Allowance', formatPdfAmount(b.conveyance)],
    ['Special & Fixed Allowance', formatPdfAmount(b.specialAllowance)],
  ];
  if (b.overtimePay > 0) earningRows.push(['Overtime Pay', formatPdfAmount(b.overtimePay)]);
  if (b.bonus > 0) earningRows.push(['Performance Bonus / Incentive', formatPdfAmount(b.bonus)]);
  if (b.commission > 0) earningRows.push(['Sales Commission Payout', formatPdfAmount(b.commission)]);
  if (b.arrears > 0) earningRows.push(['Salary Arrears', formatPdfAmount(b.arrears)]);
  if (b.reimbursement > 0) earningRows.push(['Expense Reimbursements', formatPdfAmount(b.reimbursement)]);

  const deductionRows: [string, string][] = [
    ['Employees Provident Fund (EPF 12%)', formatPdfAmount(b.employeePf)],
    ['ESIC Contribution (0.75%)', formatPdfAmount(b.employeeEsic)],
    ['Professional Tax (State PT)', formatPdfAmount(b.professionalTax)],
    ['TDS / Income Tax Withheld', formatPdfAmount(b.tds)],
  ];
  if (b.advanceRecovery > 0) deductionRows.push(['Staff Advance / Loan EMI Recovery', formatPdfAmount(b.advanceRecovery)]);
  if (b.otherDeductions > 0) deductionRows.push(['Other Deductions / LOP Adj.', formatPdfAmount(b.otherDeductions)]);

  const maxLen = Math.max(earningRows.length, deductionRows.length);
  const compBody: string[][] = [];
  for (let i = 0; i < maxLen; i++) {
    compBody.push([
      earningRows[i]?.[0] || '',
      earningRows[i]?.[1] || '',
      deductionRows[i]?.[0] || '',
      deductionRows[i]?.[1] || '',
    ]);
  }
  compBody.push([
    'TOTAL GROSS EARNINGS (A)',
    formatPdfAmount(b.grossEarnings),
    'TOTAL DEDUCTIONS (B)',
    formatPdfAmount(b.totalDeductions),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, lineColor: [203, 213, 225], lineWidth: 0.25 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
    head: [['EARNINGS', 'AMOUNT (INR)', 'DEDUCTIONS & RECOVERIES', 'AMOUNT (INR)']],
    body: compBody,
    columnStyles: {
      0: { cellWidth: 63 },
      1: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      2: { cellWidth: 63 },
      3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.row.index === compBody.length - 1 && data.section === 'body') {
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [15, 23, 42];
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 5;

  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(30, 64, 175);
  doc.setLineWidth(0.4);
  doc.rect(margin, y, contentW, 20, 'FD');

  doc.setTextColor(30, 58, 138);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('NET TAKE-HOME PAY (A - B)', margin + 4, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`In Words: ${numberToIndianWords(b.netPay)}`, margin + 4, y + 14.5);

  doc.setTextColor(30, 64, 175);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(formatPdfAmount(b.netPay), pageW - margin - 4, y + 12.5, { align: 'right' });

  y += 25;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.2, lineColor: [203, 213, 225] },
    headStyles: { fillColor: [248, 250, 252], textColor: [71, 85, 105], fontStyle: 'bold' },
    head: [['EMPLOYER CONTRIBUTION & CTC SUMMARY', 'AMOUNT']],
    body: [
      ['Employer Provident Fund Contribution (12% EPF/EPS)', formatPdfAmount(b.employerPf)],
      ['Employer ESIC Contribution (3.25%)', formatPdfAmount(b.employerEsic)],
      ['Total Cost to Company (Monthly CTC = Gross + Employer Share)', formatPdfAmount(b.monthlyCtc)],
    ],
    columnStyles: {
      0: { cellWidth: 146 },
      1: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
    },
  });

  doc.setDrawColor(203, 213, 225);
  doc.line(margin, pageH - 30, pageW - margin, pageH - 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('This is a computer-generated confidential salary statement issued by Human Resources & Payroll.', margin, pageH - 24);
  doc.text('Discrepancies, if any, must be reported to Accounts & HR within 7 days of salary credit.', margin, pageH - 19.5);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`For ${profile.companyName}`, pageW - margin, pageH - 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Authorized HR / Payroll Signatory', pageW - margin, pageH - 16, { align: 'right' });

  doc.save(`Payslip_${member.name.replace(/\s+/g, '_')}_${b.month}.pdf`);
}

export function downloadLicenseInvoicePDF(
  license: LicenseRecord,
  sellerProfile?: Partial<BusinessProfile>
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const contentW = pageW - margin * 2;

  const tierTitle =
    license.tier === 'platinum'
      ? 'PLATINUM ENTERPRISE'
      : license.tier === 'gold'
      ? 'GOLD BUSINESS'
      : 'SILVER ESSENTIAL';
  const scopeLabel =
    license.deviceScope === 'desktop_mobile' ? 'Desktop + Mobile App' : 'Desktop Only';
  const durationLabel = license.duration === '3_years' ? '3 Years' : '1 Year';

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 38, 'F');
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 38, pageW, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('SHOBHIT INVOICE PRO', margin, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text('Software Licensing & Cloud Subscription Division', margin, 21);
  doc.text(
    `Seller: ${sellerProfile?.companyName || 'Shobhit Invoice Pro Technologies'} · Support: +91-9333911911`,
    margin,
    27
  );
  if (sellerProfile?.gstin) {
    doc.text(`Issuer GSTIN: ${sellerProfile.gstin}`, margin, 32.5);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('LICENSE TAX INVOICE', pageW - margin, 15, { align: 'right' });
  doc.setFontSize(9);
  doc.setTextColor(199, 210, 254);
  doc.text(`Invoice No: ${license.invoiceNo}`, pageW - margin, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(`Issued Date: ${license.createdAt.slice(0, 10)}`, pageW - margin, 27.5, { align: 'right' });
  doc.text(
    `Status: ${
      license.status === 'active'
        ? 'VERIFIED & ACTIVE'
        : license.status === 'deactivated'
        ? 'DEACTIVATED'
        : 'PENDING OPS VERIFICATION'
    }`,
    pageW - margin,
    33,
    { align: 'right' }
  );

  let y = 48;

  // Customer & License Meta Table
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.6, lineColor: [226, 232, 240] },
    body: [
      ['Licensed To (Name)', license.customerName, 'Unique License ID', license.licenseCode || 'PENDING VERIFICATION'],
      ['Registered Mobile', license.phone, 'Subscription Tier', `${tierTitle} PLAN`],
      ['Customer GSTIN', license.gstin || 'Unregistered / B2C', 'Device Access', scopeLabel],
      ['Payment Mode', license.paymentMode || 'UPI', 'Duration', durationLabel],
      [
        'Transaction ID / Ref',
        license.transactionId || license.paymentRef || 'Pending Confirmation',
        'Validity Period',
        license.validFrom && license.expiresAt ? `${license.validFrom} to ${license.expiresAt}` : 'Activates upon Ops Verify',
      ],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [71, 85, 105], cellWidth: 36, fillColor: [248, 250, 252] },
      1: { fontStyle: 'bold', textColor: [15, 23, 42], cellWidth: 55 },
      2: { fontStyle: 'bold', textColor: [71, 85, 105], cellWidth: 36, fillColor: [248, 250, 252] },
      3: { fontStyle: 'bold', textColor: [30, 64, 175], cellWidth: 55 },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 7;

  // Tax Line Items Table
  const halfTax = Number((license.taxAmount / 2).toFixed(2));
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3, lineColor: [203, 213, 225] },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    head: [['Description of SaaS License', 'SAC Code', 'Scope & Term', 'Taxable (INR)', 'GST (18%)', 'Total (INR)']],
    body: [
      [
        `Shobhit Invoice Pro — ${tierTitle} Subscription`,
        '998314',
        `${scopeLabel} · ${durationLabel}`,
        formatPdfAmount(license.amount),
        formatPdfAmount(license.taxAmount),
        formatPdfAmount(license.totalAmount),
      ],
    ],
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 36 },
      3: { cellWidth: 23, halign: 'right' },
      4: { cellWidth: 21, halign: 'right' },
      5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // Tax Breakup & Grand Total
  autoTable(doc, {
    startY: y,
    margin: { left: margin + 92, right: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.5, lineColor: [203, 213, 225] },
    body: [
      ['Taxable License Value', formatPdfAmount(license.amount)],
      ['CGST @ 9%', formatPdfAmount(halfTax)],
      ['SGST @ 9%', formatPdfAmount(Number((license.taxAmount - halfTax).toFixed(2)))],
      ['GRAND TOTAL (INCL. GST)', formatPdfAmount(license.totalAmount)],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [71, 85, 105], cellWidth: 52, fillColor: [248, 250, 252] },
      1: { fontStyle: 'bold', textColor: [15, 23, 42], cellWidth: 38, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.row.index === 3 && data.section === 'body') {
        data.cell.styles.fillColor = [79, 70, 229];
        data.cell.styles.textColor = [255, 255, 255];
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // Highlighted License ID Box & Words
  doc.setFillColor(238, 242, 255);
  doc.setDrawColor(99, 102, 241);
  doc.rect(margin, y, contentW, 24, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(55, 48, 163);
  doc.text('AMOUNT IN WORDS:', margin + 4, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(numberToIndianWords(license.totalAmount), margin + 4, y + 12.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(55, 48, 163);
  doc.text(
    `UNIQUE LICENSE ID: ${license.licenseCode || 'Awaiting Ops Payment Verification'}`,
    margin + 4,
    y + 19.5
  );

  // Footer
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, pageH - 28, pageW - margin, pageH - 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Use your Registered Phone Number + OTP in Utilities -> Subscription & License to attach this License ID.', margin, pageH - 21);
  doc.text('Software licenses are non-transferable and remain permanently attached unless detached with Admin Passcode.', margin, pageH - 16);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('For Shobhit Invoice Pro Licensing', pageW - margin, pageH - 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text('Authorized Digital Receipt', pageW - margin, pageH - 15, { align: 'right' });

  doc.save(`License_Invoice_${license.invoiceNo}_${license.tier.toUpperCase()}.pdf`);
}

