import { db } from "./db";
import {
  reports, findings, accounts, scans, negativeAccounts, violations, letters,
  type Report, type InsertReport, type Finding, type InsertFinding,
  type Account, type InsertAccount, type Scan, type InsertScan,
  type NegativeAccount, type InsertNegativeAccount,
  type Violation, type InsertViolation
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
  deleteScan(id: number): Promise<void>;

  createNegativeAccount(account: InsertNegativeAccount): Promise<NegativeAccount>;
  getNegativeAccount(id: number): Promise<NegativeAccount | undefined>;
  getNegativeAccountsByScan(scanId: number): Promise<NegativeAccount[]>;
  updateNegativeAccount(id: number, data: Partial<InsertNegativeAccount>): Promise<NegativeAccount | undefined>;
  updateWorkflowStep(id: number, step: string): Promise<NegativeAccount | undefined>;
  deleteNegativeAccount(id: number): Promise<void>;

  createViolation(violation: InsertViolation): Promise<Violation>;
  getViolationsByAccount(negativeAccountId: number): Promise<Violation[]>;
  getViolationsByScan(scanId: number): Promise<Violation[]>;

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
  async getViolationsByAccount(negativeAccountId: number): Promise<Violation[]> {
    return db.select().from(violations).where(eq(violations.negativeAccountId, negativeAccountId));
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

}

export const storage = new DatabaseStorage();
