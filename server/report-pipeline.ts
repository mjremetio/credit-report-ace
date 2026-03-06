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
  BureauSummary,
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
  const pipelineStart = Date.now();

  // ── Step 1: Parse → Section Chunks ──────────────────────────────
  console.time("[pipeline] Step 1: Parse file");
  console.log(`[pipeline] Step 1: Parsing file (${fileType})`);
  const extracted = await parseReportFile(content, fileType, pdfBuffer, imageBuffer);
  console.log(`[pipeline] Parsed ${extracted.sections.length} section(s), ${extracted.fullText.length} chars`);
  console.timeEnd("[pipeline] Step 1: Parse file");

  // ── Step 2: LLM Extraction → Structured JSON ───────────────────
  console.time("[pipeline] Step 2: LLM extraction");
  console.log(`[pipeline] Step 2: Two-pass LLM extraction`);
  const parsedReport = await extractCreditReport(
    extracted.sections,
    imageBuffer,
    fileType.startsWith("image/") ? fileType : undefined,
  );
  console.timeEnd("[pipeline] Step 2: LLM extraction");

  // ── Step 3: Rule-Based Issue Flags ─────────────────────────────
  console.time("[pipeline] Step 3: Issue flags");
  console.log(`[pipeline] Step 3: Computing deterministic issue flags`);
  parsedReport.issueFlags = computeIssueFlags(parsedReport);
  console.log(`[pipeline] ${parsedReport.issueFlags.length} issue flags detected`);
  console.timeEnd("[pipeline] Step 3: Issue flags");

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

  // ── Step 7: Store per-tradeline evidence (batch insert) ───────
  console.time("[pipeline] Step 7: Tradeline evidence storage");
  const evidenceBatch = parsedReport.tradelines.map(tl => {
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    return {
      parsedReportId: parsedReportRecord.id,
      creditorName: tl.creditorName,
      accountNumberMasked: tl.accountNumberMasked || null,
      tradelineJson: tl as any,
      evidenceText: tl.evidenceText || "",
      bureaus: tl.bureaus.join(", "),
      issueFlagsJson: tradelineFlags as any,
    };
  });
  if (evidenceBatch.length > 0) {
    await storage.createTradelineEvidenceBatch(evidenceBatch);
  }
  console.timeEnd("[pipeline] Step 7: Tradeline evidence storage");

  // ── Step 8: Bridge to legacy format ────────────────────────────
  // Create NegativeAccounts + run violation detection (preserves existing workflow)
  let totalViolations = 0;

  // Filter to negative tradelines
  const negativeTradelines = parsedReport.tradelines.filter(tl => {
    const flags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    return tl.aggregateStatus !== "current" || flags.length > 0 || tl.accountType === "collection";
  });

  // Step 8a: Create all NegativeAccount records first
  console.time("[pipeline] Step 8a: NegativeAccount creation");
  const accountEntries: Array<{ tl: Tradeline; negAccount: any }> = [];
  for (const tl of negativeTradelines) {
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    const accountType = mapAccountType(tl.accountType, tl.aggregateStatus);
    const rawDetails = buildTradelineRawDetails(tl, tradelineFlags);

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

    accountEntries.push({ tl, negAccount });
  }
  console.timeEnd("[pipeline] Step 8a: NegativeAccount creation");

  // Step 8b: Run AI violation detection in parallel batches of 5
  console.time("[pipeline] Step 8b: AI violation detection");
  // Fetch learned patterns for enhanced scanning accuracy
  const allLearnedPatterns = await storage.getAllViolationPatterns();
  const BATCH_SIZE = 5;
  for (let i = 0; i < accountEntries.length; i += BATCH_SIZE) {
    const batch = accountEntries.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async ({ negAccount }) => {
        // Clear any existing violations before detecting to prevent accumulation on re-scans
        await storage.clearViolationsByAccount(negAccount.id);
        const patterns = allLearnedPatterns.filter(p => p.accountType === negAccount.accountType);
        const detected = await detectViolations(negAccount, null, patterns);
        if (detected.length > 0) {
          await storage.createViolationsBatch(detected.map(v => ({
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
          })));
        }
        await storage.updateWorkflowStep(negAccount.id, "scanned");
        return detected.length;
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        totalViolations += result.value;
      } else {
        console.error(`[pipeline] Violation scan failed for ${batch[j].tl.creditorName}:`, result.reason?.message || result.reason);
      }
    }
  }
  console.timeEnd("[pipeline] Step 8b: AI violation detection");

  const totalMs = Date.now() - pipelineStart;
  console.log(`[pipeline] Complete: ${parsedReport.tradelines.length} tradelines, ${parsedReport.issueFlags.length} flags, ${totalViolations} violations in ${(totalMs / 1000).toFixed(1)}s`);

  return {
    scanId: scan.id,
    parsedReportId: parsedReportRecord.id,
    consumerName: parsedReport.profile.name,
    parsedReport,
    accountsCreated: accountEntries.length,
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
    dateOfBirthPerBureau: report.profile.dateOfBirthPerBureau || [],
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

  // Ensure all 3 bureaus are represented in perBureau summaries
  const ALL_BUREAU_NAMES: Bureau[] = ["TransUnion", "Experian", "Equifax"];
  const perBureauMap = new Map<Bureau, BureauSummary>();
  for (const bs of report.bureauSummaries) {
    perBureauMap.set(bs.bureau, bs);
  }

  if (report.bureauSummaries.length > 0) {
    // Use the max values across bureaus for totals
    for (const bs of report.bureauSummaries) {
      // Override inquiriesCount with computed count from actual inquiry records
      const computedInquiries = report.inquiries.filter(inq => inq.bureau === bs.bureau).length;
      perBureauMap.set(bs.bureau, {
        ...bs,
        inquiriesCount: computedInquiries > 0 ? computedInquiries : bs.inquiriesCount,
      });

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
    // Compute per-bureau summaries from tradelines when no bureau summaries exist
    for (const bureauName of ALL_BUREAU_NAMES) {
      let bTotal = 0, bOpen = 0, bClosed = 0, bDerog = 0, bColl = 0;
      let bBalance: number | undefined;
      let bCreditLimit: number | undefined;
      let bMonthly: number | undefined;

      for (const tl of report.tradelines) {
        const bd = tl.bureauDetails.find(d => d.bureau === bureauName);
        if (!bd && !tl.bureaus.includes(bureauName)) continue;
        bTotal++;
        const status = bd?.status?.toLowerCase() || tl.aggregateStatus;
        if (status === "current" || status.includes("open") || status === "late") bOpen++;
        if (status === "closed" || status === "paid" || status === "settled") bClosed++;
        if (status.includes("charge") || status === "derogatory" || status === "repossession") bDerog++;
        if (tl.accountType === "collection" || tl.aggregateStatus === "collection") bColl++;

        const balance = bd?.balance ?? tl.balance;
        if (balance != null) bBalance = (bBalance || 0) + balance;
        if (bd?.creditLimit != null) bCreditLimit = (bCreditLimit || 0) + bd.creditLimit;
        if (bd?.monthlyPayment != null) bMonthly = (bMonthly || 0) + bd.monthlyPayment;
      }

      if (bTotal > 0) {
        perBureauMap.set(bureauName, {
          bureau: bureauName,
          totalAccounts: bTotal,
          openAccounts: bOpen,
          closedAccounts: bClosed,
          delinquentCount: 0,
          derogatoryCount: bDerog,
          collectionsCount: bColl,
          publicRecordsCount: report.publicRecords.filter(pr => pr.bureaus.includes(bureauName)).length,
          inquiriesCount: report.inquiries.filter(inq => inq.bureau === bureauName).length,
          balanceTotal: bBalance,
          creditLimitTotal: bCreditLimit,
          monthlyPaymentTotal: bMonthly,
        });
      }
    }

    totalAccounts = report.tradelines.length;
    for (const tl of report.tradelines) {
      if (tl.aggregateStatus === "current" || tl.aggregateStatus === "late") openAccounts++;
      if (tl.aggregateStatus === "closed" || tl.aggregateStatus === "paid" || tl.aggregateStatus === "settled") closedAccounts++;
      if (tl.aggregateStatus === "chargeoff" || tl.aggregateStatus === "derogatory" || tl.aggregateStatus === "repossession") derogatoryAccounts++;
      if (tl.balance != null) totalBalance = (totalBalance || 0) + tl.balance;
    }
  }

  // Build final perBureau array with all 3 bureaus represented
  const perBureauFinal: BureauSummary[] = ALL_BUREAU_NAMES.map(bureau =>
    perBureauMap.get(bureau) || {
      bureau,
      totalAccounts: 0,
      openAccounts: 0,
      closedAccounts: 0,
      delinquentCount: 0,
      derogatoryCount: 0,
      collectionsCount: 0,
      publicRecordsCount: 0,
      inquiriesCount: 0,
    }
  );

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

  // Strip evidenceText from tradelines — it's the full batch text duplicated
  // per tradeline and massively bloats the API response. The frontend display
  // doesn't use it; the raw evidence is preserved in the DB (parsedReport.reportJson).
  const stripHeavyFields = (tl: Tradeline): Tradeline => ({
    ...tl,
    evidenceText: "",
  });

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
      perBureau: perBureauFinal,
    },
    accountHistory: accountHistory.map(stripHeavyFields),
    publicInformation: report.publicRecords.map(pr => ({ ...pr, evidenceText: "" })),
    inquiries: report.inquiries,
    collections: collections.map(stripHeavyFields),
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
    currentStep: 4,
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

  // ── Step 7: Store per-tradeline evidence (batch insert) ───────
  console.time("[structure-pipeline] Step 7: Tradeline evidence storage");
  const evidenceBatch = parsedReport.tradelines.map(tl => {
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    return {
      parsedReportId: parsedReportRecord.id,
      creditorName: tl.creditorName,
      accountNumberMasked: tl.accountNumberMasked || null,
      tradelineJson: tl as any,
      evidenceText: tl.evidenceText || "",
      bureaus: tl.bureaus.join(", "),
      issueFlagsJson: tradelineFlags as any,
    };
  });
  if (evidenceBatch.length > 0) {
    await storage.createTradelineEvidenceBatch(evidenceBatch);
  }
  console.timeEnd("[structure-pipeline] Step 7: Tradeline evidence storage");

  // ── Step 8: Pre-create NegativeAccount records from tradelines ──
  // This ensures that when the user navigates to ScanWizard, the accounts are visible
  const negativeTradelines = parsedReport.tradelines.filter(tl => {
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    return tl.aggregateStatus !== "current" || tradelineFlags.length > 0 || tl.accountType === "collection";
  });

  for (const tl of negativeTradelines) {
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    const accountType = mapAccountType(tl.accountType, tl.aggregateStatus);
    const rawDetails = buildTradelineRawDetails(tl, tradelineFlags);

    await storage.createNegativeAccount({
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
  }

  console.log(`[structure-pipeline] Complete: ${parsedReport.tradelines.length} tradelines, ${parsedReport.issueFlags.length} flags, ${negativeTradelines.length} negative accounts pre-created`);

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

  // Filter to only negative tradelines that need violation analysis
  const negativeTradelines = parsedReport.tradelines.filter(tl => {
    const tradelineFlags = (parsedReport.issueFlags || []).filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    return tl.aggregateStatus !== "current" ||
      tradelineFlags.length > 0 ||
      tl.accountType === "collection";
  });

  console.log(`[violation-pipeline] Running violation detection for scan ${scanId} (${negativeTradelines.length}/${parsedReport.tradelines.length} negative tradelines)`);

  // Step 1: Use existing NegativeAccount records if present (from structure pipeline), else create new ones
  console.time("[violation-pipeline] Step 1: Account setup");
  const existingAccounts = await storage.getNegativeAccountsByScan(scanId);
  const accountEntries: Array<{ tl: Tradeline; negAccount: any }> = [];

  for (const tl of negativeTradelines) {
    const tradelineFlags = (parsedReport.issueFlags || []).filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    const accountType = mapAccountType(tl.accountType, tl.aggregateStatus);
    const rawDetails = buildTradelineRawDetails(tl, tradelineFlags);

    // Check if a matching account already exists (created by structure pipeline)
    const existing = existingAccounts.find(a =>
      a.creditor.toLowerCase() === tl.creditorName.toLowerCase()
    );

    if (existing) {
      // Update existing account with enriched rawDetails (now includes cross-bureau comparison)
      const updated = await storage.updateNegativeAccount(existing.id, { rawDetails });
      accountEntries.push({ tl, negAccount: updated || existing });
    } else {
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
      accountEntries.push({ tl, negAccount });
    }
  }
  console.timeEnd("[violation-pipeline] Step 1: Account setup");

  // Step 2: Run AI violation detection in parallel batches of 5
  console.time("[violation-pipeline] Step 2: AI violation detection");
  // Fetch learned patterns for enhanced scanning accuracy
  const violationLearnedPatterns = await storage.getAllViolationPatterns();
  const BATCH_SIZE = 5;
  let totalViolations = 0;
  let processedCount = 0;

  for (let i = 0; i < accountEntries.length; i += BATCH_SIZE) {
    const batch = accountEntries.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async ({ negAccount }) => {
        // Clear any existing violations before re-detecting to prevent accumulation on re-scans
        await storage.clearViolationsByAccount(negAccount.id);
        const patterns = violationLearnedPatterns.filter(p => p.accountType === negAccount.accountType);
        const detected = await detectViolations(negAccount, scan.clientState || null, patterns);
        if (detected.length > 0) {
          await storage.createViolationsBatch(detected.map(v => ({
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
          })));
        }
        await storage.updateWorkflowStep(negAccount.id, "scanned");
        return detected.length;
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      processedCount++;
      if (result.status === "fulfilled") {
        totalViolations += result.value;
      } else {
        console.error(`[violation-pipeline] Violation scan failed for ${batch[j].tl.creditorName}:`, result.reason?.message || result.reason);
      }
    }

    console.log(`[violation-pipeline] Progress: ${processedCount}/${accountEntries.length} accounts processed`);
  }
  console.timeEnd("[violation-pipeline] Step 2: AI violation detection");

  // Update scan step to indicate violations are done (step 6 = Complete)
  await storage.updateScanStep(scanId, 6);

  console.log(`[violation-pipeline] Complete: ${totalViolations} violations detected across ${accountEntries.length} accounts`);

  return {
    scanId,
    accountsCreated: accountEntries.length,
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

  // ── Step 6: Store per-tradeline evidence (batch insert) ──
  console.time("[manual-pipeline] Step 6: Tradeline evidence storage");
  const evidenceBatch = tradelines.map(tl => {
    const tradelineFlags = parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    return {
      parsedReportId: parsedReportRecord.id,
      creditorName: tl.creditorName,
      accountNumberMasked: tl.accountNumberMasked || null,
      tradelineJson: tl as any,
      evidenceText: tl.evidenceText || "",
      bureaus: tl.bureaus.join(", "),
      issueFlagsJson: tradelineFlags as any,
    };
  });
  if (evidenceBatch.length > 0) {
    await storage.createTradelineEvidenceBatch(evidenceBatch);
  }
  console.timeEnd("[manual-pipeline] Step 6: Tradeline evidence storage");

  // ── Step 7: Run AI violation detection in parallel batches ──
  console.time("[manual-pipeline] Step 7: AI violation detection");
  let totalViolations = 0;
  const clientState = scan.clientState || null;

  // Enrich all accounts with flag info first
  const enrichedAccounts: any[] = [];
  for (const acct of negAccounts) {
    const tl = tradelines.find(t => t.creditorName === acct.creditor);
    const tradelineFlags = tl ? parsedReport.issueFlags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    ) : [];

    let accountForDetection = acct;
    if (tradelineFlags.length > 0) {
      const flagLines = tradelineFlags.map(f =>
        `[${f.severity.toUpperCase()}] ${f.flagType}: ${f.description}`
      ).join("\n");
      const enrichedRawDetails = (acct.rawDetails || "") + `\n\nRule-Based Flags:\n${flagLines}`;
      const updated = await storage.updateNegativeAccount(acct.id, { rawDetails: enrichedRawDetails });
      if (updated) accountForDetection = updated;
    }
    enrichedAccounts.push(accountForDetection);
  }

  // Run violation detection in parallel batches of 5
  // Fetch learned patterns for enhanced scanning accuracy
  const manualLearnedPatterns = await storage.getAllViolationPatterns();
  const MANUAL_BATCH_SIZE = 5;
  for (let i = 0; i < enrichedAccounts.length; i += MANUAL_BATCH_SIZE) {
    const batch = enrichedAccounts.slice(i, i + MANUAL_BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (acct: any) => {
        await storage.clearViolationsByAccount(acct.id);
        const patterns = manualLearnedPatterns.filter((p: any) => p.accountType === acct.accountType);
        const detected = await detectViolations(acct, clientState, patterns);
        if (detected.length > 0) {
          await storage.createViolationsBatch(detected.map(v => ({
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
          })));
        }
        await storage.updateWorkflowStep(acct.id, "scanned");
        return detected.length;
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        totalViolations += result.value;
      } else {
        console.error(`[manual-pipeline] Violation scan failed for ${batch[j].creditor}:`, result.reason?.message || result.reason);
      }
    }
  }
  console.timeEnd("[manual-pipeline] Step 7: AI violation detection");

  // Update scan status — manual pipeline completes all steps
  await storage.updateScanStatus(scanId, "completed" as any);
  await storage.updateScanStep(scanId, 6);

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

/** Build rawDetails string for a tradeline (used by both report and violation pipelines) */
function buildTradelineRawDetails(tl: Tradeline, tradelineFlags: IssueFlag[]): string {
  const sections: string[] = [];

  // ── Account Overview ──
  sections.push("═══ ACCOUNT OVERVIEW ═══");
  sections.push(`Creditor: ${tl.creditorName}`);
  if (tl.accountNumberMasked) sections.push(`Account: ${tl.accountNumberMasked}`);
  sections.push(`Type: ${tl.accountType}`);
  sections.push(`Aggregate Status: ${tl.aggregateStatus}`);
  if (tl.originalCreditor) sections.push(`Original Creditor: ${tl.originalCreditor}`);
  if (tl.balance != null) sections.push(`Aggregate Balance: $${tl.balance}`);
  if (tl.dates.opened) sections.push(`Date Opened: ${tl.dates.opened}`);
  if (tl.dates.closed) sections.push(`Date Closed: ${tl.dates.closed}`);
  if (tl.dates.firstDelinquency) sections.push(`DOFD: ${tl.dates.firstDelinquency}`);
  if (tl.dates.lastPayment) sections.push(`Last Payment: ${tl.dates.lastPayment}`);
  if (tl.dates.lastReported) sections.push(`Last Reported: ${tl.dates.lastReported}`);
  if (tl.bureaus.length > 0) sections.push(`Reporting Bureaus: ${tl.bureaus.join(", ")}`);

  // ── All Remarks ──
  if (tl.remarks.length > 0) {
    sections.push("");
    sections.push("═══ REMARKS (ALL BUREAUS) ═══");
    for (const r of tl.remarks) {
      sections.push(`  • ${r}`);
    }
  }

  // ── Per-Bureau Detail Blocks ──
  if (tl.bureauDetails.length > 0) {
    sections.push("");
    sections.push("═══ PER-BUREAU DETAILS ═══");

    for (const bd of tl.bureauDetails) {
      sections.push(`\n--- ${bd.bureau} ---`);
      if (bd.accountNumber) sections.push(`  Account#: ${bd.accountNumber}`);
      if (bd.balance != null) sections.push(`  Balance: $${bd.balance}`);
      if (bd.status) sections.push(`  Status: ${bd.status}`);
      if (bd.dateOpened) sections.push(`  Date Opened: ${bd.dateOpened}`);
      if (bd.dateClosed) sections.push(`  Date Closed: ${bd.dateClosed}`);
      if (bd.lastPaymentDate) sections.push(`  Last Payment: ${bd.lastPaymentDate}`);
      if (bd.lastReportedDate) sections.push(`  Last Reported: ${bd.lastReportedDate}`);
      if (bd.highBalance != null) sections.push(`  High Balance: $${bd.highBalance}`);
      if (bd.creditLimit != null) sections.push(`  Credit Limit: $${bd.creditLimit}`);
      if (bd.monthlyPayment != null) sections.push(`  Monthly Payment: $${bd.monthlyPayment}`);
      if (bd.pastDueAmount != null) sections.push(`  Past Due Amount: $${bd.pastDueAmount}`);
      if (bd.paymentStatus) sections.push(`  Payment Status: ${bd.paymentStatus}`);
      if (bd.creditorType) sections.push(`  Creditor Type: ${bd.creditorType}`);
      if (bd.accountRating) sections.push(`  Account Rating: ${bd.accountRating}`);
      if (bd.terms) sections.push(`  Terms: ${bd.terms}`);
      if (bd.remarks && bd.remarks.length > 0) {
        sections.push(`  Remarks: ${bd.remarks.join("; ")}`);
      }
      if (bd.paymentHistory && bd.paymentHistory.length > 0) {
        sections.push(`  Payment History (24mo): ${bd.paymentHistory.map(ph => `${ph.month}:${ph.code}`).join(", ")}`);
      }
    }
  }

  // ── Cross-Bureau Comparison Summary ──
  if (tl.bureauDetails.length >= 2) {
    const comparison = buildCrossBureauComparison(tl);
    if (comparison) {
      sections.push("");
      sections.push("═══ CROSS-BUREAU COMPARISON ═══");
      sections.push(comparison);
    }
  }

  // ── Rule-Based Flags ──
  if (tradelineFlags.length > 0) {
    sections.push("");
    sections.push("═══ RULE-BASED FLAGS ═══");
    for (const f of tradelineFlags) {
      sections.push(`[${f.severity.toUpperCase()}] ${f.flagType}: ${f.description}`);
      if (f.suggestedDispute) {
        sections.push(`  → Suggested: ${f.suggestedDispute}`);
      }
    }
  }

  return sections.join("\n");
}

/** Build a cross-bureau comparison summary highlighting discrepancies */
function buildCrossBureauComparison(tl: Tradeline): string | null {
  const diffs: string[] = [];
  const details = tl.bureauDetails;

  // Compare balances
  const balances = details.filter(bd => bd.balance != null).map(bd => ({ b: bd.bureau, v: bd.balance! }));
  if (balances.length >= 2) {
    const unique = new Set(balances.map(x => x.v));
    if (unique.size > 1) {
      diffs.push(`BALANCE: ${balances.map(x => `${x.b}=$${x.v}`).join(" | ")}`);
    }
  }

  // Compare statuses
  const statuses = details.filter(bd => bd.status).map(bd => ({ b: bd.bureau, v: bd.status! }));
  if (statuses.length >= 2) {
    const unique = new Set(statuses.map(x => x.v.toLowerCase()));
    if (unique.size > 1) {
      diffs.push(`STATUS: ${statuses.map(x => `${x.b}="${x.v}"`).join(" | ")}`);
    }
  }

  // Compare date opened
  const openDates = details.filter(bd => bd.dateOpened).map(bd => ({ b: bd.bureau, v: bd.dateOpened! }));
  if (openDates.length >= 2) {
    const unique = new Set(openDates.map(x => x.v));
    if (unique.size > 1) {
      diffs.push(`DATE OPENED: ${openDates.map(x => `${x.b}=${x.v}`).join(" | ")}`);
    }
  }

  // Compare high balance
  const highBalances = details.filter(bd => bd.highBalance != null).map(bd => ({ b: bd.bureau, v: bd.highBalance! }));
  if (highBalances.length >= 2) {
    const unique = new Set(highBalances.map(x => x.v));
    if (unique.size > 1) {
      diffs.push(`HIGH BALANCE: ${highBalances.map(x => `${x.b}=$${x.v}`).join(" | ")}`);
    }
  }

  // Compare credit limits
  const limits = details.filter(bd => bd.creditLimit != null).map(bd => ({ b: bd.bureau, v: bd.creditLimit! }));
  if (limits.length >= 2) {
    const unique = new Set(limits.map(x => x.v));
    if (unique.size > 1) {
      diffs.push(`CREDIT LIMIT: ${limits.map(x => `${x.b}=$${x.v}`).join(" | ")}`);
    }
  }

  // Compare creditor types
  const credTypes = details.filter(bd => bd.creditorType).map(bd => ({ b: bd.bureau, v: bd.creditorType! }));
  if (credTypes.length >= 2) {
    const unique = new Set(credTypes.map(x => x.v.toLowerCase()));
    if (unique.size > 1) {
      diffs.push(`CREDITOR TYPE: ${credTypes.map(x => `${x.b}="${x.v}"`).join(" | ")}`);
    }
  }

  // Compare account ratings
  const ratings = details.filter(bd => bd.accountRating).map(bd => ({ b: bd.bureau, v: bd.accountRating! }));
  if (ratings.length >= 2) {
    const unique = new Set(ratings.map(x => x.v.toLowerCase()));
    if (unique.size > 1) {
      diffs.push(`ACCOUNT RATING: ${ratings.map(x => `${x.b}="${x.v}"`).join(" | ")}`);
    }
  }

  // Compare payment statuses
  const payStatuses = details.filter(bd => bd.paymentStatus).map(bd => ({ b: bd.bureau, v: bd.paymentStatus! }));
  if (payStatuses.length >= 2) {
    const unique = new Set(payStatuses.map(x => x.v.toLowerCase()));
    if (unique.size > 1) {
      diffs.push(`PAYMENT STATUS: ${payStatuses.map(x => `${x.b}="${x.v}"`).join(" | ")}`);
    }
  }

  // Compare last reported dates
  const lastReported = details.filter(bd => bd.lastReportedDate).map(bd => ({ b: bd.bureau, v: bd.lastReportedDate! }));
  if (lastReported.length >= 2) {
    const unique = new Set(lastReported.map(x => x.v));
    if (unique.size > 1) {
      diffs.push(`LAST REPORTED: ${lastReported.map(x => `${x.b}=${x.v}`).join(" | ")}`);
    }
  }

  // Compare last payment dates
  const lastPayment = details.filter(bd => bd.lastPaymentDate).map(bd => ({ b: bd.bureau, v: bd.lastPaymentDate! }));
  if (lastPayment.length >= 2) {
    const unique = new Set(lastPayment.map(x => x.v));
    if (unique.size > 1) {
      diffs.push(`LAST PAYMENT: ${lastPayment.map(x => `${x.b}=${x.v}`).join(" | ")}`);
    }
  }

  // Check for balance vs high balance issues per bureau
  for (const bd of details) {
    if (bd.balance != null && bd.highBalance != null && bd.balance > bd.highBalance) {
      diffs.push(`⚠ ${bd.bureau}: Balance $${bd.balance} EXCEEDS High Balance $${bd.highBalance}`);
    }
  }

  // Check dispute remark consistency
  const bureausWithDispute: string[] = [];
  const bureausWithoutDispute: string[] = [];
  for (const bd of details) {
    const hasDispute = (bd.remarks || []).some(r => /dispute|disputed/i.test(r));
    if (hasDispute) bureausWithDispute.push(bd.bureau);
    else bureausWithoutDispute.push(bd.bureau);
  }
  if (bureausWithDispute.length > 0 && bureausWithoutDispute.length > 0) {
    diffs.push(`⚠ DISPUTE REMARK: Present on ${bureausWithDispute.join(", ")} | Missing on ${bureausWithoutDispute.join(", ")}`);
  }

  if (diffs.length === 0) {
    return "All bureaus reporting consistent data (no cross-bureau discrepancies detected).";
  }
  return `${diffs.length} discrepanc${diffs.length === 1 ? "y" : "ies"} found:\n${diffs.map(d => `  • ${d}`).join("\n")}`;
}
