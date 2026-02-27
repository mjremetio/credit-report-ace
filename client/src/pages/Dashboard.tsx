import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  FileText, UploadCloud, ShieldAlert, FileSearch, 
  Terminal, Activity, Zap, CheckCircle2, AlertTriangle,
  ChevronRight, BrainCircuit, Database, ServerCrash
} from "lucide-react";
import { mockReportData } from "@/lib/mock-data";

export default function Dashboard() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [reportLoaded, setReportLoaded] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"findings" | "accounts" | "raw">("findings");

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toISOString().split('T')[1].slice(0, -1)}] ${msg}`]);
  };

  const handleSimulateUpload = () => {
    setIsScanning(true);
    setReportLoaded(false);
    setLogs([]);
    setScanProgress(0);

    const sequence = [
      { p: 10, msg: "INITIATING PARSER: PDF/HTML extraction engine...", time: 500 },
      { p: 25, msg: "INGESTING: David Renteria-Heaven.html", time: 1200 },
      { p: 40, msg: "CLASSIFYING PAGES: Consumer Info, Tradelines, Public Records identified.", time: 2000 },
      { p: 55, msg: "EXTRACTING: Cross-referencing TU, EX, EQ data structures...", time: 3000 },
      { p: 70, msg: "RULE ENGINE: Running FCRA violation matrices...", time: 4200 },
      { p: 85, msg: "FLAGGING: Detected Balance Mismatch (Rule: BALANCE_MISMATCH_CROSS_BUREAU)", time: 5000 },
      { p: 95, msg: "FLAGGING: Detected Dispute Inconsistency (Rule: STATUS_DISPUTE_INCONSISTENCY)", time: 5800 },
      { p: 100, msg: "ANALYSIS COMPLETE: 4 potential actionable items found.", time: 6500 }
    ];

    sequence.forEach(({ p, msg, time }) => {
      setTimeout(() => {
        setScanProgress(p);
        addLog(msg);
        if (p === 100) {
          setTimeout(() => {
            setIsScanning(false);
            setReportLoaded(true);
          }, 800);
        }
      }, time);
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden selection:bg-primary/30">
      
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-r border-border bg-card flex flex-col z-10">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <BrainCircuit className="text-primary w-6 h-6" />
          <h1 className="font-display font-bold text-xl tracking-wider text-white">LEXA <span className="text-primary text-sm font-mono ml-1">v2.4</span></h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <div className="text-xs font-mono text-muted-foreground mb-4 mt-2 px-2">AGENT MODULES</div>
          <SidebarItem icon={FileSearch} label="Report Analyzer" active />
          <SidebarItem icon={Database} label="Case Packets" />
          <SidebarItem icon={Terminal} label="Rule Config" />
          <SidebarItem icon={Activity} label="System Status" />
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
          <h2 className="font-display font-medium text-lg">Active Workspace</h2>
          {reportLoaded && (
            <div className="flex items-center gap-2">
               <span className="text-xs font-mono text-muted-foreground border border-border bg-secondary px-2 py-1 rounded">
                 Target: {mockReportData.consumer_identifiers.names[0]}
               </span>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-6 z-10 space-y-6">
          
          {/* Upload / Scanner Section */}
          {!reportLoaded && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl mx-auto mt-10"
            >
              <div 
                onClick={!isScanning ? handleSimulateUpload : undefined}
                className={`relative border-2 border-dashed ${isScanning ? 'border-primary' : 'border-border hover:border-primary/50'} rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-card overflow-hidden`}
              >
                {isScanning && <div className="scan-line" />}
                
                <div className={`p-4 rounded-full mb-4 ${isScanning ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                  {isScanning ? <Activity className="w-8 h-8 animate-pulse" /> : <UploadCloud className="w-8 h-8" />}
                </div>
                <h3 className="font-display text-xl font-medium mb-2 text-white">
                  {isScanning ? "Agent Processing..." : "Initialize Analysis"}
                </h3>
                <p className="text-muted-foreground max-w-md font-mono text-sm">
                  {isScanning 
                    ? "Neural extraction and FCRA rule matrices engaged."
                    : "Drag and drop credit report (PDF/HTML) or click to trigger AI parsing and violation extraction."}
                </p>

                {isScanning && (
                  <div className="w-full max-w-md mt-8">
                    <div className="flex justify-between text-xs font-mono mb-2">
                      <span className="text-primary">Extraction Progress</span>
                      <span className="text-primary">{scanProgress}%</span>
                    </div>
                    <div className="h-1 bg-secondary w-full rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${scanProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Terminal Logs */}
              <AnimatePresence>
                {logs.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-6 bg-[#0a0a0c] border border-border rounded-lg p-4 font-mono text-xs text-muted-foreground max-h-48 overflow-y-auto"
                  >
                    {logs.map((log, i) => (
                      <div key={i} className="mb-1 flex">
                        <span className="text-primary/70 mr-2">›</span>
                        <span className={log.includes("FLAGGING") ? "text-destructive" : log.includes("COMPLETE") ? "text-green-400" : ""}>
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
          {reportLoaded && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6 max-w-6xl mx-auto"
            >
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SummaryCard 
                  title="Total Violations" 
                  value={mockReportData.findings.length.toString()} 
                  icon={ShieldAlert}
                  accent="destructive"
                />
                <div className="bg-card border border-border rounded-xl p-5 flex flex-col justify-between">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Activity className="w-5 h-5" />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground font-mono mb-1">Bureau Discrepancies</div>
                    <div className="text-3xl font-display text-white">Critical</div>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-5 flex flex-col justify-between">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-2 rounded-lg bg-secondary text-muted-foreground">
                      <FileText className="w-5 h-5" />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground font-mono mb-1">Accounts Processed</div>
                    <div className="text-3xl font-display text-white">{mockReportData.accounts.length}</div>
                  </div>
                </div>
              </div>

              {/* Main Data Section */}
              <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col min-h-[500px]">
                <div className="flex border-b border-border">
                  <TabButton active={activeTab === 'findings'} onClick={() => setActiveTab('findings')}>
                    Detected Violations <span className="ml-2 bg-destructive text-white px-1.5 py-0.5 rounded text-[10px]">{mockReportData.findings.length}</span>
                  </TabButton>
                  <TabButton active={activeTab === 'accounts'} onClick={() => setActiveTab('accounts')}>
                    Parsed Accounts
                  </TabButton>
                </div>

                <div className="p-6 flex-1 bg-background/50">
                  {activeTab === 'findings' && (
                    <div className="space-y-4">
                      {mockReportData.findings.map((finding) => (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={finding.id} 
                          className="bg-card border border-border hover:border-destructive/50 transition-colors rounded-lg overflow-hidden group"
                        >
                          <div className="p-5 border-b border-border/50 flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-3 mb-2">
                                <Badge severity={finding.severity} />
                                <h4 className="font-display text-lg text-white group-hover:text-destructive transition-colors">
                                  {finding.finding_type}
                                </h4>
                              </div>
                              <p className="text-sm text-muted-foreground font-mono max-w-3xl">
                                {finding.explanation}
                              </p>
                            </div>
                            <div className="text-right">
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
                                {finding.potential_fcra_theory.map((theory, i) => (
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
                                {finding.evidence.map((ev, i) => (
                                  <div key={i} className="text-xs font-mono bg-background border border-border p-2 rounded text-muted-foreground flex gap-2">
                                    <span className="text-white bg-secondary px-1 py-0.5 rounded">{ev.bureau}</span>
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
                       {mockReportData.accounts.map((acct, i) => (
                         <div key={i} className="bg-card border border-border rounded-lg p-5">
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <h4 className="font-display text-lg text-white">{acct.creditor}</h4>
                                <div className="text-sm font-mono text-muted-foreground">{acct.account_number_masked}</div>
                              </div>
                              <div className={`px-2 py-1 rounded text-xs font-mono border ${
                                acct.status.includes('Chargeoff') || acct.status.includes('Derogatory') 
                                  ? 'border-destructive/50 text-destructive bg-destructive/10' 
                                  : 'border-border text-muted-foreground bg-secondary'
                              }`}>
                                {acct.status}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                              <div>
                                <span className="text-muted-foreground text-xs block mb-1">Type</span>
                                <span className="text-white">{acct.type}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground text-xs block mb-1">Balance</span>
                                <span className="text-white font-mono">${acct.balance}</span>
                              </div>
                            </div>
                         </div>
                       ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}

// Subcomponents

function SidebarItem({ icon: Icon, label, active = false }: any) {
  return (
    <button className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
      active 
        ? "bg-primary/10 text-primary border border-primary/20" 
        : "text-muted-foreground hover:bg-secondary hover:text-white"
    }`}>
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function SummaryCard({ title, value, icon: Icon, accent = "primary" }: any) {
  const isDestructive = accent === "destructive";
  return (
    <div className={`bg-card border ${isDestructive ? 'border-destructive/30' : 'border-border'} rounded-xl p-5 flex flex-col justify-between relative overflow-hidden group`}>
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
  const colors = {
    critical: "bg-red-500/20 text-red-500 border-red-500/30",
    high: "bg-orange-500/20 text-orange-500 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
    low: "bg-blue-500/20 text-blue-500 border-blue-500/30"
  };
  
  const selected = colors[severity as keyof typeof colors] || colors.medium;
  
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${selected}`}>
      {severity}
    </span>
  );
}