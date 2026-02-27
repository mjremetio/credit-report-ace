import { db } from "./db";
import { reports, findings, accounts, type Report, type InsertReport, type Finding, type InsertFinding, type Account, type InsertAccount } from "@shared/schema";
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
}

export const storage = new DatabaseStorage();
