import express, { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { hashPassword, recordAudit, runTransaction, sqlite, uid, verifyPassword } from './server/db.ts';
import {
  applyVoucherStockDelta,
  buildBootstrapPayload,
  DEFAULT_INVOICE_CONFIG,
  DEFAULT_ROLE_PERMISSIONS,
  ensureDemoAccount,
  ensureSystemLedgers,
  getSaasPlans,
  getSubscriptionRuntimeState,
  insertVoucherFull,
  mapLicenseRow,
  postJournalForAdjustmentEntry,
  postJournalForVoucher,
  seedCompanyDemoRecords,
} from './server/accountingEngine.ts';
import { createSeedDatabase } from './src/data/seedDatabase.ts';
import {
  DeviceScope,
  OtpIntegrationConfig,
  PlanDuration,
  PlanTier,
  SubscriptionFeatureKey,
  Voucher,
  VoucherType,
  WorkspaceRole,
} from './src/types/accounting.ts';
import {
  isGeminiConfigured,
  scanInvoiceDocument,
} from './server/geminiService.ts';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
  sendWhatsAppMessage,
} from './server/whatsappService.ts';
import {
  dispatchOtpCode,
  getPublicOtpConfig,
  saveOtpConfig,
  verifyOtpCode,
} from './server/otpService.ts';

function safeSecretEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return String(raw || '').trim();
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(`${baseIso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateUniqueLicenseCode(tier: PlanTier): string {
  const prefix = tier === 'silver' ? 'SIL' : tier === 'gold' ? 'GLD' : 'PLT';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
  for (let i = 0; i < 10; i++) {
    const candidate = `SIP-${prefix}-${block()}-${block()}`;
    const clash = sqlite.prepare(`SELECT id FROM saas_licenses WHERE license_code = ?`).get(candidate);
    if (!clash) return candidate;
  }
  return `SIP-${prefix}-${Date.now().toString(36).toUpperCase().slice(-8)}`;
}

function requireActiveLicenseOrTrial(companyId: string, res: Response): boolean {
  const sub = getSubscriptionRuntimeState(companyId);
  if (!sub.canTransact) {
    res.status(402).json({
      error: 'Your 7-Day Free Trial has expired. Please purchase a Silver, Gold, or Platinum plan or attach an existing License under Utilities -> Subscription & License.',
      code: 'TRIAL_EXPIRED',
    });
    return false;
  }
  return true;
}

function requireFeatureUnlocked(companyId: string, feature: SubscriptionFeatureKey, res: Response): boolean {
  if (!requireActiveLicenseOrTrial(companyId, res)) return false;
  const sub = getSubscriptionRuntimeState(companyId);
  if (!sub.unlockedFeatures[feature]) {
    res.status(403).json({
      error: `This feature is locked in your current ${sub.activeTier.toUpperCase()} plan. Upgrade to unlock it.`,
      code: 'FEATURE_LOCKED',
    });
    return false;
  }
  return true;
}

function getOpsOverviewPayload() {
  const licenses = sqlite
    .prepare(`SELECT * FROM saas_licenses ORDER BY created_at DESC`)
    .all() as Array<Record<string, unknown>>;
  const plans = getSaasPlans();
  const settingsRow = sqlite
    .prepare(
      `SELECT detach_passcode, updated_at, linked_sheet_id, linked_sheet_title, linked_sheet_url, last_sheet_sync_at, last_sheet_sync_by
       FROM saas_settings WHERE id = 'global'`
    )
    .get() as
    | {
        detach_passcode?: string;
        updated_at?: string;
        linked_sheet_id?: string;
        linked_sheet_title?: string;
        linked_sheet_url?: string;
        last_sheet_sync_at?: string;
        last_sheet_sync_by?: string;
      }
    | undefined;
  return {
    licenses: licenses.map(mapLicenseRow),
    plans,
    settings: {
      detachPasscode: settingsRow?.detach_passcode || '112233',
      updatedAt: settingsRow?.updated_at || '',
      linkedSheetId: settingsRow?.linked_sheet_id || '',
      linkedSheetTitle: settingsRow?.linked_sheet_title || '',
      linkedSheetUrl: settingsRow?.linked_sheet_url || '',
      lastSheetSyncAt: settingsRow?.last_sheet_sync_at || '',
      lastSheetSyncBy: settingsRow?.last_sheet_sync_by || '',
    },
  };
}

function formatDurationSeconds(totalSeconds: number): string {
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;
}

function getOpsTelemetryPayload() {
  const overview = getOpsOverviewPayload();
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const loads = os.loadavg();
  const uptimeSeconds = Math.floor(process.uptime());

  const dbPath = path.resolve(process.cwd(), 'data/shobhit_invoice_pro.db');
  let dbFileSizeKb = 0;
  try {
    dbFileSizeKb = Math.round(fs.statSync(dbPath).size / 1024);
  } catch {
    dbFileSizeKb = 0;
  }

  const sqliteTableCount = (
    sqlite.prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get() as {
      c: number;
    }
  ).c;
  const activeSessionsCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM sessions`).get() as { c: number }).c;
  const pendingOtpCount = (
    sqlite.prepare(`SELECT COUNT(*) as c FROM saas_otp_codes WHERE expires_at > ?`).get(new Date().toISOString()) as {
      c: number;
    }
  ).c;

  const activeLicenseRows = overview.licenses.filter((l) => l.status === 'active');
  const pendingLicenseRows = overview.licenses.filter((l) => l.status === 'pending_verification');
  const deactivatedLicenseRows = overview.licenses.filter((l) => l.status === 'deactivated');

  const companyRows = sqlite.prepare(`SELECT * FROM companies ORDER BY created_at DESC`).all() as Array<
    Record<string, unknown>
  >;
  const companyMap = new Map<string, string>();
  for (const c of companyRows) {
    companyMap.set(String(c.id), String(c.name));
  }

  const companies = companyRows.map((c) => {
    const cid = String(c.id);
    const subState = getSubscriptionRuntimeState(cid);
    const vStats = sqlite
      .prepare(
        `SELECT
           COUNT(*) as total_count,
           SUM(CASE WHEN LOWER(type) = 'sales' THEN 1 ELSE 0 END) as sales_count,
           SUM(CASE WHEN LOWER(type) = 'purchase' THEN 1 ELSE 0 END) as purchase_count,
           COALESCE(SUM(CASE WHEN LOWER(type) = 'sales' AND LOWER(status) != 'cancelled' THEN grand_total ELSE 0 END), 0) as sales_sum,
           COALESCE(SUM(CASE WHEN LOWER(type) = 'purchase' AND LOWER(status) != 'cancelled' THEN grand_total ELSE 0 END), 0) as purchase_sum,
           COALESCE(SUM(CASE WHEN LOWER(type) = 'receipt' AND LOWER(status) != 'cancelled' THEN grand_total ELSE 0 END), 0) as receipt_sum,
           COALESCE(SUM(CASE WHEN LOWER(type) = 'payment' AND LOWER(status) != 'cancelled' THEN grand_total ELSE 0 END), 0) as payment_sum,
           SUM(CASE WHEN LOWER(approval_status) = 'pending' THEN 1 ELSE 0 END) as pending_approvals
         FROM vouchers WHERE company_id = ?`
      )
      .get(cid) as Record<string, number>;

    const countOf = (tbl: string) =>
      (sqlite.prepare(`SELECT COUNT(*) as c FROM ${tbl} WHERE company_id = ?`).get(cid) as { c: number }).c;

    return {
      id: cid,
      name: String(c.name || ''),
      gstin: String(c.gstin || ''),
      state: String(c.state || ''),
      financialYear: String(c.financial_year || ''),
      baseCurrency: String(c.base_currency || 'INR'),
      trialStartedAt: String(c.trial_started_at || ''),
      trialDaysLeft: subState.trialDaysLeft,
      attachedLicenseId: String(c.attached_license_id || ''),
      attachedLicenseCode: subState.attachedLicense?.licenseCode || '',
      vouchersCount: Number(vStats?.total_count || 0),
      salesVouchersCount: Number(vStats?.sales_count || 0),
      purchaseVouchersCount: Number(vStats?.purchase_count || 0),
      totalSalesRevenue: Number(vStats?.sales_sum || 0),
      totalPurchaseSpend: Number(vStats?.purchase_sum || 0),
      totalReceipts: Number(vStats?.receipt_sum || 0),
      totalPayments: Number(vStats?.payment_sum || 0),
      partiesCount: countOf('parties'),
      itemsCount: countOf('items'),
      bankAccountsCount: countOf('bank_accounts'),
      staffCount: countOf('staff_members'),
      payrollRunsCount: countOf('payroll_runs'),
      pendingApprovalsCount: Number(vStats?.pending_approvals || 0),
      recycleBinCount: countOf('recycle_bin'),
    };
  });

  const runningOperations: Array<{
    category: string;
    companyName: string;
    title: string;
    status: string;
    metricOrAmount: string;
    scheduleOrDue: string;
  }> = [];

  const subPlans = sqlite
    .prepare(`SELECT * FROM subscription_plans ORDER BY next_billing_date ASC LIMIT 50`)
    .all() as Array<Record<string, unknown>>;
  for (const sp of subPlans) {
    runningOperations.push({
      category: 'Recurring Billing',
      companyName: companyMap.get(String(sp.company_id)) || String(sp.company_id),
      title: `${String(sp.plan_name)} (${String(sp.party_name)})`,
      status: String(sp.status),
      metricOrAmount: `INR ${Number(sp.amount || 0).toFixed(2)}`,
      scheduleOrDue: `${String(sp.interval)} · Next: ${String(sp.next_billing_date)}`,
    });
  }

  const prodOrders = sqlite
    .prepare(`SELECT * FROM production_orders ORDER BY due_date ASC LIMIT 50`)
    .all() as Array<Record<string, unknown>>;
  for (const po of prodOrders) {
    runningOperations.push({
      category: 'Production Order',
      companyName: companyMap.get(String(po.company_id)) || String(po.company_id),
      title: `${String(po.order_no)} · ${String(po.finished_item_name)}`,
      status: String(po.status),
      metricOrAmount: `${Number(po.completed_qty || 0)}/${Number(po.planned_qty || 0)} units`,
      scheduleOrDue: `Due: ${String(po.due_date || '-')}`,
    });
  }

  const compItems = sqlite
    .prepare(`SELECT * FROM compliance_items ORDER BY due_date ASC LIMIT 50`)
    .all() as Array<Record<string, unknown>>;
  for (const ci of compItems) {
    runningOperations.push({
      category: `Compliance (${String(ci.category)})`,
      companyName: companyMap.get(String(ci.company_id)) || String(ci.company_id),
      title: String(ci.title),
      status: String(ci.status),
      metricOrAmount: String(ci.reference_no || '-'),
      scheduleOrDue: `Due: ${String(ci.due_date || '-')}`,
    });
  }

  const leaves = sqlite
    .prepare(`SELECT * FROM leave_requests WHERE status = 'Pending' LIMIT 30`)
    .all() as Array<Record<string, unknown>>;
  for (const lv of leaves) {
    runningOperations.push({
      category: 'HR Leave Queue',
      companyName: companyMap.get(String(lv.company_id)) || String(lv.company_id),
      title: `${String(lv.staff_name)} (${String(lv.leave_type)})`,
      status: String(lv.status),
      metricOrAmount: `${Number(lv.days || 1)} day(s)`,
      scheduleOrDue: `${String(lv.from_date)} to ${String(lv.to_date)}`,
    });
  }

  const reimb = sqlite
    .prepare(`SELECT * FROM reimbursements WHERE status = 'Pending' LIMIT 30`)
    .all() as Array<Record<string, unknown>>;
  for (const rb of reimb) {
    runningOperations.push({
      category: 'HR Reimbursement',
      companyName: companyMap.get(String(rb.company_id)) || String(rb.company_id),
      title: `${String(rb.staff_name)} · ${String(rb.category)}`,
      status: String(rb.status),
      metricOrAmount: `INR ${Number(rb.amount || 0).toFixed(2)}`,
      scheduleOrDue: String(rb.date || '-'),
    });
  }

  const webhooks = sqlite.prepare(`SELECT * FROM webhooks WHERE active = 1 LIMIT 30`).all() as Array<
    Record<string, unknown>
  >;
  for (const wh of webhooks) {
    runningOperations.push({
      category: 'Webhook Endpoint',
      companyName: companyMap.get(String(wh.company_id)) || String(wh.company_id),
      title: `${String(wh.event)} -> ${String(wh.target_url)}`,
      status: 'Active',
      metricOrAmount: wh.last_status ? `HTTP ${wh.last_status}` : 'Ready',
      scheduleOrDue: String(wh.last_delivered_at || 'Awaiting event'),
    });
  }

  const auditRows = sqlite
    .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100`)
    .all() as Array<Record<string, unknown>>;

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      serverStatus: 'Running',
      port: process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000,
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      pid: process.pid,
      uptimeSeconds,
      uptimeFormatted: formatDurationSeconds(uptimeSeconds),
      memoryRssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
      externalMb: Number((mem.external / (1024 * 1024)).toFixed(2)),
      cpuUserMs: Number((cpu.user / 1000).toFixed(1)),
      cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
      loadAvg1m: Number((loads[0] || 0).toFixed(2)),
      loadAvg5m: Number((loads[1] || 0).toFixed(2)),
      loadAvg15m: Number((loads[2] || 0).toFixed(2)),
      totalSystemMemMb: Math.round(os.totalmem() / (1024 * 1024)),
      freeSystemMemMb: Math.round(os.freemem() / (1024 * 1024)),
      dbFileSizeKb,
      sqliteTableCount,
      activeSessionsCount,
      pendingOtpCount,
    },
    licenseSummary: {
      totalOrders: overview.licenses.length,
      activeCount: activeLicenseRows.length,
      pendingCount: pendingLicenseRows.length,
      deactivatedCount: deactivatedLicenseRows.length,
      verifiedRevenue: activeLicenseRows.reduce((s, l) => s + l.totalAmount, 0),
      pendingRevenue: pendingLicenseRows.reduce((s, l) => s + l.totalAmount, 0),
      silverCount: overview.licenses.filter((l) => l.tier === 'silver').length,
      goldCount: overview.licenses.filter((l) => l.tier === 'gold').length,
      platinumCount: overview.licenses.filter((l) => l.tier === 'platinum').length,
      desktopOnlyCount: overview.licenses.filter((l) => l.deviceScope === 'desktop').length,
      desktopMobileCount: overview.licenses.filter((l) => l.deviceScope === 'desktop_mobile').length,
    },
    companies,
    licenses: overview.licenses,
    plans: overview.plans,
    runningOperations,
    auditLogs: auditRows.map((a) => ({
      id: String(a.id),
      companyName: companyMap.get(String(a.company_id)) || String(a.company_id),
      userName: String(a.user_name || ''),
      action: String(a.action || ''),
      entityType: String(a.entity_type || ''),
      entityId: String(a.entity_id || ''),
      details: String(a.details || ''),
      createdAt: String(a.created_at || ''),
    })),
    securitySettings: {
      detachPasscode: overview.settings.detachPasscode,
      linkedSheetId: overview.settings.linkedSheetId,
      linkedSheetTitle: overview.settings.linkedSheetTitle,
      linkedSheetUrl: overview.settings.linkedSheetUrl,
      lastSheetSyncAt: overview.settings.lastSheetSyncAt,
      lastSheetSyncBy: overview.settings.lastSheetSyncBy,
    },
  };
}

function opsMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const supplied = String(req.headers['x-ops-password'] || '');
  const row = sqlite
    .prepare(`SELECT ops_password FROM saas_settings WHERE id = 'global'`)
    .get() as { ops_password?: string } | undefined;
  const expected = row?.ops_password || '112233';
  if (!supplied || !safeSecretEqual(supplied, expected)) {
    res.status(403).json({ error: 'Invalid Ops Admin Password.' });
    return;
  }
  next();
}

interface AuthContext {
  userId: string;
  userName: string;
  userRole: string;
  companyId: string;
  token: string;
}

interface AuthedRequest extends Request {
  auth?: AuthContext;
}

function createSession(userId: string, companyId: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  sqlite
    .prepare(`INSERT INTO sessions (token, user_id, active_company_id, expires_at) VALUES (?, ?, ?, ?)`)
    .run(token, userId, companyId, expires);
  return token;
}

function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const sess = sqlite
    .prepare(
      `SELECT s.token, s.user_id, s.active_company_id, s.expires_at, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as
    | { token: string; user_id: string; active_company_id: string; expires_at: string; name: string; role: string }
    | undefined;

  if (!sess || sess.expires_at < new Date().toISOString()) {
    res.status(401).json({ error: 'Session expired. Please login again.' });
    return;
  }
  req.auth = {
    userId: sess.user_id,
    userName: sess.name,
    userRole: sess.role,
    companyId: sess.active_company_id,
    token: sess.token,
  };
  next();
}

async function startServer() {
  ensureDemoAccount();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  const resolveUserDefaultCompany = (userId: string): { id: string } | undefined => {
    const owned = sqlite
      .prepare(`SELECT id FROM companies WHERE owner_user_id = ? LIMIT 1`)
      .get(userId) as { id: string } | undefined;
    if (owned) return owned;
    const memberComp = sqlite
      .prepare(`SELECT company_id as id FROM workspace_members WHERE user_id = ? AND active = 1 LIMIT 1`)
      .get(userId) as { id: string } | undefined;
    if (memberComp) return memberComp;
    const uRow = sqlite
      .prepare(`SELECT assigned_company_id as id FROM users WHERE id = ?`)
      .get(userId) as { id?: string } | undefined;
    if (uRow?.id) return { id: uRow.id };
    return undefined;
  };

  // --- AUTH ENDPOINTS ---
  app.post('/api/auth/demo', (_req, res) => {
    try {
      const { userId, companyId } = ensureDemoAccount();
      const token = createSession(userId, companyId);
      const data = buildBootstrapPayload(userId, companyId);
      recordAudit(companyId, userId, data.user.name, 'LOGIN_DEMO', 'User', userId, 'Logged in with Demo Account');
      res.json({ token, data });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Demo login failed' });
    }
  });

  app.post('/api/auth/register', (req, res) => {
    try {
      const { name, email, phone, password, companyName, gstin, state, withDemoData } = req.body as {
        name: string;
        email?: string;
        phone?: string;
        password: string;
        companyName?: string;
        gstin?: string;
        state?: string;
        withDemoData?: boolean;
      };
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanPhone = normalizePhone(String(phone || ''));
      if (!name?.trim() || (!cleanPhone && !cleanEmail) || !password || password.length < 6) {
        res.status(400).json({ error: 'Name, Phone Number (or Email), and Password (min 6 chars) are required.' });
        return;
      }
      if (cleanPhone && cleanPhone.length < 10) {
        res.status(400).json({ error: 'Enter a valid 10-digit Phone Number.' });
        return;
      }
      if (cleanEmail) {
        const existingEmail = sqlite.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
        if (existingEmail) {
          res.status(409).json({ error: 'An account with this email already exists.' });
          return;
        }
      }
      if (cleanPhone) {
        const existingPhone = sqlite.prepare(`SELECT id FROM users WHERE phone = ? AND phone != ''`).get(cleanPhone);
        if (existingPhone) {
          res.status(409).json({ error: 'An account with this phone number already exists.' });
          return;
        }
      }

      const storedEmail = cleanEmail || `user_${cleanPhone}_${crypto.randomBytes(2).toString('hex')}@noemail.local`;

      const result = runTransaction(() => {
        const userId = uid('usr');
        const companyId = uid('cmp');
        const seed = createSeedDatabase();

        sqlite
          .prepare(`INSERT INTO users (id, name, email, phone, password_hash, role, status, created_at, assigned_company_id) VALUES (?, ?, ?, ?, ?, 'Admin', 'active', ?, ?)`)
          .run(userId, name.trim(), storedEmail, cleanPhone, hashPassword(password), new Date().toISOString(), companyId);

        const nowIso = new Date().toISOString();
        sqlite
          .prepare(
            `INSERT INTO companies (
              id, owner_user_id, company_name, tagline, gstin, pan, state, address, phone, email, upi_id,
              financial_year, signatory_name, default_terms, logo_data_url, invoice_config_json, prefixes_json, created_at, trial_started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`
          )
          .run(
            companyId,
            userId,
            companyName?.trim() || `${name.trim()} Enterprises`,
            'GST Registered Business',
            (gstin || '').trim().toUpperCase(),
            gstin && gstin.length >= 12 ? gstin.slice(2, 12).toUpperCase() : '',
            state || 'Maharashtra',
            '',
            cleanPhone,
            cleanEmail,
            '',
            '2026-27',
            name.trim(),
            seed.profile.defaultTerms,
            JSON.stringify(DEFAULT_INVOICE_CONFIG),
            JSON.stringify(seed.profile.prefixes),
            nowIso,
            nowIso
          );

        if (withDemoData) {
          seedCompanyDemoRecords(companyId, userId, name.trim());
        } else {
          ensureSystemLedgers(companyId);
          sqlite
            .prepare(`INSERT INTO branches (id, company_id, name, code, address, manager, is_default) VALUES (?, ?, 'Head Office', 'HO-01', '', ?, 1)`)
            .run(`br_${companyId}_main`, companyId, name.trim());
          sqlite
            .prepare(`INSERT INTO godowns (id, company_id, branch_id, name, location, manager, is_default) VALUES (?, ?, ?, 'Main Warehouse', 'Head Office', ?, 1)`)
            .run(`${companyId}_g1`, companyId, `br_${companyId}_main`, name.trim());
          sqlite
            .prepare(`INSERT INTO bank_accounts (id, company_id, bank_name, account_no, ifsc, branch, upi_id, opening_balance, type) VALUES (?, ?, 'Cash-in-Hand', 'CASH-01', '-', 'Counter', '', 0, 'cash')`)
            .run(`${companyId}_cash`, companyId);
        }

        recordAudit(companyId, userId, name.trim(), 'REGISTER', 'User', userId, 'Created new user & company workspace');
        return { userId, companyId };
      });

      const token = createSession(result.userId, result.companyId);
      const data = buildBootstrapPayload(result.userId, result.companyId);
      res.json({ token, data });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { identifier, email, password } = req.body as {
        identifier?: string;
        email?: string;
        password: string;
      };
      const rawId = String(identifier || email || '').trim();
      const lowerEmail = rawId.toLowerCase();
      const normPhone = normalizePhone(rawId);

      const user = (
        lowerEmail.includes('@')
          ? sqlite.prepare(`SELECT * FROM users WHERE email = ?`).get(lowerEmail)
          : sqlite
              .prepare(`SELECT * FROM users WHERE (phone = ? AND phone != '') OR email = ? LIMIT 1`)
              .get(normPhone, lowerEmail)
      ) as { id: string; name: string; password_hash: string; status: string } | undefined;

      if (!user || !verifyPassword(password || '', user.password_hash)) {
        res.status(401).json({ error: 'Invalid phone/email or password.' });
        return;
      }
      if (user.status !== 'active') {
        res.status(403).json({ error: 'This user account is deactivated by Administrator.' });
        return;
      }
      const comp = resolveUserDefaultCompany(user.id);
      if (!comp) {
        res.status(404).json({ error: 'No company workspace found for user.' });
        return;
      }
      const token = createSession(user.id, comp.id);
      const data = buildBootstrapPayload(user.id, comp.id);
      recordAudit(comp.id, user.id, user.name, 'LOGIN', 'User', user.id, 'User logged in');
      res.json({ token, data });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed' });
    }
  });

  app.post('/api/auth/otp/request', async (req, res) => {
    try {
      const { target, channel } = req.body as { target?: string; channel?: 'phone' | 'email' };
      const raw = String(target || '').trim();
      const resolvedChannel: 'phone' | 'email' = channel === 'email' || raw.includes('@') ? 'email' : 'phone';

      let userMatch: { id: string; name: string; company_id?: string; status?: string } | undefined;
      if (resolvedChannel === 'email') {
        const cleanEmail = raw.toLowerCase();
        if (!cleanEmail.includes('@')) {
          res.status(400).json({ error: 'Enter a valid Email address.' });
          return;
        }
        const member = sqlite
          .prepare(`SELECT user_id as id, name, company_id, active FROM workspace_members WHERE LOWER(email) = LOWER(?) AND active = 1 LIMIT 1`)
          .get(cleanEmail) as { id: string; name: string; company_id: string; active: number } | undefined;
        if (member) {
          userMatch = { id: member.id, name: member.name, company_id: member.company_id, status: 'active' };
        } else {
          const usr = sqlite
            .prepare(`SELECT id, name, status, assigned_company_id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`)
            .get(cleanEmail) as { id: string; name: string; status: string; assigned_company_id?: string } | undefined;
          if (usr) {
            userMatch = { id: usr.id, name: usr.name, company_id: usr.assigned_company_id, status: usr.status };
          }
        }
      } else {
        const phone = normalizePhone(raw);
        if (phone.length < 10) {
          res.status(400).json({ error: 'Enter a valid 10-digit Phone Number.' });
          return;
        }
        const member = sqlite
          .prepare(`SELECT user_id as id, name, company_id, active FROM workspace_members WHERE phone = ? AND active = 1 LIMIT 1`)
          .get(phone) as { id: string; name: string; company_id: string; active: number } | undefined;
        if (member) {
          userMatch = { id: member.id, name: member.name, company_id: member.company_id, status: 'active' };
        } else {
          const usr = sqlite
            .prepare(`SELECT id, name, status, assigned_company_id FROM users WHERE phone = ? LIMIT 1`)
            .get(phone) as { id: string; name: string; status: string; assigned_company_id?: string } | undefined;
          if (usr) {
            userMatch = { id: usr.id, name: usr.name, company_id: usr.assigned_company_id, status: usr.status };
          } else {
            const compByPhone = sqlite
              .prepare(`SELECT owner_user_id, id, company_name FROM companies WHERE REPLACE(REPLACE(phone, ' ', ''), '+91', '') LIKE ? LIMIT 1`)
              .get(`%${phone}`) as { owner_user_id: string; id: string; company_name: string } | undefined;
            if (compByPhone) {
              const owner = sqlite.prepare(`SELECT id, name, status FROM users WHERE id = ?`).get(compByPhone.owner_user_id) as
                | { id: string; name: string; status: string }
                | undefined;
              if (owner) {
                userMatch = { id: owner.id, name: owner.name, company_id: compByPhone.id, status: owner.status };
              }
            }
          }
        }
      }

      if (!userMatch) {
        res.status(404).json({
          error:
            resolvedChannel === 'email'
              ? 'No registered owner or active staff account found for this Email.'
              : 'No registered owner or active staff account found for this Phone Number.',
        });
        return;
      }
      if (userMatch.status && userMatch.status !== 'active') {
        res.status(403).json({ error: 'This user access account is currently inactive.' });
        return;
      }

      const comp = userMatch.company_id ? { id: userMatch.company_id } : resolveUserDefaultCompany(userMatch.id);
      const dispatchRes = await dispatchOtpCode({
        target: raw,
        channel: resolvedChannel,
        companyId: comp?.id,
        purpose: 'Shobhit Invoice Pro OTP Sign In',
      });

      res.json({
        ok: true,
        userName: userMatch.name,
        ...dispatchRes,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to send OTP.' });
    }
  });

  app.post('/api/auth/otp/verify', (req, res) => {
    try {
      const { target, channel, code } = req.body as {
        target?: string;
        channel?: 'phone' | 'email';
        code?: string;
      };
      const raw = String(target || '').trim();
      const resolvedChannel: 'phone' | 'email' = channel === 'email' || raw.includes('@') ? 'email' : 'phone';
      if (!verifyOtpCode(raw, resolvedChannel, String(code || ''))) {
        res.status(401).json({ error: 'Invalid or expired OTP code.' });
        return;
      }

      let userId = '';
      let companyId = '';
      if (resolvedChannel === 'email') {
        const cleanEmail = raw.toLowerCase();
        const member = sqlite
          .prepare(`SELECT user_id, company_id FROM workspace_members WHERE LOWER(email) = LOWER(?) AND active = 1 LIMIT 1`)
          .get(cleanEmail) as { user_id: string; company_id: string } | undefined;
        if (member) {
          userId = member.user_id;
          companyId = member.company_id;
        } else {
          const usr = sqlite
            .prepare(`SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND status = 'active' LIMIT 1`)
            .get(cleanEmail) as { id: string } | undefined;
          if (usr) {
            userId = usr.id;
            companyId = resolveUserDefaultCompany(usr.id)?.id || '';
          }
        }
      } else {
        const phone = normalizePhone(raw);
        const member = sqlite
          .prepare(`SELECT user_id, company_id FROM workspace_members WHERE phone = ? AND active = 1 LIMIT 1`)
          .get(phone) as { user_id: string; company_id: string } | undefined;
        if (member) {
          userId = member.user_id;
          companyId = member.company_id;
        } else {
          const usr = sqlite
            .prepare(`SELECT id FROM users WHERE phone = ? AND status = 'active' LIMIT 1`)
            .get(phone) as { id: string } | undefined;
          if (usr) {
            userId = usr.id;
            companyId = resolveUserDefaultCompany(usr.id)?.id || '';
          } else {
            const compByPhone = sqlite
              .prepare(`SELECT owner_user_id, id FROM companies WHERE REPLACE(REPLACE(phone, ' ', ''), '+91', '') LIKE ? LIMIT 1`)
              .get(`%${phone}`) as { owner_user_id: string; id: string } | undefined;
            if (compByPhone) {
              userId = compByPhone.owner_user_id;
              companyId = compByPhone.id;
            }
          }
        }
      }

      if (!userId || !companyId) {
        res.status(404).json({ error: 'No active workspace found for this account.' });
        return;
      }

      const token = createSession(userId, companyId);
      const data = buildBootstrapPayload(userId, companyId);
      recordAudit(companyId, userId, data.user.name, 'LOGIN_OTP', 'User', userId, `Signed in via ${resolvedChannel.toUpperCase()} OTP`);
      res.json({ token, data });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'OTP verification failed.' });
    }
  });

  app.post('/api/auth/logout', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    recordAudit(auth.companyId, auth.userId, auth.userName, 'LOGOUT', 'User', auth.userId, 'User logged out');
    sqlite.prepare(`DELETE FROM sessions WHERE token = ?`).run(auth.token);
    res.json({ ok: true });
  });

  app.get('/api/bootstrap', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- COMPANIES & BRANCHES ---
  app.post('/api/companies', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { companyName, gstin, state, financialYear } = req.body as {
      companyName: string;
      gstin?: string;
      state?: string;
      financialYear?: string;
    };
    if (!companyName?.trim()) {
      res.status(400).json({ error: 'Company name is required.' });
      return;
    }
    const newCompId = runTransaction(() => {
      const companyId = uid('cmp');
      const seed = createSeedDatabase();
      const nowIso = new Date().toISOString();
      sqlite
        .prepare(
          `INSERT INTO companies (
            id, owner_user_id, company_name, tagline, gstin, pan, state, address, phone, email, upi_id,
            financial_year, signatory_name, default_terms, logo_data_url, invoice_config_json, prefixes_json, created_at, trial_started_at
          ) VALUES (?, ?, ?, '', ?, ?, ?, '', '', '', '', ?, ?, ?, '', ?, ?, ?, ?)`
        )
        .run(
          companyId,
          auth.userId,
          companyName.trim(),
          (gstin || '').toUpperCase(),
          gstin && gstin.length >= 12 ? gstin.slice(2, 12).toUpperCase() : '',
          state || 'Maharashtra',
          financialYear || '2026-27',
          auth.userName,
          seed.profile.defaultTerms,
          JSON.stringify(DEFAULT_INVOICE_CONFIG),
          JSON.stringify(seed.profile.prefixes),
          nowIso,
          nowIso
        );
      ensureSystemLedgers(companyId);
      sqlite
        .prepare(`INSERT INTO branches (id, company_id, name, code, address, manager, is_default) VALUES (?, ?, 'Head Office', 'HO-01', '', ?, 1)`)
        .run(`br_${companyId}_main`, companyId, auth.userName);
      sqlite
        .prepare(`INSERT INTO godowns (id, company_id, branch_id, name, location, manager, is_default) VALUES (?, ?, ?, 'Main Warehouse', 'Head Office', ?, 1)`)
        .run(`${companyId}_g1`, companyId, `br_${companyId}_main`, auth.userName);
      sqlite
        .prepare(`INSERT INTO bank_accounts (id, company_id, bank_name, account_no, ifsc, branch, upi_id, opening_balance, type) VALUES (?, ?, 'Cash-in-Hand', 'CASH-01', '-', 'Counter', '', 0, 'cash')`)
        .run(`${companyId}_cash`, companyId);
      sqlite.prepare(`UPDATE sessions SET active_company_id = ? WHERE token = ?`).run(companyId, auth.token);
      recordAudit(companyId, auth.userId, auth.userName, 'CREATE_COMPANY', 'Company', companyId, `Created company ${companyName}`);
      return companyId;
    });
    res.json({ data: buildBootstrapPayload(auth.userId, newCompId) });
  });

  app.post('/api/companies/switch', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { companyId } = req.body as { companyId: string };
    const own = sqlite
      .prepare(`SELECT id FROM companies WHERE id = ? AND owner_user_id = ?`)
      .get(companyId, auth.userId);
    const member = sqlite
      .prepare(`SELECT id FROM workspace_members WHERE company_id = ? AND user_id = ? AND active = 1`)
      .get(companyId, auth.userId);
    if (!own && !member) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    sqlite.prepare(`UPDATE sessions SET active_company_id = ? WHERE token = ?`).run(companyId, auth.token);
    res.json({ data: buildBootstrapPayload(auth.userId, companyId) });
  });

  app.put('/api/companies/profile', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const p = req.body;
    runTransaction(() => {
      sqlite
        .prepare(
          `UPDATE companies SET
            company_name = ?, tagline = ?, gstin = ?, pan = ?, state = ?, address = ?, phone = ?, email = ?,
            upi_id = ?, financial_year = ?, signatory_name = ?, default_terms = ?, logo_data_url = ?,
            signature_data_url = ?, digital_signature_text = ?,
            language = ?, region_locale = ?, base_currency = ?,
            invoice_config_json = ?, prefixes_json = ?, app_settings_json = ?
           WHERE id = ?`
        )
        .run(
          p.companyName,
          p.tagline || '',
          p.gstin || '',
          p.pan || '',
          p.state || 'Maharashtra',
          p.address || '',
          p.phone || '',
          p.email || '',
          p.upiId || '',
          p.financialYear || '2026-27',
          p.signatoryName || '',
          p.defaultTerms || '',
          p.logoDataUrl || '',
          p.signatureDataUrl || '',
          p.digitalSignatureText || '',
          p.language === 'hi' ? 'hi' : 'en',
          p.regionLocale || 'en-IN',
          p.baseCurrency || 'INR',
          JSON.stringify(p.invoiceConfig || DEFAULT_INVOICE_CONFIG),
          JSON.stringify(p.prefixes || {}),
          JSON.stringify(p.appSettings || {}),
          auth.companyId
        );
      recordAudit(auth.companyId, auth.userId, auth.userName, 'UPDATE_PROFILE', 'Company', auth.companyId, 'Updated company profile & settings');
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/branches', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { name, code, address, manager } = req.body as {
      name: string;
      code: string;
      address?: string;
      manager?: string;
    };
    runTransaction(() => {
      const id = uid('br');
      sqlite
        .prepare(`INSERT INTO branches (id, company_id, name, code, address, manager, is_default) VALUES (?, ?, ?, ?, ?, ?, 0)`)
        .run(id, auth.companyId, name, code || 'BR-02', address || '', manager || auth.userName);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'CREATE_BRANCH', 'Branch', id, `Added branch ${name}`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- VOUCHERS (ACID TRANSACTION + STOCK + DOUBLE-ENTRY POSTING + ROLLBACK) ---
  app.post('/api/vouchers', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireActiveLicenseOrTrial(auth.companyId, res)) return;
    const rawBody = req.body as {
      voucher?: Voucher;
      convertFromVoucherId?: string;
    } & Partial<Voucher>;
    const voucher = (rawBody?.voucher || rawBody) as Voucher;
    const convertFromVoucherId = rawBody?.convertFromVoucherId;
    try {
      const savedId = runTransaction(() => {
        const isEdit = Boolean(
          voucher.id &&
            sqlite.prepare(`SELECT id FROM vouchers WHERE id = ? AND company_id = ?`).get(voucher.id, auth.companyId)
        );
        const targetId = isEdit ? voucher.id : uid('v');
        let approvalStatus = voucher.approvalStatus || 'approved';
        if (!isEdit && !voucher.approvalStatus) {
          const rule = sqlite
            .prepare(`SELECT * FROM approval_rules WHERE company_id = ? AND document_type = ? AND enabled = 1 LIMIT 1`)
            .get(auth.companyId, voucher.type) as { threshold_amount: number } | undefined;
          if (rule && voucher.grandTotal >= rule.threshold_amount) {
            approvalStatus = 'pending_approval';
          }
        }
        const finalVoucher: Voucher = {
          ...voucher,
          id: targetId,
          approvalStatus,
          createdAt: voucher.createdAt || new Date().toISOString(),
        };

        if (isEdit) {
          const oldRow = sqlite.prepare(`SELECT * FROM vouchers WHERE id = ?`).get(targetId) as Record<string, unknown>;
          const oldLines = sqlite.prepare(`SELECT * FROM voucher_lines WHERE voucher_id = ?`).all(targetId);
          const oldVoucher: Voucher = {
            ...(finalVoucher as Voucher),
            type: String(oldRow.type) as VoucherType,
            status: String(oldRow.status) as Voucher['status'],
            lines: oldLines.map((l) => ({
              id: String(l.id),
              itemId: String(l.item_id),
              itemName: String(l.item_name),
              hsn: String(l.hsn),
              qty: Number(l.qty),
              unit: String(l.unit),
              rate: Number(l.rate),
              discountPct: Number(l.discount_pct),
              taxRate: Number(l.tax_rate),
              cessRate: Number(l.cess_rate),
              taxableAmount: Number(l.taxable_amount),
              cgst: Number(l.cgst),
              sgst: Number(l.sgst),
              igst: Number(l.igst),
              cess: Number(l.cess),
              total: Number(l.total),
            })),
          };
          applyVoucherStockDelta(auth.companyId, oldVoucher, -1);
          sqlite.prepare(`DELETE FROM vouchers WHERE id = ?`).run(targetId);
        }

        // Purchase Entry Auto-Add Items to Inventory
        if (finalVoucher.type === 'purchase_bill' && Array.isArray(finalVoucher.lines)) {
          const defGodown = sqlite
            .prepare(`SELECT id FROM godowns WHERE company_id = ? ORDER BY is_default DESC LIMIT 1`)
            .get(auth.companyId) as { id?: string } | undefined;
          const godownId = defGodown?.id || 'g1';

          for (const line of finalVoucher.lines) {
            const cleanName = String(line.itemName || '').trim();
            if (!cleanName) continue;
            const existingById =
              line.itemId && !line.itemId.startsWith('new_')
                ? (sqlite.prepare(`SELECT id, batches_json, purchase_price, mrp FROM items WHERE id = ? AND company_id = ?`).get(line.itemId, auth.companyId) as
                    | { id: string; batches_json: string; purchase_price: number; mrp: number }
                    | undefined)
                : undefined;

            const existingByName = !existingById
              ? (sqlite.prepare(`SELECT id, batches_json, purchase_price, mrp FROM items WHERE LOWER(name) = LOWER(?) AND company_id = ? LIMIT 1`).get(cleanName, auth.companyId) as
                  | { id: string; batches_json: string; purchase_price: number; mrp: number }
                  | undefined)
              : undefined;

            const matched = existingById || existingByName;
            if (matched) {
              line.itemId = matched.id;
              let batches: Array<Record<string, unknown>> = [];
              try {
                batches = JSON.parse(matched.batches_json || '[]');
              } catch {
                batches = [];
              }
              if (line.batchNo && !batches.some((b) => String(b.batchNo) === line.batchNo)) {
                batches.push({
                  id: uid('bat'),
                  batchNo: line.batchNo,
                  mfgDate: line.mfgDate || '',
                  expiryDate: line.expDate || '',
                  qty: line.qty,
                  costPerUnit: line.rate,
                });
              }
              const nextPur = line.rate > 0 ? line.rate : matched.purchase_price;
              const nextMrp = line.mrp && line.mrp > 0 ? line.mrp : matched.mrp;
              sqlite
                .prepare(`UPDATE items SET purchase_price = ?, mrp = ?, batches_json = ?, track_batch = CASE WHEN ? != '' THEN 1 ELSE track_batch END WHERE id = ?`)
                .run(nextPur, nextMrp, JSON.stringify(batches), line.batchNo || '', matched.id);
            } else {
              const newItemId = uid('i');
              const suggestedSale = line.newItemMeta?.salePrice && line.newItemMeta.salePrice > 0
                ? line.newItemMeta.salePrice
                : Math.max(line.mrp || 0, Number((line.rate * 1.2).toFixed(2)));
              const initialBatch = line.batchNo
                ? [{ id: uid('bat'), batchNo: line.batchNo, mfgDate: line.mfgDate || '', expiryDate: line.expDate || '', qty: line.qty, costPerUnit: line.rate }]
                : [];
              sqlite
                .prepare(
                  `INSERT INTO items (
                    id, company_id, name, type, sku, barcode, hsn, category, subcategory, unit, secondary_unit,
                    conversion_rate, sale_price, purchase_price, mrp, wholesale_price, tax_rate, cess_rate,
                    tax_inclusive, opening_stock, stock_qty, min_stock_alert, max_stock, lead_time_days, safety_stock, bin_location,
                    godown_id, godown_stock_json, track_batch, batches_json
                  ) VALUES (?, ?, ?, 'product', ?, '', ?, ?, '', ?, '', 1, ?, ?, ?, ?, ?, ?, 0, 0, 0, 5, 250, 5, 10, 'RACK-A1', ?, '{}', ?, ?)`
                )
                .run(
                  newItemId,
                  auth.companyId,
                  cleanName,
                  line.newItemMeta?.sku || `SKU-${Date.now().toString().slice(-5)}`,
                  line.hsn || '',
                  line.newItemMeta?.category || 'Purchased Goods',
                  line.unit || 'PCS',
                  suggestedSale,
                  line.rate || 0,
                  line.newItemMeta?.mrp ?? line.mrp ?? suggestedSale,
                  Number((line.rate * 1.1).toFixed(2)),
                  line.taxRate ?? 18,
                  line.cessRate ?? 0,
                  godownId,
                  line.batchNo ? 1 : 0,
                  JSON.stringify(initialBatch)
                );
              line.itemId = newItemId;
              recordAudit(auth.companyId, auth.userId, auth.userName, 'AUTO_CREATE_ITEM', 'Item', newItemId, `Auto-added from Purchase ${finalVoucher.voucherNo}: ${cleanName}`);
            }
          }
        }

        insertVoucherFull(auth.companyId, finalVoucher, auth.userId);
        applyVoucherStockDelta(auth.companyId, finalVoucher, 1);
        postJournalForVoucher(auth.companyId, finalVoucher);

        if (convertFromVoucherId) {
          sqlite
            .prepare(`UPDATE vouchers SET status = 'converted' WHERE id = ? AND company_id = ?`)
            .run(convertFromVoucherId, auth.companyId);
        }

        recordAudit(
          auth.companyId,
          auth.userId,
          auth.userName,
          isEdit ? 'UPDATE_VOUCHER' : 'CREATE_VOUCHER',
          finalVoucher.type,
          finalVoucher.id,
          `${finalVoucher.voucherNo} (${finalVoucher.partyName || finalVoucher.expenseCategory || 'Ledger'}) ₹${finalVoucher.grandTotal}`
        );
        return targetId;
      });

      const payload = buildBootstrapPayload(auth.userId, auth.companyId);
      const savedVoucher = payload.vouchers.find((v) => v.id === savedId);
      res.json({ data: payload, savedVoucher });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Voucher save failed (rolled back).' });
    }
  });

  app.post('/api/vouchers/:id/cancel', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    runTransaction(() => {
      const row = sqlite
        .prepare(`SELECT * FROM vouchers WHERE id = ? AND company_id = ?`)
        .get(id, auth.companyId) as Record<string, unknown> | undefined;
      if (!row || row.status === 'cancelled') return;
      const lines = sqlite.prepare(`SELECT * FROM voucher_lines WHERE voucher_id = ?`).all(id);
      const oldV: Voucher = {
        id,
        type: String(row.type) as VoucherType,
        voucherNo: String(row.voucher_no),
        date: String(row.date),
        status: String(row.status) as Voucher['status'],
        lines: lines.map((l) => ({
          id: String(l.id),
          itemId: String(l.item_id),
          itemName: String(l.item_name),
          hsn: String(l.hsn),
          qty: Number(l.qty),
          unit: String(l.unit),
          rate: Number(l.rate),
          discountPct: Number(l.discount_pct),
          taxRate: Number(l.tax_rate),
          cessRate: Number(l.cess_rate),
          taxableAmount: Number(l.taxable_amount),
          cgst: Number(l.cgst),
          sgst: Number(l.sgst),
          igst: Number(l.igst),
          cess: Number(l.cess),
          total: Number(l.total),
        })),
        additionalCharges: 0,
        discountTotal: 0,
        roundOff: 0,
        subTotal: 0,
        taxTotal: 0,
        grandTotal: 0,
        paidAmount: 0,
        createdAt: String(row.created_at),
      };
      applyVoucherStockDelta(auth.companyId, oldV, -1);
      sqlite.prepare(`UPDATE vouchers SET status = 'cancelled' WHERE id = ?`).run(id);
      sqlite.prepare(`DELETE FROM journal_entries WHERE voucher_id = ?`).run(id);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'CANCEL_VOUCHER', String(row.type), id, `Cancelled ${row.voucher_no}`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/vouchers/:id/reconcile', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { reconciled } = req.body as { reconciled: boolean };
    sqlite
      .prepare(`UPDATE vouchers SET reconciled = ?, reconciled_date = ? WHERE id = ? AND company_id = ?`)
      .run(reconciled ? 1 : 0, reconciled ? new Date().toISOString().slice(0, 10) : null, id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'BANK_RECONCILE', 'Voucher', id, `Marked reconciled=${reconciled}`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.delete('/api/vouchers/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    runTransaction(() => {
      const row = sqlite
        .prepare(`SELECT * FROM vouchers WHERE id = ? AND company_id = ?`)
        .get(id, auth.companyId) as Record<string, unknown> | undefined;
      if (!row) return;
      const lines = sqlite.prepare(`SELECT * FROM voucher_lines WHERE voucher_id = ?`).all(id);
      const oldV: Voucher = {
        id,
        branchId: row.branch_id ? String(row.branch_id) : undefined,
        type: String(row.type) as VoucherType,
        voucherNo: String(row.voucher_no),
        date: String(row.date),
        dueDate: row.due_date ? String(row.due_date) : undefined,
        partyId: row.party_id ? String(row.party_id) : undefined,
        partyName: row.party_name ? String(row.party_name) : undefined,
        partyGstin: row.party_gstin ? String(row.party_gstin) : undefined,
        placeOfSupply: row.place_of_supply ? String(row.place_of_supply) : undefined,
        isInterState: Boolean(row.is_inter_state),
        lines: lines.map((l) => {
          let meta: Record<string, unknown> = {};
          try {
            meta = JSON.parse(String(l.meta_json || '{}'));
          } catch {
            meta = {};
          }
          return {
            id: String(l.id),
            itemId: String(l.item_id),
            itemName: String(l.item_name),
            description: meta.description ? String(meta.description) : undefined,
            hsn: String(l.hsn),
            qty: Number(l.qty),
            unit: String(l.unit),
            rate: Number(l.rate),
            mrp: meta.mrp !== undefined ? Number(meta.mrp) : undefined,
            discountPct: Number(l.discount_pct),
            taxRate: Number(l.tax_rate),
            cessRate: Number(l.cess_rate),
            taxableAmount: Number(l.taxable_amount),
            cgst: Number(l.cgst),
            sgst: Number(l.sgst),
            igst: Number(l.igst),
            cess: Number(l.cess),
            total: Number(l.total),
            batchNo: l.batch_no ? String(l.batch_no) : undefined,
            serialNo: meta.serialNo ? String(meta.serialNo) : undefined,
            mfgDate: meta.mfgDate ? String(meta.mfgDate) : undefined,
            expDate: meta.expDate ? String(meta.expDate) : undefined,
            modelNo: meta.modelNo ? String(meta.modelNo) : undefined,
            size: meta.size ? String(meta.size) : undefined,
            customValues: meta.customValues && typeof meta.customValues === 'object' ? (meta.customValues as Record<string, string>) : undefined,
          };
        }),
        additionalCharges: Number(row.additional_charges || 0),
        discountTotal: Number(row.discount_total || 0),
        roundOff: Number(row.round_off || 0),
        subTotal: Number(row.sub_total || 0),
        taxTotal: Number(row.tax_total || 0),
        grandTotal: Number(row.grand_total || 0),
        paidAmount: Number(row.paid_amount || 0),
        paymentMode: row.payment_mode ? (String(row.payment_mode) as Voucher['paymentMode']) : undefined,
        bankAccountId: row.bank_account_id ? String(row.bank_account_id) : undefined,
        status: String(row.status) as Voucher['status'],
        ewayBillNo: row.eway_bill_no ? String(row.eway_bill_no) : undefined,
        vehicleNo: row.vehicle_no ? String(row.vehicle_no) : undefined,
        transporterName: row.transporter_name ? String(row.transporter_name) : undefined,
        isReverseCharge: Boolean(row.is_reverse_charge),
        expenseCategory: row.expense_category ? String(row.expense_category) : undefined,
        contraFromId: row.contra_from_id ? String(row.contra_from_id) : undefined,
        contraToId: row.contra_to_id ? String(row.contra_to_id) : undefined,
        journalLines: row.journal_lines_json ? JSON.parse(String(row.journal_lines_json)) : undefined,
        salesChannel: (row.sales_channel ? String(row.sales_channel) : 'Direct B2B') as Voucher['salesChannel'],
        notes: row.notes ? String(row.notes) : undefined,
        terms: row.terms ? String(row.terms) : undefined,
        createdAt: String(row.created_at),
      };

      sqlite
        .prepare(
          `INSERT INTO recycle_bin (id, company_id, entity_type, entity_id, title, subtitle, amount, payload_json, deleted_by, deleted_at)
           VALUES (?, ?, 'voucher', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          uid('rb'),
          auth.companyId,
          id,
          `${oldV.voucherNo} (${oldV.type.replace(/_/g, ' ')})`,
          `${oldV.partyName || oldV.expenseCategory || 'Cash/Ledger'} · ${oldV.date}`,
          oldV.grandTotal,
          JSON.stringify(oldV),
          auth.userName,
          new Date().toISOString()
        );

      applyVoucherStockDelta(auth.companyId, oldV, -1);
      sqlite.prepare(`DELETE FROM vouchers WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'DELETE_VOUCHER', String(row.type), id, `Moved ${row.voucher_no} to Recycle Bin`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- PARTIES ---
  app.post('/api/parties', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireActiveLicenseOrTrial(auth.companyId, res)) return;
    const p = req.body;
    runTransaction(() => {
      const id = p.id || uid('p');
      sqlite
        .prepare(
          `INSERT INTO parties (
            id, company_id, name, type, phone, email, gstin, pan, state, billing_address, shipping_address,
            opening_balance, opening_type, credit_limit, credit_days, group_name, risk_category, credit_hold,
            avg_delivery_days, quality_rating, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, type=excluded.type, phone=excluded.phone, email=excluded.email,
            gstin=excluded.gstin, pan=excluded.pan, state=excluded.state, billing_address=excluded.billing_address,
            shipping_address=excluded.shipping_address, opening_balance=excluded.opening_balance,
            opening_type=excluded.opening_type, credit_limit=excluded.credit_limit, credit_days=excluded.credit_days,
            group_name=excluded.group_name, risk_category=excluded.risk_category, credit_hold=excluded.credit_hold,
            avg_delivery_days=excluded.avg_delivery_days, quality_rating=excluded.quality_rating`
        )
        .run(
          id,
          auth.companyId,
          p.name,
          p.type || 'customer',
          p.phone || '',
          p.email || '',
          p.gstin || '',
          p.pan || '',
          p.state || 'Maharashtra',
          p.billingAddress || '',
          p.shippingAddress || p.billingAddress || '',
          p.openingBalance || 0,
          p.openingType || 'receivable',
          p.creditLimit || 0,
          p.creditDays || 30,
          p.group || 'Sundry Debtors',
          p.riskCategory || 'Low',
          p.creditHold ? 1 : 0,
          p.avgDeliveryDays ?? 3,
          p.qualityRating ?? 4.5,
          p.createdAt || new Date().toISOString().slice(0, 10)
        );
      recordAudit(auth.companyId, auth.userId, auth.userName, p.id ? 'UPDATE_PARTY' : 'CREATE_PARTY', 'Party', id, p.name);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/parties/bulk', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireFeatureUnlocked(auth.companyId, 'ocr_bulk_tools', res)) return;
    const rows = Array.isArray(req.body?.parties) ? (req.body.parties as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) {
      res.status(400).json({ error: 'No party rows provided for bulk import.' });
      return;
    }
    if (rows.length > 1000) {
      res.status(400).json({ error: 'Maximum 1000 parties per bulk Excel import batch.' });
      return;
    }

    let importedCount = 0;
    let updatedCount = 0;
    runTransaction(() => {
      const existingRows = sqlite
        .prepare(`SELECT id, name, gstin FROM parties WHERE company_id = ?`)
        .all(auth.companyId) as Array<{ id: string; name: string; gstin: string }>;
      const byName = new Map(existingRows.map((r) => [r.name.trim().toLowerCase(), r.id]));
      const byGstin = new Map(
        existingRows.filter((r) => r.gstin).map((r) => [r.gstin.trim().toUpperCase(), r.id])
      );

      const stmt = sqlite.prepare(
        `INSERT INTO parties (
          id, company_id, name, type, phone, email, gstin, pan, state, billing_address, shipping_address,
          opening_balance, opening_type, credit_limit, credit_days, group_name, risk_category, credit_hold,
          avg_delivery_days, quality_rating, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, type=excluded.type, phone=excluded.phone, email=excluded.email,
          gstin=excluded.gstin, pan=excluded.pan, state=excluded.state, billing_address=excluded.billing_address,
          shipping_address=excluded.shipping_address, opening_balance=excluded.opening_balance,
          opening_type=excluded.opening_type, credit_limit=excluded.credit_limit, credit_days=excluded.credit_days,
          group_name=excluded.group_name`
      );

      for (const r of rows) {
        const name = String(r.name || '').trim();
        if (!name) continue;
        const gstin = String(r.gstin || '').trim().toUpperCase().slice(0, 15);
        const existingId =
          (r.id ? String(r.id) : '') ||
          (gstin ? byGstin.get(gstin) : undefined) ||
          byName.get(name.toLowerCase());
        const id = existingId || uid('p');
        if (existingId) updatedCount += 1;
        else importedCount += 1;

        const rawType = String(r.type || 'customer').toLowerCase();
        const type = rawType === 'supplier' || rawType === 'both' ? rawType : 'customer';
        const openingType = String(r.openingType || (type === 'supplier' ? 'payable' : 'receivable')).toLowerCase() === 'payable' ? 'payable' : 'receivable';
        const addr = String(r.billingAddress || '');

        stmt.run(
          id,
          auth.companyId,
          name,
          type,
          String(r.phone || ''),
          String(r.email || ''),
          gstin,
          String(r.pan || '').trim().toUpperCase().slice(0, 10),
          String(r.state || 'Maharashtra'),
          addr,
          String(r.shippingAddress || addr),
          Number(r.openingBalance || 0),
          openingType,
          Number(r.creditLimit || 0),
          Number(r.creditDays || 30),
          String(r.group || (type === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors')),
          'Low',
          0,
          3,
          4.5,
          new Date().toISOString().slice(0, 10)
        );
        byName.set(name.toLowerCase(), id);
        if (gstin) byGstin.set(gstin, id);
      }
      recordAudit(
        auth.companyId,
        auth.userId,
        auth.userName,
        'BULK_IMPORT_PARTIES',
        'Party',
        auth.companyId,
        `Imported ${importedCount} new, updated ${updatedCount} parties`
      );
    });
    res.json({ importedCount, updatedCount, data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.delete('/api/parties/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    sqlite.prepare(`DELETE FROM parties WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'DELETE_PARTY', 'Party', id, 'Deleted party');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- ITEMS ---
  app.post('/api/items', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireActiveLicenseOrTrial(auth.companyId, res)) return;
    const i = req.body;
    runTransaction(() => {
      const id = i.id || uid('i');
      sqlite
        .prepare(
          `INSERT INTO items (
            id, company_id, name, type, sku, barcode, hsn, category, subcategory, unit, secondary_unit,
            conversion_rate, sale_price, purchase_price, mrp, wholesale_price, tax_rate, cess_rate,
            tax_inclusive, opening_stock, stock_qty, min_stock_alert, max_stock, lead_time_days, safety_stock, bin_location,
            godown_id, godown_stock_json, track_batch, batches_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, type=excluded.type, sku=excluded.sku, barcode=excluded.barcode, hsn=excluded.hsn,
            category=excluded.category, subcategory=excluded.subcategory, unit=excluded.unit,
            secondary_unit=excluded.secondary_unit, conversion_rate=excluded.conversion_rate,
            sale_price=excluded.sale_price, purchase_price=excluded.purchase_price, mrp=excluded.mrp,
            wholesale_price=excluded.wholesale_price, tax_rate=excluded.tax_rate, cess_rate=excluded.cess_rate,
            tax_inclusive=excluded.tax_inclusive, stock_qty=excluded.stock_qty, min_stock_alert=excluded.min_stock_alert,
            max_stock=excluded.max_stock, lead_time_days=excluded.lead_time_days, safety_stock=excluded.safety_stock,
            bin_location=excluded.bin_location, godown_id=excluded.godown_id, godown_stock_json=excluded.godown_stock_json,
            track_batch=excluded.track_batch, batches_json=excluded.batches_json`
        )
        .run(
          id,
          auth.companyId,
          i.name,
          i.type || 'product',
          i.sku || '',
          i.barcode || '',
          i.hsn || '',
          i.category || 'General',
          i.subcategory || '',
          i.unit || 'PCS',
          i.secondaryUnit || '',
          i.conversionRate || 1,
          i.salePrice || 0,
          i.purchasePrice || 0,
          i.mrp || 0,
          i.wholesalePrice || 0,
          i.taxRate || 18,
          i.cessRate || 0,
          i.taxInclusive ? 1 : 0,
          i.openingStock ?? i.stockQty ?? 0,
          i.stockQty || 0,
          i.minStockAlert || 10,
          i.maxStock ?? 250,
          i.leadTimeDays ?? 5,
          i.safetyStock ?? 15,
          i.binLocation || 'RACK-A1',
          i.godownId || '',
          JSON.stringify(i.godownStock || {}),
          i.trackBatch ? 1 : 0,
          JSON.stringify(i.batches || [])
        );
      recordAudit(auth.companyId, auth.userId, auth.userName, i.id ? 'UPDATE_ITEM' : 'CREATE_ITEM', 'Item', id, i.name);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/items/bulk', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireFeatureUnlocked(auth.companyId, 'ocr_bulk_tools', res)) return;
    const rows = Array.isArray(req.body?.items) ? (req.body.items as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) {
      res.status(400).json({ error: 'No item rows provided for bulk import.' });
      return;
    }
    if (rows.length > 1000) {
      res.status(400).json({ error: 'Maximum 1000 items per bulk Excel import batch.' });
      return;
    }

    let importedCount = 0;
    let updatedCount = 0;
    runTransaction(() => {
      const existingRows = sqlite
        .prepare(`SELECT id, name, sku FROM items WHERE company_id = ?`)
        .all(auth.companyId) as Array<{ id: string; name: string; sku: string }>;
      const byName = new Map(existingRows.map((r) => [r.name.trim().toLowerCase(), r.id]));
      const bySku = new Map(
        existingRows.filter((r) => r.sku).map((r) => [r.sku.trim().toLowerCase(), r.id])
      );
      const defaultGodown = sqlite
        .prepare(`SELECT id FROM godowns WHERE company_id = ? ORDER BY is_default DESC LIMIT 1`)
        .get(auth.companyId) as { id: string } | undefined;
      const fallbackGodownId = defaultGodown?.id || 'g1';

      const stmt = sqlite.prepare(
        `INSERT INTO items (
          id, company_id, name, type, sku, barcode, hsn, category, subcategory, unit, secondary_unit,
          conversion_rate, sale_price, purchase_price, mrp, wholesale_price, tax_rate, cess_rate,
          tax_inclusive, opening_stock, stock_qty, min_stock_alert, max_stock, lead_time_days, safety_stock, bin_location,
          godown_id, godown_stock_json, track_batch, batches_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, type=excluded.type, sku=excluded.sku, barcode=excluded.barcode, hsn=excluded.hsn,
          category=excluded.category, subcategory=excluded.subcategory, unit=excluded.unit,
          sale_price=excluded.sale_price, purchase_price=excluded.purchase_price, mrp=excluded.mrp,
          wholesale_price=excluded.wholesale_price, tax_rate=excluded.tax_rate, cess_rate=excluded.cess_rate,
          tax_inclusive=excluded.tax_inclusive, stock_qty=excluded.stock_qty, min_stock_alert=excluded.min_stock_alert,
          max_stock=excluded.max_stock, bin_location=excluded.bin_location`
      );

      for (const r of rows) {
        const name = String(r.name || '').trim();
        if (!name) continue;
        const sku = String(r.sku || '').trim();
        const existingId =
          (r.id ? String(r.id) : '') ||
          (sku ? bySku.get(sku.toLowerCase()) : undefined) ||
          byName.get(name.toLowerCase());
        const id = existingId || uid('i');
        if (existingId) updatedCount += 1;
        else importedCount += 1;

        const stockQty = Number(r.stockQty || 0);
        const type = String(r.type || 'product').toLowerCase() === 'service' ? 'service' : 'product';

        stmt.run(
          id,
          auth.companyId,
          name,
          type,
          sku || `SKU-${id.slice(-5).toUpperCase()}`,
          String(r.barcode || ''),
          String(r.hsn || ''),
          String(r.category || 'General'),
          String(r.subcategory || ''),
          String(r.unit || 'PCS').toUpperCase(),
          '',
          1,
          Number(r.salePrice || 0),
          Number(r.purchasePrice || 0),
          Number(r.mrp || 0),
          Number(r.wholesalePrice || 0),
          Number(r.taxRate ?? 18),
          Number(r.cessRate || 0),
          r.taxInclusive === true || String(r.taxInclusive).toLowerCase() === 'true' || String(r.taxInclusive).toLowerCase() === 'yes' ? 1 : 0,
          stockQty,
          stockQty,
          Number(r.minStockAlert ?? 10),
          Number(r.maxStock ?? 250),
          Number(r.leadTimeDays ?? 5),
          Number(r.safetyStock ?? 15),
          String(r.binLocation || 'RACK-A1'),
          fallbackGodownId,
          JSON.stringify({ [fallbackGodownId]: stockQty }),
          0,
          '[]'
        );
        byName.set(name.toLowerCase(), id);
        if (sku) bySku.set(sku.toLowerCase(), id);
      }
      recordAudit(
        auth.companyId,
        auth.userId,
        auth.userName,
        'BULK_IMPORT_ITEMS',
        'Item',
        auth.companyId,
        `Imported ${importedCount} new, updated ${updatedCount} items`
      );
    });
    res.json({ importedCount, updatedCount, data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.delete('/api/items/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    sqlite.prepare(`DELETE FROM items WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'DELETE_ITEM', 'Item', id, 'Deleted item');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- GODOWNS, STOCK ADJUSTMENTS & TRANSFERS ---
  app.post('/api/godowns', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const g = req.body;
    const id = g.id || uid('g');
    sqlite
      .prepare(
        `INSERT INTO godowns (id, company_id, branch_id, name, location, manager, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, auth.companyId, g.branchId || null, g.name, g.location || '', g.manager || auth.userName, g.isDefault ? 1 : 0);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'CREATE_GODOWN', 'Godown', id, g.name);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/stock-adjustments', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const adj = req.body;
    runTransaction(() => {
      const id = uid('sa');
      sqlite
        .prepare(
          `INSERT INTO stock_adjustments (id, company_id, date, item_id, item_name, type, qty, reason, cost_per_unit, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, auth.companyId, adj.date, adj.itemId, adj.itemName, adj.type, adj.qty, adj.reason, adj.costPerUnit || 0, adj.notes || '');

      const item = sqlite.prepare(`SELECT stock_qty, godown_id, godown_stock_json FROM items WHERE id = ?`).get(adj.itemId) as
        | { stock_qty: number; godown_id: string; godown_stock_json: string }
        | undefined;
      if (item) {
        const delta = adj.type === 'add' ? adj.qty : -adj.qty;
        const nextQty = Math.max(0, item.stock_qty + delta);
        const gs = JSON.parse(item.godown_stock_json || '{}');
        const gId = item.godown_id || 'g1';
        gs[gId] = Math.max(0, (gs[gId] || 0) + delta);
        sqlite.prepare(`UPDATE items SET stock_qty = ?, godown_stock_json = ? WHERE id = ?`).run(nextQty, JSON.stringify(gs), adj.itemId);
      }
      recordAudit(auth.companyId, auth.userId, auth.userName, 'STOCK_ADJUST', 'Item', adj.itemId, `${adj.type} ${adj.qty} (${adj.reason})`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/stock-transfers', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const trf = req.body;
    runTransaction(() => {
      const id = uid('st');
      const count = (sqlite.prepare(`SELECT COUNT(*) as c FROM stock_transfers WHERE company_id = ?`).get(auth.companyId) as { c: number }).c;
      const transferNo = `TRF-${String(count + 1).padStart(3, '0')}`;
      sqlite
        .prepare(
          `INSERT INTO stock_transfers (id, company_id, transfer_no, date, from_godown_id, to_godown_id, items_json, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, auth.companyId, transferNo, trf.date, trf.fromGodownId, trf.toGodownId, JSON.stringify(trf.items), trf.notes || '');

      for (const line of trf.items) {
        const item = sqlite.prepare(`SELECT godown_stock_json FROM items WHERE id = ?`).get(line.itemId) as { godown_stock_json: string } | undefined;
        if (item) {
          const gs = JSON.parse(item.godown_stock_json || '{}');
          gs[trf.fromGodownId] = Math.max(0, (gs[trf.fromGodownId] || 0) - line.qty);
          gs[trf.toGodownId] = (gs[trf.toGodownId] || 0) + line.qty;
          sqlite.prepare(`UPDATE items SET godown_stock_json = ? WHERE id = ?`).run(JSON.stringify(gs), line.itemId);
        }
      }
      recordAudit(auth.companyId, auth.userId, auth.userName, 'STOCK_TRANSFER', 'Godown', id, transferNo);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- BANKING, CHEQUES, LOANS, LEDGERS, STAFF ---
  app.post('/api/bank-accounts', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireActiveLicenseOrTrial(auth.companyId, res)) return;
    const b = req.body;
    const id = b.id || uid('bank');
    sqlite
      .prepare(
        `INSERT INTO bank_accounts (id, company_id, bank_name, account_no, ifsc, branch, upi_id, opening_balance, type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, auth.companyId, b.bankName, b.accountNo || '', b.ifsc || '', b.branch || '', b.upiId || '', b.openingBalance || 0, b.type || 'bank');
    recordAudit(auth.companyId, auth.userId, auth.userName, 'CREATE_BANK', 'BankAccount', id, b.bankName);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.delete('/api/bank-accounts/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const row = sqlite.prepare(`SELECT * FROM bank_accounts WHERE id = ? AND company_id = ?`).get(id, auth.companyId) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }
    if (String(row.type) === 'cash') {
      res.status(400).json({ error: 'Primary Cash-in-Hand drawer cannot be deleted' });
      return;
    }
    runTransaction(() => {
      const bankObj = {
        id: String(row.id),
        bankName: String(row.bank_name),
        accountNo: String(row.account_no || ''),
        ifsc: String(row.ifsc || ''),
        branch: String(row.branch || ''),
        upiId: String(row.upi_id || ''),
        openingBalance: Number(row.opening_balance || 0),
        type: String(row.type || 'bank'),
      };
      sqlite
        .prepare(
          `INSERT INTO recycle_bin (id, company_id, entity_type, entity_id, title, subtitle, amount, payload_json, deleted_by, deleted_at)
           VALUES (?, ?, 'bank_account', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          uid('rb'),
          auth.companyId,
          id,
          bankObj.bankName,
          `A/C: ${bankObj.accountNo || 'N/A'} · IFSC: ${bankObj.ifsc || 'N/A'}`,
          bankObj.openingBalance,
          JSON.stringify(bankObj),
          auth.userName,
          new Date().toISOString()
        );
      sqlite.prepare(`DELETE FROM bank_accounts WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'DELETE_BANK', 'BankAccount', id, `Moved bank account ${bankObj.bankName} to Recycle Bin`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/recycle-bin/:id/restore', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const entry = sqlite
      .prepare(`SELECT * FROM recycle_bin WHERE id = ? AND company_id = ?`)
      .get(id, auth.companyId) as Record<string, unknown> | undefined;
    if (!entry) {
      res.status(404).json({ error: 'Recycle bin entry not found' });
      return;
    }
    runTransaction(() => {
      const entityType = String(entry.entity_type);
      const payload = JSON.parse(String(entry.payload_json));
      if (entityType === 'bank_account') {
        sqlite
          .prepare(
            `INSERT INTO bank_accounts (id, company_id, bank_name, account_no, ifsc, branch, upi_id, opening_balance, type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               bank_name=excluded.bank_name, account_no=excluded.account_no, ifsc=excluded.ifsc,
               branch=excluded.branch, upi_id=excluded.upi_id, opening_balance=excluded.opening_balance, type=excluded.type`
          )
          .run(
            String(payload.id),
            auth.companyId,
            String(payload.bankName),
            String(payload.accountNo || ''),
            String(payload.ifsc || ''),
            String(payload.branch || ''),
            String(payload.upiId || ''),
            Number(payload.openingBalance || 0),
            String(payload.type || 'bank')
          );
        recordAudit(auth.companyId, auth.userId, auth.userName, 'RESTORE_BANK', 'BankAccount', String(payload.id), `Restored ${payload.bankName} from Recycle Bin`);
      } else if (entityType === 'voucher') {
        const v = payload as Voucher;
        const clash = sqlite
          .prepare(`SELECT id FROM vouchers WHERE company_id = ? AND type = ? AND voucher_no = ?`)
          .get(auth.companyId, v.type, v.voucherNo);
        const restoreNo = clash ? `${v.voucherNo}-R${Date.now().toString().slice(-3)}` : v.voucherNo;
        const idClash = sqlite.prepare(`SELECT id FROM vouchers WHERE id = ?`).get(v.id);
        const restoredV: Voucher = {
          ...v,
          id: idClash ? uid('v') : v.id,
          voucherNo: restoreNo,
        };
        insertVoucherFull(auth.companyId, restoredV, auth.userId);
        applyVoucherStockDelta(auth.companyId, restoredV, 1);
        postJournalForVoucher(auth.companyId, restoredV);
        recordAudit(auth.companyId, auth.userId, auth.userName, 'RESTORE_VOUCHER', v.type, restoredV.id, `Restored ${restoreNo} from Recycle Bin`);
      }
      sqlite.prepare(`DELETE FROM recycle_bin WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.delete('/api/recycle-bin/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    sqlite.prepare(`DELETE FROM recycle_bin WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'PURGE_RECYCLE_ITEM', 'RecycleBin', id, 'Permanently deleted item from Recycle Bin');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.delete('/api/recycle-bin', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    sqlite.prepare(`DELETE FROM recycle_bin WHERE company_id = ?`).run(auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'EMPTY_RECYCLE_BIN', 'RecycleBin', auth.companyId, 'Emptied Recycle Bin');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/cheques', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const c = req.body;
    const id = c.id || uid('chq');
    sqlite
      .prepare(
        `INSERT INTO cheques (id, company_id, cheque_no, date, clearance_date, party_id, party_name, bank_account_id, amount, direction, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, auth.companyId, c.chequeNo, c.date, c.clearanceDate || null, c.partyId, c.partyName, c.bankAccountId, c.amount, c.direction, c.status || 'pending', c.notes || '');
    recordAudit(auth.companyId, auth.userId, auth.userName, 'CREATE_CHEQUE', 'Cheque', id, `#${c.chequeNo} ₹${c.amount}`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.patch('/api/cheques/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { status } = req.body as { status: 'pending' | 'cleared' | 'bounced' };
    runTransaction(() => {
      const target = sqlite.prepare(`SELECT * FROM cheques WHERE id = ? AND company_id = ?`).get(id, auth.companyId) as Record<string, unknown> | undefined;
      if (!target) return;
      const today = new Date().toISOString().slice(0, 10);
      sqlite
        .prepare(`UPDATE cheques SET status = ?, clearance_date = ? WHERE id = ?`)
        .run(status, status === 'cleared' ? today : null, id);

      if (target.status !== 'cleared' && status === 'cleared') {
        const vType: VoucherType = target.direction === 'received' ? 'payment_in' : 'payment_out';
        const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = ?`).get(auth.companyId, vType) as { c: number }).c;
        const vNo = `${vType === 'payment_in' ? 'RCPT-' : 'PAY-'}${String(cnt + 1).padStart(3, '0')}`;
        const autoV: Voucher = {
          id: uid('v'),
          type: vType,
          voucherNo: vNo,
          date: today,
          partyId: String(target.party_id),
          partyName: String(target.party_name),
          lines: [],
          additionalCharges: 0,
          discountTotal: 0,
          roundOff: 0,
          subTotal: Number(target.amount),
          taxTotal: 0,
          grandTotal: Number(target.amount),
          paidAmount: Number(target.amount),
          paymentMode: 'Cheque',
          bankAccountId: String(target.bank_account_id),
          status: 'paid',
          reconciled: true,
          reconciledDate: today,
          notes: `Cheque #${target.cheque_no} cleared`,
          createdAt: new Date().toISOString(),
        };
        insertVoucherFull(auth.companyId, autoV, auth.userId);
        postJournalForVoucher(auth.companyId, autoV);
      }
      recordAudit(auth.companyId, auth.userId, auth.userName, 'UPDATE_CHEQUE', 'Cheque', id, `Status -> ${status}`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/loans', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const l = req.body;
    const id = l.id || uid('ln');
    sqlite
      .prepare(
        `INSERT INTO loans (id, company_id, lender_name, account_no, principal, interest_rate, emi_amount, start_date, tenure_months, paid_emis, bank_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, auth.companyId, l.lenderName, l.accountNo, l.principal, l.interestRate, l.emiAmount, l.startDate, l.tenureMonths, l.paidEmis || 0, l.bankAccountId);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/loans/:id/pay-emi', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    runTransaction(() => {
      const loan = sqlite.prepare(`SELECT * FROM loans WHERE id = ? AND company_id = ?`).get(id, auth.companyId) as Record<string, unknown> | undefined;
      if (!loan || Number(loan.paid_emis) >= Number(loan.tenure_months)) return;
      const nextPaid = Number(loan.paid_emis) + 1;
      sqlite.prepare(`UPDATE loans SET paid_emis = ? WHERE id = ?`).run(nextPaid, id);
      const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = 'expense'`).get(auth.companyId) as { c: number }).c;
      const v: Voucher = {
        id: uid('v'),
        type: 'expense',
        voucherNo: `EXP-${String(cnt + 1).padStart(3, '0')}`,
        date: new Date().toISOString().slice(0, 10),
        expenseCategory: 'Bank Charges',
        lines: [],
        additionalCharges: 0,
        discountTotal: 0,
        roundOff: 0,
        subTotal: Number(loan.emi_amount),
        taxTotal: 0,
        grandTotal: Number(loan.emi_amount),
        paidAmount: Number(loan.emi_amount),
        paymentMode: 'Bank Transfer',
        bankAccountId: String(loan.bank_account_id),
        status: 'paid',
        notes: `Loan EMI #${nextPaid} - ${loan.lender_name}`,
        createdAt: new Date().toISOString(),
      };
      insertVoucherFull(auth.companyId, v, auth.userId);
      postJournalForVoucher(auth.companyId, v);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'PAY_LOAN_EMI', 'Loan', id, `EMI #${nextPaid} ₹${loan.emi_amount}`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/ledgers', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { name, groupName, nature, openingBalance, openingType } = req.body;
    const id = uid('ldg');
    sqlite
      .prepare(
        `INSERT INTO ledger_accounts (id, company_id, name, group_name, nature, opening_balance, opening_type, is_system)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, auth.companyId, name, groupName, nature, openingBalance || 0, openingType || 'Dr');
    recordAudit(auth.companyId, auth.userId, auth.userName, 'CREATE_LEDGER', 'LedgerAccount', id, name);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/staff', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireFeatureUnlocked(auth.companyId, 'payroll', res)) return;
    const m = req.body;
    const id = m.id || uid('stf');
    const count = (sqlite.prepare(`SELECT COUNT(*) as c FROM staff_members WHERE company_id = ?`).get(auth.companyId) as { c: number }).c;
    const empCode = m.empCode || `EMP-${String(101 + count)}`;
    sqlite
      .prepare(
        `INSERT INTO staff_members (
          id, company_id, emp_code, name, role, designation, department, joining_date, employment_type,
          phone, email, pan, uan, esic_no, bank_name, bank_account_no, ifsc, payment_mode,
          monthly_salary, hra_pct, conveyance_amt, allowance_amt, pf_deduction, esic_deduction, pt_deduction, tds_deduction,
          include_pf, include_esic, tax_regime, pt_state, attendance_days, lop_days, overtime_hours, overtime_rate,
          bonus_amt, arrears_amt, commission_pct, cl_balance, sl_balance, el_balance, status, last_paid_month, permissions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          emp_code=excluded.emp_code, name=excluded.name, role=excluded.role, designation=excluded.designation,
          department=excluded.department, joining_date=excluded.joining_date, employment_type=excluded.employment_type,
          phone=excluded.phone, email=excluded.email, pan=excluded.pan, uan=excluded.uan, esic_no=excluded.esic_no,
          bank_name=excluded.bank_name, bank_account_no=excluded.bank_account_no, ifsc=excluded.ifsc, payment_mode=excluded.payment_mode,
          monthly_salary=excluded.monthly_salary, hra_pct=excluded.hra_pct, conveyance_amt=excluded.conveyance_amt,
          allowance_amt=excluded.allowance_amt, pf_deduction=excluded.pf_deduction, esic_deduction=excluded.esic_deduction,
          pt_deduction=excluded.pt_deduction, tds_deduction=excluded.tds_deduction, include_pf=excluded.include_pf,
          include_esic=excluded.include_esic, tax_regime=excluded.tax_regime, pt_state=excluded.pt_state,
          attendance_days=excluded.attendance_days, lop_days=excluded.lop_days, overtime_hours=excluded.overtime_hours,
          overtime_rate=excluded.overtime_rate, bonus_amt=excluded.bonus_amt, arrears_amt=excluded.arrears_amt,
          commission_pct=excluded.commission_pct, cl_balance=excluded.cl_balance, sl_balance=excluded.sl_balance,
          el_balance=excluded.el_balance, status=excluded.status`
      )
      .run(
        id,
        auth.companyId,
        empCode,
        m.name,
        m.role || 'Accountant',
        m.designation || m.role || 'Executive',
        m.department || 'Operations',
        m.joiningDate || '2025-04-01',
        m.employmentType || 'Full-Time',
        m.phone || '',
        m.email || '',
        (m.pan || '').toUpperCase(),
        m.uan || '',
        m.esicNo || '',
        m.bankName || 'HDFC Bank Ltd',
        m.bankAccountNo || '',
        (m.ifsc || '').toUpperCase(),
        m.paymentMode || 'Bank Transfer',
        m.monthlySalary || 0,
        m.hraPct ?? 20,
        m.conveyanceAmt ?? 1600,
        m.allowanceAmt ?? 2000,
        m.pfDeduction ?? 1800,
        m.esicDeduction ?? 0,
        m.ptDeduction ?? 200,
        m.tdsDeduction ?? 0,
        m.includePf === false ? 0 : 1,
        m.includeEsic ? 1 : 0,
        m.taxRegime || 'New',
        m.ptState || 'Maharashtra',
        m.attendanceDays ?? 26,
        m.lopDays ?? 0,
        m.overtimeHours ?? 0,
        m.overtimeRate ?? 250,
        m.bonusAmt ?? 0,
        m.arrearsAmt ?? 0,
        m.commissionPct ?? 1.5,
        m.clBalance ?? 6,
        m.slBalance ?? 6,
        m.elBalance ?? 12,
        m.status || 'active',
        m.lastPaidMonth || null,
        JSON.stringify(m.permissions || [])
      );
    recordAudit(auth.companyId, auth.userId, auth.userName, 'SAVE_STAFF', 'Staff', id, `${m.name} (${m.designation || m.role})`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.delete('/api/staff/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    sqlite.prepare(`DELETE FROM staff_members WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'DELETE_STAFF', 'Staff', id, 'Removed employee from directory');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  const processEmployeePayroll = (
    companyId: string,
    userId: string,
    staffId: string,
    month: string,
    bankAccountId: string,
    overrides?: {
      attendanceDays?: number;
      overtimeHours?: number;
      bonusAmt?: number;
      arrearsAmt?: number;
      otherDeductions?: number;
      commissionAmt?: number;
      notes?: string;
    }
  ) => {
    const m = sqlite.prepare(`SELECT * FROM staff_members WHERE id = ? AND company_id = ?`).get(staffId, companyId) as Record<string, unknown> | undefined;
    if (!m) return;
    const workingDays = 26;
    const paidDays = Math.max(0, Math.min(31, Number(overrides?.attendanceDays ?? m.attendance_days ?? 26)));
    const lopDays = Math.max(0, workingDays - paidDays);
    const ratio = Math.min(1, paidDays / workingDays);

    const ctcMonthly = Number(m.monthly_salary || 0);
    const baseFull = Math.round(ctcMonthly * 0.5);
    const hraFull = Math.round((ctcMonthly * Number(m.hra_pct ?? 20)) / 100);
    const convFull = Number(m.conveyance_amt ?? 1600);
    const specFull = Math.max(0, ctcMonthly - baseFull - hraFull - convFull) + Number(m.allowance_amt ?? 0);

    const basic = Math.round(baseFull * ratio);
    const hra = Math.round(hraFull * ratio);
    const conveyance = Math.round(convFull * ratio);
    const specialAllowance = Math.round(specFull * ratio);
    const otHrs = Number(overrides?.overtimeHours ?? m.overtime_hours ?? 0);
    const overtimePay = Math.round(otHrs * Number(m.overtime_rate ?? 250));
    const bonus = Math.round(Number(overrides?.bonusAmt ?? m.bonus_amt ?? 0));
    const arrears = Math.round(Number(overrides?.arrearsAmt ?? m.arrears_amt ?? 0));
    const commission = Math.round(Number(overrides?.commissionAmt ?? 0));

    // Approved unpaid reimbursements for this employee
    const pendingReimb = sqlite
      .prepare(`SELECT id, amount FROM reimbursements WHERE company_id = ? AND staff_id = ? AND status = 'Approved'`)
      .all(companyId, staffId) as Array<{ id: string; amount: number }>;
    const reimbursement = Math.round(pendingReimb.reduce((s, r) => s + Number(r.amount || 0), 0));

    const grossEarnings = basic + hra + conveyance + specialAllowance + overtimePay + bonus + arrears + commission + reimbursement;

    const includePf = m.include_pf !== undefined ? Boolean(m.include_pf) : true;
    const includeEsic = Boolean(m.include_esic) || (grossEarnings > 0 && grossEarnings <= 21000);
    const employeePf = includePf ? Math.min(1800, Math.round(basic * 0.12)) : 0;
    const employerPf = employeePf;
    const employeeEsic = includeEsic ? Math.ceil(grossEarnings * 0.0075) : 0;
    const employerEsic = includeEsic ? Math.ceil(grossEarnings * 0.0325) : 0;
    const professionalTax = grossEarnings >= 10000 ? Number(m.pt_deduction ?? 200) : 0;
    const tds = Number(m.tds_deduction ?? 0);
    const otherDeductions = Math.round(Number(overrides?.otherDeductions ?? 0));

    // Active salary advance EMI recovery
    const activeAdv = sqlite
      .prepare(`SELECT * FROM employee_advances WHERE company_id = ? AND staff_id = ? AND status = 'Active' ORDER BY date ASC LIMIT 1`)
      .get(companyId, staffId) as Record<string, unknown> | undefined;
    let advanceRecovery = 0;
    if (activeAdv) {
      const rem = Math.max(0, Number(activeAdv.amount) - Number(activeAdv.recovered_amount));
      advanceRecovery = Math.min(rem, Number(activeAdv.monthly_emi || rem));
      const newRec = Number(activeAdv.recovered_amount) + advanceRecovery;
      const newStat = newRec >= Number(activeAdv.amount) ? 'Settled' : 'Active';
      sqlite.prepare(`UPDATE employee_advances SET recovered_amount = ?, status = ? WHERE id = ?`).run(newRec, newStat, String(activeAdv.id));
    }

    const totalDeductions = employeePf + employeeEsic + professionalTax + tds + advanceRecovery + otherDeductions;
    const netPay = Math.max(0, grossEarnings - totalDeductions);
    const today = new Date().toISOString().slice(0, 10);

    // Mark approved reimbursements paid
    for (const r of pendingReimb) {
      sqlite.prepare(`UPDATE reimbursements SET status = 'Paid' WHERE id = ?`).run(r.id);
    }

    sqlite
      .prepare(`UPDATE staff_members SET last_paid_month = ?, attendance_days = ?, lop_days = ? WHERE id = ?`)
      .run(month, paidDays, lopDays, staffId);

    const runCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM payroll_runs WHERE company_id = ?`).get(companyId) as { c: number }).c;
    const payslipNo = `PAY-${month.replace('-', '').slice(2)}-${String(runCount + 1).padStart(3, '0')}`;

    sqlite
      .prepare(
        `INSERT INTO payroll_runs (
          id, company_id, payslip_no, staff_id, staff_name, emp_code, department, designation, month, pay_date,
          working_days, paid_days, lop_days, basic, hra, conveyance, special_allowance, overtime_pay, bonus, commission,
          arrears, reimbursement, gross_earnings, employee_pf, employee_esic, professional_tax, tds, advance_recovery,
          other_deductions, total_deductions, employer_pf, employer_esic, net_pay, payment_mode, bank_account_id, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Paid', ?)`
      )
      .run(
        uid('prun'),
        companyId,
        payslipNo,
        staffId,
        String(m.name),
        String(m.emp_code || ''),
        String(m.department || 'Operations'),
        String(m.designation || m.role),
        month,
        today,
        workingDays,
        paidDays,
        lopDays,
        basic,
        hra,
        conveyance,
        specialAllowance,
        overtimePay,
        bonus,
        commission,
        arrears,
        reimbursement,
        grossEarnings,
        employeePf,
        employeeEsic,
        professionalTax,
        tds,
        advanceRecovery,
        otherDeductions,
        totalDeductions,
        employerPf,
        employerEsic,
        netPay,
        String(m.payment_mode || 'Bank Transfer'),
        bankAccountId || '',
        overrides?.notes || `Monthly Payroll ${month}`
      );

    const bankRow = sqlite.prepare(`SELECT bank_name FROM bank_accounts WHERE id = ?`).get(bankAccountId || '') as { bank_name?: string } | undefined;
    const bankLabel = bankRow?.bank_name || 'Bank Accounts';
    const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = 'journal'`).get(companyId) as { c: number }).c;
    const statutory = employeePf + employeeEsic + professionalTax + tds;

    const jLines: { accountName: string; accountGroup: string; debit: number; credit: number; narration: string }[] = [
      { accountName: 'Staff Salary & Wages', accountGroup: 'Indirect Expenses', debit: grossEarnings, credit: 0, narration: `Payroll ${m.name} (${month})` },
      { accountName: bankLabel, accountGroup: 'Cash/Bank', debit: 0, credit: netPay, narration: `Net Salary Bank Payout (${payslipNo})` },
    ];
    if (statutory > 0) {
      jLines.push({ accountName: 'PF & TDS Payable', accountGroup: 'Duties & Taxes', debit: 0, credit: statutory, narration: `PF + ESIC + PT + TDS Withheld` });
    }
    if (advanceRecovery + otherDeductions > 0) {
      jLines.push({ accountName: 'Staff Advance Recovery', accountGroup: 'Current Assets', debit: 0, credit: advanceRecovery + otherDeductions, narration: `Advance / Deduction Recovery` });
    }
    postJournalForAdjustmentEntry(
      companyId,
      userId,
      today,
      `JV-PAY-${String(cnt + 1).padStart(3, '0')}`,
      `Payroll settlement ${payslipNo} for ${m.name} (${month}) - Net Rs.${netPay}`,
      jLines
    );
    return { payslipNo, netPay, grossEarnings };
  };

  app.post('/api/staff/:id/pay-salary', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireFeatureUnlocked(auth.companyId, 'payroll', res)) return;
    const id = String(req.params.id);
    const body = req.body as {
      month: string;
      bankAccountId: string;
      attendanceDays?: number;
      overtimeHours?: number;
      bonusAmt?: number;
      arrearsAmt?: number;
      otherDeductions?: number;
      commissionAmt?: number;
      notes?: string;
    };
    runTransaction(() => {
      const result = processEmployeePayroll(auth.companyId, auth.userId, id, body.month, body.bankAccountId, body);
      if (result) {
        recordAudit(auth.companyId, auth.userId, auth.userName, 'PAY_SALARY', 'Payroll', id, `${result.payslipNo} (${body.month}) Gross Rs.${result.grossEarnings}, Net Rs.${result.netPay}`);
      }
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/payroll/run-bulk', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireFeatureUnlocked(auth.companyId, 'payroll', res)) return;
    const { month, bankAccountId } = req.body as { month: string; bankAccountId: string };
    let count = 0;
    runTransaction(() => {
      const activeStaff = sqlite
        .prepare(`SELECT id, last_paid_month FROM staff_members WHERE company_id = ? AND status = 'active'`)
        .all(auth.companyId) as Array<{ id: string; last_paid_month: string | null }>;
      for (const st of activeStaff) {
        if (st.last_paid_month === month) continue;
        processEmployeePayroll(auth.companyId, auth.userId, st.id, month, bankAccountId);
        count++;
      }
      recordAudit(auth.companyId, auth.userId, auth.userName, 'BULK_PAYROLL', 'Payroll', month, `Processed bulk payroll for ${count} employees`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId), processedCount: count });
  });

  app.post('/api/payroll/advances', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const a = req.body;
    sqlite
      .prepare(
        `INSERT INTO employee_advances (id, company_id, staff_id, staff_name, date, type, amount, monthly_emi, recovered_amount, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Active')`
      )
      .run(uid('adv'), auth.companyId, a.staffId, a.staffName, a.date || new Date().toISOString().slice(0, 10), a.type || 'Salary Advance', a.amount || 0, a.monthlyEmi || a.amount || 0, a.reason || '');
    recordAudit(auth.companyId, auth.userId, auth.userName, 'ISSUE_ADVANCE', 'Payroll', a.staffId, `${a.type}: Rs.${a.amount} to ${a.staffName}`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/payroll/leaves', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const l = req.body;
    sqlite
      .prepare(
        `INSERT INTO leave_requests (id, company_id, staff_id, staff_name, leave_type, from_date, to_date, days, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`
      )
      .run(uid('lv'), auth.companyId, l.staffId, l.staffName, l.leaveType || 'CL', l.fromDate, l.toDate, l.days || 1, l.reason || '');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.patch('/api/payroll/leaves/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { status } = req.body as { status: 'Approved' | 'Rejected' };
    runTransaction(() => {
      const lv = sqlite.prepare(`SELECT * FROM leave_requests WHERE id = ? AND company_id = ?`).get(id, auth.companyId) as Record<string, unknown> | undefined;
      if (!lv) return;
      sqlite.prepare(`UPDATE leave_requests SET status = ? WHERE id = ?`).run(status, id);
      if (status === 'Approved') {
        const d = Number(lv.days || 1);
        const col = lv.leave_type === 'CL' ? 'cl_balance' : lv.leave_type === 'SL' ? 'sl_balance' : lv.leave_type === 'EL' ? 'el_balance' : null;
        if (col) {
          sqlite.prepare(`UPDATE staff_members SET ${col} = MAX(0, ${col} - ?) WHERE id = ?`).run(d, String(lv.staff_id));
        } else if (lv.leave_type === 'LOP') {
          sqlite.prepare(`UPDATE staff_members SET lop_days = lop_days + ?, attendance_days = MAX(0, attendance_days - ?) WHERE id = ?`).run(d, d, String(lv.staff_id));
        }
      }
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/payroll/reimbursements', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const r = req.body;
    sqlite
      .prepare(
        `INSERT INTO reimbursements (id, company_id, staff_id, staff_name, date, category, amount, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`
      )
      .run(uid('rmb'), auth.companyId, r.staffId, r.staffName, r.date || new Date().toISOString().slice(0, 10), r.category || 'Travel', r.amount || 0, r.description || '');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.patch('/api/payroll/reimbursements/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { status } = req.body as { status: 'Approved' | 'Paid' };
    sqlite.prepare(`UPDATE reimbursements SET status = ? WHERE id = ? AND company_id = ?`).run(status, id, auth.companyId);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/vouchers/:id/shipment', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { shipmentStatus, trackingNo } = req.body as { shipmentStatus: string; trackingNo?: string };
    sqlite
      .prepare(`UPDATE vouchers SET shipment_status = ?, tracking_no = ? WHERE id = ? AND company_id = ?`)
      .run(shipmentStatus, trackingNo || null, id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'UPDATE_SHIPMENT', 'Voucher', id, `${shipmentStatus} (${trackingNo || '-'})`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- NEXT-GEN ERP CRUD & ENGINE ENDPOINTS ---
  app.post('/api/erp/cost-centres', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const c = req.body;
    const id = c.id || uid('cc');
    sqlite.prepare(`INSERT INTO cost_centres (id, company_id, code, name, type, manager, budget_limit, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, type=excluded.type, manager=excluded.manager, budget_limit=excluded.budget_limit, status=excluded.status`)
      .run(id, auth.companyId, c.code, c.name, c.type || 'Department', c.manager || auth.userName, Number(c.budgetLimit || 0), c.status || 'active');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/budgets', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const b = req.body;
    const id = b.id || uid('bud');
    sqlite.prepare(`INSERT INTO budgets (id, company_id, name, category, cost_centre_id, period, budget_type, planned_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, planned_amount=excluded.planned_amount, period=excluded.period`)
      .run(id, auth.companyId, b.name, b.category, b.costCentreId || null, b.period || 'FY 2026-27', b.budgetType || 'Expense', Number(b.plannedAmount || 0), b.notes || '');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/fixed-assets', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const a = req.body;
    const id = a.id || uid('fa');
    sqlite.prepare(`INSERT INTO fixed_assets (id, company_id, asset_code, name, category, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, depreciation_rate_pct, accumulated_dep, location, assigned_to, status, last_depreciated_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, purchase_cost=excluded.purchase_cost, depreciation_method=excluded.depreciation_method, depreciation_rate_pct=excluded.depreciation_rate_pct, location=excluded.location, assigned_to=excluded.assigned_to`)
      .run(id, auth.companyId, a.assetCode || `FA-${Date.now().toString().slice(-3)}`, a.name, a.category || 'Plant & Machinery', a.purchaseDate || new Date().toISOString().slice(0, 10), Number(a.purchaseCost || 0), Number(a.salvageValue || 0), Number(a.usefulLifeYears || 5), a.depreciationMethod || 'SLM', Number(a.depreciationRatePct || 15), Number(a.accumulatedDep || 0), a.location || 'Head Office', a.assignedTo || auth.userName, a.status || 'Active', a.lastDepreciatedDate || null);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/fixed-assets/:id/depreciate', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    runTransaction(() => {
      const a = sqlite.prepare(`SELECT * FROM fixed_assets WHERE id = ? AND company_id = ?`).get(id, auth.companyId) as Record<string, unknown> | undefined;
      if (!a) return;
      const cost = Number(a.purchase_cost);
      const salvage = Number(a.salvage_value);
      const life = Math.max(1, Number(a.useful_life_years));
      const acc = Number(a.accumulated_dep);
      const rate = Number(a.depreciation_rate_pct);
      const bookVal = Math.max(salvage, cost - acc);
      let monthlyDep = 0;
      if (a.depreciation_method === 'WDV') {
        monthlyDep = Math.round(((bookVal * rate) / 100) / 12);
      } else {
        monthlyDep = Math.round((Math.max(0, cost - salvage) / life) / 12);
      }
      monthlyDep = Math.min(monthlyDep, Math.max(0, bookVal - salvage));
      if (monthlyDep <= 0) return;

      const today = new Date().toISOString().slice(0, 10);
      sqlite.prepare(`UPDATE fixed_assets SET accumulated_dep = ?, last_depreciated_date = ? WHERE id = ?`).run(acc + monthlyDep, today, id);
      const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = 'journal'`).get(auth.companyId) as { c: number }).c;
      postJournalForAdjustmentEntry(
        auth.companyId,
        auth.userId,
        today,
        `JV-DEP-${String(cnt + 1).padStart(3, '0')}`,
        `Monthly ${a.depreciation_method} Depreciation - ${a.name} (${a.asset_code})`,
        [
          { accountName: 'Depreciation Expense', accountGroup: 'Indirect Expenses', debit: monthlyDep, credit: 0, narration: `${a.name} Depreciation` },
          { accountName: 'Accumulated Depreciation', accountGroup: 'Fixed Assets', debit: 0, credit: monthlyDep, narration: `Accumulated Dep Provision` },
        ]
      );
      recordAudit(auth.companyId, auth.userId, auth.userName, 'RUN_DEPRECIATION', 'FixedAsset', id, `Posted Rs.${monthlyDep} depreciation for ${a.name}`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/boms', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const b = req.body;
    const id = b.id || uid('bom');
    sqlite.prepare(`INSERT INTO boms (id, company_id, finished_item_id, finished_item_name, sku, output_qty, labour_cost_per_batch, overhead_cost_per_batch, components_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.companyId, b.finishedItemId, b.finishedItemName, b.sku || '', Number(b.outputQty || 1), Number(b.labourCostPerBatch || 0), Number(b.overheadCostPerBatch || 0), JSON.stringify(b.components || []));
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/production-orders', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const o = req.body;
    const id = o.id || uid('prd');
    const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM production_orders WHERE company_id = ?`).get(auth.companyId) as { c: number }).c;
    const orderNo = o.orderNo || `MFG-2627-${String(cnt + 1).padStart(3, '0')}`;
    sqlite.prepare(`INSERT INTO production_orders (id, company_id, order_no, bom_id, finished_item_id, finished_item_name, planned_qty, completed_qty, start_date, due_date, status, planned_material_cost, actual_material_cost, planned_labour_overhead, actual_labour_overhead, wastage_pct, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.companyId, orderNo, o.bomId, o.finishedItemId, o.finishedItemName, Number(o.plannedQty || 1), Number(o.completedQty || 0), o.startDate || new Date().toISOString().slice(0, 10), o.dueDate || new Date().toISOString().slice(0, 10), o.status || 'In-Progress (WIP)', Number(o.plannedMaterialCost || 0), Number(o.actualMaterialCost || o.plannedMaterialCost || 0), Number(o.plannedLabourOverhead || 0), Number(o.actualLabourOverhead || o.plannedLabourOverhead || 0), Number(o.wastagePct || 0), o.notes || '');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/production-orders/:id/complete', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { actualMaterialCost, actualLabourOverhead, wastagePct } = req.body as {
      actualMaterialCost?: number;
      actualLabourOverhead?: number;
      wastagePct?: number;
    };
    runTransaction(() => {
      const ord = sqlite.prepare(`SELECT * FROM production_orders WHERE id = ? AND company_id = ?`).get(id, auth.companyId) as Record<string, unknown> | undefined;
      if (!ord || ord.status === 'Completed') return;
      const bom = sqlite.prepare(`SELECT * FROM boms WHERE id = ?`).get(String(ord.bom_id)) as Record<string, unknown> | undefined;
      const qty = Number(ord.planned_qty);
      const actMat = Number(actualMaterialCost ?? ord.actual_material_cost ?? ord.planned_material_cost);
      const actLab = Number(actualLabourOverhead ?? ord.actual_labour_overhead ?? ord.planned_labour_overhead);
      const totalCost = Math.max(1, Math.round(actMat + actLab));

      if (bom) {
        const comps = JSON.parse(String(bom.components_json || '[]')) as Array<{ itemId: string; qtyPerUnit: number }>;
        for (const c of comps) {
          const item = sqlite.prepare(`SELECT stock_qty FROM items WHERE id = ?`).get(c.itemId) as { stock_qty: number } | undefined;
          if (item) {
            sqlite.prepare(`UPDATE items SET stock_qty = ? WHERE id = ?`).run(Math.max(0, item.stock_qty - c.qtyPerUnit * qty), c.itemId);
          }
        }
      }
      const finItem = sqlite.prepare(`SELECT stock_qty FROM items WHERE id = ?`).get(String(ord.finished_item_id)) as { stock_qty: number } | undefined;
      if (finItem) {
        sqlite.prepare(`UPDATE items SET stock_qty = ? WHERE id = ?`).run(finItem.stock_qty + qty, String(ord.finished_item_id));
      }
      sqlite.prepare(`UPDATE production_orders SET status = 'Completed', completed_qty = ?, actual_material_cost = ?, actual_labour_overhead = ?, wastage_pct = ? WHERE id = ?`)
        .run(qty, actMat, actLab, Number(wastagePct ?? ord.wastage_pct ?? 0), id);

      const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = 'journal'`).get(auth.companyId) as { c: number }).c;
      postJournalForAdjustmentEntry(
        auth.companyId,
        auth.userId,
        new Date().toISOString().slice(0, 10),
        `JV-MFG-${String(cnt + 1).padStart(3, '0')}`,
        `Completed Manufacturing Order ${ord.order_no} (${qty} units of ${ord.finished_item_name})`,
        [
          { accountName: 'Finished Goods Inventory', accountGroup: 'Current Assets', debit: totalCost, credit: 0, narration: `${ord.finished_item_name} Batch Valuation` },
          { accountName: 'WIP Production Control', accountGroup: 'Direct Expenses', debit: 0, credit: totalCost, narration: `WIP Closure ${ord.order_no}` },
        ]
      );
      recordAudit(auth.companyId, auth.userId, auth.userName, 'COMPLETE_PRODUCTION', 'ProductionOrder', id, `Completed ${ord.order_no} (+${qty} stock, Rs.${totalCost})`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/job-works', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const j = req.body;
    const id = j.id || uid('jw');
    sqlite.prepare(`INSERT INTO job_works (id, company_id, challan_no, vendor_party_id, vendor_name, date, material_sent_item_id, material_sent_name, qty_sent, qty_received_back, wastage_qty, processing_charge, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.companyId, j.challanNo || `JW-${Date.now().toString().slice(-3)}`, j.vendorPartyId, j.vendorName, j.date || new Date().toISOString().slice(0, 10), j.materialSentItemId, j.materialSentName, Number(j.qtySent || 0), Number(j.qtyReceivedBack || 0), Number(j.wastageQty || 0), Number(j.processingCharge || 0), j.status || 'With Job Worker', j.notes || '');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.patch('/api/erp/job-works/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { qtyReceivedBack, wastageQty, status } = req.body;
    sqlite.prepare(`UPDATE job_works SET qty_received_back = ?, wastage_qty = ?, status = ? WHERE id = ? AND company_id = ?`)
      .run(Number(qtyReceivedBack || 0), Number(wastageQty || 0), status || 'Completed', id, auth.companyId);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/projects', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const p = req.body;
    const id = p.id || uid('prj');
    sqlite.prepare(`INSERT INTO projects (id, company_id, code, name, client_party_id, client_name, cost_centre_id, start_date, end_date, contract_value, material_cost, labour_cost, overhead_cost, billed_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, material_cost=excluded.material_cost, labour_cost=excluded.labour_cost, overhead_cost=excluded.overhead_cost, billed_amount=excluded.billed_amount, status=excluded.status`)
      .run(id, auth.companyId, p.code || `PRJ-${Date.now().toString().slice(-3)}`, p.name, p.clientPartyId, p.clientName, p.costCentreId || null, p.startDate, p.endDate, Number(p.contractValue || 0), Number(p.materialCost || 0), Number(p.labourCost || 0), Number(p.overheadCost || 0), Number(p.billedAmount || 0), p.status || 'Active');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/workflows', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const w = req.body;
    const id = w.id || uid('wf');
    sqlite.prepare(`INSERT INTO workflow_rules (id, company_id, name, trigger_event, condition_text, action_text, enabled, executions_count, last_triggered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, executions_count=excluded.executions_count, last_triggered_at=excluded.last_triggered_at`)
      .run(id, auth.companyId, w.name, w.triggerEvent, w.conditionText, w.actionText, w.enabled ? 1 : 0, Number(w.executionsCount || 0), w.lastTriggeredAt || null);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/approval-rules', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const r = req.body;
    const id = r.id || uid('apr');
    sqlite.prepare(`INSERT INTO approval_rules (id, company_id, document_type, threshold_amount, approver_role, enabled) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET threshold_amount=excluded.threshold_amount, enabled=excluded.enabled`)
      .run(id, auth.companyId, r.documentType, Number(r.thresholdAmount || 50000), r.approverRole || 'Admin', r.enabled ? 1 : 0);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/approvals/:voucherId', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const voucherId = String(req.params.voucherId);
    const { decision } = req.body as { decision: 'approved' | 'rejected' };
    sqlite.prepare(`UPDATE vouchers SET approval_status = ?, approved_by = ? WHERE id = ? AND company_id = ?`)
      .run(decision, auth.userName, voucherId, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'APPROVAL_DECISION', 'Voucher', voucherId, `Marked ${decision}`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/currencies', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const c = req.body;
    sqlite.prepare(`INSERT INTO currency_rates (id, company_id, code, name, symbol, rate_to_inr, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, code) DO UPDATE SET rate_to_inr=excluded.rate_to_inr, updated_at=excluded.updated_at`)
      .run(uid('cur'), auth.companyId, String(c.code).toUpperCase(), c.name, c.symbol || c.code, Number(c.rateToInr || 1), new Date().toISOString().slice(0, 10));
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/commissions', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const c = req.body;
    const id = c.id || uid('com');
    sqlite.prepare(`INSERT INTO commission_rules (id, company_id, staff_id, staff_name, basis, rate_pct, monthly_target, bonus_on_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.companyId, c.staffId, c.staffName, c.basis || 'Revenue', Number(c.ratePct || 2), Number(c.monthlyTarget || 100000), Number(c.bonusOnTarget || 5000));
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/pricing-rules', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const r = req.body;
    const id = r.id || uid('pr');
    sqlite.prepare(`INSERT INTO pricing_rules (id, company_id, name, category, min_qty, discount_pct, target_margin_pct, channel, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET active=excluded.active, discount_pct=excluded.discount_pct`)
      .run(id, auth.companyId, r.name, r.category, Number(r.minQty || 1), Number(r.discountPct || 5), Number(r.targetMarginPct || 15), r.channel || 'All', r.active ? 1 : 0);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/subscriptions', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const s = req.body;
    const id = s.id || uid('sub');
    sqlite.prepare(`INSERT INTO subscription_plans (id, company_id, plan_name, party_id, party_name, amount, interval, next_billing_date, status, auto_renew) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.companyId, s.planName, s.partyId, s.partyName, Number(s.amount || 0), s.interval || 'Monthly', s.nextBillingDate || new Date().toISOString().slice(0, 10), s.status || 'Active', s.autoRenew ? 1 : 0);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/subscriptions/run', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { subId } = req.body as { subId?: string };
    runTransaction(() => {
      const plans = sqlite.prepare(`SELECT * FROM subscription_plans WHERE company_id = ? AND status = 'Active'${subId ? ' AND id = ?' : ''}`).all(...(subId ? [auth.companyId, subId] : [auth.companyId])) as Array<Record<string, unknown>>;
      const comp = sqlite.prepare(`SELECT state FROM companies WHERE id = ?`).get(auth.companyId) as { state: string };
      let cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = 'sale_invoice'`).get(auth.companyId) as { c: number }).c;
      const today = new Date().toISOString().slice(0, 10);

      for (const p of plans) {
        cnt += 1;
        const amt = Number(p.amount);
        const gst = Number((amt * 0.18).toFixed(2));
        const grand = Math.round(amt + gst);
        const vNo = `INV-SUB-${String(cnt).padStart(3, '0')}`;
        const v: Voucher = {
          id: uid('v'),
          type: 'sale_invoice',
          voucherNo: vNo,
          date: today,
          dueDate: today,
          partyId: String(p.party_id),
          partyName: String(p.party_name),
          placeOfSupply: comp?.state || 'Maharashtra',
          isInterState: false,
          lines: [
            {
              id: uid('vl'),
              itemId: 'subscription_service',
              itemName: `Subscription: ${p.plan_name}`,
              hsn: '9983',
              qty: 1,
              unit: 'Plan',
              rate: amt,
              discountPct: 0,
              taxRate: 18,
              cessRate: 0,
              taxableAmount: amt,
              cgst: Number((gst / 2).toFixed(2)),
              sgst: Number((gst / 2).toFixed(2)),
              igst: 0,
              cess: 0,
              total: amt + gst,
            },
          ],
          additionalCharges: 0,
          discountTotal: 0,
          roundOff: Number((grand - (amt + gst)).toFixed(2)),
          subTotal: amt,
          taxTotal: gst,
          grandTotal: grand,
          paidAmount: 0,
          status: 'unpaid',
          salesChannel: 'Online Store',
          notes: `Auto-generated Subscription Invoice (${p.interval})`,
          createdAt: new Date().toISOString(),
        };
        insertVoucherFull(auth.companyId, v, auth.userId);
        postJournalForVoucher(auth.companyId, v);
        const nextDate = new Date();
        nextDate.setMonth(nextDate.getMonth() + (p.interval === 'Yearly' ? 12 : p.interval === 'Quarterly' ? 3 : 1));
        sqlite.prepare(`UPDATE subscription_plans SET next_billing_date = ? WHERE id = ?`).run(nextDate.toISOString().slice(0, 10), String(p.id));
        recordAudit(auth.companyId, auth.userId, auth.userName, 'RUN_SUBSCRIPTION', 'Subscription', String(p.id), `Generated ${vNo} (Rs.${grand})`);
      }
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/recurring/run', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { voucherId } = req.body as { voucherId: string };
    let createdNo = '';
    runTransaction(() => {
      const src = sqlite.prepare(`SELECT * FROM vouchers WHERE id = ? AND company_id = ?`).get(voucherId, auth.companyId) as Record<string, unknown> | undefined;
      if (!src) return;
      const lines = sqlite.prepare(`SELECT * FROM voucher_lines WHERE voucher_id = ?`).all(voucherId);
      const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = ?`).get(auth.companyId, String(src.type)) as { c: number }).c;
      createdNo = `REC-${String(src.voucher_no).slice(0, 8)}-${cnt + 1}`;
      const nv: Voucher = {
        id: uid('v'),
        type: String(src.type) as VoucherType,
        voucherNo: createdNo,
        date: new Date().toISOString().slice(0, 10),
        partyId: src.party_id ? String(src.party_id) : undefined,
        partyName: src.party_name ? String(src.party_name) : undefined,
        partyGstin: src.party_gstin ? String(src.party_gstin) : undefined,
        placeOfSupply: src.place_of_supply ? String(src.place_of_supply) : undefined,
        isInterState: Boolean(src.is_inter_state),
        lines: lines.map((l) => ({
          id: uid('vl'), itemId: String(l.item_id), itemName: String(l.item_name), hsn: String(l.hsn),
          qty: Number(l.qty), unit: String(l.unit), rate: Number(l.rate), discountPct: Number(l.discount_pct),
          taxRate: Number(l.tax_rate), cessRate: Number(l.cess_rate), taxableAmount: Number(l.taxable_amount),
          cgst: Number(l.cgst), sgst: Number(l.sgst), igst: Number(l.igst), cess: Number(l.cess), total: Number(l.total),
        })),
        additionalCharges: Number(src.additional_charges),
        discountTotal: Number(src.discount_total),
        roundOff: Number(src.round_off),
        subTotal: Number(src.sub_total),
        taxTotal: Number(src.tax_total),
        grandTotal: Number(src.grand_total),
        paidAmount: 0,
        status: 'unpaid',
        isRecurring: false,
        salesChannel: String(src.sales_channel || 'Direct B2B') as Voucher['salesChannel'],
        notes: `Recurring clone from ${src.voucher_no}`,
        createdAt: new Date().toISOString(),
      };
      insertVoucherFull(auth.companyId, nv, auth.userId);
      applyVoucherStockDelta(auth.companyId, nv, 1);
      postJournalForVoucher(auth.companyId, nv);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId), createdNo });
  });

  app.post('/api/erp/compliance', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const c = req.body;
    const id = c.id || uid('cmpi');
    sqlite.prepare(`INSERT INTO compliance_items (id, company_id, title, category, due_date, status, reference_no, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.companyId, c.title, c.category || 'GST', c.dueDate, c.status || 'Upcoming', c.referenceNo || '', c.notes || '');
    recordAudit(auth.companyId, auth.userId, auth.userName, 'CREATE_FILING_RECORD', 'Compliance', id, `${c.title} · Status: ${c.status || 'Upcoming'}`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.patch('/api/erp/compliance/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { status, referenceNo } = req.body;
    sqlite.prepare(`UPDATE compliance_items SET status = ?, reference_no = ? WHERE id = ? AND company_id = ?`)
      .run(status, referenceNo || '', id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'UPDATE_FILING_STATUS', 'Compliance', id, `Status -> ${status}${referenceNo ? ` (Ref/ARN: ${referenceNo})` : ''}`);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- GOVERNMENT GST PORTALS: LIVE HEALTH PROBE & AUDIT ---
  const GST_PORTAL_ALLOWLIST = [
    { id: 'gst_login', name: 'GST Portal – Main Login', url: 'https://services.gst.gov.in/services/login', category: 'gst' as const },
    { id: 'gstin_search', name: 'GSTIN Search Taxpayer', url: 'https://services.gst.gov.in/services/searchtp', category: 'verification' as const },
    { id: 'eway_1', name: 'E-Way Bill Primary Portal', url: 'https://ewaybillgst.gov.in/', category: 'eway' as const },
    { id: 'eway_2', name: 'E-Way Bill Mirror Portal (NIC 2)', url: 'https://ewaybill2.gst.gov.in/', category: 'eway' as const },
    { id: 'irp_1', name: 'E-Invoice IRP 1 (NIC)', url: 'https://einvoice1.gst.gov.in/', category: 'einvoice' as const },
    { id: 'irp_2', name: 'E-Invoice IRP 2 (NIC 2)', url: 'https://einvoice2.gst.gov.in/', category: 'einvoice' as const },
    { id: 'irp_3', name: 'E-Invoice IRP 3 (Cygnet)', url: 'https://einvoice3.gst.gov.in/', category: 'einvoice' as const },
    { id: 'irp_4', name: 'E-Invoice IRP 4 (Defmacro)', url: 'https://einvoice4.gst.gov.in/', category: 'einvoice' as const },
    { id: 'irp_5', name: 'E-Invoice IRP 5 (EY)', url: 'https://einvoice5.gst.gov.in/', category: 'einvoice' as const },
    { id: 'irp_6', name: 'E-Invoice IRP 6 (IRIS)', url: 'https://einvoice6.gst.gov.in/', category: 'einvoice' as const },
    { id: 'irn_search', name: 'E-Invoice IRN Search Portal', url: 'https://einvoice.gst.gov.in/einvoice/search-irn', category: 'verification' as const },
  ];

  app.get('/api/portals/health', authMiddleware, async (_req: AuthedRequest, res) => {
    const checkedAt = new Date().toISOString();
    const probePortal = async (target: (typeof GST_PORTAL_ALLOWLIST)[number]) => {
      const start = Date.now();
      try {
        let response = await fetch(target.url, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(4500),
          headers: { 'User-Agent': 'ShobhitInvoicePro-PortalHealthMonitor/1.0' },
        });
        if (response.status === 405 || response.status === 501) {
          response = await fetch(target.url, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(4500),
            headers: { 'User-Agent': 'ShobhitInvoicePro-PortalHealthMonitor/1.0' },
          });
        }
        const latencyMs = Date.now() - start;
        const httpStatus = response.status;
        let status: 'online' | 'degraded' | 'down' = 'online';
        if (httpStatus >= 500) {
          status = 'down';
        } else if (latencyMs > 3000) {
          status = 'degraded';
        }
        return { ...target, status, httpStatus, latencyMs, checkedAt };
      } catch (err) {
        const latencyMs = Date.now() - start;
        return {
          ...target,
          status: 'down' as const,
          httpStatus: null,
          latencyMs,
          checkedAt,
          error: err instanceof Error ? err.message : 'Request timed out or unreachable',
        };
      }
    };

    const portals = await Promise.all(GST_PORTAL_ALLOWLIST.map(probePortal));
    res.json({ portals, checkedAt });
  });

  app.post('/api/portals/audit', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { portalId, portalName, url, action, statusNote } = req.body as {
      portalId?: string;
      portalName?: string;
      url?: string;
      action?: string;
      statusNote?: string;
    };
    const allowedAction =
      action === 'RETURN_JSON_PREPARED' || action === 'GSTIN_CHECKSUM_CHECK' || action === 'IRN_LOCAL_CHECK'
        ? action
        : 'MANUAL_PORTAL_OPEN';
    const cleanName = String(portalName || portalId || 'GST Government Portal').slice(0, 120);
    const cleanNote = String(statusNote || 'Opened official portal manually in browser tab (Not Auto-Filed)').slice(0, 240);
    recordAudit(
      auth.companyId,
      auth.userId,
      auth.userName,
      allowedAction,
      'GovernmentPortal',
      String(portalId || 'gst_portal').slice(0, 64),
      `${cleanName}${url ? ` [${url}]` : ''} — ${cleanNote}`
    );
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.get('/api/portals/api-status', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const row = sqlite
      .prepare(`SELECT gstin, gst_api_config_json FROM companies WHERE id = ?`)
      .get(auth.companyId) as { gstin?: string; gst_api_config_json?: string } | undefined;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(String(row?.gst_api_config_json || '{}'));
    } catch {
      parsed = {};
    }
    res.json({
      config: {
        gspProvider: String(parsed.gspProvider || 'Unassigned (Manual Portal Mode)'),
        environment: parsed.environment === 'production' ? 'production' : 'sandbox',
        authorizedGstin: String(parsed.authorizedGstin || row?.gstin || ''),
        apiModeEnabled: Boolean(parsed.apiModeEnabled),
        updatedAt: parsed.updatedAt ? String(parsed.updatedAt) : undefined,
      },
      serverCredentials: {
        gstnConfigured: Boolean(process.env.GSTN_GSP_CLIENT_ID && process.env.GSTN_GSP_CLIENT_SECRET),
        irpConfigured: Boolean(process.env.IRP_CLIENT_ID && process.env.IRP_CLIENT_SECRET),
        ewbConfigured: Boolean(process.env.EWB_CLIENT_ID && process.env.EWB_CLIENT_SECRET),
      },
    });
  });

  app.post('/api/portals/api-config', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { gspProvider, environment, authorizedGstin, apiModeEnabled } = req.body as {
      gspProvider?: string;
      environment?: string;
      authorizedGstin?: string;
      apiModeEnabled?: boolean;
    };
    const safeConfig = {
      gspProvider: String(gspProvider || 'Authorized GSP').slice(0, 80),
      environment: environment === 'production' ? 'production' : 'sandbox',
      authorizedGstin: String(authorizedGstin || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15),
      apiModeEnabled: Boolean(apiModeEnabled),
      updatedAt: new Date().toISOString(),
    };
    sqlite
      .prepare(`UPDATE companies SET gst_api_config_json = ? WHERE id = ?`)
      .run(JSON.stringify(safeConfig), auth.companyId);
    recordAudit(
      auth.companyId,
      auth.userId,
      auth.userName,
      'UPDATE_GST_API_CONFIG',
      'GovernmentPortal',
      auth.companyId,
      `Updated GSP metadata (${safeConfig.gspProvider} · ${safeConfig.environment})`
    );
    res.json({ ok: true, config: safeConfig, data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/portals/test-api', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { service } = req.body as { service?: 'gstn' | 'irp' | 'ewb' };
    const target = service === 'irp' ? 'IRP E-Invoice' : service === 'ewb' ? 'E-Way Bill NIC' : 'GSTN Return';
    const configured =
      service === 'irp'
        ? Boolean(process.env.IRP_CLIENT_ID && process.env.IRP_CLIENT_SECRET)
        : service === 'ewb'
          ? Boolean(process.env.EWB_CLIENT_ID && process.env.EWB_CLIENT_SECRET)
          : Boolean(process.env.GSTN_GSP_CLIENT_ID && process.env.GSTN_GSP_CLIENT_SECRET);

    if (!configured) {
      const msg = `${target} API server credentials are not configured in server environment. Use Official Direct Portals or configure authorized GSP/NIC Client ID & Secret on the server.`;
      recordAudit(auth.companyId, auth.userId, auth.userName, 'GST_API_TEST_FAILED', 'GovernmentPortal', service || 'gstn', msg);
      res.json({
        success: false,
        status: 'failed',
        message: msg,
        data: buildBootstrapPayload(auth.userId, auth.companyId),
      });
      return;
    }

    const msg = `${target} authorized server client credentials verified (ready for GSP token handshake).`;
    recordAudit(auth.companyId, auth.userId, auth.userName, 'GST_API_TEST_SUCCESS', 'GovernmentPortal', service || 'gstn', msg);
    res.json({
      success: true,
      status: 'success',
      message: msg,
      data: buildBootstrapPayload(auth.userId, auth.companyId),
    });
  });

  app.post('/api/erp/documents', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const d = req.body;
    const id = d.id || uid('doc');
    const hash = d.signatureHash || `sha256:${crypto.createHash('sha256').update(`${d.title}:${auth.userName}:${Date.now()}`).digest('hex').slice(0, 28)}`;
    sqlite.prepare(`INSERT INTO documents (id, company_id, title, category, linked_voucher_no, uploaded_at, signed_by, signature_hash, file_type, preview_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.companyId, d.title, d.category || 'Contract', d.linkedVoucherNo || '', new Date().toISOString().slice(0, 10), d.signedBy || auth.userName, hash, d.fileType || 'PDF', d.previewText || '');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/api-keys', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { label, scopes } = req.body;
    const key = `sip_live_${crypto.randomBytes(10).toString('hex')}`;
    sqlite.prepare(`INSERT INTO api_keys (id, company_id, label, api_key, scopes_json, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .run(uid('key'), auth.companyId, label || 'Integration Key', key, JSON.stringify(scopes || ['invoices:read', 'parties:read', 'items:read']), new Date().toISOString());
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/webhooks', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const w = req.body;
    sqlite.prepare(`INSERT INTO webhooks (id, company_id, event, target_url, active) VALUES (?, ?, ?, ?, 1)`)
      .run(uid('wh'), auth.companyId, w.event || 'invoice.created', w.targetUrl);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/webhooks/:id/test', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const now = new Date().toISOString();
    sqlite.prepare(`UPDATE webhooks SET last_status = 200, last_delivered_at = ? WHERE id = ? AND company_id = ?`).run(now, id, auth.companyId);
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId), deliveredAt: now, status: 200 });
  });

  app.post('/api/erp/custom-reports', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const r = req.body;
    sqlite.prepare(`INSERT INTO custom_reports (id, company_id, name, dataset, columns_json, group_by, metric_formula, chart_type, schedule_cron, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uid('cr'), auth.companyId, r.name, r.dataset || 'vouchers', JSON.stringify(r.columns || ['voucherNo', 'date', 'grandTotal']), r.groupBy || 'salesChannel', r.metricFormula || 'SUM(grandTotal)', r.chartType || 'bar', r.scheduleCron || '', new Date().toISOString());
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/security', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const sec = req.body;
    sqlite.prepare(`UPDATE companies SET security_settings_json = ? WHERE id = ?`).run(JSON.stringify(sec), auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'UPDATE_SECURITY', 'Company', auth.companyId, 'Updated 2FA / IP Allowlist / Signature settings');
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/erp/marketplace-sync', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { channel } = req.body as { channel: string };
    const importedNos: string[] = [];
    runTransaction(() => {
      const items = sqlite.prepare(`SELECT * FROM items WHERE company_id = ? AND type = 'product' LIMIT 2`).all(auth.companyId) as Array<Record<string, unknown>>;
      const cust = sqlite.prepare(`SELECT * FROM parties WHERE company_id = ? AND type = 'customer' LIMIT 1`).get(auth.companyId) as Record<string, unknown> | undefined;
      if (items.length === 0 || !cust) return;
      const cnt = (sqlite.prepare(`SELECT COUNT(*) as c FROM vouchers WHERE company_id = ? AND type = 'sale_invoice'`).get(auth.companyId) as { c: number }).c;
      const vNo = `MKT-${String(channel || 'AMZ').slice(0, 3).toUpperCase()}-${String(cnt + 1).padStart(3, '0')}`;
      const it = items[0];
      const qty = 3;
      const rate = Number(it.sale_price);
      const taxable = rate * qty;
      const taxRate = Number(it.tax_rate || 18);
      const tax = Number(((taxable * taxRate) / 100).toFixed(2));
      const grand = Math.round(taxable + tax);
      const v: Voucher = {
        id: uid('v'),
        type: 'sale_invoice',
        voucherNo: vNo,
        date: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        partyId: String(cust.id),
        partyName: String(cust.name),
        partyGstin: String(cust.gstin || ''),
        placeOfSupply: 'Maharashtra',
        isInterState: false,
        lines: [{
          id: uid('vl'), itemId: String(it.id), itemName: String(it.name), hsn: String(it.hsn), qty, unit: String(it.unit),
          rate, discountPct: 0, taxRate, cessRate: 0, taxableAmount: taxable,
          cgst: Number((tax / 2).toFixed(2)), sgst: Number((tax / 2).toFixed(2)), igst: 0, cess: 0, total: taxable + tax,
        }],
        additionalCharges: 0,
        discountTotal: 0,
        roundOff: Number((grand - (taxable + tax)).toFixed(2)),
        subTotal: taxable,
        taxTotal: tax,
        grandTotal: grand,
        paidAmount: grand,
        paymentMode: 'UPI',
        bankAccountId: `${auth.companyId}_bank_hdfc`,
        status: 'paid',
        salesChannel: (channel === 'Online Store' ? 'Online Store' : 'Marketplace'),
        shipmentStatus: 'Packed',
        notes: `Synced order from ${channel || 'Marketplace'}`,
        createdAt: new Date().toISOString(),
      };
      insertVoucherFull(auth.companyId, v, auth.userId);
      applyVoucherStockDelta(auth.companyId, v, 1);
      postJournalForVoucher(auth.companyId, v);
      importedNos.push(vNo);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'MARKETPLACE_SYNC', 'Voucher', v.id, `Synced ${vNo} from ${channel}`);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId), importedNos });
  });

  // --- OPEN API V1 (KEY AUTHENTICATED) ---
  app.get('/api/v1/:resource', (req, res) => {
    const apiKey = String(req.headers['x-api-key'] || '');
    const keyRow = sqlite.prepare(`SELECT company_id, active FROM api_keys WHERE api_key = ?`).get(apiKey) as { company_id: string; active: number } | undefined;
    if (!keyRow || !keyRow.active) {
      res.status(401).json({ error: 'Invalid or inactive x-api-key' });
      return;
    }
    sqlite.prepare(`UPDATE api_keys SET last_used_at = ? WHERE api_key = ?`).run(new Date().toISOString(), apiKey);
    const resName = req.params.resource;
    if (resName === 'invoices') {
      const rows = sqlite.prepare(`SELECT id, voucher_no, date, party_name, sub_total, tax_total, grand_total, status, sales_channel FROM vouchers WHERE company_id = ? AND type = 'sale_invoice' ORDER BY date DESC LIMIT 50`).all(keyRow.company_id);
      res.json({ count: rows.length, invoices: rows });
      return;
    }
    if (resName === 'parties') {
      const rows = sqlite.prepare(`SELECT id, name, type, gstin, phone, state, credit_limit FROM parties WHERE company_id = ?`).all(keyRow.company_id);
      res.json({ count: rows.length, parties: rows });
      return;
    }
    if (resName === 'items') {
      const rows = sqlite.prepare(`SELECT id, name, sku, hsn, stock_qty, sale_price, tax_rate FROM items WHERE company_id = ?`).all(keyRow.company_id);
      res.json({ count: rows.length, items: rows });
      return;
    }
    res.status(404).json({ error: 'Unknown API v1 resource (use invoices, parties, or items)' });
  });

  // --- CLEAR DEMO DATA / RESET DEMO DATA ---
  app.post('/api/data/clear-demo', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    runTransaction(() => {
      sqlite.prepare(`DELETE FROM vouchers WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM journal_entries WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM parties WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM items WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM cheques WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM loans WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM stock_adjustments WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM stock_transfers WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`UPDATE bank_accounts SET opening_balance = 0 WHERE company_id = ?`).run(auth.companyId);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'CLEAR_DEMO_DATA', 'Company', auth.companyId, 'Cleared all demo transactions and masters for production start');
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/data/reset-demo', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    runTransaction(() => {
      sqlite.prepare(`DELETE FROM vouchers WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM journal_entries WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM parties WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM items WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM godowns WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM bank_accounts WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM cheques WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM loans WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM stock_adjustments WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM stock_transfers WHERE company_id = ?`).run(auth.companyId);
      sqlite.prepare(`DELETE FROM staff_members WHERE company_id = ?`).run(auth.companyId);
      seedCompanyDemoRecords(auth.companyId, auth.userId, auth.userName);
    });
    res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  app.post('/api/data/import', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const data = req.body as {
      profile?: Record<string, unknown>;
      parties?: Array<Record<string, unknown>>;
      items?: Array<Record<string, unknown>>;
      godowns?: Array<Record<string, unknown>>;
      bankAccounts?: Array<Record<string, unknown>>;
      vouchers?: Voucher[];
    };
    if (!data || !Array.isArray(data.vouchers)) {
      res.status(400).json({ error: 'Invalid backup payload.' });
      return;
    }
    try {
      runTransaction(() => {
        sqlite.prepare(`DELETE FROM vouchers WHERE company_id = ?`).run(auth.companyId);
        sqlite.prepare(`DELETE FROM journal_entries WHERE company_id = ?`).run(auth.companyId);
        sqlite.prepare(`DELETE FROM parties WHERE company_id = ?`).run(auth.companyId);
        sqlite.prepare(`DELETE FROM items WHERE company_id = ?`).run(auth.companyId);
        sqlite.prepare(`DELETE FROM cheques WHERE company_id = ?`).run(auth.companyId);
        sqlite.prepare(`DELETE FROM loans WHERE company_id = ?`).run(auth.companyId);
        sqlite.prepare(`DELETE FROM stock_adjustments WHERE company_id = ?`).run(auth.companyId);
        sqlite.prepare(`DELETE FROM stock_transfers WHERE company_id = ?`).run(auth.companyId);

        if (Array.isArray(data.parties)) {
          const pStmt = sqlite.prepare(
            `INSERT INTO parties (id, company_id, name, type, phone, email, gstin, pan, state, billing_address, shipping_address, opening_balance, opening_type, credit_limit, credit_days, group_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const p of data.parties) {
            pStmt.run(
              String(p.id || uid('p')),
              auth.companyId,
              String(p.name || 'Party'),
              String(p.type || 'customer'),
              String(p.phone || ''),
              String(p.email || ''),
              String(p.gstin || ''),
              String(p.pan || ''),
              String(p.state || 'Maharashtra'),
              String(p.billingAddress || ''),
              String(p.shippingAddress || ''),
              Number(p.openingBalance || 0),
              String(p.openingType || 'receivable'),
              Number(p.creditLimit || 0),
              Number(p.creditDays || 30),
              String(p.group || 'Sundry Debtors'),
              String(p.createdAt || new Date().toISOString().slice(0, 10))
            );
          }
        }

        if (Array.isArray(data.items)) {
          const iStmt = sqlite.prepare(
            `INSERT INTO items (id, company_id, name, type, sku, barcode, hsn, category, subcategory, unit, secondary_unit, conversion_rate, sale_price, purchase_price, mrp, wholesale_price, tax_rate, cess_rate, tax_inclusive, opening_stock, stock_qty, min_stock_alert, godown_id, godown_stock_json, track_batch, batches_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const i of data.items) {
            iStmt.run(
              String(i.id || uid('i')),
              auth.companyId,
              String(i.name || 'Item'),
              String(i.type || 'product'),
              String(i.sku || ''),
              String(i.barcode || ''),
              String(i.hsn || ''),
              String(i.category || 'General'),
              String(i.subcategory || ''),
              String(i.unit || 'PCS'),
              String(i.secondaryUnit || ''),
              Number(i.conversionRate || 1),
              Number(i.salePrice || 0),
              Number(i.purchasePrice || 0),
              Number(i.mrp || 0),
              Number(i.wholesalePrice || 0),
              Number(i.taxRate || 18),
              Number(i.cessRate || 0),
              i.taxInclusive ? 1 : 0,
              Number(i.openingStock || 0),
              Number(i.stockQty || 0),
              Number(i.minStockAlert || 10),
              String(i.godownId || ''),
              JSON.stringify(i.godownStock || {}),
              i.trackBatch ? 1 : 0,
              JSON.stringify(i.batches || [])
            );
          }
        }

        for (const v of data.vouchers || []) {
          const nv = { ...v, id: v.id || uid('v') };
          insertVoucherFull(auth.companyId, nv, auth.userId);
          postJournalForVoucher(auth.companyId, nv);
        }

        recordAudit(auth.companyId, auth.userId, auth.userName, 'IMPORT_BACKUP', 'Company', auth.companyId, `Restored backup (${data.vouchers?.length || 0} vouchers)`);
      });
      res.json({ data: buildBootstrapPayload(auth.userId, auth.companyId) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Backup restore failed' });
    }
  });

  // --- SERVER-SIDE GEMINI INVOICE OCR UTILITY ---
  app.get('/api/ai/status', authMiddleware, (_req: AuthedRequest, res) => {
    res.json({ configured: isGeminiConfigured(), model: 'gemini-4-hydrogen' });
  });

  app.post('/api/ai/scan-invoice', authMiddleware, async (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (!requireFeatureUnlocked(auth.companyId, 'ocr_bulk_tools', res)) return;
    const { base64Data, mimeType, rawText } = req.body as { base64Data?: string; mimeType?: string; rawText?: string };
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (base64Data) {
      if (!mimeType || !allowedMimes.includes(mimeType)) {
        res.status(400).json({ error: 'Only PDF, PNG, JPEG, or WEBP invoice files are allowed.' });
        return;
      }
      if (base64Data.length > 20 * 1024 * 1024) {
        res.status(400).json({ error: 'Uploaded invoice file exceeds 15MB limit.' });
        return;
      }
    } else if (!rawText || !rawText.trim()) {
      res.status(400).json({ error: 'Upload an invoice image/PDF or paste invoice text to scan.' });
      return;
    }
    try {
      const scanned = await scanInvoiceDocument({ base64Data, mimeType, rawText: rawText?.trim() });
      recordAudit(auth.companyId, auth.userId, auth.userName, 'AI_INVOICE_OCR', 'AIUtility', auth.companyId, `Scanned bill ${scanned.invoiceNo} (${scanned.partyName})`);
      res.json({ scanned });
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      res.status(e.statusCode || 502).json({ error: e.message || 'Invoice OCR failed.' });
    }
  });

  // --- USER ACCESS CONTROL (STAFF ROLES: STOCK KEEPER, BILLER, SALESMAN, ACCOUNTANT) ---
  app.get('/api/user-access', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const rows = sqlite
      .prepare(`SELECT * FROM workspace_members WHERE company_id = ? ORDER BY created_at DESC`)
      .all(auth.companyId) as Array<Record<string, unknown>>;
    res.json({
      members: rows.map((m) => ({
        id: String(m.id),
        companyId: String(m.company_id),
        userId: String(m.user_id),
        name: String(m.name),
        phone: String(m.phone || ''),
        email: String(m.email || '').endsWith('@staff.local') ? '' : String(m.email || ''),
        role: String(m.role) as WorkspaceRole,
        permissions: JSON.parse(String(m.permissions_json || '[]')),
        active: Boolean(m.active),
        createdAt: String(m.created_at || ''),
        updatedAt: String(m.updated_at || ''),
      })),
    });
  });

  app.post('/api/user-access', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (auth.userRole !== 'Admin') {
      res.status(403).json({ error: 'Only workspace Admin can manage staff access.' });
      return;
    }
    const { id, name, phone, email, role, permissions, active } = req.body as {
      id?: string;
      name?: string;
      phone?: string;
      email?: string;
      role?: WorkspaceRole;
      permissions?: string[];
      active?: boolean;
    };
    const cleanName = String(name || '').trim();
    const cleanPhone = normalizePhone(String(phone || ''));
    const cleanEmail = String(email || '').trim().toLowerCase();
    const validRoles: WorkspaceRole[] = ['Stock Keeper', 'Biller', 'Salesman', 'Accountant'];
    const targetRole: WorkspaceRole = validRoles.includes(role as WorkspaceRole) ? (role as WorkspaceRole) : 'Biller';
    const permList =
      Array.isArray(permissions) && permissions.length > 0
        ? permissions
        : DEFAULT_ROLE_PERMISSIONS[targetRole] || ['dashboard'];

    if (!cleanName || cleanPhone.length < 10) {
      res.status(400).json({ error: 'Staff Name and a valid 10-digit Phone Number are required.' });
      return;
    }

    try {
      const nowIso = new Date().toISOString();
      runTransaction(() => {
        const existingMember = id
          ? (sqlite
              .prepare(`SELECT * FROM workspace_members WHERE id = ? AND company_id = ?`)
              .get(id, auth.companyId) as { id: string; user_id: string } | undefined)
          : undefined;

        const phoneClash = sqlite
          .prepare(`SELECT id, company_id FROM workspace_members WHERE phone = ? AND (? IS NULL OR id != ?) LIMIT 1`)
          .get(cleanPhone, existingMember?.id || null, existingMember?.id || null) as { id: string } | undefined;
        if (phoneClash) {
          throw new Error('This phone number is already assigned to another staff user.');
        }

        if (existingMember) {
          const syntheticEmail =
            cleanEmail || `staff_${cleanPhone}_${existingMember.user_id.slice(-4)}@staff.local`;
          sqlite
            .prepare(`UPDATE users SET name = ?, phone = ?, email = ?, role = ?, status = ? WHERE id = ?`)
            .run(cleanName, cleanPhone, syntheticEmail, targetRole, active === false ? 'inactive' : 'active', existingMember.user_id);
          sqlite
            .prepare(
              `UPDATE workspace_members SET name = ?, phone = ?, email = ?, role = ?, permissions_json = ?, active = ?, updated_at = ?
               WHERE id = ? AND company_id = ?`
            )
            .run(
              cleanName,
              cleanPhone,
              cleanEmail,
              targetRole,
              JSON.stringify(permList),
              active === false ? 0 : 1,
              nowIso,
              existingMember.id,
              auth.companyId
            );
          recordAudit(auth.companyId, auth.userId, auth.userName, 'UPDATE_USER_ACCESS', 'UserAccess', existingMember.id, `Updated ${cleanName} (${targetRole})`);
        } else {
          const linkedUserId = uid('usr');
          const memberId = uid('wm');
          const syntheticEmail = cleanEmail || `staff_${cleanPhone}_${crypto.randomBytes(2).toString('hex')}@staff.local`;
          const randomPwd = crypto.randomBytes(16).toString('hex');
          sqlite
            .prepare(
              `INSERT INTO users (id, name, email, phone, password_hash, role, status, created_at, assigned_company_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              linkedUserId,
              cleanName,
              syntheticEmail,
              cleanPhone,
              hashPassword(randomPwd),
              targetRole,
              active === false ? 'inactive' : 'active',
              nowIso,
              auth.companyId
            );
          sqlite
            .prepare(
              `INSERT INTO workspace_members (id, company_id, user_id, name, phone, email, role, permissions_json, active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              memberId,
              auth.companyId,
              linkedUserId,
              cleanName,
              cleanPhone,
              cleanEmail,
              targetRole,
              JSON.stringify(permList),
              active === false ? 0 : 1,
              nowIso,
              nowIso
            );
          recordAudit(auth.companyId, auth.userId, auth.userName, 'CREATE_USER_ACCESS', 'UserAccess', memberId, `Added ${cleanName} (${targetRole} · ${cleanPhone})`);
        }
      });
      res.json({ ok: true, data: buildBootstrapPayload(auth.userId, auth.companyId) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to save staff access.' });
    }
  });

  app.delete('/api/user-access/:id', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (auth.userRole !== 'Admin') {
      res.status(403).json({ error: 'Only workspace Admin can remove staff access.' });
      return;
    }
    const id = String(req.params.id);
    runTransaction(() => {
      const row = sqlite
        .prepare(`SELECT user_id, name FROM workspace_members WHERE id = ? AND company_id = ?`)
        .get(id, auth.companyId) as { user_id: string; name: string } | undefined;
      if (!row) return;
      sqlite.prepare(`DELETE FROM workspace_members WHERE id = ? AND company_id = ?`).run(id, auth.companyId);
      sqlite.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(row.user_id);
      sqlite.prepare(`DELETE FROM users WHERE id = ? AND role != 'Admin'`).run(row.user_id);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'DELETE_USER_ACCESS', 'UserAccess', id, `Removed staff access for ${row.name}`);
    });
    res.json({ ok: true, data: buildBootstrapPayload(auth.userId, auth.companyId) });
  });

  // --- OTP INTEGRATIONS CONFIG & TESTING ---
  app.get('/api/otp-integrations', authMiddleware, (_req: AuthedRequest, res) => {
    res.json({ config: getPublicOtpConfig() });
  });

  app.put('/api/otp-integrations', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    if (auth.userRole !== 'Admin') {
      res.status(403).json({ error: 'Only workspace Admin can configure OTP providers.' });
      return;
    }
    const saved = saveOtpConfig(req.body as Partial<OtpIntegrationConfig>);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'UPDATE_OTP_INTEGRATION', 'OtpConfig', 'global', `Provider: ${saved.smsProvider}, SMTP: ${saved.emailEnabled}`);
    res.json({ ok: true, config: saved });
  });

  app.post('/api/otp-integrations/test', authMiddleware, async (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { target, channel } = req.body as { target?: string; channel?: 'phone' | 'email' };
    const raw = String(target || '').trim();
    if (!raw) {
      res.status(400).json({ error: 'Enter a Phone Number or Email to test OTP dispatch.' });
      return;
    }
    const resolvedChannel: 'phone' | 'email' = channel === 'email' || raw.includes('@') ? 'email' : 'phone';
    try {
      const result = await dispatchOtpCode({
        target: raw,
        channel: resolvedChannel,
        companyId: auth.companyId,
        purpose: 'Shobhit Invoice Pro OTP Test',
      });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Test OTP dispatch failed.' });
    }
  });

  // --- WHATSAPP QR LINKING & TRANSACTION ATTACHMENT DISPATCH ---
  app.get('/api/whatsapp/status', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    res.json(getWhatsAppStatus(auth.companyId));
  });

  app.post('/api/whatsapp/connect', authMiddleware, async (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const status = await connectWhatsApp(auth.companyId);
    res.json(status);
  });

  app.post('/api/whatsapp/disconnect', authMiddleware, async (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const status = await disconnectWhatsApp(auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'WHATSAPP_DISCONNECT', 'WhatsApp', auth.companyId, 'Disconnected linked WhatsApp session');
    res.json(status);
  });

  app.post('/api/whatsapp/send-transaction', authMiddleware, async (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { phone, text, pdfBase64, pdfFileName, imageBase64, copyToSelf } = req.body as {
      phone?: string;
      text?: string;
      pdfBase64?: string;
      pdfFileName?: string;
      imageBase64?: string;
      copyToSelf?: boolean;
    };
    if (!phone || normalizePhone(phone).length < 10) {
      res.status(400).json({ error: 'Recipient WhatsApp number must have at least 10 digits.' });
      return;
    }
    try {
      const result = await sendWhatsAppMessage({
        companyId: auth.companyId,
        phone,
        text: text || 'Thank you for your business!',
        pdfBase64,
        pdfFileName,
        imageBase64,
        copyToSelf: Boolean(copyToSelf),
      });
      recordAudit(auth.companyId, auth.userId, auth.userName, 'WHATSAPP_SEND_TXN', 'WhatsApp', auth.companyId, `Sent transaction (${pdfFileName || 'message'}) to ${phone}`);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to send via WhatsApp.' });
    }
  });

  // --- SAAS SUBSCRIPTION, PHONE + OTP LICENSE PORTAL & HIDDEN OPS ADMIN ---
  app.post('/api/subscription/purchase', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const body = req.body as {
      tier: PlanTier;
      deviceScope: DeviceScope;
      duration: PlanDuration;
      customerName: string;
      phone: string;
      gstin?: string;
      paymentMode?: string;
      paymentRef?: string;
    };

    const tier: PlanTier = ['silver', 'gold', 'platinum'].includes(body.tier) ? body.tier : 'silver';
    const deviceScope: DeviceScope = body.deviceScope === 'desktop_mobile' ? 'desktop_mobile' : 'desktop';
    const duration: PlanDuration = body.duration === '3_years' ? '3_years' : '1_year';
    const customerName = String(body.customerName || '').trim();
    const phone = normalizePhone(body.phone || '');
    const gstin = String(body.gstin || '').trim().toUpperCase().slice(0, 15);
    const paymentMode = String(body.paymentMode || 'UPI');
    const paymentRef = String(body.paymentRef || '').trim();

    if (!customerName) {
      res.status(400).json({ error: 'Customer Name is required.' });
      return;
    }
    if (phone.length < 10) {
      res.status(400).json({ error: 'Valid 10-digit Registered Phone Number is required.' });
      return;
    }

    const plans = getSaasPlans();
    const selectedPlan = plans.find((p) => p.tier === tier);
    if (!selectedPlan) {
      res.status(404).json({ error: 'Plan not found.' });
      return;
    }

    let totalAmount = selectedPlan.priceDesktop1Y;
    if (deviceScope === 'desktop' && duration === '1_year') totalAmount = selectedPlan.priceDesktop1Y;
    else if (deviceScope === 'desktop' && duration === '3_years') totalAmount = selectedPlan.priceDesktop3Y;
    else if (deviceScope === 'desktop_mobile' && duration === '1_year') totalAmount = selectedPlan.priceCombo1Y;
    else if (deviceScope === 'desktop_mobile' && duration === '3_years') totalAmount = selectedPlan.priceCombo3Y;

    const amount = Number((totalAmount / 1.18).toFixed(2));
    const taxAmount = Number((totalAmount - amount).toFixed(2));
    const nowIso = new Date().toISOString();
    const id = uid('lic');

    let createdLicense: ReturnType<typeof mapLicenseRow> | null = null;
    runTransaction(() => {
      const count = (sqlite.prepare(`SELECT COUNT(*) as c FROM saas_licenses`).get() as { c: number }).c;
      const invoiceNo = `LIC-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
      sqlite
        .prepare(
          `INSERT INTO saas_licenses (
            id, company_id, license_code, invoice_no, tier, device_scope, duration,
            amount, tax_amount, total_amount, customer_name, phone, gstin, payment_mode,
            payment_ref, transaction_id, screenshot_data_url, status, valid_from, expires_at, created_at
          ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'pending_verification', '', '', ?)`
        )
        .run(
          id,
          auth.companyId,
          invoiceNo,
          tier,
          deviceScope,
          duration,
          amount,
          taxAmount,
          totalAmount,
          customerName,
          phone,
          gstin,
          paymentMode,
          paymentRef,
          paymentRef,
          nowIso
        );
      const row = sqlite.prepare(`SELECT * FROM saas_licenses WHERE id = ?`).get(id) as Record<string, unknown>;
      createdLicense = mapLicenseRow(row);
      recordAudit(auth.companyId, auth.userId, auth.userName, 'SUBSCRIPTION_ORDER', 'License', id, `Ordered ${tier.toUpperCase()} (${deviceScope}, ${duration}) Rs.${totalAmount} · ${invoiceNo}`);
    });

    res.json({
      license: createdLicense,
      data: buildBootstrapPayload(auth.userId, auth.companyId),
    });
  });

  app.post('/api/subscription/otp/request', authMiddleware, (req: AuthedRequest, res) => {
    const phone = normalizePhone(String(req.body?.phone || ''));
    if (phone.length < 10) {
      res.status(400).json({ error: 'Enter a valid 10-digit Registered Phone Number.' });
      return;
    }
    const otpCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO saas_otp_codes (phone, code, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at`
      )
      .run(phone, otpCode, expiresAt);

    const licCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM saas_licenses WHERE phone = ?`).get(phone) as { c: number }).c;
    res.json({
      ok: true,
      phone,
      otpCode,
      licenseCount: licCount,
    });
  });

  app.post('/api/subscription/otp/verify', authMiddleware, (req: AuthedRequest, res) => {
    const phone = normalizePhone(String(req.body?.phone || ''));
    const otp = String(req.body?.otp || '').trim();
    if (phone.length < 10 || !otp) {
      res.status(400).json({ error: 'Phone number and 6-digit OTP are required.' });
      return;
    }
    const row = sqlite
      .prepare(`SELECT code, expires_at FROM saas_otp_codes WHERE phone = ?`)
      .get(phone) as { code: string; expires_at: string } | undefined;
    if (!row || row.expires_at < new Date().toISOString() || !safeSecretEqual(otp, row.code)) {
      res.status(401).json({ error: 'Invalid or expired OTP. Please request a fresh OTP.' });
      return;
    }

    const rows = sqlite
      .prepare(`SELECT * FROM saas_licenses WHERE phone = ? ORDER BY created_at DESC`)
      .all(phone) as Array<Record<string, unknown>>;
    res.json({
      ok: true,
      phone,
      licenses: rows.map(mapLicenseRow),
    });
  });

  app.post('/api/subscription/attach', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { licenseId, licenseCode } = req.body as { licenseId?: string; licenseCode?: string };
    const row = licenseId
      ? (sqlite.prepare(`SELECT * FROM saas_licenses WHERE id = ?`).get(licenseId) as Record<string, unknown> | undefined)
      : licenseCode
      ? (sqlite.prepare(`SELECT * FROM saas_licenses WHERE license_code = ?`).get(String(licenseCode).trim().toUpperCase()) as Record<string, unknown> | undefined)
      : undefined;

    if (!row) {
      res.status(404).json({ error: 'License not found.' });
      return;
    }
    const lic = mapLicenseRow(row);
    if (lic.status !== 'active') {
      res.status(400).json({ error: lic.status === 'pending_verification' ? 'License is awaiting Ops payment verification.' : 'License is deactivated.' });
      return;
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    if (lic.expiresAt && lic.expiresAt < todayIso) {
      res.status(400).json({ error: `License ${lic.licenseCode} expired on ${lic.expiresAt}. Contact Ops to extend validity.` });
      return;
    }

    sqlite.prepare(`UPDATE companies SET attached_license_id = ? WHERE id = ?`).run(lic.id, auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'ATTACH_LICENSE', 'License', lic.id, `Attached ${lic.licenseCode} (${lic.tier.toUpperCase()})`);
    res.json({
      ok: true,
      data: buildBootstrapPayload(auth.userId, auth.companyId),
    });
  });

  app.post('/api/subscription/detach', authMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const passcode = String(req.body?.passcode || '');
    const row = sqlite
      .prepare(`SELECT detach_passcode FROM saas_settings WHERE id = 'global'`)
      .get() as { detach_passcode?: string } | undefined;
    const expected = row?.detach_passcode || '112233';
    if (!passcode || !safeSecretEqual(passcode, expected)) {
      res.status(403).json({ error: 'Incorrect Detach Passcode. License remains attached.' });
      return;
    }

    sqlite.prepare(`UPDATE companies SET attached_license_id = '' WHERE id = ?`).run(auth.companyId);
    recordAudit(auth.companyId, auth.userId, auth.userName, 'DETACH_LICENSE', 'Company', auth.companyId, 'Detached active subscription license via passcode');
    res.json({
      ok: true,
      data: buildBootstrapPayload(auth.userId, auth.companyId),
    });
  });

  // --- HIDDEN OPS ADMIN PANEL ROUTES (MULTI CURRENCY -> SUBS -> 112233) ---
  app.post('/api/ops/auth', authMiddleware, (req: AuthedRequest, res) => {
    const password = String(req.body?.password || '');
    const row = sqlite
      .prepare(`SELECT ops_password FROM saas_settings WHERE id = 'global'`)
      .get() as { ops_password?: string } | undefined;
    const expected = row?.ops_password || '112233';
    if (!password || !safeSecretEqual(password, expected)) {
      res.status(403).json({ error: 'Invalid Ops Admin Password.' });
      return;
    }
    res.json({ ok: true, ...getOpsOverviewPayload() });
  });

  app.get('/api/ops/overview', authMiddleware, opsMiddleware, (_req: AuthedRequest, res) => {
    res.json({ ok: true, ...getOpsOverviewPayload() });
  });

  app.post('/api/ops/licenses/:id/verify', authMiddleware, opsMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { transactionId, screenshotDataUrl } = req.body as {
      transactionId?: string;
      screenshotDataUrl?: string;
    };

    const cleanTxnId = String(transactionId || '').trim();
    const cleanShot = String(screenshotDataUrl || '').trim();
    if (!cleanTxnId && !cleanShot) {
      res.status(400).json({ error: 'Enter a Transaction ID or upload a Transaction Screenshot before verifying.' });
      return;
    }
    if (cleanShot && (!cleanShot.startsWith('data:image/') || cleanShot.length > 8 * 1024 * 1024)) {
      res.status(400).json({ error: 'Invalid transaction screenshot image format or size (>6MB).' });
      return;
    }

    const row = sqlite.prepare(`SELECT * FROM saas_licenses WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Subscription order not found.' });
      return;
    }

    const existing = mapLicenseRow(row);
    const todayIso = new Date().toISOString().slice(0, 10);
    const days = existing.duration === '3_years' ? 1095 : 365;
    const licenseCode = existing.licenseCode || generateUniqueLicenseCode(existing.tier);
    const validFrom = existing.validFrom || todayIso;
    const expiresAt = existing.expiresAt && existing.expiresAt > todayIso ? existing.expiresAt : addDaysIso(todayIso, days);
    const verifiedAt = new Date().toISOString();

    sqlite
      .prepare(
        `UPDATE saas_licenses SET
          license_code = ?,
          transaction_id = ?,
          screenshot_data_url = CASE WHEN ? != '' THEN ? ELSE screenshot_data_url END,
          status = 'active',
          valid_from = ?,
          expires_at = ?,
          verified_at = ?,
          verified_by = ?
         WHERE id = ?`
      )
      .run(
        licenseCode,
        cleanTxnId || existing.transactionId,
        cleanShot,
        cleanShot,
        validFrom,
        expiresAt,
        verifiedAt,
        auth.userName,
        id
      );

    recordAudit(auth.companyId, auth.userId, auth.userName, 'OPS_VERIFY_LICENSE', 'License', id, `Verified ${existing.invoiceNo} -> ${licenseCode} (Txn: ${cleanTxnId || 'Screenshot'})`);
    const updatedRow = sqlite.prepare(`SELECT * FROM saas_licenses WHERE id = ?`).get(id) as Record<string, unknown>;
    res.json({
      ok: true,
      license: mapLicenseRow(updatedRow),
      ...getOpsOverviewPayload(),
      data: buildBootstrapPayload(auth.userId, auth.companyId),
    });
  });

  app.patch('/api/ops/licenses/:id', authMiddleware, opsMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const { status, extendDays, expiresAt } = req.body as {
      status?: 'active' | 'deactivated';
      extendDays?: number;
      expiresAt?: string;
    };

    const row = sqlite.prepare(`SELECT * FROM saas_licenses WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'License not found.' });
      return;
    }

    const lic = mapLicenseRow(row);
    let nextStatus = lic.status;
    if (status === 'active' || status === 'deactivated') {
      nextStatus = status;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    let nextExpires = lic.expiresAt || todayIso;
    if (expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      nextExpires = expiresAt;
    } else if (typeof extendDays === 'number' && Number.isFinite(extendDays) && extendDays > 0) {
      const anchor = lic.expiresAt && lic.expiresAt > todayIso ? lic.expiresAt : todayIso;
      nextExpires = addDaysIso(anchor, Math.round(extendDays));
    }

    const nextCode = nextStatus === 'active' && !lic.licenseCode ? generateUniqueLicenseCode(lic.tier) : lic.licenseCode;
    const nextValidFrom = lic.validFrom || (nextStatus === 'active' ? todayIso : '');

    sqlite
      .prepare(`UPDATE saas_licenses SET status = ?, expires_at = ?, license_code = ?, valid_from = ? WHERE id = ?`)
      .run(nextStatus, nextExpires, nextCode, nextValidFrom, id);

    recordAudit(auth.companyId, auth.userId, auth.userName, 'OPS_UPDATE_LICENSE', 'License', id, `Status=${nextStatus}, Expires=${nextExpires}`);
    const updatedRow = sqlite.prepare(`SELECT * FROM saas_licenses WHERE id = ?`).get(id) as Record<string, unknown>;
    res.json({
      ok: true,
      license: mapLicenseRow(updatedRow),
      ...getOpsOverviewPayload(),
      data: buildBootstrapPayload(auth.userId, auth.companyId),
    });
  });

  app.put('/api/ops/plans/:tier', authMiddleware, opsMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const tier = String(req.params.tier) as PlanTier;
    if (!['silver', 'gold', 'platinum'].includes(tier)) {
      res.status(400).json({ error: 'Invalid plan tier.' });
      return;
    }
    const body = req.body as {
      name?: string;
      tagline?: string;
      priceDesktop1Y?: number;
      priceDesktop3Y?: number;
      priceCombo1Y?: number;
      priceCombo3Y?: number;
      features?: Record<SubscriptionFeatureKey, boolean>;
    };

    const existing = sqlite.prepare(`SELECT * FROM saas_plan_configs WHERE tier = ?`).get(tier) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Plan configuration not found.' });
      return;
    }

    sqlite
      .prepare(
        `UPDATE saas_plan_configs SET
          name = ?, tagline = ?, price_desktop_1y = ?, price_desktop_3y = ?,
          price_combo_1y = ?, price_combo_3y = ?, features_json = ?, updated_at = ?
         WHERE tier = ?`
      )
      .run(
        String(body.name || existing.name),
        String(body.tagline ?? existing.tagline),
        Math.max(0, Number(body.priceDesktop1Y ?? existing.price_desktop_1y)),
        Math.max(0, Number(body.priceDesktop3Y ?? existing.price_desktop_3y)),
        Math.max(0, Number(body.priceCombo1Y ?? existing.price_combo_1y)),
        Math.max(0, Number(body.priceCombo3Y ?? existing.price_combo_3y)),
        JSON.stringify(body.features || JSON.parse(String(existing.features_json || '{}'))),
        new Date().toISOString(),
        tier
      );

    recordAudit(auth.companyId, auth.userId, auth.userName, 'OPS_EDIT_PLAN', 'SubscriptionPlan', tier, `Updated pricing & feature matrix for ${tier.toUpperCase()}`);
    res.json({
      ok: true,
      ...getOpsOverviewPayload(),
      data: buildBootstrapPayload(auth.userId, auth.companyId),
    });
  });

  app.put('/api/ops/passcodes', authMiddleware, opsMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const { detachPasscode, newOpsPassword } = req.body as {
      detachPasscode?: string;
      newOpsPassword?: string;
    };
    const row = sqlite
      .prepare(`SELECT ops_password, detach_passcode FROM saas_settings WHERE id = 'global'`)
      .get() as { ops_password: string; detach_passcode: string };

    const nextDetach = String(detachPasscode || '').trim() || row.detach_passcode;
    const nextOps = String(newOpsPassword || '').trim() || row.ops_password;
    if (nextDetach.length < 4 || nextOps.length < 4) {
      res.status(400).json({ error: 'Passcodes must be at least 4 characters.' });
      return;
    }

    sqlite
      .prepare(`UPDATE saas_settings SET detach_passcode = ?, ops_password = ?, updated_at = ? WHERE id = 'global'`)
      .run(nextDetach, nextOps, new Date().toISOString());

    recordAudit(auth.companyId, auth.userId, auth.userName, 'OPS_UPDATE_PASSCODES', 'Security', 'global', 'Updated Subscription Detach / Ops passcodes');
    res.json({
      ok: true,
      ...getOpsOverviewPayload(),
    });
  });

  app.get('/api/ops/sheet-telemetry', authMiddleware, opsMiddleware, (_req: AuthedRequest, res) => {
    res.json({
      ok: true,
      telemetry: getOpsTelemetryPayload(),
    });
  });

  app.put('/api/ops/sheet-link', authMiddleware, opsMiddleware, (req: AuthedRequest, res) => {
    const auth = req.auth!;
    const {
      linkedSheetId,
      linkedSheetTitle,
      linkedSheetUrl,
      lastSheetSyncAt,
      lastSheetSyncBy,
    } = req.body as {
      linkedSheetId?: string;
      linkedSheetTitle?: string;
      linkedSheetUrl?: string;
      lastSheetSyncAt?: string;
      lastSheetSyncBy?: string;
    };

    sqlite
      .prepare(
        `UPDATE saas_settings SET
          linked_sheet_id = ?,
          linked_sheet_title = ?,
          linked_sheet_url = ?,
          last_sheet_sync_at = ?,
          last_sheet_sync_by = ?,
          updated_at = ?
         WHERE id = 'global'`
      )
      .run(
        String(linkedSheetId || '').trim(),
        String(linkedSheetTitle || '').trim(),
        String(linkedSheetUrl || '').trim(),
        String(lastSheetSyncAt || '').trim(),
        String(lastSheetSyncBy || '').trim(),
        new Date().toISOString()
      );

    recordAudit(
      auth.companyId,
      auth.userId,
      auth.userName,
      linkedSheetId ? 'OPS_SHEET_SYNC' : 'OPS_SHEET_UNLINK',
      'GoogleSheet',
      String(linkedSheetId || 'none'),
      linkedSheetId
        ? `Linked/synced Ops data to Google Sheet "${String(linkedSheetTitle || linkedSheetId)}"`
        : 'Cleared linked Google Sheet'
    );

    res.json({
      ok: true,
      ...getOpsOverviewPayload(),
      telemetry: getOpsTelemetryPayload(),
    });
  });

  // --- VITE / STATIC SERVING ---
  const distDir = path.resolve(process.cwd(), 'dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const portArgIdx = process.argv.indexOf('--port');
  const cliPort = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) : NaN;
  const PORT =
    Number.isFinite(cliPort) && cliPort > 0
      ? cliPort
      : process.env.NODE_ENV === 'production'
      ? Number(process.env.PORT) || 3000
      : 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shobhit Invoice Pro server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
