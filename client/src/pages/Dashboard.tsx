import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText, UploadCloud, ShieldAlert, FileSearch,
  Terminal, Activity, Zap, ChevronRight, BrainCircuit,
  Database, ServerCrash, Trash2, RefreshCw, Clock, CheckCircle2, XCircle, Loader2
} from "lucide-react";
import { uploadReport, fetchReports, fetchReport, deleteReport } from "@/lib/api";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"findings" | "accounts">("findings");
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);

  const { data: reports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: fetchReports,
    refetchInterval: 5000,
  });

  const { data: activeReport, isLoading: reportLoading } = useQuery({
    queryKey: ["report", selectedReportId],
    queryFn: () => fetchReport(selectedReportId!),
    enabled: !!selectedReportId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "processing" ? 3000 : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadReport,
    onMutate: () => {
      setUploadLogs([`[${ts()}] INITIATING UPLOAD...`]);
    },
    onSuccess: (data) => {
      setUploadLogs(prev => [
        ...prev,
        `[${ts()}] FILE UPLOADED SUCCESSFULLY.`,
        `[${ts()}] ANALYSIS STARTED — Report ID: ${data.id}`,
        `[${ts()}] AI ENGINE: Running FCRA violation matrices...`,
      ]);
      setSelectedReportId(data.id);
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (err: Error) => {
      setUploadLogs(prev => [...prev, `[${ts()}] ERROR: ${err.message}`]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteReport,
    onSuccess: () => {
      setSelectedReportId(null);
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  useEffect(() => {
    if (activeReport?.status === "completed" && uploadLogs.length > 0) {
      const findingsCount = activeReport.findings?.length || 0;
      const accountsCount = activeReport.accounts?.length || 0;
      setUploadLogs(prev => {
        if (prev.some(l => l.includes("ANALYSIS COMPLETE"))) return prev;
        return [
          ...prev,
          `[${ts()}] EXTRACTION COMPLETE: ${accountsCount} accounts parsed.`,
          `[${ts()}] ANALYSIS COMPLETE: ${findingsCount} potential violations detected.`,
        ];
      });
    }
  }, [activeReport?.status]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
    e.target.value = "";
  }, [uploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  }, [uploadMutation]);

  const isProcessing = uploadMutation.isPending || activeReport?.status === "processing";
  const showResults = activeReport?.status === "completed";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden selection:bg-primary/30">

      {/* Sidebar */}
      <aside className="w-full md:w-64 border-r border-border bg-card flex flex-col z-10 md:min-h-screen">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <BrainCircuit className="text-primary w-6 h-6" />
          <h1 className="font-display font-bold text-xl tracking-wider text-white">LEXA <span className="text-primary text-sm font-mono ml-1">v2.4</span></h1>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="text-xs font-mono text-muted-foreground mb-4 mt-2 px-2">PREVIOUS REPORTS</div>
          {reportsLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {reports.map((r: any) => (
            <button
              key={r.id}
              data-testid={`report-item-${r.id}`}
              onClick={() => { setSelectedReportId(r.id); setUploadLogs([]); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left group ${
                selectedReportId === r.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-white"
              }`}
            >
              <StatusIcon status={r.status} />
              <div className="flex-1 min-w-0">
                <div className="truncate">{r.consumerName || r.fileName}</div>
                <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</div>
              </div>
              <button
                data-testid={`delete-report-${r.id}`}
                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </button>
          ))}
          {!reportsLoading && reports.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-8 font-mono">No reports yet</div>
          )}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 px-2 py-3 bg-secondary rounded-md border border-border">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_hsl(var(--primary))]" />
            <span className="text-xs font-mono text-muted-foreground">ENGINE: ONLINE</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen relative overflow-hidden">
        <div className="grid-bg absolute inset-0 z-0 opacity-50 pointer-events-none" />

        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-6 z-10 justify-between">
          <h2 className="font-display font-medium text-lg">
            {showResults ? "Analysis Results" : "Active Workspace"}
          </h2>
          {showResults && activeReport?.consumerName && (
            <span className="text-xs font-mono text-muted-foreground border border-border bg-secondary px-2 py-1 rounded">
              Target: {activeReport.consumerName}
            </span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-6 z-10 space-y-6">

          {/* Upload Section */}
          {!showResults && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl mx-auto mt-10"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.pdf,.txt,.csv"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-file-upload"
              />
              <div
                onClick={!isProcessing ? handleFileSelect : undefined}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                data-testid="drop-zone"
                className={`relative border-2 border-dashed ${isProcessing ? 'border-primary' : 'border-border hover:border-primary/50'} rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-card overflow-hidden`}
              >
                {isProcessing && <div className="scan-line" />}

                <div className={`p-4 rounded-full mb-4 ${isProcessing ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                  {isProcessing ? <Activity className="w-8 h-8 animate-pulse" /> : <UploadCloud className="w-8 h-8" />}
                </div>
                <h3 className="font-display text-xl font-medium mb-2 text-white">
                  {isProcessing ? "Agent Processing..." : "Upload Credit Report"}
                </h3>
                <p className="text-muted-foreground max-w-md font-mono text-sm">
                  {isProcessing
                    ? "Neural extraction and FCRA rule matrices engaged."
                    : "Drag and drop a credit report (HTML, PDF, TXT) or click to browse. AI will parse and extract FCRA violations."}
                </p>

                {isProcessing && (
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
                        transition={{ duration: 20, ease: "linear" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {uploadLogs.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-6 bg-[#0a0a0c] border border-border rounded-lg p-4 font-mono text-xs text-muted-foreground max-h-48 overflow-y-auto"
                    data-testid="terminal-logs"
                  >
                    {uploadLogs.map((log, i) => (
                      <div key={i} className="mb-1 flex">
                        <span className="text-primary/70 mr-2">&rsaquo;</span>
                        <span className={log.includes("ERROR") ? "text-destructive" : log.includes("COMPLETE") ? "text-green-400" : ""}>
                          {log}
                        </span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Results Dashboard */}
          {showResults && activeReport && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6 max-w-6xl mx-auto"
            >
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SummaryCard
                  title="Total Violations"
                  value={(activeReport.findings?.length || 0).toString()}
                  icon={ShieldAlert}
                  accent="destructive"
                />
                <SummaryCard
                  title="Severity"
                  value={getSeverityLabel(activeReport.findings)}
                  icon={Activity}
                  accent="primary"
                />
                <SummaryCard
                  title="Accounts Parsed"
                  value={(activeReport.accounts?.length || 0).toString()}
                  icon={FileText}
                  accent="primary"
                />
              </div>

              {/* Tabs + Data */}
              <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col min-h-[500px]">
                <div className="flex border-b border-border">
                  <TabButton active={activeTab === 'findings'} onClick={() => setActiveTab('findings')}>
                    Detected Violations <span className="ml-2 bg-destructive text-white px-1.5 py-0.5 rounded text-[10px]">{activeReport.findings?.length || 0}</span>
                  </TabButton>
                  <TabButton active={activeTab === 'accounts'} onClick={() => setActiveTab('accounts')}>
                    Parsed Accounts
                  </TabButton>
                </div>

                <div className="p-6 flex-1 bg-background/50">
                  {activeTab === 'findings' && (
                    <div className="space-y-4">
                      {activeReport.findings?.length === 0 && (
                        <div className="text-center py-12 text-muted-foreground font-mono">
                          No violations detected in this report.
                        </div>
                      )}
                      {activeReport.findings?.map((finding: any) => (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={finding.id}
                          data-testid={`finding-card-${finding.id}`}
                          className="bg-card border border-border hover:border-destructive/50 transition-colors rounded-lg overflow-hidden group"
                        >
                          <div className="p-5 border-b border-border/50 flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-3 mb-2">
                                <Badge severity={finding.severity} />
                                <h4 className="font-display text-lg text-white group-hover:text-destructive transition-colors">
                                  {finding.findingType}
                                </h4>
                              </div>
                              <p className="text-sm text-muted-foreground font-mono max-w-3xl">
                                {finding.explanation}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0 ml-4">
                              <div className="text-xs font-mono text-muted-foreground mb-1">Target Creditor</div>
                              <div className="font-medium text-white">{finding.creditor}</div>
                            </div>
                          </div>

                          <div className="p-4 bg-secondary/30 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs font-mono text-primary mb-2 flex items-center gap-1">
                                <Zap className="w-3 h-3" /> ACTIONABLE STATUTES
                              </div>
                              <div className="space-y-1">
                                {(finding.fcraTheories || []).map((theory: string, i: number) => (
                                  <div key={i} className="text-sm bg-background border border-border px-3 py-1.5 rounded text-white font-medium">
                                    {theory}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-mono text-primary mb-2 flex items-center gap-1">
                                <ServerCrash className="w-3 h-3" /> EXTRACTED EVIDENCE
                              </div>
                              <div className="space-y-2">
                                {(Array.isArray(finding.evidence) ? finding.evidence : []).map((ev: any, i: number) => (
                                  <div key={i} className="text-xs font-mono bg-background border border-border p-2 rounded text-muted-foreground flex gap-2">
                                    <span className="text-white bg-secondary px-1 py-0.5 rounded flex-shrink-0">{ev.bureau}</span>
                                    <span>{ev.quote}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'accounts' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {activeReport.accounts?.length === 0 && (
                        <div className="col-span-2 text-center py-12 text-muted-foreground font-mono">
                          No accounts extracted from this report.
                        </div>
                      )}
                      {activeReport.accounts?.map((acct: any) => (
                        <div key={acct.id} data-testid={`account-card-${acct.id}`} className="bg-card border border-border rounded-lg p-5">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h4 className="font-display text-lg text-white">{acct.creditor}</h4>
                              <div className="text-sm font-mono text-muted-foreground">{acct.accountNumberMasked || "N/A"}</div>
                            </div>
                            <div className={`px-2 py-1 rounded text-xs font-mono border ${
                              (acct.status || "").toLowerCase().includes('chargeoff') ||
                              (acct.status || "").toLowerCase().includes('derogatory') ||
                              (acct.status || "").toLowerCase().includes('collection')
                                ? 'border-destructive/50 text-destructive bg-destructive/10'
                                : 'border-border text-muted-foreground bg-secondary'
                            }`}>
                              {acct.status || "Unknown"}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                            <div>
                              <span className="text-muted-foreground text-xs block mb-1">Type</span>
                              <span className="text-white">{acct.type || "N/A"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground text-xs block mb-1">Balance</span>
                              <span className="text-white font-mono">${acct.balance || 0}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* New Upload Button */}
              <div className="flex justify-center">
                <button
                  data-testid="button-new-upload"
                  onClick={() => { setSelectedReportId(null); setUploadLogs([]); }}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-secondary border border-border text-muted-foreground hover:text-white hover:bg-secondary/80 transition-colors font-mono text-sm"
                >
                  <UploadCloud className="w-4 h-4" />
                  Analyze Another Report
                </button>
              </div>
            </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}

function ts() {
  return new Date().toISOString().split("T")[1].slice(0, -1);
}

function getSeverityLabel(findings: any[]) {
  if (!findings || findings.length === 0) return "None";
  const hasCritical = findings.some((f: any) => f.severity === "critical");
  const hasHigh = findings.some((f: any) => f.severity === "high");
  if (hasCritical) return "Critical";
  if (hasHigh) return "High";
  return "Medium";
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />;
    case "processing":
      return <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
  }
}

function SummaryCard({ title, value, icon: Icon, accent = "primary" }: any) {
  const isDestructive = accent === "destructive";
  return (
    <div className={`bg-card border ${isDestructive ? 'border-destructive/30' : 'border-border'} rounded-xl p-5 flex flex-col justify-between relative overflow-hidden`}>
      {isDestructive && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-destructive/5 rounded-full blur-3xl -mr-10 -mt-10" />
      )}
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className={`p-2 rounded-lg ${isDestructive ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="relative z-10">
        <div className="text-sm text-muted-foreground font-mono mb-1">{title}</div>
        <div className={`text-4xl font-display ${isDestructive ? 'text-destructive' : 'text-white'}`}>{value}</div>
      </div>
    </div>
  );
}

function TabButton({ children, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-white hover:bg-secondary/50"
      }`}
    >
      {children}
    </button>
  );
}

function Badge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500/20 text-red-500 border-red-500/30",
    high: "bg-orange-500/20 text-orange-500 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
    low: "bg-blue-500/20 text-blue-500 border-blue-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${colors[severity] || colors.medium}`}>
      {severity}
    </span>
  );
}
