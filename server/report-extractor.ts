/**
 * Two-Pass LLM Extraction Pipeline
 *
 * Pass 1: "Extract structured fields" — per-section LLM call with strict JSON schema
 * Pass 2: "Validate + dedupe" — ensure bureau blocks align, no missing key fields
 *
 * This replaces the monolithic analyze-everything-at-once approach.
 */

import OpenAI from "openai";
import type {
  ParsedCreditReport,
  CreditReportProfile,
  BureauSummary,
  Tradeline,
  TradeBureauDetail,
  PublicRecord,
  Inquiry,
  ConsumerStatement,
  Bureau,
  AccountType,
  AccountStatus,
  ALL_BUREAUS,
  LLMProfileExtraction,
  LLMTradelineExtraction,
  LLMPublicRecordExtraction,
  LLMInquiryExtraction,
  LLMBureauSummaryExtraction,
  LLMConsumerStatementExtraction,
} from "@shared/credit-report-types";
import type { ReportSection } from "./report-parser";
import { batchSections } from "./report-parser";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  timeout: 300_000,
  maxRetries: 2,
});

// ── Pass 1: Extract structured fields ──────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a precise credit report data extractor. Your ONLY job is to extract structured data from credit report text into a strict JSON schema. Do NOT analyze, interpret, or flag violations — just extract.

## RULES:
- Extract EXACTLY what the report says — do not infer or fabricate data
- For tri-merge reports, extract PER-BUREAU values separately (TransUnion, Experian, Equifax)
- The text may contain pre-structured bureau labels in the format:
  "Field Name | TransUnion: value1 | Experian: value2 | Equifax: value3"
  When you see this format, extract each bureau's value into the correct bureauDetails entry.
- "--" means "not reported by this bureau" (use null)
- Preserve masked account numbers exactly as shown
- Dates should be in "YYYY-MM" or "YYYY-MM-DD" format
- Dollar amounts should be numbers (no $ symbol, no commas)
- Extract ALL remarks/comments verbatim — these are critical for dispute analysis
- If a section contains multiple accounts, extract each one separately
- Payment history grids should be extracted month-by-month with the status code
- Section markers like "=== SECTION NAME ===" indicate report sections

Return ONLY valid JSON.`;

const PROFILE_EXTRACTION_PROMPT = `Extract personal information from this credit report section.

IMPORTANT: For tri-bureau reports, Date of Birth may differ or be missing for certain bureaus.
Extract the per-bureau Date of Birth values separately. If the report shows DOB in a tri-bureau
format (e.g., "DATE OF BIRTH | TransUnion: 01/15/1985 | Experian: 01/15/1985 | Equifax: --"
or "DATE OF BIRTH | 1995 | 1995 | 1997"), extract each bureau's value.
If a bureau shows "--" or is blank, use null for that bureau.

CRITICAL: Date of Birth may appear as a full date (01/15/1985), year-month (03/1985), or YEAR ONLY (1995).
Always preserve the value exactly as available — use "YYYY-MM-DD" if full date, "YYYY-MM" if month+year,
or "YYYY" if only year. Do NOT return null just because the date is partial. A year like "1995" is valid.

When DOB appears in a table row like "DATE OF BIRTH | value1 | value2 | value3", the columns
correspond to TransUnion, Experian, Equifax (in that order) based on the table headers.

Return JSON:
{
  "name": "FULL NAME",
  "aliases": ["any name variations"],
  "dateOfBirth": "YYYY-MM-DD, YYYY-MM, or YYYY (use most complete value across bureaus, or null)",
  "dateOfBirthPerBureau": [
    { "bureau": "TransUnion", "value": "YYYY-MM-DD or YYYY-MM or YYYY or null" },
    { "bureau": "Experian", "value": "YYYY-MM-DD or YYYY-MM or YYYY or null" },
    { "bureau": "Equifax", "value": "YYYY-MM-DD or YYYY-MM or YYYY or null" }
  ],
  "ssn": "XXX-XX-1234 (masked) or null",
  "reportDate": "YYYY-MM-DD",
  "scores": [{ "bureau": "TransUnion|Experian|Equifax", "score": 557, "model": "VantageScore 3.0" }],
  "addresses": [{ "address": "full address", "bureaus": ["TransUnion", "Experian"] }],
  "employers": [{ "name": "employer name", "bureaus": ["TransUnion"] }]
}`;

const TRADELINE_EXTRACTION_PROMPT = `Extract ALL tradeline/account data from this credit report section.

For EACH account, return per-bureau details separately. Return JSON:
{
  "tradelines": [
    {
      "creditorName": "CREDITOR NAME",
      "accountNumberMasked": "431503*****",
      "accountType": "revolving|installment|collection|mortgage|student_loan|auto_loan|other",
      "status": "current|late|chargeoff|collection|closed|paid|settled|bankruptcy|repossession|derogatory|other",
      "originalCreditor": "name if collection/transferred, else null",
      "balance": 0,
      "bureaus": ["TransUnion", "Experian", "Equifax"],
      "bureauDetails": [
        {
          "bureau": "TransUnion",
          "accountNumber": "431503**********",
          "balance": 40,
          "status": "Open",
          "dateOpened": "2023-10",
          "dateClosed": null,
          "lastPaymentDate": "2025-11",
          "lastReportedDate": "2025-12",
          "highBalance": 488,
          "creditLimit": 300,
          "monthlyPayment": 25,
          "paymentStatus": "Current",
          "accountRating": "Open/Current",
          "creditorType": "Bank Credit Cards",
          "pastDueAmount": 0,
          "terms": "Revolving",
          "paymentHistory": [{ "month": "2025-12", "code": "C" }, { "month": "2025-11", "code": "C" }],
          "remarks": ["Account in good standing"]
        }
      ],
      "dates": {
        "opened": "2023-10",
        "closed": null,
        "firstDelinquency": null,
        "lastPayment": "2025-11",
        "lastReported": "2025-12"
      },
      "remarks": ["all distinct remarks across ALL bureaus"]
    }
  ]
}

IMPORTANT:
- Extract payment history grids as month/code pairs (C=Current, 30/60/90/120=Late days, CO=Charge-off, CL=Collection, BK=Bankruptcy)
- Extract ALL remarks/comments — especially bankruptcy, dispute, and collection remarks
- If the same account shows different values across bureaus, record each bureau's value separately`;

const SUMMARY_EXTRACTION_PROMPT = `Extract the per-bureau account summary statistics from this credit report section.

Return JSON:
{
  "bureauSummaries": [
    {
      "bureau": "TransUnion",
      "totalAccounts": 25,
      "openAccounts": 10,
      "closedAccounts": 15,
      "derogatoryCount": 3,
      "collectionsCount": 2,
      "publicRecordsCount": 1,
      "inquiriesCount": 5,
      "balanceTotal": 50000,
      "creditLimitTotal": 100000,
      "monthlyPaymentTotal": 1500
    }
  ]
}`;

const PUBLIC_RECORDS_EXTRACTION_PROMPT = `Extract ALL public records from this credit report section.

Return JSON:
{
  "publicRecords": [
    {
      "type": "Bankruptcy Chapter 7",
      "court": "Court name",
      "caseNumber": "XX-XXXXX",
      "dateFiled": "2020-01",
      "dateDischarged": "2020-06",
      "amount": 50000,
      "bureaus": ["TransUnion", "Experian", "Equifax"],
      "remarks": ["Discharged", "Chapter 7"]
    }
  ]
}`;

const INQUIRIES_EXTRACTION_PROMPT = `Extract ALL credit inquiries from this credit report section.

Return JSON:
{
  "inquiries": [
    {
      "creditorName": "CREDITOR NAME",
      "date": "2025-06-15",
      "type": "hard|soft|unknown",
      "bureau": "TransUnion|Experian|Equifax",
      "permissiblePurpose": "reason if stated"
    }
  ]
}`;

const CONSUMER_STATEMENT_EXTRACTION_PROMPT = `Extract ALL consumer statements (also called "personal statements" or "consumer remarks") from this credit report section.

Consumer statements are free-text statements added by the consumer to their credit file. They may appear per-bureau.

Return JSON:
{
  "consumerStatements": [
    {
      "bureau": "TransUnion|Experian|Equifax",
      "statement": "The full text of the consumer statement",
      "dateAdded": "YYYY-MM-DD or null"
    }
  ]
}

If no consumer statements are found, return: { "consumerStatements": [] }`;

const IMAGE_FULL_EXTRACTION_PROMPT = `This is a credit report image. Extract ALL structured data into JSON.

Return JSON:
{
  "profile": { "name": "...", "reportDate": "...", "scores": [...], "addresses": [...], "employers": [...] },
  "bureauSummaries": [...],
  "tradelines": [...],
  "publicRecords": [...],
  "inquiries": [...],
  "consumerStatements": [{ "bureau": "...", "statement": "...", "dateAdded": "..." }]
}

Use the exact same field shapes as described: tradelines with bureauDetails arrays, per-bureau scores, etc.`;

// ── LLM call helper ────────────────────────────────────────────────

async function llmExtract<T>(systemPrompt: string, userPrompt: string, sectionText: string): Promise<T> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${userPrompt}\n\n--- BEGIN REPORT TEXT ---\n${sectionText}\n--- END REPORT TEXT ---` },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 16384,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw) as T;
}

async function llmExtractImage<T>(systemPrompt: string, userPrompt: string, imageBuffer: Buffer, mimeType: string): Promise<T> {
  const base64 = imageBuffer.toString("base64");
  const mediaType = mimeType.startsWith("image/") ? mimeType : "image/png";

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 16384,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw) as T;
}

// ── Pass 1: Section-by-section extraction (parallel) ───────────────

interface RawExtraction {
  profile?: LLMProfileExtraction;
  bureauSummaries: LLMBureauSummaryExtraction[];
  tradelines: Array<LLMTradelineExtraction & { evidenceText: string }>;
  publicRecords: Array<LLMPublicRecordExtraction & { evidenceText: string }>;
  inquiries: LLMInquiryExtraction[];
  consumerStatements: LLMConsumerStatementExtraction[];
}

/** Process a single batch through the appropriate LLM extraction prompt */
async function extractSingleBatch(batch: ReportSection[]): Promise<RawExtraction> {
  const batchText = batch.map(s => `[${s.type.toUpperCase()}: ${s.label}]\n${s.text}`).join("\n\n===\n\n");
  const primaryType = batch[0].type;

  const result: RawExtraction = {
    bureauSummaries: [],
    tradelines: [],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  if (primaryType === "personal_info") {
    const data = await llmExtract<{ name?: string; aliases?: string[]; dateOfBirth?: string; dateOfBirthPerBureau?: Array<{ bureau: string; value: string | null }>; ssn?: string; reportDate?: string; scores?: any[]; addresses?: any[]; employers?: any[] }>(
      EXTRACTION_SYSTEM_PROMPT,
      PROFILE_EXTRACTION_PROMPT,
      batchText,
    );
    if (data.name) {
      result.profile = { ...data, name: data.name } as LLMProfileExtraction;
    }
  } else if (primaryType === "bureau_summary") {
    const data = await llmExtract<{ bureauSummaries?: LLMBureauSummaryExtraction[] }>(
      EXTRACTION_SYSTEM_PROMPT,
      SUMMARY_EXTRACTION_PROMPT,
      batchText,
    );
    if (data.bureauSummaries) {
      result.bureauSummaries.push(...data.bureauSummaries);
    }
  } else if (primaryType === "public_records") {
    const data = await llmExtract<{ publicRecords?: LLMPublicRecordExtraction[] }>(
      EXTRACTION_SYSTEM_PROMPT,
      PUBLIC_RECORDS_EXTRACTION_PROMPT,
      batchText,
    );
    if (data.publicRecords) {
      result.publicRecords.push(...data.publicRecords.map(r => ({
        ...r,
        evidenceText: batchText,
      })));
    }
  } else if (primaryType === "inquiries") {
    const data = await llmExtract<{ inquiries?: LLMInquiryExtraction[] }>(
      EXTRACTION_SYSTEM_PROMPT,
      INQUIRIES_EXTRACTION_PROMPT,
      batchText,
    );
    if (data.inquiries) {
      result.inquiries.push(...data.inquiries);
    }
  } else if (primaryType === "consumer_statement") {
    const data = await llmExtract<{ consumerStatements?: LLMConsumerStatementExtraction[] }>(
      EXTRACTION_SYSTEM_PROMPT,
      CONSUMER_STATEMENT_EXTRACTION_PROMPT,
      batchText,
    );
    if (data.consumerStatements) {
      result.consumerStatements.push(...data.consumerStatements);
    }
  } else {
    // Default: treat as tradeline extraction (most sections contain accounts)
    const data = await llmExtract<{
      tradelines?: LLMTradelineExtraction[];
      profile?: LLMProfileExtraction;
      publicRecords?: LLMPublicRecordExtraction[];
      inquiries?: LLMInquiryExtraction[];
      bureauSummaries?: LLMBureauSummaryExtraction[];
      consumerStatements?: LLMConsumerStatementExtraction[];
    }>(
      EXTRACTION_SYSTEM_PROMPT,
      TRADELINE_EXTRACTION_PROMPT,
      batchText,
    );

    if (data.tradelines) {
      result.tradelines.push(...data.tradelines.map(t => ({
        ...t,
        evidenceText: batchText,
      })));
    }
    if (data.profile) {
      result.profile = data.profile;
    }
    if (data.publicRecords) {
      result.publicRecords.push(...data.publicRecords.map(r => ({
        ...r,
        evidenceText: batchText,
      })));
    }
    if (data.inquiries) {
      result.inquiries.push(...data.inquiries);
    }
    if (data.bureauSummaries) {
      result.bureauSummaries.push(...data.bureauSummaries);
    }
    if (data.consumerStatements) {
      result.consumerStatements.push(...data.consumerStatements);
    }
  }

  return result;
}

export async function extractPass1(sections: ReportSection[], imageBuffer?: Buffer, imageMimeType?: string): Promise<RawExtraction> {
  // Handle image-based reports
  if (sections.length === 1 && sections[0].text === "__IMAGE_INPUT__" && imageBuffer) {
    const result = await llmExtractImage<any>(
      EXTRACTION_SYSTEM_PROMPT,
      IMAGE_FULL_EXTRACTION_PROMPT,
      imageBuffer,
      imageMimeType || "image/png",
    );
    return {
      profile: result.profile || undefined,
      bureauSummaries: Array.isArray(result.bureauSummaries) ? result.bureauSummaries : [],
      tradelines: (Array.isArray(result.tradelines) ? result.tradelines : []).map((t: any) => ({
        ...t,
        evidenceText: JSON.stringify(t),
      })),
      publicRecords: (Array.isArray(result.publicRecords) ? result.publicRecords : []).map((r: any) => ({
        ...r,
        evidenceText: JSON.stringify(r),
      })),
      inquiries: Array.isArray(result.inquiries) ? result.inquiries : [],
      consumerStatements: Array.isArray(result.consumerStatements) ? result.consumerStatements : [],
    };
  }

  // Batch sections by type, then process all batches in parallel
  const batches = batchSections(sections);
  console.log(`[extractor] Processing ${batches.length} batch(es) in parallel`);

  const batchResults = await Promise.allSettled(
    batches.map(batch => extractSingleBatch(batch))
  );

  // Merge all batch results
  const raw: RawExtraction = {
    bureauSummaries: [],
    tradelines: [],
    publicRecords: [],
    inquiries: [],
    consumerStatements: [],
  };

  for (const settled of batchResults) {
    if (settled.status === "rejected") {
      console.error(`[extractor] Batch failed:`, settled.reason?.message || settled.reason);
      continue;
    }
    const data = settled.value;
    if (data.profile) {
      if (!raw.profile) {
        raw.profile = data.profile;
      } else {
        // Merge profile fields from later batches — fill in missing data
        // This handles the case where Credit Scores and Personal Info are in separate batches
        if (!raw.profile.dateOfBirth && data.profile.dateOfBirth) {
          raw.profile.dateOfBirth = data.profile.dateOfBirth;
        }
        if ((!raw.profile.dateOfBirthPerBureau || raw.profile.dateOfBirthPerBureau.length === 0) && data.profile.dateOfBirthPerBureau && data.profile.dateOfBirthPerBureau.length > 0) {
          raw.profile.dateOfBirthPerBureau = data.profile.dateOfBirthPerBureau;
        }
        if (!raw.profile.ssn && data.profile.ssn) {
          raw.profile.ssn = data.profile.ssn;
        }
        if (!raw.profile.name && data.profile.name) {
          raw.profile.name = data.profile.name;
        }
        if ((!raw.profile.aliases || raw.profile.aliases.length === 0) && data.profile.aliases && data.profile.aliases.length > 0) {
          raw.profile.aliases = data.profile.aliases;
        }
        if (!raw.profile.reportDate && data.profile.reportDate) {
          raw.profile.reportDate = data.profile.reportDate;
        }
        if ((!raw.profile.scores || raw.profile.scores.length === 0) && data.profile.scores && data.profile.scores.length > 0) {
          raw.profile.scores = data.profile.scores;
        }
        if ((!raw.profile.addresses || raw.profile.addresses.length === 0) && data.profile.addresses && data.profile.addresses.length > 0) {
          raw.profile.addresses = data.profile.addresses;
        }
        if ((!raw.profile.employers || raw.profile.employers.length === 0) && data.profile.employers && data.profile.employers.length > 0) {
          raw.profile.employers = data.profile.employers;
        }
      }
    }
    raw.bureauSummaries.push(...data.bureauSummaries);
    raw.tradelines.push(...data.tradelines);
    raw.publicRecords.push(...data.publicRecords);
    raw.inquiries.push(...data.inquiries);
    raw.consumerStatements.push(...data.consumerStatements);
  }

  return raw;
}

// ── Pass 2: Validate + Dedupe + Normalize ──────────────────────────

function normalizeBureau(name: string): Bureau | null {
  const n = name.toLowerCase().trim();
  if (n.includes("transunion") || n === "tu") return "TransUnion";
  if (n.includes("experian") || n === "ex") return "Experian";
  if (n.includes("equifax") || n === "eq") return "Equifax";
  return null;
}

function normalizeAccountType(raw: string | undefined): AccountType {
  if (!raw) return "other";
  const t = raw.toLowerCase();
  if (t.includes("revolv")) return "revolving";
  if (t.includes("install")) return "installment";
  if (t.includes("collect")) return "collection";
  if (t.includes("mortgage") || t.includes("home")) return "mortgage";
  if (t.includes("student")) return "student_loan";
  if (t.includes("auto")) return "auto_loan";
  return "other";
}

function normalizeAccountStatus(raw: string | undefined): AccountStatus {
  if (!raw) return "other";
  const s = raw.toLowerCase();
  if (s.includes("current") || s.includes("open") && !s.includes("charge")) return "current";
  if (s.includes("late") || s.includes("past due") || s.includes("delinq")) return "late";
  if (s.includes("charge") && s.includes("off") || s.includes("chargeoff")) return "chargeoff";
  if (s.includes("collect")) return "collection";
  if (s.includes("closed") || s.includes("transferred")) return "closed";
  if (s.includes("paid")) return "paid";
  if (s.includes("settled")) return "settled";
  if (s.includes("bankrupt")) return "bankruptcy";
  if (s.includes("reposs")) return "repossession";
  if (s.includes("derog")) return "derogatory";
  return "other";
}

function dedupeTradelineKey(t: LLMTradelineExtraction): string {
  const name = (t.creditorName || "").toLowerCase().trim().replace(/\s+/g, " ");
  const acctNum = (t.accountNumberMasked || "").replace(/[^0-9*]/g, "");
  return `${name}|${acctNum}`;
}

export function validateAndNormalize(raw: RawExtraction): ParsedCreditReport {
  // ── Profile ──
  // Build per-bureau DOB: use LLM-extracted per-bureau values, or fall back to single value
  const dobPerBureau: Array<{ bureau: Bureau; value: string | null }> = [];
  if (raw.profile?.dateOfBirthPerBureau && raw.profile.dateOfBirthPerBureau.length > 0) {
    for (const entry of raw.profile.dateOfBirthPerBureau) {
      const bureau = normalizeBureau(entry.bureau);
      if (bureau) {
        dobPerBureau.push({ bureau, value: entry.value || null });
      }
    }
  }
  // Ensure all 3 bureaus are represented
  const ALL_BUREAU_NAMES: Bureau[] = ["TransUnion", "Experian", "Equifax"];
  const hasPerBureauData = dobPerBureau.length > 0;
  for (const b of ALL_BUREAU_NAMES) {
    if (!dobPerBureau.find(d => d.bureau === b)) {
      // If we have a single dateOfBirth but no per-bureau data, replicate it to all bureaus
      const fallback = raw.profile?.dateOfBirth || null;
      dobPerBureau.push({ bureau: b, value: hasPerBureauData ? null : fallback });
    }
  }

  const profile: CreditReportProfile = {
    name: raw.profile?.name || "Unknown Consumer",
    aliases: raw.profile?.aliases || [],
    dateOfBirth: raw.profile?.dateOfBirth || undefined,
    dateOfBirthPerBureau: dobPerBureau,
    ssn: raw.profile?.ssn || undefined,
    reportDate: raw.profile?.reportDate || new Date().toISOString().split("T")[0],
    scores: (raw.profile?.scores || []).map(s => ({
      bureau: normalizeBureau(s.bureau) || "TransUnion" as Bureau,
      score: typeof s.score === "number" ? s.score : null,
      model: s.model,
    })),
    addresses: (raw.profile?.addresses || []).map(a => ({
      address: a.address,
      bureaus: (a.bureaus || []).map(b => normalizeBureau(b)).filter((b): b is Bureau => b !== null),
    })),
    employers: (raw.profile?.employers || []).map(e => ({
      name: e.name,
      bureaus: (e.bureaus || []).map(b => normalizeBureau(b)).filter((b): b is Bureau => b !== null),
    })),
  };

  // ── Bureau Summaries ──
  const summaryMap = new Map<Bureau, BureauSummary>();
  for (const s of raw.bureauSummaries) {
    const bureau = normalizeBureau(s.bureau);
    if (!bureau) continue;
    summaryMap.set(bureau, {
      bureau,
      totalAccounts: s.totalAccounts || 0,
      openAccounts: s.openAccounts || 0,
      closedAccounts: s.closedAccounts || 0,
      derogatoryCount: s.derogatoryCount || 0,
      collectionsCount: s.collectionsCount || 0,
      publicRecordsCount: s.publicRecordsCount || 0,
      inquiriesCount: s.inquiriesCount || 0,
      balanceTotal: s.balanceTotal,
      creditLimitTotal: s.creditLimitTotal,
      monthlyPaymentTotal: s.monthlyPaymentTotal,
    });
  }

  // ── Tradelines (deduplicate) ──
  const tradelineMap = new Map<string, LLMTradelineExtraction & { evidenceText: string }>();
  for (const t of raw.tradelines) {
    const key = dedupeTradelineKey(t);
    if (!tradelineMap.has(key)) {
      tradelineMap.set(key, t);
    } else {
      // Merge bureau details from duplicate
      const existing = tradelineMap.get(key)!;
      if (t.bureauDetails) {
        existing.bureauDetails = [...(existing.bureauDetails || []), ...t.bureauDetails];
      }
      if (t.remarks) {
        existing.remarks = Array.from(new Set([...(existing.remarks || []), ...t.remarks]));
      }
    }
  }

  const tradelines: Tradeline[] = Array.from(tradelineMap.values()).map(t => {
    const bureauDetails: TradeBureauDetail[] = (t.bureauDetails || []).reduce<TradeBureauDetail[]>((acc, bd) => {
      const bureau = normalizeBureau(bd.bureau);
      if (!bureau) return acc;
      acc.push({
        bureau,
        accountNumber: bd.accountNumber,
        balance: typeof bd.balance === "number" ? bd.balance : null,
        status: bd.status,
        dateOpened: bd.dateOpened,
        dateClosed: bd.dateClosed,
        lastPaymentDate: bd.lastPaymentDate,
        lastReportedDate: bd.lastReportedDate,
        highBalance: typeof bd.highBalance === "number" ? bd.highBalance : null,
        creditLimit: typeof bd.creditLimit === "number" ? bd.creditLimit : null,
        monthlyPayment: typeof bd.monthlyPayment === "number" ? bd.monthlyPayment : null,
        paymentStatus: bd.paymentStatus,
        accountRating: bd.accountRating,
        creditorType: bd.creditorType,
        pastDueAmount: typeof bd.pastDueAmount === "number" ? bd.pastDueAmount : null,
        terms: bd.terms,
        paymentHistory: (bd.paymentHistory || []).map(ph => ({
          month: ph.month,
          code: ph.code,
        })),
        remarks: bd.remarks || [],
      });
      return acc;
    }, []);

    // Dedupe bureau details by bureau name
    const seenBureaus = new Set<string>();
    const uniqueBureauDetails = bureauDetails.filter(bd => {
      if (seenBureaus.has(bd.bureau)) return false;
      seenBureaus.add(bd.bureau);
      return true;
    });

    const bureaus: Bureau[] = (t.bureaus || [])
      .map(b => normalizeBureau(b))
      .filter((b): b is Bureau => b !== null);
    // Also add bureaus from details
    for (const bd of uniqueBureauDetails) {
      if (!bureaus.includes(bd.bureau)) bureaus.push(bd.bureau);
    }

    // Collect all remarks
    const allRemarks = new Set<string>(t.remarks || []);
    for (const bd of uniqueBureauDetails) {
      for (const r of bd.remarks || []) {
        allRemarks.add(r);
      }
    }

    // ── Aggregate balance from bureau details if top-level is missing ──
    let balance: number | null = typeof t.balance === "number" ? t.balance : null;
    if (balance === null && uniqueBureauDetails.length > 0) {
      // Use the highest balance across bureaus (most conservative for dispute purposes)
      const bureauBalances = uniqueBureauDetails
        .filter(bd => bd.balance !== null && bd.balance !== undefined)
        .map(bd => bd.balance!);
      if (bureauBalances.length > 0) {
        balance = Math.max(...bureauBalances);
      }
    }

    // ── Aggregate dates from bureau details if top-level is missing ──
    const dates: {
      opened?: string;
      closed?: string;
      firstDelinquency?: string;
      lastPayment?: string;
      lastReported?: string;
    } = {
      opened: t.dates?.opened,
      closed: t.dates?.closed,
      firstDelinquency: t.dates?.firstDelinquency,
      lastPayment: t.dates?.lastPayment,
      lastReported: t.dates?.lastReported,
    };

    if (uniqueBureauDetails.length > 0) {
      // Fill missing dates from bureau details (use earliest for opened, latest for others)
      if (!dates.opened) {
        const openedDates = uniqueBureauDetails.filter(bd => bd.dateOpened).map(bd => bd.dateOpened!);
        if (openedDates.length > 0) dates.opened = openedDates.sort()[0]; // earliest
      }
      if (!dates.closed) {
        const closedDates = uniqueBureauDetails.filter(bd => bd.dateClosed).map(bd => bd.dateClosed!);
        if (closedDates.length > 0) dates.closed = closedDates.sort().reverse()[0]; // latest
      }
      if (!dates.lastPayment) {
        const lpDates = uniqueBureauDetails.filter(bd => bd.lastPaymentDate).map(bd => bd.lastPaymentDate!);
        if (lpDates.length > 0) dates.lastPayment = lpDates.sort().reverse()[0]; // latest
      }
      if (!dates.lastReported) {
        const lrDates = uniqueBureauDetails.filter(bd => bd.lastReportedDate).map(bd => bd.lastReportedDate!);
        if (lrDates.length > 0) dates.lastReported = lrDates.sort().reverse()[0]; // latest
      }
    }

    // ── Aggregate status from bureau details if top-level is missing ──
    let aggregateStatus = normalizeAccountStatus(t.status);
    if (aggregateStatus === "other" && uniqueBureauDetails.length > 0) {
      const statuses = uniqueBureauDetails.filter(bd => bd.status).map(bd => normalizeAccountStatus(bd.status));
      const severityOrder: AccountStatus[] = ["chargeoff", "collection", "repossession", "bankruptcy", "derogatory", "late", "settled", "paid", "closed", "current", "other"];
      for (const s of severityOrder) {
        if (statuses.includes(s)) { aggregateStatus = s; break; }
      }
    }

    return {
      creditorName: t.creditorName || "Unknown",
      accountNumberMasked: t.accountNumberMasked,
      accountType: normalizeAccountType(t.accountType),
      aggregateStatus,
      originalCreditor: t.originalCreditor || undefined,
      balance,
      bureaus,
      bureauDetails: uniqueBureauDetails,
      dates,
      remarks: Array.from(allRemarks),
      evidenceText: t.evidenceText,
    };
  });

  // ── Public Records ──
  const publicRecords: PublicRecord[] = raw.publicRecords.map(r => ({
    type: r.type || "Unknown",
    court: r.court,
    caseNumber: r.caseNumber,
    dateFiled: r.dateFiled,
    dateDischarged: r.dateDischarged,
    amount: typeof r.amount === "number" ? r.amount : null,
    bureaus: (r.bureaus || []).map(b => normalizeBureau(b)).filter((b): b is Bureau => b !== null),
    remarks: r.remarks || [],
    evidenceText: r.evidenceText,
  }));

  // ── Inquiries (deduplicate) ──
  const inquirySet = new Set<string>();
  const inquiries: Inquiry[] = raw.inquiries.reduce<Inquiry[]>((acc, i) => {
    const bureau = normalizeBureau(i.bureau);
    if (!bureau) return acc;
    const key = `${i.creditorName?.toLowerCase()}|${i.date}|${bureau}`;
    if (inquirySet.has(key)) return acc;
    inquirySet.add(key);
    acc.push({
      creditorName: i.creditorName || "Unknown",
      date: i.date,
      type: (i.type === "hard" || i.type === "soft") ? i.type : "unknown" as const,
      bureau,
      permissiblePurpose: i.permissiblePurpose,
    });
    return acc;
  }, []);

  // ── Consumer Statements ──
  const consumerStatements: ConsumerStatement[] = raw.consumerStatements.map(cs => {
    const bureau = normalizeBureau(cs.bureau);
    return {
      bureau: bureau || "TransUnion" as Bureau,
      statement: cs.statement || "",
      dateAdded: cs.dateAdded,
    };
  }).filter(cs => cs.statement.length > 0);

  return {
    profile,
    bureauSummaries: Array.from(summaryMap.values()),
    tradelines,
    publicRecords,
    inquiries,
    consumerStatements,
    issueFlags: [], // filled by rule engine
    summary: { accountOneLiners: [], categorySummaries: [], actionPlan: [] }, // filled by summary generator
    metadata: {
      parsedAt: new Date().toISOString(),
      parserVersion: "2.0.0",
    },
  };
}

// ── Full extraction pipeline ───────────────────────────────────────

export async function extractCreditReport(
  sections: ReportSection[],
  imageBuffer?: Buffer,
  imageMimeType?: string,
): Promise<ParsedCreditReport> {
  console.log(`[extractor] Pass 1: Extracting structured fields from ${sections.length} section(s)`);
  const raw = await extractPass1(sections, imageBuffer, imageMimeType);

  console.log(`[extractor] Pass 1 results: profile=${!!raw.profile}, tradelines=${raw.tradelines.length}, publicRecords=${raw.publicRecords.length}, inquiries=${raw.inquiries.length}`);

  console.log(`[extractor] Pass 2: Validating + normalizing + deduplicating`);
  const report = validateAndNormalize(raw);

  console.log(`[extractor] Final: ${report.tradelines.length} tradelines, ${report.publicRecords.length} public records, ${report.inquiries.length} inquiries`);

  return report;
}
