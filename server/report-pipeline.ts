/**
 * Credit Report Processing Pipeline
 *
 * Orchestrates the full parse → normalize → flag → summarize flow:
 *
 * 1. parseReportFile()    → Extract text, split into sections
 * 2. extractCreditReport() → Two-pass LLM extraction + validation
 * 3. computeIssueFlags()  → Deterministic rule-based flags
 * 4. generateReportSummary() → Hierarchical summaries
 * 5. Store structured JSON + evidence in DB
 * 6. Convert to legacy NegativeAccount format for existing violation detection
 */

import { parseReportFile } from "./report-parser";
import { extractCreditReport } from "./report-extractor";
import { computeIssueFlags } from "./issue-flags";
import { generateReportSummary } from "./report-summary";
import { storage } from "./storage";
import { detectViolations } from "./ai-services";
import type { ParsedCreditReport, Tradeline, IssueFlag } from "@shared/credit-report-types";

export interface PipelineResult {
  scanId: number;
  parsedReportId: number;
  consumerName: string;
  parsedReport: ParsedCreditReport;
  accountsCreated: number;
  violationsFound: number;
  issueFlagsDetected: number;
}

export async function runReportPipeline(
  content: string,
  fileType: string,
  fileName?: string,
  pdfBuffer?: Buffer,
  imageBuffer?: Buffer,
): Promise<PipelineResult> {
  // ── Step 1: Parse → Section Chunks ──────────────────────────────
  console.log(`[pipeline] Step 1: Parsing file (${fileType})`);
  const extracted = await parseReportFile(content, fileType, pdfBuffer, imageBuffer);
  console.log(`[pipeline] Parsed ${extracted.sections.length} section(s), ${extracted.fullText.length} chars`);

  // ── Step 2: LLM Extraction → Structured JSON ───────────────────
  console.log(`[pipeline] Step 2: Two-pass LLM extraction`);
  const parsedReport = await extractCreditReport(
    extracted.sections,
    imageBuffer,
    fileType.startsWith("image/") ? fileType : undefined,
  );

  // ── Step 3: Rule-Based Issue Flags ─────────────────────────────
  console.log(`[pipeline] Step 3: Computing deterministic issue flags`);
  parsedReport.issueFlags = computeIssueFlags(parsedReport);
  console.log(`[pipeline] ${parsedReport.issueFlags.length} issue flags detected`);

  // ── Step 4: Hierarchical Summaries ─────────────────────────────
  console.log(`[pipeline] Step 4: Generating hierarchical summaries`);
  parsedReport.summary = generateReportSummary(parsedReport);

  // ── Step 5: Store metadata ─────────────────────────────────────
  parsedReport.metadata.sourceFileName = fileName;
  parsedReport.metadata.sourceFileType = fileType;

  // ── Step 6: Create scan + persist to DB ────────────────────────
  console.log(`[pipeline] Step 5: Storing in database`);

  const scan = await storage.createScan({
    consumerName: parsedReport.profile.name || "Unknown Consumer",
    status: "in_progress",
    currentStep: 4,
  });

  // Store the full parsed report JSON
  const parsedReportRecord = await storage.createParsedReport({
    scanId: scan.id,
    reportJson: parsedReport as any,
    profileJson: parsedReport.profile as any,
    issueFlagsJson: parsedReport.issueFlags as any,
    summaryJson: parsedReport.summary as any,
    sourceFileName: fileName || null,
    sourceFileType: fileType || null,
    parserVersion: parsedReport.metadata.parserVersion,
    tradelineCount: parsedReport.tradelines.length,
    issueFlagCount: parsedReport.issueFlags.length,
  });

  // ── Step 7: Store per-tradeline evidence ───────────────────────
  for (const tl of parsedReport.tradelines) {
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );

    await storage.createTradelineEvidence({
      parsedReportId: parsedReportRecord.id,
      creditorName: tl.creditorName,
      accountNumberMasked: tl.accountNumberMasked || null,
      tradelineJson: tl as any,
      evidenceText: tl.evidenceText || "",
      bureaus: tl.bureaus.join(", "),
      issueFlagsJson: tradelineFlags as any,
    });
  }

  // ── Step 8: Bridge to legacy format ────────────────────────────
  // Create NegativeAccounts + run violation detection (preserves existing workflow)
  let totalViolations = 0;

  for (const tl of parsedReport.tradelines) {
    // Only create NegativeAccounts for problematic tradelines (not clean current accounts)
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );

    const isNegative = tl.aggregateStatus !== "current" ||
      tradelineFlags.length > 0 ||
      tl.accountType === "collection";

    if (!isNegative) continue;

    const accountType = mapAccountType(tl.accountType, tl.aggregateStatus);

    // Build rawDetails with structured evidence + issue flags
    const flagLines = tradelineFlags.map(f =>
      `[${f.severity.toUpperCase()}] ${f.flagType}: ${f.description}`
    ).join("\n");

    const bureauLines = tl.bureauDetails.map(bd => {
      // Format payment history if available
      const payHistStr = (bd.paymentHistory && bd.paymentHistory.length > 0)
        ? `  Payment History: ${bd.paymentHistory.map(ph => `${ph.month}:${ph.code}`).join(", ")}`
        : null;

      const fields = [
        `  Bureau: ${bd.bureau}`,
        bd.accountNumber ? `  Account#: ${bd.accountNumber}` : null,
        bd.balance != null ? `  Balance: $${bd.balance}` : null,
        bd.status ? `  Status: ${bd.status}` : null,
        bd.dateOpened ? `  Date Opened: ${bd.dateOpened}` : null,
        bd.dateClosed ? `  Date Closed: ${bd.dateClosed}` : null,
        bd.lastPaymentDate ? `  Last Payment: ${bd.lastPaymentDate}` : null,
        bd.lastReportedDate ? `  Last Reported: ${bd.lastReportedDate}` : null,
        bd.highBalance != null ? `  High Balance: $${bd.highBalance}` : null,
        bd.creditLimit != null ? `  Credit Limit: $${bd.creditLimit}` : null,
        bd.monthlyPayment != null ? `  Monthly Payment: $${bd.monthlyPayment}` : null,
        bd.pastDueAmount != null ? `  Past Due Amount: $${bd.pastDueAmount}` : null,
        bd.paymentStatus ? `  Payment Status: ${bd.paymentStatus}` : null,
        bd.creditorType ? `  Creditor Type: ${bd.creditorType}` : null,
        bd.accountRating ? `  Account Rating: ${bd.accountRating}` : null,
        bd.terms ? `  Terms: ${bd.terms}` : null,
        (bd.remarks && bd.remarks.length > 0) ? `  Remarks: ${bd.remarks.join("; ")}` : null,
        payHistStr,
      ].filter(Boolean).join("\n");
      return fields;
    }).join("\n---\n");

    const rawDetails = [
      `Creditor: ${tl.creditorName}`,
      tl.accountNumberMasked ? `Account: ${tl.accountNumberMasked}` : null,
      `Type: ${tl.accountType}`,
      `Status: ${tl.aggregateStatus}`,
      tl.originalCreditor ? `Original Creditor: ${tl.originalCreditor}` : null,
      tl.balance != null ? `Balance: $${tl.balance}` : null,
      tl.dates.opened ? `Date Opened: ${tl.dates.opened}` : null,
      tl.dates.closed ? `Date Closed: ${tl.dates.closed}` : null,
      tl.dates.firstDelinquency ? `DOFD: ${tl.dates.firstDelinquency}` : null,
      tl.dates.lastPayment ? `Last Payment: ${tl.dates.lastPayment}` : null,
      tl.dates.lastReported ? `Last Reported: ${tl.dates.lastReported}` : null,
      tl.bureaus.length > 0 ? `Bureaus: ${tl.bureaus.join(", ")}` : null,
      tl.remarks.length > 0 ? `\nRemarks:\n${tl.remarks.map(r => `  - ${r}`).join("\n")}` : null,
      bureauLines ? `\nPer-Bureau Details:\n${bureauLines}` : null,
      flagLines ? `\nRule-Based Flags:\n${flagLines}` : null,
    ].filter(Boolean).join("\n");

    const negAccount = await storage.createNegativeAccount({
      scanId: scan.id,
      creditor: tl.creditorName,
      accountNumber: tl.accountNumberMasked || null,
      accountType,
      originalCreditor: tl.originalCreditor || null,
      balance: tl.balance != null ? tl.balance : null,
      dateOpened: tl.dates.opened || tl.dates.lastPayment || null,
      dateOfDelinquency: tl.dates.firstDelinquency || null,
      status: tl.aggregateStatus || null,
      bureaus: tl.bureaus.join(", ") || null,
      rawDetails,
      workflowStep: "classified",
    });

    // Run AI violation detection — now with pre-computed flags in the rawDetails
    try {
      const detected = await detectViolations(negAccount, null);
      for (const v of detected) {
        await storage.createViolation({
          negativeAccountId: negAccount.id,
          violationType: v.violationType,
          severity: v.severity,
          explanation: v.explanation,
          fcraStatute: v.fcraStatute,
          evidence: v.evidence || null,
          matchedRule: v.matchedRule || null,
          category: v.category || "FCRA_REPORTING",
          evidenceRequired: v.evidenceRequired || null,
          evidenceProvided: v.evidenceProvided || false,
          evidenceNotes: v.evidenceNotes || null,
          confidence: v.confidence || "possible",
          croReminder: v.croReminder || null,
        });
        totalViolations++;
      }
      await storage.updateWorkflowStep(negAccount.id, "scanned");
    } catch (violationErr) {
      console.error(`[pipeline] Violation scan failed for ${tl.creditorName}:`, violationErr);
    }
  }

  console.log(`[pipeline] Complete: ${parsedReport.tradelines.length} tradelines, ${parsedReport.issueFlags.length} flags, ${totalViolations} violations`);

  return {
    scanId: scan.id,
    parsedReportId: parsedReportRecord.id,
    consumerName: parsedReport.profile.name,
    parsedReport,
    accountsCreated: parsedReport.tradelines.length,
    violationsFound: totalViolations,
    issueFlagsDetected: parsedReport.issueFlags.length,
  };
}

function mapAccountType(type: string, status: string): string {
  if (type === "collection" || status === "collection") return "debt_collection";
  if (status === "chargeoff") return "charge_off";
  if (status === "repossession") return "repossession";
  if (status === "derogatory" || status === "late") return "charge_off";
  return "debt_collection";
}
