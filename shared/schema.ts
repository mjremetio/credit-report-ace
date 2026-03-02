import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/chat";

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  consumerName: text("consumer_name"),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  status: text("status").notNull().default("pending"),
  rawContent: text("raw_content"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const findings = pgTable("findings", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  findingType: text("finding_type").notNull(),
  severity: text("severity").notNull(),
  creditor: text("creditor"),
  explanation: text("explanation").notNull(),
  fcraTheories: text("fcra_theories").array().notNull(),
  evidence: jsonb("evidence").notNull(),
  matchedRule: text("matched_rule"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  creditor: text("creditor").notNull(),
  accountNumberMasked: text("account_number_masked"),
  type: text("type"),
  status: text("status"),
  balance: integer("balance"),
  datesJson: jsonb("dates_json"),
  sourcePages: integer("source_pages").array(),
});

export const scans = pgTable("scans", {
  id: serial("id").primaryKey(),
  consumerName: text("consumer_name").notNull(),
  status: text("status").notNull().default("in_progress"),
  currentStep: integer("current_step").notNull().default(1),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // Review gate fields
  clientName: text("client_name"),
  clientState: text("client_state"),
  reportGeneratedAt: timestamp("report_generated_at"),
  reportTitle: text("report_title"),
  scanNotes: text("scan_notes"),
  reviewStatus: text("review_status").default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  approvedViolationCount: integer("approved_violation_count"),
  rejectedViolationCount: integer("rejected_violation_count"),
});

export const negativeAccounts = pgTable("negative_accounts", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
  creditor: text("creditor").notNull(),
  accountNumber: text("account_number"),
  accountType: text("account_type").notNull(),
  originalCreditor: text("original_creditor"),
  balance: integer("balance"),
  dateOpened: text("date_opened"),
  dateOfDelinquency: text("date_of_delinquency"),
  status: text("status"),
  bureaus: text("bureaus"),
  rawDetails: text("raw_details"),
  workflowStep: text("workflow_step").notNull().default("pending"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const violations = pgTable("violations", {
  id: serial("id").primaryKey(),
  negativeAccountId: integer("negative_account_id").notNull().references(() => negativeAccounts.id, { onDelete: "cascade" }),
  violationType: text("violation_type").notNull(),
  severity: text("severity").notNull(),
  explanation: text("explanation").notNull(),
  fcraStatute: text("fcra_statute").notNull(),
  evidence: text("evidence"),
  matchedRule: text("matched_rule"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // FDCPA / Debt collector fields
  category: text("category"),
  evidenceRequired: text("evidence_required"),
  evidenceProvided: boolean("evidence_provided").default(false),
  evidenceNotes: text("evidence_notes"),
  confidence: text("confidence"),
  croReminder: text("cro_reminder"),
  // Human review fields
  reviewStatus: text("review_status").default("pending"),
  reviewerNotes: text("reviewer_notes"),
  severityOverride: text("severity_override"),
  descriptionOverride: text("description_override"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
});

// ── Parsed Credit Report (system of record JSON) ──────────────────
export const parsedReports = pgTable("parsed_reports", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
  reportJson: jsonb("report_json").notNull(),         // Full ParsedCreditReport JSON
  profileJson: jsonb("profile_json"),                  // CreditReportProfile subset
  issueFlagsJson: jsonb("issue_flags_json"),            // IssueFlag[] from rule engine
  summaryJson: jsonb("summary_json"),                  // ReportSummary
  sourceFileName: text("source_file_name"),
  sourceFileType: text("source_file_type"),
  parserVersion: text("parser_version").default("2.0.0"),
  tradelineCount: integer("tradeline_count").default(0),
  issueFlagCount: integer("issue_flag_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── Per-tradeline evidence store (structured JSON + raw text) ──────
export const tradelineEvidence = pgTable("tradeline_evidence", {
  id: serial("id").primaryKey(),
  parsedReportId: integer("parsed_report_id").notNull().references(() => parsedReports.id, { onDelete: "cascade" }),
  creditorName: text("creditor_name").notNull(),
  accountNumberMasked: text("account_number_masked"),
  tradelineJson: jsonb("tradeline_json").notNull(),    // Tradeline structured JSON
  evidenceText: text("evidence_text").notNull(),        // Raw text that was extracted
  bureaus: text("bureaus"),                              // Comma-separated bureau names
  issueFlagsJson: jsonb("issue_flags_json"),             // IssueFlag[] for this tradeline only
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const letters = pgTable("letters", {
  id: serial("id").primaryKey(),
  negativeAccountId: integer("negative_account_id").notNull().references(() => negativeAccounts.id, { onDelete: "cascade" }),
  letterType: text("letter_type").notNull(),
  recipient: text("recipient"),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertReportSchema = createInsertSchema(reports).omit({ id: true, createdAt: true });
export const insertFindingSchema = createInsertSchema(findings).omit({ id: true, createdAt: true });
export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true });
export const insertScanSchema = createInsertSchema(scans).omit({ id: true, createdAt: true });
export const insertNegativeAccountSchema = createInsertSchema(negativeAccounts).omit({ id: true, createdAt: true });
export const insertViolationSchema = createInsertSchema(violations).omit({ id: true, createdAt: true });
export const insertParsedReportSchema = createInsertSchema(parsedReports).omit({ id: true, createdAt: true });
export const insertTradelineEvidenceSchema = createInsertSchema(tradelineEvidence).omit({ id: true, createdAt: true });
export const insertLetterSchema = createInsertSchema(letters).omit({ id: true, createdAt: true });

export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Finding = typeof findings.$inferSelect;
export type InsertFinding = z.infer<typeof insertFindingSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Scan = typeof scans.$inferSelect;
export type InsertScan = z.infer<typeof insertScanSchema>;
export type NegativeAccount = typeof negativeAccounts.$inferSelect;
export type InsertNegativeAccount = z.infer<typeof insertNegativeAccountSchema>;
export type Violation = typeof violations.$inferSelect;
export type InsertViolation = z.infer<typeof insertViolationSchema>;
export type ParsedReport = typeof parsedReports.$inferSelect;
export type InsertParsedReport = z.infer<typeof insertParsedReportSchema>;
export type TradelineEvidence = typeof tradelineEvidence.$inferSelect;
export type InsertTradelineEvidence = z.infer<typeof insertTradelineEvidenceSchema>;
export type Letter = typeof letters.$inferSelect;
export type InsertLetter = z.infer<typeof insertLetterSchema>;
