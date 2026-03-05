import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { storage } from "./storage";
import { detectViolations } from "./ai-services";
import { runReportPipeline, organizeReport, runManualEntryPipeline, runStructurePipeline, runViolationPipeline } from "./report-pipeline";
import { parseReportFile } from "./report-parser";

const createScanSchema = z.object({
  consumerName: z.string().min(1, "consumerName is required"),
  clientName: z.string().optional().nullable(),
  clientState: z.string().optional().nullable(),
});

const updateScanSchema = z.object({
  currentStep: z.number().int().min(1).max(4).optional(),
  status: z.enum(["in_progress", "completed"]).optional(),
  reviewStatus: z.enum(["pending", "in_progress", "approved", "exported"]).optional(),
  clientName: z.string().optional().nullable(),
  clientState: z.string().optional().nullable(),
  scanNotes: z.string().optional().nullable(),
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

const reviewViolationSchema = z.object({
  reviewStatus: z.enum(["pending", "confirmed", "modified", "rejected", "needs_info"]),
  reviewerNotes: z.string().optional().nullable(),
  severityOverride: z.string().optional().nullable(),
  descriptionOverride: z.string().optional().nullable(),
  reviewedBy: z.string().optional().nullable(),
  // Paralegal editable fields
  explanation: z.string().optional().nullable(),
  evidence: z.string().optional().nullable(),
  fcraStatute: z.string().optional().nullable(),
  evidenceRequired: z.string().optional().nullable(),
  evidenceProvided: z.boolean().optional().nullable(),
  evidenceNotes: z.string().optional().nullable(),
  confidence: z.string().optional().nullable(),
  croReminder: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  paralegalNotes: z.string().optional().nullable(),
});

const approveScanSchema = z.object({
  reviewedBy: z.string().min(1, "reviewedBy is required"),
  reviewNotes: z.string().optional().nullable(),
});

const reportMetadataSchema = z.object({
  reportTitle: z.string().optional().nullable(),
  clientName: z.string().optional().nullable(),
  clientState: z.string().optional().nullable(),
  scanNotes: z.string().optional().nullable(),
});


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB max for images
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/html", "application/pdf", "text/plain", "text/csv",
      "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
    ];
    const allowedExtensions = [
      ".html", ".htm", ".pdf", ".txt", ".csv",
      ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    if (allowed.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Supported formats: HTML, PDF, TXT, CSV, PNG, JPG, WEBP, GIF"));
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
      const scan = await storage.createScan({
        consumerName: parsed.data.consumerName,
        status: "in_progress",
        currentStep: 1,
        clientName: parsed.data.clientName || null,
        clientState: parsed.data.clientState || null,
      });
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
      const parsedReport = await storage.getParsedReportByScan(id);
      res.json({ ...scan, negativeAccounts: accountsWithDetails, hasParsedReport: !!parsedReport });
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
      // Handle additional scan fields
      const extraUpdates: Record<string, any> = {};
      if (parsed.data.reviewStatus !== undefined) extraUpdates.reviewStatus = parsed.data.reviewStatus;
      if (parsed.data.clientName !== undefined) extraUpdates.clientName = parsed.data.clientName;
      if (parsed.data.clientState !== undefined) extraUpdates.clientState = parsed.data.clientState;
      if (parsed.data.scanNotes !== undefined) extraUpdates.scanNotes = parsed.data.scanNotes;
      if (Object.keys(extraUpdates).length > 0) {
        scan = await storage.updateScan(id, extraUpdates);
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

  // ========== NEW PIPELINE: Parse → Normalize → Flag → Summarize ==========
  app.post("/api/scans/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.toLowerCase();
      const isPdf = ext.endsWith(".pdf") || req.file.mimetype === "application/pdf";
      const isHtml = ext.endsWith(".html") || ext.endsWith(".htm");
      const isImage = /\.(png|jpg|jpeg|webp|gif)$/.test(ext) || req.file.mimetype?.startsWith("image/");
      const fileType = isPdf ? "application/pdf" : isHtml ? "text/html" : isImage ? req.file.mimetype : "text/plain";
      const fileContent = (isPdf || isImage) ? "" : req.file.buffer.toString("utf-8");
      const pdfBuffer = isPdf ? req.file.buffer : undefined;
      const imageBuffer = isImage ? req.file.buffer : undefined;

      const result = await runReportPipeline(
        fileContent,
        fileType,
        req.file.originalname,
        pdfBuffer,
        imageBuffer,
      );

      const organized = organizeReport(result.parsedReport);

      res.json({
        scanId: result.scanId,
        parsedReportId: result.parsedReportId,
        consumerName: result.consumerName,
        accountsCreated: result.accountsCreated,
        violationsFound: result.violationsFound,
        issueFlagsDetected: result.issueFlagsDetected,
        summary: {
          tradelineCount: result.parsedReport.tradelines.length,
          publicRecordCount: result.parsedReport.publicRecords.length,
          inquiryCount: result.parsedReport.inquiries.length,
          scores: result.parsedReport.profile.scores,
          categorySummaries: result.parsedReport.summary.categorySummaries,
          actionPlanItems: result.parsedReport.summary.actionPlan.length,
        },
        organizedReport: organized,
      });
    } catch (error: any) {
      console.error("Upload scan error:", error);
      res.status(500).json({ error: error.message || "Upload and analysis failed" });
    }
  });

  // ========== TWO-STEP UPLOAD: Extract Text → Review → Analyze ==========

  // Step 1: Extract text only (no LLM, no DB) — fast
  app.post("/api/scans/upload-extract", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.toLowerCase();
      const isPdf = ext.endsWith(".pdf") || req.file.mimetype === "application/pdf";
      const isHtml = ext.endsWith(".html") || ext.endsWith(".htm");
      const isImage = /\.(png|jpg|jpeg|webp|gif)$/.test(ext) || req.file.mimetype?.startsWith("image/");

      if (isImage) {
        return res.json({
          rawText: "",
          fileName: req.file.originalname,
          fileType: req.file.mimetype,
          isImage: true,
        });
      }

      const fileType = isPdf ? "application/pdf" : isHtml ? "text/html" : "text/plain";
      const fileContent = isPdf ? "" : req.file.buffer.toString("utf-8");
      const pdfBuffer = isPdf ? req.file.buffer : undefined;

      const extracted = await parseReportFile(fileContent, fileType, pdfBuffer);

      res.json({
        rawText: extracted.fullText,
        fileName: req.file.originalname,
        fileType,
        isImage: false,
      });
    } catch (error: any) {
      console.error("Extract text error:", error);
      res.status(500).json({ error: error.message || "Text extraction failed" });
    }
  });

  // Step 2: Analyze previously extracted (and possibly edited) text through full pipeline
  app.post("/api/scans/analyze-text", async (req, res) => {
    try {
      const { rawText, fileName } = req.body;
      if (!rawText || typeof rawText !== "string" || rawText.trim().length < 50) {
        return res.status(400).json({ error: "rawText must be at least 50 characters" });
      }

      const result = await runReportPipeline(
        rawText,
        "text/plain",
        fileName || "edited-report.txt",
      );

      const organized = organizeReport(result.parsedReport);

      res.json({
        scanId: result.scanId,
        parsedReportId: result.parsedReportId,
        consumerName: result.consumerName,
        accountsCreated: result.accountsCreated,
        violationsFound: result.violationsFound,
        issueFlagsDetected: result.issueFlagsDetected,
        summary: {
          tradelineCount: result.parsedReport.tradelines.length,
          publicRecordCount: result.parsedReport.publicRecords.length,
          inquiryCount: result.parsedReport.inquiries.length,
          scores: result.parsedReport.profile.scores,
          categorySummaries: result.parsedReport.summary.categorySummaries,
          actionPlanItems: result.parsedReport.summary.actionPlan.length,
        },
        organizedReport: organized,
      });
    } catch (error: any) {
      console.error("Analyze text error:", error);
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // ========== SEPARATED PIPELINE: Structure → Review → Violations ==========

  // Step A: Structure text into organized JSON only (no violations)
  app.post("/api/scans/structure-text", async (req, res) => {
    try {
      const { rawText, fileName } = req.body;
      if (!rawText || typeof rawText !== "string" || rawText.trim().length < 50) {
        return res.status(400).json({ error: "rawText must be at least 50 characters" });
      }

      const result = await runStructurePipeline(
        rawText,
        "text/plain",
        fileName || "uploaded-report.txt",
      );

      const organized = organizeReport(result.parsedReport);

      res.json({
        scanId: result.scanId,
        parsedReportId: result.parsedReportId,
        consumerName: result.consumerName,
        tradelineCount: result.tradelineCount,
        issueFlagsDetected: result.issueFlagsDetected,
        summary: {
          tradelineCount: result.parsedReport.tradelines.length,
          publicRecordCount: result.parsedReport.publicRecords.length,
          inquiryCount: result.parsedReport.inquiries.length,
          scores: result.parsedReport.profile.scores,
          categorySummaries: result.parsedReport.summary.categorySummaries,
          actionPlanItems: result.parsedReport.summary.actionPlan.length,
        },
        organizedReport: organized,
      });
    } catch (error: any) {
      console.error("Structure text error:", error);
      res.status(500).json({ error: error.message || "Structuring failed" });
    }
  });

  // Step A (file variant): Structure uploaded file into organized JSON only (no violations)
  app.post("/api/scans/structure-upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.toLowerCase();
      const isPdf = ext.endsWith(".pdf") || req.file.mimetype === "application/pdf";
      const isHtml = ext.endsWith(".html") || ext.endsWith(".htm");
      const isImage = /\.(png|jpg|jpeg|webp|gif)$/.test(ext) || req.file.mimetype?.startsWith("image/");
      const fileType = isPdf ? "application/pdf" : isHtml ? "text/html" : isImage ? req.file.mimetype : "text/plain";
      const fileContent = (isPdf || isImage) ? "" : req.file.buffer.toString("utf-8");
      const pdfBuffer = isPdf ? req.file.buffer : undefined;
      const imageBuffer = isImage ? req.file.buffer : undefined;

      const result = await runStructurePipeline(
        fileContent,
        fileType,
        req.file.originalname,
        pdfBuffer,
        imageBuffer,
      );

      const organized = organizeReport(result.parsedReport);

      res.json({
        scanId: result.scanId,
        parsedReportId: result.parsedReportId,
        consumerName: result.consumerName,
        tradelineCount: result.tradelineCount,
        issueFlagsDetected: result.issueFlagsDetected,
        summary: {
          tradelineCount: result.parsedReport.tradelines.length,
          publicRecordCount: result.parsedReport.publicRecords.length,
          inquiryCount: result.parsedReport.inquiries.length,
          scores: result.parsedReport.profile.scores,
          categorySummaries: result.parsedReport.summary.categorySummaries,
          actionPlanItems: result.parsedReport.summary.actionPlan.length,
        },
        organizedReport: organized,
      });
    } catch (error: any) {
      console.error("Structure upload error:", error);
      res.status(500).json({ error: error.message || "Structuring failed" });
    }
  });

  // Step B: Run violation detection on an already-structured scan
  app.post("/api/scans/:scanId/run-violations", async (req, res) => {
    try {
      const scanId = parseInt(req.params.scanId);
      const scan = await storage.getScan(scanId);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const result = await runViolationPipeline(scanId);

      res.json({
        scanId: result.scanId,
        accountsCreated: result.accountsCreated,
        violationsFound: result.violationsFound,
      });
    } catch (error: any) {
      console.error("Violation pipeline error:", error);
      res.status(500).json({ error: error.message || "Violation analysis failed" });
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

      // Get scan for clientState
      const scan = await storage.getScan(account.scanId);
      const clientState = scan?.clientState || null;

      await storage.clearViolationsByAccount(id);

      const detectedViolations = await detectViolations(account, clientState);
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
          category: v.category || "FCRA_REPORTING",
          evidenceRequired: v.evidenceRequired || null,
          evidenceProvided: v.evidenceProvided || false,
          evidenceNotes: v.evidenceNotes || null,
          confidence: v.confidence || "possible",
          croReminder: v.croReminder || null,
        });
        savedViolations.push(saved);
      }
      await storage.updateWorkflowStep(id, "scanned");
      res.json({ violations: savedViolations });
    } catch (error) {
      console.error("Error scanning account:", error);
      res.status(500).json({ error: "Failed to scan account for violations. Please try again." });
    }
  });

  // POST /api/scans/:scanId/analyze — Run full manual entry pipeline
  // Manual Workflow: Manual Data Entry → Structured JSON → AI Analysis → Review → Export
  app.post("/api/scans/:scanId/analyze", async (req, res) => {
    try {
      const scanId = parseInt(req.params.scanId);
      const scan = await storage.getScan(scanId);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const result = await runManualEntryPipeline(scanId);

      res.json({
        scanId: result.scanId,
        parsedReportId: result.parsedReportId,
        consumerName: result.consumerName,
        accountsCreated: result.accountsCreated,
        violationsFound: result.violationsFound,
        issueFlagsDetected: result.issueFlagsDetected,
      });
    } catch (error: any) {
      console.error("Error running manual analysis pipeline:", error);
      res.status(500).json({ error: error?.message || "Failed to run analysis pipeline" });
    }
  });

  // ========== REVIEW WORKFLOW ENDPOINTS ==========

  // PATCH /api/violations/:id/review — Review a single violation
  app.patch("/api/violations/:id/review", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = reviewViolationSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });

      const violation = await storage.getViolation(id);
      if (!violation) return res.status(404).json({ error: "Violation not found" });

      const updates: Record<string, any> = {
        reviewStatus: parsed.data.reviewStatus,
        reviewedAt: new Date(),
      };
      if (parsed.data.reviewerNotes !== undefined) updates.reviewerNotes = parsed.data.reviewerNotes;
      if (parsed.data.reviewedBy !== undefined) updates.reviewedBy = parsed.data.reviewedBy;

      // Only allow severity/description override when status is "modified"
      if (parsed.data.reviewStatus === "modified") {
        if (parsed.data.severityOverride !== undefined) updates.severityOverride = parsed.data.severityOverride;
        if (parsed.data.descriptionOverride !== undefined) updates.descriptionOverride = parsed.data.descriptionOverride;
      } else {
        updates.severityOverride = null;
        updates.descriptionOverride = null;
      }

      // Paralegal editable fields — allowed for any review status
      if (parsed.data.explanation !== undefined) updates.explanation = parsed.data.explanation;
      if (parsed.data.evidence !== undefined) updates.evidence = parsed.data.evidence;
      if (parsed.data.fcraStatute !== undefined) updates.fcraStatute = parsed.data.fcraStatute;
      if (parsed.data.evidenceRequired !== undefined) updates.evidenceRequired = parsed.data.evidenceRequired;
      if (parsed.data.evidenceProvided !== undefined) updates.evidenceProvided = parsed.data.evidenceProvided;
      if (parsed.data.evidenceNotes !== undefined) updates.evidenceNotes = parsed.data.evidenceNotes;
      if (parsed.data.confidence !== undefined) updates.confidence = parsed.data.confidence;
      if (parsed.data.croReminder !== undefined) updates.croReminder = parsed.data.croReminder;
      if (parsed.data.category !== undefined) updates.category = parsed.data.category;
      if (parsed.data.paralegalNotes !== undefined) updates.paralegalNotes = parsed.data.paralegalNotes;

      const updated = await storage.updateViolation(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error reviewing violation:", error);
      res.status(500).json({ error: "Failed to review violation" });
    }
  });

  // PATCH /api/violations/:id/edit — Paralegal edit violation details (independent of review status)
  app.patch("/api/violations/:id/edit", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const violation = await storage.getViolation(id);
      if (!violation) return res.status(404).json({ error: "Violation not found" });

      const allowedFields = [
        "explanation", "evidence", "fcraStatute", "evidenceRequired",
        "evidenceProvided", "evidenceNotes", "confidence", "croReminder",
        "category", "paralegalNotes", "severity", "violationType",
      ];

      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateViolation(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error editing violation:", error);
      res.status(500).json({ error: "Failed to edit violation" });
    }
  });

  // POST /api/scans/:id/approve — Approve and lock a scan
  app.post("/api/scans/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = approveScanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });

      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      // Count violations by status — allow approval even with pending violations
      const allViolations = await storage.getViolationsByScan(id);

      const confirmed = allViolations.filter(v => v.reviewStatus === "confirmed").length;
      const modified = allViolations.filter(v => v.reviewStatus === "modified").length;
      const rejected = allViolations.filter(v => v.reviewStatus === "rejected").length;

      const updated = await storage.updateScan(id, {
        reviewStatus: "approved",
        reviewedBy: parsed.data.reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: parsed.data.reviewNotes || null,
        approvedViolationCount: confirmed + modified,
        rejectedViolationCount: rejected,
        status: "completed",
      });

      res.json(updated);
    } catch (error) {
      console.error("Error approving scan:", error);
      res.status(500).json({ error: "Failed to approve scan" });
    }
  });

  // POST /api/scans/:id/reopen — Reopen a scan for review
  app.post("/api/scans/:id/reopen", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const updated = await storage.updateScan(id, {
        reviewStatus: "in_progress",
        reviewedAt: null,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error reopening scan:", error);
      res.status(500).json({ error: "Failed to reopen scan" });
    }
  });

  // GET /api/scans/:id/review-summary — Get review summary stats
  app.get("/api/scans/:id/review-summary", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const allViolations = await storage.getViolationsByScan(id);
      const summary = {
        confirmed: allViolations.filter(v => v.reviewStatus === "confirmed").length,
        modified: allViolations.filter(v => v.reviewStatus === "modified").length,
        rejected: allViolations.filter(v => v.reviewStatus === "rejected").length,
        needsInfo: allViolations.filter(v => v.reviewStatus === "needs_info").length,
        pending: allViolations.filter(v => !v.reviewStatus || v.reviewStatus === "pending").length,
        total: allViolations.length,
      };
      res.json(summary);
    } catch (error) {
      console.error("Error fetching review summary:", error);
      res.status(500).json({ error: "Failed to fetch review summary" });
    }
  });

  // GET /api/scans/:id/export/pdf — Export scan as PDF (available anytime)
  app.get("/api/scans/:id/export/pdf", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const negAccounts = await storage.getNegativeAccountsByScan(id);
      const accountsWithViolations = await Promise.all(
        negAccounts.map(async (acct) => {
          const acctViolations = await storage.getViolationsByAccount(acct.id);
          return { ...acct, violations: acctViolations };
        })
      );

      // Include all violations except rejected ones
      const includedViolations = accountsWithViolations.flatMap(a =>
        a.violations.filter(v => v.reviewStatus !== "rejected")
      );

      const severityBreakdown = {
        critical: includedViolations.filter(v => (v.severityOverride || v.severity) === "critical").length,
        high: includedViolations.filter(v => (v.severityOverride || v.severity) === "high").length,
        medium: includedViolations.filter(v => (v.severityOverride || v.severity) === "medium").length,
        low: includedViolations.filter(v => (v.severityOverride || v.severity) === "low").length,
      };

      const title = scan.reportTitle || "LEXA — FCRA Violation Report";
      const clientName = scan.clientName || scan.consumerName;
      const reviewStamp = scan.reviewedBy
        ? `Reviewed and Approved by ${scan.reviewedBy} on ${scan.reviewedAt ? new Date(scan.reviewedAt).toLocaleDateString() : "N/A"}`
        : "Pending review";
      const disclaimer = scan.reviewedBy
        ? "This report has been reviewed by a human analyst. The information is provided for dispute purposes only."
        : "This report has not yet been reviewed by a human analyst. The violations listed are AI-detected and pending review.";

      // Generate actual PDF using pdfkit
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));

      const pdfReady = new Promise<Buffer>((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });

      // Title
      doc.fontSize(20).font("Helvetica-Bold").text(title, { align: "center" });
      doc.moveDown(0.5);

      // Meta info
      doc.fontSize(10).font("Helvetica")
        .text(`Consumer: ${scan.consumerName}`)
        .text(`Client: ${clientName}`)
        .text(`State: ${scan.clientState || "N/A"}`)
        .text(`Date: ${new Date().toLocaleDateString()}`)
        .text(`Status: ${reviewStamp}`);
      doc.moveDown();

      // Summary
      doc.fontSize(14).font("Helvetica-Bold").text("Summary");
      doc.fontSize(10).font("Helvetica")
        .text(`Total Accounts: ${negAccounts.length}`)
        .text(`Total Violations: ${includedViolations.length}`)
        .text(`Critical: ${severityBreakdown.critical}  |  High: ${severityBreakdown.high}  |  Medium: ${severityBreakdown.medium}  |  Low: ${severityBreakdown.low}`);
      doc.moveDown();

      // Horizontal rule helper
      const drawRule = () => {
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);
      };

      // Accounts & Violations
      for (const acct of accountsWithViolations) {
        const acctViolations = acct.violations.filter(v => v.reviewStatus !== "rejected");
        if (acctViolations.length === 0) continue;

        drawRule();
        doc.fontSize(12).font("Helvetica-Bold")
          .text(`${acct.creditor || "Unknown Creditor"}`, { continued: false });
        doc.fontSize(9).font("Helvetica")
          .text(`Account #: ${acct.accountNumber || "N/A"}  |  Type: ${formatAccountType(acct.accountType)}  |  Balance: ${acct.balance || "N/A"}`)
          .text(`Status: ${acct.status || "N/A"}  |  Bureaus: ${acct.bureaus || "N/A"}`);
        doc.moveDown(0.3);

        for (const v of acctViolations) {
          const severity = v.severityOverride || v.severity;
          const description = v.descriptionOverride || v.explanation;

          doc.fontSize(10).font("Helvetica-Bold")
            .text(`• ${v.violationType}`, { continued: false });
          doc.fontSize(9).font("Helvetica")
            .text(`Severity: ${severity}  |  Category: ${v.category || "N/A"}  |  Confidence: ${v.confidence || "N/A"}`)
            .text(`FCRA Statute: ${v.fcraStatute || "N/A"}`);
          if (description) {
            doc.text(`Description: ${description}`);
          }
          if (v.evidence) {
            doc.text(`Evidence: ${v.evidence}`);
          }
          if (v.reviewerNotes) {
            doc.text(`Reviewer Notes: ${v.reviewerNotes}`);
          }
          if (v.paralegalNotes) {
            doc.text(`Paralegal Notes: ${v.paralegalNotes}`);
          }
          doc.moveDown(0.3);
        }
        doc.moveDown(0.3);
      }

      // Review notes
      if (scan.reviewNotes) {
        drawRule();
        doc.fontSize(12).font("Helvetica-Bold").text("Review Notes");
        doc.fontSize(10).font("Helvetica").text(scan.reviewNotes);
        doc.moveDown();
      }

      // Disclaimer
      drawRule();
      doc.fontSize(8).font("Helvetica-Oblique").text(disclaimer, { align: "center" });

      doc.end();

      const pdfBuffer = await pdfReady;

      // Only mark as exported if previously approved
      if (scan.reviewStatus === "approved") {
        await storage.updateScan(id, { reviewStatus: "exported" });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="lexa-report-${id}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error exporting PDF:", error);
      res.status(500).json({ error: "Failed to export PDF" });
    }
  });

  // GET /api/scans/:id/export/csv — Export scan as CSV (available anytime)
  app.get("/api/scans/:id/export/csv", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const includeRejected = req.query.include_rejected === "true";
      const negAccounts = await storage.getNegativeAccountsByScan(id);
      const accountsWithViolations = await Promise.all(
        negAccounts.map(async (acct) => {
          const acctViolations = await storage.getViolationsByAccount(acct.id);
          return { ...acct, violations: acctViolations };
        })
      );

      // CSV header
      const headers = [
        "Account Name", "Creditor", "Account Number", "Account Type",
        "Original Creditor", "Balance", "Status", "Bureaus",
        "Violation Category", "Violation Type", "Description", "Severity",
        "AI Confidence", "Evidence", "Evidence Required", "Evidence Status",
        "Evidence Notes", "CRO Reminder", "FCRA/FDCPA Statute",
        "Review Status", "Reviewer Notes", "Paralegal Notes",
        "Date Detected", "Date Reviewed"
      ];

      const rows: string[][] = [];
      for (const acct of accountsWithViolations) {
        for (const v of acct.violations) {
          if (!includeRejected && v.reviewStatus === "rejected") continue;
          const row = [
            acct.creditor,
            acct.originalCreditor || acct.creditor,
            acct.accountNumber || "",
            formatAccountType(acct.accountType),
            acct.originalCreditor || "",
            acct.balance != null ? String(acct.balance) : "",
            acct.status || "",
            acct.bureaus || "",
            v.category || "FCRA_REPORTING",
            v.violationType,
            v.reviewStatus === "modified" && v.descriptionOverride ? v.descriptionOverride : v.explanation,
            v.reviewStatus === "modified" && v.severityOverride ? v.severityOverride : v.severity,
            v.confidence || "N/A",
            v.evidence || "",
            v.evidenceRequired || "",
            v.evidenceProvided ? "Provided" : "Missing",
            v.evidenceNotes || "",
            v.croReminder || "",
            v.fcraStatute || "",
            v.reviewStatus === "rejected" ? "REJECTED" : (v.reviewStatus || "pending"),
            v.reviewerNotes || "",
            v.paralegalNotes || "",
            v.createdAt ? new Date(v.createdAt).toLocaleDateString() : "",
            v.reviewedAt ? new Date(v.reviewedAt).toLocaleDateString() : "",
          ];
          rows.push(row);
        }
      }

      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(cell => `"${(cell || "").replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      // Only mark as exported if previously approved
      if (scan.reviewStatus === "approved") {
        await storage.updateScan(id, { reviewStatus: "exported" });
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="lexa-report-${id}.csv"`);
      res.send(csvContent);
    } catch (error) {
      console.error("Error exporting CSV:", error);
      res.status(500).json({ error: "Failed to export CSV" });
    }
  });

  // GET /api/scans/:id/export/json — Export scan violations as JSON
  app.get("/api/scans/:id/export/json", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const includeRejected = req.query.include_rejected === "true";
      const negAccounts = await storage.getNegativeAccountsByScan(id);
      const accountsWithViolations = await Promise.all(
        negAccounts.map(async (acct) => {
          const acctViolations = await storage.getViolationsByAccount(acct.id);
          return { ...acct, violations: acctViolations };
        })
      );

      const accounts = accountsWithViolations.map((acct) => {
        const violations = acct.violations
          .filter((v) => includeRejected || v.reviewStatus !== "rejected")
          .map((v) => ({
            id: v.id,
            violationType: v.violationType,
            severity: v.reviewStatus === "modified" && v.severityOverride ? v.severityOverride : v.severity,
            explanation: v.reviewStatus === "modified" && v.descriptionOverride ? v.descriptionOverride : v.explanation,
            category: v.category || "FCRA_REPORTING",
            fcraStatute: v.fcraStatute || null,
            evidence: v.evidence || null,
            matchedRule: v.matchedRule || null,
            confidence: v.confidence || null,
            croReminder: v.croReminder || null,
            evidenceRequired: v.evidenceRequired || null,
            evidenceProvided: v.evidenceProvided || false,
            evidenceNotes: v.evidenceNotes || null,
            reviewStatus: v.reviewStatus || "pending",
            reviewerNotes: v.reviewerNotes || null,
            paralegalNotes: v.paralegalNotes || null,
            detectedAt: v.createdAt || null,
            reviewedAt: v.reviewedAt || null,
            reviewedBy: v.reviewedBy || null,
          }));

        return {
          id: acct.id,
          creditor: acct.creditor,
          accountNumber: acct.accountNumber || null,
          accountType: formatAccountType(acct.accountType),
          originalCreditor: acct.originalCreditor || null,
          balance: acct.balance != null ? Number(acct.balance) : null,
          status: acct.status || null,
          bureaus: acct.bureaus || null,
          violations,
        };
      });

      const totalViolations = accounts.reduce((sum, a) => sum + a.violations.length, 0);
      const severityCounts = accounts.reduce(
        (counts, a) => {
          for (const v of a.violations) {
            const sev = v.severity as string;
            if (sev in counts) counts[sev as keyof typeof counts]++;
          }
          return counts;
        },
        { critical: 0, high: 0, medium: 0, low: 0 }
      );

      const exportData = {
        exportedAt: new Date().toISOString(),
        scan: {
          id: scan.id,
          consumerName: scan.consumerName || null,
          clientName: scan.clientName || null,
          clientState: scan.clientState || null,
          reportTitle: scan.reportTitle || null,
          reviewStatus: scan.reviewStatus || "pending",
          createdAt: scan.createdAt || null,
        },
        summary: {
          totalAccounts: accounts.length,
          totalViolations,
          severityBreakdown: severityCounts,
        },
        accounts,
      };

      // Only mark as exported if previously approved
      if (scan.reviewStatus === "approved") {
        await storage.updateScan(id, { reviewStatus: "exported" });
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="lexa-report-${id}.json"`);
      res.json(exportData);
    } catch (error) {
      console.error("Error exporting JSON:", error);
      res.status(500).json({ error: "Failed to export JSON" });
    }
  });

  // PATCH /api/scans/:id/report — Save report metadata
  app.patch("/api/scans/:id/report", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = reportMetadataSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });

      const updates: Record<string, any> = {};
      if (parsed.data.reportTitle !== undefined) updates.reportTitle = parsed.data.reportTitle;
      if (parsed.data.clientName !== undefined) updates.clientName = parsed.data.clientName;
      if (parsed.data.clientState !== undefined) updates.clientState = parsed.data.clientState;
      if (parsed.data.scanNotes !== undefined) updates.scanNotes = parsed.data.scanNotes;

      const scan = await storage.updateScan(id, updates);
      if (!scan) return res.status(404).json({ error: "Scan not found" });
      res.json(scan);
    } catch (error) {
      console.error("Error updating report metadata:", error);
      res.status(500).json({ error: "Failed to update report metadata" });
    }
  });

  // ========== PARSED REPORT ENDPOINTS ==========

  // GET /api/scans/:id/parsed-report — Get the full parsed credit report JSON
  app.get("/api/scans/:id/parsed-report", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(id);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found for this scan" });
      res.json(parsedReport.reportJson);
    } catch (error) {
      console.error("Error fetching parsed report:", error);
      res.status(500).json({ error: "Failed to fetch parsed report" });
    }
  });

  // GET /api/scans/:id/organized-report — Get the organized credit report JSON
  // Structured into: Credit Scores, Personal Info, Consumer Statement,
  // Account Summary, Account History, Public Information, Inquiries, Collections, Creditor Contacts
  app.get("/api/scans/:id/organized-report", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(id);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found for this scan" });
      const reportJson = parsedReport.reportJson as any;
      if (!reportJson) return res.status(404).json({ error: "Report JSON not available" });
      const organized = organizeReport(reportJson);
      res.json(organized);
    } catch (error) {
      console.error("Error fetching organized report:", error);
      res.status(500).json({ error: "Failed to fetch organized report" });
    }
  });

  // GET /api/scans/:id/issue-flags — Get deterministic issue flags
  app.get("/api/scans/:id/issue-flags", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(id);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found for this scan" });
      res.json(parsedReport.issueFlagsJson || []);
    } catch (error) {
      console.error("Error fetching issue flags:", error);
      res.status(500).json({ error: "Failed to fetch issue flags" });
    }
  });

  // GET /api/scans/:id/report-summary — Get hierarchical summaries
  app.get("/api/scans/:id/report-summary", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(id);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found for this scan" });
      res.json(parsedReport.summaryJson || {});
    } catch (error) {
      console.error("Error fetching report summary:", error);
      res.status(500).json({ error: "Failed to fetch report summary" });
    }
  });

  // GET /api/scans/:id/tradeline-evidence — Get per-tradeline evidence blocks
  app.get("/api/scans/:id/tradeline-evidence", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(id);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found for this scan" });

      const evidence = await storage.getTradelineEvidenceByScan(parsedReport.id);
      res.json(evidence.map(e => ({
        id: e.id,
        creditorName: e.creditorName,
        accountNumberMasked: e.accountNumberMasked,
        tradeline: e.tradelineJson,
        evidenceText: e.evidenceText,
        bureaus: e.bureaus,
        issueFlags: e.issueFlagsJson || [],
      })));
    } catch (error) {
      console.error("Error fetching tradeline evidence:", error);
      res.status(500).json({ error: "Failed to fetch tradeline evidence" });
    }
  });

  // GET /api/scans/:id/profile — Get credit report profile (name, scores, addresses)
  app.get("/api/scans/:id/profile", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(id);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found for this scan" });
      res.json(parsedReport.profileJson || {});
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  // GET /api/scans/:id/action-plan — Get the dispute action plan
  app.get("/api/scans/:id/action-plan", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(id);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found for this scan" });
      const summary = parsedReport.summaryJson as any;
      res.json({
        actionPlan: summary?.actionPlan || [],
        accountOneLiners: summary?.accountOneLiners || [],
        categorySummaries: summary?.categorySummaries || [],
      });
    } catch (error) {
      console.error("Error fetching action plan:", error);
      res.status(500).json({ error: "Failed to fetch action plan" });
    }
  });

  // ========== CRO REVIEW & EDIT ENDPOINTS ==========

  // PATCH /api/scans/:id/issue-flags/:index/review — CRO review/edit a specific issue flag
  app.patch("/api/scans/:id/issue-flags/:index/review", async (req, res) => {
    try {
      const scanId = parseInt(req.params.id);
      const flagIndex = parseInt(req.params.index);
      const parsedReport = await storage.getParsedReportByScan(scanId);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found" });

      const flags = (parsedReport.issueFlagsJson as any[]) || [];
      if (flagIndex < 0 || flagIndex >= flags.length) {
        return res.status(400).json({ error: "Invalid flag index" });
      }

      const { reviewStatus, reviewerNotes, severityOverride, descriptionOverride } = req.body;

      // Update the flag in-place
      flags[flagIndex] = {
        ...flags[flagIndex],
        reviewStatus: reviewStatus || flags[flagIndex].reviewStatus || "pending",
        reviewerNotes: reviewerNotes !== undefined ? reviewerNotes : flags[flagIndex].reviewerNotes,
        severityOverride: severityOverride !== undefined ? severityOverride : flags[flagIndex].severityOverride,
        descriptionOverride: descriptionOverride !== undefined ? descriptionOverride : flags[flagIndex].descriptionOverride,
        reviewedAt: new Date().toISOString(),
      };

      await storage.updateParsedReportFlags(parsedReport.id, flags);
      res.json(flags[flagIndex]);
    } catch (error) {
      console.error("Error reviewing issue flag:", error);
      res.status(500).json({ error: "Failed to review issue flag" });
    }
  });

  // PATCH /api/scans/:id/action-plan/edit — CRO edit the action plan
  app.patch("/api/scans/:id/action-plan/edit", async (req, res) => {
    try {
      const scanId = parseInt(req.params.id);
      const parsedReport = await storage.getParsedReportByScan(scanId);
      if (!parsedReport) return res.status(404).json({ error: "Parsed report not found" });

      const { actionPlan, accountOneLiners, categorySummaries, croNotes } = req.body;
      const summary = (parsedReport.summaryJson as any) || {};

      // Allow CRO to override any part of the summary
      if (actionPlan !== undefined) summary.actionPlan = actionPlan;
      if (accountOneLiners !== undefined) summary.accountOneLiners = accountOneLiners;
      if (categorySummaries !== undefined) summary.categorySummaries = categorySummaries;
      if (croNotes !== undefined) summary.croNotes = croNotes;
      summary.lastEditedAt = new Date().toISOString();

      await storage.updateParsedReportSummary(parsedReport.id, summary);
      res.json(summary);
    } catch (error) {
      console.error("Error editing action plan:", error);
      res.status(500).json({ error: "Failed to edit action plan" });
    }
  });

  // GET /api/scans/:id/cro-review — Combined review view for CRO
  // Returns everything needed for CRO review: violations, issue flags, summary, evidence
  app.get("/api/scans/:id/cro-review", async (req, res) => {
    try {
      const scanId = parseInt(req.params.id);
      const scan = await storage.getScan(scanId);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const parsedReport = await storage.getParsedReportByScan(scanId);
      const negAccounts = await storage.getNegativeAccountsByScan(scanId);
      const accountsWithViolations = await Promise.all(
        negAccounts.map(async (acct) => {
          const violations = await storage.getViolationsByAccount(acct.id);
          return { ...acct, violations };
        })
      );

      let tradelineEvidenceList: any[] = [];
      if (parsedReport) {
        const evidence = await storage.getTradelineEvidenceByScan(parsedReport.id);
        tradelineEvidenceList = evidence.map(e => ({
          id: e.id,
          creditorName: e.creditorName,
          accountNumberMasked: e.accountNumberMasked,
          tradeline: e.tradelineJson,
          issueFlags: e.issueFlagsJson || [],
          bureaus: e.bureaus,
        }));
      }

      const allViolations = accountsWithViolations.flatMap(a => a.violations);

      res.json({
        scan: {
          id: scan.id,
          consumerName: scan.consumerName,
          clientName: scan.clientName,
          clientState: scan.clientState,
          status: scan.status,
          reviewStatus: scan.reviewStatus,
        },
        profile: parsedReport?.profileJson || null,
        scores: (parsedReport?.profileJson as any)?.scores || [],
        issueFlags: parsedReport?.issueFlagsJson || [],
        summary: parsedReport?.summaryJson || null,
        accounts: accountsWithViolations,
        tradelineEvidence: tradelineEvidenceList,
        reviewProgress: {
          totalViolations: allViolations.length,
          reviewed: allViolations.filter(v => v.reviewStatus && v.reviewStatus !== "pending").length,
          confirmed: allViolations.filter(v => v.reviewStatus === "confirmed").length,
          modified: allViolations.filter(v => v.reviewStatus === "modified").length,
          rejected: allViolations.filter(v => v.reviewStatus === "rejected").length,
          needsInfo: allViolations.filter(v => v.reviewStatus === "needs_info").length,
          pending: allViolations.filter(v => !v.reviewStatus || v.reviewStatus === "pending").length,
        },
      });
    } catch (error) {
      console.error("Error fetching CRO review:", error);
      res.status(500).json({ error: "Failed to fetch CRO review data" });
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

function formatAccountType(type: string): string {
  const map: Record<string, string> = {
    debt_collection: "Debt Collection",
    charge_off: "Charge-Off",
    repossession: "Repossession",
  };
  return map[type] || type;
}
