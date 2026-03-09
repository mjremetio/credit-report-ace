/**
 * Comprehensive JSON Structuring Test
 *
 * Tests that validateAndNormalize accurately structures ALL data from raw text,
 * including edge cases like:
 *   - Dollar amounts as strings ("$1,234")
 *   - Dates in various formats (MM/DD/YYYY, MM/YYYY, YYYY-MM)
 *   - Missing top-level fields aggregated from bureau details
 *   - firstDelinquency derived from payment history
 *   - Deduplication of tradelines across batches
 *   - Bureau name normalization (abbreviations, casing)
 *   - Account type/status normalization edge cases
 *   - Consumer statements and public records
 *   - Ghost tradeline filtering
 */

import { extractTextFromHtml, splitIntoSections, cleanRawText } from "./report-parser";
import { validateAndNormalize } from "./report-extractor";
import { computeIssueFlags } from "./issue-flags";
import { generateReportSummary } from "./report-summary";

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

function assertEqual(actual: any, expected: any, message: string) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Dollar Amount Parsing Robustness
// ═══════════════════════════════════════════════════════════════════

function testDollarAmountParsing() {
  console.log("\n=== TEST 1: Dollar Amount Parsing ===\n");

  const mockRaw = {
    profile: { name: "DOLLAR TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [{
      creditorName: "TEST BANK",
      accountNumberMasked: "1234****5678",
      accountType: "revolving",
      status: "current",
      // LLM may return dollar amounts as strings
      balance: "$2,450" as any,
      bureaus: ["TransUnion", "Experian"],
      bureauDetails: [
        {
          bureau: "TransUnion",
          balance: "$1,500.50" as any,
          highBalance: "$3,000" as any,
          creditLimit: "5000" as any,
          monthlyPayment: "$75" as any,
          pastDueAmount: "$0" as any,
          status: "Open",
          dateOpened: "2020-01",
        },
        {
          bureau: "Experian",
          balance: 1200,
          highBalance: 3000,
          creditLimit: null,
          monthlyPayment: 75,
          pastDueAmount: 0,
          status: "Open",
          dateOpened: "2020-01",
        },
      ],
      dates: { opened: "2020-01" },
      evidenceText: "mock",
    }],
    publicRecords: [{
      type: "Bankruptcy Chapter 7",
      amount: "$50,000" as any,
      dateFiled: "2020-01-15",
      bureaus: ["TransUnion"],
      remarks: [],
      evidenceText: "mock",
    }],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);
  const tl = report.tradelines[0];

  // Top-level balance should be parsed from "$2,450"
  assertEqual(tl.balance, 2450, "Top-level balance parsed from '$2,450'");

  // Bureau detail balances
  const tuDetail = tl.bureauDetails.find(bd => bd.bureau === "TransUnion")!;
  assertEqual(tuDetail.balance, 1500.50, "TU balance parsed from '$1,500.50'");
  assertEqual(tuDetail.highBalance, 3000, "TU highBalance parsed from '$3,000'");
  assertEqual(tuDetail.creditLimit, 5000, "TU creditLimit parsed from '5000'");
  assertEqual(tuDetail.monthlyPayment, 75, "TU monthlyPayment parsed from '$75'");
  assertEqual(tuDetail.pastDueAmount, 0, "TU pastDueAmount parsed from '$0'");

  // Public record amount
  assertEqual(report.publicRecords[0].amount, 50000, "Public record amount parsed from '$50,000'");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Date Format Normalization
// ═══════════════════════════════════════════════════════════════════

function testDateNormalization() {
  console.log("\n=== TEST 2: Date Format Normalization ===\n");

  const mockRaw = {
    profile: {
      name: "DATE TEST",
      dateOfBirth: "03/15/1985",
      reportDate: "01/15/2026",
      dateOfBirthPerBureau: [
        { bureau: "TransUnion", value: "03/15/1985" },
        { bureau: "Experian", value: "1985-03-15" },
        { bureau: "Equifax", value: null },
      ],
      scores: [],
      addresses: [],
      employers: [],
    },
    bureauSummaries: [],
    tradelines: [{
      creditorName: "DATE BANK",
      accountNumberMasked: "1111****2222",
      accountType: "installment",
      status: "closed",
      balance: 0,
      bureaus: ["TransUnion"],
      bureauDetails: [{
        bureau: "TransUnion",
        balance: 0,
        status: "Closed",
        dateOpened: "06/15/2019",
        dateClosed: "12/2024",
        lastPaymentDate: "11/30/2024",
        lastReportedDate: "2025-01",
      }],
      dates: {
        opened: "06/15/2019",
        closed: "12/2024",
        lastPayment: "11/30/2024",
        lastReported: "2025-01",
      },
      evidenceText: "mock",
    }],
    publicRecords: [{
      type: "Civil Judgment",
      dateFiled: "03/10/2020",
      dateDischarged: "06/2021",
      amount: 5000,
      bureaus: ["TransUnion"],
      remarks: [],
      evidenceText: "mock",
    }],
    inquiries: [{
      creditorName: "TEST LENDER",
      date: "09/15/2025",
      type: "hard",
      bureau: "TransUnion",
    }],
    consumerStatements: [{
      bureau: "TransUnion",
      statement: "I dispute this item",
      dateAdded: "01/05/2026",
    }],
  };

  const report = validateAndNormalize(mockRaw as any);

  // Profile dates
  assertEqual(report.profile.dateOfBirth, "1985-03-15", "DOB normalized from MM/DD/YYYY");
  assertEqual(report.profile.reportDate, "2026-01-15", "Report date normalized from MM/DD/YYYY");

  // Tradeline dates
  const tl = report.tradelines[0];
  assertEqual(tl.dates.opened, "2019-06-15", "Date opened normalized from MM/DD/YYYY");
  assertEqual(tl.dates.closed, "2024-12", "Date closed normalized from MM/YYYY");
  assertEqual(tl.dates.lastPayment, "2024-11-30", "Last payment normalized from MM/DD/YYYY");
  assertEqual(tl.dates.lastReported, "2025-01", "Last reported already in YYYY-MM");

  // Bureau detail dates
  const bd = tl.bureauDetails[0];
  assertEqual(bd.dateOpened, "2019-06-15", "BD dateOpened normalized from MM/DD/YYYY");
  assertEqual(bd.dateClosed, "2024-12", "BD dateClosed normalized from MM/YYYY");

  // Public record dates
  assertEqual(report.publicRecords[0].dateFiled, "2020-03-10", "PR dateFiled normalized");
  assertEqual(report.publicRecords[0].dateDischarged, "2021-06", "PR dateDischarged normalized");

  // Inquiry dates
  assertEqual(report.inquiries[0].date, "2025-09-15", "Inquiry date normalized from MM/DD/YYYY");

  // Consumer statement dates
  assertEqual(report.consumerStatements[0].dateAdded, "2026-01-05", "Statement dateAdded normalized");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: FirstDelinquency Derivation from Payment History
// ═══════════════════════════════════════════════════════════════════

function testFirstDelinquencyDerivation() {
  console.log("\n=== TEST 3: FirstDelinquency Derivation from Payment History ===\n");

  const mockRaw = {
    profile: { name: "DOFD TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [{
      creditorName: "DOFD CREDITOR",
      accountNumberMasked: "3333****4444",
      accountType: "revolving",
      status: "chargeoff",
      balance: 1500,
      bureaus: ["TransUnion", "Experian"],
      bureauDetails: [
        {
          bureau: "TransUnion",
          balance: 1500,
          status: "Charge-Off",
          dateOpened: "2019-01",
          paymentHistory: [
            { month: "2023-06", code: "CO" },
            { month: "2023-05", code: "90" },
            { month: "2023-04", code: "60" },
            { month: "2023-03", code: "30" },
            { month: "2023-02", code: "C" },
          ],
        },
        {
          bureau: "Experian",
          balance: 1500,
          status: "Charge-Off",
          dateOpened: "2019-01",
          paymentHistory: [
            { month: "2023-06", code: "CO" },
            { month: "2023-05", code: "60" },
            { month: "2023-04", code: "30" },
            { month: "2023-03", code: "C" },
          ],
        },
      ],
      // No dates.firstDelinquency provided — should be derived
      dates: { opened: "2019-01" },
      evidenceText: "mock",
    }],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);
  const tl = report.tradelines[0];

  // DOFD should be derived from earliest late payment across bureaus
  // TU first late: 2023-03 (30), EX first late: 2023-04 (30)
  // Earliest across both: 2023-03
  assertEqual(tl.dates.firstDelinquency, "2023-03", "DOFD derived from payment history — earliest late entry across bureaus");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Bureau Name Normalization (abbreviations, casing)
// ═══════════════════════════════════════════════════════════════════

function testBureauNormalization() {
  console.log("\n=== TEST 4: Bureau Name Normalization ===\n");

  const mockRaw = {
    profile: {
      name: "BUREAU TEST",
      reportDate: "2026-01-01",
      scores: [
        { bureau: "tu", score: 600, model: "VantageScore" },
        { bureau: "EXP", score: 610, model: "VantageScore" },
        { bureau: "equifax", score: 620, model: "VantageScore" },
      ],
      addresses: [
        { address: "123 Test St", bureaus: ["TU", "EX", "EQ"] },
      ],
      employers: [
        { name: "Test Corp", bureaus: ["xpn", "efx"] },
      ],
    },
    bureauSummaries: [
      { bureau: "TUC", totalAccounts: 10, openAccounts: 5, closedAccounts: 5, derogatoryCount: 1, collectionsCount: 0, publicRecordsCount: 0, inquiriesCount: 2 },
    ],
    tradelines: [{
      creditorName: "BUREAU NORM TEST",
      accountNumberMasked: "5555****6666",
      accountType: "revolving",
      status: "current",
      balance: 500,
      bureaus: ["tu", "exp", "equifax"],
      bureauDetails: [
        { bureau: "TU", balance: 500, status: "Open" },
        { bureau: "EXP", balance: 500, status: "Open" },
        { bureau: "efx", balance: 500, status: "Open" },
      ],
      dates: { opened: "2020-01" },
      evidenceText: "mock",
    }],
    publicRecords: [],
    inquiries: [
      { creditorName: "TEST", date: "2025-01", type: "hard", bureau: "xpn" },
    ],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);

  // Scores
  const scoreBureaus = report.profile.scores.map(s => s.bureau);
  assert(scoreBureaus.includes("TransUnion"), "Score bureau 'tu' → 'TransUnion'");
  assert(scoreBureaus.includes("Equifax"), "Score bureau 'equifax' → 'Equifax'");

  // Address bureaus
  const addrBureaus = report.profile.addresses[0].bureaus;
  assert(addrBureaus.includes("TransUnion"), "Address bureau 'TU' → 'TransUnion'");
  assert(addrBureaus.includes("Experian"), "Address bureau 'EX' → 'Experian'");
  assert(addrBureaus.includes("Equifax"), "Address bureau 'EQ' → 'Equifax'");

  // Employer bureaus
  const empBureaus = report.profile.employers[0].bureaus;
  assert(empBureaus.includes("Experian"), "Employer bureau 'xpn' → 'Experian'");
  assert(empBureaus.includes("Equifax"), "Employer bureau 'efx' → 'Equifax'");

  // Bureau summaries
  assertEqual(report.bureauSummaries.length, 1, "Bureau summary parsed from 'TUC'");
  assertEqual(report.bureauSummaries[0].bureau, "TransUnion", "Summary bureau 'TUC' → 'TransUnion'");

  // Tradeline bureaus
  const tlBureaus = report.tradelines[0].bureaus;
  assert(tlBureaus.includes("TransUnion"), "TL bureau 'tu' → 'TransUnion'");
  assert(tlBureaus.includes("Experian"), "TL bureau 'exp' → 'Experian'");
  assert(tlBureaus.includes("Equifax"), "TL bureau 'equifax' → 'Equifax'");

  // Bureau details
  const bdBureaus = report.tradelines[0].bureauDetails.map(bd => bd.bureau);
  assert(bdBureaus.includes("TransUnion"), "BD bureau 'TU' → 'TransUnion'");
  assert(bdBureaus.includes("Experian"), "BD bureau 'EXP' → 'Experian'");
  assert(bdBureaus.includes("Equifax"), "BD bureau 'efx' → 'Equifax'");

  // Inquiry bureau
  assertEqual(report.inquiries[0].bureau, "Experian", "Inquiry bureau 'xpn' → 'Experian'");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Account Type & Status Normalization Edge Cases
// ═══════════════════════════════════════════════════════════════════

function testAccountTypeStatusNormalization() {
  console.log("\n=== TEST 5: Account Type & Status Normalization ===\n");

  const cases: Array<{
    creditorName: string;
    accountType: string;
    expectedType: string;
    status: string;
    expectedStatus: string;
  }> = [
    { creditorName: "CC1", accountType: "Credit Card", expectedType: "revolving", status: "Open/Current", expectedStatus: "current" },
    { creditorName: "CC2", accountType: "Line of Credit", expectedType: "revolving", status: "Charged Off", expectedStatus: "chargeoff" },
    { creditorName: "PL1", accountType: "Personal Loan", expectedType: "installment", status: "Past Due 60 Days", expectedStatus: "late" },
    { creditorName: "ML1", accountType: "Home Loan", expectedType: "mortgage", status: "Transferred/Closed", expectedStatus: "closed" },
    { creditorName: "SL1", accountType: "Education Loan", expectedType: "student_loan", status: "Delinquent", expectedStatus: "late" },
    { creditorName: "AL1", accountType: "Vehicle Loan", expectedType: "auto_loan", status: "Repossession", expectedStatus: "repossession" },
    { creditorName: "CL1", accountType: "Collection", expectedType: "collection", status: "Paid Collection", expectedStatus: "paid" },
    { creditorName: "HL1", accountType: "HELOC", expectedType: "mortgage", status: "Settled in Full", expectedStatus: "settled" },
    { creditorName: "CL2", accountType: "Consumer Loan", expectedType: "installment", status: "Included in Bankruptcy", expectedStatus: "bankruptcy" },
    { creditorName: "AL2", accountType: "Car Loan", expectedType: "auto_loan", status: "Charge Off", expectedStatus: "chargeoff" },
  ];

  const mockRaw = {
    profile: { name: "STATUS TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: cases.map((c, i) => ({
      creditorName: c.creditorName,
      accountNumberMasked: `${i}***${i}`,
      accountType: c.accountType,
      status: c.status,
      balance: 100,
      bureaus: ["TransUnion"],
      bureauDetails: [{ bureau: "TransUnion", balance: 100, status: c.status, dateOpened: "2020-01" }],
      dates: { opened: "2020-01" },
      evidenceText: "mock",
    })),
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const tl = report.tradelines[i];
    assertEqual(tl.accountType, c.expectedType, `"${c.accountType}" → "${c.expectedType}"`);
    assertEqual(tl.aggregateStatus, c.expectedStatus, `"${c.status}" → "${c.expectedStatus}"`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 6: Tradeline Deduplication and Bureau Merging
// ═══════════════════════════════════════════════════════════════════

function testDeduplication() {
  console.log("\n=== TEST 6: Tradeline Deduplication & Merging ===\n");

  const mockRaw = {
    profile: { name: "DEDUP TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [
      // Same account extracted from two different batches
      {
        creditorName: "CHASE BANK",
        accountNumberMasked: "4315****1234",
        accountType: "revolving",
        status: "current",
        balance: 2000,
        bureaus: ["TransUnion"],
        bureauDetails: [
          { bureau: "TransUnion", balance: 2000, status: "Open", dateOpened: "2020-01", creditLimit: 10000 },
        ],
        dates: { opened: "2020-01" },
        remarks: ["Account in good standing"],
        evidenceText: "batch1",
      },
      {
        creditorName: "CHASE BANK",
        accountNumberMasked: "4315****1234",
        accountType: "revolving",
        status: "current",
        balance: 2000,
        bureaus: ["Experian"],
        bureauDetails: [
          { bureau: "Experian", balance: 2100, status: "Open", dateOpened: "2020-01", creditLimit: 10000 },
        ],
        dates: { opened: "2020-01" },
        remarks: ["Account current"],
        evidenceText: "batch2",
      },
      // Different account (should NOT be deduped)
      {
        creditorName: "CHASE BANK",
        accountNumberMasked: "4315****5678",
        accountType: "revolving",
        status: "current",
        balance: 500,
        bureaus: ["TransUnion"],
        bureauDetails: [
          { bureau: "TransUnion", balance: 500, status: "Open", dateOpened: "2022-05" },
        ],
        dates: { opened: "2022-05" },
        evidenceText: "different account",
      },
    ],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);

  // Should have 2 tradelines (first two merged, third separate)
  assertEqual(report.tradelines.length, 2, "Duplicates merged: 3 inputs → 2 tradelines");

  // The merged tradeline should have 2 bureau details
  const merged = report.tradelines.find(tl => tl.accountNumberMasked === "4315****1234")!;
  assertEqual(merged.bureauDetails.length, 2, "Merged tradeline has 2 bureau details");
  assert(merged.bureaus.includes("TransUnion"), "Merged tradeline includes TransUnion");
  assert(merged.bureaus.includes("Experian"), "Merged tradeline includes Experian");

  // Remarks should be merged and deduped
  assert(merged.remarks.includes("Account in good standing"), "Merged remarks include first batch");
  assert(merged.remarks.includes("Account current"), "Merged remarks include second batch");

  // Different account preserved
  const separate = report.tradelines.find(tl => tl.accountNumberMasked === "4315****5678")!;
  assert(!!separate, "Separate account preserved (different account number)");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 7: Ghost Tradeline Filtering
// ═══════════════════════════════════════════════════════════════════

function testGhostFiltering() {
  console.log("\n=== TEST 7: Ghost Tradeline Filtering ===\n");

  const mockRaw = {
    profile: { name: "GHOST TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [
      // Valid tradeline
      {
        creditorName: "REAL BANK",
        accountNumberMasked: "1111****2222",
        accountType: "revolving",
        status: "current",
        balance: 500,
        bureaus: ["TransUnion"],
        bureauDetails: [{ bureau: "TransUnion", balance: 500, status: "Open", dateOpened: "2020-01" }],
        dates: { opened: "2020-01" },
        evidenceText: "mock",
      },
      // Ghost tradeline (no real data)
      {
        creditorName: "GHOST ACCOUNT",
        accountType: "other",
        status: "other",
        balance: null as any,
        bureaus: ["TransUnion"],
        bureauDetails: [{ bureau: "TransUnion" }],
        evidenceText: "mock",
      },
      // Borderline — has status but no numbers (should be kept)
      {
        creditorName: "BORDERLINE ACCOUNT",
        accountType: "collection",
        status: "collection",
        balance: null as any,
        bureaus: ["TransUnion"],
        bureauDetails: [{ bureau: "TransUnion", status: "Collection", dateOpened: "2023-01" }],
        evidenceText: "mock",
      },
    ],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);

  // Ghost should be filtered, real and borderline kept
  assertEqual(report.tradelines.length, 2, "Ghost tradeline filtered out");
  assert(report.tradelines.some(tl => tl.creditorName === "REAL BANK"), "Real tradeline kept");
  assert(report.tradelines.some(tl => tl.creditorName === "BORDERLINE ACCOUNT"), "Borderline tradeline kept (has status + dateOpened)");
  assert(!report.tradelines.some(tl => tl.creditorName === "GHOST ACCOUNT"), "Ghost tradeline removed");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 8: Balance/Date Aggregation When Top-Level Missing
// ═══════════════════════════════════════════════════════════════════

function testAggregationFromBureauDetails() {
  console.log("\n=== TEST 8: Balance/Date Aggregation from Bureau Details ===\n");

  const mockRaw = {
    profile: { name: "AGG TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [{
      creditorName: "AGG CREDITOR",
      accountType: "revolving",
      // NO top-level balance, status, or dates
      bureaus: ["TransUnion", "Experian", "Equifax"],
      bureauDetails: [
        { bureau: "TransUnion", balance: 1500, status: "Charge-Off", dateOpened: "2020-01", lastPaymentDate: "2023-06", lastReportedDate: "2025-11", highBalance: 2000, creditLimit: 3000 },
        { bureau: "Experian", balance: 1200, status: "Charge-Off", dateOpened: "2020-02", lastPaymentDate: "2023-05", lastReportedDate: "2025-12", highBalance: 2000, creditLimit: 3000 },
        { bureau: "Equifax", balance: 1800, status: "Charge-Off", dateOpened: "2020-01", dateClosed: "2024-01", lastPaymentDate: "2023-07", lastReportedDate: "2025-10" },
      ],
      evidenceText: "mock",
    }],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);
  const tl = report.tradelines[0];

  // Balance should be max across bureaus
  assertEqual(tl.balance, 1800, "Balance aggregated as max across bureaus (1800)");

  // Status should aggregate from bureau details
  assertEqual(tl.aggregateStatus, "chargeoff", "Status aggregated from bureau details");

  // Dates should aggregate properly
  assertEqual(tl.dates.opened, "2020-01", "Date opened = earliest (2020-01)");
  assertEqual(tl.dates.closed, "2024-01", "Date closed = latest (2024-01)");
  assertEqual(tl.dates.lastPayment, "2023-07", "Last payment = latest (2023-07)");
  assertEqual(tl.dates.lastReported, "2025-12", "Last reported = latest (2025-12)");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 9: Inquiry Deduplication
// ═══════════════════════════════════════════════════════════════════

function testInquiryDeduplication() {
  console.log("\n=== TEST 9: Inquiry Deduplication ===\n");

  const mockRaw = {
    profile: { name: "INQ TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [],
    publicRecords: [],
    inquiries: [
      { creditorName: "CHASE AUTO", date: "2025-09-15", type: "hard", bureau: "TransUnion" },
      { creditorName: "CHASE AUTO", date: "2025-09-15", type: "hard", bureau: "TransUnion" }, // duplicate
      { creditorName: "CHASE AUTO", date: "2025-09-15", type: "hard", bureau: "Experian" }, // different bureau = not dupe
      { creditorName: "CHASE AUTO", date: "2025-09-16", type: "hard", bureau: "TransUnion" }, // different date = not dupe
      { creditorName: "UNKNOWN", date: "2025-01", type: "unknown_type" as any, bureau: "Equifax" }, // unknown type
    ],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);

  assertEqual(report.inquiries.length, 4, "Duplicate inquiry removed (5 → 4)");
  assertEqual(report.inquiries.filter(i => i.type === "unknown").length, 1, "Unknown inquiry type normalized to 'unknown'");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 10: Consumer Statements
// ═══════════════════════════════════════════════════════════════════

function testConsumerStatements() {
  console.log("\n=== TEST 10: Consumer Statements ===\n");

  const mockRaw = {
    profile: { name: "CS TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [
      { bureau: "TransUnion", statement: "I dispute this account", dateAdded: "01/15/2026" },
      { bureau: "Experian", statement: "Identity theft victim", dateAdded: "2025-12-01" },
      { bureau: "InvalidBureau", statement: "This should fallback to TransUnion" },
      { bureau: "TransUnion", statement: "", dateAdded: "2025-01-01" }, // empty statement should be filtered
    ],
  };

  const report = validateAndNormalize(mockRaw as any);

  assertEqual(report.consumerStatements.length, 3, "Empty statement filtered (4 → 3)");
  assertEqual(report.consumerStatements[0].dateAdded, "2026-01-15", "Statement date normalized from MM/DD/YYYY");
  assertEqual(report.consumerStatements[2].bureau, "TransUnion", "Invalid bureau falls back to TransUnion");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 11: Full HTML Report → Parser Section Detection
// ═══════════════════════════════════════════════════════════════════

function testHtmlParserSections() {
  console.log("\n=== TEST 11: HTML Parser Section Detection ===\n");

  const SAMPLE_HTML = `<!DOCTYPE html>
<html><body>
<h2>Personal Information</h2>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Name</td><td>JANE DOE</td><td>JANE DOE</td><td>JANE DOE</td></tr>
  <tr><td>Date of Birth</td><td>01/20/1990</td><td>01/20/1990</td><td>--</td></tr>
  <tr><td>SSN</td><td>XXX-XX-5678</td><td>XXX-XX-5678</td><td>XXX-XX-5678</td></tr>
</table>

<h3>Credit Scores</h3>
<table>
  <tr><th>Bureau</th><th>Score</th><th>Model</th></tr>
  <tr><td>TransUnion</td><td>720</td><td>VantageScore 3.0</td></tr>
  <tr><td>Experian</td><td>715</td><td>VantageScore 3.0</td></tr>
  <tr><td>Equifax</td><td>730</td><td>VantageScore 3.0</td></tr>
</table>

<h2>Account Summary</h2>
<table>
  <tr><th>Summary</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Total Accounts</td><td>12</td><td>12</td><td>11</td></tr>
  <tr><td>Open Accounts</td><td>6</td><td>6</td><td>5</td></tr>
  <tr><td>Closed Accounts</td><td>6</td><td>6</td><td>6</td></tr>
  <tr><td>Delinquent</td><td>0</td><td>0</td><td>0</td></tr>
  <tr><td>Derogatory</td><td>1</td><td>1</td><td>1</td></tr>
</table>

<h2>Account Details</h2>

<h3>DISCOVER FINANCIAL</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>6011****3456</td><td>6011****3456</td><td>6011****3456</td></tr>
  <tr><td>Account Type</td><td>Revolving</td><td>Revolving</td><td>Revolving</td></tr>
  <tr><td>Status</td><td>Open</td><td>Open</td><td>Open</td></tr>
  <tr><td>Balance</td><td>$1,200</td><td>$1,200</td><td>$1,200</td></tr>
  <tr><td>Credit Limit</td><td>$8,000</td><td>$8,000</td><td>$8,000</td></tr>
</table>

<h3>CAPITAL ONE AUTO</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>CO****7890</td><td>CO****7890</td><td>CO****7890</td></tr>
  <tr><td>Account Type</td><td>Installment</td><td>Installment</td><td>Installment</td></tr>
  <tr><td>Status</td><td>Open</td><td>Open</td><td>Open</td></tr>
  <tr><td>Balance</td><td>$15,000</td><td>$15,000</td><td>$15,000</td></tr>
  <tr><td>Monthly Payment</td><td>$350</td><td>$350</td><td>$350</td></tr>
  <tr><td>Date Opened</td><td>2023-06</td><td>2023-06</td><td>2023-06</td></tr>
</table>

<h3>CAVALRY SPV</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>CAV****1111</td><td>CAV****1111</td><td>--</td></tr>
  <tr><td>Account Type</td><td>Collection</td><td>Collection</td><td>--</td></tr>
  <tr><td>Status</td><td>Collection</td><td>Collection</td><td>--</td></tr>
  <tr><td>Original Creditor</td><td>SYNCHRONY BANK</td><td>SYNCHRONY BANK</td><td>--</td></tr>
  <tr><td>Balance</td><td>$2,300</td><td>$2,300</td><td>--</td></tr>
</table>

<h2>Public Records</h2>
<p>No public records found.</p>

<h2>Inquiries</h2>
<table>
  <tr><th>Creditor</th><th>Date</th><th>Bureau</th></tr>
  <tr><td>TOYOTA MOTOR</td><td>2025-08-01</td><td>TransUnion</td></tr>
  <tr><td>TOYOTA MOTOR</td><td>2025-08-01</td><td>Experian</td></tr>
</table>

<h2>Consumer Statement</h2>
<p>TransUnion: I am a victim of identity theft. Please verify all accounts.</p>
</body></html>`;

  const text = extractTextFromHtml(SAMPLE_HTML);
  const sections = splitIntoSections(text);

  assert(text.length > 200, `Extracted text has sufficient length (${text.length} chars)`);

  const types = sections.map(s => s.type);
  assert(types.includes("personal_info"), "Personal info section detected");
  assert(types.includes("bureau_summary"), "Bureau summary section detected");
  assert(types.includes("inquiries"), "Inquiries section detected");
  assert(types.includes("consumer_statement"), "Consumer statement section detected");

  const tradelines = sections.filter(s => s.type === "tradeline");
  assert(tradelines.length >= 2, `At least 2 tradeline sections detected (got ${tradelines.length})`);

  // Check section labels
  console.log(`  Sections found: ${sections.length}`);
  for (const s of sections) {
    console.log(`    [${s.type}] "${s.label}" — ${s.text.length} chars`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 12: Raw Text (Plain Text) Parsing
// ═══════════════════════════════════════════════════════════════════

function testRawTextParsing() {
  console.log("\n=== TEST 12: Raw Text Parsing ===\n");

  const rawText = `
Personal Information

Name: MICHAEL JOHNSON
Date of Birth: 05/10/1978
SSN: XXX-XX-9876

Credit Scores
TransUnion: 580
Experian: 575
Equifax: 590

Account Summary
Total Accounts    TransUnion: 20    Experian: 19    Equifax: 20
Open Accounts     TransUnion: 10    Experian: 9     Equifax: 10
Derogatory        TransUnion: 4     Experian: 4     Equifax: 3

Account Details

NAVY FEDERAL CREDIT UNION
Account #: 4000****1234
Account Type: Revolving
Balance: $5,500
Credit Limit: $15,000
Status: Open/Current
Date Opened: 06/2018
Last Payment: 01/2026
Last Reported: 02/2026

DISCOVER BANK
Account #: 6011****5678
Account Type: Credit Card
Balance: $0
Status: Closed
Date Opened: 03/2015
Date Closed: 11/2023

ENHANCED RECOVERY
Account #: ER****9999
Account Type: Collection
Status: Collection
Original Creditor: AT&T
Balance: $450
Date of First Delinquency: 09/2022

Public Records
No public records found.

Inquiries
NAVY FEDERAL     02/15/2025    TransUnion     Hard
CARMAX           01/10/2025    Experian       Hard
`;

  const cleaned = cleanRawText(rawText);
  const sections = splitIntoSections(cleaned);

  assert(sections.length >= 3, `At least 3 sections from raw text (got ${sections.length})`);

  const types = sections.map(s => s.type);
  assert(types.includes("personal_info"), "Personal info detected in raw text");

  console.log(`  Sections found: ${sections.length}`);
  for (const s of sections) {
    console.log(`    [${s.type}] "${s.label}" — ${s.text.length} chars`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 13: Full End-to-End with Issue Flags and Summary
// ═══════════════════════════════════════════════════════════════════

function testEndToEndWithFlagsAndSummary() {
  console.log("\n=== TEST 13: End-to-End with Issue Flags & Summary ===\n");

  const mockRaw = {
    profile: {
      name: "JOHN DOE",
      dateOfBirth: "1985-03-15",
      dateOfBirthPerBureau: [
        { bureau: "TransUnion", value: "1985-03-15" },
        { bureau: "Experian", value: "1985-03-15" },
        { bureau: "Equifax", value: "1985-03-15" },
      ],
      ssn: "XXX-XX-1234",
      reportDate: "2026-02-01",
      scores: [
        { bureau: "TransUnion", score: 580, model: "VantageScore 3.0" },
        { bureau: "Experian", score: 575, model: "VantageScore 3.0" },
        { bureau: "Equifax", score: 590, model: "VantageScore 3.0" },
      ],
      addresses: [
        { address: "123 Main St, Springfield, IL 62701", bureaus: ["TransUnion", "Experian", "Equifax"] },
      ],
      employers: [],
    },
    bureauSummaries: [
      { bureau: "TransUnion", totalAccounts: 10, openAccounts: 5, closedAccounts: 5, derogatoryCount: 2, collectionsCount: 1, publicRecordsCount: 0, inquiriesCount: 3 },
      { bureau: "Experian", totalAccounts: 10, openAccounts: 5, closedAccounts: 5, derogatoryCount: 2, collectionsCount: 1, publicRecordsCount: 0, inquiriesCount: 2 },
      { bureau: "Equifax", totalAccounts: 9, openAccounts: 4, closedAccounts: 5, derogatoryCount: 2, collectionsCount: 0, publicRecordsCount: 0, inquiriesCount: 1 },
    ],
    tradelines: [
      // Good account
      {
        creditorName: "CHASE BANK",
        accountNumberMasked: "4315****1234",
        accountType: "revolving",
        status: "current",
        balance: 2000,
        bureaus: ["TransUnion", "Experian", "Equifax"],
        bureauDetails: [
          { bureau: "TransUnion", balance: 2000, status: "Open", dateOpened: "2019-05", creditLimit: 10000, highBalance: 5000, paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }], remarks: ["Account in good standing"] },
          { bureau: "Experian", balance: 2000, status: "Open", dateOpened: "2019-05", creditLimit: 10000, highBalance: 5000, paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }], remarks: ["Account in good standing"] },
          { bureau: "Equifax", balance: 2000, status: "Open", dateOpened: "2019-05", creditLimit: 10000, highBalance: 5000, paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }], remarks: ["Account in good standing"] },
        ],
        dates: { opened: "2019-05", lastPayment: "2025-12", lastReported: "2026-01" },
        remarks: ["Account in good standing"],
        evidenceText: "mock",
      },
      // Chargeoff with balance mismatch + creditor type mismatch
      {
        creditorName: "MERRICK BANK",
        accountNumberMasked: "5412****5678",
        accountType: "revolving",
        status: "chargeoff",
        balance: 3200,
        bureaus: ["TransUnion", "Experian", "Equifax"],
        bureauDetails: [
          { bureau: "TransUnion", balance: 3200, status: "Charge-Off", dateOpened: "2018-03", creditLimit: 5000, highBalance: 4800, creditorType: "Bank Credit Cards", paymentHistory: [{ month: "2022-06", code: "CO" }, { month: "2022-05", code: "60" }, { month: "2022-04", code: "30" }], remarks: ["Charged off account"] },
          { bureau: "Experian", balance: 2800, status: "Charge-Off", dateOpened: "2018-03", creditLimit: 5000, highBalance: 4800, creditorType: "Bank Credit Cards", paymentHistory: [{ month: "2022-06", code: "CO" }, { month: "2022-05", code: "60" }], remarks: ["Charged off account"] },
          { bureau: "Equifax", balance: 3200, status: "Charged Off", dateOpened: "2018-04", creditLimit: null, highBalance: 4800, creditorType: "Miscellaneous Finance", paymentHistory: [{ month: "2022-06", code: "CO" }, { month: "2022-05", code: "90" }], remarks: ["Charged off account"] },
        ],
        dates: { opened: "2018-03", firstDelinquency: "2022-06", lastPayment: "2022-05", lastReported: "2026-01" },
        remarks: ["Charged off account"],
        evidenceText: "mock",
      },
      // Collection: paid but Experian still shows balance
      {
        creditorName: "PORTFOLIO RECOVERY",
        accountNumberMasked: "PRA****3456",
        accountType: "collection",
        status: "paid",
        balance: 0,
        bureaus: ["TransUnion", "Experian", "Equifax"],
        bureauDetails: [
          { bureau: "TransUnion", balance: 0, status: "Paid Collection", dateOpened: "2021-06", creditorType: "Collection Agency", remarks: ["Paid collection"] },
          { bureau: "Experian", balance: 450, status: "Paid", dateOpened: "2021-06", creditorType: "Collection Agency", remarks: ["Collection account"] },
          { bureau: "Equifax", balance: 0, status: "Paid Collection", dateOpened: "2021-06", creditorType: "Collection Agency", remarks: ["Paid collection"] },
        ],
        dates: { opened: "2021-06", firstDelinquency: "2020-11", lastPayment: "2024-03" },
        remarks: ["Paid collection", "Collection account"],
        evidenceText: "mock",
      },
    ],
    publicRecords: [],
    inquiries: [
      { creditorName: "CHASE AUTO", date: "2025-09-15", type: "hard", bureau: "TransUnion" },
    ],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);

  // Compute flags
  const flags = computeIssueFlags(report);
  report.issueFlags = flags;

  // Generate summary
  const summary = generateReportSummary(report);
  report.summary = summary;

  // Verify flags
  const flagTypes = new Set(flags.map(f => f.flagType));

  assert(flagTypes.has("BUREAU_BALANCE_MISMATCH"), "Flag: BUREAU_BALANCE_MISMATCH for Merrick ($3200 vs $2800)");
  assert(flagTypes.has("BUREAU_CREDITOR_TYPE_MISMATCH"), "Flag: BUREAU_CREDITOR_TYPE_MISMATCH for Merrick");
  assert(flagTypes.has("DATE_OPENED_MISMATCH"), "Flag: DATE_OPENED_MISMATCH for Merrick (2018-03 vs 2018-04)");
  assert(flagTypes.has("CHARGEOFF_PRESENT"), "Flag: CHARGEOFF_PRESENT for Merrick");
  assert(flagTypes.has("LATE_PAYMENT_HISTORY"), "Flag: LATE_PAYMENT_HISTORY for Merrick");
  assert(flagTypes.has("BALANCE_STATUS_CONTRADICTION"), "Flag: BALANCE_STATUS_CONTRADICTION for Portfolio (paid but $450)");
  assert(flagTypes.has("MISSING_ORIGINAL_CREDITOR"), "Flag: MISSING_ORIGINAL_CREDITOR for Portfolio");

  // Verify summary
  assert(summary.accountOneLiners.length >= 2, `At least 2 account one-liners (got ${summary.accountOneLiners.length})`);
  assert(summary.categorySummaries.length >= 1, `At least 1 category summary (got ${summary.categorySummaries.length})`);
  assert(summary.actionPlan.length >= 1, `At least 1 action plan item (got ${summary.actionPlan.length})`);

  console.log(`\n  Flags found: ${flags.length}`);
  for (const f of flags) {
    console.log(`    [${f.severity.toUpperCase()}] ${f.flagType}: ${f.creditorName}`);
  }
  console.log(`\n  Summary: ${summary.accountOneLiners.length} one-liners, ${summary.categorySummaries.length} categories, ${summary.actionPlan.length} action items`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 14: Per-Bureau DOB Handling
// ═══════════════════════════════════════════════════════════════════

function testPerBureauDOB() {
  console.log("\n=== TEST 14: Per-Bureau DOB Handling ===\n");

  // Case 1: Per-bureau DOB provided
  const mockRaw1 = {
    profile: {
      name: "DOB TEST 1",
      dateOfBirth: "1985-03-15",
      dateOfBirthPerBureau: [
        { bureau: "TransUnion", value: "1985-03-15" },
        { bureau: "Experian", value: "1985-03" },
        { bureau: "Equifax", value: null },
      ],
      reportDate: "2026-01-01",
      scores: [], addresses: [], employers: [],
    },
    bureauSummaries: [], tradelines: [], publicRecords: [], inquiries: [], consumerStatements: [],
  };

  const report1 = validateAndNormalize(mockRaw1 as any);
  const dob1 = report1.profile.dateOfBirthPerBureau || [];
  assert(dob1.length === 3, "All 3 bureaus represented in DOB");
  assertEqual(dob1.find(d => d.bureau === "TransUnion")?.value, "1985-03-15", "TU DOB preserved");
  assertEqual(dob1.find(d => d.bureau === "Experian")?.value, "1985-03", "EX DOB preserved (partial)");
  assertEqual(dob1.find(d => d.bureau === "Equifax")?.value, null, "EQ DOB null preserved");

  // Case 2: No per-bureau DOB — single DOB replicated to all
  const mockRaw2 = {
    profile: {
      name: "DOB TEST 2",
      dateOfBirth: "1990-07-20",
      reportDate: "2026-01-01",
      scores: [], addresses: [], employers: [],
    },
    bureauSummaries: [], tradelines: [], publicRecords: [], inquiries: [], consumerStatements: [],
  };

  const report2 = validateAndNormalize(mockRaw2 as any);
  const dob2 = report2.profile.dateOfBirthPerBureau || [];
  assert(dob2.length === 3, "All 3 bureaus filled from single DOB");
  assertEqual(dob2.find(d => d.bureau === "TransUnion")?.value, "1990-07-20", "TU DOB from single value");
  assertEqual(dob2.find(d => d.bureau === "Experian")?.value, "1990-07-20", "EX DOB from single value");
  assertEqual(dob2.find(d => d.bureau === "Equifax")?.value, "1990-07-20", "EQ DOB from single value");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 15: Missing Credit Limit Flag for Revolving
// ═══════════════════════════════════════════════════════════════════

function testMissingCreditLimitFlag() {
  console.log("\n=== TEST 15: Missing Credit Limit Flag ===\n");

  const mockRaw = {
    profile: { name: "LIMIT TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [{
      creditorName: "NO LIMIT CARD",
      accountNumberMasked: "7777****8888",
      accountType: "revolving",
      status: "current",
      balance: 2000,
      bureaus: ["TransUnion", "Equifax"],
      bureauDetails: [
        { bureau: "TransUnion", balance: 2000, status: "Open", dateOpened: "2020-01", creditLimit: null, highBalance: 3000 },
        { bureau: "Equifax", balance: 2000, status: "Open", dateOpened: "2020-01", creditLimit: 8000, highBalance: 3000 },
      ],
      dates: { opened: "2020-01" },
      evidenceText: "mock",
    }],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);
  const flags = computeIssueFlags(report);

  const missingLimitFlags = flags.filter(f => f.flagType === "MISSING_CREDIT_LIMIT");
  assert(missingLimitFlags.length === 1, "MISSING_CREDIT_LIMIT flag raised for TU");
  assertEqual(missingLimitFlags[0]?.bureausAffected[0], "TransUnion", "Flag targets TransUnion");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 16: Payment History Completeness
// ═══════════════════════════════════════════════════════════════════

function testPaymentHistoryCompleteness() {
  console.log("\n=== TEST 16: Payment History Completeness ===\n");

  const mockRaw = {
    profile: { name: "PH TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [{
      creditorName: "PH BANK",
      accountNumberMasked: "9999****0000",
      accountType: "revolving",
      status: "current",
      balance: 1000,
      bureaus: ["TransUnion"],
      bureauDetails: [{
        bureau: "TransUnion",
        balance: 1000,
        status: "Open",
        dateOpened: "2020-01",
        paymentHistory: [
          { month: "2026-01", code: "C" },
          { month: "2025-12", code: "C" },
          { month: "2025-11", code: "30" },
          { month: "2025-10", code: "60" },
          { month: "2025-09", code: "C" },
          { month: "2025-08", code: "C" },
        ],
        daysLate7Year: { "30": 3, "60": 1, "90": 0 },
        remarks: ["Account has late history"],
      }],
      dates: { opened: "2020-01" },
      evidenceText: "mock",
    }],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  const report = validateAndNormalize(mockRaw as any);
  const tl = report.tradelines[0];
  const bd = tl.bureauDetails[0];

  assertEqual(bd.paymentHistory?.length, 6, "All 6 payment history entries preserved");
  assertEqual(bd.paymentHistory?.[2].code, "30", "Late code '30' preserved");
  assertEqual(bd.paymentHistory?.[3].code, "60", "Late code '60' preserved");

  assert(bd.daysLate7Year !== undefined, "daysLate7Year present");
  assertEqual(bd.daysLate7Year?.["30"], 3, "daysLate7Year 30-count = 3");
  assertEqual(bd.daysLate7Year?.["60"], 1, "daysLate7Year 60-count = 1");
  assertEqual(bd.daysLate7Year?.["90"], 0, "daysLate7Year 90-count = 0");

  // DOFD should be derived since not explicitly set
  assertEqual(tl.dates.firstDelinquency, "2025-10", "DOFD derived from earliest late in payment history");
}

// ═══════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════

function runAllTests() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  Comprehensive JSON Structuring Test Suite        ║");
  console.log("╚═══════════════════════════════════════════════════╝");

  testDollarAmountParsing();
  testDateNormalization();
  testFirstDelinquencyDerivation();
  testBureauNormalization();
  testAccountTypeStatusNormalization();
  testDeduplication();
  testGhostFiltering();
  testAggregationFromBureauDetails();
  testInquiryDeduplication();
  testConsumerStatements();
  testHtmlParserSections();
  testRawTextParsing();
  testEndToEndWithFlagsAndSummary();
  testPerBureauDOB();
  testMissingCreditLimitFlag();
  testPaymentHistoryCompleteness();

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║  RESULTS                                          ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log("\n  ALL TESTS PASSED!\n");
  } else {
    console.log(`\n  ${failed} TEST(S) FAILED\n`);
    process.exit(1);
  }
}

runAllTests();
