import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import type { WhatsAppStatusInfo } from '../src/types/accounting.ts';

interface WaSessionHolder {
  socket: WASocket | null;
  status: WhatsAppStatusInfo;
  connectingLock: boolean;
  manualDisconnect: boolean;
}

const SESSION_ROOT = path.resolve(process.cwd(), 'data', 'wa_sessions');
if (!fs.existsSync(SESSION_ROOT)) {
  fs.mkdirSync(SESSION_ROOT, { recursive: true });
}

const sessions = new Map<string, WaSessionHolder>();

function createSilentLogger(): any {
  const noop = () => undefined;
  const logger: any = {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger;
}

function getSafeAuthDir(companyId: string): string {
  const safeId = String(companyId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const resolved = path.resolve(SESSION_ROOT, safeId);
  if (!resolved.startsWith(SESSION_ROOT)) {
    throw new Error('Invalid session directory');
  }
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function getHolder(companyId: string): WaSessionHolder {
  let holder = sessions.get(companyId);
  if (!holder) {
    holder = {
      socket: null,
      status: {
        status: 'disconnected',
        updatedAt: new Date().toISOString(),
      },
      connectingLock: false,
      manualDisconnect: false,
    };
    sessions.set(companyId, holder);
  }
  return holder;
}

export function formatWhatsAppJid(rawPhone: string): string | null {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return `${normalized}@s.whatsapp.net`;
}

export function getWhatsAppStatus(companyId: string): WhatsAppStatusInfo {
  const holder = getHolder(companyId);
  return { ...holder.status };
}

export function getAnyConnectedWhatsAppCompanyId(): string | null {
  for (const [cid, holder] of sessions.entries()) {
    if (holder.status.status === 'connected' && holder.socket) {
      return cid;
    }
  }
  return null;
}

export async function connectWhatsApp(companyId: string): Promise<WhatsAppStatusInfo> {
  const holder = getHolder(companyId);
  if (holder.status.status === 'connected' && holder.socket) {
    return { ...holder.status };
  }
  if (holder.connectingLock) {
    return { ...holder.status };
  }

  holder.connectingLock = true;
  holder.manualDisconnect = false;
  holder.status = {
    status: 'connecting',
    updatedAt: new Date().toISOString(),
  };

  try {
    const authDir = getSafeAuthDir(companyId);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch {
      version = undefined;
    }

    const sock = makeWASocket({
      auth: state,
      version,
      logger: createSilentLogger(),
      printQRInTerminal: false,
      browser: Browsers.macOS('Shobhit Invoice Pro'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    holder.socket = sock;

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch {
        // ignore save errors
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: { dark: '#116B68', light: '#FFFFFF' },
          });
          holder.status = {
            status: 'qr_ready',
            qrDataUrl,
            updatedAt: new Date().toISOString(),
          };
        } catch (err) {
          holder.status = {
            status: 'error',
            lastError: err instanceof Error ? err.message : 'Failed to generate QR image',
            updatedAt: new Date().toISOString(),
          };
        }
      }

      if (connection === 'open') {
        const rawUserId = sock.user?.id || '';
        const phoneDigits = rawUserId.split(':')[0]?.split('@')[0] || '';
        holder.status = {
          status: 'connected',
          phoneNumber: phoneDigits ? `+${phoneDigits}` : 'Linked',
          pushName: sock.user?.name || 'WhatsApp Business',
          updatedAt: new Date().toISOString(),
        };
        holder.connectingLock = false;
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        holder.connectingLock = false;
        holder.socket = null;

        if (holder.manualDisconnect || loggedOut) {
          if (loggedOut) {
            try {
              fs.rmSync(authDir, { recursive: true, force: true });
            } catch {
              // ignore cleanup errors
            }
          }
          holder.status = {
            status: 'disconnected',
            lastError: loggedOut ? 'Logged out from WhatsApp Linked Devices. Scan QR to relink.' : undefined,
            updatedAt: new Date().toISOString(),
          };
        } else {
          // Transient drop during QR or socket handshake; allow auto-retry or prompt re-scan cleanly
          const msg =
            (lastDisconnect?.error as Error | undefined)?.message ||
            'Connection closed. Click Connect / Generate QR to retry.';
          holder.status = {
            status: 'error',
            lastError: msg,
            updatedAt: new Date().toISOString(),
          };
        }
      }
    });

    // Wait briefly so first QR event often arrives in the first HTTP call
    await new Promise((resolve) => setTimeout(resolve, 1200));
    holder.connectingLock = false;
    return { ...holder.status };
  } catch (err) {
    holder.connectingLock = false;
    holder.socket = null;
    holder.status = {
      status: 'error',
      lastError: err instanceof Error ? err.message : 'Failed to initialize WhatsApp Web session',
      updatedAt: new Date().toISOString(),
    };
    return { ...holder.status };
  }
}

export async function disconnectWhatsApp(companyId: string): Promise<WhatsAppStatusInfo> {
  const holder = getHolder(companyId);
  holder.manualDisconnect = true;
  try {
    if (holder.socket) {
      await holder.socket.logout().catch(() => undefined);
      holder.socket.end(undefined);
    }
  } catch {
    // ignore socket close error
  }
  holder.socket = null;
  holder.connectingLock = false;
  try {
    const authDir = getSafeAuthDir(companyId);
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
  holder.status = {
    status: 'disconnected',
    updatedAt: new Date().toISOString(),
  };
  return { ...holder.status };
}

export async function sendWhatsAppMessage(params: {
  companyId: string;
  phone: string;
  text: string;
  pdfBase64?: string;
  pdfFileName?: string;
  imageBase64?: string;
  copyToSelf?: boolean;
}): Promise<{ ok: boolean; sentCount: number; message: string }> {
  const holder = getHolder(params.companyId);
  if (!holder.socket || holder.status.status !== 'connected') {
    throw new Error('WhatsApp is not linked. Please scan the QR code in Settings -> Transaction Message.');
  }

  const sock = holder.socket;
  const targetJids: string[] = [];
  const partyJid = formatWhatsAppJid(params.phone);
  if (partyJid) {
    targetJids.push(partyJid);
  }
  if (params.copyToSelf && holder.status.phoneNumber) {
    const selfJid = formatWhatsAppJid(holder.status.phoneNumber);
    if (selfJid && !targetJids.includes(selfJid)) {
      targetJids.push(selfJid);
    }
  }

  if (targetJids.length === 0) {
    throw new Error('Recipient phone number must have at least 10 digits.');
  }

  let sentCount = 0;
  for (const jid of targetJids) {
    if (params.imageBase64) {
      const cleanImg = params.imageBase64.includes(',') ? params.imageBase64.split(',')[1] : params.imageBase64;
      const imgBuffer = Buffer.from(cleanImg, 'base64');
      await sock.sendMessage(jid, {
        image: imgBuffer,
        caption: !params.pdfBase64 ? params.text : undefined,
        mimetype: 'image/png',
      });
    }

    if (params.pdfBase64) {
      const cleanPdf = params.pdfBase64.includes(',') ? params.pdfBase64.split(',')[1] : params.pdfBase64;
      const pdfBuffer = Buffer.from(cleanPdf, 'base64');
      await sock.sendMessage(jid, {
        document: pdfBuffer,
        mimetype: 'application/pdf',
        fileName: params.pdfFileName || `Invoice_${Date.now()}.pdf`,
        caption: params.text,
      });
    }

    if (!params.pdfBase64 && !params.imageBase64) {
      await sock.sendMessage(jid, { text: params.text });
    }
    sentCount += 1;
  }

  return {
    ok: true,
    sentCount,
    message: `Dispatched successfully via linked WhatsApp (${holder.status.phoneNumber || 'Connected'})`,
  };
}
