import React, { useState } from 'react';
import { Printer, X, MessageSquare, Mail, FileDown, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { InvoiceTemplateId, PaperFormat, Voucher } from '../types/accounting';
import { useStore } from '../context/StoreContext';
import { formatINR, INVOICE_TEMPLATES, VOUCHER_LABELS } from '../utils/formatters';
import { downloadInvoicePDF, getInvoicePdfBase64 } from '../utils/pdfGenerator';
import { generateInvoicePngBase64 } from '../utils/invoiceImageGenerator';
import { InvoiceRenderer } from './InvoiceRenderer';

interface InvoicePrintModalProps {
  voucher: Voucher;
  onClose: () => void;
}

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({ voucher, onClose }) => {
  const { db, getEffectivePaid, sendTransactionWhatsApp } = useStore();
  const [templateId, setTemplateId] = useState<InvoiceTemplateId>(
    db?.profile.invoiceConfig.templateId || 'corporate_blue'
  );
  const [paperFormat, setPaperFormat] = useState<PaperFormat>(
    db?.profile.invoiceConfig.paperFormat || 'A4'
  );

  const party = db?.parties.find((p) => p.id === voucher.partyId);
  const [waPhoneInput, setWaPhoneInput] = useState<string>(party?.phone || '');
  const [showWaSender, setShowWaSender] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waFeedback, setWaFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (!db) return null;

  const bank =
    db.bankAccounts.find((b) => b.id === voucher.bankAccountId) ||
    db.bankAccounts.find((b) => b.type === 'bank') ||
    db.bankAccounts[0];

  const effectivePaid = getEffectivePaid(voucher);
  const balanceDue = Math.max(0, voucher.grandTotal - effectivePaid);
  const tplMeta = INVOICE_TEMPLATES.find((t) => t.id === templateId) || INVOICE_TEMPLATES[1];

  const activeConfig = {
    ...db.profile.invoiceConfig,
    templateId,
    paperFormat,
    accentColor:
      templateId === db.profile.invoiceConfig.templateId
        ? db.profile.invoiceConfig.accentColor
        : tplMeta.defaultAccent,
  };

  const handleDownloadPdf = () => {
    downloadInvoicePDF(voucher, db.profile, party, bank, effectivePaid, activeConfig);
  };

  const buildShareText = () =>
    `Hello ${voucher.partyName || 'Customer'},\nDetails for ${
      VOUCHER_LABELS[voucher.type]
    } *${voucher.voucherNo}* dated ${voucher.date} from *${db.profile.companyName}*:\nTotal: ${formatINR(
      voucher.grandTotal
    )}\nPaid: ${formatINR(effectivePaid)}\nBalance Due: ${formatINR(balanceDue)}\n${
      balanceDue > 0 && db.profile.upiId ? `Pay via UPI: ${db.profile.upiId}` : 'Thank you!'
    }`;

  const handleWhatsAppShare = () => {
    const phone = (waPhoneInput || party?.phone || '').replace(/\D/g, '');
    const text = buildShareText();
    const url = phone
      ? `https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSendViaLinkedWhatsApp = async (mode: 'pdf' | 'image' | 'both') => {
    setWaFeedback(null);
    const cleaned = waPhoneInput.replace(/\D/g, '');
    if (cleaned.length < 10) {
      setShowWaSender(true);
      setWaFeedback({ type: 'err', text: 'Enter a valid 10-digit WhatsApp number to send.' });
      return;
    }
    setWaSending(true);
    try {
      const pdfObj =
        mode === 'pdf' || mode === 'both'
          ? getInvoicePdfBase64(voucher, db.profile, party, bank, effectivePaid, activeConfig)
          : undefined;
      const imageBase64 =
        mode === 'image' || mode === 'both'
          ? generateInvoicePngBase64(voucher, db.profile, party, bank, effectivePaid)
          : undefined;
      const res = await sendTransactionWhatsApp({
        phone: cleaned,
        text: buildShareText(),
        pdfBase64: pdfObj?.base64,
        pdfFileName: pdfObj?.fileName || `${voucher.voucherNo.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
        imageBase64,
        copyToSelf: Boolean(db.profile.appSettings?.message?.sendCopyToSelf),
      });
      setWaFeedback({ type: 'ok', text: res.message || 'Sent via Linked WhatsApp.' });
    } catch (err) {
      setWaFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setWaSending(false);
    }
  };

  const handleEmailShare = () => {
    const subject = `${VOUCHER_LABELS[voucher.type]} ${voucher.voucherNo} from ${db.profile.companyName}`;
    const body = `Dear ${voucher.partyName || 'Customer'},\n\nPlease find the summary for ${
      VOUCHER_LABELS[voucher.type]
    } #${voucher.voucherNo} dated ${voucher.date}:\nGrand Total: ${formatINR(
      voucher.grandTotal
    )}\nPaid: ${formatINR(effectivePaid)}\nBalance Due: ${formatINR(balanceDue)}\n\nRegards,\n${
      db.profile.companyName
    }`;
    window.location.href = `mailto:${encodeURIComponent(party?.email || '')}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 overflow-y-auto">
      <div className="w-full max-w-5xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl flex flex-col max-h-[94vh]">
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value as InvoiceTemplateId)}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              {INVOICE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.layoutTag}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              {(['A4', 'A5', 'thermal_80mm'] as PaperFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setPaperFormat(fmt)}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                    paperFormat === fmt
                      ? 'bg-[#168C88] text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {fmt === 'thermal_80mm' ? '80mm Thermal' : fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowWaSender((p) => !p)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#16A34A] hover:bg-emerald-700 text-white whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              Send PDF / Image (WA QR)
            </button>
            <button
              onClick={handleWhatsAppShare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              WA Web
            </button>
            <button
              onClick={handleEmailShare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Mail className="w-3.5 h-3.5" />
              Email
            </button>
            <button
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white whitespace-nowrap"
            >
              <FileDown className="w-3.5 h-3.5" />
              Download PDF
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showWaSender && (
          <div className="no-print px-5 py-3 bg-[#E5EFF3] dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-[#243746] dark:text-white">
                Send via Linked WhatsApp:
              </span>
              <input
                type="tel"
                value={waPhoneInput}
                onChange={(e) => setWaPhoneInput(e.target.value)}
                placeholder="Customer Mobile (10-digit)"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono w-44"
              />
              <button
                type="button"
                disabled={waSending}
                onClick={() => void handleSendViaLinkedWhatsApp('pdf')}
                className="px-3 py-1.5 rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white font-semibold disabled:opacity-50"
              >
                {waSending ? 'Sending...' : 'Send PDF'}
              </button>
              <button
                type="button"
                disabled={waSending}
                onClick={() => void handleSendViaLinkedWhatsApp('image')}
                className="px-3 py-1.5 rounded-lg bg-[#2676A8] hover:bg-sky-700 text-white font-semibold disabled:opacity-50"
              >
                Send Image
              </button>
              <button
                type="button"
                disabled={waSending}
                onClick={() => void handleSendViaLinkedWhatsApp('both')}
                className="px-3 py-1.5 rounded-lg bg-[#16A34A] hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
              >
                Send PDF + Image
              </button>
            </div>
            {waFeedback && (
              <div
                className={`inline-flex items-center gap-1.5 font-semibold ${
                  waFeedback.type === 'ok' ? 'text-[#16A34A]' : 'text-[#EF4444]'
                }`}
              >
                {waFeedback.type === 'ok' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}
                <span>{waFeedback.text}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-[#F3F5F7] dark:bg-slate-950 p-6">
          <InvoiceRenderer
            voucher={voucher}
            profile={db.profile}
            party={party}
            bank={bank}
            effectivePaid={effectivePaid}
            configOverride={activeConfig}
          />
        </div>
      </div>
    </div>
  );
};
