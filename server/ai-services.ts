import OpenAI from "openai";
import type { NegativeAccount, ViolationPattern, FcraTrainingExample } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  timeout: 300_000, // 5 minutes per request
  maxRetries: 2,
});

// Use higher-capability model for more accurate violation detection
const VIOLATION_MODEL = "o3";

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
You will receive account data as a JSON object with these keys:
- **account**: Creditor name, account type, account number, original creditor, aggregate balance/status/dates, reporting bureaus
- **bureauDetails**: Array of per-bureau data objects (balance, status, dates, highBalance, creditLimit, paymentStatus, accountRating, creditorType, pastDueAmount, terms, remarks, paymentHistory as "YYYY-MM:code" strings, daysLate7Year counts)
- **crossBureauDiffs** (optional): Pre-computed discrepancies across bureaus — each has a field name and per-bureau values
- **ruleBasedFlags** (optional): Deterministic issues already detected by our rule engine — each has type, severity, description, evidence
- **clientState** (optional): Consumer's state for state-specific violations (e.g., CA license requirements)
- **debtCollectorContext** (optional): Present for collection accounts — lists FDCPA investigation requirements

## ACCOUNT TYPES YOU HANDLE:
- **Debt Collection**: Accounts sold to or handled by collection agencies
- **Charge-Off**: Accounts written off by the original creditor as uncollectible
- **Repossession**: Accounts where collateral was repossessed

## FCRA VIOLATION RULES TO CHECK:

### Balance Errors
- BALANCE_PAID_NOT_ZERO: Account shows "Paid" or "Settled" but balance is not $0. Also flag: reporting discharged debts with a balance, failing to update balance after payment plan or settlement, continuing to report a balance after debt was settled or paid in full
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
- OBSOLETE_REPORTING: Negative item older than 7 years from DOFD (10 years for chapter 7 bankruptcy). Also flag: reporting debts discharged in bankruptcy as active or with a balance, re-aging old debts by transferring to new collectors with reset dates, reporting an account as active/open when it was voluntarily closed by the consumer, reporting lawsuits or judgments older than 7 years
- REAGING_DETECTED: DOFD changed to extend reporting window (check if date opened differs across bureaus but DOFD is the same)
- DATE_OPENED_MISMATCH: Date opened differs across bureaus — indicates furnisher reporting inconsistency
- LAST_PAYMENT_AFTER_CHARGEOFF: Last payment date is after the charge-off or collection date
- DATE_OF_LAST_ACTIVITY_MISMATCH: Date of last activity differs across bureaus

### Duplicate / Mixed File
- DUPLICATE_TRADELINE_SAME_CREDITOR: Same debt appears twice (OC + collector both reporting with balances)
- AUTH_USER_AS_PRIMARY: Authorized user reporting as primary. Also flag: listing consumer as debtor on account when they were only an authorized user
- MIXED_FILE_INDICATORS: Credit bureau may have mixed consumer's file with another person. Check for: accounts that may belong to someone with a similar Social Security number, accounts from persons with similar names (Jr./Sr./III confusion), accounts from persons with same last name and similar first names, accounts from persons with similar names in the same city or zip code. Mixed files cause morphing or duplicating of negative credit information with a stranger

### Payment History Issues
- PAYMENT_GRID_INCONSISTENT_WITH_STATUS: Payment grid shows current but status says derogatory (or vice versa)
- DEROGATORY_STACKING: 4+ consecutive late payments — may indicate re-aging or stacking
- PAYMENT_HISTORY_MISMATCH_CROSS_BUREAU: Payment grids differ between bureaus for same months

### Credit Limit Issues
- MISSING_CREDIT_LIMIT: Credit limit omitted on revolving account — artificially inflates utilization
- CREDIT_LIMIT_MISMATCH_CROSS_BUREAU: Credit limit differs across bureaus

### Collection-Specific Issues
- MISSING_ORIGINAL_CREDITOR: Collection account doesn't identify original creditor
- NO_VALIDATION_NOTICE: No evidence of proper debt validation. Also flag: creditor/CRA failed to investigate dispute within 30 days (or 45 days with consumer documentation), CRA failed to notify furnisher of dispute, CRA/furnisher failed to correct or delete inaccurate/incomplete/unverifiable information after investigation, furnisher failed to provide address for written disputes, furnisher failed to inform consumer of investigation results within 5 business days of completion
- INCORRECT_BALANCE_WITH_FEES: Balance includes unauthorized fees or interest (balance > high balance on collection)

### Charge-Off Specific
- CHARGEOFF_BALANCE_INCREASING: Charge-off balance increased after charge-off date (balance > high balance)
- CHARGEOFF_NOT_ZERO_AFTER_SALE: Balance not zeroed after sale to collector

### Repossession Specific
- DEFICIENCY_BALANCE_WITHOUT_NOTICE: Deficiency balance without proper notice
- IMPROPER_SALE_PROCEEDS: Sale proceeds not properly credited

### Privacy Violations (§1681b, §1681e)
- UNAUTHORIZED_REPORT_RELEASE: Credit report furnished to unauthorized person or entity without permissible purpose. CRAs can only release reports to authorized persons: creditors, landlords, insurance providers, utility companies, and employers (only with prior written consumer consent)
- EMPLOYER_REPORT_WITHOUT_CONSENT: Employment-related credit check performed without written consumer consent (§1681b(f))
- REPORT_SHARED_WITH_THIRD_PARTY: Credit information shared beyond the requesting party without authorization

### Impermissible Purpose (§1681b)
- NO_PERMISSIBLE_PURPOSE: Credit report pulled without a valid permissible purpose (credit transaction, employment, insurance, legitimate business need). Examples: pulling report to determine collectibility before filing a non-credit lawsuit, creditor on discharged bankruptcy debt pulling report to monitor current financial activity
- STALE_INQUIRY_NO_TRANSACTION: Hard inquiry on report with no corresponding account or credit transaction — may indicate impermissible pull

### Withholding Required Notices (§1681m, §1681j, §1681g)
- NO_ADVERSE_ACTION_NOTICE: Creditor or user of credit information failed to notify consumer of adverse action (denial, rate increase, etc.) taken based on credit report (§1681m(a))
- NO_NEGATIVE_INFO_NOTICE: Furnisher failed to notify consumer before or within 30 days of first reporting negative information to a CRA
- CREDIT_SCORE_NOT_PROVIDED: Creditor used credit score in credit decision but failed to provide the score and key factors to the consumer (§1681m(h))
- NO_DISPUTE_RIGHTS_NOTICE: Consumer not informed of their right to dispute inaccurate credit information or right to obtain a free credit report after adverse action (§1681j(a))
- NO_FREE_REPORT_NOTICE: User of credit information failed to inform consumer of right to obtain a free annual credit report after adverse action
- SOURCE_NOT_IDENTIFIED: Creditor or user of information refused to identify the source of the credit information obtained about the consumer (§1681g)

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
- §1681b(f): Consumer Consent Required for Employment Purposes
- §1681m(a): Adverse Action Notice Requirements
- §1681m(h): Credit Score Disclosure for Risk-Based Pricing
- §1681j(a): Free Annual Report Disclosure After Adverse Action

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

COMMON DEBT COLLECTOR VIOLATIONS TO CHECK — WHAT TO LOOK FOR:

1. DEBT_COLLECTOR_DISCLOSURE (High) — Failure to Disclose Debt Collector Status
   If a debt collector sends letters, emails, text messages, or voicemails and does NOT clearly state that they are attempting to collect a debt or that the communication is from a debt collector, this MUST be flagged. Written disclosure failures ("mini-Miranda") are STRONG violations. The required disclosure language is: "This is an attempt to collect a debt and any information obtained will be used for that purpose" or equivalent. Check ALL forms of communication — letters, emails, texts, voicemails. Each communication without this disclosure is a separate violation.
   Evidence needed: Letters, emails, texts, voicemail transcripts that lack disclosure language.
   FDCPA Reference: §807(11) — False or misleading representation / failure to disclose.

2. CA_LICENSE_MISSING (High) — California License Number (CALIFORNIA ONLY)
   For California residents, if a debt collector sends ANY correspondence and fails to include their California debt collector license number, flag this. This applies ONLY to California clients (client state = CA). Every piece of correspondence must include the license number.
   Evidence needed: Correspondence missing license number.
   Reference: California Civil Code §1788.11(e).

3. CEASE_CONTACT_VIOLATION (Critical) — Continued Contact After Written Stop Request
   If a client sent WRITTEN notice instructing the collector to stop contacting them and the collector continued communicating AFTER receiving that notice, this MUST be flagged. This is a CRITICAL violation. Confirm ALL THREE elements: (1) written request was sent, (2) proof it was received (certified mail receipt, delivery confirmation, read receipt), (3) contact continued afterward. Even a single contact after receipt of the written stop request is a violation.
   Evidence needed: Copy of stop letter, delivery/receipt proof (certified mail receipt), subsequent contact documentation (calls, letters, texts after receipt date).
   FDCPA Reference: §805(c) — Ceasing communication.

4. INCONVENIENT_CONTACT (High) — Inconvenient Time or Workplace Contact
   If during a RECORDED call the client states they are at work or that it is not a convenient time, and the collector continues the conversation or continues calling at that time/place, this MUST be flagged. Calls before 8:00 AM or after 9:00 PM in the consumer's local time zone are per se violations regardless of what was said. Workplace calls after the employer has been known to prohibit them are also violations. RECORDED CALLS are required evidence for this type of violation.
   Evidence needed: Recorded calls with timestamps, call logs showing time of calls.
   FDCPA Reference: §805(a)(1) — Communicating at unusual time or place.

5. THIRD_PARTY_DISCLOSURE (Critical) — Third-Party Contact
   If a debt collector contacts a spouse, family member, employer, or friend and DISCLOSES the existence of the debt, this is a CRITICAL violation. Collectors may contact third parties ONLY to obtain location information about the consumer, and may NOT disclose that a debt is owed. Disclosure to ANY third party (spouse, parent, child, employer, neighbor, friend) constitutes a violation.
   Evidence needed: Third-party statements/declarations, call logs showing calls to non-debtor phone numbers, misdirected correspondence, text messages sent to wrong person.
   FDCPA Reference: §805(b) — Communication with third parties.

6. HARASSMENT_EXCESSIVE_CALLS (High) — Excessive or Harassing Calls
   Look for: 7+ calls in 7 days to a particular phone number about a specific debt (CFPB Reg F presumption of harassment), 3+ calls same day, back-to-back calls within minutes, repeated calls without leaving a message or response, aggressive/threatening tone or language. Call log screenshots are critical evidence. Also flag: calls intended to annoy or harass, use of obscene language, threats of violence, publishing debtor lists.
   Evidence needed: Call logs with dates/times, call history screenshots, recordings of threatening or harassing calls.
   FDCPA Reference: §806 — Harassment or abuse, CFPB Regulation F §1006.14(b).

## CRO REMINDER — MANDATORY CHECKLIST FOR EVERY DEBT COLLECTOR ACCOUNT:
When reviewing ANY debt collector account, the CRO analyst MUST follow this checklist:
• Always ask about ALL communication activity — calls, letters, texts, emails, voicemails
• Always request COPIES of ALL letters, texts, emails, and voicemails received from the collector
• Always ask about recorded calls — recorded calls are CRITICAL evidence for violations
• Always ask: "Did you send a written stop/cease request? If so, did you keep a copy and proof of delivery?"
• Always ask: "Has the collector contacted anyone else about this debt — spouse, family, friends, employer?"
• Always ask: "How many times per day/week does the collector call? Do they call before 8 AM or after 9 PM?"
• Always ask: "Have you ever told the collector you were at work or it was an inconvenient time?"
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
      "category": "FCRA_REPORTING|DEBT_COLLECTOR_DISCLOSURE|CA_LICENSE_MISSING|CEASE_CONTACT_VIOLATION|INCONVENIENT_CONTACT|THIRD_PARTY_DISCLOSURE|HARASSMENT_EXCESSIVE_CALLS|PRIVACY_VIOLATION|IMPERMISSIBLE_PURPOSE|WITHHOLDING_NOTICES",
      "evidence_required": "What documentation is needed to prove this violation",
      "confidence": "confirmed|likely|possible",
      "cro_reminder": "Reminder for CRO analyst about what to ask client"
    }
  ]
}

Be thorough but precise. Only flag genuine potential issues. If the account details are sparse, focus on what can be determined from the available information. For debt collector/collection accounts, ALWAYS generate violations that prompt the CRO to investigate communications even if no specific evidence is in the report data — the purpose is to drive the CRO to ASK the client and COLLECT documentation.

ANALYSIS CHECKLIST — For EVERY account, systematically check:
1. **Balance accuracy**: paid/settled with balance >$0, cross-bureau balance mismatch, post-bankruptcy balance, balance > high balance
2. **Date consistency**: DOFD matches payment history, obsolete reporting >7 years (>10 for BK), date opened mismatch across bureaus, re-aging indicators
3. **Proper creditor identification**: original creditor listed on collections, OC + collector both reporting balance
4. **Bureau consistency**: Compare ALL fields across TransUnion/Experian/Equifax — status, balance, credit limit, creditor type, account rating, payment status, dates
5. **Account type accuracy**: collection misclassified as revolving, authorized user as primary, creditor type mismatch
6. **Payment history alignment**: grid matches reported status, consecutive late payments (stacking/re-aging), cross-bureau payment history differences
7. **Remarks analysis**: Look for dispute remarks (inconsistent across bureaus?), bankruptcy remarks (balance should be $0), collection indicators
8. **High balance / credit limit**: balance exceeds high balance on charge-offs, missing credit limit on revolving accounts

DEBT COLLECTOR SPECIFIC CHECKLIST — For EVERY debt_collection account, ALWAYS check:
9. **Mini-Miranda disclosure**: Flag that CRO must verify all written communications include proper disclosure language — this is the #1 most commonly missed violation
10. **California license number**: If client state is CA, flag that all correspondence must include CA debt collector license number
11. **Cease contact compliance**: Flag that CRO must ask if client sent a written stop request and if contact continued
12. **Inconvenient time/workplace calls**: Flag that CRO must ask about call timing and whether client said they were at work
13. **Third-party disclosure**: Flag that CRO must ask if collector contacted anyone else about the debt
14. **Excessive/harassing calls**: Flag that CRO must ask about call frequency, call logs, threatening language
15. **Privacy and authorization**: Verify all inquiries had a permissible purpose, check for unauthorized report access or pulls, verify employer credit checks had prior written consumer consent
16. **Required notices**: Check if adverse action notices were provided after credit denials or rate increases, verify negative information notices were sent before/within 30 days of first reporting, confirm credit score was disclosed when used in a credit decision, verify consumer was informed of dispute rights and right to free report
17. **Mixed file indicators**: Check for accounts that may belong to someone with a similar SSN, similar name (Jr./Sr./III), or same address — may indicate CRA mixed consumer files

For FCRA reporting violations, use category "FCRA_REPORTING". For privacy violations, use "PRIVACY_VIOLATION". For impermissible purpose pulls, use "IMPERMISSIBLE_PURPOSE". For missing required notices, use "WITHHOLDING_NOTICES". For debt collector conduct violations, use the specific category name (DEBT_COLLECTOR_DISCLOSURE, CA_LICENSE_MISSING, CEASE_CONTACT_VIOLATION, INCONVENIENT_CONTACT, THIRD_PARTY_DISCLOSURE, HARASSMENT_EXCESSIVE_CALLS).`;

/**
 * Compact system prompt for accounts with pre-computed rule-based flags.
 * Skips the full rule checklist since the deterministic engine already ran,
 * focusing the AI on legal context, nuanced patterns, and FDCPA analysis.
 * ~40% fewer tokens than the full prompt.
 */
const VIOLATION_COMPACT_PROMPT = `You are LEXA, an expert FCRA/FDCPA violation detection agent. You analyze credit accounts that have ALREADY been processed by a deterministic rule engine.

## INPUT FORMAT:
Account data is provided as JSON with keys: account, bureauDetails, crossBureauDiffs, ruleBasedFlags, clientState, debtCollectorContext.

## YOUR ROLE:
The account data includes pre-computed "ruleBasedFlags" from our rule engine. Your job is to:
1. **Expand on existing flags** — add legal context, FCRA statute references, evidence details, and dispute strategy
2. **Find nuanced patterns** the rule engine cannot detect — legal interpretation, combined flag implications, timing patterns
3. **Analyze FDCPA debt collector violations** — mini-Miranda disclosure, cease contact, third-party disclosure, harassment, CA license (if applicable)
4. **Assess confidence and severity** based on the combination of flags and data

## DO NOT:
- Re-check rules already flagged (balance mismatches, status conflicts, date issues, etc.) — they are confirmed
- Contradict deterministic flags — they are based on actual data discrepancies
- Generate low-confidence duplicates of existing flags

## FCRA STATUTES:
§1681e(b): Failure to Assure Maximum Possible Accuracy | §1681i: Failure to Conduct Reasonable Reinvestigation | §1681c: Obsolete Information | §1681s-2(a)(3): Failure to Mark as Disputed | §1681s-2(a)(5): False DOFD | §1681s-2(b): Furnisher Failure After CRA Dispute | §1681b: Permissible Purpose Requirements | §1681b(f): Employment Purpose Consent | §1681m(a): Adverse Action Notice | §1681m(h): Credit Score Disclosure | §1681j(a): Free Report After Adverse Action | §1681g: Disclosure of Information to Consumer

## SEVERITY: "critical" (clear statutory violation) | "high" (strong evidence) | "medium" (warrants dispute) | "low" (minor)
## CONFIDENCE: "confirmed" (clear evidence) | "likely" (strong indicators) | "possible" (pattern suggests)

## DEBT COLLECTOR VIOLATIONS (for collection accounts):
1. DEBT_COLLECTOR_DISCLOSURE — Mini-Miranda missing from communications (FDCPA §807(11))
2. CA_LICENSE_MISSING — CA license number missing from correspondence (CA only, Civil Code §1788.11(e))
3. CEASE_CONTACT_VIOLATION — Contact continued after written stop request (FDCPA §805(c))
4. INCONVENIENT_CONTACT — Calls before 8AM/after 9PM or workplace calls (FDCPA §805(a)(1))
5. THIRD_PARTY_DISCLOSURE — Debt disclosed to spouse/family/employer/friend (FDCPA §805(b))
6. HARASSMENT_EXCESSIVE_CALLS — 7+ calls/7 days, 3+/day, threatening language (FDCPA §806)

## ADDITIONAL VIOLATIONS TO CHECK:
7. PRIVACY_VIOLATION — Credit report furnished without permissible purpose or consumer consent; employer checks without written consent (§1681b, §1681b(f))
8. IMPERMISSIBLE_PURPOSE — Hard inquiry without corresponding credit transaction or valid purpose; pulling report on discharged bankruptcy debt (§1681b)
9. WITHHOLDING_NOTICES — Missing adverse action notice, negative info notice, credit score disclosure, dispute rights notice, or free report notice (§1681m, §1681j, §1681g)

For EVERY debt collector account, include a cro_reminder telling the CRO what to ask the client and what documentation to request.

Return ONLY valid JSON:
{
  "violations": [
    {
      "violationType": "Human readable title",
      "severity": "critical|high|medium|low",
      "explanation": "Detailed explanation referencing specific bureau data points",
      "fcraStatute": "§1681x(y) or FDCPA §807/§806 etc.",
      "evidence": "Specific data points from the account",
      "matchedRule": "RULE_NAME",
      "category": "FCRA_REPORTING|DEBT_COLLECTOR_DISCLOSURE|CA_LICENSE_MISSING|CEASE_CONTACT_VIOLATION|INCONVENIENT_CONTACT|THIRD_PARTY_DISCLOSURE|HARASSMENT_EXCESSIVE_CALLS|PRIVACY_VIOLATION|IMPERMISSIBLE_PURPOSE|WITHHOLDING_NOTICES",
      "evidence_required": "What documentation is needed",
      "confidence": "confirmed|likely|possible",
      "cro_reminder": "Reminder for CRO analyst"
    }
  ]
}`;

export async function detectViolations(account: NegativeAccount, clientState?: string | null, learnedPatterns?: ViolationPattern[], trainingExamples?: FcraTrainingExample[]): Promise<DetectedViolation[]> {
  const accountDetails = buildAccountDescription(account, clientState);

  // Use compact prompt when rule-based flags are already present (saves ~40% tokens)
  // Check both JSON format (new) and text format (legacy)
  const hasRuleFlags = account.rawDetails?.includes('"ruleBasedFlags"') ||
    account.rawDetails?.includes("RULE-BASED FLAGS") ||
    account.rawDetails?.includes("Rule-Based Flags:");
  let systemPrompt = hasRuleFlags ? VIOLATION_COMPACT_PROMPT : VIOLATION_SYSTEM_PROMPT;

  // Inject learned violation patterns to enhance scanning accuracy
  if (learnedPatterns && learnedPatterns.length > 0) {
    const relevantPatterns = learnedPatterns
      .filter(p => p.accountType === account.accountType && p.timesConfirmed > p.timesRejected)
      .slice(0, 20); // Top 20 most confirmed patterns

    if (relevantPatterns.length > 0) {
      const patternLines = relevantPatterns.map(p =>
        `- ${p.violationType} (${p.severity}, confirmed ${p.timesConfirmed}x): ${p.matchedRule || "N/A"} | ${p.fcraStatute || ""} | Evidence pattern: ${p.evidencePattern || "N/A"}`
      ).join("\n");

      systemPrompt += `\n\n## LEARNED VIOLATION PATTERNS (from previously confirmed reviews)
The following violation patterns have been confirmed by human reviewers on similar ${formatAccountType(account.accountType)} accounts. Prioritize checking for these patterns as they have high accuracy:
${patternLines}

Use these patterns to:
1. Prioritize checking for violations that have been frequently confirmed
2. Increase confidence level when you find violations matching these patterns
3. Apply similar evidence standards that led to previous confirmations
4. Flag violations matching these patterns with higher severity when evidence is strong`;
    }
  }

  // Inject FCRA training examples to improve detection accuracy
  if (trainingExamples && trainingExamples.length > 0) {
    const relevantExamples = trainingExamples
      .filter(e => e.isActive && e.accountType === account.accountType)
      .slice(0, 15); // Top 15 most relevant examples

    if (relevantExamples.length > 0) {
      const exampleLines = relevantExamples.map(e => {
        let line = `### ${e.title} (${e.severity})\n`;
        line += `- **Violation**: ${e.violationType} | **Statute**: ${e.fcraStatute}\n`;
        line += `- **Scenario**: ${e.scenario}\n`;
        line += `- **Key Evidence**: ${e.expectedEvidence}\n`;
        line += `- **Expected Finding**: ${e.expectedExplanation}\n`;
        if (e.keyIndicators) line += `- **Key Indicators**: ${e.keyIndicators}\n`;
        if (e.commonMistakes) line += `- **Avoid**: ${e.commonMistakes}\n`;
        if (e.caseLawReference) line += `- **Case Law**: ${e.caseLawReference}\n`;
        if (e.regulatoryGuidance) line += `- **Guidance**: ${e.regulatoryGuidance}\n`;
        return line;
      }).join("\n");

      systemPrompt += `\n\n## FCRA TRAINING EXAMPLES (human-curated violation scenarios)
The following are expert-curated examples of FCRA violations for ${formatAccountType(account.accountType)} accounts. Use these to calibrate your detection — they represent confirmed real-world violations and teach you what to look for, what evidence matters, and what mistakes to avoid:

${exampleLines}

Apply these training examples to:
1. Recognize similar violation patterns in the account being analyzed
2. Use the same evidence standards demonstrated in the examples
3. Avoid the common mistakes identified in the training data
4. Reference applicable case law and regulatory guidance when relevant
5. Match severity levels to similar confirmed scenarios`;
    }
  }

  let response;
  try {
    response = await openai.chat.completions.create({
      model: VIOLATION_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze this negative credit account for potential FCRA and FDCPA violations. Be thorough and precise — check EVERY rule systematically. Cross-reference all per-bureau data for discrepancies. For each violation found, provide specific evidence from the account data.\n\n${accountDetails}` }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 16384,
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
  // Check if rawDetails is already JSON (new pipeline format)
  let parsedRawDetails: Record<string, unknown> | null = null;
  if (account.rawDetails) {
    try {
      const parsed = JSON.parse(account.rawDetails);
      if (parsed && typeof parsed === "object" && parsed.account) {
        parsedRawDetails = parsed;
      }
    } catch {
      // Not JSON — legacy text format
    }
  }

  if (parsedRawDetails) {
    // New JSON format: merge account header fields and pass through
    const payload: Record<string, unknown> = { ...parsedRawDetails };

    // Add client state if provided
    if (clientState) {
      (payload.account as Record<string, unknown>).clientState = clientState;
    }

    // Add debt collector context for collection accounts
    if (account.accountType === "debt_collection") {
      const dcContext: string[] = [
        "Verify all written communications include mini-Miranda disclosure",
        "Check if client sent written cease/stop contact request",
        "Check if collector contacted third parties (spouse, family, employer, friends)",
        "Check call frequency for harassment (7+ calls/7 days or 3+/day)",
        "Check call timing (before 8AM/after 9PM) and workplace calls",
      ];
      if (clientState?.toUpperCase() === "CA") {
        dcContext.splice(1, 0, "CALIFORNIA: ALL correspondence must include CA debt collector license number");
      }
      payload.debtCollectorContext = dcContext;
    }

    return JSON.stringify(payload);
  }

  // Legacy text format fallback for manually-entered accounts or old data
  const lines: string[] = [];

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

  if (account.accountType === "debt_collection") {
    lines.push("");
    lines.push("═══ DEBT COLLECTOR ANALYSIS CONTEXT ═══");
    lines.push("This is a DEBT COLLECTION account. Per FDCPA, the following MUST be investigated:");
    lines.push("1. ALL written communications (letters, emails, texts) must include mini-Miranda disclosure");
    if (clientState && clientState.toUpperCase() === "CA") {
      lines.push("2. Client is in CALIFORNIA — ALL correspondence must include CA debt collector license number");
    }
    lines.push(`${clientState?.toUpperCase() === "CA" ? "3" : "2"}. Check if client sent written cease/stop contact request`);
    lines.push(`${clientState?.toUpperCase() === "CA" ? "4" : "3"}. Check if collector contacted third parties (spouse, family, employer, friends)`);
    lines.push(`${clientState?.toUpperCase() === "CA" ? "5" : "4"}. Check call frequency for harassment (7+ calls/7 days or 3+/day)`);
    lines.push(`${clientState?.toUpperCase() === "CA" ? "6" : "5"}. Check call timing (before 8AM/after 9PM) and workplace calls`);
  }

  if (account.rawDetails) {
    lines.push("");
    lines.push("═══ RAW REPORT TEXT ═══");
    lines.push(account.rawDetails);
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
