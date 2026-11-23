import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'shobhit_invoice_pro.db');
export const sqlite = new DatabaseSync(DB_PATH);

sqlite.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Admin',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    pan TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'Maharashtra',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    upi_id TEXT NOT NULL DEFAULT '',
    financial_year TEXT NOT NULL DEFAULT '2026-27',
    signatory_name TEXT NOT NULL DEFAULT '',
    default_terms TEXT NOT NULL DEFAULT '',
    logo_data_url TEXT NOT NULL DEFAULT '',
    invoice_config_json TEXT NOT NULL,
    prefixes_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    active_company_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (active_company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    manager TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS godowns (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    branch_id TEXT,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    manager TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    pan TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'Maharashtra',
    billing_address TEXT NOT NULL DEFAULT '',
    shipping_address TEXT NOT NULL DEFAULT '',
    opening_balance REAL NOT NULL DEFAULT 0,
    opening_type TEXT NOT NULL DEFAULT 'receivable',
    credit_limit REAL NOT NULL DEFAULT 0,
    credit_days INTEGER NOT NULL DEFAULT 30,
    group_name TEXT NOT NULL DEFAULT 'Sundry Debtors',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'product',
    sku TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '',
    hsn TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'General',
    subcategory TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'PCS',
    secondary_unit TEXT NOT NULL DEFAULT '',
    conversion_rate REAL NOT NULL DEFAULT 1,
    sale_price REAL NOT NULL DEFAULT 0,
    purchase_price REAL NOT NULL DEFAULT 0,
    mrp REAL NOT NULL DEFAULT 0,
    wholesale_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 18,
    cess_rate REAL NOT NULL DEFAULT 0,
    tax_inclusive INTEGER NOT NULL DEFAULT 0,
    opening_stock REAL NOT NULL DEFAULT 0,
    stock_qty REAL NOT NULL DEFAULT 0,
    min_stock_alert REAL NOT NULL DEFAULT 10,
    godown_id TEXT NOT NULL DEFAULT '',
    godown_stock_json TEXT NOT NULL DEFAULT '{}',
    track_batch INTEGER NOT NULL DEFAULT 0,
    batches_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_no TEXT NOT NULL DEFAULT '',
    ifsc TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '',
    upi_id TEXT NOT NULL DEFAULT '',
    opening_balance REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'bank',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    branch_id TEXT,
    type TEXT NOT NULL,
    voucher_no TEXT NOT NULL,
    date TEXT NOT NULL,
    due_date TEXT,
    party_id TEXT,
    party_name TEXT,
    party_gstin TEXT,
    place_of_supply TEXT,
    is_inter_state INTEGER NOT NULL DEFAULT 0,
    additional_charges REAL NOT NULL DEFAULT 0,
    discount_total REAL NOT NULL DEFAULT 0,
    round_off REAL NOT NULL DEFAULT 0,
    sub_total REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    grand_total REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    payment_mode TEXT,
    bank_account_id TEXT,
    split_details_json TEXT,
    status TEXT NOT NULL DEFAULT 'paid',
    linked_voucher_id TEXT,
    settled_invoices_json TEXT,
    eway_bill_no TEXT,
    vehicle_no TEXT,
    transporter_name TEXT,
    distance_km REAL,
    irn TEXT,
    is_reverse_charge INTEGER NOT NULL DEFAULT 0,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurring_interval TEXT,
    expense_category TEXT,
    contra_from_id TEXT,
    contra_to_id TEXT,
    journal_lines_json TEXT,
    reconciled INTEGER NOT NULL DEFAULT 0,
    reconciled_date TEXT,
    notes TEXT,
    terms TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(company_id, type, voucher_no),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS voucher_lines (
    id TEXT PRIMARY KEY,
    voucher_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    hsn TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL,
    unit TEXT NOT NULL,
    rate REAL NOT NULL,
    discount_pct REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    cess_rate REAL NOT NULL DEFAULT 0,
    taxable_amount REAL NOT NULL,
    cgst REAL NOT NULL DEFAULT 0,
    sgst REAL NOT NULL DEFAULT 0,
    igst REAL NOT NULL DEFAULT 0,
    cess REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    batch_no TEXT,
    FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ledger_accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    group_name TEXT NOT NULL,
    nature TEXT NOT NULL,
    opening_balance REAL NOT NULL DEFAULT 0,
    opening_type TEXT NOT NULL DEFAULT 'Dr',
    is_system INTEGER NOT NULL DEFAULT 1,
    UNIQUE(company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    voucher_id TEXT,
    date TEXT NOT NULL,
    voucher_no TEXT NOT NULL,
    voucher_type TEXT NOT NULL,
    narration TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS journal_lines (
    id TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL,
    ledger_name TEXT NOT NULL,
    account_group TEXT NOT NULL,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    narration TEXT,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cheques (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    cheque_no TEXT NOT NULL,
    date TEXT NOT NULL,
    clearance_date TEXT,
    party_id TEXT NOT NULL,
    party_name TEXT NOT NULL,
    bank_account_id TEXT NOT NULL,
    amount REAL NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    lender_name TEXT NOT NULL,
    account_no TEXT NOT NULL,
    principal REAL NOT NULL,
    interest_rate REAL NOT NULL,
    emi_amount REAL NOT NULL,
    start_date TEXT NOT NULL,
    tenure_months INTEGER NOT NULL,
    paid_emis INTEGER NOT NULL DEFAULT 0,
    bank_account_id TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stock_adjustments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    date TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    type TEXT NOT NULL,
    qty REAL NOT NULL,
    reason TEXT NOT NULL,
    cost_per_unit REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stock_transfers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transfer_no TEXT NOT NULL,
    date TEXT NOT NULL,
    from_godown_id TEXT NOT NULL,
    to_godown_id TEXT NOT NULL,
    items_json TEXT NOT NULL,
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS staff_members (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    monthly_salary REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    last_paid_month TEXT,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cost_centres (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Department',
    manager TEXT NOT NULL DEFAULT '',
    budget_limit REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    cost_centre_id TEXT,
    period TEXT NOT NULL,
    budget_type TEXT NOT NULL DEFAULT 'Expense',
    planned_amount REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fixed_assets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    purchase_cost REAL NOT NULL DEFAULT 0,
    salvage_value REAL NOT NULL DEFAULT 0,
    useful_life_years INTEGER NOT NULL DEFAULT 5,
    depreciation_method TEXT NOT NULL DEFAULT 'SLM',
    depreciation_rate_pct REAL NOT NULL DEFAULT 15,
    accumulated_dep REAL NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    assigned_to TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Active',
    last_depreciated_date TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS boms (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    finished_item_id TEXT NOT NULL,
    finished_item_name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    output_qty REAL NOT NULL DEFAULT 1,
    labour_cost_per_batch REAL NOT NULL DEFAULT 0,
    overhead_cost_per_batch REAL NOT NULL DEFAULT 0,
    components_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS production_orders (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    order_no TEXT NOT NULL,
    bom_id TEXT NOT NULL,
    finished_item_id TEXT NOT NULL,
    finished_item_name TEXT NOT NULL,
    planned_qty REAL NOT NULL DEFAULT 1,
    completed_qty REAL NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Planned',
    planned_material_cost REAL NOT NULL DEFAULT 0,
    actual_material_cost REAL NOT NULL DEFAULT 0,
    planned_labour_overhead REAL NOT NULL DEFAULT 0,
    actual_labour_overhead REAL NOT NULL DEFAULT 0,
    wastage_pct REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS job_works (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    challan_no TEXT NOT NULL,
    vendor_party_id TEXT NOT NULL,
    vendor_name TEXT NOT NULL,
    date TEXT NOT NULL,
    material_sent_item_id TEXT NOT NULL,
    material_sent_name TEXT NOT NULL,
    qty_sent REAL NOT NULL DEFAULT 0,
    qty_received_back REAL NOT NULL DEFAULT 0,
    wastage_qty REAL NOT NULL DEFAULT 0,
    processing_charge REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'With Job Worker',
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    client_party_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    cost_centre_id TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    contract_value REAL NOT NULL DEFAULT 0,
    material_cost REAL NOT NULL DEFAULT 0,
    labour_cost REAL NOT NULL DEFAULT 0,
    overhead_cost REAL NOT NULL DEFAULT 0,
    billed_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Active',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    condition_text TEXT NOT NULL,
    action_text TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    executions_count INTEGER NOT NULL DEFAULT 0,
    last_triggered_at TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS approval_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    threshold_amount REAL NOT NULL DEFAULT 50000,
    approver_role TEXT NOT NULL DEFAULT 'Admin',
    enabled INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS currency_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    rate_to_inr REAL NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    UNIQUE(company_id, code),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS commission_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    basis TEXT NOT NULL DEFAULT 'Revenue',
    rate_pct REAL NOT NULL DEFAULT 2,
    monthly_target REAL NOT NULL DEFAULT 100000,
    bonus_on_target REAL NOT NULL DEFAULT 5000,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pricing_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    min_qty REAL NOT NULL DEFAULT 1,
    discount_pct REAL NOT NULL DEFAULT 0,
    target_margin_pct REAL NOT NULL DEFAULT 15,
    channel TEXT NOT NULL DEFAULT 'All',
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    party_id TEXT NOT NULL,
    party_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    interval TEXT NOT NULL DEFAULT 'Monthly',
    next_billing_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    auto_renew INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS compliance_items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Upcoming',
    reference_no TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    linked_voucher_no TEXT DEFAULT '',
    uploaded_at TEXT NOT NULL,
    signed_by TEXT DEFAULT '',
    signature_hash TEXT DEFAULT '',
    file_type TEXT NOT NULL DEFAULT 'PDF',
    preview_text TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    label TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    event TEXT NOT NULL,
    target_url TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_status INTEGER,
    last_delivered_at TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS custom_reports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dataset TEXT NOT NULL,
    columns_json TEXT NOT NULL DEFAULT '[]',
    group_by TEXT NOT NULL DEFAULT '',
    metric_formula TEXT NOT NULL DEFAULT 'SUM(grandTotal)',
    chart_type TEXT NOT NULL DEFAULT 'bar',
    schedule_cron TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payroll_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    payslip_no TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    emp_code TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    designation TEXT NOT NULL DEFAULT '',
    month TEXT NOT NULL,
    pay_date TEXT NOT NULL,
    working_days INTEGER NOT NULL DEFAULT 26,
    paid_days REAL NOT NULL DEFAULT 26,
    lop_days REAL NOT NULL DEFAULT 0,
    basic REAL NOT NULL DEFAULT 0,
    hra REAL NOT NULL DEFAULT 0,
    conveyance REAL NOT NULL DEFAULT 0,
    special_allowance REAL NOT NULL DEFAULT 0,
    overtime_pay REAL NOT NULL DEFAULT 0,
    bonus REAL NOT NULL DEFAULT 0,
    commission REAL NOT NULL DEFAULT 0,
    arrears REAL NOT NULL DEFAULT 0,
    reimbursement REAL NOT NULL DEFAULT 0,
    gross_earnings REAL NOT NULL DEFAULT 0,
    employee_pf REAL NOT NULL DEFAULT 0,
    employee_esic REAL NOT NULL DEFAULT 0,
    professional_tax REAL NOT NULL DEFAULT 0,
    tds REAL NOT NULL DEFAULT 0,
    advance_recovery REAL NOT NULL DEFAULT 0,
    other_deductions REAL NOT NULL DEFAULT 0,
    total_deductions REAL NOT NULL DEFAULT 0,
    employer_pf REAL NOT NULL DEFAULT 0,
    employer_esic REAL NOT NULL DEFAULT 0,
    net_pay REAL NOT NULL DEFAULT 0,
    payment_mode TEXT NOT NULL DEFAULT 'Bank Transfer',
    bank_account_id TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Paid',
    notes TEXT DEFAULT '',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS employee_advances (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Salary Advance',
    amount REAL NOT NULL DEFAULT 0,
    monthly_emi REAL NOT NULL DEFAULT 0,
    recovered_amount REAL NOT NULL DEFAULT 0,
    reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Active',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    leave_type TEXT NOT NULL DEFAULT 'CL',
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    days REAL NOT NULL DEFAULT 1,
    reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Pending',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reimbursements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    date TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Travel',
    amount REAL NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Pending',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recycle_bin (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    deleted_by TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS disaster_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    label TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    voucher_count INTEGER NOT NULL DEFAULT 0,
    party_count INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saas_plan_configs (
    tier TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    price_desktop_1y REAL NOT NULL,
    price_desktop_3y REAL NOT NULL,
    price_combo_1y REAL NOT NULL,
    price_combo_3y REAL NOT NULL,
    features_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saas_licenses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL DEFAULT '',
    license_code TEXT NOT NULL DEFAULT '',
    invoice_no TEXT NOT NULL,
    tier TEXT NOT NULL,
    device_scope TEXT NOT NULL,
    duration TEXT NOT NULL,
    amount REAL NOT NULL,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    gstin TEXT NOT NULL DEFAULT '',
    payment_mode TEXT NOT NULL DEFAULT 'UPI',
    payment_ref TEXT NOT NULL DEFAULT '',
    transaction_id TEXT NOT NULL DEFAULT '',
    screenshot_data_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_verification',
    valid_from TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    verified_at TEXT NOT NULL DEFAULT '',
    verified_by TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS saas_settings (
    id TEXT PRIMARY KEY,
    ops_password TEXT NOT NULL DEFAULT '112233',
    detach_passcode TEXT NOT NULL DEFAULT '112233',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saas_otp_codes (
    phone TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

function addColumnIfMissing(table: string, col: string, def: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

addColumnIfMissing('companies', 'language', `TEXT NOT NULL DEFAULT 'en'`);
addColumnIfMissing('companies', 'region_locale', `TEXT NOT NULL DEFAULT 'en-IN'`);
addColumnIfMissing('companies', 'base_currency', `TEXT NOT NULL DEFAULT 'INR'`);
addColumnIfMissing('companies', 'security_settings_json', `TEXT NOT NULL DEFAULT '{}'`);
addColumnIfMissing('companies', 'app_settings_json', `TEXT NOT NULL DEFAULT '{}'`);
addColumnIfMissing('companies', 'signature_data_url', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('companies', 'digital_signature_text', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('companies', 'gst_api_config_json', `TEXT NOT NULL DEFAULT '{}'`);
addColumnIfMissing('voucher_lines', 'meta_json', `TEXT NOT NULL DEFAULT '{}'`);

addColumnIfMissing('parties', 'risk_category', `TEXT NOT NULL DEFAULT 'Low'`);
addColumnIfMissing('parties', 'credit_hold', `INTEGER NOT NULL DEFAULT 0`);
addColumnIfMissing('parties', 'avg_delivery_days', `REAL NOT NULL DEFAULT 3`);
addColumnIfMissing('parties', 'quality_rating', `REAL NOT NULL DEFAULT 4.5`);

addColumnIfMissing('items', 'max_stock', `REAL NOT NULL DEFAULT 250`);
addColumnIfMissing('items', 'lead_time_days', `INTEGER NOT NULL DEFAULT 5`);
addColumnIfMissing('items', 'safety_stock', `REAL NOT NULL DEFAULT 15`);
addColumnIfMissing('items', 'bin_location', `TEXT NOT NULL DEFAULT 'RACK-A1'`);

addColumnIfMissing('vouchers', 'sales_channel', `TEXT NOT NULL DEFAULT 'Direct B2B'`);
addColumnIfMissing('vouchers', 'cost_centre_id', `TEXT`);
addColumnIfMissing('vouchers', 'project_id', `TEXT`);
addColumnIfMissing('vouchers', 'currency', `TEXT NOT NULL DEFAULT 'INR'`);
addColumnIfMissing('vouchers', 'exchange_rate', `REAL NOT NULL DEFAULT 1`);
addColumnIfMissing('vouchers', 'fx_gain_loss', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('vouchers', 'freight_cost', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('vouchers', 'insurance_cost', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('vouchers', 'customs_cost', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('vouchers', 'approval_status', `TEXT NOT NULL DEFAULT 'approved'`);
addColumnIfMissing('vouchers', 'approved_by', `TEXT`);
addColumnIfMissing('vouchers', 'shipment_status', `TEXT DEFAULT 'Delivered'`);
addColumnIfMissing('vouchers', 'tracking_no', `TEXT`);
addColumnIfMissing('vouchers', 'sales_rep_name', `TEXT`);

addColumnIfMissing('staff_members', 'hra_pct', `REAL NOT NULL DEFAULT 20`);
addColumnIfMissing('staff_members', 'allowance_amt', `REAL NOT NULL DEFAULT 2000`);
addColumnIfMissing('staff_members', 'pf_deduction', `REAL NOT NULL DEFAULT 1800`);
addColumnIfMissing('staff_members', 'tds_deduction', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('staff_members', 'attendance_days', `INTEGER NOT NULL DEFAULT 26`);
addColumnIfMissing('staff_members', 'commission_pct', `REAL NOT NULL DEFAULT 1.5`);
addColumnIfMissing('staff_members', 'emp_code', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('staff_members', 'designation', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('staff_members', 'department', `TEXT NOT NULL DEFAULT 'Operations'`);
addColumnIfMissing('staff_members', 'joining_date', `TEXT NOT NULL DEFAULT '2025-04-01'`);
addColumnIfMissing('staff_members', 'employment_type', `TEXT NOT NULL DEFAULT 'Full-Time'`);
addColumnIfMissing('staff_members', 'pan', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('staff_members', 'uan', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('staff_members', 'esic_no', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('staff_members', 'bank_name', `TEXT NOT NULL DEFAULT 'HDFC Bank'`);
addColumnIfMissing('staff_members', 'bank_account_no', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('staff_members', 'ifsc', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('staff_members', 'payment_mode', `TEXT NOT NULL DEFAULT 'Bank Transfer'`);
addColumnIfMissing('staff_members', 'conveyance_amt', `REAL NOT NULL DEFAULT 1600`);
addColumnIfMissing('staff_members', 'esic_deduction', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('staff_members', 'pt_deduction', `REAL NOT NULL DEFAULT 200`);
addColumnIfMissing('staff_members', 'include_pf', `INTEGER NOT NULL DEFAULT 1`);
addColumnIfMissing('staff_members', 'include_esic', `INTEGER NOT NULL DEFAULT 0`);
addColumnIfMissing('staff_members', 'tax_regime', `TEXT NOT NULL DEFAULT 'New'`);
addColumnIfMissing('staff_members', 'pt_state', `TEXT NOT NULL DEFAULT 'Maharashtra'`);
addColumnIfMissing('staff_members', 'lop_days', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('staff_members', 'overtime_hours', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('staff_members', 'overtime_rate', `REAL NOT NULL DEFAULT 250`);
addColumnIfMissing('staff_members', 'bonus_amt', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('staff_members', 'arrears_amt', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('staff_members', 'cl_balance', `REAL NOT NULL DEFAULT 6`);
addColumnIfMissing('staff_members', 'sl_balance', `REAL NOT NULL DEFAULT 6`);
addColumnIfMissing('staff_members', 'el_balance', `REAL NOT NULL DEFAULT 12`);
addColumnIfMissing('companies', 'trial_started_at', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('companies', 'attached_license_id', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('saas_settings', 'linked_sheet_id', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('saas_settings', 'linked_sheet_title', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('saas_settings', 'linked_sheet_url', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('saas_settings', 'last_sheet_sync_at', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('saas_settings', 'last_sheet_sync_by', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('saas_settings', 'otp_config_json', `TEXT NOT NULL DEFAULT '{}'`);
addColumnIfMissing('users', 'phone', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('users', 'assigned_company_id', `TEXT NOT NULL DEFAULT ''`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'Biller',
    permissions_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS auth_otp_codes (
    target TEXT PRIMARY KEY,
    channel TEXT NOT NULL DEFAULT 'phone',
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export function ensureSaasDefaults(): void {
  const now = new Date().toISOString();
  const planCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM saas_plan_configs`).get() as { c: number }).c;
  if (planCount === 0) {
    const stmt = sqlite.prepare(
      `INSERT INTO saas_plan_configs (tier, name, tagline, price_desktop_1y, price_desktop_3y, price_combo_1y, price_combo_3y, features_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      'silver',
      'Silver',
      'Essential GST Billing, Stock & Accounting',
      2600,
      6200,
      3200,
      9200,
      JSON.stringify({
        core_billing: true,
        payroll: false,
        operations_erp: false,
        ocr_bulk_tools: false,
        gst_portals: false,
        invoice_designs: false,
        bulk_print: false,
        multi_currency: false,
      }),
      now
    );
    stmt.run(
      'gold',
      'Gold',
      'Billing + Payroll, GST Portals, 24 Designs & Multi-Currency',
      3200,
      9200,
      4200,
      12200,
      JSON.stringify({
        core_billing: true,
        payroll: true,
        operations_erp: false,
        ocr_bulk_tools: false,
        gst_portals: true,
        invoice_designs: true,
        bulk_print: true,
        multi_currency: true,
      }),
      now
    );
    stmt.run(
      'platinum',
      'Platinum',
      'Full Enterprise Suite: OCR Scanner, Bulk Excel, Manufacturing & ERP',
      5200,
      15200,
      6200,
      18200,
      JSON.stringify({
        core_billing: true,
        payroll: true,
        operations_erp: true,
        ocr_bulk_tools: true,
        gst_portals: true,
        invoice_designs: true,
        bulk_print: true,
        multi_currency: true,
      }),
      now
    );
  }

  const settingsCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM saas_settings WHERE id = 'global'`).get() as { c: number }).c;
  if (settingsCount === 0) {
    sqlite
      .prepare(`INSERT INTO saas_settings (id, ops_password, detach_passcode, updated_at) VALUES ('global', '112233', '112233', ?)`)
      .run(now);
  }
}

ensureSaasDefaults();


export function runTransaction<T>(fn: () => T): T {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const res = fn();
    sqlite.exec('COMMIT');
    return res;
  } catch (err) {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

export function recordAudit(
  companyId: string,
  userId: string,
  userName: string,
  action: string,
  entityType: string,
  entityId: string,
  details: string
): void {
  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, company_id, user_id, user_name, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(uid('aud'), companyId, userId, userName, action, entityType, entityId, details, new Date().toISOString());
}
