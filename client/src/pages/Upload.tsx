import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  UploadCloud, Activity, Loader2, CheckCircle2, AlertTriangle, FileText
} from "lucide-react";
import { uploadScanFile } from "@/lib/api";

export default function Upload() {
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadScanFile,
    onMutate: () => {
      setUploadLogs([`[${ts()}] INITIATING UPLOAD...`]);
      setResult(null);
    },
    onSuccess: (data) => {
      setUploadLogs(prev => [
        ...prev,
        `[${ts()}] FILE UPLOADED SUCCESSFULLY.`,
        `[${ts()}] AI ENGINE: Parsing credit report...`,
        `[${ts()}] SCAN CREATED — ID: ${data.scanId}`,
        `[${ts()}] EXTRACTED: ${data.accountsCreated} negative accounts.`,
        `[${ts()}] DETECTED: ${data.violationsFound} potential FCRA violations.`,
        `[${ts()}] ANALYSIS COMPLETE.`,
      ]);
      setResult(data);
    },
    onError: (err: Error) => {
      setUploadLogs(prev => [...prev, `[${ts()}] ERROR: ${err.message}`]);
    },
  });

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  }, [uploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) uploadMutation.mutate(file);
  }, [uploadMutation]);

  const isProcessing = uploadMutation.isPending;

  return (
    <div className="h-full">
      <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-6">
        <h2 className="font-display font-medium text-lg text-white">Upload Credit Report</h2>
      </header>

      <div className="p-6 max-w-3xl mx-auto mt-6 space-y-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm,.pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
          onChange={handleFileChange}
          className="hidden"
          data-testid="input-file-upload"
        />

        {!result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
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
                {isProcessing ? "AI Processing..." : "Upload Credit Report"}
              </h3>
              <p className="text-muted-foreground max-w-md font-mono text-sm">
                {isProcessing
                  ? "Extracting accounts and scanning for FCRA violations..."
                  : "Drag and drop a credit report (HTML, PDF, TXT, or image) or click to browse. AI will extract negative accounts and detect violations automatically."}
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
                      transition={{ duration: 30, ease: "linear" }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 bg-card border border-border rounded-xl p-5">
              <h4 className="font-display text-white text-sm mb-3">How it works</h4>
              <div className="space-y-3">
                {[
                  { step: 1, text: "Upload your credit report file (HTML, PDF, TXT, or image)" },
                  { step: 2, text: "AI extracts all accounts and identifies negative items" },
                  { step: 3, text: "Each account is scanned for FCRA violations" },
                  { step: 4, text: "Review results in the same workflow as manual entry" },
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

        {result && (
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
                onClick={() => { setResult(null); setUploadLogs([]); }}
                className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-white transition-colors font-mono text-sm"
              >
                Upload Another
              </button>
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {uploadLogs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="bg-[#0a0a0c] border border-border rounded-lg p-4 font-mono text-xs text-muted-foreground max-h-48 overflow-y-auto"
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
      </div>
    </div>
  );
}

function ts() {
  return new Date().toISOString().split("T")[1].slice(0, -1);
}
