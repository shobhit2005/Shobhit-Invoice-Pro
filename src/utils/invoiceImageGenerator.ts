import { BankAccount, BusinessProfile, Party, Voucher } from '../types/accounting';
import { VOUCHER_LABELS } from './formatters';

function formatMoney(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = String(text || '').split(/\s+/);
  let line = '';
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = words[i];
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

export function generateInvoicePngBase64(
  voucher: Voucher,
  profile: BusinessProfile,
  party?: Party,
  bank?: BankAccount,
  effectivePaid = 0
): string {
  const width = 1200;
  const rowsCount = Math.max(voucher.lines.length, 1);
  const height = Math.max(920, 620 + rowsCount * 46);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean White Card Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Top Header Band (#116B68 Dark Teal)
  ctx.fillStyle = '#116B68';
  ctx.fillRect(0, 0, width, 138);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 34px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText(profile.companyName || 'Shobhit Invoice Pro', 48, 56);

  ctx.font = '18px "DM Sans", Arial, sans-serif';
  ctx.fillStyle = '#E5EFF3';
  ctx.fillText(profile.address || '', 48, 86, 680);
  ctx.fillText(
    `GSTIN: ${profile.gstin || 'N/A'}   |   Ph: ${profile.phone || '-'}`,
    48,
    114
  );

  // Document Type & Number Badge on Top Right
  const docTitle = (VOUCHER_LABELS[voucher.type] || 'TAX INVOICE').toUpperCase();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText(docTitle, width - 48, 54);
  ctx.font = 'bold 20px "JetBrains Mono", monospace';
  ctx.fillStyle = '#E5EFF3';
  ctx.fillText(`#${voucher.voucherNo}`, width - 48, 86);
  ctx.font = '16px "DM Sans", Arial, sans-serif';
  ctx.fillText(`Date: ${voucher.date}  ${voucher.dueDate ? `· Due: ${voucher.dueDate}` : ''}`, width - 48, 114);
  ctx.textAlign = 'left';

  // Party & Supply Details Cards
  ctx.fillStyle = '#F3F5F7';
  ctx.fillRect(48, 162, 540, 128);
  ctx.fillRect(612, 162, 540, 128);

  ctx.fillStyle = '#84909D';
  ctx.font = 'bold 14px "DM Sans", Arial, sans-serif';
  ctx.fillText('BILL TO / PARTY', 68, 190);
  ctx.fillText('BILLING & TAX INFO', 632, 190);

  ctx.fillStyle = '#243746';
  ctx.font = 'bold 22px "DM Sans", Arial, sans-serif';
  ctx.fillText(voucher.partyName || party?.name || 'Walk-in Customer', 68, 222, 500);
  ctx.font = '16px "DM Sans", Arial, sans-serif';
  ctx.fillText(
    `Phone: ${party?.phone || '-'}   |   State: ${party?.state || voucher.placeOfSupply || profile.state}`,
    68,
    250,
    500
  );
  if (party?.gstin || voucher.partyGstin) {
    ctx.fillText(`GSTIN: ${voucher.partyGstin || party?.gstin}`, 68, 276, 500);
  }

  ctx.font = '16px "DM Sans", Arial, sans-serif';
  ctx.fillText(`Place of Supply: ${voucher.placeOfSupply || profile.state}`, 632, 222, 500);
  ctx.fillText(`Payment Mode: ${voucher.paymentMode || 'Bank Transfer'}`, 632, 248, 500);
  ctx.fillText(`Tax Scheme: ${voucher.isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}`, 632, 274, 500);

  // Table Header (#E5EFF3 Light Blue Grey)
  let y = 320;
  ctx.fillStyle = '#E5EFF3';
  ctx.fillRect(48, y, width - 96, 46);
  ctx.fillStyle = '#243746';
  ctx.font = 'bold 15px "DM Sans", Arial, sans-serif';
  ctx.fillText('#', 64, y + 29);
  ctx.fillText('ITEM DESCRIPTION', 108, y + 29);
  ctx.fillText('HSN', 520, y + 29);
  ctx.textAlign = 'right';
  ctx.fillText('QTY', 690, y + 29);
  ctx.fillText('RATE', 830, y + 29);
  ctx.fillText('GST', 960, y + 29);
  ctx.fillText('AMOUNT', width - 64, y + 29);
  ctx.textAlign = 'left';

  y += 46;
  const rows = voucher.lines.length > 0
    ? voucher.lines
    : [
        {
          itemName: voucher.expenseCategory || voucher.notes || docTitle,
          hsn: '-',
          qty: 1,
          unit: 'NOS',
          rate: voucher.subTotal || voucher.grandTotal,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0,
          taxRate: 0,
          total: voucher.grandTotal,
        },
      ];

  rows.forEach((line, idx) => {
    if (idx % 2 === 1) {
      ctx.fillStyle = '#F9FAFB';
      ctx.fillRect(48, y, width - 96, 44);
    }
    ctx.strokeStyle = '#E5EFF3';
    ctx.beginPath();
    ctx.moveTo(48, y + 44);
    ctx.lineTo(width - 48, y + 44);
    ctx.stroke();

    ctx.fillStyle = '#243746';
    ctx.font = '15px "DM Sans", Arial, sans-serif';
    ctx.fillText(String(idx + 1), 64, y + 27);
    ctx.font = 'bold 15px "DM Sans", Arial, sans-serif';
    ctx.fillText(String(line.itemName || 'Item').slice(0, 42), 108, y + 27, 395);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#84909D';
    ctx.fillText(String(line.hsn || '-'), 520, y + 27);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#243746';
    ctx.fillText(`${line.qty} ${line.unit || ''}`.trim(), 690, y + 27);
    ctx.fillText(formatMoney(line.rate), 830, y + 27);
    const gstTotal = (line.cgst || 0) + (line.sgst || 0) + (line.igst || 0) + (line.cess || 0);
    ctx.fillText(`${formatMoney(gstTotal)} (${line.taxRate}%)`, 960, y + 27);
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillText(formatMoney(line.total), width - 64, y + 27);
    ctx.textAlign = 'left';

    y += 44;
  });

  // Totals Card on Right + Bank/Terms on Left
  y += 28;
  const balanceDue = Math.max(0, voucher.grandTotal - effectivePaid);

  if (bank) {
    ctx.fillStyle = '#84909D';
    ctx.font = 'bold 14px "DM Sans", Arial, sans-serif';
    ctx.fillText('BANK & PAYMENT DETAILS', 48, y + 18);
    ctx.fillStyle = '#243746';
    ctx.font = '16px "DM Sans", Arial, sans-serif';
    ctx.fillText(`${bank.bankName}  |  A/C: ${bank.accountNo}`, 48, y + 44);
    ctx.fillText(`IFSC: ${bank.ifsc}  |  UPI: ${profile.upiId || bank.upiId || '-'}`, 48, y + 70);
  }
  if (voucher.notes) {
    ctx.fillStyle = '#84909D';
    ctx.font = '14px "DM Sans", Arial, sans-serif';
    drawWrappedText(ctx, `Notes: ${voucher.notes}`, 48, y + 110, 620, 22);
  }

  // Summary Box
  ctx.fillStyle = '#F3F5F7';
  ctx.fillRect(720, y, width - 768, 200);

  const labelX = 744;
  const valX = width - 68;
  ctx.font = '16px "DM Sans", Arial, sans-serif';
  ctx.fillStyle = '#84909D';
  ctx.fillText('Taxable Subtotal', labelX, y + 34);
  ctx.fillText('Total GST', labelX, y + 66);
  ctx.fillText('Paid / Settled', labelX, y + 98);
  ctx.fillText('Balance Due', labelX, y + 130);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#243746';
  ctx.font = '16px "JetBrains Mono", monospace';
  ctx.fillText(formatMoney(voucher.subTotal), valX, y + 34);
  ctx.fillText(formatMoney(voucher.taxTotal), valX, y + 66);
  ctx.fillStyle = '#16A34A';
  ctx.fillText(formatMoney(effectivePaid), valX, y + 98);
  ctx.fillStyle = balanceDue > 0 ? '#EF4444' : '#16A34A';
  ctx.fillText(formatMoney(balanceDue), valX, y + 130);

  // Grand Total Teal Bar
  ctx.fillStyle = '#168C88';
  ctx.fillRect(720, y + 148, width - 768, 52);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText('GRAND TOTAL', labelX, y + 181);
  ctx.textAlign = 'right';
  ctx.font = 'bold 24px "JetBrains Mono", monospace';
  ctx.fillText(formatMoney(voucher.grandTotal), valX, y + 182);
  ctx.textAlign = 'left';

  // Footer
  ctx.fillStyle = '#84909D';
  ctx.font = '14px "DM Sans", Arial, sans-serif';
  ctx.fillText(
    `Generated by ${profile.companyName} · Thank you for your business!`,
    48,
    height - 32
  );
  ctx.textAlign = 'right';
  ctx.fillText(`Authorized Signatory: ${profile.signatoryName || profile.companyName}`, width - 48, height - 32);
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}
