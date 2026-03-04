import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, AlertTriangle, XCircle, Search,
  ChevronDown, ChevronUp, Loader2
} from "lucide-react";
import { reviewViolation } from "@/lib/api";

const REVIEW_STATUSES = [
  { value: "confirmed", label: "Confirmed", icon: CheckCircle2, color: "text-green-600 border-green-500/30 bg-green-500/10" },
  { value: "modified", label: "Modified", icon: AlertTriangle, color: "text-yellow-600 border-yellow-500/30 bg-yellow-500/10" },
  { value: "rejected", label: "Rejected", icon: XCircle, color: "text-red-600 border-red-500/30 bg-red-500/10" },
  { value: "needs_info", label: "Needs More Info", icon: Search, color: "text-blue-600 border-blue-500/30 bg-blue-500/10" },
];

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];

interface ViolationReviewCardProps {
  violation: any;
  scanId: number;
  isLocked: boolean;
  reviewerName?: string;
}

export default function ViolationReviewCard({ violation, scanId, isLocked, reviewerName }: ViolationReviewCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [reviewStatus, setReviewStatus] = useState(violation.reviewStatus || "pending");
  const [notes, setNotes] = useState(violation.reviewerNotes || "");
  const [severityOverride, setSeverityOverride] = useState(violation.severityOverride || violation.severity);
  const [descriptionOverride, setDescriptionOverride] = useState(violation.descriptionOverride || violation.explanation);

  const mutation = useMutation({
    mutationFn: (data: any) => reviewViolation(violation.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      queryClient.invalidateQueries({ queryKey: ["review-summary", scanId] });
    },
  });

  const handleStatusChange = (status: string) => {
    setReviewStatus(status);
    const data: any = {
      reviewStatus: status,
      reviewerNotes: notes || null,
      reviewedBy: reviewerName || null,
    };
    if (status === "modified") {
      data.severityOverride = severityOverride;
      data.descriptionOverride = descriptionOverride;
    }
    mutation.mutate(data);
  };

  const handleSaveNotes = () => {
    const data: any = {
      reviewStatus,
      reviewerNotes: notes || null,
      reviewedBy: reviewerName || null,
    };
    if (reviewStatus === "modified") {
      data.severityOverride = severityOverride;
      data.descriptionOverride = descriptionOverride;
    }
    mutation.mutate(data);
  };

  const isReviewed = reviewStatus !== "pending";
  const categoryLabel = violation.category === "FCRA_REPORTING" ? "FCRA Reporting" : "Debt Collector Conduct";
  const categoryColor = violation.category === "FCRA_REPORTING"
    ? "border-blue-500/30 text-blue-600 bg-blue-500/10"
    : "border-purple-500/30 text-purple-600 bg-purple-500/10";

  const confidenceColors: Record<string, string> = {
    confirmed: "text-green-600",
    likely: "text-yellow-600",
    possible: "text-orange-600",
  };

  return (
    <div className={`bg-card border rounded-xl overflow-hidden transition-all ${
      isReviewed ? "border-primary/20" : "border-border"
    }`}>
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-secondary/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <SeverityBadge severity={reviewStatus === "modified" && violation.severityOverride ? violation.severityOverride : violation.severity} />
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${categoryColor}`}>
            {categoryLabel}
          </span>
          <span className="text-sm text-foreground font-semibold">{violation.violationType}</span>
          {violation.confidence && (
            <span className={`text-xs font-mono font-medium ${confidenceColors[violation.confidence] || "text-muted-foreground"}`}>
              {violation.confidence}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {isReviewed && (
            <ReviewStatusBadge status={reviewStatus} />
          )}
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-border/50 space-y-4">
          {/* AI Detection Summary */}
          <div className="pt-4">
            <h4 className="text-sm font-mono font-semibold text-primary mb-2">AI DETECTION SUMMARY</h4>
            <p className="text-sm font-mono text-foreground/80 leading-relaxed">
              {reviewStatus === "modified" && descriptionOverride !== violation.explanation
                ? descriptionOverride
                : violation.explanation}
            </p>
            {violation.evidence && (
              <p className="text-sm font-mono text-foreground/60 mt-2 italic">Evidence: {violation.evidence}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm font-mono font-medium text-primary">{violation.fcraStatute}</span>
              {violation.matchedRule && (
                <span className="text-xs font-mono text-foreground/70 bg-secondary px-2 py-1 rounded">{violation.matchedRule}</span>
              )}
            </div>
          </div>

          {/* Evidence Required */}
          {violation.evidenceRequired && (
            <div>
              <h4 className="text-sm font-mono font-semibold text-primary mb-2">EVIDENCE REQUIRED</h4>
              <div className="bg-background border border-border rounded-lg p-3">
                <p className="text-sm font-mono text-foreground/80">{violation.evidenceRequired}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                    violation.evidenceProvided
                      ? "border-green-500/30 text-green-600 bg-green-500/10"
                      : "border-yellow-500/30 text-yellow-600 bg-yellow-500/10"
                  }`}>
                    {violation.evidenceProvided ? "Provided" : "Missing"}
                  </span>
                </div>
                {reviewStatus === "confirmed" && !violation.evidenceProvided && (
                  <p className="text-sm font-mono text-yellow-600 mt-2">
                    This violation is confirmed but lacks supporting documentation. Strong violations require evidence for escalation.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* CRO Reminder */}
          {violation.croReminder && (
            <div>
              <h4 className="text-sm font-mono font-semibold text-primary mb-2">CRO REMINDER</h4>
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
                <p className="text-sm font-mono text-yellow-700 dark:text-yellow-500">{violation.croReminder}</p>
              </div>
            </div>
          )}

          {/* Human Review Controls */}
          {!isLocked && (
            <div>
              <h4 className="text-sm font-mono font-semibold text-primary mb-3">REVIEW DECISION</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {REVIEW_STATUSES.map((rs) => {
                  const Icon = rs.icon;
                  return (
                    <button
                      key={rs.value}
                      onClick={() => handleStatusChange(rs.value)}
                      disabled={mutation.isPending}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        reviewStatus === rs.value
                          ? rs.color + " ring-1 ring-current"
                          : "border-border bg-background text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      <Icon className="w-4 h-4 mb-1" />
                      <div className="text-sm font-mono">{rs.label}</div>
                    </button>
                  );
                })}
              </div>

              {/* Modified: severity/description overrides */}
              {reviewStatus === "modified" && (
                <div className="space-y-3 mb-4 p-4 bg-background border border-border rounded-lg">
                  <div>
                    <label className="text-sm font-mono text-foreground/70 mb-1 block">Severity Override</label>
                    <select
                      value={severityOverride}
                      onChange={(e) => setSeverityOverride(e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                    >
                      {SEVERITY_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-mono text-foreground/70 mb-1 block">Description Override</label>
                    <textarea
                      value={descriptionOverride}
                      onChange={(e) => setDescriptionOverride(e.target.value)}
                      rows={3}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Reviewer Notes */}
              <div>
                <label className="text-sm font-mono text-foreground/70 mb-1 block">Reviewer Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={handleSaveNotes}
                  rows={2}
                  placeholder="Add CRO analysis or reasoning..."
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary resize-none"
                />
              </div>
            </div>
          )}

          {/* Locked state */}
          {isLocked && isReviewed && (
            <div className="bg-secondary/30 border border-border rounded-lg p-3">
              <p className="text-sm font-mono text-foreground/70">
                <span className="text-foreground font-medium">Review:</span> {reviewStatus} {violation.reviewedBy ? `by ${violation.reviewedBy}` : ""}
                {violation.reviewedAt ? ` on ${new Date(violation.reviewedAt).toLocaleDateString()}` : ""}
              </p>
              {notes && <p className="text-sm font-mono text-foreground/70 mt-1">Notes: {notes}</p>}
            </div>
          )}
        </div>
      )}
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
