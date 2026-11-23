import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { sqlite } from './db.ts';
import { getAnyConnectedWhatsAppCompanyId, getWhatsAppStatus, sendWhatsAppMessage } from './whatsappService.ts';
import type { OtpIntegrationConfig } from '../src/types/accounting.ts';

const DEFAULT_OTP_CONFIG: OtpIntegrationConfig = {
  smsProvider: 'builtin',
  smsApiKey: '',
  smsSenderId: 'SHOBIT',
  smsTemplateId: '',
  twilioAccountSid: '',
  twilioAuthToken: '',
  twilioFromNumber: '',
  customWebhookUrl: '',
  emailEnabled: false,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: '',
  whatsappOtpEnabled: true,
  firebasePhoneEnabled: false,
};

export function normalizeOtpTarget(target: string, channel: 'phone' | 'email'): string {
  const clean = String(target || '').trim();
  if (channel === 'email') return clean.toLowerCase();
  const digits = clean.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : clean;
}

export function getStoredOtpConfig(): OtpIntegrationConfig {
  const row = sqlite
    .prepare(`SELECT otp_config_json FROM saas_settings WHERE id = 'global'`)
    .get() as { otp_config_json?: string } | undefined;
  let parsed: Partial<OtpIntegrationConfig> = {};
  try {
    parsed = JSON.parse(row?.otp_config_json || '{}');
  } catch {
    parsed = {};
  }
  return { ...DEFAULT_OTP_CONFIG, ...parsed };
}

export function getPublicOtpConfig(): OtpIntegrationConfig {
  const cfg = getStoredOtpConfig();
  return {
    smsProvider: cfg.smsProvider || 'builtin',
    smsSenderId: cfg.smsSenderId || 'SHOBIT',
    smsTemplateId: cfg.smsTemplateId || '',
    twilioAccountSid: cfg.twilioAccountSid || '',
    twilioFromNumber: cfg.twilioFromNumber || '',
    customWebhookUrl: cfg.customWebhookUrl || '',
    emailEnabled: Boolean(cfg.emailEnabled),
    smtpHost: cfg.smtpHost || 'smtp.gmail.com',
    smtpPort: Number(cfg.smtpPort || 587),
    smtpSecure: Boolean(cfg.smtpSecure),
    smtpUser: cfg.smtpUser || '',
    smtpFrom: cfg.smtpFrom || '',
    whatsappOtpEnabled: cfg.whatsappOtpEnabled ?? true,
    firebasePhoneEnabled: Boolean(cfg.firebasePhoneEnabled),
    hasSmsApiKey: Boolean(cfg.smsApiKey),
    hasTwilioAuthToken: Boolean(cfg.twilioAuthToken),
    hasSmtpPass: Boolean(cfg.smtpPass),
    updatedAt: cfg.updatedAt,
  };
}

export function saveOtpConfig(incoming: Partial<OtpIntegrationConfig>): OtpIntegrationConfig {
  const current = getStoredOtpConfig();
  const next: OtpIntegrationConfig = {
    smsProvider: incoming.smsProvider || current.smsProvider,
    smsApiKey: incoming.smsApiKey !== undefined && incoming.smsApiKey !== '' ? incoming.smsApiKey.trim() : current.smsApiKey,
    smsSenderId: incoming.smsSenderId !== undefined ? incoming.smsSenderId.trim() : current.smsSenderId,
    smsTemplateId: incoming.smsTemplateId !== undefined ? incoming.smsTemplateId.trim() : current.smsTemplateId,
    twilioAccountSid: incoming.twilioAccountSid !== undefined ? incoming.twilioAccountSid.trim() : current.twilioAccountSid,
    twilioAuthToken:
      incoming.twilioAuthToken !== undefined && incoming.twilioAuthToken !== ''
        ? incoming.twilioAuthToken.trim()
        : current.twilioAuthToken,
    twilioFromNumber: incoming.twilioFromNumber !== undefined ? incoming.twilioFromNumber.trim() : current.twilioFromNumber,
    customWebhookUrl: incoming.customWebhookUrl !== undefined ? incoming.customWebhookUrl.trim() : current.customWebhookUrl,
    emailEnabled: incoming.emailEnabled ?? current.emailEnabled,
    smtpHost: incoming.smtpHost !== undefined ? incoming.smtpHost.trim() : current.smtpHost,
    smtpPort: Number(incoming.smtpPort ?? current.smtpPort ?? 587),
    smtpSecure: incoming.smtpSecure ?? current.smtpSecure,
    smtpUser: incoming.smtpUser !== undefined ? incoming.smtpUser.trim() : current.smtpUser,
    smtpPass: incoming.smtpPass !== undefined && incoming.smtpPass !== '' ? incoming.smtpPass : current.smtpPass,
    smtpFrom: incoming.smtpFrom !== undefined ? incoming.smtpFrom.trim() : current.smtpFrom,
    whatsappOtpEnabled: incoming.whatsappOtpEnabled ?? current.whatsappOtpEnabled,
    firebasePhoneEnabled: incoming.firebasePhoneEnabled ?? current.firebasePhoneEnabled,
    updatedAt: new Date().toISOString(),
  };

  sqlite
    .prepare(`UPDATE saas_settings SET otp_config_json = ?, updated_at = ? WHERE id = 'global'`)
    .run(JSON.stringify(next), new Date().toISOString());

  return getPublicOtpConfig();
}

export async function dispatchOtpCode(params: {
  target: string;
  channel: 'phone' | 'email';
  companyId?: string;
  purpose?: string;
}): Promise<{
  target: string;
  channel: 'phone' | 'email';
  deliveredVia: string[];
  externalSent: boolean;
  otpPreview?: string;
  expiresInMinutes: number;
  warnings: string[];
}> {
  const normalizedTarget = normalizeOtpTarget(params.target, params.channel);
  const code = String(crypto.randomInt(100000, 999999));
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  sqlite
    .prepare(
      `INSERT INTO auth_otp_codes (target, channel, code, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(target) DO UPDATE SET channel=excluded.channel, code=excluded.code, expires_at=excluded.expires_at, created_at=excluded.created_at`
    )
    .run(normalizedTarget, params.channel, code, expiresAt, nowIso);

  const cfg = getStoredOtpConfig();
  const deliveredVia: string[] = [];
  const warnings: string[] = [];
  const purposeLabel = params.purpose || 'Shobhit Invoice Pro Login';
  const otpMessage = `Your ${purposeLabel} OTP is ${code}. Valid for 10 minutes. Do not share this code with anyone.`;

  if (params.channel === 'email') {
    if (cfg.emailEnabled && cfg.smtpHost && cfg.smtpUser && cfg.smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: cfg.smtpHost,
          port: Number(cfg.smtpPort || 587),
          secure: Boolean(cfg.smtpSecure),
          auth: {
            user: cfg.smtpUser,
            pass: cfg.smtpPass,
          },
        });
        await transporter.sendMail({
          from: cfg.smtpFrom || cfg.smtpUser,
          to: normalizedTarget,
          subject: `${code} is your ${purposeLabel} verification code`,
          text: otpMessage,
          html: `<div style="font-family:Arial,sans-serif;padding:16px;border:1px solid #e5eff3;border-radius:8px;max-width:460px;">
            <h2 style="color:#116B68;margin:0 0 8px;">${purposeLabel}</h2>
            <p style="color:#243746;font-size:14px;">Use this one-time verification code to sign in:</p>
            <div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#168C88;padding:12px 0;">${code}</div>
            <p style="color:#84909D;font-size:12px;">Valid for 10 minutes. If you did not request this, ignore this email.</p>
          </div>`,
        });
        deliveredVia.push('SMTP Email');
      } catch (err) {
        warnings.push(`SMTP delivery failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  } else {
    // 1. Try Linked WhatsApp QR session if enabled
    if (cfg.whatsappOtpEnabled) {
      const candidateCid =
        params.companyId && getWhatsAppStatus(params.companyId).status === 'connected'
          ? params.companyId
          : getAnyConnectedWhatsAppCompanyId();
      if (candidateCid) {
        try {
          await sendWhatsAppMessage({
            companyId: candidateCid,
            phone: normalizedTarget,
            text: otpMessage,
          });
          deliveredVia.push('Linked WhatsApp');
        } catch (err) {
          warnings.push(`WhatsApp OTP failed: ${err instanceof Error ? err.message : 'Send error'}`);
        }
      }
    }

    // 2. Try Configured SMS Gateway
    if (cfg.smsProvider === 'fast2sms' && cfg.smsApiKey) {
      try {
        const resp = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            authorization: cfg.smsApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            route: 'otp',
            variables_values: code,
            numbers: normalizedTarget,
          }),
        });
        if (resp.ok) deliveredVia.push('Fast2SMS');
        else warnings.push(`Fast2SMS HTTP ${resp.status}`);
      } catch (err) {
        warnings.push(`Fast2SMS error: ${err instanceof Error ? err.message : 'Network error'}`);
      }
    } else if (cfg.smsProvider === 'msg91' && cfg.smsApiKey) {
      try {
        const url = new URL('https://control.msg91.com/api/v5/otp');
        url.searchParams.set('mobile', `91${normalizedTarget}`);
        url.searchParams.set('otp', code);
        if (cfg.smsTemplateId) url.searchParams.set('template_id', cfg.smsTemplateId);
        const resp = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            authkey: cfg.smsApiKey,
            'Content-Type': 'application/json',
          },
        });
        if (resp.ok) deliveredVia.push('MSG91');
        else warnings.push(`MSG91 HTTP ${resp.status}`);
      } catch (err) {
        warnings.push(`MSG91 error: ${err instanceof Error ? err.message : 'Network error'}`);
      }
    } else if (
      cfg.smsProvider === 'twilio' &&
      cfg.twilioAccountSid &&
      cfg.twilioAuthToken &&
      cfg.twilioFromNumber
    ) {
      try {
        const authBasic = Buffer.from(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`).toString('base64');
        const body = new URLSearchParams({
          To: `+91${normalizedTarget}`,
          From: cfg.twilioFromNumber,
          Body: otpMessage,
        });
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.twilioAccountSid)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${authBasic}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
          }
        );
        if (resp.ok) deliveredVia.push('Twilio SMS');
        else warnings.push(`Twilio HTTP ${resp.status}`);
      } catch (err) {
        warnings.push(`Twilio error: ${err instanceof Error ? err.message : 'Network error'}`);
      }
    } else if (cfg.smsProvider === 'custom_webhook' && cfg.customWebhookUrl) {
      try {
        const resp = await fetch(cfg.customWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: normalizedTarget,
            code,
            message: otpMessage,
            senderId: cfg.smsSenderId || 'SHOBIT',
          }),
        });
        if (resp.ok) deliveredVia.push('Custom SMS Webhook');
        else warnings.push(`Webhook HTTP ${resp.status}`);
      } catch (err) {
        warnings.push(`Webhook error: ${err instanceof Error ? err.message : 'Network error'}`);
      }
    }
  }

  const externalSent = deliveredVia.length > 0;
  if (!externalSent) {
    deliveredVia.push('Built-in Instant OTP');
  }

  return {
    target: normalizedTarget,
    channel: params.channel,
    deliveredVia,
    externalSent,
    // Show instant preview only when no external provider delivered the code so offline/demo setups stay 100% usable
    otpPreview: externalSent ? undefined : code,
    expiresInMinutes: 10,
    warnings,
  };
}

export function verifyOtpCode(target: string, channel: 'phone' | 'email', code: string): boolean {
  const normalizedTarget = normalizeOtpTarget(target, channel);
  const cleanCode = String(code || '').trim();
  if (!normalizedTarget || cleanCode.length < 4) return false;

  const row = sqlite
    .prepare(`SELECT code, expires_at FROM auth_otp_codes WHERE target = ?`)
    .get(normalizedTarget) as { code: string; expires_at: string } | undefined;

  if (!row || row.expires_at < new Date().toISOString()) {
    return false;
  }

  const ha = crypto.createHash('sha256').update(cleanCode).digest();
  const hb = crypto.createHash('sha256').update(String(row.code)).digest();
  const matched = crypto.timingSafeEqual(ha, hb);
  if (matched) {
    sqlite.prepare(`DELETE FROM auth_otp_codes WHERE target = ?`).run(normalizedTarget);
  }
  return matched;
}
