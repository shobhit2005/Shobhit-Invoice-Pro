export type VoucherType =
  | 'sale_invoice'
  | 'estimate'
  | 'proforma'
  | 'sale_order'
  | 'delivery_challan'
  | 'credit_note'
  | 'purchase_bill'
  | 'purchase_order'
  | 'debit_note'
  | 'payment_in'
  | 'payment_out'
  | 'expense'
  | 'journal'
  | 'contra';

export type VoucherStatus =
  | 'paid'
  | 'partial'
  | 'unpaid'
  | 'open'
  | 'converted'
  | 'cancelled';

export type PaymentMode =
  | 'Cash'
  | 'UPI'
  | 'Bank Transfer'
  | 'Cheque'
  | 'Card'
  | 'Split';

export type SalesChannel =
  | 'Direct B2B'
  | 'Retail POS Counter'
  | 'Wholesale'
  | 'Online Store'
  | 'Marketplace'
  | 'Field Sales';

export type ApprovalStatus = 'approved' | 'pending_approval' | 'rejected';

export type InvoiceTemplateId =
  | 'classic_white'
  | 'corporate_blue'
  | 'premium_black_gold'
  | 'modern_green'
  | 'retail_invoice'
  | 'gst_standard'
  | 'luxury_beige'
  | 'dark_modern'
  | 'minimal_bw'
  | 'contractor_invoice'
  | 'ecommerce_invoice'
  | 'service_invoice'
  | 'modern_orange'
  | 'executive_grey'
  | 'creative_premium'
  | 'rz_navy_cyan'
  | 'export_blue_grid'
  | 'blue_commercial_sheet'
  | 'tally_prime_classic'
  | 'sharma_monogram_sig'
  | 'saffron_grid_box'
  | 'teal_ribbon_freight'
  | 'sleek_tabular_pro'
  | 'sunstar_seal_b2b';

export type PaperFormat = 'A4' | 'A5' | 'thermal_80mm';

export interface InvoiceDesignConfig {
  templateId: InvoiceTemplateId;
  paperFormat: PaperFormat;
  accentColor: string;
  fontFamily: 'sans' | 'display' | 'mono';
  showHsn: boolean;
  showDiscount: boolean;
  showTaxColumns: boolean;
  showBatch: boolean;
  showUpiQr: boolean;
  showBankDetails: boolean;
  showSignature: boolean;
  showStamp: boolean;
  stampText: string;
  showRoundSeal?: boolean;
  signatureMode?: 'drawn' | 'typed' | 'image';
  digitalSignatureText?: string;
}

export interface IndianState {
  code: string;
  name: string;
}

export type WorkspaceRole = 'Stock Keeper' | 'Biller' | 'Salesman' | 'Accountant';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'Admin' | WorkspaceRole | 'Cashier' | 'Inventory Manager';
  permissions?: string[];
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  companyId: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  role: WorkspaceRole;
  permissions: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OtpIntegrationConfig {
  smsProvider: 'builtin' | 'fast2sms' | 'msg91' | 'twilio' | 'custom_webhook';
  smsApiKey?: string;
  smsSenderId?: string;
  smsTemplateId?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  customWebhookUrl?: string;
  emailEnabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  whatsappOtpEnabled: boolean;
  firebasePhoneEnabled: boolean;
  hasSmsApiKey?: boolean;
  hasTwilioAuthToken?: boolean;
  hasSmtpPass?: boolean;
  updatedAt?: string;
}

export interface WhatsAppStatusInfo {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'error';
  qrDataUrl?: string;
  phoneNumber?: string;
  pushName?: string;
  lastError?: string;
  updatedAt: string;
}

export interface CompanySummary {
  id: string;
  companyName: string;
  gstin: string;
  state: string;
  financialYear: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  manager: string;
  isDefault: boolean;
}

export interface AppSettings {
  general: {
    enablePasscode: boolean;
    passcode: string;
    decimalPlaces: number;
    enableGstin: boolean;
    stopNegativeStock: boolean;
    blockNewItemsFromTxn: boolean;
    blockNewPartiesFromTxn: boolean;
    enableEstimate: boolean;
    enableProforma: boolean;
    enableOrders: boolean;
    enableOtherIncome: boolean;
    enableFixedAssets: boolean;
    enableDeliveryChallan: boolean;
    enableGodownTransfer: boolean;
    autoBackup: boolean;
    lastBackupAt?: string;
    auditTrail: boolean;
    zoomPct: number;
    dashboardWidgets?: {
      showQuickActions: boolean;
      showKpis: boolean;
      showRevenueChart: boolean;
      showPendingReminders: boolean;
      showTopProducts: boolean;
      showTopCustomers: boolean;
      showLowStock: boolean;
      showRecentVouchers: boolean;
    };
  };
  transaction: {
    showInvoiceNo: boolean;
    addTimeOnTxn: boolean;
    cashSaleByDefault: boolean;
    billingNameOfParties: boolean;
    customerPoDetails: boolean;
    inclusiveTaxOnRate: boolean;
    displayPurchasePrice: boolean;
    showLast5SalePrice: boolean;
    showLast5PurchasePrice: boolean;
    freeItemQty: boolean;
    showCount: boolean;
    txnWiseTax: boolean;
    txnWiseDiscount: boolean;
    roundOffTotal: boolean;
    roundOffMethod: 'Nearest' | 'Up' | 'Down';
    roundOffTo: number;
    ewayBillNo: boolean;
    quickEntry: boolean;
    hideInvoicePreview: boolean;
    repeatInvoices: boolean;
    txnPasscode: boolean;
    discountDuringPayments: boolean;
    linkPaymentsToInvoices: boolean;
    dueDatesAndTerms: boolean;
    billingType: 'lite' | 'full';
  };
  print: {
    printerMode: 'regular' | 'thermal';
    makeRegularDefault: boolean;
    repeatHeaderAllPages: boolean;
    showCompanyName: boolean;
    showLogo: boolean;
    showAddress: boolean;
    showEmail: boolean;
    showPhone: boolean;
    showGstin: boolean;
    showBalanceAmount: boolean;
    showPartyCurrentBalance: boolean;
    showTaxDetails: boolean;
    showYouSaved: boolean;
    amountGrouping: boolean;
    amountInWords: 'Indian' | 'International';
    showDescription: boolean;
    showTerms: boolean;
    showReceivedBy: boolean;
    showDeliveredBy: boolean;
    showSignatureText: boolean;
    signatureText: string;
    showPaymentMode: boolean;
    showAcknowledgement: boolean;
  };
  gst: {
    enableGst: boolean;
    enableHsnSac: boolean;
    reverseCharge: boolean;
    enablePlaceOfSupply: boolean;
    compositeScheme: boolean;
    enableTcs: boolean;
    enableTds: boolean;
  };
  message: {
    enabled: boolean;
    format: 'pdf' | 'image' | 'both';
    channel: 'app' | 'whatsapp';
    sendToParty: boolean;
    sendTxnUpdate: boolean;
    sendCopyToSelf: boolean;
    autoShareNetwork: boolean;
    includePartyBalance: boolean;
    includeWebLink: boolean;
    includePaymentLink: boolean;
    autoFor: Record<string, boolean>;
    headerText: string;
    footerText: string;
  };
  party: {
    partyGrouping: boolean;
    shippingAddress: boolean;
    printShippingAddress: boolean;
    managePartyStatus: boolean;
    enablePaymentReminder: boolean;
    reminderDueDays: number;
    reminderMessage: string;
    additionalFields: { enabled: boolean; label: string; showInPrint: boolean; dateFormat?: string }[];
    enableLoyaltyPoint: boolean;
  };
  item: {
    enableItem: boolean;
    sellType: 'Product/Service' | 'Product' | 'Service';
    barcodeScan: boolean;
    stockMaintenance: boolean;
    showLowStockDialog: boolean;
    itemsUnit: boolean;
    defaultUnit: string;
    itemCategory: boolean;
    partyWiseRate: boolean;
    description: boolean;
    itemWiseTax: boolean;
    itemWiseDiscount: boolean;
    updateSalePrice: boolean;
    qtyDecimalPlaces: number;
    enableMrp: boolean;
    mrpLabel: string;
    taxOnMrp: boolean;
    enableSerialNo: boolean;
    serialLabel: string;
    enableBatchNo: boolean;
    batchLabel: string;
    enableExpDate: boolean;
    expFormat: string;
    enableMfgDate: boolean;
    mfgFormat: string;
    enableModelNo: boolean;
    enableSize: boolean;
    customFields: string[];
  };
  serviceReminder: {
    enabled: boolean;
    daysBefore: number;
    autoWhatsApp: boolean;
    template: string;
  };
  accounting: {
    doubleEntryAutoPost: boolean;
    lockDate: string;
    multiCurrencyEnabled: boolean;
  };
}

export interface BusinessProfile {
  id: string;
  companyName: string;
  tagline: string;
  gstin: string;
  pan: string;
  state: string;
  address: string;
  phone: string;
  email: string;
  upiId: string;
  financialYear: string;
  signatoryName: string;
  defaultTerms: string;
  logoDataUrl?: string;
  signatureDataUrl?: string;
  digitalSignatureText?: string;
  language?: 'en' | 'hi';
  regionLocale?: 'en-IN' | 'en-US' | 'en-GB' | 'en-AE';
  baseCurrency?: string;
  invoiceConfig: InvoiceDesignConfig;
  prefixes: Record<VoucherType, string>;
  appSettings?: AppSettings;
}

export interface Party {
  id: string;
  name: string;
  type: 'customer' | 'supplier' | 'both';
  phone: string;
  email: string;
  gstin: string;
  pan: string;
  state: string;
  billingAddress: string;
  shippingAddress: string;
  openingBalance: number;
  openingType: 'receivable' | 'payable';
  creditLimit: number;
  creditDays: number;
  group: string;
  riskCategory?: 'Low' | 'Medium' | 'High';
  creditHold?: boolean;
  avgDeliveryDays?: number;
  qualityRating?: number;
  createdAt: string;
}

export interface BatchEntry {
  id: string;
  batchNo: string;
  mfgDate: string;
  expiryDate: string;
  qty: number;
  costPerUnit?: number;
}

export interface Item {
  id: string;
  name: string;
  type: 'product' | 'service';
  sku: string;
  barcode: string;
  hsn: string;
  category: string;
  subcategory?: string;
  unit: string;
  secondaryUnit?: string;
  conversionRate?: number;
  salePrice: number;
  purchasePrice: number;
  mrp: number;
  wholesalePrice: number;
  taxRate: number;
  cessRate: number;
  taxInclusive: boolean;
  openingStock: number;
  stockQty: number;
  minStockAlert: number;
  maxStock?: number;
  leadTimeDays?: number;
  safetyStock?: number;
  binLocation?: string;
  godownId: string;
  godownStock?: Record<string, number>;
  trackBatch: boolean;
  batches: BatchEntry[];
}

export interface Godown {
  id: string;
  branchId?: string;
  name: string;
  location: string;
  manager: string;
  isDefault: boolean;
}

export interface StockTransfer {
  id: string;
  transferNo: string;
  date: string;
  fromGodownId: string;
  toGodownId: string;
  items: { itemId: string; itemName: string; qty: number }[];
  notes: string;
}

export interface StockAdjustment {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  type: 'add' | 'reduce';
  qty: number;
  reason: string;
  costPerUnit: number;
  notes: string;
}

export interface VoucherLine {
  id: string;
  itemId: string;
  itemName: string;
  description?: string;
  hsn: string;
  qty: number;
  unit: string;
  rate: number;
  mrp?: number;
  discountPct: number;
  taxRate: number;
  cessRate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
  batchNo?: string;
  serialNo?: string;
  mfgDate?: string;
  expDate?: string;
  modelNo?: string;
  size?: string;
  customValues?: Record<string, string>;
  newItemMeta?: {
    salePrice?: number;
    mrp?: number;
    category?: string;
    sku?: string;
  };
}

export interface JournalLine {
  id: string;
  accountName: string;
  accountGroup: string;
  debit: number;
  credit: number;
  narration?: string;
}

export interface JournalEntryRecord {
  id: string;
  voucherId?: string;
  date: string;
  voucherNo: string;
  voucherType: VoucherType;
  narration: string;
  lines: JournalLine[];
  createdAt: string;
}

export interface LedgerAccount {
  id: string;
  name: string;
  groupName: string;
  nature: 'Assets' | 'Liabilities' | 'Income' | 'Expenses' | 'Equity';
  openingBalance: number;
  openingType: 'Dr' | 'Cr';
  isSystem: boolean;
}

export interface SettledInvoiceRef {
  voucherId: string;
  voucherNo: string;
  amount: number;
}

export interface Voucher {
  id: string;
  branchId?: string;
  type: VoucherType;
  voucherNo: string;
  date: string;
  dueDate?: string;
  partyId?: string;
  partyName?: string;
  partyGstin?: string;
  placeOfSupply?: string;
  isInterState?: boolean;
  lines: VoucherLine[];
  additionalCharges: number;
  discountTotal: number;
  roundOff: number;
  subTotal: number;
  taxTotal: number;
  grandTotal: number;
  paidAmount: number;
  paymentMode?: PaymentMode;
  bankAccountId?: string;
  splitDetails?: { cash: number; upi: number; card: number };
  status: VoucherStatus;
  linkedVoucherId?: string;
  settledInvoices?: SettledInvoiceRef[];
  ewayBillNo?: string;
  vehicleNo?: string;
  transporterName?: string;
  distanceKm?: number;
  irn?: string;
  isReverseCharge?: boolean;
  isRecurring?: boolean;
  recurringInterval?: 'Monthly' | 'Quarterly' | 'Yearly';
  expenseCategory?: string;
  contraFromId?: string;
  contraToId?: string;
  journalLines?: JournalLine[];
  reconciled?: boolean;
  reconciledDate?: string;
  salesChannel?: SalesChannel;
  costCentreId?: string;
  projectId?: string;
  currency?: string;
  exchangeRate?: number;
  fxGainLoss?: number;
  freightCost?: number;
  insuranceCost?: number;
  customsCost?: number;
  approvalStatus?: ApprovalStatus;
  approvedBy?: string;
  shipmentStatus?: 'Pending' | 'Packed' | 'Dispatched' | 'Delivered';
  trackingNo?: string;
  salesRepName?: string;
  notes?: string;
  terms?: string;
  createdBy?: string;
  createdAt: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  branch: string;
  upiId: string;
  openingBalance: number;
  type: 'bank' | 'cash' | 'od';
}

export interface ChequeEntry {
  id: string;
  chequeNo: string;
  date: string;
  clearanceDate?: string;
  partyId: string;
  partyName: string;
  bankAccountId: string;
  amount: number;
  direction: 'received' | 'issued';
  status: 'pending' | 'cleared' | 'bounced';
  notes: string;
}

export interface LoanAccount {
  id: string;
  lenderName: string;
  accountNo: string;
  principal: number;
  interestRate: number;
  emiAmount: number;
  startDate: string;
  tenureMonths: number;
  paidEmis: number;
  bankAccountId: string;
}

export interface StaffMember {
  id: string;
  empCode?: string;
  name: string;
  role: 'Admin' | 'Cashier' | 'Accountant' | 'Inventory Manager';
  designation?: string;
  department?: string;
  joiningDate?: string;
  employmentType?: 'Full-Time' | 'Contract' | 'Part-Time' | 'Intern';
  phone: string;
  email: string;
  pan?: string;
  uan?: string;
  esicNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  ifsc?: string;
  paymentMode?: 'Bank Transfer' | 'UPI' | 'Cheque' | 'Cash';
  monthlySalary: number;
  hraPct?: number;
  conveyanceAmt?: number;
  allowanceAmt?: number;
  pfDeduction?: number;
  esicDeduction?: number;
  ptDeduction?: number;
  tdsDeduction?: number;
  includePf?: boolean;
  includeEsic?: boolean;
  taxRegime?: 'New' | 'Old';
  ptState?: string;
  attendanceDays?: number;
  lopDays?: number;
  overtimeHours?: number;
  overtimeRate?: number;
  bonusAmt?: number;
  arrearsAmt?: number;
  commissionPct?: number;
  clBalance?: number;
  slBalance?: number;
  elBalance?: number;
  status: 'active' | 'inactive';
  lastPaidMonth?: string;
  permissions: string[];
}

export interface PayrollRunRecord {
  id: string;
  payslipNo: string;
  staffId: string;
  staffName: string;
  empCode: string;
  department: string;
  designation: string;
  month: string;
  payDate: string;
  workingDays: number;
  paidDays: number;
  lopDays: number;
  basic: number;
  hra: number;
  conveyance: number;
  specialAllowance: number;
  overtimePay: number;
  bonus: number;
  commission: number;
  arrears: number;
  reimbursement: number;
  grossEarnings: number;
  employeePf: number;
  employeeEsic: number;
  professionalTax: number;
  tds: number;
  advanceRecovery: number;
  otherDeductions: number;
  totalDeductions: number;
  employerPf: number;
  employerEsic: number;
  netPay: number;
  paymentMode: string;
  bankAccountId?: string;
  status: 'Paid' | 'Processed' | 'Hold';
  notes?: string;
}

export interface EmployeeAdvance {
  id: string;
  staffId: string;
  staffName: string;
  date: string;
  type: 'Salary Advance' | 'Staff Loan';
  amount: number;
  monthlyEmi: number;
  recoveredAmount: number;
  reason: string;
  status: 'Active' | 'Settled';
}

export interface LeaveRequest {
  id: string;
  staffId: string;
  staffName: string;
  leaveType: 'CL' | 'SL' | 'EL' | 'LOP';
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
}

export interface ReimbursementClaim {
  id: string;
  staffId: string;
  staffName: string;
  date: string;
  category: 'Travel' | 'Food' | 'Fuel' | 'Mobile/Internet' | 'Medical' | 'Other';
  amount: number;
  description: string;
  status: 'Pending' | 'Approved' | 'Paid';
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

// --- NEXT-GEN ERP ENTITIES (PART A & B) ---

export interface CostCentre {
  id: string;
  code: string;
  name: string;
  type: 'Department' | 'Branch' | 'Sales Team' | 'Project';
  manager: string;
  budgetLimit: number;
  status: 'active' | 'inactive';
}

export interface BudgetRecord {
  id: string;
  name: string;
  category: string;
  costCentreId?: string;
  period: string;
  budgetType: 'Income' | 'Expense' | 'Purchase' | 'Profit';
  plannedAmount: number;
  notes?: string;
}

export interface FixedAsset {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeYears: number;
  depreciationMethod: 'SLM' | 'WDV';
  depreciationRatePct: number;
  accumulatedDep: number;
  location: string;
  assignedTo: string;
  status: 'Active' | 'Disposed';
  lastDepreciatedDate?: string;
}

export interface BomComponent {
  itemId: string;
  itemName: string;
  qtyPerUnit: number;
  unitCost: number;
}

export interface BomRecipe {
  id: string;
  finishedItemId: string;
  finishedItemName: string;
  sku: string;
  outputQty: number;
  labourCostPerBatch: number;
  overheadCostPerBatch: number;
  components: BomComponent[];
}

export interface ProductionOrder {
  id: string;
  orderNo: string;
  bomId: string;
  finishedItemId: string;
  finishedItemName: string;
  plannedQty: number;
  completedQty: number;
  startDate: string;
  dueDate: string;
  status: 'Planned' | 'In-Progress (WIP)' | 'Completed';
  plannedMaterialCost: number;
  actualMaterialCost: number;
  plannedLabourOverhead: number;
  actualLabourOverhead: number;
  wastagePct: number;
  notes?: string;
}

export interface JobWorkOrder {
  id: string;
  challanNo: string;
  vendorPartyId: string;
  vendorName: string;
  date: string;
  materialSentItemId: string;
  materialSentName: string;
  qtySent: number;
  qtyReceivedBack: number;
  wastageQty: number;
  processingCharge: number;
  status: 'With Job Worker' | 'Partially Received' | 'Completed';
  notes?: string;
}

export interface ProjectJob {
  id: string;
  code: string;
  name: string;
  clientPartyId: string;
  clientName: string;
  costCentreId?: string;
  startDate: string;
  endDate: string;
  contractValue: number;
  materialCost: number;
  labourCost: number;
  overheadCost: number;
  billedAmount: number;
  status: 'Active' | 'Completed' | 'On Hold';
}

export interface WorkflowRule {
  id: string;
  name: string;
  triggerEvent: string;
  conditionText: string;
  actionText: string;
  enabled: boolean;
  executionsCount: number;
  lastTriggeredAt?: string;
}

export interface ApprovalRule {
  id: string;
  documentType: 'sale_invoice' | 'purchase_bill' | 'expense' | 'payment_out' | 'journal' | 'credit_note';
  thresholdAmount: number;
  approverRole: string;
  enabled: boolean;
}

export interface CurrencyRate {
  code: string;
  name: string;
  symbol: string;
  rateToInr: number;
  updatedAt: string;
}

export interface CommissionRule {
  id: string;
  staffId: string;
  staffName: string;
  basis: 'Revenue' | 'Gross Margin';
  ratePct: number;
  monthlyTarget: number;
  bonusOnTarget: number;
}

export interface PricingRule {
  id: string;
  name: string;
  category: string;
  minQty: number;
  discountPct: number;
  targetMarginPct: number;
  channel: SalesChannel | 'All';
  active: boolean;
}

export interface SubscriptionPlan {
  id: string;
  planName: string;
  partyId: string;
  partyName: string;
  amount: number;
  interval: 'Monthly' | 'Quarterly' | 'Yearly';
  nextBillingDate: string;
  status: 'Active' | 'Paused' | 'Cancelled';
  autoRenew: boolean;
}

export interface ComplianceItem {
  id: string;
  title: string;
  category: 'GST' | 'TDS' | 'Income Tax' | 'ROC / Audit' | 'PF / ESI';
  dueDate: string;
  status: 'Upcoming' | 'Prepared' | 'Pending Portal' | 'Filed' | 'Failed' | 'Overdue';
  referenceNo?: string;
  notes?: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  category: 'Vendor Bill' | 'Contract' | 'E-Sign Deed' | 'GST Certificate' | 'Bank Statement';
  linkedVoucherNo?: string;
  uploadedAt: string;
  signedBy?: string;
  signatureHash?: string;
  fileType: string;
  previewText?: string;
}

export interface ApiKeyRecord {
  id: string;
  label: string;
  apiKey: string;
  scopes: string[];
  active: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export interface WebhookRecord {
  id: string;
  event: string;
  targetUrl: string;
  active: boolean;
  lastStatus?: number;
  lastDeliveredAt?: string;
}

export interface CustomReportTemplate {
  id: string;
  name: string;
  dataset: 'vouchers' | 'items' | 'parties' | 'ledgers' | 'expenses';
  columns: string[];
  groupBy: string;
  metricFormula: string;
  chartType: 'bar' | 'table' | 'summary';
  scheduleCron?: string;
  createdAt: string;
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  ipAllowlist: string;
  sessionTimeoutMins: number;
  digitalSignatureSigner: string;
  lastBackupSnapshotAt?: string;
}

export interface AppDatabase {
  user: UserAccount;
  companies: CompanySummary[];
  activeBranchId: string;
  branches: Branch[];
  profile: BusinessProfile;
  parties: Party[];
  items: Item[];
  godowns: Godown[];
  stockTransfers: StockTransfer[];
  stockAdjustments: StockAdjustment[];
  vouchers: Voucher[];
  ledgers: LedgerAccount[];
  journalEntries: JournalEntryRecord[];
  bankAccounts: BankAccount[];
  cheques: ChequeEntry[];
  loans: LoanAccount[];
  staff: StaffMember[];
  auditLogs: AuditLogEntry[];
  // ERP Extensions
  costCentres: CostCentre[];
  budgets: BudgetRecord[];
  fixedAssets: FixedAsset[];
  boms: BomRecipe[];
  productionOrders: ProductionOrder[];
  jobWorks: JobWorkOrder[];
  projects: ProjectJob[];
  workflowRules: WorkflowRule[];
  approvalRules: ApprovalRule[];
  currencyRates: CurrencyRate[];
  commissionRules: CommissionRule[];
  pricingRules: PricingRule[];
  subscriptions: SubscriptionPlan[];
  complianceItems: ComplianceItem[];
  documents: DocumentRecord[];
  apiKeys: ApiKeyRecord[];
  webhooks: WebhookRecord[];
  customReports: CustomReportTemplate[];
  securitySettings: SecuritySettings;
  payrollRuns: PayrollRunRecord[];
  employeeAdvances: EmployeeAdvance[];
  leaveRequests: LeaveRequest[];
  reimbursements: ReimbursementClaim[];
  recycleBin?: RecycleBinEntry[];
  subscription?: SubscriptionRuntimeState;
  workspaceMembers?: WorkspaceMember[];
}

export interface RecycleBinEntry {
  id: string;
  entityType: 'voucher' | 'bank_account';
  entityId: string;
  title: string;
  subtitle: string;
  amount: number;
  deletedBy: string;
  deletedAt: string;
}

export type PortalServerStatus = 'online' | 'degraded' | 'down';

export interface PortalHealthResult {
  id: string;
  name: string;
  url: string;
  category: 'gst' | 'eway' | 'einvoice' | 'verification';
  status: PortalServerStatus;
  httpStatus: number | null;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface GstApiIntegrationConfig {
  gspProvider: string;
  environment: 'sandbox' | 'production';
  authorizedGstin: string;
  apiModeEnabled: boolean;
  updatedAt?: string;
}

export interface GstApiReadiness {
  config: GstApiIntegrationConfig;
  serverCredentials: {
    gstnConfigured: boolean;
    irpConfigured: boolean;
    ewbConfigured: boolean;
  };
}

export interface ScannedInvoiceLine {
  itemName: string;
  description: string;
  hsn: string;
  sku: string;
  qty: number;
  unit: string;
  rate: number;
  mrp: number;
  discountPct: number;
  taxRate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface ScannedInvoiceResult {
  documentType: 'purchase_bill' | 'sale_invoice';
  partyName: string;
  partyGstin: string;
  partyPan: string;
  partyPhone: string;
  partyEmail: string;
  partyAddress: string;
  partyState: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  placeOfSupply: string;
  paymentMode: 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Card';
  reverseCharge: boolean;
  ewayBillNo: string;
  vehicleNo: string;
  transporterName: string;
  lines: ScannedInvoiceLine[];
  additionalCharges: number;
  discountTotal: number;
  roundOff: number;
  subTotal: number;
  taxTotal: number;
  grandTotal: number;
  paidAmount: number;
  notes: string;
  terms: string;
}

export type PlanTier = 'silver' | 'gold' | 'platinum';
export type DeviceScope = 'desktop' | 'desktop_mobile';
export type PlanDuration = '1_year' | '3_years';

export type SubscriptionFeatureKey =
  | 'core_billing'
  | 'payroll'
  | 'operations_erp'
  | 'ocr_bulk_tools'
  | 'gst_portals'
  | 'invoice_designs'
  | 'bulk_print'
  | 'multi_currency';

export interface SubscriptionPlanConfig {
  tier: PlanTier;
  name: string;
  tagline: string;
  priceDesktop1Y: number;
  priceDesktop3Y: number;
  priceCombo1Y: number;
  priceCombo3Y: number;
  features: Record<SubscriptionFeatureKey, boolean>;
  updatedAt?: string;
}

export interface LicenseRecord {
  id: string;
  companyId?: string;
  licenseCode: string;
  invoiceNo: string;
  tier: PlanTier;
  deviceScope: DeviceScope;
  duration: PlanDuration;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  customerName: string;
  phone: string;
  gstin: string;
  paymentMode: PaymentMode;
  paymentRef: string;
  transactionId: string;
  screenshotDataUrl: string;
  status: 'pending_verification' | 'active' | 'deactivated';
  validFrom?: string;
  expiresAt?: string;
  createdAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface SubscriptionRuntimeState {
  trialStartedAt: string;
  trialDaysTotal: number;
  trialDaysLeft: number;
  isTrialExpired: boolean;
  isLicensed: boolean;
  activeTier: 'free_trial' | PlanTier;
  activeScope?: DeviceScope;
  attachedLicense: LicenseRecord | null;
  plans: SubscriptionPlanConfig[];
  invoiceCount: number;
  unlockedFeatures: Record<SubscriptionFeatureKey, boolean>;
  canTransact: boolean;
  ordersForCompany: LicenseRecord[];
}
