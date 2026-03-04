import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface EvidenceTrackerProps {
  violations: any[];
}

export default function EvidenceTracker({ violations }: EvidenceTrackerProps) {
  const withEvidence = violations.filter(v => v.evidenceRequired);
  if (withEvidence.length === 0) return null;

  const provided = withEvidence.filter(v => v.evidenceProvided).length;
  const missing = withEvidence.length - provided;

  const getStatus = () => {
    if (provided === withEvidence.length) return { label: "Complete", color: "text-green-600", icon: CheckCircle2 };
    if (provided > 0) return { label: "Partial", color: "text-yellow-600", icon: AlertTriangle };
    return { label: "Missing", color: "text-red-600", icon: XCircle };
  };

  const status = getStatus();
  const StatusIcon = status.icon;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-mono text-foreground flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${status.color}`} />
          Evidence Status: {status.label}
        </h3>
        <span className="text-xs font-mono text-muted-foreground">
          {provided}/{withEvidence.length} items provided
        </span>
      </div>

      <div className="space-y-2">
        {withEvidence.map((v: any) => (
          <div key={v.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
            <div className={`w-5 h-5 rounded border flex items-center justify-center ${
              v.evidenceProvided
                ? "border-green-500/30 bg-green-500/10"
                : "border-yellow-500/30 bg-yellow-500/10"
            }`}>
              {v.evidenceProvided ? (
                <CheckCircle2 className="w-3 h-3 text-green-600" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-mono text-foreground truncate">{v.violationType}</p>
              <p className="text-xs font-mono text-foreground/60 truncate">{v.evidenceRequired}</p>
            </div>
            {v.evidenceNotes && (
              <span className="text-xs font-mono text-foreground/60">{v.evidenceNotes}</span>
            )}
          </div>
        ))}
      </div>

      {missing > 0 && (
        <p className="text-xs font-mono text-yellow-600 mt-3">
          {missing} evidence item{missing !== 1 ? "s" : ""} still needed for complete documentation.
        </p>
      )}
    </div>
  );
}
