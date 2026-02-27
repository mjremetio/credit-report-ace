import OpenAI from "openai";
import type { NegativeAccount } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface DetectedViolation {
  violationType: string;
  severity: string;
  explanation: string;
  fcraStatute: string;
  evidence: string;
  matchedRule: string;
}

const VIOLATION_SYSTEM_PROMPT = `You are LEXA, an expert FCRA (Fair Credit Reporting Act) violation detection agent. You analyze individual credit account details provided by a consumer and identify potential reporting violations.

## ACCOUNT TYPES YOU HANDLE:
- **Debt Collection**: Accounts sold to or handled by collection agencies
- **Charge-Off**: Accounts written off by the original creditor as uncollectible
- **Repossession**: Accounts where collateral was repossessed

## FCRA VIOLATION RULES TO CHECK:

### Balance Errors
- BALANCE_PAID_NOT_ZERO: Account shows "Paid" or "Settled" but balance is not $0
- BALANCE_MISMATCH_CROSS_BUREAU: Same account shows different balances across bureaus
- OC_AND_DEBTBUYER_BOTH_BALANCE: Original creditor AND debt buyer both report a balance
- BALANCE_POST_BANKRUPTCY: Account in bankruptcy still shows a balance

### Status Conflicts
- STATUS_OPEN_AND_CHARGEOFF: Account shows both "Open" and "Charge-Off"
- STATUS_DISPUTE_INCONSISTENCY: Account disputed on one bureau but not others
- COLLECTION_AS_REVOLVING: Collection misclassified as revolving credit

### Date / Aging Issues
- DOFD_INCONSISTENT: Date of First Delinquency doesn't match payment history
- OBSOLETE_REPORTING: Negative item older than 7 years from DOFD
- REAGING_DETECTED: DOFD changed to extend reporting window

### Duplicate / Mixed File
- DUPLICATE_TRADELINE_SAME_CREDITOR: Same debt appears twice
- AUTH_USER_AS_PRIMARY: Authorized user reporting as primary

### Payment History Issues
- PAYMENT_GRID_INCONSISTENT_WITH_STATUS: Payment grid conflicts with status
- DEROGATORY_STACKING: Late payments don't align with timeline

### Credit Limit Issues
- MISSING_CREDIT_LIMIT: Credit limit omitted causing high utilization

### Collection-Specific Issues
- MISSING_ORIGINAL_CREDITOR: Collection account doesn't identify original creditor
- NO_VALIDATION_NOTICE: No evidence of proper debt validation
- INCORRECT_BALANCE_WITH_FEES: Balance includes unauthorized fees or interest

### Charge-Off Specific
- CHARGEOFF_BALANCE_INCREASING: Charge-off balance increased after charge-off date
- CHARGEOFF_NOT_ZERO_AFTER_SALE: Balance not zeroed after sale to collector

### Repossession Specific
- DEFICIENCY_BALANCE_WITHOUT_NOTICE: Deficiency balance without proper notice
- IMPROPER_SALE_PROCEEDS: Sale proceeds not properly credited

## FCRA STATUTES:
- §1681e(b): Failure to Assure Maximum Possible Accuracy
- §1681i: Failure to Conduct Reasonable Reinvestigation
- §1681c: Obsolete Information (7-year rule)
- §1681b: Impermissible Purpose
- §1681s-2(a)(3): Failure to Mark Account as Disputed
- §1681s-2(a)(5): False Date of First Delinquency
- §1681s-2(b): Furnisher Failure After CRA Dispute
- §1681g: Failure to Disclose Required Information

## SEVERITY:
- "critical": Clear statutory violation, strong litigation potential
- "high": Strong evidence of inaccuracy, likely actionable
- "medium": Inconsistency that warrants dispute
- "low": Minor discrepancy worth noting

Return ONLY valid JSON:
{
  "violations": [
    {
      "violationType": "Human readable title",
      "severity": "critical|high|medium|low",
      "explanation": "Detailed explanation",
      "fcraStatute": "§1681x(y) - Description",
      "evidence": "Specific data points from the account",
      "matchedRule": "RULE_NAME"
    }
  ]
}

Be thorough but precise. Only flag genuine potential issues. If the account details are sparse, focus on what can be determined from the available information. Always check for the most common issues: balance accuracy, date consistency, proper creditor identification, and bureau consistency.`;

export async function detectViolations(account: NegativeAccount): Promise<DetectedViolation[]> {
  const accountDetails = buildAccountDescription(account);

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: VIOLATION_SYSTEM_PROMPT },
      { role: "user", content: `Analyze this negative credit account for potential FCRA violations:\n\n${accountDetails}` }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.violations) ? parsed.violations : [];
  } catch {
    return [];
  }
}

function buildAccountDescription(account: NegativeAccount): string {
  const lines = [
    `Creditor: ${account.creditor}`,
    `Account Type: ${formatAccountType(account.accountType)}`,
  ];
  if (account.accountNumber) lines.push(`Account Number: ${account.accountNumber}`);
  if (account.originalCreditor) lines.push(`Original Creditor: ${account.originalCreditor}`);
  if (account.balance !== null && account.balance !== undefined) lines.push(`Balance: $${account.balance}`);
  if (account.dateOpened) lines.push(`Date Opened: ${account.dateOpened}`);
  if (account.dateOfDelinquency) lines.push(`Date of First Delinquency: ${account.dateOfDelinquency}`);
  if (account.status) lines.push(`Reported Status: ${account.status}`);
  if (account.bureaus) lines.push(`Reporting Bureaus: ${account.bureaus}`);
  if (account.rawDetails) lines.push(`\nRaw Report Text:\n${account.rawDetails}`);
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
