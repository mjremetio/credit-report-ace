import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  UploadCloud, Activity, Loader2, CheckCircle2, AlertTriangle, FileText,
  Edit3, ArrowRight, RotateCcw, Eye, Shield, ClipboardCheck, Download,
  Type, User, CreditCard, Building, MapPin, Briefcase, Hash,
  ChevronDown, ChevronUp, Calendar, Code
} from "lucide-react";
import {
  extractFileText, structureExtractedText, structureUploadFile,
  runViolationAnalysis, updateScan,
} from "@/lib/api";

type InputMode = "file" | "text";
type UploadPhase =
  | "idle"
  | "extracting"
  | "reviewing"
  | "structuring"
  | "structured"
  | "analyzing"
  | "complete";

export default function Upload() {
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [structureResult, setStructureResult] = useState<any>(null);
  const [violationResult, setViolationResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Review state
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [isEdited, setIsEdited] = useState(false);

  // Structured JSON display state
  const [organizedReport, setOrganizedReport] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    personalInfo: true,
    scores: true,
    accountSummary: true,
    tradelines: false,
    publicRecords: false,
    inquiries: false,
    collections: false,
    consumerStatements: false,
  });

  // Workflow step definitions — consistent across all phases
  const WORKFLOW_STEPS = [
    { key: "upload", label: "Upload / Input" },
    { key: "review", label: "Review Text" },
    { key: "structure", label: "AI Structuring" },
    { key: "review-data", label: "Review Data" },
    { key: "violations", label: "Violation Analysis" },
    { key: "complete", label: "Complete" },
  ];

  const getActiveStepIndex = (p: UploadPhase): number => {
    switch (p) {
      case "idle": return 0;
      case "extracting": return 0;
      case "reviewing": return 1;
      case "structuring": return 2;
      case "structured": return 3;
      case "analyzing": return 4;
      case "complete": return 5;
      default: return 0;
    }
  };

  const activeStepIndex = getActiveStepIndex(phase);

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
        // Images can't show raw text — go directly to structure
        addLog("IMAGE DETECTED — Skipping text preview, proceeding to AI structuring...");
        if (originalFile) {
          structureUploadMutation.mutate(originalFile);
        }
      } else {
        addLog("TEXT EXTRACTED SUCCESSFULLY.");
        addLog(`FILE: ${data.fileName} (${data.fileType})`);
        addLog(`EXTRACTED ${data.rawText.length.toLocaleString()} characters.`);
        addLog("READY FOR REVIEW — Edit if needed, then proceed to structuring.");
        setRawText(data.rawText);
        setFileName(data.fileName);
        setPhase("reviewing");
      }
    },
    onError: (err: Error) => {
      addLog(`ERROR: ${err.message}`);
      setError(err.message);
      setPhase("idle");
    },
  });

  // For images: structure uploaded file directly
  const structureUploadMutation = useMutation({
    mutationFn: structureUploadFile,
    onMutate: () => {
      setPhase("structuring");
      addLog("AI ENGINE: Structuring image into organized JSON...");
    },
    onSuccess: (data) => {
      addLog(`SCAN CREATED — ID: ${data.scanId}`);
      addLog(`EXTRACTED: ${data.tradelineCount} tradelines.`);
      addLog(`DETECTED: ${data.issueFlagsDetected} issue flags.`);
      addLog("STRUCTURING COMPLETE — Review organized data below.");
      setStructureResult(data);
      setOrganizedReport(data.organizedReport || null);
      autoExpandSections(data.organizedReport);
      setPhase("structured");
    },
    onError: (err: Error) => {
      addLog(`ERROR: ${err.message}`);
      setError(err.message);
      setPhase("idle");
    },
  });

  // Phase 2: Structure extracted text into organized JSON (no violations yet)
  const structureMutation = useMutation({
    mutationFn: ({ text, name }: { text: string; name: string }) =>
      structureExtractedText(text, name),
    onMutate: () => {
      setPhase("structuring");
      setError(null);
      addLog("INITIATING AI STRUCTURING...");
      addLog("AI ENGINE: Converting raw text to organized JSON...");
    },
    onSuccess: (data) => {
      addLog(`SCAN CREATED — ID: ${data.scanId}`);
      addLog(`EXTRACTED: ${data.tradelineCount} tradelines.`);
      addLog(`DETECTED: ${data.issueFlagsDetected} issue flags.`);
      addLog("STRUCTURING COMPLETE — Review organized data below.");
      setStructureResult(data);
      setOrganizedReport(data.organizedReport || null);
      autoExpandSections(data.organizedReport);
      setPhase("structured");
    },
    onError: (err: Error) => {
      addLog(`ERROR: ${err.message}`);
      setError(err.message);
      setPhase("reviewing");
    },
  });

  // Phase 3: Run violation analysis on structured data
  const violationMutation = useMutation({
    mutationFn: (scanId: number) => runViolationAnalysis(scanId),
    onMutate: () => {
      setPhase("analyzing");
      setError(null);
      addLog("INITIATING VIOLATION ANALYSIS...");
      addLog("AI ENGINE: Scanning for FCRA/FDCPA violations...");
    },
    onSuccess: (data) => {
      addLog(`CREATED: ${data.accountsCreated} negative accounts.`);
      addLog(`DETECTED: ${data.violationsFound} potential violations.`);
      addLog("VIOLATION ANALYSIS COMPLETE.");
      setViolationResult(data);
      setPhase("complete");
    },
    onError: (err: Error) => {
      addLog(`ERROR: ${err.message}`);
      setError(err.message);
      setPhase("structured"); // Go back to structured view
    },
  });

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFile = useCallback((file: File) => {
    setOriginalFile(file);
    setStructureResult(null);
    setViolationResult(null);
    setError(null);
    setRawText("");
    setIsEdited(false);
    setOrganizedReport(null);
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

  const handleManualTextSubmit = () => {
    if (rawText.trim().length >= 50) {
      setFileName("manual-input.txt");
      setLogs([`[${ts()}] MANUAL TEXT INPUT — ${rawText.length.toLocaleString()} characters.`]);
      addLog("READY FOR REVIEW — Edit if needed, then proceed to structuring.");
      setPhase("reviewing");
    }
  };

  const handleProceedToStructuring = () => {
    structureMutation.mutate({ text: rawText, name: fileName });
  };

  const handleProceedToViolations = () => {
    if (structureResult?.scanId) {
      violationMutation.mutate(structureResult.scanId);
    }
  };

  const handleReset = () => {
    setPhase("idle");
    setLogs([]);
    setStructureResult(null);
    setViolationResult(null);
    setError(null);
    setRawText("");
    setFileName("");
    setOriginalFile(null);
    setIsEdited(false);
    setOrganizedReport(null);
    setExpandedSections({
      personalInfo: true,
      scores: true,
      accountSummary: true,
      tradelines: false,
      publicRecords: false,
      inquiries: false,
      collections: false,
      consumerStatements: false,
    });
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Auto-expand sections that have data so the user sees extracted content immediately
  const autoExpandSections = (report: any) => {
    if (!report) return;
    setExpandedSections({
      personalInfo: true,
      scores: true,
      accountSummary: true,
      tradelines: (report.accountHistory?.length || 0) > 0,
      collections: (report.collections?.length || 0) > 0,
      publicRecords: (report.publicInformation?.length || 0) > 0,
      inquiries: (report.inquiries?.length || 0) > 0,
      consumerStatements: (report.consumerStatements?.length || 0) > 0,
    });
  };

  return (
    <div className="h-full">
      <header className="h-16 border-b border-border bg-white flex items-center px-6">
        <h2 className="font-display font-medium text-lg text-foreground">Upload Credit Report</h2>
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

        {/* ── IDLE: Input Mode Selection ── */}
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

            {/* Input Mode Tabs */}
            <div className="flex mb-4 border border-border rounded-xl overflow-hidden">
              <button
                data-testid="tab-file-upload"
                onClick={() => { setInputMode("file"); setRawText(""); }}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 font-medium text-sm transition-colors ${
                  inputMode === "file"
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <UploadCloud className="w-4 h-4" />
                File Upload
              </button>
              <button
                data-testid="tab-manual-text"
                onClick={() => { setInputMode("text"); setOriginalFile(null); }}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 font-medium text-sm transition-colors ${
                  inputMode === "text"
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <Type className="w-4 h-4" />
                Paste / Type Text
              </button>
            </div>

            {/* File Upload Mode */}
            {inputMode === "file" && (
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
                <h3 className="font-display text-xl font-medium mb-2 text-foreground">
                  Upload Credit Report File
                </h3>
                <p className="text-muted-foreground max-w-md font-mono text-sm">
                  Drag and drop a credit report (HTML, PDF, TXT, or image) or click to browse.
                  You'll review the extracted data before AI structuring begins.
                </p>
              </div>
            )}

            {/* Manual Text Input Mode */}
            {inputMode === "text" && (
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Type className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg text-foreground">Paste Credit Report Text</h3>
                    <p className="text-xs font-mono text-muted-foreground">
                      Paste or type the raw text from a credit report below
                    </p>
                  </div>
                </div>

                <textarea
                  data-testid="textarea-manual-input"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  rows={14}
                  placeholder={"Paste credit report text here...\n\ne.g.\nConsumer: John Doe\nSSN: XXX-XX-1234\nTransUnion Score: 620\nExperian Score: 635\nEquifax Score: 610\n\nACCOUNT INFORMATION\nCreditor: ABC Collections\nAccount#: ****5678\nType: Collection\nBalance: $1,250\n..."}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/30 font-mono text-xs leading-relaxed focus:outline-none focus:border-primary resize-y min-h-[200px]"
                  spellCheck={false}
                />

                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs font-mono text-muted-foreground">
                    {rawText.length.toLocaleString()} characters
                    {rawText.trim().length > 0 && rawText.trim().length < 50 && (
                      <span className="text-yellow-600 ml-2">(min 50 characters required)</span>
                    )}
                  </span>
                  <button
                    data-testid="button-submit-text"
                    onClick={handleManualTextSubmit}
                    disabled={rawText.trim().length < 50}
                    className="px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
                  >
                    <ArrowRight className="w-4 h-4" />
                    Review & Proceed
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 bg-card border border-border rounded-xl p-5">
              <h4 className="font-display text-foreground text-sm mb-3">Workflow</h4>
              <div className="space-y-3">
                {WORKFLOW_STEPS.map((step, i) => (
                  <div key={step.key} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono flex-shrink-0 ${
                      i === activeStepIndex
                        ? "bg-primary text-primary-foreground"
                        : i < activeStepIndex
                        ? "bg-green-500/20 text-green-600"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      {i < activeStepIndex ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <span className={`text-sm font-mono ${
                      i === activeStepIndex ? "text-primary font-medium" : i < activeStepIndex ? "text-green-600" : "text-muted-foreground"
                    }`}>{step.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Step Progress Indicator (visible during processing & review phases) ── */}
        {phase !== "idle" && (
          <div className="flex items-center gap-1 mb-4">
            {WORKFLOW_STEPS.map((step, i) => (
              <div key={step.key} className="flex items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono transition-all ${
                  i === activeStepIndex
                    ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                    : i < activeStepIndex
                    ? "bg-green-500/20 text-green-600"
                    : "bg-secondary text-muted-foreground"
                }`}>
                  {i < activeStepIndex ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                </div>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <div className={`w-6 h-0.5 mx-0.5 ${i < activeStepIndex ? "bg-green-500/40" : "bg-border"}`} />
                )}
              </div>
            ))}
            <span className="ml-3 text-xs font-mono text-muted-foreground">
              {WORKFLOW_STEPS[activeStepIndex]?.label}
            </span>
          </div>
        )}

        {/* ── EXTRACTING: Progress Animation ── */}
        {phase === "extracting" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="relative border-2 border-dashed border-primary rounded-xl p-12 flex flex-col items-center justify-center text-center bg-card overflow-hidden">
              <div className="p-4 rounded-full mb-4 bg-primary/20 text-primary">
                <Activity className="w-8 h-8 animate-pulse" />
              </div>
              <h3 className="font-display text-xl font-medium mb-2 text-foreground">
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

        {/* ── REVIEWING: Show raw text with edit capability ── */}
        {phase === "reviewing" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="bg-card border border-primary/30 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Eye className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg text-foreground">Review Extracted Data</h3>
                    <p className="text-xs font-mono text-muted-foreground">
                      {fileName} — {rawText.length.toLocaleString()} characters extracted
                    </p>
                  </div>
                </div>
                {isEdited && (
                  <span className="text-xs font-mono px-2 py-1 rounded border border-yellow-500/30 text-yellow-600 bg-yellow-500/10">
                    <Edit3 className="w-3 h-3 inline mr-1" />edited
                  </span>
                )}
              </div>

              <p className="text-xs font-mono text-muted-foreground mb-3">
                This is the raw text extracted from your credit report. Review it to ensure accuracy.
                You can edit any details below before proceeding to AI structuring.
              </p>

              <textarea
                data-testid="textarea-raw-extracted"
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setIsEdited(true);
                }}
                rows={20}
                className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 font-mono text-xs leading-relaxed focus:outline-none focus:border-primary resize-y min-h-[200px]"
                spellCheck={false}
              />

              <div className="flex items-center justify-between mt-3 text-xs font-mono text-muted-foreground">
                <span>{rawText.split("\n").length} lines</span>
                <span>{rawText.length.toLocaleString()} chars</span>
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
                data-testid="button-proceed-structuring"
                onClick={handleProceedToStructuring}
                disabled={rawText.trim().length < 50}
                className="flex-1 px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                Structure into JSON
              </button>
              <button
                data-testid="button-start-over"
                onClick={handleReset}
                className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors font-mono text-sm inline-flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Start Over
              </button>
            </div>
          </motion.div>
        )}

        {/* ── STRUCTURING: AI Processing Progress ── */}
        {phase === "structuring" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="relative border-2 border-dashed border-primary rounded-xl p-12 flex flex-col items-center justify-center text-center bg-card overflow-hidden">
              <div className="p-4 rounded-full mb-4 bg-primary/20 text-primary">
                <Activity className="w-8 h-8 animate-pulse" />
              </div>
              <h3 className="font-display text-xl font-medium mb-2 text-foreground">
                Structuring Report...
              </h3>
              <p className="text-muted-foreground max-w-md font-mono text-sm">
                Converting raw text to structured JSON — extracting scores, personal info, bureau summary, tradelines, public records, inquiries...
              </p>
              <div className="w-full max-w-md mt-8">
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-primary">Structuring...</span>
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                </div>
                <div className="h-1 bg-secondary w-full rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: "0%" }}
                    animate={{ width: "95%" }}
                    transition={{ duration: 45, ease: "linear" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── STRUCTURED: Display Organized JSON ── */}
        {phase === "structured" && structureResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Consumer Name Header */}
            <div className="bg-card border border-primary/30 rounded-xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Consumer</p>
                  <h3 className="font-display text-2xl text-foreground" data-testid="consumer-name-display">
                    {organizedReport?.personalInformation?.name || structureResult.consumerName || "Unknown Consumer"}
                  </h3>
                  {organizedReport?.personalInformation?.aliases?.length > 0 && (
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      Also known as: {organizedReport.personalInformation.aliases.join(", ")}
                    </p>
                  )}
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background/50 border border-border rounded-lg p-3 text-center">
                  <div className="text-2xl font-display text-foreground">{structureResult.tradelineCount}</div>
                  <div className="text-xs font-mono text-muted-foreground mt-1">Tradelines</div>
                </div>
                <div className="bg-background/50 border border-border rounded-lg p-3 text-center">
                  <div className="text-2xl font-display text-foreground">{structureResult.issueFlagsDetected || 0}</div>
                  <div className="text-xs font-mono text-muted-foreground mt-1">Issue Flags</div>
                </div>
              </div>

              <p className="text-xs font-mono text-muted-foreground mt-3 text-center">
                Structured JSON created. Review the data below, then proceed to violation analysis.
              </p>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                <p className="text-sm font-mono text-destructive">{error}</p>
              </div>
            )}

            {/* Structured JSON Sections */}
            {organizedReport ? (
              <>
                {/* Personal Information */}
                <StructuredSection
                  title="Personal Information"
                  icon={<User className="w-4 h-4 text-primary" />}
                  expanded={expandedSections.personalInfo}
                  onToggle={() => toggleSection("personalInfo")}
                  testId="section-personal-info"
                >
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <InfoField label="Full Name" value={organizedReport.personalInformation?.name} icon={<User className="w-3 h-3" />} />
                      <InfoField label="SSN" value={organizedReport.personalInformation?.ssn} icon={<Hash className="w-3 h-3" />} />
                      <InfoField label="Report Date" value={organizedReport.personalInformation?.reportDate} icon={<Calendar className="w-3 h-3" />} />
                    </div>

                    {/* Date of Birth - Tri-Bureau */}
                    <div>
                      <p className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Date of Birth
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                          const perBureau = organizedReport.personalInformation?.dateOfBirthPerBureau;
                          const entry = perBureau?.find((e: any) => e.bureau === bureau);
                          const value = entry?.value || null;
                          return (
                            <div key={bureau} className="bg-background/30 border border-border rounded-lg p-2 text-center">
                              <p className="text-[10px] font-mono text-muted-foreground mb-0.5">{bureau}</p>
                              <p className={`text-xs font-mono ${value ? "text-foreground" : "text-muted-foreground/50"}`}>
                                {value || "--"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {organizedReport.personalInformation?.addresses?.length > 0 && (
                      <div>
                        <p className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Addresses
                        </p>
                        <div className="space-y-1">
                          {organizedReport.personalInformation.addresses.map((addr: any, i: number) => (
                            <div key={i} className="bg-background/30 rounded px-3 py-2 text-xs font-mono text-foreground flex items-center justify-between">
                              <span>{addr.address}</span>
                              <span className="text-muted-foreground text-[10px]">{addr.bureaus?.join(", ")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {organizedReport.personalInformation?.employers?.length > 0 && (
                      <div>
                        <p className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-1">
                          <Briefcase className="w-3 h-3" /> Employers
                        </p>
                        <div className="space-y-1">
                          {organizedReport.personalInformation.employers.map((emp: any, i: number) => (
                            <div key={i} className="bg-background/30 rounded px-3 py-2 text-xs font-mono text-foreground flex items-center justify-between">
                              <span>{emp.name}</span>
                              <span className="text-muted-foreground text-[10px]">{emp.bureaus?.join(", ")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </StructuredSection>

                {/* Credit Scores */}
                <StructuredSection
                  title="Credit Scores"
                  icon={<CreditCard className="w-4 h-4 text-primary" />}
                  expanded={expandedSections.scores}
                  onToggle={() => toggleSection("scores")}
                  testId="section-credit-scores"
                >
                  <div className="grid grid-cols-3 gap-3">
                    {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                      const scoreData = organizedReport.creditScores?.[bureau];
                      return (
                        <div key={bureau} className="bg-background/30 border border-border rounded-lg p-4 text-center">
                          <p className="text-xs font-mono text-muted-foreground mb-1">{bureau}</p>
                          <p className={`text-3xl font-display ${scoreData?.score ? "text-foreground" : "text-muted-foreground/50"}`}>
                            {scoreData?.score ?? "N/A"}
                          </p>
                          {scoreData?.model && (
                            <p className="text-[10px] font-mono text-muted-foreground mt-1">{scoreData.model}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </StructuredSection>

                {/* Account Summary - Tri-Bureau */}
                <StructuredSection
                  title="Account Summary"
                  icon={<FileText className="w-4 h-4 text-primary" />}
                  expanded={expandedSections.accountSummary}
                  onToggle={() => toggleSection("accountSummary")}
                  testId="section-account-summary"
                >
                  <TriBureauSummaryTable
                    perBureau={organizedReport.accountSummary?.perBureau || []}
                    collectionAccounts={organizedReport.accountSummary?.collectionAccounts}
                    publicRecordCount={organizedReport.accountSummary?.publicRecordCount}
                  />
                </StructuredSection>

                {/* Account History / Tradelines */}
                <StructuredSection
                  title={`Account History (${organizedReport.accountHistory?.length || 0})`}
                  icon={<FileText className="w-4 h-4 text-primary" />}
                  expanded={expandedSections.tradelines}
                  onToggle={() => toggleSection("tradelines")}
                  testId="section-tradelines"
                >
                  {organizedReport.accountHistory?.length > 0 ? (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {organizedReport.accountHistory.map((tl: any, i: number) => (
                        <TradelineRow key={i} tradeline={tl} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs font-mono text-muted-foreground">No account history found.</p>
                  )}
                </StructuredSection>

                {/* Collections */}
                {organizedReport.collections?.length > 0 && (
                  <StructuredSection
                    title={`Collections (${organizedReport.collections.length})`}
                    icon={<AlertTriangle className="w-4 h-4 text-destructive" />}
                    expanded={expandedSections.collections}
                    onToggle={() => toggleSection("collections")}
                    testId="section-collections"
                  >
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {organizedReport.collections.map((tl: any, i: number) => (
                        <TradelineRow key={i} tradeline={tl} />
                      ))}
                    </div>
                  </StructuredSection>
                )}

                {/* Public Records */}
                <StructuredSection
                  title={`Public Records (${organizedReport.publicInformation?.length || 0})`}
                  icon={<Building className="w-4 h-4 text-primary" />}
                  expanded={expandedSections.publicRecords}
                  onToggle={() => toggleSection("publicRecords")}
                  testId="section-public-records"
                >
                  {organizedReport.publicInformation?.length > 0 ? (
                    <div className="space-y-2">
                      {organizedReport.publicInformation.map((pr: any, i: number) => (
                        <div key={i} className="bg-background/30 border border-border rounded-lg p-3 text-xs font-mono">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-foreground font-medium">{pr.type}</span>
                          </div>
                          {/* Per-bureau reporting status */}
                          <div className="flex gap-2 mb-2">
                            {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                              const isReported = pr.bureaus?.includes(bureau);
                              return (
                                <div key={bureau} className={`px-2 py-1 rounded text-[10px] border ${isReported ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground/40 border-border"}`}>
                                  {bureau}: {isReported ? "Reported" : "Not Reported"}
                                </div>
                              );
                            })}
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                            {pr.court && <p>Court: {pr.court}</p>}
                            {pr.caseNumber && <p>Case #: {pr.caseNumber}</p>}
                            {pr.dateFiled && <p>Filed: {pr.dateFiled}</p>}
                            {pr.dateDischarged && <p>Discharged: {pr.dateDischarged}</p>}
                            {pr.amount != null && <p>Amount: ${pr.amount?.toLocaleString()}</p>}
                          </div>
                          {pr.remarks?.length > 0 && (
                            <div className="mt-1">
                              {pr.remarks.map((r: string, ri: number) => (
                                <p key={ri} className="text-[10px] text-muted-foreground">- {r}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs font-mono text-muted-foreground">No public records found.</p>
                  )}
                </StructuredSection>

                {/* Inquiries */}
                <StructuredSection
                  title={`Inquiries (${organizedReport.inquiries?.length || 0})`}
                  icon={<Eye className="w-4 h-4 text-primary" />}
                  expanded={expandedSections.inquiries}
                  onToggle={() => toggleSection("inquiries")}
                  testId="section-inquiries"
                >
                  {organizedReport.inquiries?.length > 0 ? (
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                      {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                        const bureauInquiries = organizedReport.inquiries.filter((inq: any) => inq.bureau === bureau);
                        if (bureauInquiries.length === 0) return null;
                        return (
                          <div key={bureau}>
                            <p className="text-[10px] font-mono text-primary font-medium mb-1">{bureau} ({bureauInquiries.length})</p>
                            <div className="space-y-1">
                              {bureauInquiries.map((inq: any, i: number) => (
                                <div key={i} className="bg-background/30 rounded px-3 py-2 text-xs font-mono flex items-center justify-between">
                                  <span className="text-foreground">{inq.creditorName}</span>
                                  <div className="flex items-center gap-3">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                      inq.type === "hard"
                                        ? "bg-destructive/10 text-destructive border border-destructive/30"
                                        : "bg-secondary text-muted-foreground border border-border"
                                    }`}>
                                      {inq.type}
                                    </span>
                                    <span className="text-muted-foreground">{inq.date}</span>
                                    {inq.permissiblePurpose && (
                                      <span className="text-muted-foreground text-[10px]">{inq.permissiblePurpose}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs font-mono text-muted-foreground">No inquiries found.</p>
                  )}
                </StructuredSection>

                {/* Consumer Statements */}
                {organizedReport.consumerStatements?.length > 0 && (
                  <StructuredSection
                    title={`Consumer Statements (${organizedReport.consumerStatements.length})`}
                    icon={<FileText className="w-4 h-4 text-primary" />}
                    expanded={expandedSections.consumerStatements}
                    onToggle={() => toggleSection("consumerStatements")}
                    testId="section-consumer-statements"
                  >
                    <div className="space-y-2">
                      {organizedReport.consumerStatements.map((stmt: any, i: number) => (
                        <div key={i} className="bg-background/30 border border-border rounded-lg p-3 text-xs font-mono">
                          <div className="flex justify-between mb-1">
                            <span className="text-primary">{stmt.bureau}</span>
                            {stmt.dateAdded && <span className="text-muted-foreground">{stmt.dateAdded}</span>}
                          </div>
                          <p className="text-foreground">{stmt.statement}</p>
                        </div>
                      ))}
                    </div>
                  </StructuredSection>
                )}
              </>
            ) : (
              <div className="bg-card border border-border rounded-xl p-5 text-center">
                <p className="text-xs font-mono text-muted-foreground">
                  Structured report data not available.
                </p>
              </div>
            )}

            {/* Raw JSON Viewer */}
            {organizedReport && (
              <JsonViewer data={organizedReport} />
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                data-testid="button-run-violations"
                onClick={handleProceedToViolations}
                className="flex-1 px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Run Violation Analysis
              </button>
              <button
                data-testid="button-start-over-structured"
                onClick={handleReset}
                className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors font-mono text-sm inline-flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Start Over
              </button>
            </div>
          </motion.div>
        )}

        {/* ── ANALYZING: Violation Analysis Progress ── */}
        {phase === "analyzing" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="relative border-2 border-dashed border-primary rounded-xl p-12 flex flex-col items-center justify-center text-center bg-card overflow-hidden">
              <div className="p-4 rounded-full mb-4 bg-destructive/20 text-destructive">
                <Shield className="w-8 h-8 animate-pulse" />
              </div>
              <h3 className="font-display text-xl font-medium mb-2 text-foreground">
                Running Violation Analysis...
              </h3>
              <p className="text-muted-foreground max-w-md font-mono text-sm">
                Scanning structured data for FCRA/FDCPA violations across all negative tradelines...
              </p>
              <div className="w-full max-w-md mt-8">
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-destructive">Detecting violations...</span>
                  <Loader2 className="w-3 h-3 animate-spin text-destructive" />
                </div>
                <div className="h-1 bg-secondary w-full rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-destructive"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 60, ease: "linear" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── COMPLETE: Results with Navigation ── */}
        {phase === "complete" && structureResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-green-500/30 rounded-xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
                <div className="flex-1">
                  <h3 className="font-display text-xl text-foreground">Analysis Complete</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <User className="w-4 h-4 text-primary" />
                    <span className="text-foreground font-display text-lg" data-testid="consumer-name-complete">
                      {organizedReport?.personalInformation?.name || structureResult.consumerName || "Unknown Consumer"}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-xs font-mono text-muted-foreground">
                Structured JSON created and violation analysis complete.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="p-2 rounded-lg bg-primary/10 inline-block mb-3">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="text-3xl font-display text-foreground">{structureResult.tradelineCount}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Tradelines Extracted</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="p-2 rounded-lg bg-destructive/10 inline-block mb-3">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                </div>
                <div className="text-3xl font-display text-foreground">{violationResult?.violationsFound || 0}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Violations Detected</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="p-2 rounded-lg bg-yellow-500/10 inline-block mb-3">
                  <Shield className="w-5 h-5 text-yellow-600" />
                </div>
                <div className="text-3xl font-display text-foreground">{structureResult.issueFlagsDetected || 0}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">Issue Flags</div>
              </div>
            </div>

            {/* Next Steps in Workflow */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h4 className="font-display text-foreground text-sm mb-3">Workflow Progress</h4>
              <div className="space-y-2 text-xs font-mono">
                {WORKFLOW_STEPS.map((step, i) => {
                  const isComplete = i < activeStepIndex;
                  const isCurrent = i === activeStepIndex;
                  return (
                    <div key={step.key} className="flex items-center gap-2">
                      {isComplete ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      ) : isCurrent ? (
                        <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-border flex-shrink-0" />
                      )}
                      <span className={
                        isComplete ? "text-green-600" : isCurrent ? "text-primary font-medium" : "text-muted-foreground/50"
                      }>{step.label}</span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 mt-1 pt-1 border-t border-border/50">
                  <ClipboardCheck className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-primary font-medium">Next: Paralegal review & export</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                data-testid="button-view-review"
                onClick={() => navigate(`/review/${structureResult.scanId}`)}
                className="flex-1 px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2"
              >
                <ClipboardCheck className="w-4 h-4" />
                Paralegal Review
              </button>
              <button
                data-testid="button-view-structured"
                onClick={() => setPhase("structured")}
                className="px-6 py-3 bg-secondary border border-primary/30 text-primary rounded-lg hover:bg-primary/10 transition-colors font-mono text-sm inline-flex items-center gap-2"
              >
                <Eye className="w-4 h-4" />
                View Structured Data
              </button>
              <button
                data-testid="button-view-scan"
                onClick={() => navigate(`/scan/${structureResult.scanId}`)}
                className="px-6 py-3 bg-secondary border border-border text-foreground rounded-lg hover:bg-secondary/80 transition-colors font-mono text-sm inline-flex items-center gap-2"
              >
                View Scan Details
              </button>
              <button
                data-testid="button-upload-another"
                onClick={handleReset}
                className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors font-mono text-sm"
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
              className="bg-secondary border border-border rounded-lg p-4 font-mono text-xs text-muted-foreground max-h-48 overflow-y-auto"
              data-testid="terminal-logs"
            >
              {logs.map((log, i) => (
                <div key={i} className="mb-1 flex">
                  <span className="text-primary/70 mr-2">&rsaquo;</span>
                  <span className={log.includes("ERROR") ? "text-destructive" : log.includes("COMPLETE") ? "text-green-600" : ""}>
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

// ── Helper Components ──────────────────────────────────────────────

function StructuredSection({
  title, icon, expanded, onToggle, children, testId,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden" data-testid={testId}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-display text-sm text-foreground">{title}</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InfoField({
  label, value, icon,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-background/30 rounded-lg px-3 py-2">
      <p className="text-[10px] font-mono text-muted-foreground flex items-center gap-1 mb-0.5">
        {icon} {label}
      </p>
      <p className="text-xs font-mono text-foreground">{value || "N/A"}</p>
    </div>
  );
}

function SummaryCard({
  label, value, highlight,
}: {
  label: string;
  value: string | number | null | undefined;
  highlight?: boolean;
}) {
  return (
    <div className="bg-background/30 border border-border rounded-lg p-3 text-center">
      <div className={`text-xl font-display ${highlight ? "text-destructive" : "text-foreground"}`}>
        {value ?? 0}
      </div>
      <div className="text-[10px] font-mono text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function TriBureauSummaryTable({
  perBureau,
  collectionAccounts,
  publicRecordCount,
}: {
  perBureau: any[];
  collectionAccounts?: number;
  publicRecordCount?: number;
}) {
  const bureauNames = ["TransUnion", "Experian", "Equifax"] as const;

  // Smart-detect which bureaus have data
  const getBureauData = (bureau: string) =>
    perBureau.find((bs: any) => bs.bureau === bureau) || null;

  const rows: Array<{ label: string; key: string; format?: "currency"; highlight?: boolean }> = [
    { label: "Total Accounts", key: "totalAccounts" },
    { label: "Open Accounts", key: "openAccounts" },
    { label: "Closed Accounts", key: "closedAccounts" },
    { label: "Delinquent", key: "delinquentCount", highlight: true },
    { label: "Derogatory", key: "derogatoryCount", highlight: true },
    { label: "Collections", key: "collectionsCount", highlight: true },
    { label: "Public Records", key: "publicRecordsCount" },
    { label: "Inquiries (2yr)", key: "inquiriesCount" },
    { label: "Total Balance", key: "balanceTotal", format: "currency" },
    { label: "Credit Limit", key: "creditLimitTotal", format: "currency" },
    { label: "Monthly Payment", key: "monthlyPaymentTotal", format: "currency" },
  ];

  const formatValue = (val: any, format?: string) => {
    if (val == null || val === undefined) return "--";
    if (format === "currency") return `$${Number(val).toLocaleString()}`;
    return String(val);
  };

  if (perBureau.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-xs font-mono text-muted-foreground">No per-bureau summary data available.</p>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {collectionAccounts != null && <SummaryCard label="Collections" value={collectionAccounts} highlight />}
          {publicRecordCount != null && <SummaryCard label="Public Records" value={publicRecordCount} />}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-2 text-muted-foreground font-normal w-1/4"></th>
            {bureauNames.map(bureau => {
              const hasData = !!getBureauData(bureau);
              return (
                <th key={bureau} className={`text-center py-2 px-2 font-medium ${hasData ? "text-primary" : "text-muted-foreground/50"}`}>
                  {bureau}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className="border-b border-border/50">
              <td className="py-1.5 px-2 text-muted-foreground">{row.label}</td>
              {bureauNames.map(bureau => {
                const data = getBureauData(bureau);
                const val = data ? data[row.key] : null;
                const formatted = formatValue(val, row.format);
                const isBlank = formatted === "--";
                return (
                  <td
                    key={bureau}
                    className={`text-center py-1.5 px-2 ${
                      isBlank ? "text-muted-foreground/40" :
                      row.highlight && val > 0 ? "text-destructive font-medium" :
                      "text-foreground"
                    }`}
                  >
                    {formatted}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradelineRow({ tradeline }: { tradeline: any }) {
  const [expanded, setExpanded] = useState(false);
  const statusColors: Record<string, string> = {
    current: "text-green-600 bg-green-500/10 border-green-500/30",
    closed: "text-muted-foreground bg-secondary border-border",
    paid: "text-green-600 bg-green-500/10 border-green-500/30",
    late: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
    chargeoff: "text-destructive bg-destructive/10 border-destructive/30",
    collection: "text-destructive bg-destructive/10 border-destructive/30",
    derogatory: "text-destructive bg-destructive/10 border-destructive/30",
    repossession: "text-destructive bg-destructive/10 border-destructive/30",
  };

  const statusClass = statusColors[tradeline.aggregateStatus] || "text-muted-foreground bg-secondary border-border";
  const bureauDetails: any[] = tradeline.bureauDetails || [];
  const allBureaus = ["TransUnion", "Experian", "Equifax"] as const;

  // Smart-detect which bureaus report this account
  const getBureauDetail = (bureau: string) =>
    bureauDetails.find((bd: any) => bd.bureau === bureau) || null;

  // Determine which bureaus are present
  const reportedBureaus = allBureaus.filter(b =>
    (tradeline.bureaus || []).includes(b) || getBureauDetail(b)
  );

  // Define the fields to show in the tri-bureau detail view
  const detailFields: Array<{ label: string; key: string; format?: "currency" | "date" }> = [
    { label: "Account #", key: "accountNumber" },
    { label: "Status", key: "status" },
    { label: "Balance", key: "balance", format: "currency" },
    { label: "Credit Limit", key: "creditLimit", format: "currency" },
    { label: "High Balance", key: "highBalance", format: "currency" },
    { label: "Monthly Payment", key: "monthlyPayment", format: "currency" },
    { label: "Past Due", key: "pastDueAmount", format: "currency" },
    { label: "Date Opened", key: "dateOpened", format: "date" },
    { label: "Date Closed", key: "dateClosed", format: "date" },
    { label: "Last Payment", key: "lastPaymentDate", format: "date" },
    { label: "Last Reported", key: "lastReportedDate", format: "date" },
    { label: "Payment Status", key: "paymentStatus" },
    { label: "Account Rating", key: "accountRating" },
    { label: "Creditor Type", key: "creditorType" },
    { label: "Terms", key: "terms" },
  ];

  const formatDetailValue = (val: any, format?: string) => {
    if (val == null || val === undefined || val === "") return null;
    if (format === "currency") return `$${Number(val).toLocaleString()}`;
    return String(val);
  };

  // Filter to only show fields where at least one bureau has data
  const activeFields = detailFields.filter(field =>
    allBureaus.some(b => {
      const detail = getBureauDetail(b);
      return detail && formatDetailValue(detail[field.key], field.format) !== null;
    })
  );

  return (
    <div className="bg-background/30 border border-border rounded-lg text-xs font-mono">
      <button
        className="w-full p-3 text-left hover:bg-secondary/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-foreground font-medium">{tradeline.creditorName}</span>
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${statusClass}`}>
              {tradeline.aggregateStatus}
            </span>
            {bureauDetails.length > 0 && (
              expanded
                ? <ChevronUp className="w-3 h-3 text-muted-foreground" />
                : <ChevronDown className="w-3 h-3 text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          {tradeline.accountNumberMasked && <span>#{tradeline.accountNumberMasked}</span>}
          <span>{tradeline.accountType}</span>
          {tradeline.balance != null && <span>${tradeline.balance.toLocaleString()}</span>}
          <span className="ml-auto text-[10px]">{reportedBureaus.join(", ")}</span>
        </div>
      </button>

      {/* Expanded tri-bureau detail view */}
      {expanded && bureauDetails.length > 0 && (
        <div className="px-3 pb-3 border-t border-border/50">
          <div className="overflow-x-auto mt-2">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-1 px-1 text-muted-foreground font-normal w-1/4"></th>
                  {allBureaus.map(bureau => {
                    const hasDetail = !!getBureauDetail(bureau);
                    const isReported = reportedBureaus.includes(bureau);
                    return (
                      <th
                        key={bureau}
                        className={`text-center py-1 px-1 font-medium text-[10px] ${
                          hasDetail ? "text-primary" :
                          isReported ? "text-muted-foreground" :
                          "text-muted-foreground/30"
                        }`}
                      >
                        {bureau}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activeFields.map(field => (
                  <tr key={field.key} className="border-b border-border/30">
                    <td className="py-1 px-1 text-muted-foreground text-[10px]">{field.label}</td>
                    {allBureaus.map(bureau => {
                      const detail = getBureauDetail(bureau);
                      const val = detail ? formatDetailValue(detail[field.key], field.format) : null;
                      return (
                        <td
                          key={bureau}
                          className={`text-center py-1 px-1 text-[10px] ${
                            val ? "text-foreground" : "text-muted-foreground/30"
                          }`}
                        >
                          {val || "--"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Two-Year Payment History per Bureau */}
          {allBureaus.some(b => {
            const detail = getBureauDetail(b);
            return detail?.paymentHistory && detail.paymentHistory.length > 0;
          }) && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-muted-foreground font-medium mb-2">Two-Year Payment History</p>
              {allBureaus.map(bureau => {
                const detail = getBureauDetail(bureau);
                const history = detail?.paymentHistory || [];
                if (history.length === 0) return null;
                return (
                  <div key={bureau} className="mb-2">
                    <p className="text-[10px] font-mono text-primary mb-1">{bureau}</p>
                    <div className="flex flex-wrap gap-0.5">
                      {history.map((entry: any, idx: number) => {
                        const code = entry.code || "--";
                        const isOk = code === "C" || code === "OK";
                        const isLate = /^(30|60|90|120|150)$/.test(code);
                        const isSevere = code === "CO" || code === "CL" || code === "BK";
                        const bgClass = isOk
                          ? "bg-green-500/20 text-green-600 border-green-500/30"
                          : isLate
                          ? "bg-yellow-500/20 text-yellow-700 border-yellow-500/30"
                          : isSevere
                          ? "bg-destructive/20 text-destructive border-destructive/30"
                          : "bg-secondary text-muted-foreground border-border";
                        return (
                          <div
                            key={idx}
                            className={`px-1 py-0.5 rounded border text-[9px] font-mono text-center min-w-[36px] ${bgClass}`}
                            title={`${entry.month}: ${code}`}
                          >
                            <div className="leading-tight">{isOk ? "OK" : code}</div>
                            <div className="text-[7px] opacity-70">{entry.month?.slice(5) || ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Days Late - 7 Year History per Bureau */}
          {allBureaus.some(b => {
            const detail = getBureauDetail(b);
            return detail?.daysLate7Year;
          }) && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-muted-foreground font-medium mb-2">Days Late - 7 Year History</p>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 px-1 text-muted-foreground font-normal text-[10px] w-1/4"></th>
                    {allBureaus.map(bureau => (
                      <th key={bureau} className={`text-center py-1 px-1 font-medium text-[10px] ${getBureauDetail(bureau)?.daysLate7Year ? "text-primary" : "text-muted-foreground/30"}`}>
                        {bureau}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["30", "60", "90"] as const).map(days => (
                    <tr key={days} className="border-b border-border/30">
                      <td className="py-1 px-1 text-muted-foreground text-[10px]">{days} Days</td>
                      {allBureaus.map(bureau => {
                        const detail = getBureauDetail(bureau);
                        const val = detail?.daysLate7Year?.[days];
                        return (
                          <td key={bureau} className={`text-center py-1 px-1 text-[10px] ${val != null ? (val > 0 ? "text-destructive font-medium" : "text-foreground") : "text-muted-foreground/30"}`}>
                            {val != null ? val : "--"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Per-bureau remarks */}
          {allBureaus.map(bureau => {
            const detail = getBureauDetail(bureau);
            const remarks = detail?.remarks || [];
            if (remarks.length === 0) return null;
            return (
              <div key={bureau} className="mt-2">
                <p className="text-[10px] text-primary font-medium">{bureau} Remarks:</p>
                {remarks.map((r: string, ri: number) => (
                  <p key={ri} className="text-[10px] text-muted-foreground ml-2">- {r}</p>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JsonViewer({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const jsonStr = JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-primary" />
          <span className="font-display text-sm text-foreground">Raw JSON</span>
          <span className="text-[10px] font-mono text-muted-foreground">({(jsonStr.length / 1024).toFixed(1)} KB)</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">
              <div className="flex justify-end mb-2">
                <button
                  onClick={handleCopy}
                  className="px-3 py-1 text-[10px] font-mono bg-secondary border border-border rounded hover:bg-secondary/80 transition-colors text-muted-foreground"
                >
                  {copied ? "Copied!" : "Copy JSON"}
                </button>
              </div>
              <pre className="bg-background/50 border border-border rounded-lg p-4 overflow-auto max-h-[500px] text-[11px] font-mono text-foreground whitespace-pre-wrap break-words">
                {jsonStr}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ts() {
  return new Date().toISOString().split("T")[1].slice(0, -1);
}
