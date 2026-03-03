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
import type {
  ParsedCreditReport,
  Tradeline,
  TradeBureauDetail,
  IssueFlag,
  OrganizedCreditReport,
  CreditorContact,
  Bureau,
  AccountType,
  AccountStatus,
} from "@shared/credit-report-types";

export interface PipelineResult {
  scanId: number;
  parsedReportId: number;
  consumerName: string;
  parsedReport: ParsedCreditReport;
  accountsCreated: number;
  violationsFound: number;
  issueFlagsDetected: number;
}

export interface StructureResult {
  scanId: number;
  parsedReportId: number;
  consumerName: string;
  parsedReport: ParsedCreditReport;
  tradelineCount: number;
  issueFlagsDetected: number;
}

export interface ViolationResult {
  scanId: number;
  accountsCreated: number;
  violationsFound: number;
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

/**
 * Transform a ParsedCreditReport into the organized JSON format
 * with standard credit report sections:
 *   Credit Scores, Personal Info, Consumer Statement, Account Summary,
 *   Account History, Public Information, Inquiries, Collections, Creditor Contacts
 */
export function organizeReport(report: ParsedCreditReport): OrganizedCreditReport {
  // ── Credit Scores per Bureau ──
  const scoreMap: Record<Bureau, { score: number | null; model?: string } | null> = {
    TransUnion: null,
    Experian: null,
    Equifax: null,
  };
  for (const s of report.profile.scores) {
    scoreMap[s.bureau] = { score: s.score, model: s.model };
  }

  // ── Personal Information ──
  const personalInformation = {
    name: report.profile.name,
    aliases: report.profile.aliases || [],
    dateOfBirth: report.profile.dateOfBirth || null,
    ssn: report.profile.ssn || null,
    reportDate: report.profile.reportDate,
    addresses: report.profile.addresses,
    employers: report.profile.employers,
  };

  // ── Consumer Statements ──
  const consumerStatements = report.consumerStatements || [];

  // ── Separate collections from regular account history ──
  const collections: Tradeline[] = [];
  const accountHistory: Tradeline[] = [];
  for (const tl of report.tradelines) {
    if (tl.accountType === "collection" || tl.aggregateStatus === "collection") {
      collections.push(tl);
    } else {
      accountHistory.push(tl);
    }
  }

  // ── Account Summary (aggregate from bureau summaries or compute from tradelines) ──
  let totalAccounts = 0;
  let openAccounts = 0;
  let closedAccounts = 0;
  let derogatoryAccounts = 0;
  let collectionAccounts = collections.length;
  let totalBalance: number | null = null;
  let totalCreditLimit: number | null = null;
  let totalMonthlyPayment: number | null = null;

  if (report.bureauSummaries.length > 0) {
    // Use the max values across bureaus for totals
    for (const bs of report.bureauSummaries) {
      totalAccounts = Math.max(totalAccounts, bs.totalAccounts);
      openAccounts = Math.max(openAccounts, bs.openAccounts);
      closedAccounts = Math.max(closedAccounts, bs.closedAccounts);
      derogatoryAccounts = Math.max(derogatoryAccounts, bs.derogatoryCount);
      if (bs.balanceTotal != null) {
        totalBalance = Math.max(totalBalance || 0, bs.balanceTotal);
      }
      if (bs.creditLimitTotal != null) {
        totalCreditLimit = Math.max(totalCreditLimit || 0, bs.creditLimitTotal);
      }
      if (bs.monthlyPaymentTotal != null) {
        totalMonthlyPayment = Math.max(totalMonthlyPayment || 0, bs.monthlyPaymentTotal);
      }
    }
  } else {
    // Compute from tradelines
    totalAccounts = report.tradelines.length;
    for (const tl of report.tradelines) {
      if (tl.aggregateStatus === "current" || tl.aggregateStatus === "late") openAccounts++;
      if (tl.aggregateStatus === "closed" || tl.aggregateStatus === "paid" || tl.aggregateStatus === "settled") closedAccounts++;
      if (tl.aggregateStatus === "chargeoff" || tl.aggregateStatus === "derogatory" || tl.aggregateStatus === "repossession") derogatoryAccounts++;
      if (tl.balance != null) totalBalance = (totalBalance || 0) + tl.balance;
    }
  }

  // ── Creditor Contacts ──
  const contactMap = new Map<string, CreditorContact>();
  for (const tl of report.tradelines) {
    const key = tl.creditorName.toLowerCase().trim();
    if (!contactMap.has(key)) {
      // Extract address/phone from bureau details remarks if available
      let address: string | undefined;
      let phone: string | undefined;
      for (const bd of tl.bureauDetails) {
        for (const remark of bd.remarks || []) {
          // Try to extract phone numbers from remarks
          const phoneMatch = remark.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
          if (phoneMatch && !phone) phone = phoneMatch[0];
        }
      }
      // Check if address info is in the evidence text
      if (tl.evidenceText) {
        const addrMatch = tl.evidenceText.match(/(?:Address|Addr)[:\s]+([^\n]+)/i);
        if (addrMatch) address = addrMatch[1].trim();
        if (!phone) {
          const phoneMatch2 = tl.evidenceText.match(/(?:Phone|Tel)[:\s]+(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i);
          if (phoneMatch2) phone = phoneMatch2[1].trim();
        }
      }

      contactMap.set(key, {
        creditorName: tl.creditorName,
        address,
        phone,
        accountNumberMasked: tl.accountNumberMasked,
        accountType: tl.accountType,
        bureaus: tl.bureaus,
      });
    }
  }

  return {
    creditScores: {
      TransUnion: scoreMap.TransUnion,
      Experian: scoreMap.Experian,
      Equifax: scoreMap.Equifax,
    },
    personalInformation,
    consumerStatements,
    accountSummary: {
      totalAccounts,
      openAccounts,
      closedAccounts,
      derogatoryAccounts,
      collectionAccounts,
      publicRecordCount: report.publicRecords.length,
      totalBalance,
      totalCreditLimit,
      totalMonthlyPayment,
      perBureau: report.bureauSummaries,
    },
    accountHistory,
    publicInformation: report.publicRecords,
    inquiries: report.inquiries,
    collections,
    creditorContacts: Array.from(contactMap.values()),
    metadata: {
      parsedAt: report.metadata.parsedAt,
      sourceFileName: report.metadata.sourceFileName,
      sourceFileType: report.metadata.sourceFileType,
      totalPages: report.metadata.totalPages,
      parserVersion: report.metadata.parserVersion,
      organizedAt: new Date().toISOString(),
    },
  };
}

/**
 * Structure-Only Pipeline (No Violations)
 *
 * Runs parse → LLM extraction → issue flags → summary → DB storage
 * but does NOT create NegativeAccounts or run AI violation detection.
 * Returns the structured JSON for frontend review before violations are run.
 */
export async function runStructurePipeline(
  content: string,
  fileType: string,
  fileName?: string,
  pdfBuffer?: Buffer,
  imageBuffer?: Buffer,
): Promise<StructureResult> {
  // ── Step 1: Parse → Section Chunks ──────────────────────────────
  console.log(`[structure-pipeline] Step 1: Parsing file (${fileType})`);
  const extracted = await parseReportFile(content, fileType, pdfBuffer, imageBuffer);
  console.log(`[structure-pipeline] Parsed ${extracted.sections.length} section(s), ${extracted.fullText.length} chars`);

  // ── Step 2: LLM Extraction → Structured JSON ───────────────────
  console.log(`[structure-pipeline] Step 2: Two-pass LLM extraction`);
  const parsedReport = await extractCreditReport(
    extracted.sections,
    imageBuffer,
    fileType.startsWith("image/") ? fileType : undefined,
  );

  // ── Step 3: Rule-Based Issue Flags ─────────────────────────────
  console.log(`[structure-pipeline] Step 3: Computing deterministic issue flags`);
  parsedReport.issueFlags = computeIssueFlags(parsedReport);
  console.log(`[structure-pipeline] ${parsedReport.issueFlags.length} issue flags detected`);

  // ── Step 4: Hierarchical Summaries ─────────────────────────────
  console.log(`[structure-pipeline] Step 4: Generating hierarchical summaries`);
  parsedReport.summary = generateReportSummary(parsedReport);

  // ── Step 5: Store metadata ─────────────────────────────────────
  parsedReport.metadata.sourceFileName = fileName;
  parsedReport.metadata.sourceFileType = fileType;

  // ── Step 6: Create scan + persist to DB ────────────────────────
  console.log(`[structure-pipeline] Step 5: Storing in database`);

  const scan = await storage.createScan({
    consumerName: parsedReport.profile.name || "Unknown Consumer",
    status: "in_progress",
    currentStep: 3,
  });

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

  console.log(`[structure-pipeline] Complete: ${parsedReport.tradelines.length} tradelines, ${parsedReport.issueFlags.length} flags`);

  return {
    scanId: scan.id,
    parsedReportId: parsedReportRecord.id,
    consumerName: parsedReport.profile.name,
    parsedReport,
    tradelineCount: parsedReport.tradelines.length,
    issueFlagsDetected: parsedReport.issueFlags.length,
  };
}

/**
 * Violation-Only Pipeline
 *
 * Takes an existing scan (with parsedReport) and creates NegativeAccounts +
 * runs AI violation detection. This is the second step after structure-only.
 */
export async function runViolationPipeline(scanId: number): Promise<ViolationResult> {
  const scan = await storage.getScan(scanId);
  if (!scan) throw new Error("Scan not found");

  const parsedReportRecord = await storage.getParsedReportByScan(scanId);
  if (!parsedReportRecord) throw new Error("Parsed report not found — run structuring first");

  const parsedReport = parsedReportRecord.reportJson as unknown as ParsedCreditReport;
  if (!parsedReport?.tradelines) throw new Error("Invalid parsed report data");

  console.log(`[violation-pipeline] Running violation detection for scan ${scanId} (${parsedReport.tradelines.length} tradelines)`);

  let totalViolations = 0;

  for (const tl of parsedReport.tradelines) {
    const tradelineFlags = (parsedReport.issueFlags || []).filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );

    const isNegative = tl.aggregateStatus !== "current" ||
      tradelineFlags.length > 0 ||
      tl.accountType === "collection";

    if (!isNegative) continue;

    const accountType = mapAccountType(tl.accountType, tl.aggregateStatus);

    const flagLines = tradelineFlags.map(f =>
      `[${f.severity.toUpperCase()}] ${f.flagType}: ${f.description}`
    ).join("\n");

    const bureauLines = tl.bureauDetails.map(bd => {
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
      scanId,
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

    try {
      const detected = await detectViolations(negAccount, scan.clientState || null);
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
      console.error(`[violation-pipeline] Violation scan failed for ${tl.creditorName}:`, violationErr);
    }
  }

  // Update scan step to indicate violations are done
  await storage.updateScanStep(scanId, 4);

  console.log(`[violation-pipeline] Complete: ${totalViolations} violations detected`);

  return {
    scanId,
    accountsCreated: parsedReport.tradelines.filter(tl => {
      const flags = (parsedReport.issueFlags || []).filter(f =>
        f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
      );
      return tl.aggregateStatus !== "current" || flags.length > 0 || tl.accountType === "collection";
    }).length,
    violationsFound: totalViolations,
  };
}

/**
 * Manual Entry Pipeline
 *
 * Converts manually entered NegativeAccounts into the structured ParsedCreditReport
 * format, then runs issue flags, summary generation, and AI violation detection.
 *
 * Manual Workflow:
 *   Manual Data Entry → Convert into Structured JSON → AI Analysis → Paralegal Review → Export
 */
export async function runManualEntryPipeline(scanId: number): Promise<PipelineResult> {
  const scan = await storage.getScan(scanId);
  if (!scan) throw new Error("Scan not found");

  const negAccounts = await storage.getNegativeAccountsByScan(scanId);
  if (negAccounts.length === 0) throw new Error("No accounts to analyze");

  console.log(`[manual-pipeline] Converting ${negAccounts.length} manual accounts to structured JSON`);

  // ── Step 1: Convert manual entries into structured tradelines ──
  const tradelines: Tradeline[] = negAccounts.map(acct => {
    const bureauNames = (acct.bureaus || "TransUnion, Experian, Equifax")
      .split(",")
      .map(b => b.trim())
      .filter(Boolean);
    const bureaus: Bureau[] = bureauNames
      .map(b => {
        const n = b.toLowerCase();
        if (n.includes("transunion") || n === "tu") return "TransUnion" as Bureau;
        if (n.includes("experian") || n === "ex") return "Experian" as Bureau;
        if (n.includes("equifax") || n === "eq") return "Equifax" as Bureau;
        return null;
      })
      .filter((b): b is Bureau => b !== null);

    if (bureaus.length === 0) bureaus.push("TransUnion", "Experian", "Equifax");

    const accountType = mapManualAccountType(acct.accountType);
    const aggregateStatus = mapManualStatus(acct.status || acct.accountType);

    const bureauDetails: TradeBureauDetail[] = bureaus.map(bureau => ({
      bureau,
      accountNumber: acct.accountNumber || undefined,
      balance: acct.balance != null ? Number(acct.balance) : null,
      status: acct.status || undefined,
      dateOpened: acct.dateOpened || undefined,
      creditLimit: null,
      highBalance: null,
      monthlyPayment: null,
      pastDueAmount: null,
      paymentHistory: [],
      remarks: [],
    }));

    return {
      creditorName: acct.creditor,
      accountNumberMasked: acct.accountNumber || undefined,
      accountType,
      aggregateStatus,
      originalCreditor: acct.originalCreditor || undefined,
      balance: acct.balance != null ? Number(acct.balance) : null,
      bureaus,
      bureauDetails,
      dates: {
        opened: acct.dateOpened || undefined,
        firstDelinquency: acct.dateOfDelinquency || undefined,
      },
      remarks: [],
      evidenceText: acct.rawDetails || "",
    };
  });

  // ── Step 2: Build the ParsedCreditReport structure ──
  const parsedReport: ParsedCreditReport = {
    profile: {
      name: scan.consumerName,
      reportDate: new Date().toISOString().split("T")[0],
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
      sourceFileName: "manual-entry",
      sourceFileType: "manual",
      parserVersion: "2.0.0-manual",
    },
  };

  // ── Step 3: Compute deterministic issue flags ──
  console.log(`[manual-pipeline] Step 3: Computing deterministic issue flags`);
  parsedReport.issueFlags = computeIssueFlags(parsedReport);
  console.log(`[manual-pipeline] ${parsedReport.issueFlags.length} issue flags detected`);

  // ── Step 4: Generate hierarchical summaries ──
  console.log(`[manual-pipeline] Step 4: Generating summaries`);
  parsedReport.summary = generateReportSummary(parsedReport);

  // ── Step 5: Store parsed report in DB ──
  console.log(`[manual-pipeline] Step 5: Storing structured report`);
  const parsedReportRecord = await storage.createParsedReport({
    scanId,
    reportJson: parsedReport as any,
    profileJson: parsedReport.profile as any,
    issueFlagsJson: parsedReport.issueFlags as any,
    summaryJson: parsedReport.summary as any,
    sourceFileName: "manual-entry",
    sourceFileType: "manual",
    parserVersion: "2.0.0-manual",
    tradelineCount: tradelines.length,
    issueFlagCount: parsedReport.issueFlags.length,
  });

  // ── Step 6: Store per-tradeline evidence ──
  for (const tl of tradelines) {
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

  // ── Step 7: Run AI violation detection on each account ──
  let totalViolations = 0;
  const clientState = scan.clientState || null;

  for (const acct of negAccounts) {
    // Enrich rawDetails with issue flag info
    const tl = tradelines.find(t => t.creditorName === acct.creditor);
    const tradelineFlags = tl ? parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    ) : [];

    if (tradelineFlags.length > 0) {
      const flagLines = tradelineFlags.map(f =>
        `[${f.severity.toUpperCase()}] ${f.flagType}: ${f.description}`
      ).join("\n");
      const enrichedRawDetails = (acct.rawDetails || "") + `\n\nRule-Based Flags:\n${flagLines}`;
      await storage.updateNegativeAccount(acct.id, { rawDetails: enrichedRawDetails });
      // Re-fetch the updated account for violation detection
      const updated = await storage.getNegativeAccount(acct.id);
      if (updated) {
        await storage.clearViolationsByAccount(acct.id);
        try {
          const detected = await detectViolations(updated, clientState);
          for (const v of detected) {
            await storage.createViolation({
              negativeAccountId: acct.id,
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
          await storage.updateWorkflowStep(acct.id, "scanned");
        } catch (err) {
          console.error(`[manual-pipeline] Violation scan failed for ${acct.creditor}:`, err);
        }
      }
    } else {
      // No flags but still run AI analysis
      await storage.clearViolationsByAccount(acct.id);
      try {
        const detected = await detectViolations(acct, clientState);
        for (const v of detected) {
          await storage.createViolation({
            negativeAccountId: acct.id,
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
        await storage.updateWorkflowStep(acct.id, "scanned");
      } catch (err) {
        console.error(`[manual-pipeline] Violation scan failed for ${acct.creditor}:`, err);
      }
    }
  }

  // Update scan status
  await storage.updateScanStatus(scanId, "completed" as any);
  await storage.updateScanStep(scanId, 4);

  console.log(`[manual-pipeline] Complete: ${tradelines.length} tradelines, ${parsedReport.issueFlags.length} flags, ${totalViolations} violations`);

  return {
    scanId,
    parsedReportId: parsedReportRecord.id,
    consumerName: scan.consumerName,
    parsedReport,
    accountsCreated: tradelines.length,
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

function mapManualAccountType(type: string): AccountType {
  if (type === "debt_collection") return "collection";
  if (type === "charge_off") return "revolving"; // charge-offs are typically revolving/installment
  if (type === "repossession") return "auto_loan";
  return "other";
}

function mapManualStatus(typeOrStatus: string | null): AccountStatus {
  if (!typeOrStatus) return "other";
  const s = typeOrStatus.toLowerCase();
  if (s.includes("collection") || s.includes("debt_collection")) return "collection";
  if (s.includes("charge") || s.includes("charge_off")) return "chargeoff";
  if (s.includes("reposs")) return "repossession";
  if (s.includes("current")) return "current";
  if (s.includes("late")) return "late";
  if (s.includes("paid")) return "paid";
  if (s.includes("settled")) return "settled";
  if (s.includes("closed")) return "closed";
  return "derogatory";
}
