import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, AlertTriangle, XCircle, Search,
  ChevronDown, ChevronUp, Loader2, Pencil, Save, X
} from "lucide-react";
import { reviewViolation, editViolation } from "@/lib/api";

const REVIEW_STATUSES = [
  { value: "confirmed", label: "Confirmed", icon: CheckCircle2, color: "text-green-600 border-green-500/30 bg-green-500/10" },
  { value: "modified", label: "Modified", icon: AlertTriangle, color: "text-yellow-600 border-yellow-500/30 bg-yellow-500/10" },
  { value: "rejected", label: "Rejected", icon: XCircle, color: "text-red-600 border-red-500/30 bg-red-500/10" },
  { value: "needs_info", label: "Needs More Info", icon: Search, color: "text-blue-600 border-blue-500/30 bg-blue-500/10" },
];

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
const CONFIDENCE_OPTIONS = ["confirmed", "likely", "possible"];
const CATEGORY_OPTIONS = [
  { value: "FCRA_REPORTING", label: "FCRA Reporting" },
  { value: "DEBT_COLLECTOR_DISCLOSURE", label: "Debt Collector Disclosure" },
  { value: "CA_LICENSE_MISSING", label: "CA License Missing" },
  { value: "CEASE_CONTACT_VIOLATION", label: "Cease Contact Violation" },
  { value: "INCONVENIENT_CONTACT", label: "Inconvenient Contact" },
  { value: "THIRD_PARTY_DISCLOSURE", label: "Third-Party Disclosure" },
  { value: "HARASSMENT_EXCESSIVE_CALLS", label: "Harassment / Excessive Calls" },
];

interface ViolationReviewCardProps {
  violation: any;
  account?: any;
  scanId: number;
  isLocked: boolean;
  reviewerName?: string;
}

export default function ViolationReviewCard({ violation, account, scanId, isLocked, reviewerName }: ViolationReviewCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewStatus, setReviewStatus] = useState(violation.reviewStatus || "pending");
  const [notes, setNotes] = useState(violation.reviewerNotes || "");
  const [severityOverride, setSeverityOverride] = useState(violation.severityOverride || violation.severity);
  const [descriptionOverride, setDescriptionOverride] = useState(violation.descriptionOverride || violation.explanation);

  // Paralegal editable fields
  const [editExplanation, setEditExplanation] = useState(violation.explanation || "");
  const [editEvidence, setEditEvidence] = useState(violation.evidence || "");
  const [editFcraStatute, setEditFcraStatute] = useState(violation.fcraStatute || "");
  const [editEvidenceRequired, setEditEvidenceRequired] = useState(violation.evidenceRequired || "");
  const [editEvidenceProvided, setEditEvidenceProvided] = useState(violation.evidenceProvided || false);
  const [editEvidenceNotes, setEditEvidenceNotes] = useState(violation.evidenceNotes || "");
  const [editConfidence, setEditConfidence] = useState(violation.confidence || "possible");
  const [editCroReminder, setEditCroReminder] = useState(violation.croReminder || "");
  const [editCategory, setEditCategory] = useState(violation.category || "FCRA_REPORTING");
  const [editSeverity, setEditSeverity] = useState(violation.severity || "medium");
  const [editViolationType, setEditViolationType] = useState(violation.violationType || "");
  const [paralegalNotes, setParalegalNotes] = useState(violation.paralegalNotes || "");

  const reviewMutation = useMutation({
    mutationFn: (data: any) => reviewViolation(violation.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      queryClient.invalidateQueries({ queryKey: ["review-summary", scanId] });
    },
  });

  const editMutation = useMutation({
    mutationFn: (data: any) => editViolation(violation.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      queryClient.invalidateQueries({ queryKey: ["review-summary", scanId] });
      setEditing(false);
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
    reviewMutation.mutate(data);
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
    reviewMutation.mutate(data);
  };

  const handleSaveEdits = () => {
    editMutation.mutate({
      explanation: editExplanation,
      evidence: editEvidence,
      fcraStatute: editFcraStatute,
      evidenceRequired: editEvidenceRequired,
      evidenceProvided: editEvidenceProvided,
      evidenceNotes: editEvidenceNotes || null,
      confidence: editConfidence,
      croReminder: editCroReminder || null,
      category: editCategory,
      severity: editSeverity,
      violationType: editViolationType,
      paralegalNotes: paralegalNotes || null,
    });
  };

  const handleCancelEdits = () => {
    setEditExplanation(violation.explanation || "");
    setEditEvidence(violation.evidence || "");
    setEditFcraStatute(violation.fcraStatute || "");
    setEditEvidenceRequired(violation.evidenceRequired || "");
    setEditEvidenceProvided(violation.evidenceProvided || false);
    setEditEvidenceNotes(violation.evidenceNotes || "");
    setEditConfidence(violation.confidence || "possible");
    setEditCroReminder(violation.croReminder || "");
    setEditCategory(violation.category || "FCRA_REPORTING");
    setEditSeverity(violation.severity || "medium");
    setEditViolationType(violation.violationType || "");
    setParalegalNotes(violation.paralegalNotes || "");
    setEditing(false);
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

  const isPending = reviewMutation.isPending || editMutation.isPending;

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
          {isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-border/50 space-y-4">
          {/* Account Context */}
          {account && (
            <div className="pt-4">
              <h4 className="text-sm font-mono font-semibold text-primary mb-2">ACCOUNT DETAILS</h4>
              <div className="bg-background border border-border rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono">
                <div>
                  <span className="text-foreground/50">Creditor:</span>{" "}
                  <span className="text-foreground font-medium">{account.creditor}</span>
                </div>
                {account.accountNumber && (
                  <div>
                    <span className="text-foreground/50">Account #:</span>{" "}
                    <span className="text-foreground">{account.accountNumber}</span>
                  </div>
                )}
                <div>
                  <span className="text-foreground/50">Type:</span>{" "}
                  <span className="text-foreground">{formatAccountType(account.accountType)}</span>
                </div>
                {account.originalCreditor && (
                  <div>
                    <span className="text-foreground/50">Original Creditor:</span>{" "}
                    <span className="text-foreground">{account.originalCreditor}</span>
                  </div>
                )}
                {account.balance !== null && account.balance !== undefined && (
                  <div>
                    <span className="text-foreground/50">Balance:</span>{" "}
                    <span className="text-foreground font-medium">${Number(account.balance).toLocaleString()}</span>
                  </div>
                )}
                {account.status && (
                  <div>
                    <span className="text-foreground/50">Status:</span>{" "}
                    <span className="text-foreground">{account.status}</span>
                  </div>
                )}
                {account.dateOpened && (
                  <div>
                    <span className="text-foreground/50">Date Opened:</span>{" "}
                    <span className="text-foreground">{account.dateOpened}</span>
                  </div>
                )}
                {account.dateOfDelinquency && (
                  <div>
                    <span className="text-foreground/50">DOFD:</span>{" "}
                    <span className="text-foreground">{account.dateOfDelinquency}</span>
                  </div>
                )}
                {account.bureaus && (
                  <div className="md:col-span-2">
                    <span className="text-foreground/50">Bureaus:</span>{" "}
                    <span className="text-foreground">{account.bureaus}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Edit Mode Toggle */}
          {!isLocked && !editing && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                className="px-3 py-1.5 bg-secondary border border-border text-muted-foreground font-mono rounded-lg hover:text-foreground hover:border-primary/30 transition-colors inline-flex items-center gap-2 text-xs"
              >
                <Pencil className="w-3 h-3" /> Edit Violation Details
              </button>
            </div>
          )}

          {/* Edit Mode */}
          {editing && !isLocked && (
            <div className="pt-4 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-mono font-semibold text-primary">EDIT VIOLATION DETAILS</h4>
                <div className="flex gap-2">
                  <button
                    onClick={handleCancelEdits}
                    disabled={editMutation.isPending}
                    className="px-3 py-1.5 bg-secondary border border-border text-muted-foreground font-mono rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-1 text-xs"
                  >
                    <X className="w-3 h-3" /> Cancel
                  </button>
                  <button
                    onClick={handleSaveEdits}
                    disabled={editMutation.isPending}
                    className="px-3 py-1.5 bg-primary text-primary-foreground font-mono rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-1 text-xs disabled:opacity-50"
                  >
                    {editMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Save Changes
                  </button>
                </div>
              </div>

              <div className="bg-background border border-border rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Violation Type</label>
                    <input
                      type="text"
                      value={editViolationType}
                      onChange={(e) => setEditViolationType(e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Severity</label>
                    <select
                      value={editSeverity}
                      onChange={(e) => setEditSeverity(e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                    >
                      {SEVERITY_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Confidence</label>
                    <select
                      value={editConfidence}
                      onChange={(e) => setEditConfidence(e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                    >
                      {CONFIDENCE_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Category</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Explanation</label>
                  <textarea
                    value={editExplanation}
                    onChange={(e) => setEditExplanation(e.target.value)}
                    rows={3}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Evidence</label>
                  <textarea
                    value={editEvidence}
                    onChange={(e) => setEditEvidence(e.target.value)}
                    rows={2}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">FCRA/FDCPA Statute</label>
                  <input
                    type="text"
                    value={editFcraStatute}
                    onChange={(e) => setEditFcraStatute(e.target.value)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Evidence Required</label>
                  <textarea
                    value={editEvidenceRequired}
                    onChange={(e) => setEditEvidenceRequired(e.target.value)}
                    rows={2}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Evidence Provided</label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editEvidenceProvided}
                        onChange={(e) => setEditEvidenceProvided(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm font-mono text-foreground/70">Documentation received</span>
                    </label>
                  </div>
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Evidence Notes</label>
                    <input
                      type="text"
                      value={editEvidenceNotes}
                      onChange={(e) => setEditEvidenceNotes(e.target.value)}
                      placeholder="Notes about evidence received..."
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">CRO Reminder</label>
                  <textarea
                    value={editCroReminder}
                    onChange={(e) => setEditCroReminder(e.target.value)}
                    rows={2}
                    placeholder="What should the CRO ask the client..."
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Paralegal Notes</label>
                  <textarea
                    value={paralegalNotes}
                    onChange={(e) => setParalegalNotes(e.target.value)}
                    rows={3}
                    placeholder="Add paralegal analysis, case notes, observations..."
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>
              </div>

              {editMutation.isError && (
                <p className="text-xs font-mono text-destructive">
                  {(editMutation.error as Error)?.message || "Failed to save changes"}
                </p>
              )}
            </div>
          )}

          {/* Read-only AI Detection Summary (when not editing) */}
          {!editing && (
            <>
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
                <div className="mt-3 flex items-center gap-2 flex-wrap">
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
                      {violation.evidenceNotes && (
                        <span className="text-xs font-mono text-foreground/60">{violation.evidenceNotes}</span>
                      )}
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

              {/* Paralegal Notes (read-only) */}
              {violation.paralegalNotes && (
                <div>
                  <h4 className="text-sm font-mono font-semibold text-primary mb-2">PARALEGAL NOTES</h4>
                  <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3">
                    <p className="text-sm font-mono text-indigo-700 dark:text-indigo-400 whitespace-pre-wrap">{violation.paralegalNotes}</p>
                  </div>
                </div>
              )}
            </>
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
                      disabled={isPending}
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
              {violation.paralegalNotes && <p className="text-sm font-mono text-indigo-600 mt-1">Paralegal: {violation.paralegalNotes}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatAccountType(type: string): string {
  const map: Record<string, string> = {
    debt_collection: "Debt Collection",
    charge_off: "Charge-Off",
    repossession: "Repossession",
  };
  return map[type] || type;
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
