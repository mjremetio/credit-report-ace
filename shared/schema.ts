import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
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

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
  createdAt: true,
});

export const insertFindingSchema = createInsertSchema(findings).omit({
  id: true,
  createdAt: true,
});

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
});

export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Finding = typeof findings.$inferSelect;
export type InsertFinding = z.infer<typeof insertFindingSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
