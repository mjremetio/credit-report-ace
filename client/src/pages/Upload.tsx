import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  UploadCloud, Activity, Loader2, CheckCircle2, AlertTriangle, FileText,
  Edit3, ArrowRight, RotateCcw, Eye, Columns3, FileCode
} from "lucide-react";
import { extractFileText, analyzeExtractedText, uploadScanFile } from "@/lib/api";

type UploadPhase = "idle" | "extracting" | "reviewing" | "analyzing" | "complete";
type ViewMode = "organized" | "raw";

export default function Upload() {
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Review state
  const [rawText, setRawText] = useState("");
  const [organizedText, setOrganizedText] = useState<string | null>(null);
  const [displayText, setDisplayText] = useState(""); // What's shown in the textarea
  const [viewMode, setViewMode] = useState<ViewMode>("organized");
  const [fileName, setFileName] = useState("");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [isEdited, setIsEdited] = useState(false);
  const [isTriBureau, setIsTriBureau] = useState(false);

  const addLog = (msg: string) => setLogs(prev => [...prev, `[${ts()}] ${msg}`]);

  // Phase 1: Extract text from file (fast, no LLM)
  const extractMutation = useMutation({
    mutationFn: extractFileText,
    onMutate: () => {
      setPhase("extracting");
      setError(null);
      setLogs([`[${ts()}] INITIATING UPLOAD...`]);
    },
    onSuccess: (data) => {
      if (data.isImage) {
        addLog("IMAGE DETECTED — Skipping text preview, proceeding to AI analysis...");
        if (originalFile) {
          fullUploadMutation.mutate(originalFile);
        }
      } else {
        addLog("TEXT EXTRACTED SUCCESSFULLY.");
        addLog(`FILE: ${data.fileName} (${data.fileType})`);
        addLog(`EXTRACTED ${data.rawText.length.toLocaleString()} characters.`);

        setRawText(data.rawText);
        setOrganizedText(data.organizedText);
        setFileName(data.fileName);
        setIsTriBureau(data.isTriBureau);

        if (data.isTriBureau && data.organizedText) {
          addLog("TRI-BUREAU REPORT DETECTED — Data organized by TransUnion, Experian, Equifax.");
          setDisplayText(data.organizedText);
          setViewMode("organized");
        } else {
          setDisplayText(data.rawText);
          setViewMode("raw");
        }
        addLog("READY FOR REVIEW — Edit if needed, then proceed to analysis.");
        setPhase("reviewing");
      }
    },
    onError: (err: Error) => {
      addLog(`ERROR: ${err.message}`);
      setError(err.message);
      setPhase("idle");
    },
  });

  // For images: use full upload pipeline
  const fullUploadMutation = useMutation({
    mutationFn: uploadScanFile,
    onMutate: () => {
      setPhase("analyzing");
      addLog("AI ENGINE: Processing image...");
    },
    onSuccess: (data) => {
      addLog(`SCAN CREATED — ID: ${data.scanId}`);
      addLog(`EXTRACTED: ${data.accountsCreated} negative accounts.`);
      addLog(`DETECTED: ${data.violationsFound} potential FCRA violations.`);
      addLog("ANALYSIS COMPLETE.");
      setResult(data);
      setPhase("complete");
    },
    onError: (err: Error) => {
      addLog(`ERROR: ${err.message}`);
      setError(err.message);
      setPhase("idle");
    },
  });

  // Phase 2: Analyze text through the full pipeline
  // If user hasn't edited, send the original rawText (optimal for the LLM).
  // If user edited the organized/raw view, send whatever they see.
  const analyzeMutation = useMutation({
    mutationFn: ({ text, name }: { text: string; name: string }) =>
      analyzeExtractedText(text, name),
    onMutate: () => {
      setPhase("analyzing");
      setError(null);
      addLog("INITIATING AI ANALYSIS...");
      addLog("AI ENGINE: Parsing credit report data...");
    },
    onSuccess: (data) => {
      addLog(`SCAN CREATED — ID: ${data.scanId}`);
      addLog(`EXTRACTED: ${data.accountsCreated} negative accounts.`);
      addLog(`DETECTED: ${data.violationsFound} potential FCRA violations.`);
      addLog("ANALYSIS COMPLETE.");
      setResult(data);
      setPhase("complete");
    },
    onError: (err: Error) => {
      addLog(`ERROR: ${err.message}`);
      setError(err.message);
      setPhase("reviewing");
    },
  });

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFile = useCallback((file: File) => {
    setOriginalFile(file);
    setResult(null);
    setError(null);
    setRawText("");
    setOrganizedText(null);
    setDisplayText("");
    setIsEdited(false);
    setIsTriBureau(false);
    extractMutation.mutate(file);
  }, [extractMutation]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleToggleView = (mode: ViewMode) => {
    if (isEdited) return; // Don't switch views if user has edited (would lose edits)
    setViewMode(mode);
    if (mode === "organized" && organizedText) {
      setDisplayText(organizedText);
    } else {
      setDisplayText(rawText);
    }
  };

  const handleProceedToAnalysis = () => {
    // If user edited, send the display text. Otherwise send raw for best LLM results.
    const textToAnalyze = isEdited ? displayText : rawText;
    analyzeMutation.mutate({ text: textToAnalyze, name: fileName });
  };

  const handleReset = () => {
    setPhase("idle");
    setLogs([]);
    setResult(null);
    setError(null);
    setRawText("");
    setOrganizedText(null);
    setDisplayText("");
    setFileName("");
    setOriginalFile(null);
    setIsEdited(false);
    setIsTriBureau(false);
  };

  return (
    <div className="h-full">
      <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-6">
        <h2 className="font-display font-medium text-lg text-white">Upload Credit Report</h2>
      </header>

      <div className="p-6 max-w-4xl mx-auto mt-6 space-y-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm,.pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
          onChange={handleFileChange}
          className="hidden"
          data-testid="input-file-upload"
        />

        {/* ── IDLE: Upload Drop Zone ── */}
        {phase === "idle" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error && (
              <div className="mb-4 bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                <p className="text-sm font-mono text-destructive">{error}</p>
              </div>
            )}

            <div
              onClick={handleFileSelect}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              data-testid="drop-zone"
              className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-card overflow-hidden"
            >
              <div className="p-4 rounded-full mb-4 bg-secondary text-muted-foreground">
                <UploadCloud className="w-8 h-8" />
              </div>
              <h3 className="font-display text-xl font-medium mb-2 text-white">
                Upload Credit Report
              </h3>
              <p className="text-muted-foreground max-w-md font-mono text-sm">
                Drag and drop a credit report (HTML, PDF, TXT, or image) or click to browse.
                You'll review the extracted data before AI analysis begins.
              </p>
            </div>

            <div className="mt-6 bg-card border border-border rounded-xl p-5">
              <h4 className="font-display text-white text-sm mb-3">How it works</h4>
              <div className="space-y-3">
                {[
                  { step: 1, text: "Upload your credit report file (HTML, PDF, TXT, or image)" },
                  { step: 2, text: "Review extracted data organized by bureau — edit if needed" },
                  { step: 3, text: "AI analyzes the data for FCRA violations" },
                  { step: 4, text: "Review results in the guided workflow" },
                ].map((item) => (
                  <div key={item.step} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-mono flex-shrink-0">
                      {item.step}
                    </div>
                    <span className="text-sm font-mono text-muted-foreground">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── EXTRACTING: Progress Animation ── */}
        {phase === "extracting" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="relative border-2 border-dashed border-primary rounded-xl p-12 flex flex-col items-center justify-center text-center bg-card overflow-hidden">
              <div className="scan-line" />
              <div className="p-4 rounded-full mb-4 bg-primary/20 text-primary">
                <Activity className="w-8 h-8 animate-pulse" />
              </div>
              <h3 className="font-display text-xl font-medium mb-2 text-white">
                Extracting Text...
              </h3>
              <p className="text-muted-foreground max-w-md font-mono text-sm">
                Reading and parsing your credit report file...
              </p>
              <div className="w-full max-w-md mt-8">
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-primary">Extracting...</span>
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                </div>
                <div className="h-1 bg-secondary w-full rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: "0%" }}
                    animate={{ width: "90%" }}
                    transition={{ duration: 8, ease: "linear" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── REVIEWING: Show extracted data with bureau organization ── */}
        {phase === "reviewing" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="bg-card border border-primary/30 rounded-xl p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Eye className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg text-white">Review Extracted Data</h3>
                    <p className="text-xs font-mono text-muted-foreground">
                      {fileName} — {displayText.length.toLocaleString()} characters
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isEdited && (
                    <span className="text-xs font-mono px-2 py-1 rounded border border-yellow-500/30 text-yellow-400 bg-yellow-500/10">
                      <Edit3 className="w-3 h-3 inline mr-1" />edited
                    </span>
                  )}
                  {isTriBureau && (
                    <span className="text-xs font-mono px-2 py-1 rounded border border-blue-500/30 text-blue-400 bg-blue-500/10">
                      <Columns3 className="w-3 h-3 inline mr-1" />Tri-Bureau
                    </span>
                  )}
                </div>
              </div>

              {/* View mode toggle (only for tri-bureau reports) */}
              {isTriBureau && organizedText && (
                <div className="flex items-center gap-1 mb-3 p-1 bg-secondary/50 rounded-lg w-fit">
                  <button
                    onClick={() => handleToggleView("organized")}
                    disabled={isEdited}
                    className={`px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center gap-1.5 ${
                      viewMode === "organized"
                        ? "bg-primary text-black"
                        : "text-muted-foreground hover:text-white disabled:opacity-40"
                    }`}
                  >
                    <Columns3 className="w-3 h-3" />
                    By Bureau
                  </button>
                  <button
                    onClick={() => handleToggleView("raw")}
                    disabled={isEdited}
                    className={`px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center gap-1.5 ${
                      viewMode === "raw"
                        ? "bg-primary text-black"
                        : "text-muted-foreground hover:text-white disabled:opacity-40"
                    }`}
                  >
                    <FileCode className="w-3 h-3" />
                    Raw
                  </button>
                  {isEdited && (
                    <span className="text-[10px] font-mono text-muted-foreground ml-2">
                      (toggle locked while editing)
                    </span>
                  )}
                </div>
              )}

              <p className="text-xs font-mono text-muted-foreground mb-3">
                {viewMode === "organized" && isTriBureau
                  ? "Data organized by bureau (TransUnion, Experian, Equifax) — each bureau's accounts shown top-to-bottom. Edit any details before AI analysis."
                  : "Raw extracted text from your credit report. Review and edit any details before proceeding to AI violation analysis."}
              </p>

              <textarea
                data-testid="textarea-raw-extracted"
                value={displayText}
                onChange={(e) => {
                  setDisplayText(e.target.value);
                  setIsEdited(true);
                }}
                rows={24}
                className="w-full bg-[#0a0a0c] border border-border rounded-lg px-4 py-3 text-white placeholder:text-muted-foreground/50 font-mono text-xs leading-relaxed focus:outline-none focus:border-primary resize-y min-h-[300px]"
                spellCheck={false}
              />

              <div className="flex items-center justify-between mt-3 text-xs font-mono text-muted-foreground">
                <span>{displayText.split("\n").length} lines</span>
                <span>{displayText.length.toLocaleString()} chars</span>
              </div>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                <p className="text-sm font-mono text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                data-testid="button-proceed-analysis"
                onClick={handleProceedToAnalysis}
                disabled={displayText.trim().length < 50}
                className="flex-1 px-6 py-3 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                Proceed to AI Analysis
              </button>
              <button
                data-testid="button-start-over"
                onClick={handleReset}
                className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-white transition-colors font-mono text-sm inline-flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Start Over
              </button>
            </div>
          </motion.div>
        )}

        {/* ── ANALYZING: AI Processing Progress ── */}
        {phase === "analyzing" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="relative border-2 border-dashed border-primary rounded-xl p-12 flex flex-col items-center justify-center text-center bg-card overflow-hidden">
              <div className="scan-line" />
              <div className="p-4 rounded-full mb-4 bg-primary/20 text-primary">
                <Activity className="w-8 h-8 animate-pulse" />
              </div>
              <h3 className="font-display text-xl font-medium mb-2 text-white">
                AI Analyzing Report...
              </h3>
              <p className="text-muted-foreground max-w-md font-mono text-sm">
                Extracting accounts, detecting FCRA violations, and generating analysis...
              </p>
              <div className="w-full max-w-md mt-8">
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-primary">Analyzing...</span>
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                </div>
                <div className="h-1 bg-secondary w-full rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 60, ease: "linear" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── COMPLETE: Results ── */}
        {phase === "complete" && result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-green-500/30 rounded-xl p-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <h3 className="font-display text-xl text-white mb-2">Analysis Complete</h3>
              <p className="text-muted-foreground font-mono text-sm mb-1">
                Consumer: <span className="text-white">{result.consumerName}</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="p-2 rounded-lg bg-primary/10 inline-block mb-3">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="text-3xl font-display text-white">{result.accountsCreated}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Accounts Extracted</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="p-2 rounded-lg bg-destructive/10 inline-block mb-3">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                </div>
                <div className="text-3xl font-display text-white">{result.violationsFound}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Violations Detected</div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                data-testid="button-view-scan"
                onClick={() => navigate(`/scan/${result.scanId}`)}
                className="flex-1 px-6 py-3 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2"
              >
                Review in Workflow
              </button>
              <button
                data-testid="button-upload-another"
                onClick={handleReset}
                className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-white transition-colors font-mono text-sm"
              >
                Upload Another
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Terminal Logs ── */}
        <AnimatePresence>
          {logs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="bg-[#0a0a0c] border border-border rounded-lg p-4 font-mono text-xs text-muted-foreground max-h-48 overflow-y-auto"
              data-testid="terminal-logs"
            >
              {logs.map((log, i) => (
                <div key={i} className="mb-1 flex">
                  <span className="text-primary/70 mr-2">&rsaquo;</span>
                  <span className={log.includes("ERROR") ? "text-destructive" : log.includes("COMPLETE") ? "text-green-400" : log.includes("TRI-BUREAU") ? "text-blue-400" : ""}>
                    {log}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ts() {
  return new Date().toISOString().split("T")[1].slice(0, -1);
}
