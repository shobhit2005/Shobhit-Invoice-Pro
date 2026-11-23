import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
] as const;

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initWorkspaceAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (!user) cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Workspace access token. Please allow Drive & Sheets permissions.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getWorkspaceAccessToken(): string | null {
  return cachedAccessToken;
}

export async function logoutGoogleWorkspace(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

export function extractSpreadsheetId(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}

export interface DriveSpreadsheetItem {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink: string;
}

export interface SheetMetadataSummary {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheetTabs: Array<{ sheetId: number; title: string; rowCount: number; columnCount: number }>;
  previewTabTitle: string;
  previewRows: string[][];
}

export interface OpsTelemetryData {
  generatedAt: string;
  runtime: {
    serverStatus: string;
    port: number;
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    uptimeSeconds: number;
    uptimeFormatted: string;
    memoryRssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    cpuUserMs: number;
    cpuSystemMs: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    totalSystemMemMb: number;
    freeSystemMemMb: number;
    dbFileSizeKb: number;
    sqliteTableCount: number;
    activeSessionsCount: number;
    pendingOtpCount: number;
  };
  licenseSummary: {
    totalOrders: number;
    activeCount: number;
    pendingCount: number;
    deactivatedCount: number;
    verifiedRevenue: number;
    pendingRevenue: number;
    silverCount: number;
    goldCount: number;
    platinumCount: number;
    desktopOnlyCount: number;
    desktopMobileCount: number;
  };
  companies: Array<{
    id: string;
    name: string;
    gstin: string;
    state: string;
    financialYear: string;
    baseCurrency: string;
    trialStartedAt: string;
    trialDaysLeft: number;
    attachedLicenseId: string;
    attachedLicenseCode: string;
    vouchersCount: number;
    salesVouchersCount: number;
    purchaseVouchersCount: number;
    totalSalesRevenue: number;
    totalPurchaseSpend: number;
    totalReceipts: number;
    totalPayments: number;
    partiesCount: number;
    itemsCount: number;
    bankAccountsCount: number;
    staffCount: number;
    payrollRunsCount: number;
    pendingApprovalsCount: number;
    recycleBinCount: number;
  }>;
  licenses: Array<{
    id: string;
    companyId: string;
    licenseCode: string;
    invoiceNo: string;
    tier: string;
    deviceScope: string;
    duration: string;
    amount: number;
    taxAmount: number;
    totalAmount: number;
    customerName: string;
    phone: string;
    gstin: string;
    paymentMode: string;
    transactionId: string;
    status: string;
    validFrom: string;
    expiresAt: string;
    createdAt: string;
    verifiedAt: string;
    verifiedBy: string;
  }>;
  plans: Array<{
    tier: string;
    name: string;
    tagline: string;
    priceDesktop1Y: number;
    priceDesktop3Y: number;
    priceCombo1Y: number;
    priceCombo3Y: number;
    features: Record<string, boolean>;
    updatedAt?: string;
  }>;
  runningOperations: Array<{
    category: string;
    companyName: string;
    title: string;
    status: string;
    metricOrAmount: string;
    scheduleOrDue: string;
  }>;
  auditLogs: Array<{
    id: string;
    companyName: string;
    userName: string;
    action: string;
    entityType: string;
    entityId: string;
    details: string;
    createdAt: string;
  }>;
  securitySettings: {
    detachPasscode: string;
    linkedSheetId: string;
    linkedSheetTitle: string;
    linkedSheetUrl: string;
    lastSheetSyncAt: string;
    lastSheetSyncBy: string;
  };
}

async function googleApiFetch<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google session expired. Click "Sign in with Google" to reconnect.');
  }
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    const errObj = parsed as { error?: { message?: string } };
    throw new Error(errObj?.error?.message || `Google API HTTP ${res.status}`);
  }
  return parsed as T;
}

export async function listDriveSpreadsheets(accessToken: string): Promise<DriveSpreadsheetItem[]> {
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const fields = encodeURIComponent('files(id,name,modifiedTime,webViewLink)');
  const data = await googleApiFetch<{ files?: DriveSpreadsheetItem[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=25`,
    accessToken
  );
  return data.files || [];
}

export async function inspectSpreadsheetMetadata(
  accessToken: string,
  rawIdOrUrl: string
): Promise<SheetMetadataSummary> {
  const spreadsheetId = extractSpreadsheetId(rawIdOrUrl);
  if (!spreadsheetId) throw new Error('Enter a valid Google Sheet URL or Spreadsheet ID.');

  const meta = await googleApiFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties`,
    accessToken
  );

  const sheetTabs = (meta.sheets || []).map((s) => ({
    sheetId: Number(s.properties?.sheetId ?? 0),
    title: String(s.properties?.title || 'Sheet'),
    rowCount: Number(s.properties?.gridProperties?.rowCount ?? 0),
    columnCount: Number(s.properties?.gridProperties?.columnCount ?? 0),
  }));

  const previewTabTitle = sheetTabs[0]?.title || '';
  let previewRows: string[][] = [];
  if (previewTabTitle) {
    const safeRange = `'${previewTabTitle.replace(/'/g, "''")}'!A1:H10`;
    const valRes = await googleApiFetch<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(safeRange)}`,
      accessToken
    );
    previewRows = valRes.values || [];
  }

  return {
    spreadsheetId: meta.spreadsheetId,
    title: meta.properties?.title || 'Untitled Spreadsheet',
    spreadsheetUrl:
      meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${meta.spreadsheetId}/edit`,
    sheetTabs,
    previewTabTitle,
    previewRows,
  };
}

export const OPS_SHEET_TABS = [
  'OPS_Dashboard_KPIs',
  'Licenses_Orders',
  'Plan_Pricing_Features',
  'Workspaces_Performance',
  'Running_Operations',
  'Ops_Audit_Log',
] as const;

export async function createOpsMasterSpreadsheet(
  accessToken: string,
  title = `Shobhit Invoice Pro — Live Ops & Performance (${new Date().toISOString().slice(0, 10)})`
): Promise<SheetMetadataSummary> {
  const created = await googleApiFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  }>('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: OPS_SHEET_TABS.map((tabTitle) => ({
        properties: { title: tabTitle },
      })),
    }),
  });

  return {
    spreadsheetId: created.spreadsheetId,
    title: created.properties?.title || title,
    spreadsheetUrl:
      created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    sheetTabs: (created.sheets || []).map((s) => ({
      sheetId: Number(s.properties?.sheetId ?? 0),
      title: String(s.properties?.title || ''),
      rowCount: Number(s.properties?.gridProperties?.rowCount ?? 1000),
      columnCount: Number(s.properties?.gridProperties?.columnCount ?? 26),
    })),
    previewTabTitle: OPS_SHEET_TABS[0],
    previewRows: [],
  };
}

export function buildOpsSheetTabData(telemetry: OpsTelemetryData): Record<(typeof OPS_SHEET_TABS)[number], (string | number | boolean)[][]> {
  const rt = telemetry.runtime;
  const ls = telemetry.licenseSummary;
  const totalSales = telemetry.companies.reduce((s, c) => s + c.totalSalesRevenue, 0);
  const totalPurchases = telemetry.companies.reduce((s, c) => s + c.totalPurchaseSpend, 0);
  const totalReceipts = telemetry.companies.reduce((s, c) => s + c.totalReceipts, 0);
  const totalPayments = telemetry.companies.reduce((s, c) => s + c.totalPayments, 0);
  const totalVouchers = telemetry.companies.reduce((s, c) => s + c.vouchersCount, 0);

  const kpiRows: (string | number | boolean)[][] = [
    ['Section', 'Metric Name', 'Live Value', 'Details / Notes', 'Captured At (UTC)'],
    ['System Health', 'Server Status', rt.serverStatus, `Port ${rt.port} · PID ${rt.pid}`, telemetry.generatedAt],
    ['System Health', 'Node Runtime', rt.nodeVersion, `${rt.platform} (${rt.arch})`, telemetry.generatedAt],
    ['System Health', 'Server Uptime', rt.uptimeFormatted, `${rt.uptimeSeconds} seconds continuous`, telemetry.generatedAt],
    ['Performance', 'Process Memory RSS (MB)', rt.memoryRssMb, `Heap ${rt.heapUsedMb}/${rt.heapTotalMb} MB · Ext ${rt.externalMb} MB`, telemetry.generatedAt],
    ['Performance', 'System RAM Free / Total (MB)', `${rt.freeSystemMemMb} / ${rt.totalSystemMemMb}`, 'Host OS memory availability', telemetry.generatedAt],
    ['Performance', 'CPU Usage (User / System ms)', `${rt.cpuUserMs} / ${rt.cpuSystemMs}`, `Load Avg: ${rt.loadAvg1m} / ${rt.loadAvg5m} / ${rt.loadAvg15m}`, telemetry.generatedAt],
    ['Database', 'SQLite Database Size (KB)', rt.dbFileSizeKb, `${rt.sqliteTableCount} active tables`, telemetry.generatedAt],
    ['Runtime State', 'Active Auth Sessions', rt.activeSessionsCount, `Pending OTP logins: ${rt.pendingOtpCount}`, telemetry.generatedAt],
    ['Licensing', 'Total Subscription Orders', ls.totalOrders, `Active: ${ls.activeCount} | Pending: ${ls.pendingCount} | Deactivated: ${ls.deactivatedCount}`, telemetry.generatedAt],
    ['Licensing', 'Verified License Revenue (INR)', ls.verifiedRevenue, `Pending verification revenue: INR ${ls.pendingRevenue}`, telemetry.generatedAt],
    ['Licensing', 'Plan Mix (Silver / Gold / Platinum)', `${ls.silverCount} / ${ls.goldCount} / ${ls.platinumCount}`, `Desktop Only: ${ls.desktopOnlyCount} | Combo: ${ls.desktopMobileCount}`, telemetry.generatedAt],
    ['Workspaces', 'Running Companies / Firms', telemetry.companies.length, `Total Vouchers across all firms: ${totalVouchers}`, telemetry.generatedAt],
    ['Business Volume', 'Total Sales Revenue (INR)', Number(totalSales.toFixed(2)), `Total Receipts: INR ${totalReceipts.toFixed(2)}`, telemetry.generatedAt],
    ['Business Volume', 'Total Purchase Spend (INR)', Number(totalPurchases.toFixed(2)), `Total Payments: INR ${totalPayments.toFixed(2)}`, telemetry.generatedAt],
    ['Operations', 'Running Automations & Queues', telemetry.runningOperations.length, 'Recurring, Payroll, Compliance, Approvals, Webhooks', telemetry.generatedAt],
    ['Security', 'Current Customer Detach Passcode', telemetry.securitySettings.detachPasscode, 'Required to detach an attached workspace license', telemetry.generatedAt],
  ];

  const licenseRows: (string | number | boolean)[][] = [
    [
      'Order ID',
      'Invoice No',
      'Unique License Code',
      'Status',
      'Customer Name',
      'Registered Phone',
      'GSTIN',
      'Tier',
      'Device Scope',
      'Duration',
      'Base Amount (INR)',
      'GST 18% (INR)',
      'Total Paid (INR)',
      'Payment Mode',
      'Transaction / UTR ID',
      'Valid From',
      'Expires At',
      'Created At',
      'Verified At',
      'Verified By',
    ],
    ...telemetry.licenses.map((l) => [
      l.id,
      l.invoiceNo,
      l.licenseCode || 'PENDING',
      l.status,
      l.customerName,
      l.phone,
      l.gstin || '-',
      l.tier.toUpperCase(),
      l.deviceScope === 'desktop_mobile' ? 'Desktop + Mobile' : 'Desktop Only',
      l.duration === '3_years' ? '3 Years' : '1 Year',
      l.amount,
      l.taxAmount,
      l.totalAmount,
      l.paymentMode,
      l.transactionId || '-',
      l.validFrom || '-',
      l.expiresAt || '-',
      l.createdAt,
      l.verifiedAt || '-',
      l.verifiedBy || '-',
    ]),
  ];

  const planRows: (string | number | boolean)[][] = [
    [
      'Tier',
      'Plan Name',
      'Tagline',
      'Desktop 1Y (INR)',
      'Desktop 3Y (INR)',
      'Desktop+Mobile 1Y (INR)',
      'Desktop+Mobile 3Y (INR)',
      'Core Billing',
      'Payroll',
      'Operations ERP',
      'OCR & Bulk Excel',
      'GST Portals',
      '24 Invoice Designs',
      'Bulk Print',
      'Multi-Currency',
      'Updated At',
    ],
    ...telemetry.plans.map((p) => [
      p.tier.toUpperCase(),
      p.name,
      p.tagline,
      p.priceDesktop1Y,
      p.priceDesktop3Y,
      p.priceCombo1Y,
      p.priceCombo3Y,
      p.features.core_billing ? 'UNLOCKED' : 'LOCKED',
      p.features.payroll ? 'UNLOCKED' : 'LOCKED',
      p.features.operations_erp ? 'UNLOCKED' : 'LOCKED',
      p.features.ocr_bulk_tools ? 'UNLOCKED' : 'LOCKED',
      p.features.gst_portals ? 'UNLOCKED' : 'LOCKED',
      p.features.invoice_designs ? 'UNLOCKED' : 'LOCKED',
      p.features.bulk_print ? 'UNLOCKED' : 'LOCKED',
      p.features.multi_currency ? 'UNLOCKED' : 'LOCKED',
      p.updatedAt || '-',
    ]),
  ];

  const companyRows: (string | number | boolean)[][] = [
    [
      'Company ID',
      'Company Name',
      'GSTIN',
      'State',
      'Financial Year',
      'Currency',
      'Trial Started At',
      'Trial Days Left',
      'Attached License Code',
      'Vouchers Total',
      'Sales Count',
      'Purchase Count',
      'Sales Revenue (INR)',
      'Purchase Spend (INR)',
      'Receipts (INR)',
      'Payments (INR)',
      'Parties',
      'Inventory Items',
      'Banks',
      'Staff Count',
      'Payroll Runs',
      'Pending Approvals',
      'Recycle Bin',
    ],
    ...telemetry.companies.map((c) => [
      c.id,
      c.name,
      c.gstin || '-',
      c.state,
      c.financialYear,
      c.baseCurrency,
      c.trialStartedAt || '-',
      c.trialDaysLeft,
      c.attachedLicenseCode || 'FREE_TRIAL',
      c.vouchersCount,
      c.salesVouchersCount,
      c.purchaseVouchersCount,
      Number(c.totalSalesRevenue.toFixed(2)),
      Number(c.totalPurchaseSpend.toFixed(2)),
      Number(c.totalReceipts.toFixed(2)),
      Number(c.totalPayments.toFixed(2)),
      c.partiesCount,
      c.itemsCount,
      c.bankAccountsCount,
      c.staffCount,
      c.payrollRunsCount,
      c.pendingApprovalsCount,
      c.recycleBinCount,
    ]),
  ];

  const runningRows: (string | number | boolean)[][] = [
    ['Category', 'Workspace / Firm', 'Running Item / Process', 'Status', 'Metric / Amount', 'Schedule / Due Date'],
    ...telemetry.runningOperations.map((op) => [
      op.category,
      op.companyName,
      op.title,
      op.status,
      op.metricOrAmount,
      op.scheduleOrDue,
    ]),
  ];

  const auditRows: (string | number | boolean)[][] = [
    ['Audit ID', 'Workspace / Firm', 'User', 'Action', 'Entity Type', 'Entity ID', 'Details', 'Timestamp'],
    ...telemetry.auditLogs.map((a) => [
      a.id,
      a.companyName,
      a.userName,
      a.action,
      a.entityType,
      a.entityId,
      a.details,
      a.createdAt,
    ]),
  ];

  return {
    OPS_Dashboard_KPIs: kpiRows,
    Licenses_Orders: licenseRows,
    Plan_Pricing_Features: planRows,
    Workspaces_Performance: companyRows,
    Running_Operations: runningRows,
    Ops_Audit_Log: auditRows,
  };
}

export async function syncAllOpsDataToSheet(
  accessToken: string,
  spreadsheetId: string,
  telemetry: OpsTelemetryData
): Promise<{
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  tabsUpdated: string[];
  totalRowsWritten: number;
}> {
  const meta = await inspectSpreadsheetMetadata(accessToken, spreadsheetId);
  const existingMap = new Map(meta.sheetTabs.map((t) => [t.title, t.sheetId]));

  // 1. Add any missing tabs among OPS_SHEET_TABS
  const addRequests = OPS_SHEET_TABS.filter((tab) => !existingMap.has(tab)).map((tab) => ({
    addSheet: {
      properties: { title: tab },
    },
  }));

  if (addRequests.length > 0) {
    const batchRes = await googleApiFetch<{
      replies?: Array<{ addSheet?: { properties?: { sheetId?: number; title?: string } } }>;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(meta.spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: addRequests }),
      }
    );
    for (const r of batchRes.replies || []) {
      const p = r.addSheet?.properties;
      if (p?.title && typeof p.sheetId === 'number') {
        existingMap.set(p.title, p.sheetId);
      }
    }
  }

  // 2. Clear previous values cleanly across the 6 Ops tabs
  const rangesToClear = OPS_SHEET_TABS.map((t) => `'${t}'!A:Z`);
  await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(meta.spreadsheetId)}/values:batchClear`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ ranges: rangesToClear }),
    }
  );

  // 3. Write all datasets in a single batchUpdate
  const tabData = buildOpsSheetTabData(telemetry);
  const dataPayload = OPS_SHEET_TABS.map((tabName) => ({
    range: `'${tabName}'!A1`,
    majorDimension: 'ROWS',
    values: tabData[tabName],
  }));

  await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(meta.spreadsheetId)}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: dataPayload,
      }),
    }
  );

  // 4. Format headers (bold white text on slate/indigo header, freeze header row)
  const formatRequests = OPS_SHEET_TABS.flatMap((tabName) => {
    const sheetId = existingMap.get(tabName);
    if (typeof sheetId !== 'number') return [];
    const colCount = tabData[tabName][0]?.length || 10;
    return [
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.118, green: 0.161, blue: 0.231 },
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                bold: true,
                fontSize: 10,
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      },
    ];
  });

  if (formatRequests.length > 0) {
    await googleApiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(meta.spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: formatRequests }),
      }
    );
  }

  const totalRowsWritten = OPS_SHEET_TABS.reduce((sum, tab) => sum + tabData[tab].length, 0);

  return {
    spreadsheetId: meta.spreadsheetId,
    title: meta.title,
    spreadsheetUrl: meta.spreadsheetUrl,
    tabsUpdated: [...OPS_SHEET_TABS],
    totalRowsWritten,
  };
}
