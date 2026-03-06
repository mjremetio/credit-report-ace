import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Shield, Loader2, CheckCircle2, Lock,
  RotateCcw, AlertTriangle
} from "lucide-react";
import { fetchScan, fetchReviewSummary, updateScan, reopenScan } from "@/lib/api";
import ViolationReviewCard from "@/components/ViolationReviewCard";
import ReviewProgressBar from "@/components/ReviewProgressBar";
import EvidenceTracker from "@/components/EvidenceTracker";
import CROReminders from "@/components/CROReminders";
import ExportButtons from "@/components/ExportButtons";
import ApprovalModal from "@/components/ApprovalModal";

export default function ReviewDashboard() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const scanId = parseInt(id || "0");
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [reviewerName, setReviewerName] = useState("");

  const { data: scan, isLoading, error } = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => fetchScan(scanId),
    enabled: scanId > 0 && !isNaN(scanId),
    refetchInterval: 3000,
    retry: 3,
  });

  const { data: summary } = useQuery({
    queryKey: ["review-summary", scanId],
    queryFn: () => fetchReviewSummary(scanId),
    enabled: scanId > 0,
    refetchInterval: 3000,
  });

  const beginReviewMutation = useMutation({
    mutationFn: () => updateScan(scanId, { reviewStatus: "in_progress" } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      queryClient.invalidateQueries({ queryKey: ["review-summary", scanId] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => reopenScan(scanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      queryClient.invalidateQueries({ queryKey: ["review-summary", scanId] });
    },
  });

  const negAccounts = scan?.negativeAccounts || [];
  const allViolations = negAccounts.flatMap((a: any) => a.violations || []);
  const hasNotStartedReview = !scan?.reviewStatus || scan?.reviewStatus === "pending";

  // Auto-start review when violations exist and review hasn't started
  useEffect(() => {
    if (scan && hasNotStartedReview && allViolations.length > 0 && !beginReviewMutation.isPending) {
      beginReviewMutation.mutate();
    }
  }, [scan, hasNotStartedReview, allViolations.length]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-3" />
          <h2 className="font-display text-xl text-foreground mb-2">Failed to Load Scan</h2>
          <p className="text-muted-foreground font-mono text-sm mb-4 max-w-md">{error.message}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => queryClient.invalidateQueries({ queryKey: ["scan", scanId] })} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Retry
            </button>
            <button onClick={() => navigate("/")} className="text-primary font-mono text-sm hover:underline px-4 py-2">Go Home</button>
          </div>
        </div>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h2 className="font-display text-xl text-foreground mb-2">Scan Not Found</h2>
          <button onClick={() => navigate("/")} className="text-primary font-mono text-sm hover:underline">Go Home</button>
        </div>
      </div>
    );
  }

  const isApproved = scan.reviewStatus === "approved" || scan.reviewStatus === "exported";
  const isUnderReview = scan.reviewStatus === "in_progress";
  const allReviewed = summary ? summary.pending === 0 : false;

  // Collect unique CRO reminders from debt collector accounts
  const debtCollectorAccounts = negAccounts.filter((a: any) => a.accountType === "debt_collection");
  const customReminders = allViolations
    .filter((v: any) => v.croReminder)
    .map((v: any) => v.croReminder);

  // Build a map from violation id to the account it belongs to
  const violationAccountMap = new Map<number, any>();
  for (const acct of negAccounts) {
    for (const v of (acct.violations || [])) {
      violationAccountMap.set(v.id, acct);
    }
  }

  // Group violations by account for display
  const fcraViolations = allViolations.filter((v: any) => !v.category || v.category === "FCRA_REPORTING");
  const fdcpaViolations = allViolations.filter((v: any) => v.category && v.category !== "FCRA_REPORTING");

  return (
    <div className="h-full">
      <header className="h-16 border-b border-border bg-white flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/scan/${scanId}`)} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-display font-medium text-lg text-foreground">Review Dashboard</h2>
          <span className="text-xs font-mono text-muted-foreground">— {scan.consumerName}</span>
        </div>
        <div className="flex items-center gap-3">
          {isApproved && (
            <button
              onClick={() => {
                if (confirm("Reopen this review? Violations will become editable again.")) {
                  reopenMutation.mutate();
                }
              }}
              className="px-4 py-2 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-2 text-xs font-mono"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reopen Review
            </button>
          )}
          <ExportButtons scanId={scanId} />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Approved Banner */}
        {isApproved && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <div>
                <h3 className="text-sm font-mono text-green-600 font-medium">Report Approved</h3>
                <p className="text-xs font-mono text-green-600/70">
                  Reviewed by {scan.reviewedBy} on {scan.reviewedAt ? new Date(scan.reviewedAt).toLocaleDateString() : "N/A"}
                  {scan.approvedViolationCount !== null && ` — ${scan.approvedViolationCount} violations approved, ${scan.rejectedViolationCount} rejected`}
                </p>
              </div>
            </div>
            <Lock className="w-5 h-5 text-green-600/50" />
          </motion.div>
        )}

        {/* Auto-starting review indicator */}
        {hasNotStartedReview && allViolations.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-primary/5 border border-primary/20 rounded-xl p-6 text-center"
          >
            <Loader2 className="w-10 h-10 text-primary mx-auto mb-3 animate-spin" />
            <h3 className="font-display text-lg text-foreground mb-2">Starting Review...</h3>
            <p className="text-sm font-mono text-muted-foreground">
              {allViolations.length} violation{allViolations.length !== 1 ? "s" : ""} detected. Automatically initializing review...
            </p>
          </motion.div>
        )}

        {/* No violations */}
        {allViolations.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
            <h3 className="font-display text-lg text-foreground mb-2">No Violations to Review</h3>
            <p className="text-sm font-mono text-muted-foreground">
              No violations were detected. Go back to scan more accounts or upload additional reports.
            </p>
          </div>
        )}

        {/* Review Progress */}
        {(isUnderReview || isApproved || hasNotStartedReview) && allViolations.length > 0 && (
          <ReviewProgressBar scanId={scanId} />
        )}

        {/* Reviewer Name (for tracking) */}
        {(isUnderReview || hasNotStartedReview) && allViolations.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Reviewer Name</label>
            <input
              type="text"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              placeholder="Enter your name for review tracking..."
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {/* FCRA Violations Section */}
        {fcraViolations.length > 0 && (isUnderReview || isApproved || hasNotStartedReview) && (
          <div>
            <h3 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-blue-600" />
              FCRA Reporting Violations ({fcraViolations.length})
            </h3>
            <div className="space-y-3">
              {fcraViolations.map((v: any) => (
                <ViolationReviewCard
                  key={v.id}
                  violation={v}
                  account={violationAccountMap.get(v.id)}
                  scanId={scanId}
                  isLocked={isApproved}
                  reviewerName={reviewerName}
                />
              ))}
            </div>
          </div>
        )}

        {/* FDCPA Violations Section */}
        {fdcpaViolations.length > 0 && (isUnderReview || isApproved || hasNotStartedReview) && (
          <div>
            <h3 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-purple-600" />
              Debt Collector Conduct Violations ({fdcpaViolations.length})
            </h3>
            <div className="space-y-3">
              {fdcpaViolations.map((v: any) => (
                <ViolationReviewCard
                  key={v.id}
                  violation={v}
                  account={violationAccountMap.get(v.id)}
                  scanId={scanId}
                  isLocked={isApproved}
                  reviewerName={reviewerName}
                />
              ))}
            </div>
          </div>
        )}

        {/* Evidence Tracker */}
        {(isUnderReview || isApproved || hasNotStartedReview) && allViolations.length > 0 && (
          <EvidenceTracker violations={allViolations} />
        )}

        {/* CRO Reminders for debt collector accounts */}
        {(isUnderReview || hasNotStartedReview) && debtCollectorAccounts.map((acct: any) => (
          <CROReminders
            key={acct.id}
            accountCreditor={acct.creditor}
            customReminders={
              (acct.violations || [])
                .filter((v: any) => v.croReminder)
                .map((v: any) => v.croReminder)
            }
          />
        ))}

        {/* Approve Button */}
        {isUnderReview && allReviewed && summary && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-500/5 border border-green-500/20 rounded-xl p-6 text-center"
          >
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-3" />
            <h3 className="font-display text-lg text-foreground mb-2">All Violations Reviewed</h3>
            <p className="text-sm font-mono text-muted-foreground mb-4">
              {summary.confirmed + summary.modified} violation{summary.confirmed + summary.modified !== 1 ? "s" : ""} will be included in the final report.
              {summary.rejected > 0 && ` ${summary.rejected} rejected and excluded.`}
            </p>
            <button
              onClick={() => setShowApprovalModal(true)}
              className="px-8 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-600/90 transition-colors inline-flex items-center gap-2"
            >
              <Shield className="w-5 h-5" /> Approve & Finalize Report
            </button>
          </motion.div>
        )}

        {/* Review progress reminder with Mark Complete option */}
        {isUnderReview && !allReviewed && summary && summary.total > 0 && (
          <div className="bg-card border border-border rounded-xl p-5 text-center space-y-4">
            <AlertTriangle className="w-6 h-6 text-yellow-500 mx-auto mb-2" />
            <p className="text-sm font-mono text-muted-foreground">
              {summary.pending} violation{summary.pending !== 1 ? "s" : ""} still pending review.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setShowApprovalModal(true)}
                className="px-6 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-600/90 transition-colors inline-flex items-center gap-2 text-sm"
              >
                <Shield className="w-4 h-4" /> Approve Reviewed & Finalize
              </button>
            </div>
            <p className="text-xs font-mono text-muted-foreground/70">
              You can approve with pending violations — only reviewed violations will be included in the final report.
            </p>
          </div>
        )}
      </div>

      {/* Approval Modal */}
      {showApprovalModal && summary && (
        <ApprovalModal
          scanId={scanId}
          summary={summary}
          onClose={() => setShowApprovalModal(false)}
        />
      )}
    </div>
  );
}
