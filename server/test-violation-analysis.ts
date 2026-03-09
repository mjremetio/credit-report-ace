/**
 * Comprehensive Violation Analysis Test
 *
 * Tests the deterministic issue flag engine (issue-flags.ts) and the AI prompt
 * builder (ai-services.ts) to verify that:
 *
 * 1. All existing violation rules fire correctly on known-bad data
 * 2. New rules (payment history cross-bureau, high balance mismatch,
 *    account rating/status conflict, last reported mismatch) work
 * 3. Rules do NOT fire on clean data (no false positives)
 * 4. Edge cases are handled (single bureau, missing fields, etc.)
 * 5. AI system prompt correctly integrates training data
 * 6. Cross-bureau diff builder captures all discrepancies
 */

import { computeIssueFlags } from "./issue-flags";
import { buildSystemPrompt } from "./ai-services";
import type { ParsedCreditReport, Tradeline, TradeBureauDetail, Bureau, IssueFlag } from "@shared/credit-report-types";
import type { NegativeAccount, ViolationPattern, FcraTrainingExample } from "@shared/schema";

// ── Test infrastructure ─────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function hasFlag(flags: IssueFlag[], flagType: string, creditor?: string): boolean {
  return flags.some(f =>
    f.flagType === flagType &&
    (!creditor || f.creditorName.toLowerCase().includes(creditor.toLowerCase()))
  );
}

function flagCount(flags: IssueFlag[], flagType: string): number {
  return flags.filter(f => f.flagType === flagType).length;
}

// ── Mock builders ───────────────────────────────────────────────

function buildReport(tradelines: Tradeline[]): ParsedCreditReport {
  return {
    profile: {
      name: "TEST CONSUMER",
      reportDate: "2026-03-01",
      scores: [],
      addresses: [],
      employers: [],
    },
    bureauSummaries: [],
    tradelines,
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
    issueFlags: [],
    summary: { accountOneLiners: [], categorySummaries: [], actionPlan: [] },
    metadata: {
      parsedAt: new Date().toISOString(),
      parserVersion: "test",
    },
  };
}

function makeBureauDetail(bureau: Bureau, overrides: Partial<TradeBureauDetail> = {}): TradeBureauDetail {
  return {
    bureau,
    balance: 1000,
    status: "Open",
    dateOpened: "2020-01",
    lastReportedDate: "2026-02",
    highBalance: 2000,
    creditLimit: 5000,
    monthlyPayment: 50,
    pastDueAmount: 0,
    paymentHistory: [],
    remarks: [],
    ...overrides,
  };
}

function makeTradeline(overrides: Partial<Tradeline> = {}): Tradeline {
  return {
    creditorName: "TEST BANK",
    accountType: "revolving",
    aggregateStatus: "current",
    balance: 1000,
    bureaus: ["TransUnion", "Experian", "Equifax"],
    bureauDetails: [
      makeBureauDetail("TransUnion"),
      makeBureauDetail("Experian"),
      makeBureauDetail("Equifax"),
    ],
    dates: { opened: "2020-01", lastPayment: "2026-01", lastReported: "2026-02" },
    remarks: [],
    evidenceText: "",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// TEST SUITE 1: Existing Rules Regression Tests
// ══════════════════════════════════════════════════════════════════

function testCleanAccountProducesNoFlags() {
  console.log("\n=== TEST: Clean account produces no violation flags ===\n");

  const tl = makeTradeline();
  const report = buildReport([tl]);
  const flags = computeIssueFlags(report);

  assert(flags.length === 0, `No flags on clean account (got ${flags.length})`);
}

function testBalanceMismatchCrossBureau() {
  console.log("\n=== TEST: Balance mismatch across bureaus ===\n");

  const tl = makeTradeline({
    creditorName: "MERRICK BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", { balance: 3200 }),
      makeBureauDetail("Experian", { balance: 2800 }),
      makeBureauDetail("Equifax", { balance: 3200 }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "BUREAU_BALANCE_MISMATCH", "MERRICK"), "Balance mismatch flagged");
  const f = flags.find(f => f.flagType === "BUREAU_BALANCE_MISMATCH")!;
  assert(f.severity === "high", "Severity is high");
  assert(f.evidence.TransUnion === 3200, "Evidence shows TU balance");
  assert(f.evidence.Experian === 2800, "Evidence shows EX balance");
}

function testBalanceStatusContradiction() {
  console.log("\n=== TEST: Balance-status contradiction (paid but non-zero) ===\n");

  const tl = makeTradeline({
    creditorName: "PORTFOLIO RECOVERY",
    accountType: "collection",
    aggregateStatus: "paid",
    bureauDetails: [
      makeBureauDetail("TransUnion", { balance: 0, status: "Paid Collection" }),
      makeBureauDetail("Experian", { balance: 450, status: "Paid" }),
      makeBureauDetail("Equifax", { balance: 0, status: "Paid Collection" }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "BALANCE_STATUS_CONTRADICTION", "PORTFOLIO"), "Balance-status contradiction flagged");
  const f = flags.find(f => f.flagType === "BALANCE_STATUS_CONTRADICTION")!;
  assert(f.severity === "critical", "Severity is critical");
  assert(f.description.includes("$450"), "Description mentions the balance");
}

function testChargeoffBalanceIncreasing() {
  console.log("\n=== TEST: Charge-off balance exceeds high balance ===\n");

  const tl = makeTradeline({
    creditorName: "BAD BANK",
    aggregateStatus: "chargeoff",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        balance: 5500,
        highBalance: 4800,
        status: "Charge-Off",
      }),
    ],
    bureaus: ["TransUnion"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "CHARGEOFF_BALANCE_INCREASING", "BAD BANK"), "Charge-off balance increasing flagged");
}

function testCreditorTypeMismatch() {
  console.log("\n=== TEST: Creditor type mismatch across bureaus ===\n");

  const tl = makeTradeline({
    creditorName: "MERRICK BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", { creditorType: "Bank Credit Cards" }),
      makeBureauDetail("Experian", { creditorType: "Bank Credit Cards" }),
      makeBureauDetail("Equifax", { creditorType: "Miscellaneous Finance" }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "BUREAU_CREDITOR_TYPE_MISMATCH", "MERRICK"), "Creditor type mismatch flagged");
}

function testDateOpenedMismatch() {
  console.log("\n=== TEST: Date opened mismatch across bureaus ===\n");

  const tl = makeTradeline({
    creditorName: "MCM",
    bureauDetails: [
      makeBureauDetail("TransUnion", { dateOpened: "2023-01" }),
      makeBureauDetail("Experian", { dateOpened: "2023-02" }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "DATE_OPENED_MISMATCH", "MCM"), "Date opened mismatch flagged");
}

function testObsoleteReporting() {
  console.log("\n=== TEST: Obsolete reporting (>7 years) ===\n");

  const tl = makeTradeline({
    creditorName: "OLD DEBT CO",
    aggregateStatus: "collection",
    accountType: "collection",
    dates: { firstDelinquency: "2018-01-01" }, // > 7 years from 2026-03
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "OBSOLETE_REPORTING", "OLD DEBT"), "Obsolete reporting flagged");
  const f = flags.find(f => f.flagType === "OBSOLETE_REPORTING")!;
  assert(f.severity === "critical", "Severity is critical for obsolete");
}

function testMissingOriginalCreditor() {
  console.log("\n=== TEST: Missing original creditor on collection ===\n");

  const tl = makeTradeline({
    creditorName: "PORTFOLIO RECOVERY",
    accountType: "collection",
    aggregateStatus: "collection",
    // originalCreditor is NOT set
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "MISSING_ORIGINAL_CREDITOR", "PORTFOLIO"), "Missing original creditor flagged");
}

function testMissingOriginalCreditorNotFiredWhenPresent() {
  console.log("\n=== TEST: No missing OC flag when original creditor is present ===\n");

  const tl = makeTradeline({
    creditorName: "MCM",
    accountType: "collection",
    aggregateStatus: "collection",
    originalCreditor: "CAPITAL ONE",
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(!hasFlag(flags, "MISSING_ORIGINAL_CREDITOR", "MCM"), "No missing OC flag when OC is present");
}

function testMissingCreditLimit() {
  console.log("\n=== TEST: Missing credit limit on revolving account ===\n");

  const tl = makeTradeline({
    creditorName: "DISCOVER",
    accountType: "revolving",
    bureauDetails: [
      makeBureauDetail("TransUnion", { balance: 2000, creditLimit: null }),
      makeBureauDetail("Experian", { balance: 2000, creditLimit: 5000 }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "MISSING_CREDIT_LIMIT", "DISCOVER"), "Missing credit limit flagged");
}

function testLatePaymentHistory() {
  console.log("\n=== TEST: Late payment history detection ===\n");

  const tl = makeTradeline({
    creditorName: "WELLS FARGO",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        paymentHistory: [
          { month: "2025-12", code: "C" },
          { month: "2025-11", code: "30" },
          { month: "2025-10", code: "C" },
        ],
      }),
    ],
    bureaus: ["TransUnion"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "LATE_PAYMENT_HISTORY", "WELLS FARGO"), "Late payment history flagged");
}

function testDerogatoryStacking() {
  console.log("\n=== TEST: Derogatory stacking (4+ consecutive lates) ===\n");

  const tl = makeTradeline({
    creditorName: "STACKED BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        paymentHistory: [
          { month: "2025-06", code: "CO" },
          { month: "2025-05", code: "90" },
          { month: "2025-04", code: "60" },
          { month: "2025-03", code: "30" },
          { month: "2025-02", code: "C" },
        ],
      }),
    ],
    bureaus: ["TransUnion"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "DEROGATORY_STACKING", "STACKED"), "Derogatory stacking flagged");
}

function testDebtCollectorFlags() {
  console.log("\n=== TEST: Debt collector violation flags ===\n");

  const tl = makeTradeline({
    creditorName: "MIDLAND CREDIT MANAGEMENT",
    accountType: "collection",
    aggregateStatus: "collection",
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "DEBT_COLLECTOR_ACCOUNT", "MIDLAND"), "Debt collector account flagged");
  assert(hasFlag(flags, "DEBT_COLLECTOR_DISCLOSURE_CHECK", "MIDLAND"), "Disclosure check flagged");
  assert(hasFlag(flags, "CEASE_CONTACT_INVESTIGATION", "MIDLAND"), "Cease contact investigation flagged");
}

function testCaliforniaLicenseCheck() {
  console.log("\n=== TEST: California license number check (CA client) ===\n");

  const tl = makeTradeline({
    creditorName: "CA COLLECTIONS",
    accountType: "collection",
    aggregateStatus: "collection",
  });
  const flags = computeIssueFlags(buildReport([tl]), "CA");

  assert(hasFlag(flags, "CA_LICENSE_NUMBER_CHECK", "CA COLLECTIONS"), "CA license check flagged for CA client");
}

function testCaliforniaLicenseNotFiredForNonCA() {
  console.log("\n=== TEST: No CA license flag for non-CA client ===\n");

  const tl = makeTradeline({
    creditorName: "CA COLLECTIONS",
    accountType: "collection",
    aggregateStatus: "collection",
  });
  const flags = computeIssueFlags(buildReport([tl]), "TX");

  assert(!hasFlag(flags, "CA_LICENSE_NUMBER_CHECK"), "No CA license flag for TX client");
}

function testDisputeRemarkInconsistency() {
  console.log("\n=== TEST: Dispute remark inconsistency across bureaus ===\n");

  const tl = makeTradeline({
    creditorName: "DISPUTED BANK",
    remarks: ["Account disputed by consumer"],
    bureauDetails: [
      makeBureauDetail("TransUnion", { remarks: ["Account disputed by consumer"] }),
      makeBureauDetail("Experian", { remarks: [] }),
      makeBureauDetail("Equifax", { remarks: ["Account disputed by consumer"] }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "DISPUTE_INCONSISTENCY_ACROSS_BUREAUS", "DISPUTED"), "Dispute inconsistency flagged");
}

function testBankruptcyWithBalance() {
  console.log("\n=== TEST: Bankruptcy remark with balance > $0 ===\n");

  const tl = makeTradeline({
    creditorName: "BK ACCOUNT",
    remarks: ["Included in Chapter 7 Bankruptcy"],
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        balance: 5000,
        remarks: ["Included in Chapter 7 Bankruptcy"],
      }),
    ],
    bureaus: ["TransUnion"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "BALANCE_POST_BANKRUPTCY", "BK ACCOUNT"), "Post-bankruptcy balance flagged");
  const f = flags.find(f => f.flagType === "BALANCE_POST_BANKRUPTCY")!;
  assert(f.severity === "critical", "Severity is critical for post-BK balance");
}

function testPaymentGridStatusConflict() {
  console.log("\n=== TEST: Payment grid vs status conflict ===\n");

  const tl = makeTradeline({
    creditorName: "CONFLICT BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        status: "Collection",
        paymentHistory: [
          { month: "2026-01", code: "C" },
          { month: "2025-12", code: "C" },
          { month: "2025-11", code: "C" },
          { month: "2025-10", code: "C" },
          { month: "2025-09", code: "C" },
          { month: "2025-08", code: "C" },
        ],
      }),
    ],
    bureaus: ["TransUnion"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "PAYMENT_GRID_STATUS_CONFLICT", "CONFLICT"), "Payment grid vs status conflict flagged");
}

// ══════════════════════════════════════════════════════════════════
// TEST SUITE 2: NEW Rules
// ══════════════════════════════════════════════════════════════════

function testPaymentHistoryCrossBureauMismatch() {
  console.log("\n=== TEST: Payment history cross-bureau mismatch ===\n");

  const tl = makeTradeline({
    creditorName: "PAYMENT MISMATCH BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        paymentHistory: [
          { month: "2025-11", code: "C" },
          { month: "2025-10", code: "C" },
          { month: "2025-09", code: "C" },
        ],
      }),
      makeBureauDetail("Experian", {
        paymentHistory: [
          { month: "2025-11", code: "C" },
          { month: "2025-10", code: "30" }, // Different from TU!
          { month: "2025-09", code: "C" },
        ],
      }),
      makeBureauDetail("Equifax", {
        paymentHistory: [
          { month: "2025-11", code: "30" }, // Different from TU!
          { month: "2025-10", code: "C" },
          { month: "2025-09", code: "C" },
        ],
      }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "PAYMENT_HISTORY_CROSS_BUREAU_MISMATCH", "PAYMENT MISMATCH"), "Payment history cross-bureau mismatch flagged");
  const f = flags.find(f => f.flagType === "PAYMENT_HISTORY_CROSS_BUREAU_MISMATCH")!;
  assert(f.severity === "high", "Severity is high");
  assert(f.description.includes("2025-10") || f.description.includes("2025-11"), "Description mentions mismatched month");
}

function testPaymentHistoryNoFalsePositiveWhenSameLateCodes() {
  console.log("\n=== TEST: No false positive when all bureaus report same late codes ===\n");

  const tl = makeTradeline({
    creditorName: "CONSISTENT LATE BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        paymentHistory: [
          { month: "2025-11", code: "30" },
          { month: "2025-10", code: "C" },
        ],
      }),
      makeBureauDetail("Experian", {
        paymentHistory: [
          { month: "2025-11", code: "30" },
          { month: "2025-10", code: "C" },
        ],
      }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(!hasFlag(flags, "PAYMENT_HISTORY_CROSS_BUREAU_MISMATCH"), "No cross-bureau payment mismatch when codes are identical");
}

function testPaymentHistoryNoFalsePositiveMinorDiffs() {
  console.log("\n=== TEST: No false positive for minor late-code differences (30 vs 60) ===\n");

  // Only flag when there's a severity difference (C vs 30), not 30 vs 60
  const tl = makeTradeline({
    creditorName: "MINOR DIFF BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        paymentHistory: [
          { month: "2025-11", code: "30" },
        ],
      }),
      makeBureauDetail("Experian", {
        paymentHistory: [
          { month: "2025-11", code: "60" },
        ],
      }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  // 30 vs 60 — both are late, just different severity. The current rule only flags C vs late.
  assert(!hasFlag(flags, "PAYMENT_HISTORY_CROSS_BUREAU_MISMATCH"), "No flag for 30 vs 60 (both late)");
}

function testHighBalanceMismatch() {
  console.log("\n=== TEST: High balance mismatch across bureaus ===\n");

  const tl = makeTradeline({
    creditorName: "HIGH BAL BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", { highBalance: 5000 }),
      makeBureauDetail("Experian", { highBalance: 5000 }),
      makeBureauDetail("Equifax", { highBalance: 4200 }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "BUREAU_HIGH_BALANCE_MISMATCH", "HIGH BAL"), "High balance mismatch flagged");
  const f = flags.find(f => f.flagType === "BUREAU_HIGH_BALANCE_MISMATCH")!;
  assert(f.severity === "medium", "Severity is medium");
}

function testHighBalanceNoFalsePositive() {
  console.log("\n=== TEST: No high balance flag when all bureaus match ===\n");

  const tl = makeTradeline({
    creditorName: "MATCHING BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", { highBalance: 5000 }),
      makeBureauDetail("Experian", { highBalance: 5000 }),
      makeBureauDetail("Equifax", { highBalance: 5000 }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(!hasFlag(flags, "BUREAU_HIGH_BALANCE_MISMATCH"), "No high balance mismatch when matching");
}

function testAccountRatingStatusConflictCurrentVsChargeoff() {
  console.log("\n=== TEST: Account rating/status conflict — rating current, status charge-off ===\n");

  const tl = makeTradeline({
    creditorName: "RATING CONFLICT BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        accountRating: "Open/Current",
        status: "Charge-Off",
      }),
    ],
    bureaus: ["TransUnion"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "ACCOUNT_RATING_STATUS_CONFLICT", "RATING CONFLICT"), "Rating vs status conflict flagged");
  const f = flags.find(f => f.flagType === "ACCOUNT_RATING_STATUS_CONFLICT")!;
  assert(f.severity === "high", "Severity is high");
}

function testAccountRatingStatusConflictDerogVsPaid() {
  console.log("\n=== TEST: Account rating/status conflict — rating charge-off, status paid ===\n");

  const tl = makeTradeline({
    creditorName: "PAID BUT RATED BAD",
    bureauDetails: [
      makeBureauDetail("Experian", {
        accountRating: "9 - Charge Off",
        status: "Paid",
      }),
    ],
    bureaus: ["Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "ACCOUNT_RATING_STATUS_CONFLICT", "PAID BUT RATED"), "Rating derog vs status paid flagged");
}

function testAccountRatingStatusNoFalsePositive() {
  console.log("\n=== TEST: No rating/status conflict when consistent ===\n");

  const tl = makeTradeline({
    creditorName: "CONSISTENT BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        accountRating: "Open/Current",
        status: "Open",
      }),
      makeBureauDetail("Experian", {
        accountRating: "9 - Charge Off",
        status: "Charge-Off",
      }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(!hasFlag(flags, "ACCOUNT_RATING_STATUS_CONFLICT"), "No rating/status conflict when consistent");
}

function testLastReportedDateMismatch() {
  console.log("\n=== TEST: Last reported date mismatch (>2 months apart) ===\n");

  const tl = makeTradeline({
    creditorName: "STALE REPORT BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", { lastReportedDate: "2026-02" }),
      makeBureauDetail("Experian", { lastReportedDate: "2025-10" }), // 4 months behind
      makeBureauDetail("Equifax", { lastReportedDate: "2026-01" }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(hasFlag(flags, "LAST_REPORTED_DATE_MISMATCH", "STALE REPORT"), "Last reported date mismatch flagged");
  const f = flags.find(f => f.flagType === "LAST_REPORTED_DATE_MISMATCH")!;
  assert(f.severity === "low", "Severity is low");
}

function testLastReportedNoFalsePositiveSmallDiff() {
  console.log("\n=== TEST: No last reported flag for 1-month difference ===\n");

  const tl = makeTradeline({
    creditorName: "NORMAL LAG BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", { lastReportedDate: "2026-02" }),
      makeBureauDetail("Experian", { lastReportedDate: "2026-01" }), // 1 month lag is normal
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(!hasFlag(flags, "LAST_REPORTED_DATE_MISMATCH"), "No flag for 1-month reporting lag");
}

// ══════════════════════════════════════════════════════════════════
// TEST SUITE 3: Edge Cases
// ══════════════════════════════════════════════════════════════════

function testSingleBureauNoMismatchFlags() {
  console.log("\n=== TEST: Single bureau account produces no cross-bureau flags ===\n");

  const tl = makeTradeline({
    creditorName: "SINGLE BUREAU CO",
    bureaus: ["TransUnion"],
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        balance: 1000,
        highBalance: 2000,
        creditLimit: 5000,
        status: "Open",
      }),
    ],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  const crossBureauFlags = flags.filter(f =>
    f.flagType.includes("MISMATCH") || f.flagType.includes("CROSS_BUREAU")
  );
  assert(crossBureauFlags.length === 0, `No cross-bureau flags for single-bureau account (got ${crossBureauFlags.length})`);
}

function testEmptyPaymentHistoryNoFlags() {
  console.log("\n=== TEST: Empty payment history produces no payment flags ===\n");

  const tl = makeTradeline({
    creditorName: "NO HISTORY BANK",
    bureauDetails: [
      makeBureauDetail("TransUnion", { paymentHistory: [] }),
      makeBureauDetail("Experian", { paymentHistory: [] }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([tl]));

  assert(!hasFlag(flags, "LATE_PAYMENT_HISTORY"), "No late payment flag with empty history");
  assert(!hasFlag(flags, "PAYMENT_HISTORY_CROSS_BUREAU_MISMATCH"), "No cross-bureau payment flag with empty history");
  assert(!hasFlag(flags, "DEROGATORY_STACKING"), "No stacking flag with empty history");
}

function testNullFieldsDoNotCrash() {
  console.log("\n=== TEST: Null/undefined fields don't crash ===\n");

  const tl = makeTradeline({
    creditorName: "NULL FIELDS CO",
    bureauDetails: [
      makeBureauDetail("TransUnion", {
        balance: null,
        highBalance: null,
        creditLimit: null,
        status: undefined,
        accountRating: undefined,
        paymentHistory: undefined,
        lastReportedDate: undefined,
        remarks: undefined,
      }),
      makeBureauDetail("Experian", {
        balance: null,
        highBalance: null,
        creditLimit: null,
      }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });

  // Should not throw
  let flags: IssueFlag[] = [];
  try {
    flags = computeIssueFlags(buildReport([tl]));
    assert(true, "No crash with null/undefined fields");
  } catch (e: any) {
    assert(false, `Crashed with null fields: ${e.message}`);
  }
}

function testMultipleTradelinesIsolated() {
  console.log("\n=== TEST: Flags are per-tradeline (no cross-contamination) ===\n");

  const cleanTl = makeTradeline({ creditorName: "CLEAN BANK" });
  const dirtyTl = makeTradeline({
    creditorName: "DIRTY BANK",
    accountType: "collection",
    aggregateStatus: "collection",
    bureauDetails: [
      makeBureauDetail("TransUnion", { balance: 1000 }),
      makeBureauDetail("Experian", { balance: 500 }),
    ],
    bureaus: ["TransUnion", "Experian"],
  });
  const flags = computeIssueFlags(buildReport([cleanTl, dirtyTl]));

  const cleanFlags = flags.filter(f => f.creditorName === "CLEAN BANK");
  const dirtyFlags = flags.filter(f => f.creditorName === "DIRTY BANK");

  assert(cleanFlags.length === 0, `Clean account has 0 flags (got ${cleanFlags.length})`);
  assert(dirtyFlags.length > 0, `Dirty account has flags (got ${dirtyFlags.length})`);
}

// ══════════════════════════════════════════════════════════════════
// TEST SUITE 4: AI System Prompt Integration
// ══════════════════════════════════════════════════════════════════

function mockNegativeAccount(overrides: Partial<NegativeAccount> = {}): NegativeAccount {
  return {
    id: 1,
    scanId: 1,
    creditor: "TEST COLLECTION",
    accountNumber: "TC****1234",
    accountType: "debt_collection",
    originalCreditor: "ORIGINAL BANK",
    balance: "2500",
    status: "Collection",
    dateOpened: "2023-01",
    dateOfDelinquency: "2022-09",
    bureaus: "TransUnion, Experian",
    rawDetails: null,
    workflowStep: "scanned",
    createdAt: new Date(),
    ...overrides,
  } as NegativeAccount;
}

function testSystemPromptContainsNewRules() {
  console.log("\n=== TEST: System prompt contains new violation rules ===\n");

  const account = mockNegativeAccount();
  const prompt = buildSystemPrompt(account);

  assert(prompt.includes("PAYMENT_HISTORY_MISMATCH_CROSS_BUREAU"), "Prompt mentions payment history cross-bureau rule");
  assert(prompt.includes("HIGH_BALANCE_MISMATCH_CROSS_BUREAU"), "Prompt mentions high balance mismatch rule");
  assert(prompt.includes("ACCOUNT_RATING_STATUS_CONFLICT"), "Prompt mentions account rating/status conflict rule");
  assert(prompt.includes("Compare month-by-month payment codes"), "Prompt includes payment history analysis guidance");
}

function testCompactPromptForRuleFlaggedAccounts() {
  console.log("\n=== TEST: Compact prompt used for accounts with pre-computed flags ===\n");

  const account = mockNegativeAccount({
    rawDetails: JSON.stringify({
      account: { creditor: "TEST" },
      ruleBasedFlags: [{ type: "BUREAU_BALANCE_MISMATCH", severity: "high" }],
    }),
  });
  const prompt = buildSystemPrompt(account);

  assert(prompt.includes("ALREADY been processed"), "Uses compact prompt");
  assert(!prompt.includes("ANALYSIS CHECKLIST"), "Does not contain full checklist");
}

function testTrainingDataInjectsCrossBureauGuidance() {
  console.log("\n=== TEST: Training data with cross-bureau patterns ===\n");

  const account = mockNegativeAccount();
  const patterns: ViolationPattern[] = [
    {
      id: 1,
      violationType: "Payment History Cross-Bureau Mismatch",
      matchedRule: "PAYMENT_HISTORY_MISMATCH_CROSS_BUREAU",
      category: "FCRA_REPORTING",
      severity: "high",
      accountType: "debt_collection",
      creditorPattern: null,
      evidencePattern: "TU shows C for 2025-10, EX shows 30",
      fcraStatute: "§1681e(b)",
      confidence: "confirmed",
      timesConfirmed: 12,
      timesRejected: 0,
      lastConfirmedAt: new Date(),
      createdAt: new Date(),
    } as ViolationPattern,
  ];

  const prompt = buildSystemPrompt(account, patterns);

  assert(prompt.includes("LEARNED VIOLATION PATTERNS"), "Training patterns section present");
  assert(prompt.includes("Payment History Cross-Bureau Mismatch"), "Cross-bureau pattern injected");
  assert(prompt.includes("HIGH CONFIDENCE"), "Marked as high confidence");
}

// ══════════════════════════════════════════════════════════════════
// TEST SUITE 5: Comprehensive Integration Test
// ══════════════════════════════════════════════════════════════════

function testFullReportIntegration() {
  console.log("\n=== TEST: Full report integration — multiple accounts with various violations ===\n");

  const tradelines: Tradeline[] = [
    // 1. Clean account — should produce no flags
    makeTradeline({ creditorName: "CHASE BANK" }),

    // 2. Charge-off with cross-bureau issues
    makeTradeline({
      creditorName: "MERRICK BANK",
      accountType: "revolving",
      aggregateStatus: "chargeoff",
      balance: 3200,
      bureauDetails: [
        makeBureauDetail("TransUnion", {
          balance: 3200, status: "Charge-Off", highBalance: 4800, creditLimit: 5000,
          creditorType: "Bank Credit Cards", dateOpened: "2018-03", accountRating: "9 - Charge Off",
          lastReportedDate: "2026-01",
          paymentHistory: [
            { month: "2022-06", code: "CO" }, { month: "2022-05", code: "60" },
            { month: "2022-04", code: "30" }, { month: "2022-03", code: "C" },
          ],
        }),
        makeBureauDetail("Experian", {
          balance: 2800, status: "Charge-Off", highBalance: 4800, creditLimit: 5000,
          creditorType: "Bank Credit Cards", dateOpened: "2018-03", accountRating: "9 - Charge Off",
          lastReportedDate: "2025-10", // 3 months behind TU
          paymentHistory: [
            { month: "2022-06", code: "CO" }, { month: "2022-05", code: "60" },
            { month: "2022-04", code: "30" }, { month: "2022-03", code: "30" }, // differs from TU
          ],
        }),
        makeBureauDetail("Equifax", {
          balance: 3200, status: "Charged Off", highBalance: 3800, creditLimit: null,
          creditorType: "Miscellaneous Finance", dateOpened: "2018-04",
          accountRating: "9 - Charge Off", lastReportedDate: "2026-01",
          paymentHistory: [
            { month: "2022-06", code: "CO" }, { month: "2022-05", code: "90" },
            { month: "2022-04", code: "60" }, { month: "2022-03", code: "30" },
          ],
        }),
      ],
      dates: { opened: "2018-03", firstDelinquency: "2022-06" },
    }),

    // 3. Collection with paid-but-balance and missing OC
    makeTradeline({
      creditorName: "PORTFOLIO RECOVERY",
      accountType: "collection",
      aggregateStatus: "paid",
      balance: 0,
      bureauDetails: [
        makeBureauDetail("TransUnion", { balance: 0, status: "Paid Collection" }),
        makeBureauDetail("Experian", { balance: 450, status: "Paid" }),
        makeBureauDetail("Equifax", { balance: 0, status: "Paid Collection" }),
      ],
      dates: { opened: "2021-06", firstDelinquency: "2020-11" },
    }),

    // 4. Account with rating/status conflict
    makeTradeline({
      creditorName: "CONFLICTING BANK",
      bureauDetails: [
        makeBureauDetail("TransUnion", {
          accountRating: "Open/Current",
          status: "Collection",
        }),
      ],
      bureaus: ["TransUnion"],
    }),
  ];

  const report = buildReport(tradelines);
  const flags = computeIssueFlags(report);

  // Chase — clean
  const chaseFlags = flags.filter(f => f.creditorName === "CHASE BANK");
  assert(chaseFlags.length === 0, `Chase has 0 flags (got ${chaseFlags.length})`);

  // Merrick — should have multiple flags
  assert(hasFlag(flags, "BUREAU_BALANCE_MISMATCH", "MERRICK"), "Merrick: balance mismatch");
  assert(hasFlag(flags, "BUREAU_CREDITOR_TYPE_MISMATCH", "MERRICK"), "Merrick: creditor type mismatch");
  assert(hasFlag(flags, "DATE_OPENED_MISMATCH", "MERRICK"), "Merrick: date opened mismatch");
  assert(hasFlag(flags, "CHARGEOFF_PRESENT", "MERRICK"), "Merrick: charge-off present");
  assert(hasFlag(flags, "MISSING_CREDIT_LIMIT", "MERRICK"), "Merrick: missing credit limit (EQ)");
  assert(hasFlag(flags, "BUREAU_HIGH_BALANCE_MISMATCH", "MERRICK"), "Merrick: high balance mismatch (TU/EX=4800, EQ=3800)");
  assert(hasFlag(flags, "PAYMENT_HISTORY_CROSS_BUREAU_MISMATCH", "MERRICK"), "Merrick: payment history cross-bureau mismatch");
  assert(hasFlag(flags, "LAST_REPORTED_DATE_MISMATCH", "MERRICK"), "Merrick: last reported date mismatch");

  // Portfolio — paid with balance
  assert(hasFlag(flags, "BALANCE_STATUS_CONTRADICTION", "PORTFOLIO"), "Portfolio: balance-status contradiction");
  assert(hasFlag(flags, "BUREAU_BALANCE_MISMATCH", "PORTFOLIO"), "Portfolio: balance mismatch");
  assert(hasFlag(flags, "MISSING_ORIGINAL_CREDITOR", "PORTFOLIO"), "Portfolio: missing original creditor");
  assert(hasFlag(flags, "DEBT_COLLECTOR_ACCOUNT", "PORTFOLIO"), "Portfolio: debt collector flags");

  // Conflicting — rating vs status
  assert(hasFlag(flags, "ACCOUNT_RATING_STATUS_CONFLICT", "CONFLICTING"), "Conflicting: rating/status conflict");

  console.log(`\n  Total flags generated: ${flags.length}`);
}

// ══════════════════════════════════════════════════════════════════
// Run all tests
// ══════════════════════════════════════════════════════════════════

function runTests() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║   Comprehensive Violation Analysis Test Suite         ║");
  console.log("╚═══════════════════════════════════════════════════════╝");

  // Suite 1: Existing rules regression
  testCleanAccountProducesNoFlags();
  testBalanceMismatchCrossBureau();
  testBalanceStatusContradiction();
  testChargeoffBalanceIncreasing();
  testCreditorTypeMismatch();
  testDateOpenedMismatch();
  testObsoleteReporting();
  testMissingOriginalCreditor();
  testMissingOriginalCreditorNotFiredWhenPresent();
  testMissingCreditLimit();
  testLatePaymentHistory();
  testDerogatoryStacking();
  testDebtCollectorFlags();
  testCaliforniaLicenseCheck();
  testCaliforniaLicenseNotFiredForNonCA();
  testDisputeRemarkInconsistency();
  testBankruptcyWithBalance();
  testPaymentGridStatusConflict();

  // Suite 2: New rules
  testPaymentHistoryCrossBureauMismatch();
  testPaymentHistoryNoFalsePositiveWhenSameLateCodes();
  testPaymentHistoryNoFalsePositiveMinorDiffs();
  testHighBalanceMismatch();
  testHighBalanceNoFalsePositive();
  testAccountRatingStatusConflictCurrentVsChargeoff();
  testAccountRatingStatusConflictDerogVsPaid();
  testAccountRatingStatusNoFalsePositive();
  testLastReportedDateMismatch();
  testLastReportedNoFalsePositiveSmallDiff();

  // Suite 3: Edge cases
  testSingleBureauNoMismatchFlags();
  testEmptyPaymentHistoryNoFlags();
  testNullFieldsDoNotCrash();
  testMultipleTradelinesIsolated();

  // Suite 4: AI system prompt integration
  testSystemPromptContainsNewRules();
  testCompactPromptForRuleFlaggedAccounts();
  testTrainingDataInjectsCrossBureauGuidance();

  // Suite 5: Full integration
  testFullReportIntegration();

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║                    TEST RESULTS                       ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log("\n  ✓ ALL TESTS PASSED — Violation analysis is working correctly!\n");
  } else {
    console.log(`\n  ✗ ${failed} TEST(S) FAILED\n`);
    process.exit(1);
  }
}

runTests();
