/**
 * Section-Based Credit Report Parser
 *
 * Splits raw credit report text into natural chunks:
 *  - Personal Information
 *  - Per-bureau Summaries
 *  - Individual Creditor Blocks (one per account across all bureaus)
 *  - Public Records
 *  - Inquiries
 *
 * This is Step 2 of the pipeline: chunk by "Account Blocks", not by pages.
 */

import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

// ── Section types ──────────────────────────────────────────────────
export type SectionType =
  | "personal_info"
  | "bureau_summary"
  | "tradeline"
  | "public_records"
  | "inquiries"
  | "consumer_statement"
  | "unknown";

export interface ReportSection {
  type: SectionType;
  label: string;          // human-readable label e.g. "MERRICK BK", "Personal Information"
  text: string;           // raw text of this section
  startIndex: number;     // character offset in original text
}

// ── Section header patterns ────────────────────────────────────────
const SECTION_PATTERNS: Array<{ type: SectionType; pattern: RegExp; label?: string }> = [
  // Personal information block
  { type: "personal_info", pattern: /(?:^|\n)\s*(?:PERSONAL\s+INFORMATION|Personal\s+Information|CONSUMER\s+INFORMATION|Consumer\s+Information|IDENTIFICATION|Credit\s+Scores?)/i, label: "Personal Information" },

  // Bureau summary / account summary
  { type: "bureau_summary", pattern: /(?:^|\n)\s*(?:ACCOUNT\s+SUMMARY|Account\s+Summary|CREDIT\s+SUMMARY|Credit\s+Summary|SUMMARY\s+OF\s+ACCOUNTS)/i, label: "Bureau Summary" },

  // Account details section (contains tradelines)
  { type: "tradeline", pattern: /(?:^|\n)\s*(?:ACCOUNT\s+DETAILS?|Account\s+Details?|TRADE\s*LINES?|Trade\s*lines?|ACCOUNTS?\s+INFORMATION|Account\s+History)/i, label: "Account Details" },

  // Public records
  { type: "public_records", pattern: /(?:^|\n)\s*(?:PUBLIC\s+RECORDS?|Public\s+Records?)/i, label: "Public Records" },

  // Inquiries
  { type: "inquiries", pattern: /(?:^|\n)\s*(?:INQUIRIES|Inquiries|HARD\s+INQUIRIES|SOFT\s+INQUIRIES|REGULAR\s+INQUIRIES|PROMOTIONAL\s+INQUIRIES)/i, label: "Inquiries" },

  // Consumer statements
  { type: "consumer_statement", pattern: /(?:^|\n)\s*(?:CONSUMER\s+STATEMENT|Consumer\s+Statement|PERSONAL\s+STATEMENT|Personal\s+Statement|STATEMENT\s+BY\s+CONSUMER|YOUR\s+STATEMENT)/i, label: "Consumer Statement" },
];

// Patterns that typically start an individual account/tradeline block
const ACCOUNT_BLOCK_PATTERNS: RegExp[] = [
  // "CREDITOR NAME" followed by bureau columns or account data
  // SmartCredit format: creditor name as a heading followed by account details
  /(?:^|\n)\s*(?:Account\s+(?:Name|#)|Creditor\s+(?:Name|:))\s*/i,
  // Tri-merge format: creditor name row with bureau columns
  /(?:^|\n)\s*[A-Z][A-Z\s&'.\/\-]{3,40}\s*\|/,
  // Common credit report formats: standalone creditor headers
  /(?:^|\n)\s*(?:ACCOUNT|Account)\s+\d+\s*(?:of|\/)\s*\d+/i,
];

// Common creditor name patterns to detect tradeline blocks
const CREDITOR_INDICATORS = [
  /\b(?:BK|BANK|FINANCIAL|CREDIT|LENDING|MORTGAGE|FUNDING|CAPITAL|SERVICES|COLLECTION|AUTO|LOAN)\b/i,
  /\b(?:DEPT\s+OF\s+ED|STUDENT|NAVIENT|NELNET|FED\s+LOAN)\b/i,
  /\b(?:AMEX|CHASE|DISCOVER|CITI|WELLS\s+FARGO|BOA|SYNCHRONY|BARCLAYS)\b/i,
  /\b(?:PORTFOLIO|MIDLAND|LVNV|CAVALRY|ENCORE|JEFFERSON)\b/i,
];

// ── Text extraction ────────────────────────────────────────────────
export function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const lines: string[] = [];
  const processed = new Set<any>();

  // Walk the DOM in document order so headings stay attached to their tables
  function extractTable(table: any) {
    const rows: string[][] = [];
    $(table).find("tr").each((_j: number, tr: any) => {
      const cells: string[] = [];
      $(tr).find("th, td").each((_k: number, cell: any) => {
        const text = $(cell).text().replace(/\s+/g, " ").trim();
        cells.push(text);
      });
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length > 0) {
      for (const row of rows) {
        lines.push(row.join(" | "));
      }
      lines.push(""); // separator after table
    }
  }

  // Process all top-level elements in document order
  $("body").children().each((_i, el) => {
    if (processed.has(el)) return;
    processed.add(el);

    const tagName = (el as any).tagName?.toLowerCase() || "";

    if (tagName === "table") {
      extractTable(el);
    } else {
      // For non-table elements, extract text content
      // but also check for nested tables within divs/sections
      const nestedTables = $(el).find("table");
      if (nestedTables.length > 0) {
        // Extract heading text before nested tables
        const headingText = $(el).clone().find("table").remove().end()
          .text().replace(/\s+/g, " ").trim();
        if (headingText.length > 2) {
          lines.push(headingText);
        }
        nestedTables.each((_j: number, table: any) => {
          extractTable(table);
        });
      } else {
        // Simple text element (heading, paragraph, etc.)
        const directText = $(el).text().replace(/\s+/g, " ").trim();
        if (directText.length > 2) {
          lines.push(directText);
        }
      }
    }
  });

  // If body had no direct children structure, fall back to walking key elements
  if (lines.length === 0) {
    $("h1, h2, h3, h4, h5, h6, p, li").each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text.length > 2) lines.push(text);
    });
    $("table").each((_i, table) => { extractTable(table); });
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  const text = result.pages.map((p: any) => p.text).join("\n\n--- PAGE BREAK ---\n\n");
  return text.replace(/[ \t]+/g, " ").trim();
}

export function cleanRawText(content: string): string {
  return content
    .replace(/\r\n/g, "\n")         // normalize line endings
    .replace(/[ \t]+/g, " ")        // collapse horizontal whitespace only (preserve newlines)
    .replace(/\n{3,}/g, "\n\n")     // limit consecutive blank lines to one
    .trim();
}

// ── Section splitting ──────────────────────────────────────────────

/**
 * Split extracted text into natural report sections.
 * Returns sections in document order.
 */
export function splitIntoSections(fullText: string): ReportSection[] {
  const sections: ReportSection[] = [];

  // Find all known section headers with their positions
  const headerMatches: Array<{ type: SectionType; label: string; index: number }> = [];

  for (const sp of SECTION_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(sp.pattern.source, sp.pattern.flags + (sp.pattern.flags.includes("g") ? "" : "g"));
    while ((match = regex.exec(fullText)) !== null) {
      headerMatches.push({
        type: sp.type,
        label: sp.label || match[0].trim(),
        index: match.index,
      });
    }
  }

  // Sort by position
  headerMatches.sort((a, b) => a.index - b.index);

  // If no sections detected, try to detect tradeline blocks within the text
  if (headerMatches.length === 0) {
    // Fall back: treat the whole text as one chunk and let the LLM sort it out
    return [{
      type: "unknown",
      label: "Full Report",
      text: fullText,
      startIndex: 0,
    }];
  }

  // Extract text between headers
  for (let i = 0; i < headerMatches.length; i++) {
    const start = headerMatches[i].index;
    const end = i < headerMatches.length - 1 ? headerMatches[i + 1].index : fullText.length;
    const sectionText = fullText.slice(start, end).trim();

    if (headerMatches[i].type === "tradeline" || headerMatches[i].type === "unknown") {
      // For tradeline sections, further split into individual account blocks
      const accountBlocks = splitTradelineSection(sectionText, start);
      sections.push(...accountBlocks);
    } else {
      sections.push({
        type: headerMatches[i].type,
        label: headerMatches[i].label,
        text: sectionText,
        startIndex: start,
      });
    }
  }

  // Handle text before the first recognized section
  if (headerMatches.length > 0 && headerMatches[0].index > 100) {
    const preText = fullText.slice(0, headerMatches[0].index).trim();
    if (preText.length > 50) {
      sections.unshift({
        type: "unknown",
        label: "Report Header",
        text: preText,
        startIndex: 0,
      });
    }
  }

  // If we only found structural sections but no individual tradelines,
  // look for creditor blocks within the "unknown" or large sections
  const hasTradelineSections = sections.some(s => s.type === "tradeline");
  if (!hasTradelineSections) {
    const expandedSections: ReportSection[] = [];
    for (const section of sections) {
      if ((section.type === "unknown" || section.text.length > 2000) &&
        section.type !== "personal_info" &&
        section.type !== "inquiries" &&
        section.type !== "public_records" &&
        section.type !== "bureau_summary") {
        const blocks = splitTradelineSection(section.text, section.startIndex);
        if (blocks.some(b => b.type === "tradeline")) {
          expandedSections.push(...blocks);
        } else {
          expandedSections.push(section);
        }
      } else {
        expandedSections.push(section);
      }
    }
    return expandedSections;
  }

  return sections;
}

/**
 * Split a tradeline section into individual creditor blocks.
 * Each block = one creditor across all bureaus.
 */
function splitTradelineSection(text: string, baseOffset: number): ReportSection[] {
  const blocks: ReportSection[] = [];
  const lines = text.split("\n");

  let currentBlock: string[] = [];
  let currentLabel = "";
  let blockStart = 0;
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isCreditorHeader = isLikelyCreditorName(line, lines[i + 1] || "");

    if (isCreditorHeader && currentBlock.length > 3) {
      // Save the previous block
      blocks.push({
        type: "tradeline",
        label: currentLabel || "Unknown Account",
        text: currentBlock.join("\n").trim(),
        startIndex: baseOffset + blockStart,
      });
      currentBlock = [line];
      currentLabel = extractCreditorName(line);
      blockStart = charOffset;
    } else {
      if (isCreditorHeader && !currentLabel) {
        // First creditor found (or at the start of section)
        currentLabel = extractCreditorName(line);
        if (currentBlock.length === 0) {
          blockStart = charOffset;
        }
      }
      currentBlock.push(line);
    }
    charOffset += line.length + 1;
  }

  // Save the last block
  if (currentBlock.length > 3) {
    const blockText = currentBlock.join("\n").trim();
    if (blockText.length > 50) {
      blocks.push({
        type: currentLabel ? "tradeline" : "unknown",
        label: currentLabel || "Unknown Section",
        text: blockText,
        startIndex: baseOffset + blockStart,
      });
    }
  }

  // If we couldn't split into meaningful blocks, return as single block
  if (blocks.length === 0 && text.length > 50) {
    return [{
      type: "unknown",
      label: "Accounts Section",
      text,
      startIndex: baseOffset,
    }];
  }

  return blocks;
}

/**
 * Heuristic: is this line likely a creditor name header?
 */
function isLikelyCreditorName(line: string, nextLine: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;

  // Skip obvious non-creditor lines
  if (/^\d+$/.test(trimmed)) return false;
  if (/^[-=_|]+$/.test(trimmed)) return false;
  if (/^(page|PAGE)\s+\d/i.test(trimmed)) return false;
  // Skip known section headers
  if (/^(Personal\s+Information|Account\s+Summary|Account\s+Details|Public\s+Records|Inquiries|Credit\s+Report|Credit\s+Scores?|Addresses|Employers|How\s+it\s+works|No\s+public)/i.test(trimmed)) return false;
  // Skip table header rows (Field | TransUnion | Experian | Equifax)
  if (/^(Field|Summary|Bureau|Creditor|Address|Employer)\s*\|/i.test(trimmed)) return false;
  // Skip table data rows that look like field labels with pipe separators
  // e.g. "Credit Limit | $5,000 | $5,000 | --" or "Account Type | Revolving | ..."
  if (trimmed.includes("|") && /^(Account\s+(Number|Type|Rating)|Status|Balance|Credit\s+Limit|High\s+Balance|Monthly\s+Payment|Date\s+|Last\s+|Payment\s+(Status|History)|Creditor\s+Type|Past\s+Due|Terms|Remarks|Original)/i.test(trimmed)) return false;

  // Check for common creditor patterns
  const hasCreditorIndicator = CREDITOR_INDICATORS.some(p => p.test(trimmed));

  // Lines that are mostly uppercase and not too long tend to be creditor headers
  const upperRatio = (trimmed.match(/[A-Z]/g) || []).length / trimmed.length;
  const isUpperCase = upperRatio > 0.6 && trimmed.length > 5 && trimmed.length < 50;

  // Standalone creditor name line (not pipe-separated), followed by pipe-separated table data
  const nextIsPipeLine = /\|/.test(nextLine);
  const nextHasFieldLabel = /^(Field|Account|Status|Balance)\s*\|/i.test(nextLine.trim());

  // Pipe-separated line with a name-like first segment (tri-merge format)
  const pipeSegments = trimmed.split("|").map(s => s.trim());
  const isPipeHeader = pipeSegments.length >= 2 && pipeSegments[0].length > 3 && /[A-Z]/.test(pipeSegments[0]);

  // Next line contains account-type data
  const nextHasAccountData = /(?:account|balance|status|opened|payment|type|bureau|credit|field)/i.test(nextLine);

  // Standalone creditor name before a table
  if (hasCreditorIndicator && !trimmed.includes("|") && (nextIsPipeLine || nextHasFieldLabel)) return true;
  if (hasCreditorIndicator && (isUpperCase || isPipeHeader || nextHasAccountData)) return true;
  if (isUpperCase && nextHasAccountData) return true;
  if (isUpperCase && hasCreditorIndicator && !trimmed.includes("|")) return true;
  if (isPipeHeader && hasCreditorIndicator) return true;

  return false;
}

function extractCreditorName(line: string): string {
  // If pipe-separated, take the first segment
  if (line.includes("|")) {
    return line.split("|")[0].trim();
  }
  // Otherwise clean up and return
  return line.trim().replace(/\s+/g, " ").slice(0, 60);
}

// ── Full extraction pipeline entry point ───────────────────────────

export interface ExtractedReport {
  fullText: string;
  sections: ReportSection[];
}

export async function parseReportFile(
  content: string,
  fileType: string,
  pdfBuffer?: Buffer,
  imageBuffer?: Buffer,
): Promise<ExtractedReport> {
  let extractedText: string;

  if (fileType.startsWith("image/") && imageBuffer) {
    // Images can't be text-parsed; return a marker so the pipeline uses vision
    return {
      fullText: "",
      sections: [{
        type: "unknown",
        label: "Image Report",
        text: "__IMAGE_INPUT__",
        startIndex: 0,
      }],
    };
  }

  if (fileType === "application/pdf" && pdfBuffer) {
    extractedText = await extractTextFromPdf(pdfBuffer);
  } else if (fileType === "text/html" || fileType === "html") {
    extractedText = extractTextFromHtml(content);
  } else {
    extractedText = cleanRawText(content);
  }

  if (extractedText.length < 50) {
    throw new Error("Could not extract sufficient text from the uploaded file.");
  }

  const sections = splitIntoSections(extractedText);

  return {
    fullText: extractedText,
    sections,
  };
}

/**
 * Group sections into batches for LLM extraction.
 * IMPORTANT: Only batch sections of the SAME type together.
 * Mixing types causes data loss because only the first section's type
 * determines which extraction prompt is used.
 */
export function batchSections(
  sections: ReportSection[],
  maxCharsPerBatch: number = 30_000,
): ReportSection[][] {
  const batches: ReportSection[][] = [];
  let currentBatch: ReportSection[] = [];
  let currentSize = 0;
  let currentType: SectionType | null = null;

  for (const section of sections) {
    // Start a new batch when type changes OR size limit exceeded
    const typeChanged = currentType !== null && section.type !== currentType;
    const sizeExceeded = currentSize + section.text.length > maxCharsPerBatch && currentBatch.length > 0;

    if (typeChanged || sizeExceeded) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(section);
    currentSize += section.text.length;
    currentType = section.type;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
