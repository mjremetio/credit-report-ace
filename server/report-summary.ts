/**
 * Hierarchical Summary Generator
 *
 * Generates three levels of summary from the structured report + issue flags:
 *  1. Per-account one-liners (problem + suggested action)
 *  2. Per-category summaries (collections, BK-related, lates, utilization)
 *  3. Overall action plan (Round 1 dispute list with priorities)
 */

import type {
  ParsedCreditReport,
  Tradeline,
  IssueFlag,
  AccountOneLiner,
  CategorySummary,
  ActionPlanItem,
  ReportSummary,
  Bureau,
  IssueFlagSeverity,
} from "@shared/credit-report-types";

// ── Per-Account One-Liners ─────────────────────────────────────────

function generateAccountOneLiner(tl: Tradeline, flags: IssueFlag[]): AccountOneLiner {
  const relatedFlags = flags.filter(f =>
    f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
  );

  if (relatedFlags.length === 0) {
    // No flags — account looks clean
    if (tl.aggregateStatus === "current") {
      return {
        creditorName: tl.creditorName,
        problem: "No issues detected — account reporting as current",
        suggestedAction: "No action needed",
      };
    }
    return {
      creditorName: tl.creditorName,
      problem: `${capitalize(tl.aggregateStatus)} account with balance $${tl.balance || 0}`,
      suggestedAction: "Review for accuracy — no specific discrepancies detected",
    };
  }

  // Prioritize the most severe flag
  const sorted = [...relatedFlags].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const top = sorted[0];
  const additionalCount = sorted.length - 1;

  const problem = additionalCount > 0
    ? `${top.description} (+${additionalCount} more issue${additionalCount > 1 ? "s" : ""})`
    : top.description;

  const suggestedAction = top.suggestedDispute || deriveAction(top);

  return {
    creditorName: tl.creditorName,
    problem,
    suggestedAction,
  };
}

function deriveAction(flag: IssueFlag): string {
  switch (flag.flagType) {
    case "BUREAU_BALANCE_MISMATCH":
      return "Dispute balance discrepancy with all three bureaus";
    case "BUREAU_STATUS_MISMATCH":
      return "Dispute inconsistent status reporting across bureaus";
    case "BALANCE_STATUS_CONTRADICTION":
      return "Dispute — paid/settled accounts must show $0 balance";
    case "OBSOLETE_REPORTING":
      return "Demand removal — item exceeds statutory reporting period";
    case "BANKRUPTCY_REMARK_PRESENT":
      return "Verify BK inclusion accuracy, check for $0 balance";
    case "COLLECTION_ACCOUNT_PRESENT":
      return "Validate debt, request original creditor details";
    case "MISSING_CREDIT_LIMIT":
      return "Dispute missing credit limit — inflates utilization";
    default:
      return `Investigate ${flag.flagType.replace(/_/g, " ").toLowerCase()}`;
  }
}

// ── Per-Category Summaries ─────────────────────────────────────────

interface CategoryDef {
  name: string;
  match: (tl: Tradeline, flags: IssueFlag[]) => boolean;
}

const CATEGORIES: CategoryDef[] = [
  {
    name: "Collections",
    match: (tl) => tl.accountType === "collection" || tl.aggregateStatus === "collection",
  },
  {
    name: "Charge-Offs",
    match: (tl) => tl.aggregateStatus === "chargeoff",
  },
  {
    name: "Bankruptcy-Related",
    match: (tl) => tl.remarks.some(r => /bankrupt|chapter\s*[7|13]|discharged/i.test(r)),
  },
  {
    name: "Late Payments",
    match: (_tl, flags) => flags.some(f => f.flagType === "LATE_PAYMENT_HISTORY"),
  },
  {
    name: "Utilization Issues",
    match: (_tl, flags) => flags.some(f =>
      f.flagType === "MISSING_CREDIT_LIMIT" || f.flagType === "BUREAU_CREDIT_LIMIT_MISMATCH"
    ),
  },
  {
    name: "Bureau Discrepancies",
    match: (_tl, flags) => flags.some(f => f.flagType.startsWith("BUREAU_")),
  },
  {
    name: "Obsolete/Aging Issues",
    match: (_tl, flags) => flags.some(f =>
      f.flagType === "OBSOLETE_REPORTING" || f.flagType === "APPROACHING_OBSOLETE"
    ),
  },
];

function generateCategorySummaries(tradelines: Tradeline[], flags: IssueFlag[]): CategorySummary[] {
  const summaries: CategorySummary[] = [];

  for (const cat of CATEGORIES) {
    const matchingTradelines = tradelines.filter(tl => {
      const tlFlags = flags.filter(f =>
        f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
      );
      return cat.match(tl, tlFlags);
    });

    if (matchingTradelines.length === 0) continue;

    const highlights = matchingTradelines.slice(0, 5).map(tl => {
      const tlFlags = flags.filter(f =>
        f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
      );
      const topFlag = tlFlags.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
      return `${tl.creditorName}: ${topFlag?.description || `${tl.aggregateStatus}, balance $${tl.balance || 0}`}`;
    });

    summaries.push({
      category: cat.name,
      count: matchingTradelines.length,
      highlights,
    });
  }

  return summaries;
}

// ── Action Plan (Round 1 Disputes) ─────────────────────────────────

function generateActionPlan(tradelines: Tradeline[], flags: IssueFlag[]): ActionPlanItem[] {
  const items: ActionPlanItem[] = [];

  // Group flags by creditor and pick the most actionable ones
  const creditorFlags = new Map<string, IssueFlag[]>();
  for (const f of flags) {
    const key = f.creditorName.toLowerCase();
    if (!creditorFlags.has(key)) creditorFlags.set(key, []);
    creditorFlags.get(key)!.push(f);
  }

  const creditorEntries = Array.from(creditorFlags.entries());
  for (const [_creditorKey, cFlags] of creditorEntries) {
    // Skip non-actionable flags
    const actionable = cFlags.filter((f: IssueFlag) =>
      f.suggestedDispute && f.severity !== "low"
    );
    if (actionable.length === 0) continue;

    const topFlag = actionable.sort((a: IssueFlag, b: IssueFlag) => severityRank(b.severity) - severityRank(a.severity))[0];

    // Generate one dispute item per affected bureau
    for (const bureau of topFlag.bureausAffected) {
      items.push({
        round: 1,
        bureau,
        creditorName: topFlag.creditorName,
        disputeReason: topFlag.suggestedDispute!,
        priority: topFlag.severity,
      });
    }
  }

  // Sort by severity (critical first), then alphabetically by creditor
  items.sort((a, b) => {
    const sevDiff = severityRank(b.priority) - severityRank(a.priority);
    if (sevDiff !== 0) return sevDiff;
    return a.creditorName.localeCompare(b.creditorName);
  });

  return items;
}

// ── Main entry ─────────────────────────────────────────────────────

export function generateReportSummary(report: ParsedCreditReport): ReportSummary {
  const flags = report.issueFlags;

  const accountOneLiners = report.tradelines.map(tl => {
    const relatedFlags = flags.filter(f =>
      f.creditorName.toLowerCase() === tl.creditorName.toLowerCase()
    );
    return generateAccountOneLiner(tl, relatedFlags);
  });

  const categorySummaries = generateCategorySummaries(report.tradelines, flags);
  const actionPlan = generateActionPlan(report.tradelines, flags);

  return {
    accountOneLiners,
    categorySummaries,
    actionPlan,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function severityRank(severity: IssueFlagSeverity): number {
  const ranks: Record<IssueFlagSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return ranks[severity] || 0;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
