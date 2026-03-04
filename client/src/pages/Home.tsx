import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Trash2, ChevronRight, Shield,
  Loader2, User, CheckCircle2, Eye
} from "lucide-react";
import { fetchScans, createScan, deleteScan } from "@/lib/api";

export default function Home() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showNewScan, setShowNewScan] = useState(false);
  const [consumerName, setConsumerName] = useState("");

  const { data: scans = [], isLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: fetchScans,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createScan(name),
    onSuccess: (scan) => {
      queryClient.invalidateQueries({ queryKey: ["scans"] });
      navigate(`/scan/${scan.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scans"] }),
  });

  const handleCreate = () => {
    if (consumerName.trim()) {
      createMutation.mutate(consumerName.trim());
    }
  };

  const stepLabels = ["Start", "Add Accounts", "Classify", "Next Steps"];

  return (
    <div className="h-full">
      <header className="h-16 border-b border-border bg-white flex items-center px-6 justify-between">
        <h2 className="font-display font-medium text-lg text-foreground">Dispute Scanner</h2>
        <button
          data-testid="button-new-scan"
          onClick={() => setShowNewScan(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          New Scan
        </button>
      </header>

      <div className="p-6">
        <AnimatePresence>
          {showNewScan && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-8 bg-card border border-primary/30 rounded-xl p-6"
            >
              <h3 className="font-display text-lg text-foreground mb-4">Start New Dispute Scan</h3>
              <div className="flex gap-3">
                <input
                  data-testid="input-consumer-name"
                  type="text"
                  value={consumerName}
                  onChange={(e) => setConsumerName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="Enter your full name..."
                  className="flex-1 bg-background border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  data-testid="button-create-scan"
                  onClick={handleCreate}
                  disabled={!consumerName.trim() || createMutation.isPending}
                  className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  Begin Scan
                </button>
                <button
                  data-testid="button-cancel-scan"
                  onClick={() => { setShowNewScan(false); setConsumerName(""); }}
                  className="px-4 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {!isLoading && scans.length === 0 && !showNewScan && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className="p-6 rounded-full bg-secondary inline-block mb-6">
              <Shield className="w-12 h-12 text-primary" />
            </div>
            <h2 className="font-display text-2xl text-foreground mb-3">No Active Scans</h2>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-8">
              Create a scan to enter and analyze negative credit accounts for potential FCRA violations.
            </p>
            <button
              data-testid="button-empty-new-scan"
              onClick={() => setShowNewScan(true)}
              className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Start Your First Scan
            </button>
          </motion.div>
        )}

        {scans.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-display text-lg text-foreground">Your Scans</h2>
              <span className="text-xs font-mono text-muted-foreground">{scans.length} total</span>
            </div>
            {scans.map((scan: any) => (
              <motion.div
                key={scan.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                data-testid={`scan-card-${scan.id}`}
                className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-colors group cursor-pointer"
                onClick={() => navigate(`/scan/${scan.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-display text-lg text-foreground group-hover:text-primary transition-colors">
                        {scan.consumerName}
                      </h3>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-xs font-mono text-muted-foreground">
                          {new Date(scan.createdAt).toLocaleDateString()}
                        </span>
                        <ScanStatusBadge status={scan.status} reviewStatus={scan.reviewStatus} />
                        {scan.reviewedAt && (
                          <span className="text-xs font-mono text-muted-foreground">
                            Reviewed: {new Date(scan.reviewedAt).toLocaleDateString()}
                          </span>
                        )}
                        {scan.clientState && (
                          <span className="text-xs font-mono text-muted-foreground">{scan.clientState}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {/* Review button for completed scans */}
                    {scan.status === "completed" && scan.reviewStatus !== "approved" && scan.reviewStatus !== "exported" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/review/${scan.id}`); }}
                        className="px-3 py-1.5 bg-primary text-primary-foreground font-medium rounded-lg text-xs inline-flex items-center gap-1 hover:bg-primary/90 transition-colors"
                      >
                        <Eye className="w-3 h-3" /> Review
                      </button>
                    )}
                    {(scan.reviewStatus === "approved" || scan.reviewStatus === "exported") && (
                      <span className="text-xs font-mono text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Approved
                      </span>
                    )}
                    <div className="hidden md:flex items-center gap-1">
                      {stepLabels.map((label, i) => (
                        <div key={i} className="flex items-center">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono ${
                            i + 1 <= scan.currentStep ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground border border-border"
                          }`}>
                            {i + 1}
                          </div>
                          {i < stepLabels.length - 1 && (
                            <div className={`w-4 h-0.5 ${i + 1 < scan.currentStep ? "bg-primary" : "bg-border"}`} />
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      data-testid={`delete-scan-${scan.id}`}
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(scan.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
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
