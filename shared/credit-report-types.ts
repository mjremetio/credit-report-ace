/**
 * Credit Report Normalized JSON Schema
 *
 * This is the "system of record" structure produced by the parse → normalize pipeline.
 * It captures a tri-merge credit report into a clean, deterministic JSON object
 * that downstream analysis (rule flags, LLM dispute generation) can trust.
 */

// ── Bureau identifiers ──────────────────────────────────────────────
export type Bureau = "TransUnion" | "Experian" | "Equifax";

export const ALL_BUREAUS: Bureau[] = ["TransUnion", "Experian", "Equifax"];

// ── Profile ─────────────────────────────────────────────────────────
export interface BureauScore {
  bureau: Bureau;
  score: number | null;
  model?: string; // e.g. "VantageScore 3.0"
}

export interface PersonalAddress {
  address: string;
  bureaus: Bureau[];
}

export interface PersonalEmployer {
  name: string;
  bureaus: Bureau[];
}

export interface BureauValue {
  bureau: Bureau;
  value: string | null;
}

export interface CreditReportProfile {
  name: string;
  aliases?: string[];
  dateOfBirth?: string;
  dateOfBirthPerBureau?: BureauValue[];
  ssn?: string; // masked, e.g. "XXX-XX-1234"
  reportDate: string; // ISO date the report was pulled
  scores: BureauScore[];
  addresses: PersonalAddress[];
  employers: PersonalEmployer[];
}

// ── Per-Bureau Summary ──────────────────────────────────────────────
export interface BureauSummary {
  bureau: Bureau;
  totalAccounts: number;
  openAccounts: number;
  closedAccounts: number;
  delinquentCount: number;
  derogatoryCount: number;
  collectionsCount: number;
  publicRecordsCount: number;
  inquiriesCount: number;
  balanceTotal?: number;
  creditLimitTotal?: number;
  monthlyPaymentTotal?: number;
}

// ── Tradeline / Account Block ───────────────────────────────────────
export type AccountType =
  | "revolving"
  | "installment"
  | "collection"
  | "mortgage"
  | "student_loan"
  | "auto_loan"
  | "other";

export type AccountStatus =
  | "current"
  | "late"
  | "chargeoff"
  | "collection"
  | "closed"
  | "paid"
  | "settled"
  | "bankruptcy"
  | "repossession"
  | "derogatory"
  | "other";

/** Payment status code in the 24-month grid */
export type PaymentCode =
  | "C"   // Current
  | "30"  // 30 days late
  | "60"  // 60 days late
  | "90"  // 90 days late
  | "120" // 120 days late
  | "150" // 150 days late
  | "CO"  // Charge-off
  | "CL"  // Collection
  | "BK"  // Bankruptcy
  | "--"  // Not reported
  | "?"   // Unknown
  | string; // catch-all for odd bureau codes

export interface PaymentHistoryEntry {
  month: string; // "YYYY-MM"
  code: PaymentCode;
}

export interface TradeBureauDetail {
  bureau: Bureau;
  accountNumber?: string;
  balance?: number | null;
  status?: string;
  dateOpened?: string;
  dateClosed?: string;
  lastPaymentDate?: string;
  lastReportedDate?: string;
  highBalance?: number | null;
  creditLimit?: number | null;
  monthlyPayment?: number | null;
  paymentStatus?: string;
  accountRating?: string;
  creditorType?: string;
  pastDueAmount?: number | null;
  terms?: string;
  paymentHistory?: PaymentHistoryEntry[];
  remarks?: string[];
}

export interface Tradeline {
  creditorName: string;
  accountNumberMasked?: string;
  accountType: AccountType;
  aggregateStatus: AccountStatus; // most severe across bureaus
  originalCreditor?: string;
  balance: number | null;
  bureaus: Bureau[];
  bureauDetails: TradeBureauDetail[];
  dates: {
    opened?: string;
    closed?: string;
    firstDelinquency?: string;  // DOFD
    lastPayment?: string;
    lastReported?: string;
  };
  remarks: string[];          // all distinct remarks across bureaus
  evidenceText: string;       // raw extracted text for this block
}

// ── Public Records ──────────────────────────────────────────────────
export interface PublicRecord {
  type: string;               // "Bankruptcy Chapter 7", "Civil Judgment", etc.
  court?: string;
  caseNumber?: string;
  dateFiled?: string;
  dateDischarged?: string;
  amount?: number | null;
  bureaus: Bureau[];
  remarks: string[];
  evidenceText: string;
}

// ── Inquiries ───────────────────────────────────────────────────────
export interface Inquiry {
  creditorName: string;
  date: string;
  type: "hard" | "soft" | "unknown";
  bureau: Bureau;
  permissiblePurpose?: string;
}

// ── Issue Flags (rule-based, deterministic) ─────────────────────────
export type IssueFlagSeverity = "critical" | "high" | "medium" | "low";

export interface IssueFlag {
  flagType: string;           // e.g. "BUREAU_BALANCE_MISMATCH"
  severity: IssueFlagSeverity;
  creditorName: string;
  description: string;
  bureausAffected: Bureau[];
  evidence: Record<string, string | number | null>; // e.g. { TransUnion: 500, Experian: 0 }
  suggestedDispute?: string;
}

// ── Hierarchical Summary ────────────────────────────────────────────
export interface AccountOneLiner {
  creditorName: string;
  problem: string;
  suggestedAction: string;
}

export interface CategorySummary {
  category: string;           // "Collections", "Bankruptcy-Related", "Late Payments", "Utilization"
  count: number;
  highlights: string[];
}

export interface ActionPlanItem {
  round: number;              // dispute round (1, 2, 3…)
  bureau: Bureau;
  creditorName: string;
  disputeReason: string;
  priority: IssueFlagSeverity;
}

export interface ReportSummary {
  accountOneLiners: AccountOneLiner[];
  categorySummaries: CategorySummary[];
  actionPlan: ActionPlanItem[];
}

// ── Top-Level Parsed Report ─────────────────────────────────────────
export interface ParsedCreditReport {
  profile: CreditReportProfile;
  bureauSummaries: BureauSummary[];
  tradelines: Tradeline[];
  publicRecords: PublicRecord[];
  inquiries: Inquiry[];
  consumerStatements: ConsumerStatement[];
  issueFlags: IssueFlag[];
  summary: ReportSummary;
  metadata: {
    parsedAt: string;           // ISO timestamp
    sourceFileName?: string;
    sourceFileType?: string;
    totalPages?: number;
    parserVersion: string;
  };
}

// ── Consumer Statement ──────────────────────────────────────────────
export interface ConsumerStatement {
  bureau: Bureau;
  statement: string;
  dateAdded?: string;
}

// ── Creditor Contact ───────────────────────────────────────────────
export interface CreditorContact {
  creditorName: string;
  address?: string;
  phone?: string;
  accountNumberMasked?: string;
  accountType: AccountType;
  bureaus: Bureau[];
}

// ── Organized Credit Report JSON ───────────────────────────────────
/**
 * Consumer-facing organized credit report JSON structure.
 * Groups the parsed data into standard credit report sections:
 *   - Credit Scores per Bureau
 *   - Personal Information
 *   - Consumer Statement
 *   - Account Summary
 *   - Account History
 *   - Public Information
 *   - Inquiries
 *   - Collections
 *   - Creditor Contacts
 */
export interface OrganizedCreditReport {
  creditScores: {
    TransUnion: { score: number | null; model?: string } | null;
    Experian: { score: number | null; model?: string } | null;
    Equifax: { score: number | null; model?: string } | null;
  };
  personalInformation: {
    name: string;
    aliases: string[];
    dateOfBirth: string | null;
    dateOfBirthPerBureau: BureauValue[];
    ssn: string | null;
    reportDate: string;
    addresses: PersonalAddress[];
    employers: PersonalEmployer[];
  };
  consumerStatements: ConsumerStatement[];
  accountSummary: {
    totalAccounts: number;
    openAccounts: number;
    closedAccounts: number;
    derogatoryAccounts: number;
    collectionAccounts: number;
    publicRecordCount: number;
    totalBalance: number | null;
    totalCreditLimit: number | null;
    totalMonthlyPayment: number | null;
    perBureau: BureauSummary[];
  };
  accountHistory: Tradeline[];
  publicInformation: PublicRecord[];
  inquiries: Inquiry[];
  collections: Tradeline[];
  creditorContacts: CreditorContact[];
  metadata: {
    parsedAt: string;
    sourceFileName?: string;
    sourceFileType?: string;
    totalPages?: number;
    parserVersion: string;
    organizedAt: string;
  };
}

// ── Extraction schemas (for LLM first-pass output) ──────────────────
/** Shape the LLM must return during the extraction pass */
export interface LLMExtractionBlock {
  blockType: "profile" | "tradeline" | "public_record" | "inquiry" | "summary";
  raw: unknown; // the specific extraction shape depends on blockType
}

export interface LLMProfileExtraction {
  name: string;
  aliases?: string[];
  dateOfBirth?: string;
  dateOfBirthPerBureau?: Array<{ bureau: string; value: string | null }>;
  ssn?: string;
  reportDate?: string;
  scores?: Array<{ bureau: string; score: number | null; model?: string }>;
  addresses?: Array<{ address: string; bureaus: string[] }>;
  employers?: Array<{ name: string; bureaus: string[] }>;
}

export interface LLMTradelineExtraction {
  creditorName: string;
  accountNumberMasked?: string;
  accountType?: string;
  status?: string;
  originalCreditor?: string;
  balance?: number | null;
  bureaus?: string[];
  bureauDetails?: Array<{
    bureau: string;
    accountNumber?: string;
    balance?: number | null;
    status?: string;
    dateOpened?: string;
    dateClosed?: string;
    lastPaymentDate?: string;
    lastReportedDate?: string;
    highBalance?: number | null;
    creditLimit?: number | null;
    monthlyPayment?: number | null;
    paymentStatus?: string;
    accountRating?: string;
    creditorType?: string;
    pastDueAmount?: number | null;
    terms?: string;
    paymentHistory?: Array<{ month: string; code: string }>;
    remarks?: string[];
  }>;
  dates?: {
    opened?: string;
    closed?: string;
    firstDelinquency?: string;
    lastPayment?: string;
    lastReported?: string;
  };
  remarks?: string[];
}

export interface LLMPublicRecordExtraction {
  type: string;
  court?: string;
  caseNumber?: string;
  dateFiled?: string;
  dateDischarged?: string;
  amount?: number | null;
  bureaus?: string[];
  remarks?: string[];
}

export interface LLMInquiryExtraction {
  creditorName: string;
  date: string;
  type?: string;
  bureau: string;
  permissiblePurpose?: string;
}

export interface LLMBureauSummaryExtraction {
  bureau: string;
  totalAccounts?: number;
  openAccounts?: number;
  closedAccounts?: number;
  delinquentCount?: number;
  derogatoryCount?: number;
  collectionsCount?: number;
  publicRecordsCount?: number;
  inquiriesCount?: number;
  balanceTotal?: number;
  creditLimitTotal?: number;
  monthlyPaymentTotal?: number;
}

export interface LLMConsumerStatementExtraction {
  bureau: string;
  statement: string;
  dateAdded?: string;
}
