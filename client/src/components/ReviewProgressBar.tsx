import { useQuery } from "@tanstack/react-query";
import { fetchReviewSummary } from "@/lib/api";
import { CheckCircle2, AlertTriangle, XCircle, Search, Clock } from "lucide-react";

interface ReviewProgressBarProps {
  scanId: number;
}

export default function ReviewProgressBar({ scanId }: ReviewProgressBarProps) {
  const { data: summary } = useQuery({
    queryKey: ["review-summary", scanId],
    queryFn: () => fetchReviewSummary(scanId),
    refetchInterval: 3000,
  });

  if (!summary || summary.total === 0) return null;

  const reviewed = summary.confirmed + summary.modified + summary.rejected + summary.needsInfo;
  const percent = Math.round((reviewed / summary.total) * 100);
  const allReviewed = summary.pending === 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-mono text-foreground">
          Review Progress: {reviewed} of {summary.total} violations reviewed [{percent}%]
        </h3>
        {!allReviewed && (
          <span className="text-xs font-mono text-yellow-600">Review all violations to unlock export</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-500 ${allReviewed ? "bg-green-500" : "bg-primary"}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Status breakdown */}
      <div className="flex flex-wrap gap-4">
        <StatusItem icon={CheckCircle2} label="Confirmed" count={summary.confirmed} color="text-green-600" />
        <StatusItem icon={AlertTriangle} label="Modified" count={summary.modified} color="text-yellow-600" />
        <StatusItem icon={XCircle} label="Rejected" count={summary.rejected} color="text-red-600" />
        <StatusItem icon={Search} label="Needs Info" count={summary.needsInfo} color="text-blue-600" />
        <StatusItem icon={Clock} label="Pending" count={summary.pending} color="text-muted-foreground" />
      </div>
    </div>
  );
}

function StatusItem({ icon: Icon, label, count, color }: { icon: any; label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-xs font-mono text-muted-foreground">{label}:</span>
      <span className={`text-xs font-mono font-medium ${color}`}>{count}</span>
    </div>
  );
}
