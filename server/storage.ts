import { db } from "./db";
import {
  reports, findings, accounts, scans, negativeAccounts, violations, letters,
  parsedReports, tradelineEvidence, violationPatterns,
  type Report, type InsertReport, type Finding, type InsertFinding,
  type Account, type InsertAccount, type Scan, type InsertScan,
  type NegativeAccount, type InsertNegativeAccount,
  type Violation, type InsertViolation,
  type ParsedReport, type InsertParsedReport,
  type TradelineEvidence, type InsertTradelineEvidence,
  type ViolationPattern, type InsertViolationPattern,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  createReport(report: InsertReport): Promise<Report>;
  getReport(id: number): Promise<Report | undefined>;
  getAllReports(): Promise<Report[]>;
  updateReportStatus(id: number, status: string, consumerName?: string): Promise<Report | undefined>;
  deleteReport(id: number): Promise<void>;
  createFinding(finding: InsertFinding): Promise<Finding>;
  getFindingsByReport(reportId: number): Promise<Finding[]>;
  createAccount(account: InsertAccount): Promise<Account>;
  getAccountsByReport(reportId: number): Promise<Account[]>;

  createScan(scan: InsertScan): Promise<Scan>;
  getScan(id: number): Promise<Scan | undefined>;
  getAllScans(): Promise<Scan[]>;
  updateScanStep(id: number, step: number): Promise<Scan | undefined>;
  updateScanStatus(id: number, status: string): Promise<Scan | undefined>;
  updateScan(id: number, data: Partial<Scan>): Promise<Scan | undefined>;
  deleteScan(id: number): Promise<void>;

  createNegativeAccount(account: InsertNegativeAccount): Promise<NegativeAccount>;
  getNegativeAccount(id: number): Promise<NegativeAccount | undefined>;
  getNegativeAccountsByScan(scanId: number): Promise<NegativeAccount[]>;
  updateNegativeAccount(id: number, data: Partial<InsertNegativeAccount>): Promise<NegativeAccount | undefined>;
  updateWorkflowStep(id: number, step: string): Promise<NegativeAccount | undefined>;
  deleteNegativeAccount(id: number): Promise<void>;

  createViolation(violation: InsertViolation): Promise<Violation>;
  createViolationsBatch(violationList: InsertViolation[]): Promise<Violation[]>;
  getViolation(id: number): Promise<Violation | undefined>;
  getViolationsByAccount(negativeAccountId: number): Promise<Violation[]>;
  getViolationsByScan(scanId: number): Promise<Violation[]>;
  clearViolationsByAccount(negativeAccountId: number): Promise<void>;
  updateViolation(id: number, data: Partial<Violation>): Promise<Violation | undefined>;

  // Parsed report storage
  createParsedReport(report: InsertParsedReport): Promise<ParsedReport>;
  getParsedReport(id: number): Promise<ParsedReport | undefined>;
  getParsedReportByScan(scanId: number): Promise<ParsedReport | undefined>;
  updateParsedReportFlags(id: number, flags: any[]): Promise<ParsedReport | undefined>;
  updateParsedReportSummary(id: number, summary: any): Promise<ParsedReport | undefined>;
  createTradelineEvidence(evidence: InsertTradelineEvidence): Promise<TradelineEvidence>;
  createTradelineEvidenceBatch(evidenceList: InsertTradelineEvidence[]): Promise<TradelineEvidence[]>;
  getTradelineEvidenceByScan(parsedReportId: number): Promise<TradelineEvidence[]>;

  // Violation pattern memory
  createOrUpdateViolationPattern(pattern: InsertViolationPattern): Promise<ViolationPattern>;
  getViolationPatternsByAccountType(accountType: string): Promise<ViolationPattern[]>;
  getAllViolationPatterns(): Promise<ViolationPattern[]>;
  incrementPatternConfirmed(id: number): Promise<ViolationPattern | undefined>;
  incrementPatternRejected(id: number): Promise<ViolationPattern | undefined>;
}

class DatabaseStorage implements IStorage {
  async createReport(report: InsertReport): Promise<Report> {
    const [created] = await db.insert(reports).values(report).returning();
    return created;
  }
  async getReport(id: number): Promise<Report | undefined> {
    const [report] = await db.select().from(reports).where(eq(reports.id, id));
    return report;
  }
  async getAllReports(): Promise<Report[]> {
    return db.select().from(reports).orderBy(desc(reports.createdAt));
  }
  async updateReportStatus(id: number, status: string, consumerName?: string): Promise<Report | undefined> {
    const values: any = { status };
    if (consumerName) values.consumerName = consumerName;
    const [updated] = await db.update(reports).set(values).where(eq(reports.id, id)).returning();
    return updated;
  }
  async deleteReport(id: number): Promise<void> {
    await db.delete(findings).where(eq(findings.reportId, id));
    await db.delete(accounts).where(eq(accounts.reportId, id));
    await db.delete(reports).where(eq(reports.id, id));
  }
  async createFinding(finding: InsertFinding): Promise<Finding> {
    const [created] = await db.insert(findings).values(finding).returning();
    return created;
  }
  async getFindingsByReport(reportId: number): Promise<Finding[]> {
    return db.select().from(findings).where(eq(findings.reportId, reportId));
  }
  async createAccount(account: InsertAccount): Promise<Account> {
    const [created] = await db.insert(accounts).values(account).returning();
    return created;
  }
  async getAccountsByReport(reportId: number): Promise<Account[]> {
    return db.select().from(accounts).where(eq(accounts.reportId, reportId));
  }

  async createScan(scan: InsertScan): Promise<Scan> {
    const [created] = await db.insert(scans).values(scan).returning();
    return created;
  }
  async getScan(id: number): Promise<Scan | undefined> {
    const [scan] = await db.select().from(scans).where(eq(scans.id, id));
    return scan;
  }
  async getAllScans(): Promise<Scan[]> {
    return db.select().from(scans).orderBy(desc(scans.createdAt));
  }
  async updateScanStep(id: number, step: number): Promise<Scan | undefined> {
    const [updated] = await db.update(scans).set({ currentStep: step }).where(eq(scans.id, id)).returning();
    return updated;
  }
  async updateScanStatus(id: number, status: string): Promise<Scan | undefined> {
    const [updated] = await db.update(scans).set({ status }).where(eq(scans.id, id)).returning();
    return updated;
  }
  async updateScan(id: number, data: Partial<Scan>): Promise<Scan | undefined> {
    const [updated] = await db.update(scans).set(data).where(eq(scans.id, id)).returning();
    return updated;
  }
  async deleteScan(id: number): Promise<void> {
    const accts = await this.getNegativeAccountsByScan(id);
    for (const a of accts) {
      await db.delete(violations).where(eq(violations.negativeAccountId, a.id));
      await db.delete(letters).where(eq(letters.negativeAccountId, a.id));
    }
    await db.delete(negativeAccounts).where(eq(negativeAccounts.scanId, id));
    await db.delete(scans).where(eq(scans.id, id));
  }

  async createNegativeAccount(account: InsertNegativeAccount): Promise<NegativeAccount> {
    const [created] = await db.insert(negativeAccounts).values(account).returning();
    return created;
  }
  async getNegativeAccount(id: number): Promise<NegativeAccount | undefined> {
    const [account] = await db.select().from(negativeAccounts).where(eq(negativeAccounts.id, id));
    return account;
  }
  async getNegativeAccountsByScan(scanId: number): Promise<NegativeAccount[]> {
    return db.select().from(negativeAccounts).where(eq(negativeAccounts.scanId, scanId)).orderBy(negativeAccounts.createdAt);
  }
  async updateNegativeAccount(id: number, data: Partial<InsertNegativeAccount>): Promise<NegativeAccount | undefined> {
    const [updated] = await db.update(negativeAccounts).set(data).where(eq(negativeAccounts.id, id)).returning();
    return updated;
  }
  async updateWorkflowStep(id: number, step: string): Promise<NegativeAccount | undefined> {
    const [updated] = await db.update(negativeAccounts).set({ workflowStep: step }).where(eq(negativeAccounts.id, id)).returning();
    return updated;
  }
  async deleteNegativeAccount(id: number): Promise<void> {
    await db.delete(violations).where(eq(violations.negativeAccountId, id));
    await db.delete(letters).where(eq(letters.negativeAccountId, id));
    await db.delete(negativeAccounts).where(eq(negativeAccounts.id, id));
  }

  async createViolation(violation: InsertViolation): Promise<Violation> {
    const [created] = await db.insert(violations).values(violation).returning();
    return created;
  }
  async createViolationsBatch(violationList: InsertViolation[]): Promise<Violation[]> {
    if (violationList.length === 0) return [];
    return db.insert(violations).values(violationList).returning();
  }
  async getViolation(id: number): Promise<Violation | undefined> {
    const [violation] = await db.select().from(violations).where(eq(violations.id, id));
    return violation;
  }
  async getViolationsByAccount(negativeAccountId: number): Promise<Violation[]> {
    return db.select().from(violations).where(eq(violations.negativeAccountId, negativeAccountId));
  }
  async clearViolationsByAccount(negativeAccountId: number): Promise<void> {
    await db.delete(violations).where(eq(violations.negativeAccountId, negativeAccountId));
  }
  async updateViolation(id: number, data: Partial<Violation>): Promise<Violation | undefined> {
    const [updated] = await db.update(violations).set(data).where(eq(violations.id, id)).returning();
    return updated;
  }

  async getViolationsByScan(scanId: number): Promise<Violation[]> {
    const accts = await this.getNegativeAccountsByScan(scanId);
    const allViolations: Violation[] = [];
    for (const a of accts) {
      const v = await this.getViolationsByAccount(a.id);
      allViolations.push(...v);
    }
    return allViolations;
  }

  // ── Parsed Report Storage ──────────────────────────────────────────

  async createParsedReport(report: InsertParsedReport): Promise<ParsedReport> {
    const [created] = await db.insert(parsedReports).values(report).returning();
    return created;
  }

  async getParsedReport(id: number): Promise<ParsedReport | undefined> {
    const [report] = await db.select().from(parsedReports).where(eq(parsedReports.id, id));
    return report;
  }

  async getParsedReportByScan(scanId: number): Promise<ParsedReport | undefined> {
    const [report] = await db.select().from(parsedReports).where(eq(parsedReports.scanId, scanId)).orderBy(desc(parsedReports.createdAt));
    return report;
  }

  async updateParsedReportFlags(id: number, flags: any[]): Promise<ParsedReport | undefined> {
    const [updated] = await db.update(parsedReports)
      .set({ issueFlagsJson: flags, issueFlagCount: flags.length })
      .where(eq(parsedReports.id, id))
      .returning();
    return updated;
  }

  async updateParsedReportSummary(id: number, summary: any): Promise<ParsedReport | undefined> {
    const [updated] = await db.update(parsedReports)
      .set({ summaryJson: summary })
      .where(eq(parsedReports.id, id))
      .returning();
    return updated;
  }

  async createTradelineEvidence(evidence: InsertTradelineEvidence): Promise<TradelineEvidence> {
    const [created] = await db.insert(tradelineEvidence).values(evidence).returning();
    return created;
  }
  async createTradelineEvidenceBatch(evidenceList: InsertTradelineEvidence[]): Promise<TradelineEvidence[]> {
    if (evidenceList.length === 0) return [];
    return db.insert(tradelineEvidence).values(evidenceList).returning();
  }

  async getTradelineEvidenceByScan(parsedReportId: number): Promise<TradelineEvidence[]> {
    return db.select().from(tradelineEvidence).where(eq(tradelineEvidence.parsedReportId, parsedReportId)).orderBy(tradelineEvidence.createdAt);
  }

  // ── Violation Pattern Memory ───────────────────────────────────────
  async createOrUpdateViolationPattern(pattern: InsertViolationPattern): Promise<ViolationPattern> {
    // Check if a similar pattern already exists
    const existing = await db.select().from(violationPatterns)
      .where(eq(violationPatterns.violationType, pattern.violationType))
      .then(rows => rows.find(r =>
        r.accountType === pattern.accountType &&
        r.matchedRule === (pattern.matchedRule || null)
      ));

    if (existing) {
      const [updated] = await db.update(violationPatterns)
        .set({
          timesConfirmed: existing.timesConfirmed + 1,
          lastConfirmedAt: new Date(),
          severity: pattern.severity || existing.severity,
          evidencePattern: pattern.evidencePattern || existing.evidencePattern,
        })
        .where(eq(violationPatterns.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(violationPatterns).values(pattern).returning();
    return created;
  }

  async getViolationPatternsByAccountType(accountType: string): Promise<ViolationPattern[]> {
    return db.select().from(violationPatterns)
      .where(eq(violationPatterns.accountType, accountType))
      .orderBy(desc(violationPatterns.timesConfirmed));
  }

  async getAllViolationPatterns(): Promise<ViolationPattern[]> {
    return db.select().from(violationPatterns)
      .orderBy(desc(violationPatterns.timesConfirmed));
  }

  async incrementPatternConfirmed(id: number): Promise<ViolationPattern | undefined> {
    const existing = await db.select().from(violationPatterns).where(eq(violationPatterns.id, id));
    if (!existing[0]) return undefined;
    const [updated] = await db.update(violationPatterns)
      .set({
        timesConfirmed: existing[0].timesConfirmed + 1,
        lastConfirmedAt: new Date(),
      })
      .where(eq(violationPatterns.id, id))
      .returning();
    return updated;
  }

  async incrementPatternRejected(id: number): Promise<ViolationPattern | undefined> {
    const existing = await db.select().from(violationPatterns).where(eq(violationPatterns.id, id));
    if (!existing[0]) return undefined;
    const [updated] = await db.update(violationPatterns)
      .set({ timesRejected: existing[0].timesRejected + 1 })
      .where(eq(violationPatterns.id, id))
      .returning();
    return updated;
  }

}

export const storage = new DatabaseStorage();
