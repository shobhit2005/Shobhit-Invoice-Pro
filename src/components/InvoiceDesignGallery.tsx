import React, { useState } from 'react';
import { Check, Upload, Save, Printer, FileDown } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { InvoiceDesignConfig, PaperFormat } from '../types/accounting';
import { INVOICE_TEMPLATES } from '../utils/formatters';
import { downloadInvoicePDF } from '../utils/pdfGenerator';
import { InvoiceRenderer } from './InvoiceRenderer';

export const InvoiceDesignGallery: React.FC = () => {
  const { db, updateProfile, getEffectivePaid } = useStore();
  const [config, setConfig] = useState<InvoiceDesignConfig>(
    db?.profile.invoiceConfig || {
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
    }
  );
  const [logoDataUrl, setLogoDataUrl] = useState<string>(db?.profile.logoDataUrl || '');
  const [savedToast, setSavedToast] = useState(false);

  if (!db) return null;

  const sampleVoucher =
    db.vouchers.find((v) => v.type === 'sale_invoice' && v.lines.length > 0) || db.vouchers[0];

  const party = sampleVoucher ? db.parties.find((p) => p.id === sampleVoucher.partyId) : undefined;
  const bank = db.bankAccounts.find((b) => b.type === 'bank') || db.bankAccounts[0];

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setLogoDataUrl(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveDefault = async () => {
    await updateProfile({
      ...db.profile,
      logoDataUrl,
      invoiceConfig: config,
    });
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const handleDownloadSamplePdf = () => {
    if (!sampleVoucher) return;
    downloadInvoicePDF(
      sampleVoucher,
      { ...db.profile, logoDataUrl },
      party,
      bank,
      getEffectivePaid(sampleVoucher),
      config
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            24 Distinct Invoice Formats &amp; Customizer
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Includes all classic &amp; pro billing themes, RZ Navy, Export Grid, Sharma Monogram, Saffron Box, Teal Freight, Sunstar Seal &amp; Hindi/English Print
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {savedToast && (
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Default template saved
            </span>
          )}
          {sampleVoucher && (
            <button
              onClick={handleDownloadSamplePdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30"
            >
              <FileDown className="w-3.5 h-3.5" />
              Download Sample PDF
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
          <button
            onClick={handleSaveDefault}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Save className="w-3.5 h-3.5" />
            Save as Default
          </button>
        </div>
      </div>

      {/* 15 Distinct Format Selector Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {INVOICE_TEMPLATES.map((tpl) => {
          const selected = config.templateId === tpl.id;
          return (
            <button
              key={tpl.id}
              onClick={() =>
                setConfig((prev) => ({
                  ...prev,
                  templateId: tpl.id,
                  accentColor: tpl.defaultAccent,
                }))
              }
              className={`text-left p-3 rounded-xl border transition-colors flex flex-col justify-between gap-2 ${
                selected
                  ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/30'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
              }`}
            >
              <div
                className="w-full h-8 rounded flex items-center justify-between px-2.5 text-[10px] font-bold"
                style={{
                  backgroundColor: tpl.headerBg,
                  color: tpl.headerText,
                  border: `1px solid ${tpl.borderColor}`,
                }}
              >
                <span className="truncate">{tpl.layoutTag}</span>
                {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{tpl.name}</div>
                <div className="text-[10px] text-slate-500 line-clamp-2">{tpl.subtitle}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Customizer Controls + Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-4 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Template Customization</h2>

          <div>
            <label className="block font-medium text-slate-500 mb-1">Paper / Printer Format</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['A4', 'A5', 'thermal_80mm'] as PaperFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setConfig((prev) => ({ ...prev, paperFormat: fmt }))}
                  className={`py-2 px-2 rounded-lg border font-medium ${
                    config.paperFormat === fmt
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {fmt === 'thermal_80mm' ? '80mm Thermal' : fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-500 mb-1">Accent Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.accentColor}
                  onChange={(e) => setConfig((prev) => ({ ...prev, accentColor: e.target.value }))}
                  className="h-8 w-10 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
                />
                <span className="font-mono text-[11px]">{config.accentColor}</span>
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-500 mb-1">Typography</label>
              <select
                value={config.fontFamily}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    fontFamily: e.target.value as InvoiceDesignConfig['fontFamily'],
                  }))
                }
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value="sans">DM Sans (Clean)</option>
                <option value="display">Plus Jakarta Sans</option>
                <option value="mono">JetBrains Mono</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-500 mb-1">Business Logo</label>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                <Upload className="w-3.5 h-3.5" />
                Upload Logo
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </label>
              {logoDataUrl && (
                <button onClick={() => setLogoDataUrl('')} className="text-red-600 hover:underline">
                  Remove
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-500 mb-1">Company Stamp Text</label>
            <input
              type="text"
              value={config.stampText}
              onChange={(e) => setConfig((prev) => ({ ...prev, stampText: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-700 dark:text-slate-300">Show / Hide Elements</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'showHsn', label: 'HSN / SAC Column' },
                { key: 'showDiscount', label: 'Discount %' },
                { key: 'showTaxColumns', label: 'GST Breakup' },
                { key: 'showBatch', label: 'Batch Number' },
                { key: 'showUpiQr', label: 'UPI Payment QR' },
                { key: 'showBankDetails', label: 'Bank Details' },
                { key: 'showStamp', label: 'Company Stamp' },
                { key: 'showRoundSeal', label: 'Round Seal' },
                { key: 'showSignature', label: 'Digital Signatory' },
              ].map((toggle) => (
                <label key={toggle.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(config[toggle.key as keyof InvoiceDesignConfig])}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, [toggle.key]: e.target.checked }))
                    }
                  />
                  <span>{toggle.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Live Preview Canvas */}
        <div className="lg:col-span-8 p-5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
          {sampleVoucher ? (
            <InvoiceRenderer
              voucher={sampleVoucher}
              profile={{ ...db.profile, logoDataUrl }}
              party={party}
              bank={bank}
              effectivePaid={getEffectivePaid(sampleVoucher)}
              configOverride={config}
            />
          ) : (
            <div className="py-16 text-center text-xs text-slate-500">
              Create at least one invoice to preview the live template design.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
