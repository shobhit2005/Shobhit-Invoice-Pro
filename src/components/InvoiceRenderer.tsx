import React, { useMemo } from 'react';
import { BankAccount, BusinessProfile, InvoiceDesignConfig, Party, Voucher, VoucherLine } from '../types/accounting';
import {
  formatCurrency,
  formatINR,
  generateDeterministicQRGrid,
  INVOICE_TEMPLATES,
  numberToIndianWords,
  VOUCHER_LABELS,
} from '../utils/formatters';
import { invTr } from '../utils/i18n';
import { DEFAULT_APP_SETTINGS, mergeAppSettings } from '../utils/defaultAppSettings';

interface InvoiceRendererProps {
  voucher: Voucher;
  profile: BusinessProfile;
  party?: Party;
  bank?: BankAccount;
  effectivePaid: number;
  configOverride?: InvoiceDesignConfig;
  elementId?: string;
}

export const InvoiceRenderer: React.FC<InvoiceRendererProps> = ({
  voucher,
  profile,
  party,
  bank,
  effectivePaid,
  configOverride,
  elementId = 'printable-invoice',
}) => {
  const cfg = configOverride || profile.invoiceConfig;
  const tpl = INVOICE_TEMPLATES.find((t) => t.id === cfg.templateId) || INVOICE_TEMPLATES[1];
  const accent = cfg.accentColor || tpl.defaultAccent;
  const balanceDue = Math.max(0, voucher.grandTotal - effectivePaid);
  const tid = cfg.templateId;
  const lang = profile.language || 'en';
  const appSet = useMemo(() => mergeAppSettings(profile.appSettings || DEFAULT_APP_SETTINGS), [profile.appSettings]);
  const itemSet = appSet.item;
  const printSet = appSet.print;

  const showUnit = itemSet.itemsUnit;
  const showMrpCol = itemSet.enableMrp;
  const showDiscCol = cfg.showDiscount && itemSet.itemWiseDiscount;
  const showTaxCol = cfg.showTaxColumns && itemSet.itemWiseTax && printSet.showTaxDetails;
  const showDesc = itemSet.description && printSet.showDescription;

  const docTitle = invTr(lang, `${voucher.type}_title`, VOUCHER_LABELS[voucher.type] || tpl.badgeLabel);

  const upiUri = `upi://pay?pa=${encodeURIComponent(profile.upiId || bank?.upiId || 'merchant@upi')}&pn=${encodeURIComponent(
    profile.companyName
  )}&am=${(balanceDue > 0 ? balanceDue : voucher.grandTotal).toFixed(2)}&cu=INR&tn=${encodeURIComponent(
    voucher.voucherNo
  )}`;

  const qrGrid = useMemo(() => generateDeterministicQRGrid(upiUri, 21), [upiUri]);
  const irnQrGrid = useMemo(
    () => generateDeterministicQRGrid(voucher.irn || voucher.voucherNo, 21),
    [voucher.irn, voucher.voucherNo]
  );

  const fontClass =
    cfg.fontFamily === 'mono' ? 'font-mono' : cfg.fontFamily === 'display' ? 'font-display' : 'font-sans';

  const fmtAmt = (val: number) =>
    voucher.currency && voucher.currency !== 'INR'
      ? `${formatINR(val)} (${formatCurrency(val, voucher.currency, voucher.exchangeRate || 1)})`
      : formatINR(val);

  const renderLineMeta = (line: VoucherLine) => {
    const pills: string[] = [];
    if (showDesc && line.description) pills.push(line.description);
    if ((cfg.showBatch || itemSet.enableBatchNo) && line.batchNo) pills.push(`${itemSet.batchLabel || invTr(lang, 'batch_no')}: ${line.batchNo}`);
    if (itemSet.enableSerialNo && line.serialNo) pills.push(`${itemSet.serialLabel || invTr(lang, 'serial_no')}: ${line.serialNo}`);
    if (itemSet.enableMfgDate && line.mfgDate) pills.push(`${invTr(lang, 'mfg_date')}: ${line.mfgDate}`);
    if (itemSet.enableExpDate && line.expDate) pills.push(`${invTr(lang, 'exp_date')}: ${line.expDate}`);
    if (itemSet.enableModelNo && line.modelNo) pills.push(`${invTr(lang, 'model_no')}: ${line.modelNo}`);
    if (itemSet.enableSize && line.size) pills.push(`${invTr(lang, 'size')}: ${line.size}`);
    if (itemSet.customFields && itemSet.customFields.length > 0 && line.customValues) {
      for (const cf of itemSet.customFields) {
        if (line.customValues[cf]) pills.push(`${cf}: ${line.customValues[cf]}`);
      }
    }
    if (pills.length === 0) return null;
    return <span className="block text-[9.5px] text-slate-500 mt-0.5 leading-tight">{pills.join(' · ')}</span>;
  };

  const renderRoundSealSvg = (color = accent) => (
    <svg width="74" height="74" viewBox="0 0 100 100" className="opacity-85 -rotate-12 inline-block">
      <circle cx="50" cy="50" r="46" fill="none" stroke={color} strokeWidth="2.5" />
      <circle cx="50" cy="50" r="39" fill="none" stroke={color} strokeWidth="1" strokeDasharray="3 2" />
      <text x="50" y="34" textAnchor="middle" fill={color} fontSize="7.5" fontWeight="800" letterSpacing="0.8">
        {profile.companyName.slice(0, 16).toUpperCase()}
      </text>
      <text x="50" y="53" textAnchor="middle" fill={color} fontSize="8" fontWeight="900" letterSpacing="1">
        {(cfg.stampText || 'AUTHORIZED').slice(0, 14).toUpperCase()}
      </text>
      <text x="50" y="69" textAnchor="middle" fill={color} fontSize="6.5" fontWeight="700">
        {profile.state.slice(0, 14).toUpperCase()}
      </text>
    </svg>
  );

  const renderDigitalSignatureBlock = (compact = false) => {
    const typedSig = profile.digitalSignatureText || cfg.digitalSignatureText || profile.signatoryName;
    const showSeal = Boolean(cfg.showRoundSeal || tid === 'sunstar_seal_b2b');
    if (!cfg.showSignature && !cfg.showStamp && !showSeal) return null;

    return (
      <div className={`text-right ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
        <div className="flex items-end justify-end gap-2 min-h-[46px]">
          {showSeal && renderRoundSealSvg(tid === 'sunstar_seal_b2b' ? '#4F46E5' : accent)}
          {cfg.showStamp && !showSeal && (
            <div
              style={{ borderColor: accent, color: accent }}
              className="inline-block border-2 px-2 py-0.5 rounded text-[8.5px] font-bold tracking-wider uppercase -rotate-3 opacity-85"
            >
              {cfg.stampText || 'AUTHORIZED'}
            </div>
          )}
          {cfg.showSignature && (
            <div className="flex flex-col items-end">
              {profile.signatureDataUrl ? (
                <img
                  src={profile.signatureDataUrl}
                  alt="Signature"
                  className="h-10 max-w-[140px] object-contain"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="font-serif italic text-lg leading-none select-none px-1"
                  style={{ color: '#1E3A8A', borderBottom: '1px solid #3B82F6' }}
                >
                  {typedSig || 'Authorised'}
                </div>
              )}
            </div>
          )}
        </div>
        {cfg.showSignature && (
          <div className="border-t border-slate-300 pt-1 text-[10px] text-slate-700">
            {invTr(lang, 'for_company')} <strong>{profile.companyName}</strong>
            <div className="text-[9.5px] text-slate-500">
              {printSet.showSignatureText ? (printSet.signatureText || invTr(lang, 'auth_signatory')) : profile.signatoryName}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 80mm Thermal POS Receipt
  if (cfg.paperFormat === 'thermal_80mm') {
    return (
      <div
        id={elementId}
        className="w-[320px] bg-white text-slate-900 p-4 border border-slate-300 font-mono text-[11px] leading-relaxed shadow-sm mx-auto"
      >
        <div className="text-center border-b border-dashed border-slate-400 pb-2 mb-2">
          {printSet.showLogo && profile.logoDataUrl && (
            <img
              src={profile.logoDataUrl}
              alt={profile.companyName}
              className="h-10 mx-auto mb-1 object-contain"
              referrerPolicy="no-referrer"
            />
          )}
          {printSet.showCompanyName && <div className="font-bold text-sm">{profile.companyName}</div>}
          {printSet.showAddress && <div>{profile.address}</div>}
          {printSet.showPhone && <div>{invTr(lang, 'phone')}: {profile.phone}</div>}
          {printSet.showGstin && profile.gstin && <div>{invTr(lang, 'gstin')}: {profile.gstin}</div>}
        </div>

        <div className="border-b border-dashed border-slate-400 pb-2 mb-2 space-y-0.5">
          <div className="flex justify-between font-bold">
            <span>{docTitle}</span>
            <span>{voucher.voucherNo}</span>
          </div>
          <div className="flex justify-between">
            <span>{invTr(lang, 'date')}: {voucher.date}</span>
            <span>{voucher.paymentMode || 'Cash'}</span>
          </div>
          <div>{invTr(lang, 'bill_to')}: {voucher.partyName || 'Walk-in Customer'}</div>
          {voucher.partyGstin && <div>{invTr(lang, 'gstin')}: {voucher.partyGstin}</div>}
        </div>

        <table className="w-full text-[10px] border-b border-dashed border-slate-400 mb-2">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1">{invTr(lang, 'item_description')}</th>
              <th className="py-1 text-right">{invTr(lang, 'qty')}</th>
              <th className="py-1 text-right">{invTr(lang, 'rate')}</th>
              <th className="py-1 text-right">{invTr(lang, 'amount')}</th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((line) => (
              <tr key={line.id} className="border-b border-slate-100">
                <td className="py-1 pr-1">
                  {line.itemName}
                  {renderLineMeta(line)}
                </td>
                <td className="py-1 text-right">{line.qty}{showUnit ? ` ${line.unit}` : ''}</td>
                <td className="py-1 text-right">{line.rate}</td>
                <td className="py-1 text-right">{line.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-0.5 border-b border-dashed border-slate-400 pb-2 mb-2">
          <div className="flex justify-between">
            <span>{invTr(lang, 'taxable')}:</span>
            <span>{formatINR(voucher.subTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{invTr(lang, 'gst')}:</span>
            <span>{formatINR(voucher.taxTotal)}</span>
          </div>
          <div className="flex justify-between font-bold text-xs pt-1 border-t border-slate-300">
            <span>{invTr(lang, 'grand_total')}:</span>
            <span>{formatINR(voucher.grandTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{invTr(lang, 'paid_received')}:</span>
            <span>{formatINR(effectivePaid)}</span>
          </div>
          {printSet.showBalanceAmount && (
            <div className="flex justify-between font-semibold">
              <span>{invTr(lang, 'balance_due')}:</span>
              <span>{formatINR(balanceDue)}</span>
            </div>
          )}
        </div>

        {cfg.showUpiQr && (
          <div className="flex flex-col items-center pt-1">
            <svg width="72" height="72" viewBox="0 0 21 21" className="mb-1">
              {qrGrid.map((row, r) =>
                row.map((on, c) =>
                  on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#0f172a" /> : null
                )
              )}
            </svg>
            <div className="text-[10px]">UPI: {profile.upiId || bank?.upiId}</div>
          </div>
        )}
        <div className="text-center mt-2 font-semibold">{invTr(lang, 'thank_you')}</div>
      </div>
    );
  }

  const hsnSummary = (() => {
    const map = new Map<
      string,
      { hsn: string; qty: number; rate: number; taxable: number; cgst: number; sgst: number; igst: number; totalTax: number }
    >();
    for (const line of voucher.lines) {
      const key = `${line.hsn || 'NA'}_${line.taxRate}`;
      const prev = map.get(key) || {
        hsn: line.hsn || 'NA',
        qty: 0,
        rate: line.taxRate,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: 0,
      };
      prev.qty += line.qty;
      prev.taxable += line.taxableAmount;
      prev.cgst += line.cgst;
      prev.sgst += line.sgst;
      prev.igst += line.igst;
      prev.totalTax += line.cgst + line.sgst + line.igst + line.cess;
      map.set(key, prev);
    }
    return Array.from(map.values());
  })();

  const isA5 = cfg.paperFormat === 'A5';
  const widthClass = isA5 ? 'max-w-[560px] p-5 text-[11px]' : 'max-w-[794px] p-7 text-xs';
  const totalQty = voucher.lines.reduce((s, l) => s + l.qty, 0);
  const totalCgst = voucher.lines.reduce((s, l) => s + l.cgst, 0);
  const totalSgst = voucher.lines.reduce((s, l) => s + l.sgst, 0);
  const totalIgst = voucher.lines.reduce((s, l) => s + l.igst, 0);
  const stateCodeMatch = profile.gstin?.slice(0, 2) || '27';
  const partyStateCodeMatch = (voucher.partyGstin || party?.gstin || '').slice(0, 2) || stateCodeMatch;
  const initials = (profile.companyName || 'SI')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const QrBox = ({ size = 60, seedGrid = qrGrid, label }: { size?: number; seedGrid?: boolean[][]; label?: string }) => (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 21 21" className="border border-slate-300 bg-white p-0.5">
        {seedGrid.map((row, r) =>
          row.map((on, c) =>
            on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#0f172a" /> : null
          )
        )}
      </svg>
      {label && <div className="text-[9px] text-slate-600 mt-0.5 text-center">{label}</div>}
    </div>
  );

  const renderHsnBreakupTable = (borderCls = 'border-slate-300', hdrBg = '#F8FAFC') =>
    showTaxCol && hsnSummary.length > 0 ? (
      <table className={`w-full border ${borderCls} text-[10px] font-mono border-collapse`}>
        <thead>
          <tr style={{ backgroundColor: hdrBg }} className={`border-b ${borderCls}`}>
            <th className="p-1.5 text-left border-r border-slate-300">{invTr(lang, 'hsn_sac')}</th>
            <th className="p-1.5 text-right border-r border-slate-300">{invTr(lang, 'qty')}</th>
            <th className="p-1.5 text-right border-r border-slate-300">{invTr(lang, 'taxable')}</th>
            {voucher.isInterState ? (
              <th className="p-1.5 text-right border-r border-slate-300">{invTr(lang, 'igst')}</th>
            ) : (
              <>
                <th className="p-1.5 text-right border-r border-slate-300">{invTr(lang, 'cgst')}</th>
                <th className="p-1.5 text-right border-r border-slate-300">{invTr(lang, 'sgst')}</th>
              </>
            )}
            <th className="p-1.5 text-right">{invTr(lang, 'total')}</th>
          </tr>
        </thead>
        <tbody>
          {hsnSummary.map((row) => (
            <tr key={`${row.hsn}_${row.rate}`} className="border-b border-slate-200">
              <td className="p-1.5 border-r border-slate-200">{row.hsn} ({row.rate}%)</td>
              <td className="p-1.5 text-right border-r border-slate-200">{row.qty}</td>
              <td className="p-1.5 text-right border-r border-slate-200">{row.taxable.toFixed(2)}</td>
              {voucher.isInterState ? (
                <td className="p-1.5 text-right border-r border-slate-200">{row.igst.toFixed(2)}</td>
              ) : (
                <>
                  <td className="p-1.5 text-right border-r border-slate-200">{row.cgst.toFixed(2)}</td>
                  <td className="p-1.5 text-right border-r border-slate-200">{row.sgst.toFixed(2)}</td>
                </>
              )}
              <td className="p-1.5 text-right font-semibold">{row.totalTax.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : null;

  // =========================================================================
  // NEW TEMPLATE 16: RZ NAVY & SKY CYAN SPLIT
  // =========================================================================
  if (tid === 'rz_navy_cyan') {
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 border-2 border-slate-900 mx-auto ${fontClass} text-xs`}>
        <div style={{ backgroundColor: accent }} className="text-white px-5 py-2.5 flex items-center justify-between">
          <div className="w-24" />
          <div className="text-lg font-black tracking-wider uppercase">{docTitle}</div>
          <div className="text-right font-mono text-[11px] leading-tight">
            <div>{invTr(lang, 'invoice_no')} : {voucher.voucherNo}</div>
            <div>{invTr(lang, 'date')} : {voucher.date}</div>
          </div>
        </div>

        <div className="text-center py-4 px-5 border-b border-slate-900 bg-white">
          <div className="text-xl font-black uppercase tracking-tight">{profile.companyName}</div>
          <div className="text-[11px] text-slate-700 mt-0.5">{profile.address}</div>
          <div className="text-[11px] font-mono text-slate-800 mt-0.5">
            {invTr(lang, 'gstin')}: {profile.gstin || 'N/A'} · {invTr(lang, 'email')}: {profile.email} · {invTr(lang, 'pan')}: {profile.pan || 'N/A'}
          </div>
        </div>

        <div style={{ backgroundColor: '#DCEEF5' }} className="grid grid-cols-12 border-b border-slate-900">
          <div className="col-span-6 p-3.5 border-r border-slate-900 space-y-0.5">
            <div className="font-bold text-slate-900">{invTr(lang, 'bill_to')}: {voucher.partyName || 'Cash Customer'}</div>
            {party?.billingAddress && <div className="text-[11px]">{party.billingAddress}</div>}
            {party?.email && <div className="text-[11px]">{invTr(lang, 'email')}: {party.email}</div>}
            {(voucher.partyGstin || party?.gstin) && (
              <div className="text-[11px] font-mono">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin}</div>
            )}
          </div>
          <div className="col-span-6 p-3.5 flex flex-col justify-center space-y-1 text-[11px]">
            <div><strong>{invTr(lang, 'due_date')}:</strong> {voucher.dueDate || voucher.date}</div>
            <div><strong>{invTr(lang, 'payment_mode')}:</strong> {voucher.paymentMode || 'Cash / Bank'}</div>
            <div><strong>{invTr(lang, 'place_of_supply')}:</strong> {voucher.placeOfSupply || profile.state}</div>
          </div>
        </div>

        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-slate-900 bg-white text-left font-bold">
              <th className="py-2 px-3 border-r border-slate-900">{invTr(lang, 'item_description')}</th>
              {cfg.showHsn && <th className="py-2 px-2 border-r border-slate-900 text-center">{invTr(lang, 'hsn_sac')}</th>}
              {showMrpCol && <th className="py-2 px-2 border-r border-slate-900 text-right">{itemSet.mrpLabel || invTr(lang, 'mrp')}</th>}
              <th className="py-2 px-2 border-r border-slate-900 text-right">{invTr(lang, 'qty')}</th>
              <th className="py-2 px-2 border-r border-slate-900 text-right">{invTr(lang, 'rate')}</th>
              {showDiscCol && <th className="py-2 px-2 border-r border-slate-900 text-right">{invTr(lang, 'disc')}</th>}
              <th className="py-2 px-3 text-right">{invTr(lang, 'amount')}</th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-200 align-top">
                <td className="py-2 px-3 border-r border-slate-900 font-medium">
                  {l.itemName}
                  {renderLineMeta(l)}
                </td>
                {cfg.showHsn && <td className="py-2 px-2 border-r border-slate-900 text-center font-mono">{l.hsn}</td>}
                {showMrpCol && <td className="py-2 px-2 border-r border-slate-900 text-right font-mono">{(l.mrp || l.rate).toFixed(0)}</td>}
                <td className="py-2 px-2 border-r border-slate-900 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                <td className="py-2 px-2 border-r border-slate-900 text-right font-mono">{l.rate.toFixed(2)}</td>
                {showDiscCol && <td className="py-2 px-2 border-r border-slate-900 text-right font-mono">{l.discountPct}%</td>}
                <td className="py-2 px-3 text-right font-mono">{l.taxableAmount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-y border-slate-900 font-bold bg-slate-50">
              <td colSpan={1 + (cfg.showHsn ? 1 : 0) + (showMrpCol ? 1 : 0)} className="py-1.5 px-3 border-r border-slate-900 text-right">
                {invTr(lang, 'total')}
              </td>
              <td className="py-1.5 px-2 border-r border-slate-900 text-right font-mono">{totalQty}</td>
              <td colSpan={1 + (showDiscCol ? 1 : 0)} className="py-1.5 px-2 border-r border-slate-900" />
              <td className="py-1.5 px-3 text-right font-mono">{formatINR(voucher.subTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-12 border-b border-slate-900">
          <div style={{ backgroundColor: '#DCEEF5' }} className="col-span-6 p-3.5 border-r border-slate-900 text-[11px]">
            <div className="font-bold mb-1">{invTr(lang, 'terms')}</div>
            <div className="whitespace-pre-line text-slate-700 leading-relaxed">{voucher.terms || profile.defaultTerms}</div>
          </div>
          <div className="col-span-6 flex flex-col justify-between text-[11px] font-mono">
            <div className="p-3 space-y-1">
              {voucher.isInterState ? (
                <div className="flex justify-between font-semibold"><span>{invTr(lang, 'igst')}</span><span>{formatINR(totalIgst)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between font-semibold"><span>{invTr(lang, 'cgst')}</span><span>{formatINR(totalCgst)}</span></div>
                  <div className="flex justify-between font-semibold"><span>{invTr(lang, 'sgst')}</span><span>{formatINR(totalSgst)}</span></div>
                </>
              )}
              <div className="flex justify-between"><span>{invTr(lang, 'paid_received')}</span><span>{formatINR(effectivePaid)}</span></div>
              {printSet.showBalanceAmount && (
                <div className="flex justify-between font-bold"><span>{invTr(lang, 'balance_due')}</span><span>{formatINR(balanceDue)}</span></div>
              )}
            </div>
            <div style={{ backgroundColor: accent }} className="text-white px-3 py-2 flex justify-between font-black text-sm">
              <span>{invTr(lang, 'grand_total')}</span>
              <span>{fmtAmt(voucher.grandTotal)}</span>
            </div>
          </div>
        </div>

        <div className="p-3 border-b border-slate-900 text-[11px]">
          <span className="font-bold underline">{invTr(lang, 'amount_in_words')}:</span>{' '}
          <span className="font-semibold">{numberToIndianWords(voucher.grandTotal)}</span>
        </div>

        <div className="p-4 flex items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            {cfg.showBankDetails && bank && (
              <div className="text-[10px] font-mono text-slate-700">
                <div className="font-bold font-sans text-slate-900">{invTr(lang, 'bank_details')}</div>
                <div>{bank.bankName} · A/c: {bank.accountNo} · IFSC: {bank.ifsc}</div>
              </div>
            )}
            {cfg.showUpiQr && <QrBox size={54} />}
          </div>
          {renderDigitalSignatureBlock()}
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 17: EXPORT & CONSIGNEE SHADED BLUE GRID
  // =========================================================================
  if (tid === 'export_blue_grid') {
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 p-5 border border-slate-800 mx-auto ${fontClass} text-[11px]`}>
        <div className="text-center font-black text-sm tracking-wide mb-1">{docTitle}</div>
        <div className="border border-slate-900 text-center py-1 font-mono font-bold text-xs">
          {invTr(lang, 'gstin')}: {profile.gstin || 'N/A'} · {profile.companyName}
        </div>
        <div className="text-right text-[10px] italic py-0.5">{invTr(lang, 'original_recipient')}</div>
        <div style={{ backgroundColor: '#CBE1F5' }} className="border border-slate-900 text-center py-2 text-lg font-black tracking-wider uppercase">
          {docTitle}
        </div>

        <div className="grid grid-cols-12 border-x border-b border-slate-900 text-[10.5px]">
          <div className="col-span-6 border-r border-slate-900 divide-y divide-slate-400">
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'invoice_no')}:</span><strong>{voucher.voucherNo}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'date')}:</span><strong>{voucher.date}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'reverse_charge')}:</span><strong>{voucher.isReverseCharge ? 'Y' : 'N'}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'state')}: {profile.state}</span><strong>{invTr(lang, 'state_code')}: {stateCodeMatch}</strong></div>
          </div>
          <div className="col-span-6 divide-y divide-slate-400">
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'transport_mode')}:</span><strong>{voucher.transporterName || 'By Road'}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'vehicle_no')}:</span><strong>{voucher.vehicleNo || '-'}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'e_way_bill')}:</span><strong>{voucher.ewayBillNo || '-'}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'place_of_supply')}:</span><strong>{voucher.placeOfSupply || profile.state}</strong></div>
          </div>
        </div>

        <div className="grid grid-cols-12 border-x border-b border-slate-900 mt-1 border-t">
          <div style={{ backgroundColor: '#CBE1F5' }} className="col-span-6 p-1 text-center font-bold border-r border-b border-slate-900">{invTr(lang, 'bill_to')}</div>
          <div style={{ backgroundColor: '#CBE1F5' }} className="col-span-6 p-1 text-center font-bold border-b border-slate-900">{invTr(lang, 'ship_to')}</div>
          <div className="col-span-6 p-2 border-r border-slate-900 space-y-0.5">
            <div className="font-bold">{voucher.partyName || 'Customer'}</div>
            <div className="text-slate-700">{party?.billingAddress || profile.state}</div>
            <div className="font-mono text-[10px]">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'N/A'} · {invTr(lang, 'state_code')}: {partyStateCodeMatch}</div>
          </div>
          <div className="col-span-6 p-2 space-y-0.5">
            <div className="font-bold">{voucher.partyName || 'Consignee'}</div>
            <div className="text-slate-700">{party?.shippingAddress || party?.billingAddress || profile.state}</div>
            <div className="font-mono text-[10px]">{invTr(lang, 'phone')}: {party?.phone || '-'}</div>
          </div>
        </div>

        <table className="w-full border-collapse border border-slate-900 mt-1 text-[10.5px]">
          <thead>
            <tr style={{ backgroundColor: '#CBE1F5' }} className="border-b border-slate-900 font-bold text-center">
              <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'sr_no')}</th>
              <th className="p-1.5 border-r border-slate-900 text-left">{invTr(lang, 'item_description')}</th>
              {cfg.showHsn && <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'hsn_sac')}</th>}
              <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'qty')}</th>
              <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'rate')}</th>
              {showMrpCol && <th className="p-1.5 border-r border-slate-900">{itemSet.mrpLabel || invTr(lang, 'mrp')}</th>}
              <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'taxable')}</th>
              {showTaxCol && <th className="p-1.5 border-r border-slate-900">{voucher.isInterState ? invTr(lang, 'igst') : invTr(lang, 'gst')}</th>}
              <th className="p-1.5">{invTr(lang, 'total')}</th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((l, idx) => (
              <tr key={l.id} className="border-b border-slate-400">
                <td className="p-1.5 border-r border-slate-900 text-center font-mono">{idx + 1}</td>
                <td className="p-1.5 border-r border-slate-900 font-medium">
                  {l.itemName}
                  {renderLineMeta(l)}
                </td>
                {cfg.showHsn && <td className="p-1.5 border-r border-slate-900 text-center font-mono">{l.hsn}</td>}
                <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.rate.toFixed(2)}</td>
                {showMrpCol && <td className="p-1.5 border-r border-slate-900 text-right font-mono">{(l.mrp || l.rate).toFixed(0)}</td>}
                <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.taxableAmount.toFixed(2)}</td>
                {showTaxCol && (
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">
                    {l.taxRate}% ({(l.cgst + l.sgst + l.igst).toFixed(2)})
                  </td>
                )}
                <td className="p-1.5 text-right font-mono font-bold">{l.total.toFixed(2)}</td>
              </tr>
            ))}
            <tr style={{ backgroundColor: '#CBE1F5' }} className="font-bold border-t border-slate-900">
              <td colSpan={2 + (cfg.showHsn ? 1 : 0)} className="p-1.5 text-center border-r border-slate-900">{invTr(lang, 'total')}</td>
              <td className="p-1.5 text-right font-mono border-r border-slate-900">{totalQty}</td>
              <td colSpan={1 + (showMrpCol ? 1 : 0)} className="p-1.5 border-r border-slate-900" />
              <td className="p-1.5 text-right font-mono border-r border-slate-900">{voucher.subTotal.toFixed(2)}</td>
              {showTaxCol && <td className="p-1.5 text-right font-mono border-r border-slate-900">{voucher.taxTotal.toFixed(2)}</td>}
              <td className="p-1.5 text-right font-mono">{voucher.grandTotal.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-12 border-x border-b border-slate-900">
          <div className="col-span-7 border-r border-slate-900 flex flex-col justify-between">
            <div>
              <div style={{ backgroundColor: '#CBE1F5' }} className="p-1 font-bold text-center border-b border-slate-900">{invTr(lang, 'amount_in_words')}</div>
              <div className="p-2 font-semibold">{numberToIndianWords(voucher.grandTotal)}</div>
            </div>
            <div className="p-2 border-t border-slate-900 text-[10px]">
              <strong>{invTr(lang, 'terms')}:</strong> {voucher.terms || profile.defaultTerms}
            </div>
          </div>
          <div className="col-span-5 divide-y divide-slate-400 font-mono text-[10.5px]">
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'sub_total')}</span><strong>{formatINR(voucher.subTotal)}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'gst')}</span><strong>{formatINR(voucher.taxTotal)}</strong></div>
            <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'additional_charges')}</span><strong>{formatINR(voucher.additionalCharges)}</strong></div>
            <div style={{ backgroundColor: '#CBE1F5' }} className="p-1.5 flex justify-between font-black"><span>{invTr(lang, 'grand_total')}</span><span>{formatINR(voucher.grandTotal)}</span></div>
            <div className="p-2.5 flex justify-between items-end">
              {cfg.showUpiQr && <QrBox size={48} />}
              {renderDigitalSignatureBlock(true)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 18: ROYAL BLUE COMMERCIAL SHEET
  // =========================================================================
  if (tid === 'blue_commercial_sheet') {
    const rb = accent === '#0F294A' || accent === '#1E40AF' ? '#2B5EA8' : accent;
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 p-6 border border-slate-300 mx-auto ${fontClass} text-xs`}>
        <div className="text-center text-2xl font-black tracking-wide uppercase mb-4">{docTitle}</div>

        <div className="border border-slate-400 mb-3">
          <div style={{ backgroundColor: rb }} className="text-white px-3 py-1 font-bold text-[11px]">
            From · #{voucher.voucherNo} ({voucher.date})
          </div>
          <div className="grid grid-cols-12 p-3 gap-4 text-[11px]">
            <div className="col-span-7 space-y-0.5">
              <div><strong>{profile.companyName}</strong></div>
              <div>{profile.address}</div>
              <div>{invTr(lang, 'gstin')}: {profile.gstin || 'N/A'} · {invTr(lang, 'phone')}: {profile.phone}</div>
            </div>
            <div className="col-span-5 text-right space-y-0.5 font-mono">
              <div>{invTr(lang, 'invoice_no')}: <strong>{voucher.voucherNo}</strong></div>
              <div>{invTr(lang, 'date')}: {voucher.date}</div>
              <div>{invTr(lang, 'due_date')}: {voucher.dueDate || voucher.date}</div>
            </div>
          </div>
          <div style={{ backgroundColor: rb }} className="grid grid-cols-12 text-white px-3 py-1 font-bold text-[11px]">
            <div className="col-span-6">{invTr(lang, 'ship_to')}</div>
            <div className="col-span-6">{invTr(lang, 'bill_to')}</div>
          </div>
          <div className="grid grid-cols-12 p-3 gap-4 text-[11px]">
            <div className="col-span-6 border-r border-slate-200 pr-2">
              <div className="font-bold">{voucher.partyName || 'Consignee'}</div>
              <div>{party?.shippingAddress || party?.billingAddress || profile.state}</div>
              <div>{invTr(lang, 'phone')}: {party?.phone || '-'}</div>
            </div>
            <div className="col-span-6 pl-2">
              <div className="font-bold">{voucher.partyName || 'Customer'}</div>
              <div>{party?.billingAddress || profile.state}</div>
              <div className="font-mono">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'N/A'}</div>
            </div>
          </div>
        </div>

        <div className="border border-slate-400 mb-3 text-[10.5px]">
          <div style={{ backgroundColor: rb }} className="grid grid-cols-6 text-white font-bold text-center py-1">
            <div>Currency</div>
            <div>Sales Rep</div>
            <div>Ship Date</div>
            <div>Ship Via</div>
            <div>Total Items</div>
            <div>Payment Mode</div>
          </div>
          <div className="grid grid-cols-6 text-center py-1.5 font-mono divide-x divide-slate-300">
            <div>{voucher.currency || 'INR'}</div>
            <div>{voucher.salesRepName || profile.signatoryName || '-'}</div>
            <div>{voucher.date}</div>
            <div>{voucher.transporterName || 'Road/Courier'}</div>
            <div>{totalQty}</div>
            <div>{voucher.paymentMode || 'Bank'}</div>
          </div>
        </div>

        <table className="w-full border border-slate-400 border-collapse text-[11px] mb-4">
          <thead>
            <tr style={{ backgroundColor: rb }} className="text-white text-left">
              <th className="py-1.5 px-2">{invTr(lang, 'qty')}</th>
              {showUnit && <th className="py-1.5 px-2">{invTr(lang, 'unit')}</th>}
              <th className="py-1.5 px-2">{invTr(lang, 'item_description')}</th>
              {cfg.showHsn && <th className="py-1.5 px-2">{invTr(lang, 'hsn_sac')}</th>}
              {showTaxCol && <th className="py-1.5 px-2 text-right">{invTr(lang, 'gst')}</th>}
              <th className="py-1.5 px-2 text-right">{invTr(lang, 'rate')}</th>
              <th className="py-1.5 px-2 text-right">{invTr(lang, 'amount')}</th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((l, i) => (
              <tr key={l.id} className={i % 2 === 1 ? 'bg-slate-200/70' : 'bg-white'}>
                <td className="py-1.5 px-2 font-mono">{l.qty}</td>
                {showUnit && <td className="py-1.5 px-2 font-mono">{l.unit}</td>}
                <td className="py-1.5 px-2 font-medium">
                  {l.itemName}
                  {renderLineMeta(l)}
                </td>
                {cfg.showHsn && <td className="py-1.5 px-2 font-mono">{l.hsn}</td>}
                {showTaxCol && <td className="py-1.5 px-2 text-right font-mono">{l.taxRate}%</td>}
                <td className="py-1.5 px-2 text-right font-mono">{l.rate.toFixed(2)}</td>
                <td className="py-1.5 px-2 text-right font-mono font-bold">{l.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-between items-end gap-6 pt-2 border-t border-slate-300">
          <div className="space-y-1 text-[10.5px] max-w-md">
            <div><strong>{invTr(lang, 'amount_in_words')}:</strong> {numberToIndianWords(voucher.grandTotal)}</div>
            {cfg.showBankDetails && bank && <div className="font-mono">{bank.bankName} · {bank.accountNo} ({bank.ifsc})</div>}
          </div>
          <div className="text-right font-mono space-y-1 min-w-[200px]">
            <div className="flex justify-between"><span>{invTr(lang, 'sub_total')}:</span><span>{formatINR(voucher.subTotal)}</span></div>
            <div className="flex justify-between"><span>{invTr(lang, 'gst')}:</span><span>{formatINR(voucher.taxTotal)}</span></div>
            <div style={{ color: rb }} className="flex justify-between text-sm font-black border-t border-slate-400 pt-1">
              <span>{invTr(lang, 'grand_total')}:</span><span>{formatINR(voucher.grandTotal)}</span>
            </div>
            {renderDigitalSignatureBlock(true)}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 19: CLASSIC ACCOUNTING SHEET (Tally Prime Style)
  // =========================================================================
  if (tid === 'tally_prime_classic') {
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-black p-5 mx-auto ${fontClass} text-[11px]`}>
        <div className="text-center font-bold text-sm mb-1.5">{docTitle}</div>
        <div className="border-2 border-black">
          <div className="grid grid-cols-12 border-b border-black">
            <div className="col-span-6 p-2.5 border-r border-black space-y-0.5">
              <div className="font-bold text-xs">{profile.companyName}</div>
              <div>{profile.address}</div>
              <div>{profile.state}</div>
              <div className="font-mono text-[10px]">{invTr(lang, 'gstin')}: {profile.gstin || 'N/A'}</div>
            </div>
            <div className="col-span-6 grid grid-cols-2 text-[10.5px]">
              <div className="p-2 border-r border-b border-black">
                <div className="text-slate-600">{invTr(lang, 'invoice_no')}</div>
                <div className="font-bold font-mono">{voucher.voucherNo}</div>
              </div>
              <div className="p-2 border-b border-black">
                <div className="text-slate-600">{invTr(lang, 'date')}</div>
                <div className="font-bold font-mono">{voucher.date}</div>
              </div>
              <div className="p-2 border-r border-black">
                <div className="text-slate-600">{invTr(lang, 'payment_mode')}</div>
                <div className="font-semibold">{voucher.paymentMode || 'Credit'}</div>
              </div>
              <div className="p-2">
                <div className="text-slate-600">{invTr(lang, 'e_way_bill')}</div>
                <div className="font-mono">{voucher.ewayBillNo || '-'}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-12 border-b border-black">
            <div className="col-span-6 p-2.5 border-r border-black space-y-0.5">
              <div className="text-[10px] text-slate-600">{invTr(lang, 'bill_to')}</div>
              <div className="font-bold">{voucher.partyName || 'Cash Buyer'}</div>
              {party?.billingAddress && <div>{party.billingAddress}</div>}
              <div>{invTr(lang, 'state')}: {voucher.placeOfSupply || profile.state}</div>
              <div className="font-mono text-[10px]">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'Unregistered'}</div>
            </div>
            <div className="col-span-6 p-2.5 text-[10.5px] space-y-1">
              <div><strong>{invTr(lang, 'place_of_supply')}:</strong> {voucher.placeOfSupply || profile.state}</div>
              {voucher.vehicleNo && <div><strong>{invTr(lang, 'vehicle_no')}:</strong> {voucher.vehicleNo}</div>}
              {voucher.transporterName && <div><strong>{invTr(lang, 'transport_mode')}:</strong> {voucher.transporterName}</div>}
            </div>
          </div>

          <table className="w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="border-b border-black font-bold text-center">
                <th className="p-1.5 border-r border-black w-8">{invTr(lang, 'sr_no')}</th>
                <th className="p-1.5 border-r border-black text-left">{invTr(lang, 'item_description')}</th>
                {cfg.showHsn && <th className="p-1.5 border-r border-black">{invTr(lang, 'hsn_sac')}</th>}
                {showTaxCol && <th className="p-1.5 border-r border-black">{invTr(lang, 'gst')}</th>}
                <th className="p-1.5 border-r border-black text-right">{invTr(lang, 'qty')}</th>
                <th className="p-1.5 border-r border-black text-right">{invTr(lang, 'rate')}</th>
                {showUnit && <th className="p-1.5 border-r border-black">per</th>}
                <th className="p-1.5 text-right">{invTr(lang, 'amount')}</th>
              </tr>
            </thead>
            <tbody>
              {voucher.lines.map((l, idx) => (
                <tr key={l.id} className="align-top">
                  <td className="p-1.5 border-r border-black text-center font-mono">{idx + 1}</td>
                  <td className="p-1.5 border-r border-black font-bold">
                    {l.itemName}
                    {renderLineMeta(l)}
                  </td>
                  {cfg.showHsn && <td className="p-1.5 border-r border-black text-center font-mono">{l.hsn}</td>}
                  {showTaxCol && <td className="p-1.5 border-r border-black text-right font-mono">{l.taxRate}%</td>}
                  <td className="p-1.5 border-r border-black text-right font-mono font-bold">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.rate.toFixed(2)}</td>
                  {showUnit && <td className="p-1.5 border-r border-black text-center font-mono">{l.unit}</td>}
                  <td className="p-1.5 text-right font-mono font-bold">{l.taxableAmount.toFixed(2)}</td>
                </tr>
              ))}
              {voucher.additionalCharges !== 0 && (
                <tr>
                  <td className="border-r border-black" />
                  <td className="p-1.5 border-r border-black text-right italic font-bold">{invTr(lang, 'additional_charges')}</td>
                  {cfg.showHsn && <td className="border-r border-black" />}
                  {showTaxCol && <td className="border-r border-black" />}
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  {showUnit && <td className="border-r border-black" />}
                  <td className="p-1.5 text-right font-mono font-bold">{voucher.additionalCharges.toFixed(2)}</td>
                </tr>
              )}
              <tr>
                <td className="border-r border-black" />
                <td className="p-1.5 border-r border-black text-right italic font-bold">
                  {voucher.isInterState ? invTr(lang, 'igst') : `${invTr(lang, 'cgst')} + ${invTr(lang, 'sgst')}`}
                </td>
                {cfg.showHsn && <td className="border-r border-black" />}
                {showTaxCol && <td className="border-r border-black" />}
                <td className="border-r border-black" />
                <td className="border-r border-black" />
                {showUnit && <td className="border-r border-black" />}
                <td className="p-1.5 text-right font-mono font-bold">{voucher.taxTotal.toFixed(2)}</td>
              </tr>
              <tr className="border-y border-black font-bold">
                <td className="p-1.5 border-r border-black" />
                <td className="p-1.5 border-r border-black text-right">{invTr(lang, 'total')}</td>
                {cfg.showHsn && <td className="p-1.5 border-r border-black" />}
                {showTaxCol && <td className="p-1.5 border-r border-black" />}
                <td className="p-1.5 border-r border-black text-right font-mono">{totalQty}</td>
                <td className="p-1.5 border-r border-black" />
                {showUnit && <td className="p-1.5 border-r border-black" />}
                <td className="p-1.5 text-right font-mono text-xs">{formatINR(voucher.grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="p-2 border-b border-black flex justify-between text-[10.5px]">
            <div>
              <div className="text-slate-600">{invTr(lang, 'amount_in_words')}</div>
              <div className="font-bold">{numberToIndianWords(voucher.grandTotal)}</div>
            </div>
            <div className="italic text-[10px]">E. &amp; O.E.</div>
          </div>

          <div className="border-b border-black">{renderHsnBreakupTable('border-black', '#FFFFFF')}</div>

          <div className="p-2 border-b border-black text-[10.5px]">
            <strong>{invTr(lang, 'tax_in_words')}:</strong> {numberToIndianWords(voucher.taxTotal)}
          </div>

          <div className="grid grid-cols-12">
            <div className="col-span-7 p-2.5 text-[10px] flex flex-col justify-between">
              <div>
                <div className="font-bold underline">{invTr(lang, 'declaration')}</div>
                <div>{invTr(lang, 'declaration_text')}</div>
              </div>
              {cfg.showBankDetails && bank && (
                <div className="font-mono mt-1.5">Bank: {bank.bankName} · A/c {bank.accountNo} · {bank.ifsc}</div>
              )}
            </div>
            <div className="col-span-5 border-l border-t border-black p-2.5 flex flex-col justify-between items-end">
              {cfg.showUpiQr && <QrBox size={44} />}
              {renderDigitalSignatureBlock(true)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 20: MONOGRAM CREST & DIGITAL SIGNATURE
  // =========================================================================
  if (tid === 'sharma_monogram_sig') {
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 p-5 mx-auto ${fontClass} text-[11px]`}>
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>{invTr(lang, 'thank_you')}</span>
          <span className="italic">{invTr(lang, 'original_recipient')}</span>
        </div>
        <div className="text-center font-black text-base tracking-wide mb-2">{docTitle}</div>

        <div className="border-2 border-slate-900">
          <div className="p-3.5 border-b border-slate-900 flex items-center gap-4">
            {printSet.showLogo && profile.logoDataUrl ? (
              <img src={profile.logoDataUrl} alt="" className="w-16 h-16 rounded-full border-2 border-amber-500 object-contain p-1" />
            ) : (
              <div style={{ backgroundColor: accent }} className="w-16 h-16 rounded-full border-2 border-amber-400 text-amber-200 flex flex-col items-center justify-center shrink-0">
                <span className="text-lg font-black font-serif leading-none">{initials}</span>
                <span className="text-[6.5px] uppercase tracking-widest mt-0.5">{profile.state.slice(0, 6)}</span>
              </div>
            )}
            <div className="space-y-0.5">
              <div className="text-base font-extrabold text-slate-900">{profile.companyName}</div>
              <div className="text-[10.5px] text-slate-700">{profile.address}</div>
              <div className="font-mono text-[10px]">
                {profile.phone} · {profile.email}
              </div>
              <div className="font-mono text-[10px] flex flex-wrap items-center gap-2">
                <span>{invTr(lang, 'gstin')}: <strong>{profile.gstin || 'N/A'}</strong></span>
                <span className="border border-slate-700 px-1.5 py-0.2 font-bold">{invTr(lang, 'state_code')}: {stateCodeMatch}</span>
                <span>{invTr(lang, 'pan')}: {profile.pan || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-12 border-b border-slate-900 text-[10.5px]">
            <div className="col-span-7 border-r border-slate-900 divide-y divide-slate-900">
              <div className="p-2.5 space-y-0.5">
                <div className="font-bold text-slate-700">{invTr(lang, 'bill_to')}</div>
                <div className="font-bold text-slate-900">{voucher.partyName || 'Customer'}</div>
                <div>{party?.billingAddress || profile.state}</div>
                <div className="font-mono text-[10px]">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'N/A'} · {invTr(lang, 'state_code')}: {partyStateCodeMatch}</div>
              </div>
              <div className="p-2.5 space-y-0.5">
                <div className="font-bold text-slate-700">{invTr(lang, 'ship_to')}</div>
                <div className="font-bold text-slate-900">{voucher.partyName || 'Consignee'}</div>
                <div>{party?.shippingAddress || party?.billingAddress || profile.state}</div>
              </div>
            </div>
            <div className="col-span-5 grid grid-cols-2 text-[10px]">
              <div className="p-2 border-r border-b border-slate-900">
                <div className="text-slate-500">{invTr(lang, 'invoice_no')}</div>
                <div className="font-bold font-mono">{voucher.voucherNo}</div>
              </div>
              <div className="p-2 border-b border-slate-900">
                <div className="text-slate-500">{invTr(lang, 'date')}</div>
                <div className="font-bold font-mono">{voucher.date}</div>
              </div>
              <div className="p-2 border-r border-b border-slate-900">
                <div className="text-slate-500">{invTr(lang, 'due_date')}</div>
                <div className="font-mono">{voucher.dueDate || voucher.date}</div>
              </div>
              <div className="p-2 border-b border-slate-900">
                <div className="text-slate-500">{invTr(lang, 'place_of_supply')}</div>
                <div className="font-semibold">{voucher.placeOfSupply || profile.state}</div>
              </div>
              <div className="p-2 col-span-2">
                <div className="text-slate-500">{invTr(lang, 'reverse_charge')}</div>
                <div className="font-bold">{voucher.isReverseCharge ? 'Yes' : 'No'}</div>
              </div>
            </div>
          </div>

          <table className="w-full border-collapse border-b border-slate-900 text-[10px]">
            <thead>
              <tr className="border-b border-slate-900 bg-slate-50 font-bold text-center">
                <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'sr_no')}</th>
                <th className="p-1.5 border-r border-slate-900 text-left">{invTr(lang, 'item_description')}</th>
                {cfg.showHsn && <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'hsn_sac')}</th>}
                <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'qty')}</th>
                <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'rate')}</th>
                {showDiscCol && <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'disc')}</th>}
                <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'taxable')}</th>
                {showTaxCol && <th className="p-1.5 border-r border-slate-900">{voucher.isInterState ? invTr(lang, 'igst') : `${invTr(lang, 'cgst')} / ${invTr(lang, 'sgst')}`}</th>}
                <th className="p-1.5">{invTr(lang, 'total')}</th>
              </tr>
            </thead>
            <tbody>
              {voucher.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-300">
                  <td className="p-1.5 border-r border-slate-900 text-center font-mono">{i + 1}</td>
                  <td className="p-1.5 border-r border-slate-900 font-bold">
                    {l.itemName}
                    {renderLineMeta(l)}
                  </td>
                  {cfg.showHsn && <td className="p-1.5 border-r border-slate-900 text-center font-mono">{l.hsn}</td>}
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.rate.toFixed(2)}</td>
                  {showDiscCol && <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.discountPct}%</td>}
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.taxableAmount.toFixed(2)}</td>
                  {showTaxCol && (
                    <td className="p-1.5 border-r border-slate-900 text-right font-mono">
                      {voucher.isInterState ? `${l.igst.toFixed(2)} (${l.taxRate}%)` : `${l.cgst.toFixed(2)} + ${l.sgst.toFixed(2)}`}
                    </td>
                  )}
                  <td className="p-1.5 text-right font-mono font-bold">{formatINR(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-b border-slate-900">{renderHsnBreakupTable('border-slate-900', '#F8FAFC')}</div>

          <div className="grid grid-cols-12 border-b border-slate-900">
            <div className="col-span-7 border-r border-slate-900 p-3 space-y-2">
              <div className="border-b border-slate-200 pb-2 text-center">
                <div className="text-[10px] text-slate-600">{invTr(lang, 'amount_in_words')}</div>
                <div className="font-bold">{numberToIndianWords(voucher.grandTotal)}</div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                {cfg.showBankDetails && bank && (
                  <div className="text-[10px] space-y-0.5">
                    <div className="font-bold">{invTr(lang, 'bank_details')}</div>
                    <div>{invTr(lang, 'upi_id')}: {profile.upiId || bank.upiId}</div>
                    <div>{invTr(lang, 'bank_name')}: {bank.bankName} ({bank.accountNo})</div>
                    <div>{invTr(lang, 'branch')}: {bank.branch} · IFSC: {bank.ifsc}</div>
                  </div>
                )}
                {cfg.showUpiQr && <QrBox size={58} label="UPI / PhonePe / GPay" />}
              </div>
            </div>
            <div className="col-span-5 font-mono text-[10.5px] divide-y divide-slate-300">
              <div className="p-2 flex justify-between"><span>{invTr(lang, 'sub_total')}</span><strong>{formatINR(voucher.subTotal)}</strong></div>
              {!voucher.isInterState ? (
                <>
                  <div className="p-2 flex justify-between"><span>{invTr(lang, 'cgst')}</span><span>{formatINR(totalCgst)}</span></div>
                  <div className="p-2 flex justify-between"><span>{invTr(lang, 'sgst')}</span><span>{formatINR(totalSgst)}</span></div>
                </>
              ) : (
                <div className="p-2 flex justify-between"><span>{invTr(lang, 'igst')}</span><span>{formatINR(totalIgst)}</span></div>
              )}
              <div className="p-2 flex justify-between font-black text-xs bg-slate-50"><span>{invTr(lang, 'grand_total')}</span><span>{formatINR(voucher.grandTotal)}</span></div>
            </div>
          </div>

          <div className="grid grid-cols-12">
            <div className="col-span-7 border-r border-slate-900 p-3 text-[10px]">
              <div className="font-bold mb-0.5">{invTr(lang, 'terms')}</div>
              <div className="whitespace-pre-line text-slate-700">{voucher.terms || profile.defaultTerms}</div>
            </div>
            <div className="col-span-5 p-3">{renderDigitalSignatureBlock()}</div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 21: AMBER / SAFFRON DISPATCH GRID
  // =========================================================================
  if (tid === 'saffron_grid_box') {
    const sf = accent === '#0F294A' || accent === '#1E40AF' ? '#EA580C' : accent;
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 border-2 border-slate-900 mx-auto ${fontClass} text-[11px]`}>
        <div className="grid grid-cols-12 border-b-2 border-slate-900">
          <div style={{ backgroundColor: sf }} className="col-span-8 text-white py-3.5 px-5 text-center text-xl font-black tracking-wide">
            {docTitle}
          </div>
          <div style={{ backgroundColor: '#FED7AA' }} className="col-span-4 border-l-2 border-slate-900 flex items-center justify-center p-2">
            {printSet.showLogo && profile.logoDataUrl ? (
              <img src={profile.logoDataUrl} alt="" className="h-10 object-contain" />
            ) : (
              <span className="font-black text-base tracking-widest text-slate-900">{profile.companyName.slice(0, 10).toUpperCase()}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-12 border-b border-slate-900 text-[10.5px]">
          <div className="col-span-6 p-3 border-r border-slate-900 space-y-0.5">
            <div className="font-bold text-xs">{profile.companyName}</div>
            <div>{profile.address}</div>
            <div>{profile.state}</div>
            <div className="font-mono">{invTr(lang, 'gstin')}: {profile.gstin || 'N/A'}</div>
            <div>{invTr(lang, 'email')}: {profile.email} · {invTr(lang, 'phone')}: {profile.phone}</div>
          </div>
          <div className="col-span-6 grid grid-cols-2 text-[10px]">
            {[
              [invTr(lang, 'invoice_no'), voucher.voucherNo],
              [invTr(lang, 'date'), voucher.date],
              [invTr(lang, 'due_date'), voucher.dueDate || voucher.date],
              [invTr(lang, 'place_of_supply'), voucher.placeOfSupply || profile.state],
              [invTr(lang, 'e_way_bill'), voucher.ewayBillNo || '-'],
              [invTr(lang, 'vehicle_no'), voucher.vehicleNo || '-'],
              [invTr(lang, 'transport_mode'), voucher.transporterName || '-'],
              [invTr(lang, 'payment_mode'), voucher.paymentMode || 'Cash'],
            ].map(([k, v], i) => (
              <div key={i} className="px-2 py-1 border-b border-r border-slate-900 last:border-b-0 flex justify-between gap-1">
                <span className="text-slate-600">{k}:</span>
                <strong className="font-mono truncate">{v}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-12 border-b border-slate-900 text-[10.5px]">
          <div className="col-span-6 p-3 border-r border-slate-900 space-y-0.5">
            <div className="font-bold text-slate-700">{invTr(lang, 'bill_to')}</div>
            <div className="font-bold text-slate-900">{voucher.partyName || 'Customer'}</div>
            <div>{party?.billingAddress || profile.state}</div>
            <div className="font-mono">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'N/A'}</div>
            <div>{invTr(lang, 'phone')}: {party?.phone || '-'}</div>
          </div>
          <div style={{ backgroundColor: '#FDBA74' }} className="col-span-6 p-3 flex flex-col justify-between">
            <div>
              <div className="font-bold uppercase">{invTr(lang, 'terms')}:</div>
              <div className="whitespace-pre-line text-[10px] mt-1">{voucher.terms || profile.defaultTerms}</div>
            </div>
          </div>
        </div>

        <table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="border-y border-slate-900 bg-white font-bold text-center">
              <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'sr_no')}</th>
              <th className="p-1.5 border-r border-slate-900 text-left">{invTr(lang, 'item_description')}</th>
              {cfg.showHsn && <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'hsn_sac')}</th>}
              <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'qty')}</th>
              {showUnit && <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'unit')}</th>}
              <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'rate')}</th>
              <th className="p-1.5">{invTr(lang, 'amount')}</th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((l, i) => (
              <tr key={l.id} style={i % 2 === 1 ? { backgroundColor: '#FED7AA' } : undefined} className="border-b border-slate-900">
                <td className="p-1.5 border-r border-slate-900 text-center font-mono">{i + 1}</td>
                <td className="p-1.5 border-r border-slate-900 font-medium">
                  {l.itemName}
                  {renderLineMeta(l)}
                </td>
                {cfg.showHsn && <td className="p-1.5 border-r border-slate-900 text-center font-mono">{l.hsn}</td>}
                <td className="p-1.5 border-r border-slate-900 text-center font-mono">{l.qty}</td>
                {showUnit && <td className="p-1.5 border-r border-slate-900 text-center font-mono">{l.unit}</td>}
                <td className="p-1.5 border-r border-slate-900 text-right font-mono">{formatINR(l.rate)}</td>
                <td className="p-1.5 text-right font-mono font-bold">{formatINR(l.taxableAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-12 border-t border-slate-900 text-[10.5px]">
          <div className="col-span-6 border-r border-slate-900">
            <div className="p-2 border-b border-slate-900">
              <div className="font-bold text-[10px]">{invTr(lang, 'tax_in_words')}:</div>
              <div className="font-semibold">{numberToIndianWords(voucher.taxTotal)}</div>
            </div>
            <div className="p-2 border-b border-slate-900">
              <div className="font-bold text-[10px]">{invTr(lang, 'amount_in_words')}:</div>
              <div className="font-semibold">{numberToIndianWords(voucher.grandTotal)}</div>
            </div>
            <div className="p-2 text-[9.5px]">
              <div className="font-bold underline">{invTr(lang, 'declaration')}:</div>
              <div>{invTr(lang, 'declaration_text')}</div>
            </div>
          </div>
          <div className="col-span-6 p-2.5 flex flex-col justify-between">
            <div className="space-y-1 font-mono">
              <div className="flex justify-between items-center">
                <span style={{ backgroundColor: sf }} className="text-white px-2 py-0.5 font-bold font-sans text-[10px]">TOTAL QTY: {totalQty}</span>
                <span style={{ backgroundColor: sf }} className="text-white px-2 py-0.5 font-bold font-sans text-[10px]">{invTr(lang, 'sub_total')}: {formatINR(voucher.subTotal)}</span>
              </div>
              {!voucher.isInterState ? (
                <>
                  <div className="flex justify-between"><span>{invTr(lang, 'cgst')}</span><span>{formatINR(totalCgst)}</span></div>
                  <div className="flex justify-between"><span>{invTr(lang, 'sgst')}</span><span>{formatINR(totalSgst)}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span>{invTr(lang, 'igst')}</span><span>{formatINR(totalIgst)}</span></div>
              )}
              <div className="flex justify-between"><span>{invTr(lang, 'round_off')}</span><span>{formatINR(voucher.roundOff, true)}</span></div>
              <div style={{ backgroundColor: '#FED7AA' }} className="flex justify-between p-1.5 border border-slate-900 font-black text-xs">
                <span>{invTr(lang, 'grand_total')}</span>
                <span>{formatINR(voucher.grandTotal)}</span>
              </div>
            </div>
            <div className="pt-2">{renderDigitalSignatureBlock(true)}</div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 22: TEAL RIBBON FREIGHT & LOGISTICS
  // =========================================================================
  if (tid === 'teal_ribbon_freight') {
    const tl = accent === '#0F294A' || accent === '#1E40AF' ? '#0D9488' : accent;
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 p-5 mx-auto ${fontClass} text-[11px]`}>
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex-1">
            <div className="text-2xl font-black uppercase text-slate-900 tracking-tight">{profile.companyName}</div>
            <div style={{ backgroundColor: tl }} className="text-white px-3 py-1 text-xs font-semibold mt-1">
              {profile.tagline || 'Quality Products & Enterprise Supply Solutions'}
            </div>
            <div className="text-[10.5px] text-slate-700 mt-1.5">{profile.address}</div>
          </div>
          <div className="text-right shrink-0 flex flex-col items-end">
            {printSet.showLogo && profile.logoDataUrl && (
              <img src={profile.logoDataUrl} alt="" className="h-12 object-contain mb-1" />
            )}
            <div className="text-[10px] font-mono">
              <div>{invTr(lang, 'phone')}: {profile.phone}</div>
              <div>{invTr(lang, 'email')}: {profile.email}</div>
            </div>
          </div>
        </div>

        <div className="border-2 border-slate-900">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-900 bg-slate-50">
            <div className="font-mono font-bold text-[10.5px]">{invTr(lang, 'pan')}: {profile.pan || 'N/A'}</div>
            <div className="font-black text-base tracking-wide">{docTitle}</div>
            <div className="text-[10px] font-semibold">{invTr(lang, 'original_recipient')}</div>
          </div>

          <div className="grid grid-cols-12 border-b border-slate-900 text-[10.5px]">
            <div className="col-span-6 p-2.5 border-r border-slate-900 space-y-0.5">
              <div className="text-center font-bold border-b border-slate-300 pb-0.5 mb-1">{invTr(lang, 'bill_to')}</div>
              <div><strong>M/S:</strong> {voucher.partyName || 'Customer'}</div>
              <div>{party?.billingAddress || profile.state}</div>
              <div className="font-mono">{invTr(lang, 'phone')}: {party?.phone || '-'} · {invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'N/A'}</div>
              <div><strong>{invTr(lang, 'place_of_supply')}:</strong> {voucher.placeOfSupply || profile.state}</div>
            </div>
            <div className="col-span-6 p-2.5 space-y-1 font-mono text-[10px]">
              <div className="flex justify-between"><span>{invTr(lang, 'invoice_no')}: <strong>{voucher.voucherNo}</strong></span><span>{invTr(lang, 'date')}: {voucher.date}</span></div>
              <div>{invTr(lang, 'e_way_bill')}: <strong>{voucher.ewayBillNo || '-'}</strong></div>
              <div>{invTr(lang, 'transport_mode')}: <strong>{voucher.transporterName || 'Direct Roadline'}</strong></div>
              <div>{invTr(lang, 'vehicle_no')}: <strong>{voucher.vehicleNo || '-'}</strong></div>
            </div>
          </div>

          <table className="w-full border-collapse border-b border-slate-900 text-[10.5px]">
            <thead>
              <tr className="border-b border-slate-900 bg-slate-50 font-bold text-center">
                <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'sr_no')}</th>
                <th className="p-1.5 border-r border-slate-900 text-left">{invTr(lang, 'item_description')}</th>
                {cfg.showHsn && <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'hsn_sac')}</th>}
                <th className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'qty')}</th>
                <th className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'rate')}</th>
                <th className="p-1.5 text-right">{invTr(lang, 'taxable')}</th>
              </tr>
            </thead>
            <tbody>
              {voucher.lines.map((l, i) => (
                <tr key={l.id} className="align-top">
                  <td className="p-1.5 border-r border-slate-900 text-center font-mono">{i + 1}</td>
                  <td className="p-1.5 border-r border-slate-900 font-medium">
                    {l.itemName}
                    {renderLineMeta(l)}
                  </td>
                  {cfg.showHsn && <td className="p-1.5 border-r border-slate-900 text-center font-mono">{l.hsn}</td>}
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.rate.toFixed(2)}</td>
                  <td className="p-1.5 text-right font-mono">{l.taxableAmount.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-900 font-mono">
                <td colSpan={1 + (cfg.showHsn ? 1 : 0) + 1} className="p-1.5 border-r border-slate-900 text-right font-bold">
                  {voucher.isInterState ? invTr(lang, 'igst') : `${invTr(lang, 'cgst')} + ${invTr(lang, 'sgst')}`}
                </td>
                <td className="p-1.5 border-r border-slate-900" />
                <td className="p-1.5 border-r border-slate-900" />
                <td className="p-1.5 text-right font-bold">{voucher.taxTotal.toFixed(2)}</td>
              </tr>
              <tr className="border-y border-slate-900 font-bold bg-slate-50">
                <td colSpan={2 + (cfg.showHsn ? 1 : 0)} className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'total')}</td>
                <td className="p-1.5 border-r border-slate-900 text-right font-mono">{totalQty}</td>
                <td className="p-1.5 border-r border-slate-900" />
                <td className="p-1.5 text-right font-mono text-xs">{formatINR(voucher.grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="p-2 border-b border-slate-900 text-[10.5px]">
            <div className="text-[10px] text-slate-600">{invTr(lang, 'amount_in_words')}</div>
            <div className="font-bold uppercase">{numberToIndianWords(voucher.grandTotal)}</div>
          </div>

          <div className="border-b border-slate-900">{renderHsnBreakupTable('border-slate-900', '#F8FAFC')}</div>

          <div className="p-2 border-b border-slate-900 font-bold text-[10px]">
            {invTr(lang, 'tax_in_words')}: {numberToIndianWords(voucher.taxTotal)}
          </div>

          <div className="grid grid-cols-12">
            <div className="col-span-7 border-r border-slate-900 p-2.5 flex items-center justify-between gap-2">
              {cfg.showBankDetails && bank && (
                <div className="text-[10px] font-mono space-y-0.5">
                  <div className="font-bold font-sans">{invTr(lang, 'bank_details')}</div>
                  <div>{bank.bankName} · {bank.branch}</div>
                  <div>{invTr(lang, 'account_no')}: {bank.accountNo} · IFSC: {bank.ifsc}</div>
                  <div>{invTr(lang, 'upi_id')}: {profile.upiId || bank.upiId}</div>
                </div>
              )}
              {cfg.showUpiQr && <QrBox size={56} label={invTr(lang, 'scan_pay')} />}
            </div>
            <div className="col-span-5 p-2.5 flex flex-col justify-between">
              <div className="text-[9.5px] text-slate-600">
                <strong>{invTr(lang, 'terms')}:</strong> {voucher.terms || profile.defaultTerms}
              </div>
              <div className="pt-2">{renderDigitalSignatureBlock(true)}</div>
            </div>
          </div>
          <div className="border-t border-slate-900 px-3 py-1.5 flex justify-between text-[10px] font-bold">
            <span>{invTr(lang, 'customer_sign')}</span>
            <span>{invTr(lang, 'thank_you')}</span>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 23: SLEEK TABULAR PRO
  // =========================================================================
  if (tid === 'sleek_tabular_pro') {
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 p-4 mx-auto ${fontClass} text-[10.5px]`}>
        <div className="border-2 border-slate-900">
          <div className="text-center font-black text-base py-1 border-b border-slate-900">{docTitle}</div>
          <div className="grid grid-cols-12 border-b border-slate-900 font-mono text-[10.5px]">
            <div className="col-span-4 p-1.5 border-r border-slate-900">{invTr(lang, 'invoice_no')}: <strong>{voucher.voucherNo}</strong></div>
            <div className="col-span-4 p-1.5 border-r border-slate-900">{invTr(lang, 'date')}: <strong>{voucher.date}</strong></div>
            <div className="col-span-4 p-1.5">{invTr(lang, 'place_of_supply')}: <strong>{voucher.placeOfSupply || profile.state}</strong></div>
          </div>

          <div className="grid grid-cols-12 border-b border-slate-900 items-center p-2.5">
            <div className="col-span-8 text-center">
              <div className="text-lg font-black">{profile.companyName}</div>
              <div className="text-[10.5px] text-slate-700">{profile.address}</div>
            </div>
            <div className="col-span-4 flex justify-end">
              {printSet.showLogo && profile.logoDataUrl && <img src={profile.logoDataUrl} alt="" className="h-12 object-contain" />}
            </div>
          </div>

          <div className="grid grid-cols-12 border-b border-slate-900 text-[10px] font-mono">
            <div className="col-span-4 p-1.5 border-r border-slate-900">
              <div>{invTr(lang, 'state')}: {profile.state}</div>
              <div>{invTr(lang, 'gstin')}: <strong>{profile.gstin || 'N/A'}</strong></div>
            </div>
            <div className="col-span-4 p-1.5 border-r border-slate-900">
              <div>{invTr(lang, 'pan')}: <strong>{profile.pan || 'N/A'}</strong></div>
              <div>{invTr(lang, 'phone')}: {profile.phone}</div>
            </div>
            <div className="col-span-4 p-1.5">
              <div>{invTr(lang, 'email')}: {profile.email}</div>
              <div>{invTr(lang, 'due_date')}: {voucher.dueDate || voucher.date}</div>
            </div>
          </div>

          <div className="grid grid-cols-12 border-b border-slate-900">
            <div className="col-span-6 p-2 border-r border-slate-900">
              <div className="font-bold">{invTr(lang, 'bill_to')}: {voucher.partyName || 'Customer'}</div>
              <div>{party?.billingAddress || profile.state}</div>
              <div className="font-mono text-[10px]">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'Unreg'}</div>
            </div>
            <div className="col-span-6 p-2">
              <div className="font-bold">{invTr(lang, 'ship_to')}: {voucher.partyName || 'Consignee'}</div>
              <div>{party?.shippingAddress || party?.billingAddress || profile.state}</div>
              <div className="font-mono text-[10px]">{invTr(lang, 'phone')}: {party?.phone || '-'}</div>
            </div>
          </div>

          <table className="w-full border-collapse border-b border-slate-900 text-[10px]">
            <thead>
              <tr className="border-b border-slate-900 bg-slate-100 font-bold">
                <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'sr_no')}</th>
                <th className="p-1.5 border-r border-slate-900 text-left">{invTr(lang, 'item_description')}</th>
                {cfg.showHsn && <th className="p-1.5 border-r border-slate-900">{invTr(lang, 'hsn_sac')}</th>}
                <th className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'qty')}</th>
                <th className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'rate')}</th>
                {showDiscCol && <th className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'disc')}</th>}
                {showTaxCol && <th className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'gst')}</th>}
                <th className="p-1.5 text-right">{invTr(lang, 'taxable')}</th>
              </tr>
            </thead>
            <tbody>
              {voucher.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-200">
                  <td className="p-1.5 border-r border-slate-900 text-center font-mono">{i + 1}</td>
                  <td className="p-1.5 border-r border-slate-900 font-medium">
                    {l.itemName}
                    {renderLineMeta(l)}
                  </td>
                  {cfg.showHsn && <td className="p-1.5 border-r border-slate-900 text-center font-mono">{l.hsn}</td>}
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                  <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.rate.toFixed(2)}</td>
                  {showDiscCol && <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.discountPct}%</td>}
                  {showTaxCol && <td className="p-1.5 border-r border-slate-900 text-right font-mono">{l.taxRate}%</td>}
                  <td className="p-1.5 text-right font-mono font-bold">{l.taxableAmount.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="font-bold border-t border-slate-900 bg-slate-50">
                <td colSpan={2 + (cfg.showHsn ? 1 : 0)} className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'total')} Qty</td>
                <td className="p-1.5 border-r border-slate-900 text-right font-mono">{totalQty}</td>
                <td colSpan={1 + (showDiscCol ? 1 : 0) + (showTaxCol ? 1 : 0)} className="p-1.5 border-r border-slate-900 text-right">{invTr(lang, 'sub_total')}</td>
                <td className="p-1.5 text-right font-mono">{formatINR(voucher.subTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="grid grid-cols-12 border-b border-slate-900 font-bold">
            <div className="col-span-4 p-1.5 border-r border-slate-900 text-center">{invTr(lang, 'amount_in_words')}</div>
            <div className="col-span-6 p-1.5 border-r border-slate-900">{numberToIndianWords(voucher.grandTotal)}</div>
            <div className="col-span-2 p-1.5 text-right font-mono text-xs">{formatINR(voucher.grandTotal)}</div>
          </div>

          <div className="border-b border-slate-900">{renderHsnBreakupTable('border-slate-900', '#F1F5F9')}</div>

          <div className="grid grid-cols-12 border-b border-slate-900">
            <div className="col-span-6 p-2 border-r border-slate-900 text-[10px]">
              <div className="font-bold">{invTr(lang, 'terms')}</div>
              <div className="whitespace-pre-line">{voucher.terms || profile.defaultTerms}</div>
            </div>
            <div className="col-span-6 p-2 flex items-end justify-between">
              {cfg.showUpiQr && <QrBox size={48} />}
              {renderDigitalSignatureBlock(true)}
            </div>
          </div>

          {cfg.showBankDetails && bank && (
            <div className="grid grid-cols-12 text-[9.5px] font-mono bg-slate-50">
              <div className="col-span-3 p-1.5 border-r border-slate-900"><strong>{invTr(lang, 'bank_name')}:</strong> {bank.bankName}</div>
              <div className="col-span-3 p-1.5 border-r border-slate-900"><strong>{invTr(lang, 'account_no')}:</strong> {bank.accountNo}</div>
              <div className="col-span-3 p-1.5 border-r border-slate-900"><strong>{invTr(lang, 'ifsc')}:</strong> {bank.ifsc}</div>
              <div className="col-span-3 p-1.5 truncate"><strong>{invTr(lang, 'upi_id')}:</strong> {profile.upiId || bank.upiId}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // NEW TEMPLATE 24: INDUSTRIAL SEAL B2B (Sunstar Style)
  // =========================================================================
  if (tid === 'sunstar_seal_b2b') {
    return (
      <div id={elementId} className={`w-full ${isA5 ? 'max-w-[560px]' : 'max-w-[794px]'} bg-white text-slate-900 p-4 mx-auto ${fontClass} text-[10.5px]`}>
        <div className="text-center font-black text-base mb-1.5">{docTitle}</div>
        <div className="border border-slate-800">
          <div className="grid grid-cols-12 border-b border-slate-800">
            <div className="col-span-6 p-2.5 border-r border-slate-800 space-y-0.5">
              <div className="text-sm font-black">{profile.companyName}</div>
              <div>{profile.address}</div>
              <div>{invTr(lang, 'phone')}: {profile.phone} · {invTr(lang, 'email')}: {profile.email}</div>
              <div className="font-mono">{invTr(lang, 'gstin')}: <strong>{profile.gstin || 'N/A'}</strong> · {invTr(lang, 'state')}: {profile.state}</div>
            </div>
            <div className="col-span-6 grid grid-cols-2 text-[10px]">
              <div className="p-2 border-r border-b border-slate-800">
                <div className="text-slate-500">{invTr(lang, 'invoice_no')}</div>
                <div className="font-bold font-mono">{voucher.voucherNo}</div>
              </div>
              <div className="p-2 border-b border-slate-800">
                <div className="text-slate-500">{invTr(lang, 'date')}</div>
                <div className="font-bold font-mono">{voucher.date}</div>
              </div>
              <div className="p-2 border-r border-b border-slate-800">
                <div className="text-slate-500">{invTr(lang, 'place_of_supply')}</div>
                <div className="font-bold">{voucher.placeOfSupply || profile.state}</div>
              </div>
              <div className="p-2 border-b border-slate-800">
                <div className="text-slate-500">{invTr(lang, 'due_date')}</div>
                <div className="font-bold font-mono">{voucher.dueDate || voucher.date}</div>
              </div>
              <div className="p-2 col-span-2">
                <span className="text-slate-500">{invTr(lang, 'payment_mode')}: </span>
                <strong>{voucher.paymentMode || 'Credit'}</strong>
              </div>
            </div>
          </div>

          <div className="p-2.5 border-b border-slate-800 space-y-0.5">
            <div className="font-bold text-slate-600">{invTr(lang, 'bill_to')}</div>
            <div className="font-bold text-slate-900">{voucher.partyName || 'Customer'}</div>
            <div>{party?.billingAddress || profile.state}</div>
            <div className="font-mono text-[10px]">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'N/A'} · {invTr(lang, 'state')}: {voucher.placeOfSupply || profile.state}</div>
          </div>

          <table className="w-full border-collapse border-b border-slate-800 text-[10px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-50 font-bold text-center">
                <th className="p-1.5 border-r border-slate-800">#</th>
                <th className="p-1.5 border-r border-slate-800 text-left">{invTr(lang, 'item_description')}</th>
                {cfg.showHsn && <th className="p-1.5 border-r border-slate-800">{invTr(lang, 'hsn_sac')}</th>}
                <th className="p-1.5 border-r border-slate-800 text-right">{invTr(lang, 'qty')}</th>
                <th className="p-1.5 border-r border-slate-800 text-right">{invTr(lang, 'rate')}</th>
                <th className="p-1.5 border-r border-slate-800 text-right">{invTr(lang, 'taxable')}</th>
                {showTaxCol && <th className="p-1.5 border-r border-slate-800 text-right">{invTr(lang, 'gst')}</th>}
                <th className="p-1.5 text-right">{invTr(lang, 'amount')}</th>
              </tr>
            </thead>
            <tbody>
              {voucher.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-300 align-top">
                  <td className="p-1.5 border-r border-slate-800 text-center font-mono">{i + 1}</td>
                  <td className="p-1.5 border-r border-slate-800 font-medium">
                    {l.itemName}
                    {renderLineMeta(l)}
                  </td>
                  {cfg.showHsn && <td className="p-1.5 border-r border-slate-800 text-center font-mono">{l.hsn}</td>}
                  <td className="p-1.5 border-r border-slate-800 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                  <td className="p-1.5 border-r border-slate-800 text-right font-mono">{formatINR(l.rate)}</td>
                  <td className="p-1.5 border-r border-slate-800 text-right font-mono">{formatINR(l.taxableAmount)}</td>
                  {showTaxCol && (
                    <td className="p-1.5 border-r border-slate-800 text-right font-mono">
                      {formatINR(l.cgst + l.sgst + l.igst)} ({l.taxRate}%)
                    </td>
                  )}
                  <td className="p-1.5 text-right font-mono font-bold">{formatINR(l.total)}</td>
                </tr>
              ))}
              <tr className="font-bold bg-slate-50 border-t border-slate-800">
                <td colSpan={2 + (cfg.showHsn ? 1 : 0)} className="p-1.5 border-r border-slate-800 text-right">{invTr(lang, 'total')}</td>
                <td className="p-1.5 border-r border-slate-800 text-right font-mono">{totalQty}</td>
                <td className="p-1.5 border-r border-slate-800" />
                <td className="p-1.5 border-r border-slate-800 text-right font-mono">{formatINR(voucher.subTotal)}</td>
                {showTaxCol && <td className="p-1.5 border-r border-slate-800 text-right font-mono">{formatINR(voucher.taxTotal)}</td>}
                <td className="p-1.5 text-right font-mono">{formatINR(voucher.grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="grid grid-cols-12 border-b border-slate-800">
            <div className="col-span-6 p-2 border-r border-slate-800">
              <div className="font-bold text-[10px]">{invTr(lang, 'amount_in_words')}</div>
              <div className="font-semibold">{numberToIndianWords(voucher.grandTotal)}</div>
            </div>
            <div className="col-span-6 divide-y divide-slate-300 font-mono text-[10px]">
              <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'sub_total')}</span><span>{formatINR(voucher.subTotal)}</span></div>
              <div className="p-1.5 flex justify-between font-bold"><span>{invTr(lang, 'grand_total')}</span><span>{formatINR(voucher.grandTotal)}</span></div>
              <div className="p-1.5 flex justify-between"><span>{invTr(lang, 'paid_received')}</span><span>{formatINR(effectivePaid)}</span></div>
              {printSet.showBalanceAmount && (
                <div className="p-1.5 flex justify-between font-bold"><span>{invTr(lang, 'balance_due')}</span><span>{formatINR(balanceDue)}</span></div>
              )}
            </div>
          </div>

          <div className="border-b border-slate-800">{renderHsnBreakupTable('border-slate-800', '#F8FAFC')}</div>

          <div className="grid grid-cols-12">
            <div className="col-span-6 p-2.5 border-r border-slate-800 text-[9.5px] space-y-2">
              <div>
                <div className="font-bold">{invTr(lang, 'terms')}:</div>
                <div className="whitespace-pre-line text-slate-700">{voucher.terms || profile.defaultTerms}</div>
              </div>
              <div>
                <div className="font-bold">{invTr(lang, 'declaration')}:</div>
                <div className="text-slate-700">{invTr(lang, 'declaration_text')}</div>
              </div>
            </div>
            <div className="col-span-6 p-2.5 flex flex-col justify-between">
              {cfg.showBankDetails && bank && (
                <div className="text-[10px] font-mono space-y-0.5 mb-2">
                  <div className="font-bold font-sans">{invTr(lang, 'bank_details')}:</div>
                  <div>{invTr(lang, 'bank_name')}: {bank.bankName}</div>
                  <div>{invTr(lang, 'account_no')}: {bank.accountNo} · IFSC: {bank.ifsc}</div>
                </div>
              )}
              <div className="border-t border-slate-800 pt-2 flex items-end justify-between">
                {cfg.showUpiQr && <QrBox size={46} />}
                {renderDigitalSignatureBlock()}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Reusable HSN + Totals block for original 15 templates
  const renderTotalsAndHsn = (compact = false) => (
    <div className="grid grid-cols-12 gap-5 mb-5">
      <div className="col-span-7 space-y-3">
        {showTaxCol && hsnSummary.length > 0 && !compact && renderHsnBreakupTable()}
        <div>
          <div className="text-[10px] font-semibold uppercase text-slate-500">{invTr(lang, 'amount_in_words')}</div>
          <div className="font-semibold text-slate-900">{numberToIndianWords(voucher.grandTotal)}</div>
        </div>
        {voucher.notes && (
          <div className="text-[11px] text-slate-600">
            <strong>Notes:</strong> {voucher.notes}
          </div>
        )}
      </div>

      <div
        style={{ borderColor: tpl.borderColor }}
        className={`col-span-5 p-3.5 rounded border space-y-1.5 font-mono text-xs ${
          tid === 'premium_black_gold' ? 'bg-amber-50/40' : 'bg-slate-50/60'
        }`}
      >
        <div className="flex justify-between">
          <span className="text-slate-600">{invTr(lang, 'sub_total')}</span>
          <span>{formatINR(voucher.subTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600">{invTr(lang, 'gst')}</span>
          <span>{formatINR(voucher.taxTotal)}</span>
        </div>
        {voucher.additionalCharges !== 0 && (
          <div className="flex justify-between">
            <span className="text-slate-600">{invTr(lang, 'additional_charges')}</span>
            <span>{formatINR(voucher.additionalCharges)}</span>
          </div>
        )}
        {voucher.roundOff !== 0 && (
          <div className="flex justify-between">
            <span className="text-slate-600">{invTr(lang, 'round_off')}</span>
            <span>{formatINR(voucher.roundOff, true)}</span>
          </div>
        )}
        <div
          style={{ color: accent, borderColor: tpl.borderColor }}
          className="flex justify-between pt-2 border-t text-sm font-extrabold"
        >
          <span>{invTr(lang, 'grand_total')}</span>
          <span>{fmtAmt(voucher.grandTotal)}</span>
        </div>
        <div className="flex justify-between text-emerald-700 pt-1">
          <span>{invTr(lang, 'paid_received')}</span>
          <span>{formatINR(effectivePaid)}</span>
        </div>
        {printSet.showBalanceAmount && (
          <div className="flex justify-between font-bold text-slate-900">
            <span>{invTr(lang, 'balance_due')}</span>
            <span>{formatINR(balanceDue)}</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderFooter = () => (
    <>
      <div className="grid grid-cols-12 gap-4 pt-4 border-t border-slate-300 items-end">
        <div className="col-span-5 space-y-1">
          {cfg.showBankDetails && bank && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {invTr(lang, 'bank_details')}
              </div>
              <div className="font-mono text-[10px] text-slate-700 space-y-0.5">
                <div>{bank.bankName}</div>
                <div>
                  {invTr(lang, 'account_no')}: {bank.accountNo} · {invTr(lang, 'ifsc')}: {bank.ifsc}
                </div>
                <div>{invTr(lang, 'upi_id')}: {profile.upiId || bank.upiId}</div>
              </div>
            </>
          )}
        </div>

        <div className="col-span-3 flex flex-col items-center">
          {cfg.showUpiQr && <QrBox size={60} label={invTr(lang, 'scan_pay')} />}
        </div>

        <div className="col-span-4">{renderDigitalSignatureBlock()}</div>
      </div>

      {printSet.showTerms && (
        <div className="mt-4 pt-2.5 border-t border-slate-200 text-[10px] text-slate-500 whitespace-pre-line">
          <strong>{invTr(lang, 'terms')}: </strong>
          {voucher.terms || profile.defaultTerms}
        </div>
      )}
    </>
  );

  // =========================================================================
  // LAYOUT 4: MODERN GREEN — Left Vertical Sidebar Rail (30% Sidebar / 70% Main)
  // =========================================================================
  if (tid === 'modern_green') {
    return (
      <div
        id={elementId}
        className={`w-full ${isA5 ? 'max-w-[560px] text-[11px]' : 'max-w-[794px] text-xs'} bg-white text-slate-900 border border-emerald-200 shadow-sm mx-auto overflow-hidden grid grid-cols-12 ${fontClass}`}
      >
        <aside
          style={{ backgroundColor: tpl.headerBg }}
          className="col-span-4 text-white p-5 flex flex-col justify-between gap-6"
        >
          <div className="space-y-4">
            {printSet.showLogo && profile.logoDataUrl && (
              <img src={profile.logoDataUrl} alt={profile.companyName} className="w-12 h-12 rounded bg-white p-1 object-contain" />
            )}
            <div>
              {printSet.showCompanyName && <div className="text-base font-extrabold leading-tight">{profile.companyName}</div>}
              {printSet.showAddress && <div className="text-[10px] opacity-80 mt-1">{profile.address}</div>}
              {printSet.showGstin && <div className="text-[10px] font-mono opacity-90 mt-2">{invTr(lang, 'gstin')}: {profile.gstin || 'N/A'}</div>}
              {printSet.showPhone && <div className="text-[10px] font-mono opacity-90">{invTr(lang, 'phone')}: {profile.phone}</div>}
            </div>

            {cfg.showBankDetails && bank && (
              <div className="pt-3 border-t border-white/20 text-[10px] space-y-1">
                <div className="font-bold uppercase tracking-wider text-emerald-200">{invTr(lang, 'bank_details')}</div>
                <div>{bank.bankName}</div>
                <div className="font-mono">{invTr(lang, 'account_no')}: {bank.accountNo}</div>
                <div className="font-mono">{invTr(lang, 'ifsc')}: {bank.ifsc}</div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {cfg.showUpiQr && (
              <div className="bg-white text-slate-900 p-2 rounded-lg inline-flex flex-col items-center">
                <QrBox size={64} label={`UPI: ${profile.upiId || 'Pay Now'}`} />
              </div>
            )}
            <div className="text-[9px] opacity-75 border-t border-white/20 pt-2">
              {voucher.terms || profile.defaultTerms}
            </div>
          </div>
        </aside>

        <main className="col-span-8 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between border-b-2 border-emerald-100 pb-4 mb-4">
              <div>
                <div style={{ color: accent }} className="text-lg font-black uppercase tracking-wide">
                  {docTitle}
                </div>
                <div className="font-mono text-xs text-slate-500">#{voucher.voucherNo}</div>
              </div>
              <div className="text-right font-mono text-[11px]">
                <div>{invTr(lang, 'date')}: <strong>{voucher.date}</strong></div>
                {voucher.dueDate && <div>{invTr(lang, 'due_date')}: <strong>{voucher.dueDate}</strong></div>}
              </div>
            </div>

            <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-3 mb-4">
              <div className="text-[10px] font-bold uppercase text-emerald-800">{invTr(lang, 'bill_to')}</div>
              <div className="font-bold text-sm text-slate-900">{voucher.partyName || 'Cash Customer'}</div>
              {party?.billingAddress && <div className="text-slate-600">{party.billingAddress}</div>}
              <div className="font-mono text-[10px] text-slate-700 mt-1">
                {invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'Unregistered'} · {invTr(lang, 'place_of_supply')}: {voucher.placeOfSupply || profile.state}
              </div>
            </div>

            <table className="w-full border-collapse mb-4">
              <thead>
                <tr style={{ backgroundColor: tpl.tableHeaderBg, color: tpl.tableHeaderText }} className="text-[10px] border-y border-emerald-200">
                  <th className="py-1.5 px-2 text-left">{invTr(lang, 'item_description')}</th>
                  <th className="py-1.5 px-2 text-right">{invTr(lang, 'qty')}</th>
                  <th className="py-1.5 px-2 text-right">{invTr(lang, 'rate')}</th>
                  {showTaxCol && <th className="py-1.5 px-2 text-right">{invTr(lang, 'gst')}</th>}
                  <th className="py-1.5 px-2 text-right">{invTr(lang, 'amount')}</th>
                </tr>
              </thead>
              <tbody>
                {voucher.lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 text-[11px]">
                    <td className="py-1.5 px-2 font-medium">
                      {l.itemName}
                      {renderLineMeta(l)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{l.rate.toFixed(0)}</td>
                    {showTaxCol && <td className="py-1.5 px-2 text-right font-mono">{l.taxRate}%</td>}
                    <td className="py-1.5 px-2 text-right font-mono font-bold">{formatINR(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between bg-slate-50 border border-emerald-200 rounded-lg p-3 font-mono">
              <div>
                <div className="text-[10px] text-slate-500">{invTr(lang, 'taxable')}: {formatINR(voucher.subTotal)} · {invTr(lang, 'gst')}: {formatINR(voucher.taxTotal)}</div>
                <div className="text-[10px] font-sans text-slate-700 mt-0.5">{numberToIndianWords(voucher.grandTotal)}</div>
              </div>
              <div className="text-right">
                <div style={{ color: accent }} className="text-base font-black">{formatINR(voucher.grandTotal)}</div>
                {printSet.showBalanceAmount && (
                  <div className="text-[10px] text-slate-600">{invTr(lang, 'balance_due')}: {formatINR(balanceDue)}</div>
                )}
              </div>
            </div>
            {renderDigitalSignatureBlock(true)}
          </div>
        </main>
      </div>
    );
  }

  // =========================================================================
  // LAYOUT 9: MINIMAL BLACK & WHITE — Swiss Brutalist Asymmetric Grid
  // =========================================================================
  if (tid === 'minimal_bw') {
    return (
      <div id={elementId} className={`w-full ${widthClass} bg-white text-black border-2 border-black mx-auto ${fontClass}`}>
        <div className="grid grid-cols-12 border-b-2 border-black pb-4 mb-5">
          <div className="col-span-5 border-r-2 border-black pr-4">
            <div className="text-[10px] font-bold uppercase tracking-widest">{docTitle}</div>
            <div className="text-2xl font-black font-mono tracking-tight mt-1">#{voucher.voucherNo}</div>
            <div className="font-mono text-[11px] mt-2">{invTr(lang, 'date')}: {voucher.date}</div>
            {voucher.dueDate && <div className="font-mono text-[11px]">{invTr(lang, 'due_date')}: {voucher.dueDate}</div>}
          </div>
          <div className="col-span-7 pl-5 flex flex-col justify-between">
            <div>
              {printSet.showCompanyName && <div className="text-lg font-black uppercase tracking-tight">{profile.companyName}</div>}
              {printSet.showAddress && <div className="text-[11px] mt-1">{profile.address}</div>}
            </div>
            <div className="font-mono text-[10px] mt-2">{invTr(lang, 'gstin')}: {profile.gstin} · {profile.phone} · {profile.email}</div>
          </div>
        </div>

        <div className="grid grid-cols-12 border-b-2 border-black pb-4 mb-5">
          <div className="col-span-4 border-r-2 border-black pr-4">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1">{invTr(lang, 'bill_to')}</div>
            <div className="font-bold text-sm">{voucher.partyName || 'Cash Ledger'}</div>
            {party?.billingAddress && <div className="text-[11px] mt-0.5">{party.billingAddress}</div>}
            <div className="font-mono text-[10px] mt-1">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'N/A'}</div>
          </div>
          <div className="col-span-8 pl-5">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b-2 border-black text-left font-bold uppercase">
                  <th className="py-1.5">{invTr(lang, 'item_description')}</th>
                  <th className="py-1.5 text-right">{invTr(lang, 'qty')}</th>
                  <th className="py-1.5 text-right">{invTr(lang, 'rate')}</th>
                  {showTaxCol && <th className="py-1.5 text-right">{invTr(lang, 'gst')}</th>}
                  <th className="py-1.5 text-right">{invTr(lang, 'total')}</th>
                </tr>
              </thead>
              <tbody>
                {voucher.lines.map((l) => (
                  <tr key={l.id} className="border-b border-black/20">
                    <td className="py-2 pr-2 font-medium">
                      {l.itemName}
                      {renderLineMeta(l)}
                    </td>
                    <td className="py-2 text-right font-mono">{l.qty}{showUnit ? ` ${l.unit}` : ''}</td>
                    <td className="py-2 text-right font-mono">{l.rate.toFixed(2)}</td>
                    {showTaxCol && <td className="py-2 text-right font-mono">{l.taxRate}%</td>}
                    <td className="py-2 text-right font-mono font-bold">{formatINR(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4 items-center">
          <div className="col-span-7 text-[11px] space-y-1">
            <div className="font-bold uppercase text-[10px]">{invTr(lang, 'amount_in_words')}</div>
            <div>{numberToIndianWords(voucher.grandTotal)}</div>
            {cfg.showBankDetails && bank && <div className="font-mono text-[10px]">PAY TO: {bank.bankName} · {bank.accountNo} ({bank.ifsc})</div>}
            <div className="pt-1">{renderDigitalSignatureBlock(true)}</div>
          </div>
          <div className="col-span-5 border-2 border-black p-3 font-mono space-y-1">
            <div className="flex justify-between"><span>{invTr(lang, 'sub_total')}</span><span>{formatINR(voucher.subTotal)}</span></div>
            <div className="flex justify-between"><span>{invTr(lang, 'gst')}</span><span>{formatINR(voucher.taxTotal)}</span></div>
            <div className="flex justify-between text-base font-black border-t-2 border-black pt-1.5">
              <span>{invTr(lang, 'grand_total')}</span><span>{formatINR(voucher.grandTotal)}</span>
            </div>
            {printSet.showBalanceAmount && (
              <div className="flex justify-between text-[11px]"><span>{invTr(lang, 'balance_due')}</span><span>{formatINR(balanceDue)}</span></div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ALL OTHER 13 TEMPLATES — DISTINCT HEADERS, METADATA PANELS, TABLES & FOOTERS
  // =========================================================================
  const isCenteredMasthead = tid === 'classic_white' || tid === 'luxury_beige';
  const isGstRule46 = tid === 'gst_standard';
  const isEcommerce = tid === 'ecommerce_invoice';
  const isContractor = tid === 'contractor_invoice';
  const isService = tid === 'service_invoice';
  const isRetail = tid === 'retail_invoice';
  const isExecutiveTop = tid === 'executive_grey';
  const isDarkHero = tid === 'dark_modern';
  const isFloatingCards = tid === 'corporate_blue' || tid === 'modern_orange';

  const mrpSavings = voucher.lines.reduce((s, l) => s + (l.qty * l.rate * l.discountPct) / 100, 0);

  return (
    <div
      id={elementId}
      style={{
        backgroundColor: tpl.pageBg,
        borderColor: tpl.borderColor,
      }}
      className={`w-full ${widthClass} text-slate-900 border mx-auto ${fontClass} ${
        tid === 'classic_white' ? 'ring-1 ring-inset ring-slate-800 p-6' : 'shadow-sm'
      }`}
    >
      {/* MASTHEAD VARIATIONS */}
      {isCenteredMasthead ? (
        <div
          style={{ backgroundColor: tpl.headerBg, color: tpl.headerText, borderColor: tpl.borderColor }}
          className="text-center p-5 border-b-2 mb-5"
        >
          {printSet.showLogo && profile.logoDataUrl && (
            <img src={profile.logoDataUrl} alt={profile.companyName} className="w-12 h-12 mx-auto mb-2 object-contain" />
          )}
          {printSet.showCompanyName && <div className="text-xl font-extrabold tracking-wide uppercase">{profile.companyName}</div>}
          {printSet.showAddress && <div className="text-[11px] opacity-80 mt-0.5">{profile.address}</div>}
          <div className="font-mono text-[11px] opacity-90 mt-1">
            {printSet.showGstin && <><strong>{invTr(lang, 'gstin')}: {profile.gstin || 'N/A'}</strong> · </>}
            {invTr(lang, 'pan')}: {profile.pan} · {printSet.showPhone && <>{invTr(lang, 'phone')}: {profile.phone}</>}
          </div>
          <div
            style={{ color: accent, borderColor: tpl.borderColor }}
            className="inline-block mt-3 px-4 py-1 border-y font-bold tracking-widest uppercase text-xs"
          >
            {docTitle} · #{voucher.voucherNo} · {voucher.date}
          </div>
        </div>
      ) : tid === 'creative_premium' ? (
        <div className="grid grid-cols-12 rounded-lg overflow-hidden border mb-5" style={{ borderColor: tpl.borderColor }}>
          <div className="col-span-7 p-5 bg-indigo-50/70 text-indigo-950">
            <div className="flex items-center gap-3">
              {printSet.showLogo && profile.logoDataUrl && <img src={profile.logoDataUrl} alt="" className="w-10 h-10 object-contain rounded bg-white p-1" />}
              <div>
                {printSet.showCompanyName && <div className="text-lg font-extrabold">{profile.companyName}</div>}
                <div className="text-[10px] opacity-80">{profile.tagline}</div>
              </div>
            </div>
            {printSet.showAddress && <div className="text-[11px] mt-2 opacity-85">{profile.address}</div>}
            <div className="font-mono text-[10px] mt-1 font-semibold">{invTr(lang, 'gstin')}: {profile.gstin} · {profile.phone}</div>
          </div>
          <div style={{ backgroundColor: accent }} className="col-span-5 p-5 text-white flex flex-col justify-between text-right">
            <div className="text-[10px] font-bold tracking-widest uppercase opacity-80">{docTitle}</div>
            <div>
              <div className="text-lg font-black font-mono">#{voucher.voucherNo}</div>
              <div className="text-[11px] opacity-90">{invTr(lang, 'date')}: {voucher.date}</div>
              {voucher.dueDate && <div className="text-[11px] opacity-90">{invTr(lang, 'due_date')}: {voucher.dueDate}</div>}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: tpl.headerBg,
            color: tpl.headerText,
            borderColor: tpl.borderColor,
          }}
          className={`p-5 border-b-2 flex items-start justify-between gap-4 mb-5 ${
            tid === 'premium_black_gold' ? 'border-2 border-amber-500 rounded-md' : 'rounded-t-md'
          }`}
        >
          <div className="flex items-start gap-3.5 max-w-md">
            {printSet.showLogo && profile.logoDataUrl && (
              <img
                src={profile.logoDataUrl}
                alt={profile.companyName}
                className="w-12 h-12 rounded object-contain bg-white p-1 shrink-0"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="space-y-0.5">
              {tid === 'premium_black_gold' && (
                <div className="inline-block px-2 py-0.5 border border-amber-400 text-amber-300 text-[9px] font-bold tracking-widest uppercase mb-1">
                  ★ VIP CERTIFIED INVOICE ★
                </div>
              )}
              {printSet.showCompanyName && <div className="text-lg font-extrabold tracking-tight">{profile.companyName}</div>}
              {profile.tagline && <div className="opacity-85 text-[11px]">{profile.tagline}</div>}
              {printSet.showAddress && <div className="opacity-85 text-[11px]">{profile.address}</div>}
              <div className="font-mono text-[11px] opacity-90">
                {printSet.showGstin && <>{invTr(lang, 'gstin')}: <strong>{profile.gstin || 'N/A'}</strong> · </>}
                {profile.state} · {printSet.showPhone ? profile.phone : ''}
              </div>
            </div>
          </div>

          <div className="text-right space-y-1 shrink-0">
            <div style={tpl.headerBg === '#FFFFFF' ? { color: accent } : undefined} className="text-xs font-extrabold uppercase tracking-wider">
              {docTitle}
            </div>
            <div className="font-mono text-sm font-bold">#{voucher.voucherNo}</div>
            {isDarkHero ? (
              <div className="pt-1">
                <div className="text-[9px] uppercase tracking-wider opacity-75">{invTr(lang, 'grand_total')}</div>
                <div className="text-xl font-black font-mono text-amber-300">{formatINR(voucher.grandTotal)}</div>
                <div className="text-[10px] font-mono opacity-80">{invTr(lang, 'date')}: {voucher.date}</div>
              </div>
            ) : (
              <>
                <div className="font-mono text-[11px] opacity-85">{invTr(lang, 'date')}: {voucher.date}</div>
                {voucher.dueDate && <div className="font-mono text-[11px] opacity-85">{invTr(lang, 'due_date')}: {voucher.dueDate}</div>}
              </>
            )}
          </div>
        </div>
      )}

      {/* CORPORATE BLUE / MODERN ORANGE: FLOATING METADATA CARDS */}
      {isFloatingCards && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-2.5 rounded-lg border bg-slate-50" style={{ borderColor: tpl.borderColor }}>
            <div className="text-[9px] font-bold uppercase text-slate-500">{invTr(lang, 'invoice_no')} &amp; {invTr(lang, 'date')}</div>
            <div className="font-mono font-bold text-slate-900">{voucher.voucherNo}</div>
            <div className="text-[10px] text-slate-600">{voucher.date}</div>
          </div>
          <div className="p-2.5 rounded-lg border bg-slate-50" style={{ borderColor: tpl.borderColor }}>
            <div className="text-[9px] font-bold uppercase text-slate-500">{invTr(lang, 'bill_to')}</div>
            <div className="font-bold text-slate-900 truncate">{voucher.partyName || 'Cash Ledger'}</div>
            <div className="text-[10px] text-slate-600">{voucher.placeOfSupply || profile.state}</div>
          </div>
          <div className="p-2.5 rounded-lg border bg-slate-50 text-right" style={{ borderColor: tpl.borderColor }}>
            <div className="text-[9px] font-bold uppercase text-slate-500">{invTr(lang, 'grand_total')}</div>
            <div style={{ color: accent }} className="font-mono font-black text-sm">{formatINR(voucher.grandTotal)}</div>
            <div className="text-[10px] text-emerald-700 font-semibold">{invTr(lang, 'paid_received')}: {formatINR(effectivePaid)}</div>
          </div>
        </div>
      )}

      {/* EXECUTIVE GREY: SUMMARY-FIRST TOP PANEL */}
      {isExecutiveTop && (
        <div className="grid grid-cols-12 gap-3 bg-slate-100 border border-slate-300 rounded-lg p-3.5 mb-5 items-center">
          <div className="col-span-9 grid grid-cols-4 gap-3 font-mono">
            <div>
              <div className="text-[9px] font-sans uppercase font-bold text-slate-500">{invTr(lang, 'taxable')}</div>
              <div className="text-xs font-bold">{formatINR(voucher.subTotal)}</div>
            </div>
            <div>
              <div className="text-[9px] font-sans uppercase font-bold text-slate-500">{invTr(lang, 'gst')}</div>
              <div className="text-xs font-bold">{formatINR(voucher.taxTotal)}</div>
            </div>
            <div>
              <div className="text-[9px] font-sans uppercase font-bold text-slate-500">{invTr(lang, 'grand_total')}</div>
              <div className="text-sm font-black text-slate-900">{formatINR(voucher.grandTotal)}</div>
            </div>
            <div>
              <div className="text-[9px] font-sans uppercase font-bold text-slate-500">{invTr(lang, 'balance_due')}</div>
              <div className="text-xs font-bold text-red-700">{formatINR(balanceDue)}</div>
            </div>
            <div className="col-span-4 text-[10px] font-sans text-slate-600 border-t border-slate-200 pt-1.5">
              <strong>{invTr(lang, 'amount_in_words')}:</strong> {numberToIndianWords(voucher.grandTotal)}
            </div>
          </div>
          <div className="col-span-3 flex justify-end">{cfg.showUpiQr && <QrBox size={54} />}</div>
        </div>
      )}

      {/* BILL TO / E-COMMERCE 3-COL / CONTRACTOR WORK ORDER */}
      {isEcommerce ? (
        <div className="grid grid-cols-3 gap-4 pb-4 mb-4 border-b border-indigo-200 text-[11px]">
          <div className="p-2.5 rounded bg-indigo-50/40 border border-indigo-100">
            <div className="text-[9px] font-bold uppercase text-indigo-800 mb-1">{invTr(lang, 'bill_to')}</div>
            <div className="font-bold">{voucher.partyName}</div>
            <div className="text-slate-600">{party?.billingAddress || profile.state}</div>
            <div className="font-mono text-[10px] mt-1">{invTr(lang, 'gstin')}: {voucher.partyGstin || party?.gstin || 'Unreg'}</div>
          </div>
          <div className="p-2.5 rounded bg-indigo-50/40 border border-indigo-100">
            <div className="text-[9px] font-bold uppercase text-indigo-800 mb-1">{invTr(lang, 'ship_to')}</div>
            <div className="font-bold">{voucher.partyName}</div>
            <div className="text-slate-600">{party?.shippingAddress || party?.billingAddress || profile.state}</div>
            <div className="text-[10px] mt-1">{invTr(lang, 'phone')}: {party?.phone || '-'}</div>
          </div>
          <div className="p-2.5 rounded bg-indigo-50/40 border border-indigo-100 font-mono text-[10px] space-y-1">
            <div className="text-[9px] font-sans font-bold uppercase text-indigo-800">Dispatch &amp; AWB</div>
            <div>Channel: {voucher.salesChannel || 'Online Store'}</div>
            <div>AWB: {voucher.trackingNo || `AWB-${voucher.voucherNo}`}</div>
            <div>{invTr(lang, 'payment_mode')}: {voucher.paymentMode || 'Prepaid'}</div>
            <div>Status: {voucher.shipmentStatus || 'Dispatched'}</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 pb-4 mb-4 border-b border-slate-200 px-1">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {isContractor ? 'Client & Project Site' : isService ? 'Client / Engagement Entity' : invTr(lang, 'bill_to')}
            </div>
            <div className="text-sm font-bold text-slate-900">{voucher.partyName || 'Cash / General Ledger'}</div>
            {party?.billingAddress && <div className="text-slate-700">{party.billingAddress}</div>}
            {party?.phone && <div className="font-mono text-slate-600">{invTr(lang, 'phone')}: {party.phone}</div>}
            {(voucher.partyGstin || party?.gstin) && (
              <div className="font-mono">
                {invTr(lang, 'gstin')}: <strong>{voucher.partyGstin || party?.gstin}</strong>
              </div>
            )}
            <div className="text-slate-600">
              {invTr(lang, 'place_of_supply')}: <strong>{voucher.placeOfSupply || profile.state}</strong> (
              {voucher.isInterState ? invTr(lang, 'igst') : `${invTr(lang, 'cgst')} + ${invTr(lang, 'sgst')}`})
            </div>
          </div>

          <div className="space-y-1 text-right">
            {isContractor && (
              <div className="font-mono text-[11px] bg-slate-100 inline-block px-2.5 py-1 rounded border border-slate-300">
                Work Order: <strong>WO-{voucher.voucherNo}</strong>
              </div>
            )}
            {voucher.ewayBillNo && <div className="font-mono">{invTr(lang, 'e_way_bill')}: <strong>{voucher.ewayBillNo}</strong></div>}
            {voucher.vehicleNo && <div className="font-mono">{invTr(lang, 'vehicle_no')}: <strong>{voucher.vehicleNo}</strong></div>}
            {voucher.paymentMode && <div>{invTr(lang, 'payment_mode')}: <strong>{voucher.paymentMode}</strong></div>}
            {voucher.isReverseCharge && <div className="text-amber-700 font-semibold">{invTr(lang, 'reverse_charge')}: YES</div>}
            {voucher.irn && (
              <div className="flex flex-col items-end pt-1">
                <QrBox size={46} seedGrid={irnQrGrid} label={`IRN: ${voucher.irn.slice(0, 14)}...`} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* SERVICE INVOICE SAC ENGAGEMENT BANNER */}
      {isService && (
        <div className="p-3 mb-4 rounded-lg bg-teal-50/70 border border-teal-200 text-teal-950 flex items-center justify-between text-[11px]">
          <div>
            <strong>Engagement / SAC Advisory Scope:</strong> {voucher.notes || 'Professional Consulting, Implementation & Technical Services'}
          </div>
          <span className="font-mono font-bold">SAC 9983/9987</span>
        </div>
      )}

      {/* ITEM TABLE VARIATIONS */}
      {voucher.lines.length > 0 ? (
        <table className={`w-full border-collapse mb-4 ${isGstRule46 || tid === 'classic_white' ? 'border border-slate-700' : ''}`}>
          <thead>
            <tr
              style={{
                backgroundColor: tpl.tableHeaderBg,
                color: tpl.tableHeaderText,
                borderColor: tpl.borderColor,
              }}
              className={`border-y text-[11px] ${isGstRule46 ? 'border-slate-800' : ''}`}
            >
              <th className="py-2 px-2 text-left">{invTr(lang, 'sr_no')}</th>
              <th className="py-2 px-2 text-left">
                {isContractor ? 'BOQ Item / Milestone Work' : isService ? 'Service / Engagement Scope' : invTr(lang, 'item_description')}
              </th>
              {(cfg.showHsn || isGstRule46) && (
                <th className="py-2 px-2 text-left">{isService ? 'SAC' : invTr(lang, 'hsn_sac')}</th>
              )}
              <th className="py-2 px-2 text-right">{isService ? 'Units' : invTr(lang, 'qty')}</th>
              {showMrpCol && <th className="py-2 px-2 text-right">{itemSet.mrpLabel || invTr(lang, 'mrp')}</th>}
              <th className="py-2 px-2 text-right">{isService ? 'Fee' : invTr(lang, 'rate')}</th>
              {showDiscCol && !isGstRule46 && !isService && (
                <th className="py-2 px-2 text-right">{invTr(lang, 'disc')}</th>
              )}
              <th className="py-2 px-2 text-right">{invTr(lang, 'taxable')}</th>
              {isGstRule46 ? (
                voucher.isInterState ? (
                  <>
                    <th className="py-2 px-1.5 text-right">{invTr(lang, 'igst')}%</th>
                    <th className="py-2 px-1.5 text-right">{invTr(lang, 'igst')}</th>
                  </>
                ) : (
                  <>
                    <th className="py-2 px-1.5 text-right">{invTr(lang, 'cgst')}</th>
                    <th className="py-2 px-1.5 text-right">{invTr(lang, 'sgst')}</th>
                  </>
                )
              ) : (
                showTaxCol && <th className="py-2 px-2 text-right">{invTr(lang, 'gst')}</th>
              )}
              <th className="py-2 px-2 text-right">{invTr(lang, 'total')}</th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((line, idx) => (
              <tr
                key={line.id}
                className={
                  tid === 'luxury_beige'
                    ? 'border-b border-amber-200/60'
                    : isGstRule46
                    ? 'border-b border-slate-400'
                    : 'border-b border-slate-200'
                }
              >
                <td className="py-2 px-2 font-mono text-slate-500">{idx + 1}</td>
                <td className="py-2 px-2 font-medium text-slate-900">
                  {line.itemName}
                  {renderLineMeta(line)}
                </td>
                {(cfg.showHsn || isGstRule46) && (
                  <td className="py-2 px-2 font-mono text-slate-600">{line.hsn}</td>
                )}
                <td className="py-2 px-2 text-right font-mono">
                  {line.qty}{showUnit ? ` ${line.unit}` : ''}
                </td>
                {showMrpCol && (
                  <td className="py-2 px-2 text-right font-mono">{(line.mrp || line.rate).toFixed(2)}</td>
                )}
                <td className="py-2 px-2 text-right font-mono">{line.rate.toFixed(2)}</td>
                {showDiscCol && !isGstRule46 && !isService && (
                  <td className="py-2 px-2 text-right font-mono">{line.discountPct}%</td>
                )}
                <td className="py-2 px-2 text-right font-mono">{line.taxableAmount.toFixed(2)}</td>
                {isGstRule46 ? (
                  voucher.isInterState ? (
                    <>
                      <td className="py-2 px-1.5 text-right font-mono">{line.taxRate}%</td>
                      <td className="py-2 px-1.5 text-right font-mono">{line.igst.toFixed(2)}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 px-1.5 text-right font-mono">{line.cgst.toFixed(2)}</td>
                      <td className="py-2 px-1.5 text-right font-mono">{line.sgst.toFixed(2)}</td>
                    </>
                  )
                ) : (
                  showTaxCol && (
                    <td className="py-2 px-2 text-right font-mono">
                      {line.taxRate}% ({formatINR(line.cgst + line.sgst + line.igst)})
                    </td>
                  )
                )}
                <td className="py-2 px-2 text-right font-mono font-semibold">{formatINR(line.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="p-4 border border-slate-200 rounded mb-4 bg-slate-50">
          <div className="font-semibold">Voucher Narration</div>
          <div className="text-slate-700 mt-1">{voucher.notes || docTitle}</div>
        </div>
      )}

      {/* RETAIL MRP SAVINGS BANNER */}
      {isRetail && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 mb-4 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-mono">
          <span>
            <strong>Total Store Savings (Discounts):</strong> {formatINR(mrpSavings)}
          </span>
          <span>
            <strong>Tender:</strong> {voucher.paymentMode || 'Cash'} · {invTr(lang, 'paid_received')} {formatINR(effectivePaid)}
          </span>
        </div>
      )}

      {/* CONTRACTOR RETENTION SUMMARY */}
      {isContractor && (
        <div className="p-2.5 mb-4 rounded bg-slate-100 border border-slate-300 text-[11px] flex justify-between font-mono">
          <span>Contract Certification: 100% Milestone Verified</span>
          <span>5% Reference Retention Info: {formatINR(voucher.grandTotal * 0.05)}</span>
        </div>
      )}

      {renderTotalsAndHsn(isExecutiveTop)}
      {renderFooter()}

      {/* E-COMMERCE TEAR-OFF DISPATCH SLIP */}
      {isEcommerce && (
        <div className="mt-5 pt-3 border-t-2 border-dashed border-indigo-300 flex items-center justify-between text-[10px] font-mono text-slate-600">
          <div>
            <strong>PACKAGE DISPATCH SLIP (TEAR OFF):</strong> Order #{voucher.voucherNo} · Consignee: {voucher.partyName}
          </div>
          <div>
            AWB: {voucher.trackingNo || `AWB-${voucher.voucherNo}`} · Total: {formatINR(voucher.grandTotal)}
          </div>
        </div>
      )}
    </div>
  );
};
