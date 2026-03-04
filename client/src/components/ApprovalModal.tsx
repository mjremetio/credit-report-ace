import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Shield, Loader2 } from "lucide-react";
import { approveScan } from "@/lib/api";

interface ApprovalModalProps {
  scanId: number;
  summary: {
    confirmed: number;
    modified: number;
    rejected: number;
    needsInfo: number;
    pending: number;
    total: number;
  };
  onClose: () => void;
}

export default function ApprovalModal({ scanId, summary, onClose }: ApprovalModalProps) {
  const queryClient = useQueryClient();
  const [reviewerName, setReviewerName] = useState("");
  const [finalNotes, setFinalNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () => approveScan(scanId, {
      reviewedBy: reviewerName,
      reviewNotes: finalNotes || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      queryClient.invalidateQueries({ queryKey: ["review-summary", scanId] });
      onClose();
    },
  });

  const totalInReport = summary.confirmed + summary.modified;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-display text-lg text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Finalize Report?
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-5">
          {/* Summary */}
          <div className="bg-background border border-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-mono text-primary mb-2">SUMMARY</h3>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-green-600">{summary.confirmed} violations confirmed</span>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-yellow-600">{summary.modified} violation{summary.modified !== 1 ? "s" : ""} modified</span>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-red-600">{summary.rejected} violation{summary.rejected !== 1 ? "s" : ""} rejected (excluded from export)</span>
            </div>
            <div className="border-t border-border/50 pt-2 mt-2 flex justify-between text-xs font-mono">
              <span className="text-foreground font-medium">Total in final report: {totalInReport} violations</span>
            </div>
          </div>

          {/* Reviewer Name */}
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Reviewer *</label>
            <input
              type="text"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              placeholder="Enter your name..."
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
              autoFocus
            />
          </div>

          {/* Final Notes */}
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Final Notes (optional)</label>
            <textarea
              value={finalNotes}
              onChange={(e) => setFinalNotes(e.target.value)}
              placeholder="Any final observations or notes..."
              rows={3}
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary resize-none"
            />
          </div>

          {mutation.isError && (
            <p className="text-xs font-mono text-destructive">
              {(mutation.error as Error)?.message || "Failed to approve"}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors font-mono text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!reviewerName.trim() || mutation.isPending}
            className="flex-1 px-4 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 font-mono text-sm"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Approve & Lock Report
          </button>
        </div>
      </div>
    </div>
  );
}
