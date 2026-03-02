import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { z } from "zod";
import { storage } from "./storage";
import { analyzeReport } from "./analyzer";
import { detectViolations } from "./ai-services";

const createScanSchema = z.object({
  consumerName: z.string().min(1, "consumerName is required"),
  clientName: z.string().optional().nullable(),
  clientState: z.string().optional().nullable(),
});

const updateScanSchema = z.object({
  currentStep: z.number().int().min(1).max(4).optional(),
  status: z.enum(["in_progress", "completed"]).optional(),
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
      // Handle additional scan fields
      const extraUpdates: Record<string, any> = {};
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
        currentStep: 4,
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
          const detected = await detectViolations(negAccount, scan.clientState);
          for (const v of detected) {
            await storage.createViolation({
              negativeAccountId: negAccount.id,
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
            totalViolations++;
          }
          await storage.updateWorkflowStep(negAccount.id, "scanned");
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

      const updated = await storage.updateViolation(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error reviewing violation:", error);
      res.status(500).json({ error: "Failed to review violation" });
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

      // Check all violations are reviewed (none pending)
      const allViolations = await storage.getViolationsByScan(id);
      const pendingCount = allViolations.filter(v => !v.reviewStatus || v.reviewStatus === "pending").length;
      if (pendingCount > 0) {
        return res.status(400).json({
          error: `Cannot approve: ${pendingCount} violation(s) still pending review`,
          pendingCount,
        });
      }

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

  // GET /api/scans/:id/export/pdf — Export approved scan as PDF
  app.get("/api/scans/:id/export/pdf", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      if (scan.reviewStatus !== "approved" && scan.reviewStatus !== "exported") {
        return res.status(403).json({ error: "Export not available. Complete review and approve the report first." });
      }

      const negAccounts = await storage.getNegativeAccountsByScan(id);
      const accountsWithViolations = await Promise.all(
        negAccounts.map(async (acct) => {
          const acctViolations = await storage.getViolationsByAccount(acct.id);
          return { ...acct, violations: acctViolations };
        })
      );

      // Filter to approved violations only (confirmed + modified, exclude rejected)
      const approvedViolations = accountsWithViolations.flatMap(a =>
        a.violations.filter(v => v.reviewStatus === "confirmed" || v.reviewStatus === "modified")
      );

      const severityBreakdown = {
        critical: approvedViolations.filter(v => (v.severityOverride || v.severity) === "critical").length,
        high: approvedViolations.filter(v => (v.severityOverride || v.severity) === "high").length,
        medium: approvedViolations.filter(v => (v.severityOverride || v.severity) === "medium").length,
        low: approvedViolations.filter(v => (v.severityOverride || v.severity) === "low").length,
      };

      // Build PDF-like JSON response (actual PDF generation would use pdfkit)
      const pdfData = {
        title: scan.reportTitle || "LEXA — FCRA Violation Report",
        scanName: scan.consumerName,
        clientName: scan.clientName || scan.consumerName,
        clientState: scan.clientState,
        date: new Date().toISOString(),
        reviewStamp: `Reviewed and Approved by ${scan.reviewedBy} on ${scan.reviewedAt ? new Date(scan.reviewedAt).toLocaleDateString() : "N/A"}`,
        summary: {
          totalAccounts: negAccounts.length,
          approvedViolations: approvedViolations.length,
          severityBreakdown,
        },
        accounts: accountsWithViolations.map(a => ({
          creditor: a.creditor,
          accountType: a.accountType,
          balance: a.balance,
          violations: a.violations
            .filter(v => v.reviewStatus === "confirmed" || v.reviewStatus === "modified")
            .map(v => ({
              violationType: v.violationType,
              severity: v.severityOverride || v.severity,
              description: v.descriptionOverride || v.explanation,
              fcraStatute: v.fcraStatute,
              category: v.category,
              confidence: v.confidence,
              evidenceStatus: v.evidenceProvided ? "Provided" : "Missing",
              reviewerNotes: v.reviewerNotes,
            })),
        })),
        reviewNotes: scan.reviewNotes,
        disclaimer: "This report has been reviewed by a human analyst. The information is provided for dispute purposes only.",
      };

      // Mark as exported
      await storage.updateScan(id, { reviewStatus: "exported" });

      res.setHeader("Content-Type", "application/json");
      res.json(pdfData);
    } catch (error) {
      console.error("Error exporting PDF:", error);
      res.status(500).json({ error: "Failed to export PDF" });
    }
  });

  // GET /api/scans/:id/export/csv — Export approved scan as CSV
  app.get("/api/scans/:id/export/csv", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const scan = await storage.getScan(id);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      if (scan.reviewStatus !== "approved" && scan.reviewStatus !== "exported") {
        return res.status(403).json({ error: "Export not available. Complete review and approve the report first." });
      }

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
        "Account Name", "Creditor", "Account Type", "Violation Category",
        "Violation Type", "Description", "Severity", "AI Confidence",
        "Review Status", "Reviewer Notes", "Evidence Status",
        "Date Detected", "Date Reviewed"
      ];

      const rows: string[][] = [];
      for (const acct of accountsWithViolations) {
        for (const v of acct.violations) {
          if (!includeRejected && v.reviewStatus === "rejected") continue;
          const row = [
            acct.creditor,
            acct.originalCreditor || acct.creditor,
            formatAccountType(acct.accountType),
            v.category || "FCRA_REPORTING",
            v.violationType,
            v.reviewStatus === "modified" && v.descriptionOverride ? v.descriptionOverride : v.explanation,
            v.reviewStatus === "modified" && v.severityOverride ? v.severityOverride : v.severity,
            v.confidence || "N/A",
            v.reviewStatus === "rejected" ? "REJECTED" : (v.reviewStatus || "pending"),
            v.reviewerNotes || "",
            v.evidenceProvided ? "Provided" : "Missing",
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

      // Mark as exported
      await storage.updateScan(id, { reviewStatus: "exported" });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="lexa-report-${id}.csv"`);
      res.send(csvContent);
    } catch (error) {
      console.error("Error exporting CSV:", error);
      res.status(500).json({ error: "Failed to export CSV" });
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
