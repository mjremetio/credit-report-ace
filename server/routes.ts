import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { z } from "zod";
import { storage } from "./storage";
import { analyzeReport } from "./analyzer";
import { detectViolations, generateLetter } from "./ai-services";

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

const generateLetterSchema = z.object({
  letterType: z.enum(["initial_dispute", "validation_request", "follow_up", "intent_to_sue"]),
});

const updateLetterSchema = z.object({
  content: z.string().optional(),
  status: z.enum(["draft", "ready", "sent"]).optional(),
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

  app.get("/api/reports", async (_req, res) => {
    try {
      const reports = await storage.getAllReports();
      res.json(reports);
    } catch (error) {
      console.error("Error fetching reports:", error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.get("/api/reports/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const report = await storage.getReport(id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      const reportFindings = await storage.getFindingsByReport(id);
      const reportAccounts = await storage.getAccountsByReport(id);
      res.json({ ...report, findings: reportFindings, accounts: reportAccounts });
    } catch (error) {
      console.error("Error fetching report:", error);
      res.status(500).json({ error: "Failed to fetch report" });
    }
  });

  app.post("/api/reports/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.toLowerCase();
      const isPdf = ext.endsWith(".pdf") || req.file.mimetype === "application/pdf";
      const isHtml = ext.endsWith(".html") || ext.endsWith(".htm");
      const fileType = isPdf ? "application/pdf" : isHtml ? "text/html" : "text/plain";
      const fileContent = isPdf ? "[PDF Binary - see parsed output]" : req.file.buffer.toString("utf-8");
      const pdfBuffer = isPdf ? req.file.buffer : undefined;
      const report = await storage.createReport({
        fileName: req.file.originalname,
        fileType,
        status: "processing",
        rawContent: isPdf ? null : fileContent,
      });
      res.json({ id: report.id, status: "processing", message: "Report uploaded. Analysis starting." });
      (async () => {
        try {
          const textContent = isPdf ? "" : fileContent;
          const result = await analyzeReport(textContent, fileType, pdfBuffer);
          for (const acct of result.accounts) {
            await storage.createAccount({
              reportId: report.id,
              creditor: acct.creditor,
              accountNumberMasked: acct.accountNumberMasked || null,
              type: acct.type || null,
              status: acct.status || null,
              balance: acct.balance || 0,
              datesJson: acct.dates || null,
              sourcePages: null,
            });
          }
          for (const finding of result.findings) {
            await storage.createFinding({
              reportId: report.id,
              findingType: finding.findingType,
              severity: finding.severity,
              creditor: finding.creditor || null,
              explanation: finding.explanation,
              fcraTheories: finding.fcraTheories,
              evidence: finding.evidence,
              matchedRule: finding.matchedRule || null,
            });
          }
          await storage.updateReportStatus(report.id, "completed", result.consumerName);
        } catch (err) {
          console.error("Analysis failed:", err);
          await storage.updateReportStatus(report.id, "failed");
        }
      })();
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: error.message || "Upload failed" });
    }
  });

  app.delete("/api/reports/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteReport(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting report:", error);
      res.status(500).json({ error: "Failed to delete report" });
    }
  });

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
          const acctLetters = await storage.getLettersByAccount(acct.id);
          return { ...acct, violations: acctViolations, letters: acctLetters };
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

  app.post("/api/accounts/:id/generate-letter", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = generateLetterSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid letterType" });
      const { letterType } = parsed.data;
      const account = await storage.getNegativeAccount(id);
      if (!account) return res.status(404).json({ error: "Account not found" });
      const accountViolations = await storage.getViolationsByAccount(id);
      const content = await generateLetter(account, accountViolations, letterType);
      const recipientMap: Record<string, string> = {
        initial_dispute: "Credit Reporting Agency",
        validation_request: account.creditor,
        follow_up: "Credit Reporting Agency / Furnisher",
        intent_to_sue: account.creditor,
      };
      const letter = await storage.createLetter({
        negativeAccountId: id,
        letterType,
        recipient: recipientMap[letterType] || "Credit Reporting Agency",
        content,
        status: "draft",
      });
      await storage.updateWorkflowStep(id, "letter_generated");
      res.json(letter);
    } catch (error) {
      console.error("Error generating letter:", error);
      res.status(500).json({ error: "Failed to generate letter" });
    }
  });

  app.patch("/api/letters/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateLetterSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      const updates: any = {};
      if (parsed.data.content !== undefined) updates.content = parsed.data.content;
      if (parsed.data.status !== undefined) updates.status = parsed.data.status;
      const letter = await storage.updateLetter(id, updates);
      if (!letter) return res.status(404).json({ error: "Letter not found" });
      if (parsed.data.status === "sent") {
        const existing = await storage.getLetter(id);
        if (existing) {
          await storage.updateWorkflowStep(existing.negativeAccountId, "letter_sent");
        }
      }
      res.json(letter);
    } catch (error) {
      console.error("Error updating letter:", error);
      res.status(500).json({ error: "Failed to update letter" });
    }
  });

  return httpServer;
}
