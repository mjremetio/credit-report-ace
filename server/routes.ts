import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { analyzeReport } from "./analyzer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/html",
      "application/pdf",
      "text/plain",
      "text/csv",
    ];
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
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

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

  return httpServer;
}
