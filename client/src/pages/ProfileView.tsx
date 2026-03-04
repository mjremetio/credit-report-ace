import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Shield, FileText, AlertTriangle,
  Loader2, BarChart3, TrendingUp, Eye
} from "lucide-react";
import { fetchScans, fetchScan } from "@/lib/api";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export default function ProfileView() {
  const [allData, setAllData] = useState<any>(null);
  const [, navigate] = useLocation();

  const { data: scans = [], isLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: fetchScans,
  });

  useEffect(() => {
    if (scans.length === 0) {
      setAllData({ scans: [], accounts: [], violations: [] });
      return;
    }
    Promise.all(
      scans.map((s: any) => fetchScan(s.id).catch(() => null))
    ).then((results) => {
      const fullScans = results.filter(Boolean);
      const allAccounts: any[] = [];
      const allViolations: any[] = [];
      fullScans.forEach((s: any) => {
        (s.negativeAccounts || []).forEach((a: any) => {
          allAccounts.push({ ...a, scanConsumerName: s.consumerName, scanId: s.id });
          (a.violations || []).forEach((v: any) => allViolations.push({ ...v, creditor: a.creditor }));
        });
      });
      setAllData({ scans: fullScans, accounts: allAccounts, violations: allViolations });
    });
  }, [scans]);

  if (isLoading || !allData) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const totalAccounts = allData.accounts.length;
  const totalViolations = allData.violations.length;
  const totalScans = allData.scans.length;

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

  // Category breakdown
  const fcraCount = allData.violations.filter((v: any) => !v.category || v.category === "FCRA_REPORTING").length;
  const fdcpaCount = allData.violations.filter((v: any) => v.category && v.category !== "FCRA_REPORTING").length;

  // Review status counts
  const reviewCounts = allData.violations.reduce((acc: Record<string, number>, v: any) => {
    const rs = v.reviewStatus || "pending";
    acc[rs] = (acc[rs] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="h-full">
      <header className="h-16 border-b border-border bg-white flex items-center px-6">
        <h2 className="font-display font-medium text-lg text-foreground">Profile Overview</h2>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-3 gap-4">
          <StatCard label="Total Scans" value={totalScans} icon={Shield} />
          <StatCard label="Negative Accounts" value={totalAccounts} icon={FileText} />
          <StatCard label="Violations Found" value={totalViolations} icon={AlertTriangle} color="destructive" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-display text-foreground mb-4 flex items-center gap-2">
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
                    <span className="text-sm font-mono text-foreground w-6 text-right">{count as number}</span>
                  </div>
                </div>
              ))}
              {totalAccounts === 0 && <p className="text-xs font-mono text-muted-foreground">No accounts yet</p>}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-display text-foreground mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" /> Violation Severity
            </h3>
            <div className="space-y-3">
              {["critical", "high", "medium", "low"].map((sev) => (
                <div key={sev} className="flex items-center justify-between">
                  <SeverityBadge severity={sev} />
                  <span className="text-sm font-mono text-foreground">{severityCounts[sev] || 0}</span>
                </div>
              ))}
              {totalViolations === 0 && <p className="text-xs font-mono text-muted-foreground mt-2">No violations detected yet</p>}
            </div>
            {/* Category breakdown */}
            {totalViolations > 0 && (
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-blue-600">FCRA Reporting</span>
                  <span className="text-foreground">{fcraCount}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-purple-600">Debt Collector (FDCPA)</span>
                  <span className="text-foreground">{fdcpaCount}</span>
                </div>
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-display text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Workflow Status
            </h3>
            <div className="space-y-3">
              {["pending", "classified", "scanned"].map((ws) => {
                const count = stepCounts[ws] || 0;
                if (count === 0) return null;
                return (
                  <div key={ws} className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground capitalize">{ws.replace(/_/g, " ")}</span>
                    <span className="text-sm font-mono text-foreground">{count}</span>
                  </div>
                );
              })}
              {totalAccounts === 0 && <p className="text-xs font-mono text-muted-foreground">No accounts yet</p>}
            </div>
            {/* Review status breakdown */}
            {totalViolations > 0 && (
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <h4 className="text-xs font-mono text-muted-foreground mb-2">Review Status</h4>
                {["confirmed", "modified", "rejected", "needs_info", "pending"].map((rs) => {
                  const count = reviewCounts[rs] || 0;
                  if (count === 0) return null;
                  return (
                    <div key={rs} className="flex items-center justify-between">
                      <ReviewStatusBadge status={rs} />
                      <span className="text-sm font-mono text-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>

        {/* Scans with review status */}
        {allData.scans.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <h3 className="font-display text-lg text-foreground mb-4">Scans Overview</h3>
            <div className="space-y-3">
              {allData.scans.map((s: any) => {
                const scanViolations = allData.violations.filter((v: any) => {
                  const acct = allData.accounts.find((a: any) => a.id === v.negativeAccountId);
                  return acct && acct.scanId === s.id;
                });
                const isApproved = s.reviewStatus === "approved" || s.reviewStatus === "exported";
                return (
                  <div key={s.id} className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/review/${s.id}`)}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-display text-foreground">{s.consumerName}</h4>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs font-mono text-muted-foreground">
                            {new Date(s.createdAt).toLocaleDateString()}
                          </span>
                          <ScanStatusBadge status={s.status} reviewStatus={s.reviewStatus} />
                          {scanViolations.length > 0 && (
                            <span className="text-xs font-mono text-destructive">{scanViolations.length} violations</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {isApproved ? (
                          <span className="text-xs font-mono text-green-600 flex items-center gap-1">
                            <Shield className="w-3 h-3" /> Approved
                          </span>
                        ) : scanViolations.length > 0 ? (
                          <span className="px-3 py-1.5 bg-primary text-primary-foreground font-medium rounded-lg text-xs inline-flex items-center gap-1">
                            <Eye className="w-3 h-3" /> Review
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {allData.accounts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <h3 className="font-display text-lg text-foreground mb-4">All Negative Accounts</h3>
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
                      return (
                        <tr key={acct.id} data-testid={`profile-row-${acct.id}`} className="border-b border-border/50 hover:bg-secondary/20">
                          <td className="px-4 py-3 text-sm text-foreground font-medium">{acct.creditor}</td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{formatType(acct.accountType)}</td>
                          <td className="px-4 py-3 text-sm font-mono text-foreground">{acct.balance ? `$${acct.balance}` : "—"}</td>
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

        {/* Violations grouped by FCRA / FDCPA */}
        {allData.violations.length > 0 && (
          <>
            {fcraCount > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                <h3 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
                  <span className="text-blue-600">FCRA Reporting Violations</span>
                  <span className="text-xs font-mono text-muted-foreground">({fcraCount})</span>
                </h3>
                <div className="space-y-3">
                  {allData.violations
                    .filter((v: any) => !v.category || v.category === "FCRA_REPORTING")
                    .map((v: any) => (
                      <ViolationProfileCard key={v.id} violation={v} />
                    ))}
                </div>
              </motion.div>
            )}

            {fdcpaCount > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                <h3 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
                  <span className="text-purple-600">Debt Collector Conduct Violations</span>
                  <span className="text-xs font-mono text-muted-foreground">({fdcpaCount})</span>
                </h3>
                <div className="space-y-3">
                  {allData.violations
                    .filter((v: any) => v.category && v.category !== "FCRA_REPORTING")
                    .map((v: any) => (
                      <ViolationProfileCard key={v.id} violation={v} />
                    ))}
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ViolationProfileCard({ violation }: { violation: any }) {
  return (
    <div data-testid={`profile-violation-${violation.id}`} className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <SeverityBadge severity={violation.severityOverride || violation.severity} />
        <span className="text-sm text-foreground font-semibold">{violation.violationType}</span>
        {violation.confidence && (
          <ConfidenceBadge confidence={violation.confidence} />
        )}
        {violation.reviewStatus && violation.reviewStatus !== "pending" && (
          <ReviewStatusBadge status={violation.reviewStatus} />
        )}
        <span className="text-sm font-mono text-foreground/60 ml-auto">{violation.creditor}</span>
      </div>
      <p className="text-sm font-mono text-foreground/80 leading-relaxed">
        {violation.descriptionOverride || violation.explanation}
      </p>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-mono font-medium text-primary">{violation.fcraStatute}</span>
        {violation.matchedRule && (
          <span className="text-xs font-mono text-foreground/70 bg-secondary px-2 py-1 rounded">{violation.matchedRule}</span>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color?: string }) {
  const colorClass = color === "destructive" ? "text-destructive" : color === "green" ? "text-green-600" : "text-primary";
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className={`p-2 rounded-lg inline-block mb-3 ${color === "destructive" ? "bg-destructive/10" : color === "green" ? "bg-green-500/10" : "bg-primary/10"}`}>
        <Icon className={`w-5 h-5 ${colorClass}`} />
      </div>
      <div className="text-3xl font-display text-foreground">{value}</div>
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
    <span className={`px-2.5 py-1 rounded text-xs uppercase font-mono font-semibold border ${colors[severity] || colors.medium}`}>
      {severity}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    confirmed: "border-green-500/30 text-green-600 bg-green-500/10",
    likely: "border-yellow-500/30 text-yellow-600 bg-yellow-500/10",
    possible: "border-orange-500/30 text-orange-600 bg-orange-500/10",
  };
  return (
    <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded border ${colors[confidence] || "border-border text-muted-foreground"}`}>
      {confidence}
    </span>
  );
}

function ReviewStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    confirmed: { label: "Confirmed", color: "border-green-500/30 text-green-600 bg-green-500/10" },
    modified: { label: "Modified", color: "border-yellow-500/30 text-yellow-600 bg-yellow-500/10" },
    rejected: { label: "Rejected", color: "border-red-500/30 text-red-600 bg-red-500/10" },
    needs_info: { label: "Needs Info", color: "border-blue-500/30 text-blue-600 bg-blue-500/10" },
    pending: { label: "Pending", color: "border-border text-muted-foreground bg-secondary" },
  };
  const info = map[status] || map.pending;
  return (
    <span className={`text-xs font-mono font-medium px-2.5 py-1 rounded border ${info.color}`}>
      {info.label}
    </span>
  );
}

function ScanStatusBadge({ status, reviewStatus }: { status: string; reviewStatus?: string }) {
  if (reviewStatus === "approved" || reviewStatus === "exported") {
    return (
      <span className="text-xs font-mono px-2 py-0.5 rounded border border-green-500/30 text-green-600 bg-green-500/10">
        approved
      </span>
    );
  }
  if (reviewStatus === "in_progress") {
    return (
      <span className="text-xs font-mono px-2 py-0.5 rounded border border-purple-500/30 text-purple-600 bg-purple-500/10">
        under review
      </span>
    );
  }
  const colors: Record<string, string> = {
    completed: "border-green-500/30 text-green-600 bg-green-500/10",
    in_progress: "border-primary/30 text-primary bg-primary/10",
  };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${colors[status] || "border-border text-muted-foreground bg-secondary"}`}>
      {status === "in_progress" ? "In Progress" : status}
    </span>
  );
}

function WorkflowBadge({ step }: { step: string }) {
  const colors: Record<string, string> = {
    pending: "border-yellow-500/30 text-yellow-600 bg-yellow-500/10",
    classified: "border-blue-500/30 text-blue-600 bg-blue-500/10",
    scanned: "border-purple-500/30 text-purple-600 bg-purple-500/10",
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
