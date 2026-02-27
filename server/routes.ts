import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { z } from "zod";
import { storage } from "./storage";
import { analyzeReport } from "./analyzer";
import { detectViolations } from "./ai-services";

const createScanSchema = z.object({
  consumerName: z.string().min(1, "consumerName is required"),
});

const updateScanSchema = z.object({
  currentStep: z.number().int().min(1).max(4).optional(),
  status: z.enum(["in_progress", "completed"]).optional(),
});

const createNegativeAccountSchema = z.object({
  creditor: z.string().min(1, "creditor is required"),
  accountNumber: z.string().optional().nullable(),
  accountType: z.enum(["debt_collection", "charge_off", "repossession"]),
  originalCreditor: z.string().optional().nullable(),
  balance: z.union([z.number(), z.string().transform(Number)]).optional().nullable(),
  dateOpened: z.string().optional().nullable(),
  dateOfDelinquency: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  bureaus: z.string().optional().nullable(),
  rawDetails: z.string().optional().nullable(),
});

const updateNegativeAccountSchema = z.object({
  creditor: z.string().min(1).optional(),
  accountNumber: z.string().optional().nullable(),
  accountType: z.enum(["debt_collection", "charge_off", "repossession"]).optional(),
  originalCreditor: z.string().optional().nullable(),
  balance: z.union([z.number(), z.string().transform(Number)]).optional().nullable(),
  dateOpened: z.string().optional().nullable(),
  dateOfDelinquency: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  bureaus: z.string().optional().nullable(),
  rawDetails: z.string().optional().nullable(),
  workflowStep: z.string().optional(),
});


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["text/html", "application/pdf", "text/plain", "text/csv"];
    const allowedExtensions = [".html", ".htm", ".pdf", ".txt", ".csv"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    if (allowed.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only HTML, PDF, and text files are supported"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/scans", async (req, res) => {
    try {
      const parsed = createScanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      const scan = await storage.createScan({ consumerName: parsed.data.consumerName, status: "in_progress", currentStep: 1 });
      res.json(scan);
    } catch (error) {
      console.error("Error creating scan:", error);
      res.status(500).json({ error: "Failed to create scan" });
    }
  });

  app.get("/api/scans", async (_req, res) => {
    try {
      const allScans = await storage.getAllScans();
      res.json(allScans);
    } catch (error) {
      console.error("Error fetching scans:", error);
      res.status(500).json({ error: "Failed to fetch scans" });
    }
  });

  app.get("/api/scans/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });
      const negAccounts = await storage.getNegativeAccountsByScan(id);
      const accountsWithDetails = await Promise.all(
        negAccounts.map(async (acct) => {
          const acctViolations = await storage.getViolationsByAccount(acct.id);
          return { ...acct, violations: acctViolations };
        })
      );
      res.json({ ...scan, negativeAccounts: accountsWithDetails });
    } catch (error) {
      console.error("Error fetching scan:", error);
      res.status(500).json({ error: "Failed to fetch scan" });
    }
  });

  app.patch("/api/scans/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateScanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      let scan;
      if (parsed.data.currentStep !== undefined) {
        scan = await storage.updateScanStep(id, parsed.data.currentStep);
      }
      if (parsed.data.status !== undefined) {
        scan = await storage.updateScanStatus(id, parsed.data.status);
      }
      if (!scan) return res.status(404).json({ error: "Scan not found" });
      res.json(scan);
    } catch (error) {
      console.error("Error updating scan:", error);
      res.status(500).json({ error: "Failed to update scan" });
    }
  });

  app.delete("/api/scans/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteScan(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scan:", error);
      res.status(500).json({ error: "Failed to delete scan" });
    }
  });

  app.post("/api/scans/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.toLowerCase();
      const isPdf = ext.endsWith(".pdf") || req.file.mimetype === "application/pdf";
      const isHtml = ext.endsWith(".html") || ext.endsWith(".htm");
      const fileType = isPdf ? "application/pdf" : isHtml ? "text/html" : "text/plain";
      const fileContent = isPdf ? "" : req.file.buffer.toString("utf-8");
      const pdfBuffer = isPdf ? req.file.buffer : undefined;

      const result = await analyzeReport(fileContent, fileType, pdfBuffer);

      const scan = await storage.createScan({
        consumerName: result.consumerName || "Unknown Consumer",
        status: "in_progress",
        currentStep: 3,
      });

      let totalViolations = 0;

      for (const acct of result.accounts) {
        const accountType = mapAccountType(acct.type, acct.status);
        const negAccount = await storage.createNegativeAccount({
          scanId: scan.id,
          creditor: acct.creditor,
          accountNumber: acct.accountNumberMasked || null,
          accountType,
          originalCreditor: null,
          balance: acct.balance || null,
          dateOpened: acct.dates?.last_payment || null,
          dateOfDelinquency: acct.dates?.dofd || null,
          status: acct.status || null,
          bureaus: null,
          rawDetails: null,
          workflowStep: "classified",
        });

        try {
          const detected = await detectViolations(negAccount);
          for (const v of detected) {
            await storage.createViolation({
              negativeAccountId: negAccount.id,
              violationType: v.violationType,
              severity: v.severity,
              explanation: v.explanation,
              fcraStatute: v.fcraStatute,
              evidence: v.evidence || null,
              matchedRule: v.matchedRule || null,
            });
            totalViolations++;
          }
          if (detected.length > 0) {
            await storage.updateWorkflowStep(negAccount.id, "scanned");
          }
        } catch (violationErr) {
          console.error(`Violation scan failed for account ${negAccount.id}:`, violationErr);
        }
      }

      res.json({
        scanId: scan.id,
        consumerName: result.consumerName,
        accountsCreated: result.accounts.length,
        violationsFound: totalViolations,
      });
    } catch (error: any) {
      console.error("Upload scan error:", error);
      res.status(500).json({ error: error.message || "Upload and analysis failed" });
    }
  });

  app.post("/api/scans/:scanId/accounts", async (req, res) => {
    try {
      const scanId = parseInt(req.params.scanId);
      const scan = await storage.getScan(scanId);
      if (!scan) return res.status(404).json({ error: "Scan not found" });
      const parsed = createNegativeAccountSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      const d = parsed.data;
      const account = await storage.createNegativeAccount({
        scanId,
        creditor: d.creditor,
        accountNumber: d.accountNumber || null,
        accountType: d.accountType,
        originalCreditor: d.originalCreditor || null,
        balance: d.balance ? Number(d.balance) : null,
        dateOpened: d.dateOpened || null,
        dateOfDelinquency: d.dateOfDelinquency || null,
        status: d.status || null,
        bureaus: d.bureaus || null,
        rawDetails: d.rawDetails || null,
        workflowStep: "pending",
      });
      res.json(account);
    } catch (error) {
      console.error("Error creating account:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.patch("/api/scans/:scanId/accounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateNegativeAccountSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      const updates: any = {};
      const d = parsed.data;
      if (d.creditor !== undefined) updates.creditor = d.creditor;
      if (d.accountNumber !== undefined) updates.accountNumber = d.accountNumber;
      if (d.accountType !== undefined) updates.accountType = d.accountType;
      if (d.originalCreditor !== undefined) updates.originalCreditor = d.originalCreditor;
      if (d.balance !== undefined) updates.balance = d.balance ? Number(d.balance) : null;
      if (d.dateOpened !== undefined) updates.dateOpened = d.dateOpened;
      if (d.dateOfDelinquency !== undefined) updates.dateOfDelinquency = d.dateOfDelinquency;
      if (d.status !== undefined) updates.status = d.status;
      if (d.bureaus !== undefined) updates.bureaus = d.bureaus;
      if (d.rawDetails !== undefined) updates.rawDetails = d.rawDetails;
      if (d.workflowStep !== undefined) updates.workflowStep = d.workflowStep;
      const account = await storage.updateNegativeAccount(id, updates);
      if (!account) return res.status(404).json({ error: "Account not found" });
      res.json(account);
    } catch (error) {
      console.error("Error updating account:", error);
      res.status(500).json({ error: "Failed to update account" });
    }
  });

  app.delete("/api/scans/:scanId/accounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteNegativeAccount(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  app.post("/api/accounts/:id/scan", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const account = await storage.getNegativeAccount(id);
      if (!account) return res.status(404).json({ error: "Account not found" });
      const detectedViolations = await detectViolations(account);
      const savedViolations = [];
      for (const v of detectedViolations) {
        const saved = await storage.createViolation({
          negativeAccountId: id,
          violationType: v.violationType,
          severity: v.severity,
          explanation: v.explanation,
          fcraStatute: v.fcraStatute,
          evidence: v.evidence || null,
          matchedRule: v.matchedRule || null,
        });
        savedViolations.push(saved);
      }
      await storage.updateWorkflowStep(id, "scanned");
      res.json({ violations: savedViolations });
    } catch (error) {
      console.error("Error scanning account:", error);
      res.status(500).json({ error: "Failed to scan account" });
    }
  });

  return httpServer;
}

function mapAccountType(type: string | undefined, status: string | undefined): string {
  const t = (type || "").toLowerCase();
  const s = (status || "").toLowerCase();
  if (t.includes("collection") || s.includes("collection")) return "debt_collection";
  if (t.includes("chargeoff") || t.includes("charge-off") || s.includes("chargeoff") || s.includes("charge-off") || s.includes("charged off")) return "charge_off";
  if (t.includes("repossess") || s.includes("repossess")) return "repossession";
  if (s.includes("derogatory") || s.includes("past due") || s.includes("late")) return "charge_off";
  return "debt_collection";
}
