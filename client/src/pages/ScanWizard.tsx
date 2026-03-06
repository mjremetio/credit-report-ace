import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Shield, FileText,
  Loader2, CheckCircle2, Zap, AlertTriangle, ClipboardList, Eye,
  MapPin, ClipboardCheck, Activity, UploadCloud, Database,
  Bot, PenTool, Save
} from "lucide-react";
import {
  fetchScan, updateScan, addNegativeAccount, updateNegativeAccount,
  deleteNegativeAccount, runManualAnalysisPipeline,
  fetchOrganizedReport, runViolationAnalysis, createManualViolation,
} from "@/lib/api";
import ViolationReviewCard from "@/components/ViolationReviewCard";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

const MANUAL_STEPS = [
  { num: 1, label: "Start", icon: Shield },
  { num: 2, label: "Add Accounts", icon: Plus },
  { num: 3, label: "Classify", icon: ClipboardList },
  { num: 4, label: "Next Steps", icon: CheckCircle2 },
];

const UPLOAD_STEPS = [
  { num: 1, label: "Upload / Input", icon: UploadCloud },
  { num: 2, label: "Review Text", icon: FileText },
  { num: 3, label: "AI Structuring", icon: Activity },
  { num: 4, label: "Review Data", icon: Eye },
  { num: 5, label: "Violation Analysis", icon: Zap },
  { num: 6, label: "Complete", icon: CheckCircle2 },
];

type AnalysisMode = "choose" | "ai" | "manual" | null;

const VIOLATION_TYPE_SUGGESTIONS = [
  "Balance Reporting Error",
  "Status Conflict",
  "Date of First Delinquency Inconsistency",
  "Obsolete Reporting (7+ Years)",
  "Duplicate Tradeline",
  "Missing Credit Limit",
  "Payment History Conflict",
  "Re-aging Violation",
  "Cross-Bureau Balance Mismatch",
  "Post-Bankruptcy Balance Not Zero",
  "Debt Collector Disclosure Violation",
  "Cease Contact Violation",
];

const FCRA_STATUTE_SUGGESTIONS = [
  "15 U.S.C. § 1681e(b)",
  "15 U.S.C. § 1681s-2(a)",
  "15 U.S.C. § 1681s-2(b)",
  "15 U.S.C. § 1681c(a)",
  "15 U.S.C. § 1681i",
  "15 U.S.C. § 1692e",
  "15 U.S.C. § 1692g",
  "Cal. Civ. Code § 1785.25(a)",
];

const ACCOUNT_TYPES = [
  { value: "debt_collection", label: "Debt Collection", desc: "Account handled by a collection agency" },
  { value: "charge_off", label: "Charge-Off", desc: "Account written off by original creditor" },
  { value: "repossession", label: "Repossession", desc: "Collateral was repossessed" },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
  "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
];

export default function ScanWizard() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const scanId = parseInt(id || "0");

  const { data: scan, isLoading, error } = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => fetchScan(scanId),
    enabled: scanId > 0 && !isNaN(scanId),
    refetchInterval: 5000,
    retry: 3,
  });

  const updateScanMutation = useMutation({
    mutationFn: (data: { currentStep?: number; status?: string; clientName?: string | null; clientState?: string | null }) => updateScan(scanId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scan", scanId] }),
  });

  // For upload-based scans (hasParsedReport), always show step 4 (Analyze & Review)
  // since the data has already been structured by the upload pipeline.
  // For manual scans, follow the stored currentStep.
  const isUploadBased = scan?.hasParsedReport || false;
  const rawStep = scan?.currentStep || 1;
  // For upload-based scans, always render Step4NextSteps (the analysis/review view)
  // since steps 5-6 are progress indicators, not separate UI screens
  const step = isUploadBased ? 4 : rawStep;

  // For upload-based scans, use persisted currentStep from DB (checkpointed by server pipelines)
  // Fallback: infer from account scan state if DB step seems stale
  const negAccounts = scan?.negativeAccounts || [];
  const allScanned = negAccounts.length > 0 && negAccounts.every((a: any) => a.workflowStep === "scanned");
  const hasViolations = negAccounts.some((a: any) => a.violations?.length > 0);
  // Steps: 1-3=upload/review/structuring (done), 4=review data, 5=violation analysis, 6=complete
  const inferredStep = allScanned || hasViolations ? 6 : 5;
  // Use the higher of DB-persisted step or inferred step (covers cases where DB is behind)
  const uploadActiveStep = isUploadBased ? Math.max(rawStep, inferredStep >= 6 ? 6 : 5) : 5;

  const goToStep = (s: number) => {
    if (s >= 1 && s <= 4) {
      updateScanMutation.mutate({ currentStep: s });
    }
  };

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

  return (
    <div className="h-full">
      <header className="h-16 border-b border-border bg-white flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <button data-testid="button-back-home" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-display font-medium text-lg text-foreground">{scan.consumerName}</h2>
          {scan.clientState && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
              scan.clientState === "CA" ? "border-yellow-500/30 text-yellow-600 bg-yellow-500/10" : "border-border text-muted-foreground bg-secondary"
            }`}>
              <MapPin className="w-3 h-3 inline mr-1" />{scan.clientState}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(isUploadBased ? UPLOAD_STEPS : MANUAL_STEPS).map((s, i, arr) => {
            const isCompleted = isUploadBased
              ? s.num < uploadActiveStep
              : s.num < step;
            const isCurrent = isUploadBased
              ? s.num === uploadActiveStep
              : s.num === step;
            return (
              <div key={s.num} className="flex items-center">
                <button
                  data-testid={`step-indicator-${s.num}`}
                  onClick={() => !isUploadBased && goToStep(s.num)}
                  disabled={isUploadBased}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-all ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary text-muted-foreground"
                  } ${isUploadBased ? "cursor-default" : ""}`}
                >
                  {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5" /> : <s.icon className="w-3.5 h-3.5" />}
                  <span className="hidden md:inline">{s.label}</span>
                </button>
                {i < arr.length - 1 && (
                  <div className={`w-6 h-0.5 mx-1 ${isCompleted || isCurrent ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className={step === 1 ? "" : "hidden"}>
          <Step1Welcome scan={scan} scanId={scanId} goToStep={goToStep} />
        </div>
        <div className={step === 2 ? "" : "hidden"}>
          <Step2AddAccounts scan={scan} scanId={scanId} goToStep={goToStep} />
        </div>
        <div className={step === 3 ? "" : "hidden"}>
          <Step3Classify scan={scan} scanId={scanId} goToStep={goToStep} />
        </div>
        <div className={step === 4 ? "" : "hidden"}>
          <Step4NextSteps scan={scan} scanId={scanId} goToStep={goToStep} navigate={navigate} />
        </div>
      </div>
    </div>
  );
}

function Step1Welcome({ scan, scanId, goToStep }: { scan: any; scanId: number; goToStep: (s: number) => void }) {
  const queryClient = useQueryClient();
  const [clientName, setClientName] = useState(scan.clientName || "");
  const [clientState, setClientState] = useState(scan.clientState || "");

  const updateMutation = useMutation({
    mutationFn: (data: any) => updateScan(scanId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scan", scanId] }),
  });

  const handleProceed = () => {
    if (clientName || clientState) {
      updateMutation.mutate({
        currentStep: 2,
        clientName: clientName || null,
        clientState: clientState || null,
      });
    } else {
      goToStep(2);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-10">
        <div className="p-4 rounded-full bg-primary/10 inline-block mb-4">
          <Shield className="w-10 h-10 text-primary" />
        </div>
        <h2 className="font-display text-3xl text-foreground mb-3">Welcome, {scan.consumerName}</h2>
        <p className="text-muted-foreground font-mono text-sm max-w-lg mx-auto">
          This guided workflow will help you organize your negative credit accounts and identify potential FCRA violations.
        </p>
      </div>

      {/* Client info fields */}
      <div className="bg-card border border-primary/20 rounded-xl p-6 mb-8">
        <h3 className="font-display text-foreground mb-4">Client Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Client Name</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Full client name..."
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">
              Client State {clientState === "CA" && <span className="text-yellow-600">(CA-specific rules apply)</span>}
            </label>
            <select
              value={clientState}
              onChange={(e) => setClientState(e.target.value)}
              className={`w-full bg-background border rounded-lg px-4 py-3 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none ${
                clientState === "CA" ? "border-yellow-500/50" : "border-border"
              }`}
            >
              <option value="">Select state...</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-10">
        {[
          { step: 1, title: "Manual Data Entry", desc: "You're here. Enter client information and begin." },
          { step: 2, title: "Add Negative Accounts", desc: "Enter the negative items from the credit report with all details." },
          { step: 3, title: "Classify Each Account", desc: "Add account details (balance, dates, bureaus, status)." },
          { step: 4, title: "Convert to Structured JSON & AI Analysis", desc: "Convert entries into structured JSON (scores, personal info, bureau summary, tradelines, public records, inquiries, consumer statement), run AI violation analysis, then proceed to paralegal review and export." },
        ].map((item) => (
          <div key={item.step} className={`flex items-start gap-4 p-4 rounded-lg border ${item.step === 1 ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono flex-shrink-0 ${item.step === 1 ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
              {item.step}
            </div>
            <div>
              <h4 className="font-display text-foreground">{item.title}</h4>
              <p className="text-sm text-muted-foreground font-mono">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <button
          data-testid="button-start-step2"
          onClick={handleProceed}
          className="px-8 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2 text-lg"
        >
          Begin <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function Step2AddAccounts({ scan, scanId, goToStep }: { scan: any; scanId: number; goToStep: (s: number) => void }) {
  const queryClient = useQueryClient();
  const [creditor, setCreditor] = useState("");
  const [rawDetails, setRawDetails] = useState("");
  const [accountType, setAccountType] = useState("debt_collection");

  const addMutation = useMutation({
    mutationFn: (data: any) => addNegativeAccount(scanId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      setCreditor("");
      setRawDetails("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (accountId: number) => deleteNegativeAccount(scanId, accountId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scan", scanId] }),
  });

  const handleAdd = () => {
    if (creditor.trim()) {
      addMutation.mutate({
        creditor: creditor.trim(),
        accountType,
        rawDetails: rawDetails.trim() || undefined,
      });
    }
  };

  const negAccounts = scan.negativeAccounts || [];

  return (
    <div>
      <div className="mb-8">
        <h2 className="font-display text-2xl text-foreground mb-2">Add Negative Accounts</h2>
        <p className="text-muted-foreground font-mono text-sm">
          Paste or enter the negative items from your credit report. Include as much detail as possible for better analysis.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Creditor / Company Name *</label>
            <input
              data-testid="input-creditor-name"
              type="text"
              value={creditor}
              onChange={(e) => setCreditor(e.target.value)}
              placeholder="e.g., Portfolio Recovery Associates"
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Account Type *</label>
            <select
              data-testid="select-account-type"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-4">
          <label className="text-xs font-mono text-muted-foreground mb-1 block">
            Paste Raw Account Details from Credit Report
          </label>
          <textarea
            data-testid="textarea-raw-details"
            value={rawDetails}
            onChange={(e) => setRawDetails(e.target.value)}
            placeholder="Paste the full text for this account from your credit report here... Include balance, dates, account numbers, status, and any other details."
            rows={5}
            className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary resize-none"
          />
        </div>
        <button
          data-testid="button-add-account"
          onClick={handleAdd}
          disabled={!creditor.trim() || addMutation.isPending}
          className="px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
        >
          {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add Account
        </button>
      </div>

      {negAccounts.length > 0 && (
        <div className="space-y-3 mb-8">
          <h3 className="font-mono text-xs text-muted-foreground">{negAccounts.length} ACCOUNT{negAccounts.length > 1 ? "S" : ""} ADDED</h3>
          {negAccounts.map((acct: any) => (
            <div
              key={acct.id}
              data-testid={`added-account-${acct.id}`}
              className="bg-card border border-border rounded-lg p-4 flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-secondary">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-foreground font-medium">{acct.creditor}</div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {formatAccountType(acct.accountType)}
                    {acct.rawDetails && " — Details provided"}
                  </div>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    data-testid={`delete-account-${acct.id}`}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Account</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete the account for <strong>{acct.creditor}</strong>? This will remove the account and any associated violation analysis.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={() => deleteMutation.mutate(acct.id)}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <button
          data-testid="button-back-step1"
          onClick={() => goToStep(1)}
          className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          data-testid="button-next-step3"
          onClick={() => goToStep(3)}
          disabled={negAccounts.length === 0}
          className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
        >
          Classify Accounts <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Step3Classify({ scan, scanId, goToStep }: { scan: any; scanId: number; goToStep: (s: number) => void }) {
  const queryClient = useQueryClient();
  const negAccounts = scan.negativeAccounts || [];

  const updateMutation = useMutation({
    mutationFn: ({ accountId, data }: { accountId: number; data: any }) =>
      updateNegativeAccount(scanId, accountId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scan", scanId] }),
  });

  const handleFieldChange = (accountId: number, field: string, value: string) => {
    updateMutation.mutate({ accountId, data: { [field]: value } });
  };

  return (
    <div>
      <div className="mb-8">
        <h2 className="font-display text-2xl text-foreground mb-2">Classify Your Accounts</h2>
        <p className="text-muted-foreground font-mono text-sm">
          Fill in the details for each account. This information helps personalize the dispute workflow.
        </p>
      </div>

      <div className="space-y-6 mb-8">
        {negAccounts.map((acct: any, idx: number) => (
          <AccountClassifyCard
            key={acct.id}
            account={acct}
            index={idx}
            onUpdate={(field, value) => handleFieldChange(acct.id, field, value)}
          />
        ))}
      </div>

      <div className="flex justify-between">
        <button
          data-testid="button-back-step2"
          onClick={() => goToStep(2)}
          className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          data-testid="button-next-step4"
          onClick={() => goToStep(4)}
          className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
        >
          View Next Steps <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function AccountClassifyCard({ account, index, onUpdate }: { account: any; index: number; onUpdate: (field: string, value: string) => void }) {
  const [localValues, setLocalValues] = useState({
    accountType: account.accountType || "debt_collection",
    accountNumber: account.accountNumber || "",
    originalCreditor: account.originalCreditor || "",
    balance: account.balance?.toString() || "",
    dateOpened: account.dateOpened || "",
    dateOfDelinquency: account.dateOfDelinquency || "",
    status: account.status || "",
    bureaus: account.bureaus || "",
  });

  // Keep a ref to the latest local values and account for the cleanup effect
  const localValuesRef = useRef(localValues);
  const accountRef = useRef(account);
  const onUpdateRef = useRef(onUpdate);
  localValuesRef.current = localValues;
  accountRef.current = account;
  onUpdateRef.current = onUpdate;

  // Save any dirty (unsaved) fields on unmount
  useEffect(() => {
    return () => {
      const vals = localValuesRef.current;
      const acct = accountRef.current;
      const update = onUpdateRef.current;
      const fields = ["accountNumber", "originalCreditor", "balance", "dateOpened", "dateOfDelinquency", "status", "bureaus"];
      let hasDirty = false;
      for (const field of fields) {
        const local = (vals as any)[field];
        if (local !== (acct[field] || "")) {
          update(field, local);
          hasDirty = true;
        }
      }
      if (hasDirty && acct.workflowStep === "pending") {
        update("workflowStep", "classified");
      }
    };
  }, []);

  const handleBlur = (field: string) => {
    const val = (localValues as any)[field];
    if (val !== (account[field] || "")) {
      onUpdate(field, val);
      if (account.workflowStep === "pending") {
        onUpdate("workflowStep", "classified");
      }
    }
  };

  const handleTypeChange = (value: string) => {
    setLocalValues(prev => ({ ...prev, accountType: value }));
    onUpdate("accountType", value);
    if (account.workflowStep === "pending") {
      onUpdate("workflowStep", "classified");
    }
  };

  return (
    <div data-testid={`classify-card-${account.id}`} className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-mono font-bold">
            {index + 1}
          </div>
          <h3 className="font-display text-lg text-foreground">{account.creditor}</h3>
        </div>
        <WorkflowBadge step={account.workflowStep} />
      </div>

      <div className="p-6">
        <div className="mb-5">
          <label className="text-xs font-mono text-muted-foreground mb-2 block">Account Type</label>
          <div className="grid grid-cols-3 gap-3">
            {ACCOUNT_TYPES.map((t) => (
              <button
                key={t.value}
                data-testid={`classify-type-${t.value}-${account.id}`}
                onClick={() => handleTypeChange(t.value)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  localValues.accountType === t.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/30"
                }`}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[10px] font-mono mt-1 opacity-70">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Account Number" testId={`input-acct-number-${account.id}`} value={localValues.accountNumber}
            onChange={(v) => setLocalValues(prev => ({ ...prev, accountNumber: v }))}
            onBlur={() => handleBlur("accountNumber")} placeholder="e.g., ****1234" />
          <Field label="Original Creditor" testId={`input-orig-creditor-${account.id}`} value={localValues.originalCreditor}
            onChange={(v) => setLocalValues(prev => ({ ...prev, originalCreditor: v }))}
            onBlur={() => handleBlur("originalCreditor")} placeholder="If different from current" />
          <Field label="Balance ($)" testId={`input-balance-${account.id}`} value={localValues.balance}
            onChange={(v) => setLocalValues(prev => ({ ...prev, balance: v }))}
            onBlur={() => handleBlur("balance")} placeholder="e.g., 2500" />
          <Field label="Reported Status" testId={`input-status-${account.id}`} value={localValues.status}
            onChange={(v) => setLocalValues(prev => ({ ...prev, status: v }))}
            onBlur={() => handleBlur("status")} placeholder="e.g., Collection, Charged Off" />
          <Field label="Date Opened" testId={`input-date-opened-${account.id}`} value={localValues.dateOpened}
            onChange={(v) => setLocalValues(prev => ({ ...prev, dateOpened: v }))}
            onBlur={() => handleBlur("dateOpened")} placeholder="e.g., 2023-01" />
          <Field label="Date of First Delinquency" testId={`input-dofd-${account.id}`} value={localValues.dateOfDelinquency}
            onChange={(v) => setLocalValues(prev => ({ ...prev, dateOfDelinquency: v }))}
            onBlur={() => handleBlur("dateOfDelinquency")} placeholder="e.g., 2022-06" />
          <div className="md:col-span-2">
            <Field label="Reporting Bureaus" testId={`input-bureaus-${account.id}`} value={localValues.bureaus}
              onChange={(v) => setLocalValues(prev => ({ ...prev, bureaus: v }))}
              onBlur={() => handleBlur("bureaus")} placeholder="e.g., Equifax, Experian, TransUnion" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Step4NextSteps({ scan, scanId, goToStep, navigate }: { scan: any; scanId: number; goToStep: (s: number) => void; navigate: (path: string) => void }) {
  const queryClient = useQueryClient();
  const negAccounts = scan.negativeAccounts || [];
  const hasParsedReport = scan.hasParsedReport || false;
  const tradelineCount = scan.tradelineCount || 0;
  const issueFlagCount = scan.issueFlagCount || 0;

  // Fetch organized report data for upload-based scans
  const { data: organizedReport } = useQuery({
    queryKey: ["organized-report", scanId],
    queryFn: () => fetchOrganizedReport(scanId),
    enabled: hasParsedReport && scanId > 0,
  });

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    personalInfo: true,
    scores: true,
    accountSummary: true,
    tradelines: false,
    collections: false,
    publicRecords: false,
    inquiries: false,
    consumerStatements: false,
  });
  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const [scanError, setScanError] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<any>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(null);

  // Manual violation entry state
  const emptyViolation = () => ({
    negativeAccountId: negAccounts[0]?.id || 0,
    violationType: "",
    severity: "medium",
    explanation: "",
    fcraStatute: "",
    evidence: "",
    category: "FCRA_REPORTING",
    confidence: "confirmed",
  });
  const [manualViolations, setManualViolations] = useState([emptyViolation()]);
  const [manualSaving, setManualSaving] = useState(false);

  const addManualViolationRow = () => setManualViolations(prev => [...prev, emptyViolation()]);
  const removeManualViolationRow = (idx: number) => setManualViolations(prev => prev.filter((_, i) => i !== idx));
  const updateManualViolation = (idx: number, field: string, value: string) =>
    setManualViolations(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));

  const handleSaveManualViolations = async () => {
    const valid = manualViolations.filter(v => v.violationType && v.explanation && v.fcraStatute && v.negativeAccountId);
    if (valid.length === 0) return;
    setManualSaving(true);
    setScanError(null);
    try {
      for (const v of valid) {
        await createManualViolation(v);
      }
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      navigate(`/review/${scanId}`);
    } catch (err: any) {
      setScanError(err.message || "Failed to save violations");
    }
    setManualSaving(false);
  };

  // Full pipeline: Use appropriate pipeline based on scan type
  const handleRunPipeline = async () => {
    setScanError(null);
    setPipelineRunning(true);
    try {
      // Upload-based scans already have structured data; run violation-only pipeline
      // Manual scans need the full pipeline (convert manual entries → structured JSON → violations)
      const result = hasParsedReport
        ? await runViolationAnalysis(scanId)
        : await runManualAnalysisPipeline(scanId);
      setPipelineResult(result);
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      // Auto-navigate to review after analysis completes
      navigate(`/review/${scanId}`);
    } catch (err: any) {
      setScanError(err.message || "Pipeline failed. Please try again.");
    }
    setPipelineRunning(false);
  };

  const totalViolationCount = negAccounts.reduce((sum: number, a: any) => sum + (a.violations?.length || 0), 0);
  const allScanned = negAccounts.length > 0 && negAccounts.every((a: any) => a.workflowStep === "scanned");
  const hasViolations = negAccounts.some((a: any) => a.violations?.length > 0);
  const analysisComplete = allScanned || pipelineResult || hasViolations;

  // Group violations by category
  const fcraViolations = negAccounts.flatMap((a: any) =>
    (a.violations || []).filter((v: any) => !v.category || v.category === "FCRA_REPORTING")
  );
  const debtCollectorViolations = negAccounts.flatMap((a: any) =>
    (a.violations || []).filter((v: any) => v.category && v.category !== "FCRA_REPORTING")
  );

  // Build a map from violation id to the account it belongs to
  const violationAccountMap = new Map<number, any>();
  for (const acct of negAccounts) {
    for (const v of (acct.violations || [])) {
      violationAccountMap.set(v.id, acct);
    }
  }

  return (
    <div>
      {/* Workflow Progress */}
      <div className="mb-6 bg-card border border-border rounded-xl p-5">
        <h4 className="font-display text-foreground text-sm mb-3">
          {hasParsedReport ? "Workflow Progress" : "Violation Analysis"}
        </h4>
        <div className="space-y-2 text-xs font-mono">
          {hasParsedReport ? (
            <>
              {[
                { label: "Upload / Input", done: true },
                { label: "Review Text", done: true },
                { label: `AI Structuring — ${tradelineCount} tradeline(s), ${issueFlagCount} issue flag(s)`, done: true },
                { label: `Review Data — ${negAccounts.length} account(s) detected`, done: true },
                {
                  label: analysisComplete
                    ? `Violation Analysis — ${totalViolationCount} violation(s) found`
                    : `Violation Analysis — ${negAccounts.length} account(s) pending`,
                  done: analysisComplete,
                  current: !analysisComplete,
                },
                { label: "Complete", done: false, current: analysisComplete },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  {item.done ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  ) : item.current ? (
                    pipelineRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                    ) : (
                      <Zap className="w-4 h-4 text-primary flex-shrink-0" />
                    )
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-border flex-shrink-0" />
                  )}
                  <span className={
                    item.done ? "text-green-600" : item.current ? "text-primary font-semibold" : "text-muted-foreground/50"
                  }>{item.label}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span className="text-muted-foreground">Manual data entry — {negAccounts.length} account(s) added</span>
              </div>
              <div className="flex items-center gap-2">
                {analysisComplete ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                ) : pipelineRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                ) : (
                  <Zap className="w-4 h-4 text-primary flex-shrink-0" />
                )}
                <span className={analysisComplete ? "text-muted-foreground" : "text-primary font-semibold"}>
                  {analysisComplete
                    ? `AI violation analysis complete — ${totalViolationCount} violation(s) found`
                    : "Convert into Structured JSON & AI violation analysis"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {analysisComplete ? (
                  <ClipboardCheck className="w-4 h-4 text-primary flex-shrink-0" />
                ) : (
                  <ClipboardCheck className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                )}
                <span className={analysisComplete ? "text-primary" : "text-muted-foreground/50"}>
                  Review & export (auto-redirects after analysis)
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Consumer Header & Summary Stats (Upload-based scans) */}
      {hasParsedReport && (
        <div className="mb-6 bg-card border border-primary/30 rounded-xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Database className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Consumer</p>
              <h3 className="font-display text-2xl text-foreground">
                {organizedReport?.personalInformation?.name || scan.consumerName || "Unknown Consumer"}
              </h3>
            </div>
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background/50 border border-border rounded-lg p-3 text-center">
              <div className="text-2xl font-display text-foreground">{tradelineCount}</div>
              <div className="text-xs font-mono text-muted-foreground mt-1">Tradelines</div>
            </div>
            <div className="bg-background/50 border border-border rounded-lg p-3 text-center">
              <div className="text-2xl font-display text-foreground">{issueFlagCount}</div>
              <div className="text-xs font-mono text-muted-foreground mt-1">Issue Flags</div>
            </div>
          </div>

          <p className="text-xs font-mono text-muted-foreground mt-3 text-center">
            Structured JSON created. Review the data below, then proceed to violation analysis.
          </p>
        </div>
      )}

      {/* Organized Report Sections (Upload-based scans - matching Upload page) */}
      {hasParsedReport && organizedReport && (
        <div className="mb-6 space-y-3">
          {/* Personal Information */}
          <CollapsibleSection
            title="Personal Information"
            icon={<Eye className="w-4 h-4 text-primary" />}
            expanded={expandedSections.personalInfo}
            onToggle={() => toggleSection("personalInfo")}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <ReportField label="Full Name" value={organizedReport.personalInformation?.name} />
                <ReportField label="SSN" value={organizedReport.personalInformation?.ssn} />
                <ReportField label="Report Date" value={organizedReport.personalInformation?.reportDate} />
              </div>

              {organizedReport.personalInformation?.dateOfBirthPerBureau && (
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-2">Date of Birth</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                      const entry = organizedReport.personalInformation?.dateOfBirthPerBureau?.find((e: any) => e.bureau === bureau);
                      return (
                        <div key={bureau} className="bg-background/30 border border-border rounded-lg p-2 text-center">
                          <p className="text-[10px] font-mono text-muted-foreground mb-0.5">{bureau}</p>
                          <p className={`text-xs font-mono ${entry?.value ? "text-foreground" : "text-muted-foreground/50"}`}>
                            {entry?.value || "--"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {organizedReport.personalInformation?.addresses?.length > 0 && (
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-2">Addresses</p>
                  <div className="space-y-1">
                    {organizedReport.personalInformation.addresses.map((addr: any, i: number) => (
                      <div key={i} className="bg-background/30 rounded px-3 py-2 text-xs font-mono text-foreground flex items-center justify-between">
                        <span>{addr.address}</span>
                        <span className="text-muted-foreground text-[10px]">{addr.bureaus?.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {organizedReport.personalInformation?.employers?.length > 0 && (
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-2">Employers</p>
                  <div className="space-y-1">
                    {organizedReport.personalInformation.employers.map((emp: any, i: number) => (
                      <div key={i} className="bg-background/30 rounded px-3 py-2 text-xs font-mono text-foreground flex items-center justify-between">
                        <span>{emp.name}</span>
                        <span className="text-muted-foreground text-[10px]">{emp.bureaus?.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Credit Scores */}
          <CollapsibleSection
            title="Credit Scores"
            icon={<Shield className="w-4 h-4 text-primary" />}
            expanded={expandedSections.scores}
            onToggle={() => toggleSection("scores")}
          >
            <div className="grid grid-cols-3 gap-3">
              {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                const scoreData = organizedReport.creditScores?.[bureau];
                return (
                  <div key={bureau} className="bg-background/30 border border-border rounded-lg p-4 text-center">
                    <p className="text-xs font-mono text-muted-foreground mb-1">{bureau}</p>
                    <p className={`text-3xl font-display ${scoreData?.score ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {scoreData?.score ?? "N/A"}
                    </p>
                    {scoreData?.model && (
                      <p className="text-[10px] font-mono text-muted-foreground mt-1">{scoreData.model}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>

          {/* Account Summary */}
          {organizedReport.accountSummary && (
            <CollapsibleSection
              title="Account Summary"
              icon={<FileText className="w-4 h-4 text-primary" />}
              expanded={expandedSections.accountSummary}
              onToggle={() => toggleSection("accountSummary")}
            >
              {organizedReport.accountSummary.perBureau?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left py-2 pr-3">Metric</th>
                        {organizedReport.accountSummary.perBureau.map((b: any) => (
                          <th key={b.bureau} className="text-center py-2 px-2">{b.bureau}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {["totalAccounts", "openAccounts", "closedAccounts", "derogatoryAccounts", "balanceTotal"].map(metric => (
                        <tr key={metric} className="border-b border-border/50">
                          <td className="py-2 pr-3 text-muted-foreground capitalize">{metric.replace(/([A-Z])/g, " $1").trim()}</td>
                          {organizedReport.accountSummary.perBureau.map((b: any) => (
                            <td key={b.bureau} className="text-center py-2 px-2 text-foreground">
                              {metric === "balanceTotal" && b[metric] != null ? `$${Number(b[metric]).toLocaleString()}` : b[metric] ?? "--"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs font-mono text-muted-foreground">No account summary data.</p>
              )}
            </CollapsibleSection>
          )}

          {/* Account History */}
          <CollapsibleSection
            title={`Account History (${organizedReport.accountHistory?.length || 0})`}
            icon={<FileText className="w-4 h-4 text-primary" />}
            expanded={expandedSections.tradelines}
            onToggle={() => toggleSection("tradelines")}
          >
            {organizedReport.accountHistory?.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {organizedReport.accountHistory.map((tl: any, i: number) => (
                  <TradelineDetailRow key={i} tradeline={tl} />
                ))}
              </div>
            ) : (
              <p className="text-xs font-mono text-muted-foreground">No account history found.</p>
            )}
          </CollapsibleSection>

          {/* Collections */}
          {organizedReport.collections?.length > 0 && (
            <CollapsibleSection
              title={`Collections (${organizedReport.collections.length})`}
              icon={<AlertTriangle className="w-4 h-4 text-destructive" />}
              expanded={expandedSections.collections}
              onToggle={() => toggleSection("collections")}
            >
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {organizedReport.collections.map((tl: any, i: number) => (
                  <div key={i} className="bg-background/30 border border-border rounded-lg p-3 text-xs font-mono">
                    <div className="flex justify-between items-center">
                      <span className="text-foreground font-medium">{tl.creditorName}</span>
                      <span className="text-muted-foreground text-[10px]">{tl.bureaus?.join(", ")}</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-muted-foreground">
                      {tl.balance != null && <span>Balance: ${Number(tl.balance).toLocaleString()}</span>}
                      {tl.originalCreditor && <span>Original: {tl.originalCreditor}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Public Records */}
          <CollapsibleSection
            title={`Public Records (${organizedReport.publicInformation?.length || 0})`}
            icon={<FileText className="w-4 h-4 text-primary" />}
            expanded={expandedSections.publicRecords}
            onToggle={() => toggleSection("publicRecords")}
          >
            {organizedReport.publicInformation?.length > 0 ? (
              <div className="space-y-2">
                {organizedReport.publicInformation.map((pr: any, i: number) => (
                  <div key={i} className="bg-background/30 border border-border rounded-lg p-3 text-xs font-mono">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-foreground font-medium">{pr.type}</span>
                    </div>
                    <div className="flex gap-2 mb-2">
                      {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                        const isReported = pr.bureaus?.includes(bureau);
                        return (
                          <div key={bureau} className={`px-2 py-1 rounded text-[10px] border ${isReported ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground/40 border-border"}`}>
                            {bureau}: {isReported ? "Reported" : "Not Reported"}
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                      {pr.court && <p>Court: {pr.court}</p>}
                      {pr.caseNumber && <p>Case #: {pr.caseNumber}</p>}
                      {pr.dateFiled && <p>Filed: {pr.dateFiled}</p>}
                      {pr.dateDischarged && <p>Discharged: {pr.dateDischarged}</p>}
                      {pr.amount != null && <p>Amount: ${pr.amount?.toLocaleString()}</p>}
                    </div>
                    {pr.remarks?.length > 0 && (
                      <div className="mt-1">
                        {pr.remarks.map((r: string, ri: number) => (
                          <p key={ri} className="text-[10px] text-muted-foreground">- {r}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs font-mono text-muted-foreground">No public records found.</p>
            )}
          </CollapsibleSection>

          {/* Inquiries */}
          <CollapsibleSection
            title={`Inquiries (${organizedReport.inquiries?.length || 0})`}
            icon={<Eye className="w-4 h-4 text-primary" />}
            expanded={expandedSections.inquiries}
            onToggle={() => toggleSection("inquiries")}
          >
            {organizedReport.inquiries?.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {(["TransUnion", "Experian", "Equifax"] as const).map(bureau => {
                  const bureauInquiries = organizedReport.inquiries.filter((inq: any) => inq.bureau === bureau);
                  if (bureauInquiries.length === 0) return null;
                  return (
                    <div key={bureau}>
                      <p className="text-[10px] font-mono text-primary font-medium mb-1">{bureau} ({bureauInquiries.length})</p>
                      <div className="space-y-1">
                        {bureauInquiries.map((inq: any, i: number) => (
                          <div key={i} className="bg-background/30 rounded px-3 py-2 text-xs font-mono flex items-center justify-between">
                            <span className="text-foreground">{inq.creditorName}</span>
                            <div className="flex items-center gap-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                inq.type === "hard"
                                  ? "bg-destructive/10 text-destructive border border-destructive/30"
                                  : "bg-secondary text-muted-foreground border border-border"
                              }`}>{inq.type}</span>
                              <span className="text-muted-foreground">{inq.date}</span>
                              {inq.permissiblePurpose && (
                                <span className="text-muted-foreground text-[10px]">{inq.permissiblePurpose}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs font-mono text-muted-foreground">No inquiries found.</p>
            )}
          </CollapsibleSection>
        </div>
      )}

      {/* Pipeline Result Banner */}
      {pipelineResult && (
        <div className="mb-6 bg-green-500/5 border border-green-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <h4 className="font-display text-foreground text-sm">
              {hasParsedReport ? "Violation Analysis Complete" : "Full Analysis Pipeline Complete"}
            </h4>
          </div>
          <div className={`grid gap-4 text-center ${hasParsedReport ? "grid-cols-3" : "grid-cols-3"}`}>
            <div>
              <div className="text-2xl font-display text-foreground">{hasParsedReport ? tradelineCount : pipelineResult.accountsCreated}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Tradelines</div>
            </div>
            <div>
              <div className="text-2xl font-display text-foreground">{pipelineResult.violationsFound}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Violations</div>
            </div>
            <div>
              <div className="text-2xl font-display text-foreground">{hasParsedReport ? issueFlagCount : (pipelineResult.issueFlagsDetected || 0)}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Issue Flags</div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis complete banner (for upload-generated scans where pipelineResult isn't set) */}
      {!pipelineResult && allScanned && hasParsedReport && totalViolationCount > 0 && (
        <div className="mb-6 bg-green-500/5 border border-green-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <h4 className="font-display text-foreground text-sm">Upload Analysis Complete</h4>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-display text-foreground">{tradelineCount}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Tradelines</div>
            </div>
            <div>
              <div className="text-2xl font-display text-foreground">{totalViolationCount}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Violations</div>
            </div>
            <div>
              <div className="text-2xl font-display text-foreground">{issueFlagCount}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Issue Flags</div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Mode Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h2 className="font-display text-2xl text-foreground mb-2">
            {analysisComplete ? "Analyze & Review" : analysisMode === "manual" ? "Manual Violation Entry" : "Choose Analysis Method"}
          </h2>
          <p className="text-muted-foreground font-mono text-sm">
            {analysisComplete
              ? "Analysis complete. Edit violations below or proceed to review."
              : analysisMode === "manual"
              ? "Add violations you have identified. Each violation will be saved to the scan."
              : "Select how you want to identify violations in the credit report data."}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {analysisComplete && (
            <button
              data-testid="button-rerun-analysis"
              onClick={() => setAnalysisMode("choose")}
              className="px-4 py-2 bg-secondary border border-border text-muted-foreground font-mono rounded-lg hover:text-foreground hover:border-primary/30 transition-colors inline-flex items-center gap-2 text-xs"
            >
              <Zap className="w-3 h-3" />
              Re-analyze
            </button>
          )}
        </div>
      </div>

      {scanError && (
        <div data-testid="scan-error" className="mb-6 bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
          <p className="text-sm font-mono text-destructive">{scanError}</p>
        </div>
      )}

      {/* Pipeline running indicator */}
      {pipelineRunning && (
        <div className="mb-6 bg-primary/5 border border-primary/30 rounded-xl p-6 text-center">
          <Activity className="w-8 h-8 text-primary animate-pulse mx-auto mb-3" />
          <h4 className="font-display text-foreground mb-2">
            {hasParsedReport ? "Running Violation Analysis..." : "Running Full Analysis Pipeline..."}
          </h4>
          <p className="text-xs font-mono text-muted-foreground">
            {hasParsedReport
              ? `Scanning ${negAccounts.length} negative account(s) for FCRA & FDCPA violations...`
              : `Converting ${negAccounts.length} account(s) to structured JSON and running AI violation analysis...`
            }
          </p>
        </div>
      )}

      {/* Analysis Mode Chooser - shown when no analysis done yet or re-analyze requested */}
      {!analysisComplete && !pipelineRunning && analysisMode !== "manual" && (
        <div className="space-y-4 mb-8">
          <div className="bg-card border border-primary/30 rounded-xl p-6 text-center">
            <Shield className="w-10 h-10 text-primary mx-auto mb-3" />
            <h3 className="font-display text-xl text-foreground mb-2">Choose Violation Analysis Method</h3>
            <p className="text-sm font-mono text-muted-foreground max-w-lg mx-auto">
              Select how you want to identify violations for {negAccounts.length} account(s).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* AI Analysis Option */}
            <button
              data-testid="button-ai-analysis"
              onClick={handleRunPipeline}
              disabled={negAccounts.length === 0}
              className="bg-card border-2 border-border hover:border-primary/50 rounded-xl p-6 text-left transition-all group disabled:opacity-50"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Bot className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h4 className="font-display text-lg text-foreground">AI Analysis</h4>
                  <span className="text-xs font-mono text-primary px-2 py-0.5 rounded bg-primary/10">Recommended</span>
                </div>
              </div>
              <p className="text-sm font-mono text-muted-foreground mb-3">
                Automatically scan all tradelines for FCRA/FDCPA violations using AI. Detects balance errors, status conflicts, date issues, duplicates, and debt collector conduct violations.
              </p>
              <ul className="space-y-1.5 text-xs font-mono text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                  Scans all negative tradelines automatically
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                  Cross-bureau comparison and pattern matching
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                  FCRA statute auto-citation
                </li>
              </ul>
              <div className="mt-4 flex items-center gap-2 text-primary font-medium text-sm">
                <ArrowRight className="w-4 h-4" />
                {hasParsedReport ? "Run AI Violation Analysis" : "Run Full Analysis Pipeline"}
              </div>
            </button>

            {/* Manual Entry Option */}
            <button
              data-testid="button-manual-analysis"
              onClick={() => setAnalysisMode("manual")}
              disabled={negAccounts.length === 0}
              className="bg-card border-2 border-border hover:border-primary/50 rounded-xl p-6 text-left transition-all group disabled:opacity-50"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-full bg-yellow-500/10 group-hover:bg-yellow-500/20 transition-colors">
                  <PenTool className="w-6 h-6 text-yellow-600" />
                </div>
                <div>
                  <h4 className="font-display text-lg text-foreground">Manual Entry</h4>
                  <span className="text-xs font-mono text-yellow-600 px-2 py-0.5 rounded bg-yellow-500/10">Expert Mode</span>
                </div>
              </div>
              <p className="text-sm font-mono text-muted-foreground mb-3">
                Manually enter violations based on your own analysis. Ideal for paralegals and credit repair specialists who have identified specific issues.
              </p>
              <ul className="space-y-1.5 text-xs font-mono text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />
                  Full control over violation details
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />
                  Add custom FCRA/FDCPA citations
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />
                  Violations pre-confirmed for faster review
                </li>
              </ul>
              <div className="mt-4 flex items-center gap-2 text-yellow-600 font-medium text-sm">
                <ArrowRight className="w-4 h-4" />
                Enter Violations Manually
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Re-analyze chooser (when analysis already complete and user clicked Re-analyze) */}
      {analysisComplete && analysisMode === "choose" && !pipelineRunning && (
        <div className="space-y-4 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => { setAnalysisMode("ai"); handleRunPipeline(); }}
              className="bg-card border-2 border-border hover:border-primary/50 rounded-xl p-5 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <Bot className="w-5 h-5 text-primary" />
                <div>
                  <h4 className="font-display text-foreground">Re-run AI Analysis</h4>
                  <p className="text-xs font-mono text-muted-foreground mt-1">Re-scan all accounts with AI</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => setAnalysisMode("manual")}
              className="bg-card border-2 border-border hover:border-primary/50 rounded-xl p-5 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <PenTool className="w-5 h-5 text-yellow-600" />
                <div>
                  <h4 className="font-display text-foreground">Add Manual Violations</h4>
                  <p className="text-xs font-mono text-muted-foreground mt-1">Enter violations manually</p>
                </div>
              </div>
            </button>
          </div>
          <button
            onClick={() => setAnalysisMode(null)}
            className="px-4 py-2 text-muted-foreground font-mono text-xs hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" /> Cancel
          </button>
        </div>
      )}

      {/* Manual Violation Entry Form */}
      {analysisMode === "manual" && !pipelineRunning && (
        <div className="space-y-4 mb-8">
          <div className="bg-card border border-yellow-500/30 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <PenTool className="w-5 h-5 text-yellow-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-display text-lg text-foreground">Manual Violation Entry</h3>
                <p className="text-xs font-mono text-muted-foreground">
                  Add violations you have identified in the credit report. Each violation will be saved to the scan.
                </p>
              </div>
              <span className="text-xs font-mono px-2 py-1 rounded border border-yellow-500/30 text-yellow-600 bg-yellow-500/10">
                {manualViolations.filter(v => v.violationType && v.explanation && v.fcraStatute).length} valid
              </span>
            </div>
          </div>

          {/* Violation Entry Cards */}
          <div className="space-y-4">
            {manualViolations.map((violation, index) => (
              <div key={index} className="bg-card border border-border rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-mono font-semibold text-primary">
                    VIOLATION #{index + 1}
                  </h4>
                  {manualViolations.length > 1 && (
                    <button
                      onClick={() => removeManualViolationRow(index)}
                      className="p-1.5 text-destructive/60 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Account selector */}
                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Account *</label>
                  <select
                    value={violation.negativeAccountId}
                    onChange={(e) => updateManualViolation(index, "negativeAccountId", e.target.value)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                  >
                    {negAccounts.map((acct: any) => (
                      <option key={acct.id} value={acct.id}>{acct.creditor} — {formatAccountType(acct.accountType)}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Violation Type *</label>
                    <input
                      type="text"
                      list={`scan-vtype-suggestions-${index}`}
                      value={violation.violationType}
                      onChange={(e) => updateManualViolation(index, "violationType", e.target.value)}
                      placeholder="e.g. Balance Reporting Error"
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
                    />
                    <datalist id={`scan-vtype-suggestions-${index}`}>
                      {VIOLATION_TYPE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Severity *</label>
                    <select
                      value={violation.severity}
                      onChange={(e) => updateManualViolation(index, "severity", e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                    >
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">FCRA/FDCPA Statute *</label>
                    <input
                      type="text"
                      list={`scan-statute-suggestions-${index}`}
                      value={violation.fcraStatute}
                      onChange={(e) => updateManualViolation(index, "fcraStatute", e.target.value)}
                      placeholder="e.g. 15 U.S.C. § 1681e(b)"
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
                    />
                    <datalist id={`scan-statute-suggestions-${index}`}>
                      {FCRA_STATUTE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-xs font-mono text-foreground/60 mb-1 block">Category</label>
                    <select
                      value={violation.category}
                      onChange={(e) => updateManualViolation(index, "category", e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                    >
                      <option value="FCRA_REPORTING">FCRA Reporting</option>
                      <option value="DEBT_COLLECTOR_DISCLOSURE">Debt Collector Disclosure</option>
                      <option value="CA_LICENSE_MISSING">CA License Missing</option>
                      <option value="CEASE_CONTACT_VIOLATION">Cease Contact Violation</option>
                      <option value="INCONVENIENT_CONTACT">Inconvenient Contact</option>
                      <option value="THIRD_PARTY_DISCLOSURE">Third-Party Disclosure</option>
                      <option value="HARASSMENT_EXCESSIVE_CALLS">Harassment / Excessive Calls</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Explanation *</label>
                  <textarea
                    value={violation.explanation}
                    onChange={(e) => updateManualViolation(index, "explanation", e.target.value)}
                    rows={2}
                    placeholder="Describe the violation and why it constitutes a reporting error..."
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary resize-none placeholder:text-muted-foreground/40"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Evidence</label>
                  <textarea
                    value={violation.evidence}
                    onChange={(e) => updateManualViolation(index, "evidence", e.target.value)}
                    rows={2}
                    placeholder="Specific data points or report details that support this violation..."
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary resize-none placeholder:text-muted-foreground/40"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-foreground/60 mb-1 block">Confidence</label>
                  <select
                    value={violation.confidence}
                    onChange={(e) => updateManualViolation(index, "confidence", e.target.value)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary appearance-none"
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="likely">Likely</option>
                    <option value="possible">Possible</option>
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Add More / Save Buttons */}
          <div className="flex gap-3">
            <button
              onClick={addManualViolationRow}
              className="px-4 py-2.5 bg-secondary border border-border text-foreground rounded-lg hover:bg-secondary/80 transition-colors font-mono text-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Another Violation
            </button>
            <button
              onClick={handleSaveManualViolations}
              disabled={manualSaving || manualViolations.filter(v => v.violationType && v.explanation && v.fcraStatute).length === 0}
              className="flex-1 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {manualSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Violations & Go to Review
                </>
              )}
            </button>
          </div>

          <button
            onClick={() => setAnalysisMode(null)}
            className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors font-mono text-sm inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Analysis Mode
          </button>
        </div>
      )}

      {/* Violation summary banner */}
      {totalViolationCount > 0 && (
        <div className="mb-6 bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-primary" />
            <span className="text-sm font-mono text-foreground">
              {totalViolationCount} violation{totalViolationCount !== 1 ? "s" : ""} detected across {negAccounts.filter((a: any) => a.violations?.length > 0).length} account{negAccounts.filter((a: any) => a.violations?.length > 0).length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            {fcraViolations.length > 0 && (
              <span className="text-blue-600">FCRA: {fcraViolations.length}</span>
            )}
            {debtCollectorViolations.length > 0 && (
              <span className="text-purple-600">FDCPA: {debtCollectorViolations.length}</span>
            )}
          </div>
        </div>
      )}

      {/* Violations grouped by account - editable inline */}
      {analysisComplete && (
        <div className="space-y-6 mb-8">
          {negAccounts.map((acct: any) => {
            const acctViolations = acct.violations || [];
            if (acctViolations.length === 0) return null;

            // Split violations by category
            const acctFcra = acctViolations.filter((v: any) => !v.category || v.category === "FCRA_REPORTING");
            const acctFdcpa = acctViolations.filter((v: any) => v.category && v.category !== "FCRA_REPORTING");

            return (
              <div key={acct.id} data-testid={`nextstep-account-${acct.id}`} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-secondary/30">
                  <h3 className="font-display text-lg text-foreground">{acct.creditor}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-mono text-muted-foreground">{formatAccountType(acct.accountType)}</span>
                    {acct.balance && <span className="text-xs font-mono text-foreground">${Number(acct.balance).toLocaleString()}</span>}
                    <span className="text-xs font-mono text-muted-foreground">{acctViolations.length} violation{acctViolations.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  {/* FCRA Violations */}
                  {acctFcra.length > 0 && (
                    <div>
                      <h4 className="text-xs font-mono text-blue-600 mb-3 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> FCRA REPORTING VIOLATIONS ({acctFcra.length})
                      </h4>
                      <div className="space-y-3">
                        {acctFcra.map((v: any) => (
                          <ViolationReviewCard
                            key={v.id}
                            violation={v}
                            account={acct}
                            scanId={scanId}
                            isLocked={false}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* FDCPA Violations */}
                  {acctFdcpa.length > 0 && (
                    <div>
                      <h4 className="text-xs font-mono text-purple-600 mb-3 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> DEBT COLLECTOR CONDUCT VIOLATIONS ({acctFdcpa.length})
                      </h4>
                      <div className="space-y-3">
                        {acctFdcpa.map((v: any) => (
                          <ViolationReviewCard
                            key={v.id}
                            violation={v}
                            account={acct}
                            scanId={scanId}
                            isLocked={false}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Accounts without violations after analysis */}
      {analysisComplete && negAccounts.filter((a: any) => !a.violations?.length).length > 0 && (
        <div className="mb-8 space-y-3">
          {negAccounts.filter((a: any) => !a.violations?.length).map((acct: any) => (
            <div key={acct.id} className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
              <div>
                <span className="text-sm text-green-600 font-mono font-medium">{acct.creditor}</span>
                <span className="text-xs font-mono text-green-600/70 ml-2">— No violations detected</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <button
          data-testid="button-back-step3"
          onClick={() => goToStep(3)}
          className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex gap-3">
          {analysisComplete && (
            <button
              data-testid="button-begin-review"
              onClick={() => navigate(`/review/${scanId}`)}
              className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
            >
              <ClipboardCheck className="w-4 h-4" /> Go to Review
            </button>
          )}
          <button
            data-testid="button-view-profile"
            onClick={() => navigate("/profile")}
            className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-2"
          >
            <Eye className="w-4 h-4" /> View Profile
          </button>
        </div>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title, icon, expanded, onToggle, children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-display text-sm text-foreground">{title}</span>
        </div>
        {expanded ? (
          <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-90" />
        ) : (
          <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90" />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReportField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="bg-background/30 rounded-lg px-3 py-2">
      <p className="text-[10px] font-mono text-muted-foreground mb-0.5">{label}</p>
      <p className="text-xs font-mono text-foreground">{value || "N/A"}</p>
    </div>
  );
}


function TradelineDetailRow({ tradeline }: { tradeline: any }) {
  const [expanded, setExpanded] = useState(false);
  const statusColors: Record<string, string> = {
    current: "text-green-600 bg-green-500/10 border-green-500/30",
    closed: "text-muted-foreground bg-secondary border-border",
    paid: "text-green-600 bg-green-500/10 border-green-500/30",
    late: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
    chargeoff: "text-destructive bg-destructive/10 border-destructive/30",
    collection: "text-destructive bg-destructive/10 border-destructive/30",
    derogatory: "text-destructive bg-destructive/10 border-destructive/30",
    repossession: "text-destructive bg-destructive/10 border-destructive/30",
  };

  const statusClass = statusColors[tradeline.aggregateStatus] || "text-muted-foreground bg-secondary border-border";
  const bureauDetails: any[] = tradeline.bureauDetails || [];
  const allBureaus = ["TransUnion", "Experian", "Equifax"] as const;

  const getBureauDetail = (bureau: string) =>
    bureauDetails.find((bd: any) => bd.bureau === bureau) || null;

  const reportedBureaus = allBureaus.filter(b =>
    (tradeline.bureaus || []).includes(b) || getBureauDetail(b)
  );

  const detailFields: Array<{ label: string; key: string; format?: "currency" | "date" }> = [
    { label: "Account #", key: "accountNumber" },
    { label: "Status", key: "status" },
    { label: "Balance", key: "balance", format: "currency" },
    { label: "Credit Limit", key: "creditLimit", format: "currency" },
    { label: "High Balance", key: "highBalance", format: "currency" },
    { label: "Monthly Payment", key: "monthlyPayment", format: "currency" },
    { label: "Past Due", key: "pastDueAmount", format: "currency" },
    { label: "Date Opened", key: "dateOpened", format: "date" },
    { label: "Date Closed", key: "dateClosed", format: "date" },
    { label: "Last Payment", key: "lastPaymentDate", format: "date" },
    { label: "Last Reported", key: "lastReportedDate", format: "date" },
    { label: "Payment Status", key: "paymentStatus" },
    { label: "Account Rating", key: "accountRating" },
    { label: "Creditor Type", key: "creditorType" },
    { label: "Terms", key: "terms" },
  ];

  const formatDetailValue = (val: any, format?: string) => {
    if (val == null || val === undefined || val === "") return null;
    if (format === "currency") return `$${Number(val).toLocaleString()}`;
    return String(val);
  };

  const activeFields = detailFields.filter(field =>
    allBureaus.some(b => {
      const detail = getBureauDetail(b);
      return detail && formatDetailValue(detail[field.key], field.format) !== null;
    })
  );

  return (
    <div className="bg-background/30 border border-border rounded-lg text-xs font-mono">
      <button
        className="w-full p-3 text-left hover:bg-secondary/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-foreground font-medium">{tradeline.creditorName}</span>
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${statusClass}`}>
              {tradeline.aggregateStatus}
            </span>
            {bureauDetails.length > 0 && (
              expanded
                ? <ArrowLeft className="w-3 h-3 text-muted-foreground rotate-90" />
                : <ArrowRight className="w-3 h-3 text-muted-foreground rotate-90" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          {tradeline.accountNumberMasked && <span>#{tradeline.accountNumberMasked}</span>}
          <span>{tradeline.accountType}</span>
          {tradeline.balance != null && <span>${tradeline.balance.toLocaleString()}</span>}
          <span className="ml-auto text-[10px]">{reportedBureaus.join(", ")}</span>
        </div>
      </button>

      {expanded && bureauDetails.length > 0 && (
        <div className="px-3 pb-3 border-t border-border/50">
          <div className="overflow-x-auto mt-2">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-1 px-1 text-muted-foreground font-normal w-1/4"></th>
                  {allBureaus.map(bureau => {
                    const hasDetail = !!getBureauDetail(bureau);
                    const isReported = reportedBureaus.includes(bureau);
                    return (
                      <th
                        key={bureau}
                        className={`text-center py-1 px-1 font-medium text-[10px] ${
                          hasDetail ? "text-primary" :
                          isReported ? "text-muted-foreground" :
                          "text-muted-foreground/30"
                        }`}
                      >
                        {bureau}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activeFields.map(field => (
                  <tr key={field.key} className="border-b border-border/30">
                    <td className="py-1 px-1 text-muted-foreground text-[10px]">{field.label}</td>
                    {allBureaus.map(bureau => {
                      const detail = getBureauDetail(bureau);
                      const val = detail ? formatDetailValue(detail[field.key], field.format) : null;
                      return (
                        <td
                          key={bureau}
                          className={`text-center py-1 px-1 text-[10px] ${
                            val ? "text-foreground" : "text-muted-foreground/30"
                          }`}
                        >
                          {val || "--"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {allBureaus.some(b => {
            const detail = getBureauDetail(b);
            return detail?.paymentHistory && detail.paymentHistory.length > 0;
          }) && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-muted-foreground font-medium mb-2">Two-Year Payment History</p>
              {allBureaus.map(bureau => {
                const detail = getBureauDetail(bureau);
                const history = detail?.paymentHistory || [];
                if (history.length === 0) return null;
                return (
                  <div key={bureau} className="mb-2">
                    <p className="text-[10px] font-mono text-primary mb-1">{bureau}</p>
                    <div className="flex flex-wrap gap-0.5">
                      {history.map((entry: any, idx: number) => {
                        const code = entry.code || "--";
                        const isOk = code === "C" || code === "OK";
                        const isLate = /^(30|60|90|120|150)$/.test(code);
                        const isSevere = code === "CO" || code === "CL" || code === "BK";
                        const bgClass = isOk
                          ? "bg-green-500/20 text-green-600 border-green-500/30"
                          : isLate
                          ? "bg-yellow-500/20 text-yellow-700 border-yellow-500/30"
                          : isSevere
                          ? "bg-destructive/20 text-destructive border-destructive/30"
                          : "bg-secondary text-muted-foreground border-border";
                        return (
                          <div
                            key={idx}
                            className={`px-1 py-0.5 rounded border text-[9px] font-mono text-center min-w-[36px] ${bgClass}`}
                            title={`${entry.month}: ${code}`}
                          >
                            <div className="leading-tight">{isOk ? "OK" : code}</div>
                            <div className="text-[7px] opacity-70">{entry.month?.slice(5) || ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {allBureaus.some(b => getBureauDetail(b)?.daysLate7Year) && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-muted-foreground font-medium mb-2">Days Late - 7 Year History</p>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 px-1 text-muted-foreground font-normal text-[10px] w-1/4"></th>
                    {allBureaus.map(bureau => (
                      <th key={bureau} className={`text-center py-1 px-1 font-medium text-[10px] ${getBureauDetail(bureau)?.daysLate7Year ? "text-primary" : "text-muted-foreground/30"}`}>
                        {bureau}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["30", "60", "90"] as const).map(days => (
                    <tr key={days} className="border-b border-border/30">
                      <td className="py-1 px-1 text-muted-foreground text-[10px]">{days} Days</td>
                      {allBureaus.map(bureau => {
                        const detail = getBureauDetail(bureau);
                        const val = detail?.daysLate7Year?.[days];
                        return (
                          <td key={bureau} className={`text-center py-1 px-1 text-[10px] ${val != null ? (val > 0 ? "text-destructive font-medium" : "text-foreground") : "text-muted-foreground/30"}`}>
                            {val != null ? val : "--"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {allBureaus.map(bureau => {
            const detail = getBureauDetail(bureau);
            const remarks = detail?.remarks || [];
            if (remarks.length === 0) return null;
            return (
              <div key={bureau} className="mt-2">
                <p className="text-[10px] text-primary font-medium">{bureau} Remarks:</p>
                {remarks.map((r: string, ri: number) => (
                  <p key={ri} className="text-[10px] text-muted-foreground ml-2">- {r}</p>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, testId, value, onChange, onBlur, placeholder }: {
  label: string; testId: string; value: string; onChange: (v: string) => void; onBlur: () => void; placeholder: string;
}) {
  return (
    <div>
      <label className="text-xs font-mono text-muted-foreground mb-1 block">{label}</label>
      <input
        data-testid={testId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
      />
    </div>
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

function formatAccountType(type: string): string {
  const map: Record<string, string> = {
    debt_collection: "Debt Collection",
    charge_off: "Charge-Off",
    repossession: "Repossession",
  };
  return map[type] || type;
}
