import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  BrainCircuit, ArrowLeft, Shield, FileText, AlertTriangle,
  Loader2, User, BarChart3, CheckCircle2, Clock, XCircle, TrendingUp
} from "lucide-react";
import { fetchScans, fetchScan } from "@/lib/api";
import { useState, useEffect } from "react";

export default function ProfileView() {
  const [, navigate] = useLocation();
  const [allData, setAllData] = useState<any>(null);

  const { data: scans = [], isLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: fetchScans,
  });

  useEffect(() => {
    if (scans.length === 0) return;
    Promise.all(scans.map((s: any) => fetchScan(s.id))).then((fullScans) => {
      const allAccounts: any[] = [];
      const allViolations: any[] = [];
      const allLetters: any[] = [];
      fullScans.forEach((s: any) => {
        (s.negativeAccounts || []).forEach((a: any) => {
          allAccounts.push({ ...a, scanConsumerName: s.consumerName });
          (a.violations || []).forEach((v: any) => allViolations.push({ ...v, creditor: a.creditor }));
          (a.letters || []).forEach((l: any) => allLetters.push({ ...l, creditor: a.creditor }));
        });
      });
      setAllData({ scans: fullScans, accounts: allAccounts, violations: allViolations, letters: allLetters });
    });
  }, [scans]);

  if (isLoading || !allData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const totalAccounts = allData.accounts.length;
  const totalViolations = allData.violations.length;
  const totalLetters = allData.letters.length;
  const sentLetters = allData.letters.filter((l: any) => l.status === "sent").length;

  const severityCounts = allData.violations.reduce((acc: Record<string, number>, v: any) => {
    acc[v.severity] = (acc[v.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const typeCounts = allData.accounts.reduce((acc: Record<string, number>, a: any) => {
    acc[a.accountType] = (acc[a.accountType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const stepCounts = allData.accounts.reduce((acc: Record<string, number>, a: any) => {
    acc[a.workflowStep] = (acc[a.workflowStep] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button data-testid="button-back-from-profile" onClick={() => navigate("/")} className="text-muted-foreground hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <BrainCircuit className="text-primary w-6 h-6" />
            <h1 className="font-display font-bold text-xl text-white">Profile Clarity View</h1>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Negative Accounts" value={totalAccounts} icon={FileText} />
          <StatCard label="Violations Found" value={totalViolations} icon={AlertTriangle} color="destructive" />
          <StatCard label="Letters Generated" value={totalLetters} icon={Shield} />
          <StatCard label="Letters Sent" value={sentLetters} icon={CheckCircle2} color="green" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-display text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Account Types
            </h3>
            <div className="space-y-3">
              {Object.entries(typeCounts).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{formatType(type)}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${((count as number) / totalAccounts) * 100}%` }} />
                    </div>
                    <span className="text-sm font-mono text-white w-6 text-right">{count as number}</span>
                  </div>
                </div>
              ))}
              {totalAccounts === 0 && <p className="text-xs font-mono text-muted-foreground">No accounts yet</p>}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-display text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" /> Violation Severity
            </h3>
            <div className="space-y-3">
              {["critical", "high", "medium", "low"].map((sev) => (
                <div key={sev} className="flex items-center justify-between">
                  <SeverityBadge severity={sev} />
                  <span className="text-sm font-mono text-white">{severityCounts[sev] || 0}</span>
                </div>
              ))}
              {totalViolations === 0 && <p className="text-xs font-mono text-muted-foreground mt-2">No violations detected yet</p>}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-display text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Workflow Status
            </h3>
            <div className="space-y-3">
              {["pending", "classified", "scanned", "letter_generated", "letter_sent", "follow_up"].map((ws) => {
                const count = stepCounts[ws] || 0;
                if (count === 0) return null;
                return (
                  <div key={ws} className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground capitalize">{ws.replace(/_/g, " ")}</span>
                    <span className="text-sm font-mono text-white">{count}</span>
                  </div>
                );
              })}
              {totalAccounts === 0 && <p className="text-xs font-mono text-muted-foreground">No accounts yet</p>}
            </div>
          </motion.div>
        </div>

        {allData.accounts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <h3 className="font-display text-lg text-white mb-4">All Negative Accounts</h3>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground">Creditor</th>
                      <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground">Balance</th>
                      <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground">Bureaus</th>
                      <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground">Violations</th>
                      <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allData.accounts.map((acct: any) => {
                      const acctViolations = allData.violations.filter((v: any) => v.negativeAccountId === acct.id);
                      const acctLetters = allData.letters.filter((l: any) => l.negativeAccountId === acct.id);
                      return (
                        <tr key={acct.id} data-testid={`profile-row-${acct.id}`} className="border-b border-border/50 hover:bg-secondary/20">
                          <td className="px-4 py-3 text-sm text-white font-medium">{acct.creditor}</td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{formatType(acct.accountType)}</td>
                          <td className="px-4 py-3 text-sm font-mono text-white">{acct.balance ? `$${acct.balance}` : "—"}</td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{acct.bureaus || "—"}</td>
                          <td className="px-4 py-3">
                            {acctViolations.length > 0 ? (
                              <span className="text-xs font-mono text-destructive">{acctViolations.length} found</span>
                            ) : (
                              <span className="text-xs font-mono text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <WorkflowBadge step={acct.workflowStep} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {allData.violations.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <h3 className="font-display text-lg text-white mb-4">All Detected Violations</h3>
            <div className="space-y-3">
              {allData.violations.map((v: any) => (
                <div key={v.id} data-testid={`profile-violation-${v.id}`} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <SeverityBadge severity={v.severity} />
                    <span className="text-sm text-white font-medium">{v.violationType}</span>
                    <span className="text-xs font-mono text-muted-foreground ml-auto">{v.creditor}</span>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">{v.explanation}</p>
                  <div className="mt-1 text-xs font-mono text-primary">{v.fcraStatute}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color?: string }) {
  const colorClass = color === "destructive" ? "text-destructive" : color === "green" ? "text-green-400" : "text-primary";
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className={`p-2 rounded-lg inline-block mb-3 ${color === "destructive" ? "bg-destructive/10" : color === "green" ? "bg-green-500/10" : "bg-primary/10"}`}>
        <Icon className={`w-5 h-5 ${colorClass}`} />
      </div>
      <div className="text-3xl font-display text-white">{value}</div>
      <div className="text-xs font-mono text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
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

function WorkflowBadge({ step }: { step: string }) {
  const colors: Record<string, string> = {
    pending: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
    classified: "border-blue-500/30 text-blue-400 bg-blue-500/10",
    scanned: "border-purple-500/30 text-purple-400 bg-purple-500/10",
    letter_generated: "border-primary/30 text-primary bg-primary/10",
    letter_sent: "border-green-500/30 text-green-400 bg-green-500/10",
    follow_up: "border-orange-500/30 text-orange-400 bg-orange-500/10",
  };
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${colors[step] || colors.pending}`}>
      {step.replace(/_/g, " ")}
    </span>
  );
}

function formatType(type: string): string {
  const map: Record<string, string> = {
    debt_collection: "Debt Collection",
    charge_off: "Charge-Off",
    repossession: "Repossession",
  };
  return map[type] || type;
}
