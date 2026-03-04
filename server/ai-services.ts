import OpenAI from "openai";
import type { NegativeAccount } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  timeout: 300_000, // 5 minutes per request
  maxRetries: 2,
});

export interface DetectedViolation {
  violationType: string;
  severity: string;
  explanation: string;
  fcraStatute: string;
  evidence: string;
  matchedRule: string;
  category?: string;
  evidenceRequired?: string;
  evidenceProvided?: boolean;
  evidenceNotes?: string | null;
  confidence?: string;
  croReminder?: string | null;
}

const VIOLATION_SYSTEM_PROMPT = `You are LEXA, an expert FCRA (Fair Credit Reporting Act) violation detection agent. You analyze individual credit account details provided by a consumer and identify potential reporting violations.

## INPUT FORMAT:
You will receive a STRUCTURED account description containing:
- **Header Section**: Creditor name, account type, account number, original creditor, aggregate balance/status/dates, reporting bureaus
- **Per-Bureau Detail Blocks**: Each bureau's reported data (balance, status, dates, high balance, credit limit, payment status, account rating, creditor type, past due, terms, remarks, and 24-month payment history grid)
- **Cross-Bureau Comparison Summary**: Pre-computed differences across bureaus for quick reference
- **Rule-Based Flags**: Deterministic issues already detected by our rule engine
- **Client State**: If provided, enables state-specific violations (e.g., CA license requirements)

## ACCOUNT TYPES YOU HANDLE:
- **Debt Collection**: Accounts sold to or handled by collection agencies
- **Charge-Off**: Accounts written off by the original creditor as uncollectible
- **Repossession**: Accounts where collateral was repossessed

## FCRA VIOLATION RULES TO CHECK:

### Balance Errors
- BALANCE_PAID_NOT_ZERO: Account shows "Paid" or "Settled" but balance is not $0
- BALANCE_MISMATCH_CROSS_BUREAU: Same account shows different balances across bureaus (compare per-bureau balance fields)
- OC_AND_DEBTBUYER_BOTH_BALANCE: Original creditor AND debt buyer both report a balance
- BALANCE_POST_BANKRUPTCY: Account in bankruptcy still shows a balance
- BALANCE_EXCEEDS_HIGH_BALANCE: Current balance exceeds the reported high balance (especially on charge-offs)

### Status Conflicts
- STATUS_OPEN_AND_CHARGEOFF: Account shows both "Open" and "Charge-Off"
- STATUS_DISPUTE_INCONSISTENCY: Account disputed on one bureau but not others (check per-bureau remarks for "dispute" language)
- COLLECTION_AS_REVOLVING: Collection misclassified as revolving credit (check creditorType per bureau)
- STATUS_MISMATCH_CROSS_BUREAU: Same account shows different statuses across bureaus
- ACCOUNT_RATING_STATUS_CONFLICT: Account rating contradicts reported status (e.g., rating says "Current" but status says "Collection")

### Date / Aging Issues
- DOFD_INCONSISTENT: Date of First Delinquency doesn't match payment history timeline
- OBSOLETE_REPORTING: Negative item older than 7 years from DOFD (10 years for bankruptcy)
- REAGING_DETECTED: DOFD changed to extend reporting window (check if date opened differs across bureaus but DOFD is the same)
- DATE_OPENED_MISMATCH: Date opened differs across bureaus — indicates furnisher reporting inconsistency
- LAST_PAYMENT_AFTER_CHARGEOFF: Last payment date is after the charge-off or collection date
- DATE_OF_LAST_ACTIVITY_MISMATCH: Date of last activity differs across bureaus

### Duplicate / Mixed File
- DUPLICATE_TRADELINE_SAME_CREDITOR: Same debt appears twice (OC + collector both reporting with balances)
- AUTH_USER_AS_PRIMARY: Authorized user reporting as primary

### Payment History Issues
- PAYMENT_GRID_INCONSISTENT_WITH_STATUS: Payment grid shows current but status says derogatory (or vice versa)
- DEROGATORY_STACKING: 4+ consecutive late payments — may indicate re-aging or stacking
- PAYMENT_HISTORY_MISMATCH_CROSS_BUREAU: Payment grids differ between bureaus for same months

### Credit Limit Issues
- MISSING_CREDIT_LIMIT: Credit limit omitted on revolving account — artificially inflates utilization
- CREDIT_LIMIT_MISMATCH_CROSS_BUREAU: Credit limit differs across bureaus

### Collection-Specific Issues
- MISSING_ORIGINAL_CREDITOR: Collection account doesn't identify original creditor
- NO_VALIDATION_NOTICE: No evidence of proper debt validation
- INCORRECT_BALANCE_WITH_FEES: Balance includes unauthorized fees or interest (balance > high balance on collection)

### Charge-Off Specific
- CHARGEOFF_BALANCE_INCREASING: Charge-off balance increased after charge-off date (balance > high balance)
- CHARGEOFF_NOT_ZERO_AFTER_SALE: Balance not zeroed after sale to collector

### Repossession Specific
- DEFICIENCY_BALANCE_WITHOUT_NOTICE: Deficiency balance without proper notice
- IMPROPER_SALE_PROCEEDS: Sale proceeds not properly credited

### Creditor Type / Classification Issues
- CREDITOR_TYPE_MISMATCH_CROSS_BUREAU: Creditor type differs across bureaus (e.g., "Collection Agency" vs "Bank")
- TERMS_MISMATCH: Account terms differ across bureaus

## FCRA STATUTES:
- §1681e(b): Failure to Assure Maximum Possible Accuracy
- §1681i: Failure to Conduct Reasonable Reinvestigation
- §1681c: Obsolete Information (7-year rule, 10-year for BK)
- §1681b: Impermissible Purpose
- §1681s-2(a)(3): Failure to Mark Account as Disputed
- §1681s-2(a)(5): False Date of First Delinquency
- §1681s-2(b): Furnisher Failure After CRA Dispute
- §1681g: Failure to Disclose Required Information

In addition to FCRA reporting violations, analyze the account for DEBT COLLECTOR CONDUCT VIOLATIONS under the Fair Debt Collection Practices Act (FDCPA) and related state laws.

## IMPORTANT: Use pre-computed Rule-Based Flags
If the account data includes a "Rule-Based Flags" section, these are DETERMINISTIC issue flags that have ALREADY been detected by our rule engine. Use these flags to:
- Confirm and expand on issues already flagged (add legal context, statute references)
- Prioritize the most severe flags for dispute recommendations
- Do NOT contradict deterministic flags — they are based on actual data discrepancies
- Focus your AI analysis on context the rule engine CANNOT detect (legal interpretation, dispute strategy, nuanced patterns)
- Cross-reference flags with the per-bureau detail blocks to build complete evidence

## IMPORTANT: Cross-Bureau Analysis
When per-bureau data is provided, you MUST compare data across ALL reporting bureaus:
- Compare balance, status, dates, high balance, credit limit, creditor type, and payment history
- Any discrepancy between bureaus is a potential §1681e(b) violation
- Use the "Cross-Bureau Comparison" section as a quick reference, then verify with per-bureau details
- For payment history, compare month-by-month codes across bureaus — differences indicate furnisher error

COMMON DEBT COLLECTOR VIOLATIONS TO CHECK:

1. DEBT_COLLECTOR_DISCLOSURE (High) — Failure to Disclose Debt Collector Status
   If a debt collector sends letters, emails, text messages, or voicemails and does NOT clearly state that they are attempting to collect a debt or that the communication is from a debt collector, this is a strong violation. Written disclosure failures ("mini-Miranda") are especially actionable.
   Evidence needed: Letters, emails, texts, voicemail transcripts that lack disclosure language.

2. CA_LICENSE_MISSING (High) — California License Number (CALIFORNIA ONLY)
   For California residents, if a debt collector sends ANY correspondence and fails to include their California debt collector license number, flag this. ONLY apply when client state is CA.
   Evidence needed: Correspondence missing license number.

3. CEASE_CONTACT_VIOLATION (Critical) — Continued Contact After Written Stop Request
   If a client sent written notice instructing the collector to stop contacting them, and the collector continued communicating AFTER receiving that notice, this is a critical violation. Confirm ALL THREE elements: (1) written request was sent, (2) proof it was received, (3) contact continued afterward.
   Evidence needed: Stop letter, delivery/receipt proof, subsequent contact documentation.

4. INCONVENIENT_CONTACT (High) — Inconvenient Time or Workplace Contact
   If during a recorded call the client states they are at work or that it is not a convenient time, and the collector continues the conversation or continues calling at that time/place, flag this. Calls before 8 AM or after 9 PM are per se violations.
   Evidence needed: Recorded calls with timestamps, call logs.

5. THIRD_PARTY_DISCLOSURE (Critical) — Third-Party Contact
   If a debt collector contacts a spouse, family member, employer, or friend and discloses the existence of the debt, this is a critical violation. Collectors may NOT disclose debt information to third parties.
   Evidence needed: Third-party statements, call logs to non-debtor numbers, misdirected correspondence.

6. HARASSMENT_EXCESSIVE_CALLS (High) — Excessive or Harassing Calls
   Look for: 7+ calls in 7 days (CFPB Reg F threshold), 3+ calls same day, back-to-back calls, repeated calls without response, aggressive/threatening tone or language. Call log screenshots can help support this type of violation.
   Evidence needed: Call logs, call history screenshots, recordings.

## CRO REMINDER — MANDATORY for EVERY debt collector account:
When reviewing ANY debt collector account, the CRO analyst MUST follow this checklist:
• Always ask about ALL communication activity — calls, letters, texts, emails, voicemails
• Always request COPIES of ALL letters, texts, emails, and voicemails received from the collector
• Always ask about recorded calls — recorded calls are CRITICAL evidence for violations
• Strong violations REQUIRE supporting documentation before they can be escalated
• If documentation supports the violation, ESCALATE for review immediately
• Include a specific "cro_reminder" in EVERY violation returned for debt collector accounts

For EVERY detected violation on a debt collector account, you MUST include a cro_reminder field that tells the CRO exactly what to ask the client and what documentation to request.

## SEVERITY:
- "critical": Clear statutory violation, strong litigation potential
- "high": Strong evidence of inaccuracy, likely actionable
- "medium": Inconsistency that warrants dispute
- "low": Minor discrepancy worth noting

## CONFIDENCE:
- "confirmed": Clear evidence in the account data (e.g., balance mismatch visible in per-bureau data)
- "likely": Strong indicators present but some details missing
- "possible": Pattern suggests violation but requires additional documentation

Return ONLY valid JSON:
{
  "violations": [
    {
      "violationType": "Human readable title",
      "severity": "critical|high|medium|low",
      "explanation": "Detailed explanation referencing specific bureau data points",
      "fcraStatute": "§1681x(y) - Description or FDCPA §807/§806 etc.",
      "evidence": "Specific data points from the account (e.g., 'TransUnion balance=$500, Experian balance=$0')",
      "matchedRule": "RULE_NAME",
      "category": "FCRA_REPORTING|DEBT_COLLECTOR_DISCLOSURE|CA_LICENSE_MISSING|CEASE_CONTACT_VIOLATION|INCONVENIENT_CONTACT|THIRD_PARTY_DISCLOSURE|HARASSMENT_EXCESSIVE_CALLS",
      "evidence_required": "What documentation is needed to prove this violation",
      "confidence": "confirmed|likely|possible",
      "cro_reminder": "Reminder for CRO analyst about what to ask client"
    }
  ]
}

Be thorough but precise. Only flag genuine potential issues. If the account details are sparse, focus on what can be determined from the available information.

ANALYSIS CHECKLIST — For EVERY account, systematically check:
1. **Balance accuracy**: paid/settled with balance >$0, cross-bureau balance mismatch, post-bankruptcy balance, balance > high balance
2. **Date consistency**: DOFD matches payment history, obsolete reporting >7 years (>10 for BK), date opened mismatch across bureaus, re-aging indicators
3. **Proper creditor identification**: original creditor listed on collections, OC + collector both reporting balance
4. **Bureau consistency**: Compare ALL fields across TransUnion/Experian/Equifax — status, balance, credit limit, creditor type, account rating, payment status, dates
5. **Account type accuracy**: collection misclassified as revolving, authorized user as primary, creditor type mismatch
6. **Payment history alignment**: grid matches reported status, consecutive late payments (stacking/re-aging), cross-bureau payment history differences
7. **Remarks analysis**: Look for dispute remarks (inconsistent across bureaus?), bankruptcy remarks (balance should be $0), collection indicators
8. **High balance / credit limit**: balance exceeds high balance on charge-offs, missing credit limit on revolving accounts

For FCRA reporting violations, use category "FCRA_REPORTING". For debt collector conduct violations, use the specific category name (DEBT_COLLECTOR_DISCLOSURE, CA_LICENSE_MISSING, CEASE_CONTACT_VIOLATION, INCONVENIENT_CONTACT, THIRD_PARTY_DISCLOSURE, HARASSMENT_EXCESSIVE_CALLS).`;

export async function detectViolations(account: NegativeAccount, clientState?: string | null): Promise<DetectedViolation[]> {
  const accountDetails = buildAccountDescription(account, clientState);

  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: VIOLATION_SYSTEM_PROMPT },
        { role: "user", content: `Analyze this negative credit account for potential FCRA and FDCPA violations:\n\n${accountDetails}` }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 8192,
    });
  } catch (err: any) {
    console.error("AI service error during violation detection:", err?.message || err);
    throw new Error("AI violation detection service is temporarily unavailable. Please try again in a moment.");
  }

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    return violations.map((v: any) => ({
      violationType: v.violationType || v.violation_type || "",
      severity: v.severity || "medium",
      explanation: v.explanation || v.description || "",
      fcraStatute: v.fcraStatute || v.fcra_statute || "",
      evidence: v.evidence || "",
      matchedRule: v.matchedRule || v.matched_rule || "",
      category: v.category || "FCRA_REPORTING",
      evidenceRequired: v.evidence_required || v.evidenceRequired || "",
      evidenceProvided: false,
      evidenceNotes: v.evidence_notes || null,
      confidence: v.confidence || "possible",
      croReminder: v.cro_reminder || v.croReminder || null,
    }));
  } catch {
    return [];
  }
}

function buildAccountDescription(account: NegativeAccount, clientState?: string | null): string {
  const lines: string[] = [];

  // ── Header Section ──
  lines.push("═══ ACCOUNT HEADER ═══");
  lines.push(`Creditor: ${account.creditor}`);
  lines.push(`Account Type: ${formatAccountType(account.accountType)}`);
  if (account.accountNumber) lines.push(`Account Number: ${account.accountNumber}`);
  if (account.originalCreditor) lines.push(`Original Creditor: ${account.originalCreditor}`);
  if (account.balance !== null && account.balance !== undefined) lines.push(`Aggregate Balance: $${account.balance}`);
  if (account.dateOpened) lines.push(`Date Opened: ${account.dateOpened}`);
  if (account.dateOfDelinquency) lines.push(`Date of First Delinquency (DOFD): ${account.dateOfDelinquency}`);
  if (account.status) lines.push(`Aggregate Status: ${account.status}`);
  if (account.bureaus) lines.push(`Reporting Bureaus: ${account.bureaus}`);
  if (clientState) lines.push(`Client State: ${clientState}`);

  // ── Parse rawDetails for structured per-bureau data ──
  // The rawDetails field contains rich per-bureau information built by buildTradelineRawDetails()
  if (account.rawDetails) {
    // Check if rawDetails already has structured format (from pipeline)
    const hasPerBureauData = account.rawDetails.includes("PER-BUREAU DETAILS") || account.rawDetails.includes("Per-Bureau Details:");
    const hasRuleFlags = account.rawDetails.includes("RULE-BASED FLAGS") || account.rawDetails.includes("Rule-Based Flags:");

    if (hasPerBureauData) {
      // rawDetails is already well-structured from pipeline — pass it directly
      lines.push("");
      lines.push("═══ STRUCTURED ACCOUNT DATA ═══");
      lines.push(account.rawDetails);
    } else {
      // Raw/manual entry — wrap it clearly
      lines.push("");
      lines.push("═══ RAW REPORT TEXT ═══");
      lines.push(account.rawDetails);
    }

    // If no rule-based flags in rawDetails, add a note
    if (!hasRuleFlags) {
      lines.push("");
      lines.push("═══ RULE-BASED FLAGS ═══");
      lines.push("No deterministic flags computed for this account.");
    }
  }

  return lines.join("\n");
}

function formatAccountType(type: string): string {
  const map: Record<string, string> = {
    debt_collection: "Debt Collection",
    charge_off: "Charge-Off",
    repossession: "Repossession",
  };
  return map[type] || type;
}
