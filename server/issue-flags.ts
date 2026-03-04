/**
 * Deterministic Rule-Based Issue Flags
 *
 * These flags are computed BEFORE the model sees anything.
 * They rely on structured data, not LLM inference.
 *
 * Flag categories:
 *  - Bureau mismatch (status/type/limit/balance differs across TU/EX/EQ)
 *  - Dispute remark present
 *  - Bankruptcy remark present
 *  - Collection/chargeoff present
 *  - Late history present (30/60/90/120/CO in 24-mo grid)
 *  - Balance vs status contradictions
 *  - Date anomalies (obsolete, re-aging, DOFD mismatch)
 *  - Missing required fields
 */

import type {
  ParsedCreditReport,
  Tradeline,
  TradeBureauDetail,
  PublicRecord,
  IssueFlag,
  IssueFlagSeverity,
  Bureau,
} from "@shared/credit-report-types";

// ── Flag builder helper ────────────────────────────────────────────

function flag(
  type: string,
  severity: IssueFlagSeverity,
  creditor: string,
  description: string,
  bureaus: Bureau[],
  evidence: Record<string, string | number | null>,
  suggestedDispute?: string,
): IssueFlag {
  return { flagType: type, severity, creditorName: creditor, description, bureausAffected: bureaus, evidence, suggestedDispute };
}

// ── Core rule engine ───────────────────────────────────────────────

export function computeIssueFlags(report: ParsedCreditReport, clientState?: string | null): IssueFlag[] {
  const flags: IssueFlag[] = [];

  for (const tl of report.tradelines) {
    flags.push(...checkBureauBalanceMismatch(tl));
    flags.push(...checkBureauStatusMismatch(tl));
    flags.push(...checkBureauCreditLimitMismatch(tl));
    flags.push(...checkBureauCreditorTypeMismatch(tl));
    flags.push(...checkBalanceStatusContradiction(tl));
    flags.push(...checkDisputeRemarks(tl));
    flags.push(...checkBankruptcyRemarks(tl));
    flags.push(...checkCollectionChargeoff(tl));
    flags.push(...checkLateHistory(tl));
    flags.push(...checkObsoleteReporting(tl));
    flags.push(...checkDateMismatch(tl));
    flags.push(...checkMissingCreditLimit(tl));
    flags.push(...checkMissingOriginalCreditor(tl));
    flags.push(...checkPaymentGridStatusConflict(tl));
    flags.push(...checkDebtCollectorViolations(tl, clientState));
  }

  for (const pr of report.publicRecords) {
    flags.push(...checkPublicRecordFlags(pr, report.tradelines));
  }

  flags.push(...checkPersonalInfoMismatch(report));

  return flags;
}

// ── Individual rule implementations ────────────────────────────────

function checkBureauBalanceMismatch(tl: Tradeline): IssueFlag[] {
  if (tl.bureauDetails.length < 2) return [];
  const balances = tl.bureauDetails
    .filter(bd => bd.balance !== null && bd.balance !== undefined)
    .map(bd => ({ bureau: bd.bureau, balance: bd.balance! }));

  if (balances.length < 2) return [];

  const unique = new Set(balances.map(b => b.balance));
  if (unique.size <= 1) return [];

  const evidence: Record<string, string | number | null> = {};
  for (const b of balances) evidence[b.bureau] = b.balance;

  return [flag(
    "BUREAU_BALANCE_MISMATCH",
    "high",
    tl.creditorName,
    `Balance differs across bureaus: ${balances.map(b => `${b.bureau}=$${b.balance}`).join(", ")}`,
    balances.map(b => b.bureau),
    evidence,
    "Dispute inaccurate balance reporting under §1681e(b) — bureaus must report consistent data",
  )];
}

function checkBureauStatusMismatch(tl: Tradeline): IssueFlag[] {
  if (tl.bureauDetails.length < 2) return [];
  const statuses = tl.bureauDetails
    .filter(bd => bd.status)
    .map(bd => ({ bureau: bd.bureau, status: bd.status!.toLowerCase().trim() }));

  if (statuses.length < 2) return [];

  const unique = new Set(statuses.map(s => s.status));
  if (unique.size <= 1) return [];

  const evidence: Record<string, string | number | null> = {};
  for (const s of statuses) evidence[s.bureau] = s.status;

  return [flag(
    "BUREAU_STATUS_MISMATCH",
    "high",
    tl.creditorName,
    `Account status differs across bureaus: ${statuses.map(s => `${s.bureau}="${s.status}"`).join(", ")}`,
    statuses.map(s => s.bureau),
    evidence,
    "Dispute inconsistent status reporting under §1681e(b)",
  )];
}

function checkBureauCreditLimitMismatch(tl: Tradeline): IssueFlag[] {
  if (tl.bureauDetails.length < 2) return [];
  const limits = tl.bureauDetails
    .filter(bd => bd.creditLimit !== null && bd.creditLimit !== undefined)
    .map(bd => ({ bureau: bd.bureau, limit: bd.creditLimit! }));

  if (limits.length < 2) return [];

  const unique = new Set(limits.map(l => l.limit));
  if (unique.size <= 1) return [];

  const evidence: Record<string, string | number | null> = {};
  for (const l of limits) evidence[l.bureau] = l.limit;

  return [flag(
    "BUREAU_CREDIT_LIMIT_MISMATCH",
    "medium",
    tl.creditorName,
    `Credit limit differs across bureaus: ${limits.map(l => `${l.bureau}=$${l.limit}`).join(", ")}. This affects utilization ratio.`,
    limits.map(l => l.bureau),
    evidence,
    "Dispute missing/incorrect credit limit under §1681e(b) — impacts utilization calculation",
  )];
}

function checkBureauCreditorTypeMismatch(tl: Tradeline): IssueFlag[] {
  if (tl.bureauDetails.length < 2) return [];
  const types = tl.bureauDetails
    .filter(bd => bd.creditorType)
    .map(bd => ({ bureau: bd.bureau, type: bd.creditorType!.toLowerCase().trim() }));

  if (types.length < 2) return [];

  const unique = new Set(types.map(t => t.type));
  if (unique.size <= 1) return [];

  const evidence: Record<string, string | number | null> = {};
  for (const t of types) evidence[t.bureau] = t.type;

  return [flag(
    "BUREAU_CREDITOR_TYPE_MISMATCH",
    "medium",
    tl.creditorName,
    `Creditor type differs across bureaus: ${types.map(t => `${t.bureau}="${t.type}"`).join(", ")}`,
    types.map(t => t.bureau),
    evidence,
    "Dispute misclassification under §1681e(b)",
  )];
}

function checkBalanceStatusContradiction(tl: Tradeline): IssueFlag[] {
  const flags: IssueFlag[] = [];

  for (const bd of tl.bureauDetails) {
    const status = (bd.status || "").toLowerCase();
    const balance = bd.balance;

    // Paid/Settled/Closed but balance > 0
    if ((status.includes("paid") || status.includes("settled") || status.includes("closed")) &&
      balance !== null && balance !== undefined && balance > 0) {
      flags.push(flag(
        "BALANCE_STATUS_CONTRADICTION",
        "critical",
        tl.creditorName,
        `${bd.bureau}: Status is "${bd.status}" but balance is $${balance}. Should be $0.`,
        [bd.bureau],
        { [bd.bureau + "_status"]: bd.status || null, [bd.bureau + "_balance"]: balance },
        "Dispute under §1681e(b) — paid/settled account must report $0 balance",
      ));
    }

    // Chargeoff with increasing balance (check highBalance)
    if (status.includes("charge") && status.includes("off") &&
      balance !== null && bd.highBalance !== null &&
      balance !== undefined && bd.highBalance !== undefined &&
      balance > bd.highBalance) {
      flags.push(flag(
        "CHARGEOFF_BALANCE_INCREASING",
        "high",
        tl.creditorName,
        `${bd.bureau}: Charge-off balance $${balance} exceeds high balance $${bd.highBalance}`,
        [bd.bureau],
        { balance, highBalance: bd.highBalance },
        "Dispute under §1681e(b) — charge-off balance should not exceed original amount",
      ));
    }
  }

  return flags;
}

function checkDisputeRemarks(tl: Tradeline): IssueFlag[] {
  const disputeRemarks = tl.remarks.filter(r =>
    /dispute|disputed|consumer\s+dispute|meets\s+fcra/i.test(r)
  );

  if (disputeRemarks.length === 0) return [];

  // Check if dispute is on some bureaus but not others
  const bureausWithDispute: Bureau[] = [];
  const bureausWithoutDispute: Bureau[] = [];

  for (const bd of tl.bureauDetails) {
    const hasDispute = (bd.remarks || []).some(r =>
      /dispute|disputed|consumer\s+dispute/i.test(r)
    );
    if (hasDispute) {
      bureausWithDispute.push(bd.bureau);
    } else {
      bureausWithoutDispute.push(bd.bureau);
    }
  }

  const flags: IssueFlag[] = [];

  flags.push(flag(
    "DISPUTE_REMARK_PRESENT",
    "low",
    tl.creditorName,
    `Account has dispute remark: "${disputeRemarks[0]}"`,
    tl.bureaus,
    { remark: disputeRemarks[0] },
  ));

  if (bureausWithDispute.length > 0 && bureausWithoutDispute.length > 0) {
    flags.push(flag(
      "DISPUTE_INCONSISTENCY_ACROSS_BUREAUS",
      "high",
      tl.creditorName,
      `Dispute remark appears on ${bureausWithDispute.join(", ")} but NOT on ${bureausWithoutDispute.join(", ")}`,
      [...bureausWithDispute, ...bureausWithoutDispute],
      {
        bureausWithDispute: bureausWithDispute.join(", "),
        bureausWithoutDispute: bureausWithoutDispute.join(", "),
      },
      "Dispute under §1681s-2(a)(3) — furnisher must mark as disputed on ALL bureaus",
    ));
  }

  return flags;
}

function checkBankruptcyRemarks(tl: Tradeline): IssueFlag[] {
  const bkRemarks = tl.remarks.filter(r =>
    /bankrupt|chapter\s*[7|13]|bk\s|discharged|included\s+in\s+.*bankrupt/i.test(r)
  );

  if (bkRemarks.length === 0) return [];

  const flags: IssueFlag[] = [];

  flags.push(flag(
    "BANKRUPTCY_REMARK_PRESENT",
    "medium",
    tl.creditorName,
    `Account has bankruptcy-related remark: "${bkRemarks[0]}"`,
    tl.bureaus,
    { remark: bkRemarks[0] },
  ));

  // Check if BK account still shows balance
  for (const bd of tl.bureauDetails) {
    if (bd.balance !== null && bd.balance !== undefined && bd.balance > 0) {
      flags.push(flag(
        "BALANCE_POST_BANKRUPTCY",
        "critical",
        tl.creditorName,
        `${bd.bureau}: Account included in bankruptcy but still reports balance of $${bd.balance}`,
        [bd.bureau],
        { [bd.bureau + "_balance"]: bd.balance, remark: bkRemarks[0] },
        "Dispute under §1681e(b) — discharged BK account must report $0 balance",
      ));
    }
  }

  return flags;
}

function checkCollectionChargeoff(tl: Tradeline): IssueFlag[] {
  const flags: IssueFlag[] = [];

  if (tl.aggregateStatus === "collection" || tl.accountType === "collection") {
    flags.push(flag(
      "COLLECTION_ACCOUNT_PRESENT",
      "medium",
      tl.creditorName,
      `Collection account detected with balance $${tl.balance || 0}`,
      tl.bureaus,
      { balance: tl.balance, status: tl.aggregateStatus },
    ));

    // Check if collection is misclassified as revolving
    for (const bd of tl.bureauDetails) {
      if (bd.creditorType && /revolv/i.test(bd.creditorType)) {
        flags.push(flag(
          "COLLECTION_AS_REVOLVING",
          "high",
          tl.creditorName,
          `${bd.bureau}: Collection account misclassified as "${bd.creditorType}"`,
          [bd.bureau],
          { creditorType: bd.creditorType },
          "Dispute misclassification under §1681e(b) — collection should not be reported as revolving credit",
        ));
      }
    }
  }

  if (tl.aggregateStatus === "chargeoff") {
    flags.push(flag(
      "CHARGEOFF_PRESENT",
      "medium",
      tl.creditorName,
      `Charge-off account detected with balance $${tl.balance || 0}`,
      tl.bureaus,
      { balance: tl.balance, status: tl.aggregateStatus },
    ));
  }

  return flags;
}

function checkLateHistory(tl: Tradeline): IssueFlag[] {
  const flags: IssueFlag[] = [];

  for (const bd of tl.bureauDetails) {
    if (!bd.paymentHistory || bd.paymentHistory.length === 0) continue;

    const lateEntries = bd.paymentHistory.filter(ph =>
      /^(30|60|90|120|150|CO|CL|BK)$/.test(ph.code)
    );

    if (lateEntries.length === 0) continue;

    const lateCodes = lateEntries.map(e => `${e.month}:${e.code}`).join(", ");

    flags.push(flag(
      "LATE_PAYMENT_HISTORY",
      lateEntries.some(e => /^(90|120|150|CO|CL)$/.test(e.code)) ? "high" : "medium",
      tl.creditorName,
      `${bd.bureau}: Late payments detected in history: ${lateCodes}`,
      [bd.bureau],
      { lateCount: lateEntries.length, latestLate: lateEntries[0]?.month || null },
    ));

    // Check for derogatory stacking (consecutive lates that seem suspicious)
    const consecutiveLates = countConsecutiveLates(bd.paymentHistory);
    if (consecutiveLates >= 4) {
      flags.push(flag(
        "DEROGATORY_STACKING",
        "high",
        tl.creditorName,
        `${bd.bureau}: ${consecutiveLates} consecutive late payments detected — may indicate re-aging or stacking`,
        [bd.bureau],
        { consecutiveLateMonths: consecutiveLates },
        "Verify payment history accuracy — consecutive late markers may indicate re-aging under §1681s-2(a)(5)",
      ));
    }
  }

  return flags;
}

function countConsecutiveLates(history: Array<{ month: string; code: string }>): number {
  let maxConsecutive = 0;
  let current = 0;
  for (const entry of history) {
    if (/^(30|60|90|120|150|CO|CL)$/.test(entry.code)) {
      current++;
      maxConsecutive = Math.max(maxConsecutive, current);
    } else {
      current = 0;
    }
  }
  return maxConsecutive;
}

function checkObsoleteReporting(tl: Tradeline): IssueFlag[] {
  const dofd = tl.dates.firstDelinquency;
  if (!dofd) return [];

  const dofdDate = new Date(dofd);
  if (isNaN(dofdDate.getTime())) return [];

  const now = new Date();
  const yearsDiff = (now.getTime() - dofdDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  // 7-year rule for most negative items, 10 for bankruptcy
  const isBankruptcy = tl.remarks.some(r => /bankrupt|chapter/i.test(r));
  const limit = isBankruptcy ? 10 : 7;

  if (yearsDiff >= limit) {
    return [flag(
      "OBSOLETE_REPORTING",
      "critical",
      tl.creditorName,
      `Account DOFD is ${dofd} — ${yearsDiff.toFixed(1)} years ago, exceeds ${limit}-year limit under §1681c`,
      tl.bureaus,
      { dofd, yearsAge: parseFloat(yearsDiff.toFixed(1)), limit },
      `Demand removal under §1681c — item is obsolete (${limit}-year limit)`,
    )];
  }

  // Warn if approaching limit
  if (yearsDiff >= limit - 1) {
    return [flag(
      "APPROACHING_OBSOLETE",
      "low",
      tl.creditorName,
      `Account DOFD is ${dofd} — ${yearsDiff.toFixed(1)} years ago, approaching ${limit}-year removal threshold`,
      tl.bureaus,
      { dofd, yearsAge: parseFloat(yearsDiff.toFixed(1)), limit },
    )];
  }

  return [];
}

function checkDateMismatch(tl: Tradeline): IssueFlag[] {
  if (tl.bureauDetails.length < 2) return [];
  const flags: IssueFlag[] = [];

  // Check DOFD consistency across bureaus (using dateOpened as proxy if DOFD not per-bureau)
  const openDates = tl.bureauDetails
    .filter(bd => bd.dateOpened)
    .map(bd => ({ bureau: bd.bureau, date: bd.dateOpened! }));

  if (openDates.length >= 2) {
    const unique = new Set(openDates.map(d => d.date));
    if (unique.size > 1) {
      const evidence: Record<string, string | number | null> = {};
      for (const d of openDates) evidence[d.bureau] = d.date;
      flags.push(flag(
        "DATE_OPENED_MISMATCH",
        "medium",
        tl.creditorName,
        `Date opened differs across bureaus: ${openDates.map(d => `${d.bureau}=${d.date}`).join(", ")}`,
        openDates.map(d => d.bureau),
        evidence,
        "Dispute date discrepancy under §1681e(b)",
      ));
    }
  }

  return flags;
}

function checkMissingCreditLimit(tl: Tradeline): IssueFlag[] {
  if (tl.accountType !== "revolving") return [];

  const flags: IssueFlag[] = [];
  for (const bd of tl.bureauDetails) {
    if ((bd.creditLimit === null || bd.creditLimit === undefined || bd.creditLimit === 0) &&
      bd.balance !== null && bd.balance !== undefined && bd.balance > 0) {
      flags.push(flag(
        "MISSING_CREDIT_LIMIT",
        "high",
        tl.creditorName,
        `${bd.bureau}: Revolving account has balance $${bd.balance} but no credit limit reported — inflates utilization ratio`,
        [bd.bureau],
        { [bd.bureau + "_balance"]: bd.balance, [bd.bureau + "_creditLimit"]: null },
        "Dispute missing credit limit under §1681e(b) — omission artificially inflates utilization and lowers score",
      ));
    }
  }
  return flags;
}

function checkMissingOriginalCreditor(tl: Tradeline): IssueFlag[] {
  if (tl.accountType !== "collection") return [];
  if (tl.originalCreditor) return [];

  return [flag(
    "MISSING_ORIGINAL_CREDITOR",
    "medium",
    tl.creditorName,
    `Collection account does not identify original creditor — required for proper validation`,
    tl.bureaus,
    { creditor: tl.creditorName },
    "Request original creditor identification — collections must identify the original creditor",
  )];
}

function checkPaymentGridStatusConflict(tl: Tradeline): IssueFlag[] {
  const flags: IssueFlag[] = [];

  for (const bd of tl.bureauDetails) {
    if (!bd.paymentHistory || bd.paymentHistory.length === 0 || !bd.status) continue;

    const statusLower = bd.status.toLowerCase();
    const recentPayments = bd.paymentHistory.slice(0, 6); // last 6 months
    const allCurrent = recentPayments.every(p => p.code === "C" || p.code === "--");
    const allLate = recentPayments.every(p => /^(30|60|90|120|150|CO|CL)$/.test(p.code));

    // Grid shows current but status is derogatory
    if (allCurrent && (statusLower.includes("derog") || statusLower.includes("late") || statusLower.includes("collection"))) {
      flags.push(flag(
        "PAYMENT_GRID_STATUS_CONFLICT",
        "high",
        tl.creditorName,
        `${bd.bureau}: Payment grid shows all current but status is "${bd.status}"`,
        [bd.bureau],
        { paymentGrid: "current", status: bd.status },
        "Dispute under §1681e(b) — payment history conflicts with reported status",
      ));
    }

    // Grid shows late but status is current
    if (allLate && statusLower.includes("current")) {
      flags.push(flag(
        "PAYMENT_GRID_STATUS_CONFLICT",
        "high",
        tl.creditorName,
        `${bd.bureau}: Payment grid shows delinquencies but status is "${bd.status}"`,
        [bd.bureau],
        { paymentGrid: "late", status: bd.status },
        "Dispute under §1681e(b) — payment history conflicts with reported status",
      ));
    }
  }

  return flags;
}

function checkPublicRecordFlags(pr: PublicRecord, tradelines: Tradeline[]): IssueFlag[] {
  const flags: IssueFlag[] = [];

  // Check if BK is obsolete
  if (/bankrupt|chapter/i.test(pr.type)) {
    const filedDate = pr.dateFiled ? new Date(pr.dateFiled) : null;
    if (filedDate && !isNaN(filedDate.getTime())) {
      const yearsDiff = (Date.now() - filedDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const limit = /chapter\s*7/i.test(pr.type) ? 10 : 7;

      if (yearsDiff >= limit) {
        flags.push(flag(
          "OBSOLETE_PUBLIC_RECORD",
          "critical",
          pr.type,
          `Public record filed ${pr.dateFiled} — ${yearsDiff.toFixed(1)} years ago, exceeds ${limit}-year limit`,
          pr.bureaus,
          { dateFiled: pr.dateFiled || null, yearsAge: parseFloat(yearsDiff.toFixed(1)) },
          `Demand removal under §1681c — public record is obsolete`,
        ));
      }
    }
  }

  return flags;
}

// ── Debt Collector Violation Flags ──────────────────────────────────
// These are deterministic flags based on account type and remarks.
// The full FDCPA analysis requires client documentation (letters, call logs),
// but we can flag collection accounts that warrant CRO investigation.

function checkDebtCollectorViolations(tl: Tradeline, clientState?: string | null): IssueFlag[] {
  const flags: IssueFlag[] = [];

  // Only check collection-type accounts
  const isCollector = tl.accountType === "collection" ||
    tl.aggregateStatus === "collection" ||
    tl.remarks.some(r => /collect|debt\s+buyer|purchas/i.test(r));

  if (!isCollector) return flags;

  // FLAG 1: Debt collector account detected — CRO MUST investigate communications
  flags.push(flag(
    "DEBT_COLLECTOR_ACCOUNT",
    "medium",
    tl.creditorName,
    `Debt collector account detected. CRO MUST investigate: (1) all letters/emails/texts received — check for mini-Miranda disclosure, (2) all voicemails received, (3) any recorded calls, (4) whether client sent written cease/stop contact request, (5) whether collector contacted any third parties, (6) call frequency and timing`,
    tl.bureaus,
    { accountType: tl.accountType, status: tl.aggregateStatus },
    "CRO: Ask client about ALL communication from this collector — letters, texts, emails, voicemails, phone calls. Request copies of everything. Ask specifically: Did you send a written stop request? Has the collector contacted anyone else? How often do they call? What time do they call?",
  ));

  // FLAG 2: Mini-Miranda / Debt Collector Disclosure check
  // Per FDCPA §807(11), every communication must include disclosure that it's from a debt collector
  const hasDisclosureRemark = tl.remarks.some(r =>
    /mini.?miranda|debt\s+collector\s+disclosure|this\s+is\s+an\s+attempt\s+to\s+collect/i.test(r)
  );
  if (!hasDisclosureRemark) {
    flags.push(flag(
      "DEBT_COLLECTOR_DISCLOSURE_CHECK",
      "high",
      tl.creditorName,
      `Collection account — CRO must verify ALL written communications from "${tl.creditorName}" include the required mini-Miranda disclosure: "This is an attempt to collect a debt and any information obtained will be used for that purpose." Written disclosure failures are STRONG, actionable violations. Check every letter, email, text message, and voicemail.`,
      tl.bureaus,
      { creditor: tl.creditorName, hasDisclosureRemark: "no" },
      "CRO: Request ALL letters, emails, texts, voicemails from this collector. Check each one for mini-Miranda disclosure language. If ANY communication lacks this disclosure, it is an FDCPA §807(11) violation. Written failures are especially strong.",
    ));
  }

  // FLAG 3: California License Number check (CA clients only)
  if (clientState && clientState.toUpperCase() === "CA") {
    flags.push(flag(
      "CA_LICENSE_NUMBER_CHECK",
      "high",
      tl.creditorName,
      `California client — CRO must verify ALL correspondence from "${tl.creditorName}" includes their California debt collector license number. Under California Civil Code §1788.11(e), every piece of correspondence to a CA resident must include the collector's CA license number.`,
      tl.bureaus,
      { creditor: tl.creditorName, clientState: "CA" },
      "CRO: Request all letters and correspondence from this collector. Check each one for a California debt collector license number. If any correspondence is missing the CA license number, flag as a state-law violation.",
    ));
  }

  // FLAG 4: Cease contact / continued contact indicators
  const hasCeaseRemark = tl.remarks.some(r =>
    /cease|stop\s+contact|do\s+not\s+call|written\s+request|cease\s+and\s+desist/i.test(r)
  );
  if (hasCeaseRemark) {
    flags.push(flag(
      "CEASE_CONTACT_INDICATOR",
      "critical",
      tl.creditorName,
      `Cease contact indicator found in remarks for "${tl.creditorName}". If the client sent a WRITTEN stop request and the collector continued contact AFTER receiving it, this is a CRITICAL FDCPA §805(c) violation. Must confirm all three elements: (1) written request was sent, (2) proof of receipt/delivery, (3) contact continued after receipt.`,
      tl.bureaus,
      { remark: tl.remarks.find(r => /cease|stop\s+contact|cease\s+and\s+desist/i.test(r)) || null },
      "CRO: Ask client: Did you send a written stop/cease request to this collector? Do you have a copy? How was it sent (certified mail, email)? Do you have proof of delivery/receipt? Did the collector contact you AFTER they received it? Get dates and documentation for all contact after the stop request.",
    ));
  }
  // Even without a cease remark, always prompt CRO to ask about it for collection accounts
  if (!hasCeaseRemark) {
    flags.push(flag(
      "CEASE_CONTACT_INVESTIGATION",
      "medium",
      tl.creditorName,
      `CRO must ask if client sent a written cease/stop request to "${tl.creditorName}". If the client sent a written request and the collector continued contact afterward, this is a critical FDCPA §805(c) violation.`,
      tl.bureaus,
      { creditor: tl.creditorName },
      "CRO: Ask client: Have you ever sent a written letter or email telling this collector to stop contacting you? If yes, get copy of the letter, proof of delivery, and documentation of any contact after the request was received.",
    ));
  }

  // FLAG 5: Third-party disclosure indicators
  const hasThirdPartyRemark = tl.remarks.some(r =>
    /third.?party|spouse|family|employer|disclosed\s+to/i.test(r)
  );
  if (hasThirdPartyRemark) {
    flags.push(flag(
      "THIRD_PARTY_DISCLOSURE_INDICATOR",
      "critical",
      tl.creditorName,
      `Third-party disclosure indicator found for "${tl.creditorName}". If the collector disclosed the existence of this debt to a spouse, family member, employer, or friend, this is a CRITICAL FDCPA §805(b) violation. Collectors may ONLY contact third parties to obtain location information and may NOT disclose that a debt is owed.`,
      tl.bureaus,
      { remark: tl.remarks.find(r => /third.?party|spouse|family|employer/i.test(r)) || null },
      "CRO: Ask client: Has this collector ever contacted your spouse, parents, children, other family members, friends, employer, or coworkers? Did they mention the debt? Get written statements from any third parties contacted, call logs showing calls to non-debtor numbers, and any misdirected correspondence.",
    ));
  }

  // FLAG 6: Harassment / excessive calls indicators
  const hasHarassmentRemark = tl.remarks.some(r =>
    /harass|excessive|threaten|abuse|multiple\s+calls|repeated|obscen/i.test(r)
  );
  if (hasHarassmentRemark) {
    flags.push(flag(
      "HARASSMENT_INDICATOR",
      "high",
      tl.creditorName,
      `Harassment/excessive contact indicator found for "${tl.creditorName}". CFPB Reg F §1006.14(b): 7+ calls in 7 days to a specific phone number about a specific debt creates a presumption of harassment. Also violations: 3+ calls same day, back-to-back calls, threatening/abusive language, use of obscene language, threats of violence.`,
      tl.bureaus,
      { remark: tl.remarks.find(r => /harass|excessive|threaten/i.test(r)) || null },
      "CRO: Ask client: How many times per day/week does this collector call? Do they call multiple times in a row? Have they used threatening, abusive, or obscene language? Request call log screenshots, phone history, and any recordings. Look for 7+ calls/week or 3+ calls/day patterns.",
    ));
  }

  // FLAG 7: Workplace / inconvenient time contact indicators
  const hasWorkplaceRemark = tl.remarks.some(r =>
    /workplace|at\s+work|employer\s+contact|inconvenient/i.test(r)
  );
  if (hasWorkplaceRemark) {
    flags.push(flag(
      "INCONVENIENT_CONTACT_INDICATOR",
      "high",
      tl.creditorName,
      `Workplace/inconvenient contact indicator found for "${tl.creditorName}". FDCPA §805(a)(1): Calls before 8:00 AM or after 9:00 PM are per se violations. If during a RECORDED call the client stated they were at work or it was not a convenient time, and the collector continued calling, this is a violation. Recorded calls are REQUIRED evidence.`,
      tl.bureaus,
      { remark: tl.remarks.find(r => /workplace|at\s+work|inconvenient/i.test(r)) || null },
      "CRO: Ask client: Has this collector called you at work? Did you tell them it was inconvenient or that your employer prohibits such calls? Did they continue calling? What times do they typically call — before 8 AM or after 9 PM? Request recorded calls with timestamps and call logs showing time of calls.",
    ));
  }

  return flags;
}

function checkPersonalInfoMismatch(report: ParsedCreditReport): IssueFlag[] {
  const flags: IssueFlag[] = [];
  const profile = report.profile;

  // Check for addresses reported by only one bureau (potential mixed file)
  for (const addr of profile.addresses) {
    if (addr.bureaus.length === 1 && profile.addresses.length > 3) {
      flags.push(flag(
        "ADDRESS_SINGLE_BUREAU",
        "low",
        "Personal Information",
        `Address "${addr.address}" only reported by ${addr.bureaus[0]} — verify this is accurate`,
        addr.bureaus,
        { address: addr.address, bureau: addr.bureaus[0] },
      ));
    }
  }

  return flags;
}
