import OpenAI from "openai";
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  timeout: 300_000, // 5 minutes per request
  maxRetries: 2,
});

export interface AnalysisResult {
  consumerName: string;
  accounts: Array<{
    creditor: string;
    accountNumberMasked: string;
    type: string;
    status: string;
    balance: number;
    dates: { dofd?: string; last_payment?: string };
    bureaus?: string;
    bureauDetails?: Array<{
      bureau: string;
      accountNumber?: string;
      balance?: number;
      status?: string;
      dateOpened?: string;
      lastPayment?: string;
      highBalance?: number;
      creditLimit?: number;
      paymentStatus?: string;
      accountRating?: string;
      creditorType?: string;
    }>;
  }>;
  findings: Array<{
    findingType: string;
    severity: string;
    creditor: string;
    explanation: string;
    fcraTheories: string[];
    evidence: Array<{ bureau: string; quote: string }>;
    matchedRule: string;
  }>;
}

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const lines: string[] = [];

  // Extract tables with preserved column structure (critical for tri-merge bureau reports)
  $("table").each((_i, table) => {
    const rows: string[][] = [];
    $(table).find("tr").each((_j, tr) => {
      const cells: string[] = [];
      $(tr).find("th, td").each((_k, cell) => {
        const text = $(cell).text().replace(/\s+/g, " ").trim();
        cells.push(text);
      });
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length === 0) return;

    // Detect bureau header rows (TransUnion/Experian/Equifax pattern)
    const isBureauTable = rows.some(row =>
      row.some(cell => /transunion|experian|equifax/i.test(cell))
    );

    for (const row of rows) {
      if (isBureauTable && row.length >= 3) {
        // Preserve column alignment: "Label | TU Value | EX Value | EQ Value"
        lines.push(row.join(" | "));
      } else {
        lines.push(row.join(" | "));
      }
    }
    lines.push(""); // separator between tables
  });

  // Also extract non-table text content (headings, paragraphs, lists)
  $("table").remove(); // remove tables since we already extracted them
  $("h1, h2, h3, h4, h5, h6, p, li, div, span, section").each((_i, el) => {
    // Only extract direct text nodes to avoid duplication
    const directText = $(el).contents()
      .filter(function() { return this.type === "text"; })
      .text().replace(/\s+/g, " ").trim();
    if (directText.length > 2) {
      lines.push(directText);
    }
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanRawText(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

// ~10 pages per chunk (approx 4000 chars/page)
const CHUNK_SIZE = 40_000;

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + CHUNK_SIZE, text.length);
    // Try to break at a sentence or whitespace boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(". ", end);
      if (lastPeriod > offset + CHUNK_SIZE * 0.7) {
        end = lastPeriod + 2;
      } else {
        const lastSpace = text.lastIndexOf(" ", end);
        if (lastSpace > offset + CHUNK_SIZE * 0.7) {
          end = lastSpace + 1;
        }
      }
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function mergeAnalysisResults(results: AnalysisResult[]): AnalysisResult {
  const consumerName = results.find(r => r.consumerName && r.consumerName !== "Unknown Consumer")?.consumerName || "Unknown Consumer";

  // Deduplicate accounts by creditor + masked account number
  const seenAccounts = new Map<string, AnalysisResult["accounts"][0]>();
  for (const r of results) {
    for (const acct of r.accounts) {
      const key = `${(acct.creditor || "").toLowerCase().trim()}|${acct.accountNumberMasked || ""}`;
      if (!seenAccounts.has(key)) {
        seenAccounts.set(key, acct);
      }
    }
  }

  // Deduplicate findings by creditor + matchedRule
  const seenFindings = new Map<string, AnalysisResult["findings"][0]>();
  for (const r of results) {
    for (const f of r.findings) {
      const key = `${(f.creditor || "").toLowerCase().trim()}|${f.matchedRule || ""}|${f.findingType || ""}`;
      if (!seenFindings.has(key)) {
        seenFindings.set(key, f);
      }
    }
  }

  return {
    consumerName,
    accounts: Array.from(seenAccounts.values()),
    findings: Array.from(seenFindings.values()),
  };
}

const SYSTEM_PROMPT = `You are LEXA, an expert FCRA (Fair Credit Reporting Act) credit report analysis agent. You are given raw text extracted from a consumer credit report. Your job is to:

1. EXTRACT all accounts/tradelines with their key data points
2. DETECT potential FCRA violations by applying the following rule engine

## CRITICAL: TRI-MERGE CREDIT REPORT FORMAT
Most credit reports are TRI-MERGE reports with 3 bureau columns: TransUnion, Experian, and Equifax.
The data is structured as: "Field Label | TransUnion Value | Experian Value | Equifax Value"

**IMPORTANT PARSING RULES:**
- Each account section shows data across ALL 3 bureaus side by side
- Data may be cut off, interleaved, or wrapped across lines — use context to reassemble fields intelligently
- "--" means the bureau does not report that field (not the same as $0 or empty)
- Compare values ACROSS bureaus to detect discrepancies (different balances, dates, statuses, account numbers, creditor types)
- Extract PER-BUREAU details for each account: account number, balance, status, dates, high balance, credit limit, payment status, creditor type, and account rating
- Personal information (Name, DOB, Address, Employer) is also reported per-bureau — check for inconsistencies
- When the same account has different values across bureaus, this is a KEY signal for potential FCRA violations

## FCRA VIOLATION RULES TO CHECK:

### Balance Errors
- BALANCE_PAID_NOT_ZERO: Account shows "Paid" or "Settled" but balance is not $0
- BALANCE_MISMATCH_CROSS_BUREAU: Same account shows different balances across bureaus (TU/EX/EQ)
- OC_AND_DEBTBUYER_BOTH_BALANCE: Original creditor AND debt buyer both report a balance (double jeopardy)
- BALANCE_POST_BANKRUPTCY: Account included in bankruptcy still shows a balance

### Status Conflicts
- STATUS_OPEN_AND_CHARGEOFF: Account shows both "Open" and "Charge-Off"
- STATUS_DISPUTE_INCONSISTENCY: Account shows "Disputed" on one bureau but not others
- COLLECTION_AS_REVOLVING: Collection account misclassified as revolving credit

### Date / Aging Issues
- DOFD_INCONSISTENT: Date of First Delinquency doesn't match payment history
- OBSOLETE_REPORTING: Negative item older than 7 years from DOFD (10 for bankruptcy)
- REAGING_DETECTED: Evidence of re-aging (DOFD changed to extend reporting window)

### Duplicate / Mixed File
- DUPLICATE_TRADELINE_SAME_CREDITOR: Same debt appears twice under same or related creditors
- MIXED_FILE_NAME_ADDRESS_MISMATCH: Personal info inconsistencies suggesting mixed file (wrong name variants, addresses never lived at)
- AUTH_USER_AS_PRIMARY: Authorized user account reporting as primary account holder

### Payment History Issues
- PAYMENT_GRID_INCONSISTENT_WITH_STATUS: Payment grid shows "current" but status shows derogatory
- DEROGATORY_STACKING: Consecutive late payments that don't align with account timeline

### Credit Limit Issues
- LIMIT_BALANCE_INCONSISTENCY: Credit limit differs across bureaus for same account
- MISSING_CREDIT_LIMIT: Credit limit omitted causing artificially high utilization

### Inquiry Issues
- IMPERMISSIBLE_INQUIRY: Hard inquiry without permissible purpose

## FCRA STATUTES TO REFERENCE:
- §1681e(b): Failure to Follow Reasonable Procedures to Assure Maximum Possible Accuracy
- §1681i: Failure to Conduct Reasonable Reinvestigation After Dispute
- §1681c: Obsolete Information (7-year rule, 10-year for bankruptcy)
- §1681b: Impermissible Purpose
- §1681s-2(a)(3): Failure to Mark Account as Disputed
- §1681s-2(a)(5): False Date of First Delinquency
- §1681s-2(b): Furnisher Failure After CRA Dispute

## SEVERITY LEVELS:
- "critical": Clear statutory violation, strong litigation potential
- "high": Strong evidence of inaccuracy, likely actionable
- "medium": Inconsistency that warrants dispute/investigation
- "low": Minor discrepancy, worth noting

## OUTPUT FORMAT:
Return ONLY valid JSON matching this exact structure:
{
  "consumerName": "FULL NAME from report",
  "accounts": [
    {
      "creditor": "CREDITOR NAME",
      "accountNumberMasked": "....XXXX (use the most complete masked number)",
      "type": "revolving|installment|collection|mortgage|other",
      "status": "current status (most severe across bureaus)",
      "balance": 0,
      "dates": { "dofd": "YYYY-MM or null", "last_payment": "YYYY-MM or null" },
      "bureaus": "TransUnion, Experian, Equifax (list which bureaus report this account)",
      "bureauDetails": [
        {
          "bureau": "TransUnion",
          "accountNumber": "431503**********",
          "balance": 40,
          "status": "Open",
          "dateOpened": "2023-10",
          "lastPayment": "2025-11",
          "highBalance": 488,
          "creditLimit": 300,
          "paymentStatus": "Current",
          "accountRating": "Open",
          "creditorType": "Bank Credit Cards"
        },
        {
          "bureau": "Experian",
          "accountNumber": "431503******",
          "balance": 40,
          "status": "Open",
          "dateOpened": "2023-10",
          "lastPayment": "2025-11",
          "highBalance": 488,
          "creditLimit": 300,
          "paymentStatus": "Current",
          "accountRating": "Open",
          "creditorType": "Bank Credit Cards"
        },
        {
          "bureau": "Equifax",
          "accountNumber": "431503*********",
          "balance": 40,
          "status": "Open",
          "dateOpened": "2023-10",
          "lastPayment": "2025-12",
          "highBalance": 0,
          "creditLimit": 300,
          "paymentStatus": "Current",
          "accountRating": "Open",
          "creditorType": "Miscellaneous Finance"
        }
      ]
    }
  ],
  "findings": [
    {
      "findingType": "Human readable finding title",
      "severity": "critical|high|medium|low",
      "creditor": "CREDITOR NAME or Personal Info",
      "explanation": "Detailed explanation referencing specific bureau discrepancies",
      "fcraTheories": ["§1681e(b) - Description"],
      "evidence": [{ "bureau": "Bureau Name", "quote": "Exact text or data from report" }],
      "matchedRule": "RULE_NAME_FROM_LIST"
    }
  ]
}

IMPORTANT: For each account, you MUST populate the "bureauDetails" array with per-bureau data. Compare values across bureaus to identify cross-bureau discrepancies (different balances, high balances, creditor types, dates, statuses). Even small differences like "Bank Credit Cards" vs "Miscellaneous Finance" for creditor type are significant findings.

In addition to FCRA reporting violations, analyze the report for DEBT COLLECTOR CONDUCT VIOLATIONS under the Fair Debt Collection Practices Act (FDCPA) and related state laws.

For each violation found, also return:
- category: "FCRA_REPORTING" for FCRA violations, or specific FDCPA category
- evidence_required: What documentation is needed
- confidence: "confirmed" | "likely" | "possible"
- cro_reminder: Reminder for CRO analyst

DEBT COLLECTOR VIOLATIONS TO CHECK:

1. DEBT_COLLECTOR_DISCLOSURE (High)
   Flag if written communications lack the "mini-Miranda" disclosure.
   Evidence: Letters, emails, texts, voicemail transcripts lacking disclosure.

2. CA_LICENSE_MISSING (High) — CALIFORNIA ONLY
   Flag if collector correspondence lacks California debt collector license number.
   Evidence: Correspondence missing license number.

3. CEASE_CONTACT_VIOLATION (Critical)
   Flag if client sent written stop request, proof collector received it, and contact continued.
   Evidence: Stop letter, delivery proof, subsequent contact docs.

4. INCONVENIENT_CONTACT (High)
   Flag if calls before 8 AM / after 9 PM, calls to workplace, or continued after inconvenient request.
   Evidence: Recorded calls, call logs with timestamps.

5. THIRD_PARTY_DISCLOSURE (Critical)
   Flag if collector contacted spouse/family/employer/friend and disclosed the debt.
   Evidence: Third-party statements, call logs, misdirected correspondence.

6. HARASSMENT_EXCESSIVE_CALLS (High)
   Flag if 7+ calls in 7 days, 3+ calls same day, back-to-back calls, threatening language.
   Evidence: Call logs, history screenshots, recordings.

Extended findings format (add these fields to each finding):
- "category": "FCRA_REPORTING|DEBT_COLLECTOR_DISCLOSURE|CA_LICENSE_MISSING|CEASE_CONTACT_VIOLATION|INCONVENIENT_CONTACT|THIRD_PARTY_DISCLOSURE|HARASSMENT_EXCESSIVE_CALLS"
- "evidence_required": "Description of documentation needed"
- "confidence": "confirmed|likely|possible"
- "cro_reminder": "Reminder for CRO analyst"

Be thorough but precise. Only flag genuine discrepancies and potential violations. Do not flag accurate negative information as a violation. Do not invent accounts or data points that are not present in the provided text.`;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  const text = result.pages.map((p: any) => p.text).join(" ");
  return text.replace(/\s+/g, " ").trim();
}

async function analyzeChunk(chunkText: string, chunkIndex: number, totalChunks: number): Promise<AnalysisResult> {
  const chunkContext = totalChunks > 1
    ? `This is section ${chunkIndex + 1} of ${totalChunks} from the credit report. Extract ALL accounts and violations found in this section:\n\n`
    : `Analyze this credit report and extract all accounts and FCRA violations:\n\n`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${chunkContext}${chunkText}` }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 16384,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      consumerName: parsed.consumerName || "Unknown Consumer",
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    return { consumerName: "Unknown Consumer", accounts: [], findings: [] };
  }
}

async function analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<AnalysisResult> {
  const base64 = imageBuffer.toString("base64");
  const mediaType = mimeType.startsWith("image/") ? mimeType : "image/png";

  console.log(`[analyzer] Processing image (${(imageBuffer.length / 1024).toFixed(0)}KB) via vision API`);

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this credit report image. This is a tri-merge credit report with TransUnion, Experian, and Equifax columns. Extract ALL accounts, personal information, and detect ALL FCRA violations. Pay close attention to per-bureau differences in balances, dates, statuses, and creditor types.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${base64}` },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 16384,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      consumerName: parsed.consumerName || "Unknown Consumer",
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    return { consumerName: "Unknown Consumer", accounts: [], findings: [] };
  }
}

export async function analyzeReport(content: string, fileType: string, pdfBuffer?: Buffer, imageBuffer?: Buffer): Promise<AnalysisResult> {
  // Handle image files via vision API
  if (imageBuffer && fileType.startsWith("image/")) {
    try {
      return await analyzeImage(imageBuffer, fileType);
    } catch (err: any) {
      console.error("AI vision service error:", err?.message || err);
      throw new Error("AI image analysis service is temporarily unavailable. Please try again in a moment.");
    }
  }

  let extractedText: string;

  if (fileType === "application/pdf" && pdfBuffer) {
    extractedText = await extractTextFromPdf(pdfBuffer);
  } else if (fileType === "text/html" || fileType === "html") {
    extractedText = extractTextFromHtml(content);
  } else {
    extractedText = cleanRawText(content);
  }

  if (extractedText.length < 50) {
    throw new Error("Could not extract sufficient text from the uploaded file. The file may be image-based or corrupted.");
  }

  const chunks = chunkText(extractedText);
  console.log(`[analyzer] Extracted ${extractedText.length} chars, split into ${chunks.length} chunk(s) for AI analysis`);

  const results: AnalysisResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      console.log(`[analyzer] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
      const result = await analyzeChunk(chunks[i], i, chunks.length);
      results.push(result);
    } catch (err: any) {
      console.error(`AI service error on chunk ${i + 1}/${chunks.length}:`, err?.message || err);
      if (results.length === 0) {
        throw new Error("AI analysis service is temporarily unavailable. Please try again in a moment.");
      }
      // Continue with partial results if some chunks succeeded
    }
  }

  return mergeAnalysisResults(results);
}
