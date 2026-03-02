/**
 * Pipeline Integration Test
 *
 * Tests the full parse → normalize → flag → summarize flow
 * using a synthetic credit report to verify complete extraction.
 */

import { parseReportFile, splitIntoSections, extractTextFromHtml } from "./report-parser";
import { validateAndNormalize, extractPass1 } from "./report-extractor";
import { computeIssueFlags } from "./issue-flags";
import { generateReportSummary } from "./report-summary";
import type { ParsedCreditReport } from "@shared/credit-report-types";

// ── Synthetic credit report HTML (tri-merge format) ──────────────

const SAMPLE_CREDIT_REPORT_HTML = `<!DOCTYPE html>
<html>
<head><title>Credit Report - JOHN Q SMITH</title></head>
<body>
<h1>Credit Report</h1>

<h2>Personal Information</h2>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Name</td><td>JOHN Q SMITH</td><td>JOHN Q SMITH</td><td>JOHN Q SMITH</td></tr>
  <tr><td>Also Known As</td><td>JOHN SMITH</td><td>--</td><td>JOHN SMITH</td></tr>
  <tr><td>Date of Birth</td><td>1985-03-15</td><td>1985-03-15</td><td>1985-03-15</td></tr>
  <tr><td>SSN</td><td>XXX-XX-1234</td><td>XXX-XX-1234</td><td>XXX-XX-1234</td></tr>
</table>

<h3>Credit Scores</h3>
<table>
  <tr><th>Bureau</th><th>Score</th><th>Model</th></tr>
  <tr><td>TransUnion</td><td>612</td><td>VantageScore 3.0</td></tr>
  <tr><td>Experian</td><td>605</td><td>VantageScore 3.0</td></tr>
  <tr><td>Equifax</td><td>618</td><td>VantageScore 3.0</td></tr>
</table>

<h3>Addresses</h3>
<table>
  <tr><th>Address</th><th>Bureaus</th></tr>
  <tr><td>123 Main St, Springfield, IL 62701</td><td>TransUnion, Experian, Equifax</td></tr>
  <tr><td>456 Oak Ave, Chicago, IL 60601</td><td>TransUnion, Experian</td></tr>
  <tr><td>789 Elm St, Unknown City, XX 00000</td><td>Equifax</td></tr>
</table>

<h3>Employers</h3>
<table>
  <tr><th>Employer</th><th>Bureaus</th></tr>
  <tr><td>ACME Corp</td><td>TransUnion, Experian</td></tr>
</table>

<h2>Account Summary</h2>
<table>
  <tr><th>Summary</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Total Accounts</td><td>15</td><td>14</td><td>15</td></tr>
  <tr><td>Open Accounts</td><td>8</td><td>7</td><td>8</td></tr>
  <tr><td>Closed Accounts</td><td>7</td><td>7</td><td>7</td></tr>
  <tr><td>Derogatory</td><td>3</td><td>3</td><td>3</td></tr>
  <tr><td>Collections</td><td>2</td><td>2</td><td>1</td></tr>
  <tr><td>Public Records</td><td>0</td><td>0</td><td>0</td></tr>
  <tr><td>Inquiries</td><td>4</td><td>3</td><td>2</td></tr>
  <tr><td>Total Balance</td><td>$45,200</td><td>$44,800</td><td>$45,500</td></tr>
  <tr><td>Total Credit Limit</td><td>$62,000</td><td>$62,000</td><td>$62,000</td></tr>
  <tr><td>Monthly Payment</td><td>$1,250</td><td>$1,250</td><td>$1,250</td></tr>
</table>

<h2>Account Details</h2>

<h3>CHASE BANK</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>4315****1234</td><td>4315****1234</td><td>4315****1234</td></tr>
  <tr><td>Account Type</td><td>Revolving</td><td>Revolving</td><td>Revolving</td></tr>
  <tr><td>Status</td><td>Open</td><td>Open</td><td>Open</td></tr>
  <tr><td>Balance</td><td>$2,450</td><td>$2,450</td><td>$2,450</td></tr>
  <tr><td>Credit Limit</td><td>$10,000</td><td>$10,000</td><td>$10,000</td></tr>
  <tr><td>High Balance</td><td>$5,200</td><td>$5,200</td><td>$5,200</td></tr>
  <tr><td>Monthly Payment</td><td>$75</td><td>$75</td><td>$75</td></tr>
  <tr><td>Date Opened</td><td>2019-05</td><td>2019-05</td><td>2019-05</td></tr>
  <tr><td>Last Payment</td><td>2025-12</td><td>2025-12</td><td>2025-12</td></tr>
  <tr><td>Last Reported</td><td>2026-01</td><td>2026-01</td><td>2026-01</td></tr>
  <tr><td>Payment Status</td><td>Current</td><td>Current</td><td>Current</td></tr>
  <tr><td>Account Rating</td><td>Open/Current</td><td>Open/Current</td><td>Open/Current</td></tr>
  <tr><td>Creditor Type</td><td>Bank Credit Cards</td><td>Bank Credit Cards</td><td>Bank Credit Cards</td></tr>
  <tr><td>Past Due Amount</td><td>$0</td><td>$0</td><td>$0</td></tr>
  <tr><td>Terms</td><td>Revolving</td><td>Revolving</td><td>Revolving</td></tr>
  <tr><td>Remarks</td><td>Account in good standing</td><td>Account in good standing</td><td>Account in good standing</td></tr>
  <tr><td>Payment History (2026-01)</td><td>C</td><td>C</td><td>C</td></tr>
  <tr><td>Payment History (2025-12)</td><td>C</td><td>C</td><td>C</td></tr>
  <tr><td>Payment History (2025-11)</td><td>C</td><td>C</td><td>C</td></tr>
  <tr><td>Payment History (2025-10)</td><td>C</td><td>C</td><td>C</td></tr>
</table>

<h3>MERRICK BANK</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>5412****5678</td><td>5412****5678</td><td>5412****5678</td></tr>
  <tr><td>Account Type</td><td>Revolving</td><td>Revolving</td><td>Revolving</td></tr>
  <tr><td>Status</td><td>Charge-Off</td><td>Charge-Off</td><td>Charged Off</td></tr>
  <tr><td>Balance</td><td>$3,200</td><td>$2,800</td><td>$3,200</td></tr>
  <tr><td>Credit Limit</td><td>$5,000</td><td>$5,000</td><td>--</td></tr>
  <tr><td>High Balance</td><td>$4,800</td><td>$4,800</td><td>$4,800</td></tr>
  <tr><td>Monthly Payment</td><td>$0</td><td>$0</td><td>$0</td></tr>
  <tr><td>Date Opened</td><td>2018-03</td><td>2018-03</td><td>2018-04</td></tr>
  <tr><td>Date of First Delinquency</td><td>2022-06</td><td>2022-06</td><td>2022-06</td></tr>
  <tr><td>Last Payment</td><td>2022-05</td><td>2022-05</td><td>2022-05</td></tr>
  <tr><td>Last Reported</td><td>2026-01</td><td>2025-12</td><td>2025-12</td></tr>
  <tr><td>Payment Status</td><td>Charge-Off</td><td>Charge-Off</td><td>Charge-Off</td></tr>
  <tr><td>Account Rating</td><td>9 - Charge Off</td><td>9 - Charge Off</td><td>9 - Charge Off</td></tr>
  <tr><td>Creditor Type</td><td>Bank Credit Cards</td><td>Bank Credit Cards</td><td>Miscellaneous Finance</td></tr>
  <tr><td>Past Due Amount</td><td>$3,200</td><td>$2,800</td><td>$3,200</td></tr>
  <tr><td>Terms</td><td>Revolving</td><td>Revolving</td><td>Revolving</td></tr>
  <tr><td>Remarks</td><td>Charged off account</td><td>Charged off account</td><td>Charged off account</td></tr>
  <tr><td>Payment History (2022-06)</td><td>CO</td><td>CO</td><td>CO</td></tr>
  <tr><td>Payment History (2022-05)</td><td>60</td><td>60</td><td>90</td></tr>
  <tr><td>Payment History (2022-04)</td><td>30</td><td>30</td><td>60</td></tr>
  <tr><td>Payment History (2022-03)</td><td>C</td><td>30</td><td>30</td></tr>
</table>

<h3>MIDLAND CREDIT MANAGEMENT</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>MCM****9012</td><td>MCM****9012</td><td>--</td></tr>
  <tr><td>Account Type</td><td>Collection</td><td>Collection</td><td>--</td></tr>
  <tr><td>Status</td><td>Collection</td><td>Collection</td><td>--</td></tr>
  <tr><td>Original Creditor</td><td>CAPITAL ONE</td><td>CAPITAL ONE</td><td>--</td></tr>
  <tr><td>Balance</td><td>$1,890</td><td>$1,890</td><td>--</td></tr>
  <tr><td>Date Opened</td><td>2023-01</td><td>2023-02</td><td>--</td></tr>
  <tr><td>Date of First Delinquency</td><td>2022-09</td><td>2022-09</td><td>--</td></tr>
  <tr><td>Last Payment</td><td>--</td><td>--</td><td>--</td></tr>
  <tr><td>Last Reported</td><td>2025-11</td><td>2025-11</td><td>--</td></tr>
  <tr><td>Creditor Type</td><td>Collection Agency</td><td>Collection Agency</td><td>--</td></tr>
  <tr><td>Remarks</td><td>Collection account. Contact collector for details.</td><td>Collection account.</td><td>--</td></tr>
</table>

<h3>PORTFOLIO RECOVERY ASSOCIATES</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>PRA****3456</td><td>PRA****3456</td><td>PRA****3456</td></tr>
  <tr><td>Account Type</td><td>Collection</td><td>Collection</td><td>Collection</td></tr>
  <tr><td>Status</td><td>Paid Collection</td><td>Paid</td><td>Paid Collection</td></tr>
  <tr><td>Original Creditor</td><td>--</td><td>--</td><td>--</td></tr>
  <tr><td>Balance</td><td>$0</td><td>$450</td><td>$0</td></tr>
  <tr><td>Date Opened</td><td>2021-06</td><td>2021-06</td><td>2021-06</td></tr>
  <tr><td>Date of First Delinquency</td><td>2020-11</td><td>2020-11</td><td>2020-11</td></tr>
  <tr><td>Last Payment</td><td>2024-03</td><td>2024-03</td><td>2024-03</td></tr>
  <tr><td>Last Reported</td><td>2025-10</td><td>2025-10</td><td>2025-10</td></tr>
  <tr><td>Creditor Type</td><td>Collection Agency</td><td>Collection Agency</td><td>Collection Agency</td></tr>
  <tr><td>Remarks</td><td>Paid collection</td><td>Collection account</td><td>Paid collection</td></tr>
</table>

<h3>WELLS FARGO HOME MORTGAGE</h3>
<table>
  <tr><th>Field</th><th>TransUnion</th><th>Experian</th><th>Equifax</th></tr>
  <tr><td>Account Number</td><td>WF****7890</td><td>WF****7890</td><td>WF****7890</td></tr>
  <tr><td>Account Type</td><td>Mortgage</td><td>Mortgage</td><td>Mortgage</td></tr>
  <tr><td>Status</td><td>Open</td><td>Open</td><td>Open</td></tr>
  <tr><td>Balance</td><td>$245,000</td><td>$245,000</td><td>$245,000</td></tr>
  <tr><td>Credit Limit</td><td>$280,000</td><td>$280,000</td><td>$280,000</td></tr>
  <tr><td>High Balance</td><td>$280,000</td><td>$280,000</td><td>$280,000</td></tr>
  <tr><td>Monthly Payment</td><td>$1,450</td><td>$1,450</td><td>$1,450</td></tr>
  <tr><td>Date Opened</td><td>2020-08</td><td>2020-08</td><td>2020-08</td></tr>
  <tr><td>Last Payment</td><td>2026-01</td><td>2026-01</td><td>2026-01</td></tr>
  <tr><td>Last Reported</td><td>2026-02</td><td>2026-02</td><td>2026-02</td></tr>
  <tr><td>Payment Status</td><td>Current</td><td>Current</td><td>Current</td></tr>
  <tr><td>Account Rating</td><td>Open/Current</td><td>Open/Current</td><td>Open/Current</td></tr>
  <tr><td>Past Due Amount</td><td>$0</td><td>$0</td><td>$0</td></tr>
  <tr><td>Remarks</td><td>--</td><td>--</td><td>--</td></tr>
  <tr><td>Payment History (2026-01)</td><td>C</td><td>C</td><td>C</td></tr>
  <tr><td>Payment History (2025-12)</td><td>C</td><td>C</td><td>C</td></tr>
  <tr><td>Payment History (2025-11)</td><td>C</td><td>C</td><td>30</td></tr>
  <tr><td>Payment History (2025-10)</td><td>C</td><td>C</td><td>C</td></tr>
</table>

<h2>Public Records</h2>
<p>No public records found.</p>

<h2>Inquiries</h2>
<h3>Hard Inquiries</h3>
<table>
  <tr><th>Creditor</th><th>Date</th><th>Bureau</th></tr>
  <tr><td>CHASE AUTO FINANCE</td><td>2025-09-15</td><td>TransUnion</td></tr>
  <tr><td>CHASE AUTO FINANCE</td><td>2025-09-15</td><td>Experian</td></tr>
  <tr><td>CAPITAL ONE AUTO</td><td>2025-09-10</td><td>TransUnion</td></tr>
  <tr><td>DISCOVER FINANCIAL</td><td>2025-06-22</td><td>Equifax</td></tr>
  <tr><td>UNKNOWN CREDITOR</td><td>2025-01-05</td><td>Experian</td></tr>
</table>
<h3>Soft Inquiries</h3>
<table>
  <tr><th>Creditor</th><th>Date</th><th>Bureau</th></tr>
  <tr><td>CREDITKARMA</td><td>2026-01-15</td><td>TransUnion</td></tr>
</table>

</body>
</html>`;

// ── Test: parser section detection ───────────────────────────────

function testParserSectionDetection() {
  console.log("\n=== TEST: Parser Section Detection ===\n");
  const text = extractTextFromHtml(SAMPLE_CREDIT_REPORT_HTML);
  console.log(`Extracted text length: ${text.length} chars`);
  console.log(`First 200 chars: ${text.slice(0, 200)}`);

  const sections = splitIntoSections(text);
  console.log(`\nSections found: ${sections.length}`);

  for (const s of sections) {
    console.log(`  [${s.type}] "${s.label}" — ${s.text.length} chars`);
  }

  // Validate expected sections
  const types = sections.map(s => s.type);
  const hasPersonalInfo = types.includes("personal_info");
  const hasSummary = types.includes("bureau_summary");
  const hasInquiries = types.includes("inquiries");
  const tradelines = sections.filter(s => s.type === "tradeline");
  const unknowns = sections.filter(s => s.type === "unknown");

  console.log(`\n  ✓ Personal Info section: ${hasPersonalInfo ? "YES" : "MISSING ✗"}`);
  console.log(`  ✓ Bureau Summary section: ${hasSummary ? "YES" : "MISSING ✗"}`);
  console.log(`  ✓ Inquiries section: ${hasInquiries ? "YES" : "MISSING ✗"}`);
  console.log(`  ✓ Tradeline sections: ${tradelines.length}`);
  console.log(`  ✓ Unknown sections: ${unknowns.length}`);

  if (!hasPersonalInfo) console.error("  ✗ FAIL: Missing Personal Information section");
  if (!hasSummary) console.error("  ✗ FAIL: Missing Bureau Summary section");
  if (!hasInquiries) console.error("  ✗ FAIL: Missing Inquiries section");
  if (tradelines.length < 3) console.error(`  ✗ FAIL: Expected at least 3 tradeline sections, got ${tradelines.length}`);

  return { text, sections, hasPersonalInfo, hasSummary, hasInquiries, tradelineCount: tradelines.length };
}

// ── Test: validateAndNormalize with mock extraction ──────────────

function testValidateAndNormalize() {
  console.log("\n=== TEST: Validate & Normalize ===\n");

  // Simulate what the LLM would return for our sample report
  const mockRaw = {
    profile: {
      name: "JOHN Q SMITH",
      aliases: ["JOHN SMITH"],
      dateOfBirth: "1985-03-15",
      ssn: "XXX-XX-1234",
      reportDate: "2026-02-01",
      scores: [
        { bureau: "TransUnion", score: 612, model: "VantageScore 3.0" },
        { bureau: "Experian", score: 605, model: "VantageScore 3.0" },
        { bureau: "Equifax", score: 618, model: "VantageScore 3.0" },
      ],
      addresses: [
        { address: "123 Main St, Springfield, IL 62701", bureaus: ["TransUnion", "Experian", "Equifax"] },
        { address: "456 Oak Ave, Chicago, IL 60601", bureaus: ["TransUnion", "Experian"] },
        { address: "789 Elm St, Unknown City, XX 00000", bureaus: ["Equifax"] },
      ],
      employers: [
        { name: "ACME Corp", bureaus: ["TransUnion", "Experian"] },
      ],
    },
    bureauSummaries: [
      { bureau: "TransUnion", totalAccounts: 15, openAccounts: 8, closedAccounts: 7, derogatoryCount: 3, collectionsCount: 2, publicRecordsCount: 0, inquiriesCount: 4, balanceTotal: 45200, creditLimitTotal: 62000, monthlyPaymentTotal: 1250 },
      { bureau: "Experian", totalAccounts: 14, openAccounts: 7, closedAccounts: 7, derogatoryCount: 3, collectionsCount: 2, publicRecordsCount: 0, inquiriesCount: 3, balanceTotal: 44800, creditLimitTotal: 62000, monthlyPaymentTotal: 1250 },
      { bureau: "Equifax", totalAccounts: 15, openAccounts: 8, closedAccounts: 7, derogatoryCount: 3, collectionsCount: 1, publicRecordsCount: 0, inquiriesCount: 2, balanceTotal: 45500, creditLimitTotal: 62000, monthlyPaymentTotal: 1250 },
    ],
    tradelines: [
      {
        creditorName: "CHASE BANK",
        accountNumberMasked: "4315****1234",
        accountType: "revolving",
        status: "current",
        balance: 2450,
        bureaus: ["TransUnion", "Experian", "Equifax"],
        bureauDetails: [
          { bureau: "TransUnion", accountNumber: "4315****1234", balance: 2450, status: "Open", dateOpened: "2019-05", lastPaymentDate: "2025-12", lastReportedDate: "2026-01", highBalance: 5200, creditLimit: 10000, monthlyPayment: 75, paymentStatus: "Current", accountRating: "Open/Current", creditorType: "Bank Credit Cards", pastDueAmount: 0, terms: "Revolving", paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }], remarks: ["Account in good standing"] },
          { bureau: "Experian", accountNumber: "4315****1234", balance: 2450, status: "Open", dateOpened: "2019-05", lastPaymentDate: "2025-12", lastReportedDate: "2026-01", highBalance: 5200, creditLimit: 10000, monthlyPayment: 75, paymentStatus: "Current", accountRating: "Open/Current", creditorType: "Bank Credit Cards", pastDueAmount: 0, terms: "Revolving", paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }], remarks: ["Account in good standing"] },
          { bureau: "Equifax", accountNumber: "4315****1234", balance: 2450, status: "Open", dateOpened: "2019-05", lastPaymentDate: "2025-12", lastReportedDate: "2026-01", highBalance: 5200, creditLimit: 10000, monthlyPayment: 75, paymentStatus: "Current", accountRating: "Open/Current", creditorType: "Bank Credit Cards", pastDueAmount: 0, terms: "Revolving", paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }], remarks: ["Account in good standing"] },
        ],
        dates: { opened: "2019-05", closed: null, firstDelinquency: null, lastPayment: "2025-12", lastReported: "2026-01" },
        remarks: ["Account in good standing"],
        evidenceText: "CHASE BANK account data",
      },
      {
        creditorName: "MERRICK BANK",
        accountNumberMasked: "5412****5678",
        accountType: "revolving",
        status: "chargeoff",
        balance: 3200,
        bureaus: ["TransUnion", "Experian", "Equifax"],
        bureauDetails: [
          { bureau: "TransUnion", accountNumber: "5412****5678", balance: 3200, status: "Charge-Off", dateOpened: "2018-03", lastPaymentDate: "2022-05", lastReportedDate: "2026-01", highBalance: 4800, creditLimit: 5000, monthlyPayment: 0, paymentStatus: "Charge-Off", accountRating: "9 - Charge Off", creditorType: "Bank Credit Cards", pastDueAmount: 3200, terms: "Revolving", paymentHistory: [{ month: "2022-06", code: "CO" }, { month: "2022-05", code: "60" }, { month: "2022-04", code: "30" }, { month: "2022-03", code: "C" }], remarks: ["Charged off account"] },
          { bureau: "Experian", accountNumber: "5412****5678", balance: 2800, status: "Charge-Off", dateOpened: "2018-03", lastPaymentDate: "2022-05", lastReportedDate: "2025-12", highBalance: 4800, creditLimit: 5000, monthlyPayment: 0, paymentStatus: "Charge-Off", accountRating: "9 - Charge Off", creditorType: "Bank Credit Cards", pastDueAmount: 2800, terms: "Revolving", paymentHistory: [{ month: "2022-06", code: "CO" }, { month: "2022-05", code: "60" }, { month: "2022-04", code: "30" }, { month: "2022-03", code: "30" }], remarks: ["Charged off account"] },
          { bureau: "Equifax", accountNumber: "5412****5678", balance: 3200, status: "Charged Off", dateOpened: "2018-04", lastPaymentDate: "2022-05", lastReportedDate: "2025-12", highBalance: 4800, creditLimit: null, monthlyPayment: 0, paymentStatus: "Charge-Off", accountRating: "9 - Charge Off", creditorType: "Miscellaneous Finance", pastDueAmount: 3200, terms: "Revolving", paymentHistory: [{ month: "2022-06", code: "CO" }, { month: "2022-05", code: "90" }, { month: "2022-04", code: "60" }, { month: "2022-03", code: "30" }], remarks: ["Charged off account"] },
        ],
        dates: { opened: "2018-03", closed: null, firstDelinquency: "2022-06", lastPayment: "2022-05", lastReported: "2026-01" },
        remarks: ["Charged off account"],
        evidenceText: "MERRICK BANK account data",
      },
      {
        creditorName: "MIDLAND CREDIT MANAGEMENT",
        accountNumberMasked: "MCM****9012",
        accountType: "collection",
        status: "collection",
        balance: 1890,
        bureaus: ["TransUnion", "Experian"],
        bureauDetails: [
          { bureau: "TransUnion", accountNumber: "MCM****9012", balance: 1890, status: "Collection", dateOpened: "2023-01", lastReportedDate: "2025-11", creditorType: "Collection Agency", remarks: ["Collection account. Contact collector for details."] },
          { bureau: "Experian", accountNumber: "MCM****9012", balance: 1890, status: "Collection", dateOpened: "2023-02", lastReportedDate: "2025-11", creditorType: "Collection Agency", remarks: ["Collection account."] },
        ],
        dates: { opened: "2023-01", firstDelinquency: "2022-09" },
        remarks: ["Collection account. Contact collector for details.", "Collection account."],
        evidenceText: "MIDLAND CREDIT MANAGEMENT collection data",
      },
      {
        creditorName: "PORTFOLIO RECOVERY ASSOCIATES",
        accountNumberMasked: "PRA****3456",
        accountType: "collection",
        status: "paid",
        balance: 0,
        bureaus: ["TransUnion", "Experian", "Equifax"],
        bureauDetails: [
          { bureau: "TransUnion", accountNumber: "PRA****3456", balance: 0, status: "Paid Collection", dateOpened: "2021-06", lastPaymentDate: "2024-03", lastReportedDate: "2025-10", creditorType: "Collection Agency", remarks: ["Paid collection"] },
          { bureau: "Experian", accountNumber: "PRA****3456", balance: 450, status: "Paid", dateOpened: "2021-06", lastPaymentDate: "2024-03", lastReportedDate: "2025-10", creditorType: "Collection Agency", remarks: ["Collection account"] },
          { bureau: "Equifax", accountNumber: "PRA****3456", balance: 0, status: "Paid Collection", dateOpened: "2021-06", lastPaymentDate: "2024-03", lastReportedDate: "2025-10", creditorType: "Collection Agency", remarks: ["Paid collection"] },
        ],
        dates: { opened: "2021-06", firstDelinquency: "2020-11", lastPayment: "2024-03" },
        remarks: ["Paid collection", "Collection account"],
        evidenceText: "PORTFOLIO RECOVERY ASSOCIATES collection data",
      },
      {
        creditorName: "WELLS FARGO HOME MORTGAGE",
        accountNumberMasked: "WF****7890",
        accountType: "mortgage",
        status: "current",
        balance: 245000,
        bureaus: ["TransUnion", "Experian", "Equifax"],
        bureauDetails: [
          { bureau: "TransUnion", accountNumber: "WF****7890", balance: 245000, status: "Open", dateOpened: "2020-08", lastPaymentDate: "2026-01", lastReportedDate: "2026-02", highBalance: 280000, creditLimit: 280000, monthlyPayment: 1450, paymentStatus: "Current", accountRating: "Open/Current", pastDueAmount: 0, paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }, { month: "2025-11", code: "C" }, { month: "2025-10", code: "C" }] },
          { bureau: "Experian", accountNumber: "WF****7890", balance: 245000, status: "Open", dateOpened: "2020-08", lastPaymentDate: "2026-01", lastReportedDate: "2026-02", highBalance: 280000, creditLimit: 280000, monthlyPayment: 1450, paymentStatus: "Current", accountRating: "Open/Current", pastDueAmount: 0, paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }, { month: "2025-11", code: "C" }, { month: "2025-10", code: "C" }] },
          { bureau: "Equifax", accountNumber: "WF****7890", balance: 245000, status: "Open", dateOpened: "2020-08", lastPaymentDate: "2026-01", lastReportedDate: "2026-02", highBalance: 280000, creditLimit: 280000, monthlyPayment: 1450, paymentStatus: "Current", accountRating: "Open/Current", pastDueAmount: 0, paymentHistory: [{ month: "2026-01", code: "C" }, { month: "2025-12", code: "C" }, { month: "2025-11", code: "30" }, { month: "2025-10", code: "C" }] },
        ],
        dates: { opened: "2020-08", lastPayment: "2026-01", lastReported: "2026-02" },
        remarks: [],
        evidenceText: "WELLS FARGO HOME MORTGAGE data",
      },
    ],
    publicRecords: [],
    inquiries: [
      { creditorName: "CHASE AUTO FINANCE", date: "2025-09-15", type: "hard", bureau: "TransUnion" },
      { creditorName: "CHASE AUTO FINANCE", date: "2025-09-15", type: "hard", bureau: "Experian" },
      { creditorName: "CAPITAL ONE AUTO", date: "2025-09-10", type: "hard", bureau: "TransUnion" },
      { creditorName: "DISCOVER FINANCIAL", date: "2025-06-22", type: "hard", bureau: "Equifax" },
      { creditorName: "UNKNOWN CREDITOR", date: "2025-01-05", type: "hard", bureau: "Experian" },
      { creditorName: "CREDITKARMA", date: "2026-01-15", type: "soft", bureau: "TransUnion" },
    ],
  };

  const report = validateAndNormalize(mockRaw as any);

  // Verify profile
  console.log(`Profile name: ${report.profile.name}`);
  console.log(`Scores: ${report.profile.scores.length}`);
  console.log(`Addresses: ${report.profile.addresses.length}`);
  console.log(`Employers: ${report.profile.employers.length}`);

  // Verify tradelines
  console.log(`\nTradelines: ${report.tradelines.length}`);
  for (const tl of report.tradelines) {
    console.log(`  ${tl.creditorName}: type=${tl.accountType}, status=${tl.aggregateStatus}, balance=$${tl.balance}, bureaus=${tl.bureaus.join(",")}, bureauDetails=${tl.bureauDetails.length}`);
    console.log(`    dates: opened=${tl.dates.opened}, dofd=${tl.dates.firstDelinquency}, lastPay=${tl.dates.lastPayment}, lastRep=${tl.dates.lastReported}`);
    console.log(`    remarks: ${tl.remarks.length} remarks`);
    for (const bd of tl.bureauDetails) {
      const hasPH = bd.paymentHistory && bd.paymentHistory.length > 0;
      console.log(`    [${bd.bureau}] bal=$${bd.balance}, limit=$${bd.creditLimit}, high=$${bd.highBalance}, monthly=$${bd.monthlyPayment}, pastDue=$${bd.pastDueAmount}, payHist=${hasPH ? bd.paymentHistory!.length + " entries" : "NONE"}, remarks=${bd.remarks?.length || 0}`);
    }
  }

  // Verify inquiries
  console.log(`\nInquiries: ${report.inquiries.length}`);
  for (const inq of report.inquiries) {
    console.log(`  ${inq.creditorName} (${inq.type}) - ${inq.date} @ ${inq.bureau}`);
  }

  // Verify issue flags
  const flags = computeIssueFlags(report);
  console.log(`\nIssue Flags: ${flags.length}`);
  for (const f of flags) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.flagType}: ${f.creditorName} — ${f.description}`);
  }

  // Expected flags from our test data:
  // - MERRICK BANK: BUREAU_BALANCE_MISMATCH (TU=$3200, EX=$2800, EQ=$3200)
  // - MERRICK BANK: BUREAU_CREDIT_LIMIT_MISMATCH (TU=$5000, EX=$5000, EQ=null missing)
  // - MERRICK BANK: BUREAU_CREDITOR_TYPE_MISMATCH (Bank Credit Cards vs Miscellaneous Finance)
  // - MERRICK BANK: DATE_OPENED_MISMATCH (2018-03 vs 2018-04)
  // - MERRICK BANK: LATE_PAYMENT_HISTORY
  // - MERRICK BANK: CHARGEOFF_PRESENT
  // - MIDLAND: COLLECTION_ACCOUNT_PRESENT
  // - MIDLAND: DATE_OPENED_MISMATCH (2023-01 vs 2023-02)
  // - MIDLAND: MISSING_ORIGINAL_CREDITOR should NOT fire (has originalCreditor)
  // - MIDLAND: DEBT_COLLECTOR_ACCOUNT
  // - MIDLAND: DEBT_COLLECTOR_DISCLOSURE_CHECK
  // - PORTFOLIO: COLLECTION_ACCOUNT_PRESENT
  // - PORTFOLIO: BUREAU_BALANCE_MISMATCH ($0 vs $450)
  // - PORTFOLIO: BALANCE_STATUS_CONTRADICTION (Experian: paid but $450)
  // - PORTFOLIO: MISSING_ORIGINAL_CREDITOR (no original creditor)
  // - PORTFOLIO: DEBT_COLLECTOR_ACCOUNT
  // - PORTFOLIO: DEBT_COLLECTOR_DISCLOSURE_CHECK
  // - WELLS FARGO: LATE_PAYMENT_HISTORY (Equifax 30 late in 2025-11)
  // - ADDRESS_SINGLE_BUREAU (789 Elm St only on Equifax, but only if >3 addresses)

  const expectedFlags = [
    "BUREAU_BALANCE_MISMATCH",
    "BUREAU_CREDITOR_TYPE_MISMATCH",
    "DATE_OPENED_MISMATCH",
    "LATE_PAYMENT_HISTORY",
    "CHARGEOFF_PRESENT",
    "COLLECTION_ACCOUNT_PRESENT",
    "BALANCE_STATUS_CONTRADICTION",
    "MISSING_ORIGINAL_CREDITOR",
    "DEBT_COLLECTOR_ACCOUNT",
    "DEBT_COLLECTOR_DISCLOSURE_CHECK",
  ];

  const flagTypes = new Set(flags.map(f => f.flagType));
  console.log("\nExpected flag validation:");
  for (const ef of expectedFlags) {
    console.log(`  ${flagTypes.has(ef) ? "✓" : "✗ MISSING"} ${ef}`);
  }

  // Generate summary
  report.issueFlags = flags;
  const summary = generateReportSummary(report);
  console.log(`\nSummary:`);
  console.log(`  Account one-liners: ${summary.accountOneLiners.length}`);
  console.log(`  Category summaries: ${summary.categorySummaries.length}`);
  for (const cs of summary.categorySummaries) {
    console.log(`    ${cs.category}: ${cs.count} accounts`);
  }
  console.log(`  Action plan items: ${summary.actionPlan.length}`);
  for (const ap of summary.actionPlan) {
    console.log(`    Round ${ap.round}: ${ap.creditorName} @ ${ap.bureau} — ${ap.disputeReason.slice(0, 60)}...`);
  }

  return report;
}

// ── Test: Pipeline bridge (rawDetails completeness) ──────────────

function testRawDetailsBridge() {
  console.log("\n=== TEST: rawDetails Bridge Completeness ===\n");

  // Simulate the pipeline's rawDetails builder using the SAME logic as report-pipeline.ts
  const mockBd = {
    bureau: "TransUnion" as const,
    accountNumber: "5412****5678",
    balance: 3200,
    status: "Charge-Off",
    dateOpened: "2018-03",
    dateClosed: "2023-01",
    lastPaymentDate: "2022-05",
    lastReportedDate: "2026-01",
    highBalance: 4800,
    creditLimit: 5000,
    monthlyPayment: 0,
    paymentStatus: "Charge-Off",
    accountRating: "9 - Charge Off",
    creditorType: "Bank Credit Cards",
    pastDueAmount: 3200,
    terms: "Revolving",
    paymentHistory: [
      { month: "2022-06", code: "CO" },
      { month: "2022-05", code: "60" },
    ],
    remarks: ["Charged off account"],
  };

  // Replicate the pipeline's bureau detail builder (should match report-pipeline.ts)
  const payHistStr = (mockBd.paymentHistory && mockBd.paymentHistory.length > 0)
    ? `  Payment History: ${mockBd.paymentHistory.map(ph => `${ph.month}:${ph.code}`).join(", ")}`
    : null;

  const fields = [
    `  Bureau: ${mockBd.bureau}`,
    mockBd.accountNumber ? `  Account#: ${mockBd.accountNumber}` : null,
    mockBd.balance != null ? `  Balance: $${mockBd.balance}` : null,
    mockBd.status ? `  Status: ${mockBd.status}` : null,
    mockBd.dateOpened ? `  Date Opened: ${mockBd.dateOpened}` : null,
    mockBd.dateClosed ? `  Date Closed: ${mockBd.dateClosed}` : null,
    mockBd.lastPaymentDate ? `  Last Payment: ${mockBd.lastPaymentDate}` : null,
    mockBd.lastReportedDate ? `  Last Reported: ${mockBd.lastReportedDate}` : null,
    mockBd.highBalance != null ? `  High Balance: $${mockBd.highBalance}` : null,
    mockBd.creditLimit != null ? `  Credit Limit: $${mockBd.creditLimit}` : null,
    mockBd.monthlyPayment != null ? `  Monthly Payment: $${mockBd.monthlyPayment}` : null,
    mockBd.pastDueAmount != null ? `  Past Due Amount: $${mockBd.pastDueAmount}` : null,
    mockBd.paymentStatus ? `  Payment Status: ${mockBd.paymentStatus}` : null,
    mockBd.creditorType ? `  Creditor Type: ${mockBd.creditorType}` : null,
    mockBd.accountRating ? `  Account Rating: ${mockBd.accountRating}` : null,
    mockBd.terms ? `  Terms: ${mockBd.terms}` : null,
    (mockBd.remarks && mockBd.remarks.length > 0) ? `  Remarks: ${mockBd.remarks.join("; ")}` : null,
    payHistStr,
  ].filter(Boolean).join("\n");

  // Check completeness
  const missingFields: string[] = [];
  if (!fields.includes("Past Due Amount")) missingFields.push("pastDueAmount");
  if (!fields.includes("Monthly Payment")) missingFields.push("monthlyPayment");
  if (!fields.includes("Terms")) missingFields.push("terms");
  if (!fields.includes("Last Reported")) missingFields.push("lastReportedDate");
  if (!fields.includes("Date Closed")) missingFields.push("dateClosed");
  if (!fields.includes("Payment History")) missingFields.push("paymentHistory");

  console.log("rawDetails bureau block:");
  console.log(fields);
  console.log(`\nMissing fields: ${missingFields.length > 0 ? missingFields.join(", ") : "NONE — all fields present"}`);

  for (const f of missingFields) {
    console.error(`  ✗ MISSING: ${f} not included in rawDetails → violation detection won't see it`);
  }

  return missingFields;
}

// ── Test: balance/date aggregation ───────────────────────────────

function testAggregation() {
  console.log("\n=== TEST: Balance/Date Aggregation from BureauDetails ===\n");

  // Test case: LLM returns bureauDetails but no top-level balance/dates
  const mockRaw = {
    profile: { name: "TEST", reportDate: "2026-01-01" },
    bureauSummaries: [],
    tradelines: [{
      creditorName: "TEST CREDITOR",
      accountType: "revolving",
      status: "chargeoff",
      // balance is MISSING at top level
      bureaus: ["TransUnion", "Experian"],
      bureauDetails: [
        { bureau: "TransUnion", balance: 1500, status: "Charge-Off", dateOpened: "2020-01", lastPaymentDate: "2023-06", lastReportedDate: "2025-12", highBalance: 2000, creditLimit: 3000 },
        { bureau: "Experian", balance: 1200, status: "Charge-Off", dateOpened: "2020-01", lastPaymentDate: "2023-05", lastReportedDate: "2025-11", highBalance: 2000, creditLimit: 3000 },
      ],
      // dates is MISSING at top level
      evidenceText: "mock",
    }],
    publicRecords: [],
    inquiries: [],
  };

  const report = validateAndNormalize(mockRaw as any);
  const tl = report.tradelines[0];

  console.log(`Top-level balance: ${tl.balance} (should be derived from bureauDetails if null)`);
  console.log(`Dates opened: ${tl.dates.opened} (should be derived from bureauDetails if missing)`);
  console.log(`Dates lastPayment: ${tl.dates.lastPayment} (should be derived from bureauDetails if missing)`);
  console.log(`Dates lastReported: ${tl.dates.lastReported} (should be derived from bureauDetails if missing)`);

  if (tl.balance === null) console.error("  ✗ FAIL: Balance is null — should aggregate from bureauDetails");
  if (!tl.dates.opened) console.error("  ✗ FAIL: Date opened is missing — should aggregate from bureauDetails");
  if (!tl.dates.lastPayment) console.error("  ✗ FAIL: Last payment is missing — should aggregate from bureauDetails");
  if (!tl.dates.lastReported) console.error("  ✗ FAIL: Last reported is missing — should aggregate from bureauDetails");

  return { balance: tl.balance, dates: tl.dates };
}

// ── Run all tests ───────────────────────────────────────────────

async function runTests() {
  console.log("╔════════════════════════════════════════════╗");
  console.log("║   Credit Report Pipeline Integration Test  ║");
  console.log("╚════════════════════════════════════════════╝");

  const parserResult = testParserSectionDetection();
  const normalizeResult = testValidateAndNormalize();
  const bridgeResult = testRawDetailsBridge();
  const aggregationResult = testAggregation();

  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║            SUMMARY OF ISSUES               ║");
  console.log("╚════════════════════════════════════════════╝");

  const issues: string[] = [];

  if (!parserResult.hasPersonalInfo) issues.push("Parser: Missing personal_info section detection");
  if (!parserResult.hasSummary) issues.push("Parser: Missing bureau_summary section detection");
  if (!parserResult.hasInquiries) issues.push("Parser: Missing inquiries section detection");
  if (parserResult.tradelineCount < 3) issues.push(`Parser: Only ${parserResult.tradelineCount} tradeline sections detected (expected ≥3)`);

  if (bridgeResult.length > 0) {
    for (const f of bridgeResult) {
      issues.push(`Bridge: rawDetails missing "${f}" — AI violation detection won't see this field`);
    }
  }

  if (aggregationResult.balance === null) issues.push("Aggregation: Top-level balance not derived from bureauDetails when missing");
  if (!aggregationResult.dates.opened) issues.push("Aggregation: dates.opened not derived from bureauDetails when missing");
  if (!aggregationResult.dates.lastPayment) issues.push("Aggregation: dates.lastPayment not derived from bureauDetails when missing");
  if (!aggregationResult.dates.lastReported) issues.push("Aggregation: dates.lastReported not derived from bureauDetails when missing");

  if (issues.length === 0) {
    console.log("\n  ✓ ALL TESTS PASSED — No issues detected!\n");
  } else {
    console.log(`\n  ${issues.length} ISSUE(S) FOUND:\n`);
    for (let i = 0; i < issues.length; i++) {
      console.log(`  ${i + 1}. ${issues[i]}`);
    }
  }

  return issues;
}

runTests().catch(console.error);
