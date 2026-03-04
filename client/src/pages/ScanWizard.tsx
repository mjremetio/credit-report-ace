import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Shield, FileText,
  Loader2, CheckCircle2, Zap, AlertTriangle, ClipboardList, Eye,
  MapPin, Download, ClipboardCheck, Activity
} from "lucide-react";
import {
  fetchScan, updateScan, addNegativeAccount, updateNegativeAccount,
  deleteNegativeAccount, scanAccountForViolations, runManualAnalysisPipeline
} from "@/lib/api";

const STEPS = [
  { num: 1, label: "Start", icon: Shield },
  { num: 2, label: "Add Accounts", icon: Plus },
  { num: 3, label: "Classify", icon: ClipboardList },
  { num: 4, label: "Next Steps", icon: CheckCircle2 },
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

  const { data: scan, isLoading } = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => fetchScan(scanId),
    enabled: scanId > 0,
    refetchInterval: 5000,
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
  const step = isUploadBased ? Math.max(rawStep, 4) : rawStep;

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
          {STEPS.map((s, i) => {
            // For upload-based scans, all manual entry steps (1-3) are effectively complete
            const isCompleted = isUploadBased ? (s.num <= 4) : (s.num < step);
            const isCurrent = s.num === step;
            return (
              <div key={s.num} className="flex items-center">
                <button
                  data-testid={`step-indicator-${s.num}`}
                  onClick={() => !isUploadBased && goToStep(s.num)}
                  disabled={isUploadBased && s.num < 4}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-all ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary text-muted-foreground"
                  } ${isUploadBased && s.num < 4 ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <s.icon className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`w-6 h-0.5 mx-1 ${isCompleted || isCurrent ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {step === 1 && <Step1Welcome key="s1" scan={scan} scanId={scanId} goToStep={goToStep} />}
          {step === 2 && <Step2AddAccounts key="s2" scan={scan} scanId={scanId} goToStep={goToStep} />}
          {step === 3 && <Step3Classify key="s3" scan={scan} scanId={scanId} goToStep={goToStep} />}
          {step === 4 && <Step4NextSteps key="s4" scan={scan} scanId={scanId} goToStep={goToStep} navigate={navigate} />}
        </AnimatePresence>
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
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-2xl mx-auto">
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
    </motion.div>
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
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
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
              <button
                data-testid={`delete-account-${acct.id}`}
                onClick={() => deleteMutation.mutate(acct.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-2"
              >
                <Trash2 className="w-4 h-4" />
              </button>
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
    </motion.div>
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
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
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
    </motion.div>
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

  const [scanningIds, setScanningIds] = useState<Set<number>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanAllRunning, setScanAllRunning] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<any>(null);

  const scanMutation = useMutation({
    mutationFn: scanAccountForViolations,
    onSuccess: (_data, accountId) => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      setScanningIds(prev => { const next = new Set(prev); next.delete(accountId); return next; });
      setScanError(null);
    },
    onError: (err: Error, accountId) => {
      setScanningIds(prev => { const next = new Set(prev); next.delete(accountId); return next; });
      setScanError(err.message || "Scan failed. Please try again.");
    },
  });

  const handleScan = (accountId: number) => {
    setScanError(null);
    setScanningIds(prev => new Set(prev).add(accountId));
    scanMutation.mutate(accountId);
  };

  const handleScanAll = async () => {
    setScanError(null);
    setScanAllRunning(true);
    const unscanned = negAccounts.filter((a: any) => a.workflowStep !== "scanned");
    const ids = unscanned.map((a: any) => a.id);
    setScanningIds(new Set(ids));

    for (const accountId of ids) {
      try {
        await scanAccountForViolations(accountId);
      } catch (err: any) {
        setScanError(`Scan failed for one or more accounts. ${err.message || ""}`);
      }
      setScanningIds(prev => { const next = new Set(prev); next.delete(accountId); return next; });
    }
    queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
    setScanAllRunning(false);
  };

  // Full pipeline: Convert manual entries → Structured JSON → AI Analysis
  const handleRunPipeline = async () => {
    setScanError(null);
    setPipelineRunning(true);
    try {
      const result = await runManualAnalysisPipeline(scanId);
      setPipelineResult(result);
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
    } catch (err: any) {
      setScanError(err.message || "Pipeline failed. Please try again.");
    }
    setPipelineRunning(false);
  };

  const completeScan = () => {
    updateScan(scanId, { status: "completed" }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
    });
  };

  const unscannedCount = negAccounts.filter((a: any) => a.workflowStep !== "scanned").length;
  const totalViolationCount = negAccounts.reduce((sum: number, a: any) => sum + (a.violations?.length || 0), 0);
  const allScanned = unscannedCount === 0 && negAccounts.length > 0;
  const hasParsedReport = scan.hasParsedReport || false;
  const analysisComplete = allScanned || pipelineResult;

  // Group violations by category
  const fcraViolations = negAccounts.flatMap((a: any) =>
    (a.violations || []).filter((v: any) => !v.category || v.category === "FCRA_REPORTING")
  );
  const debtCollectorViolations = negAccounts.flatMap((a: any) =>
    (a.violations || []).filter((v: any) => v.category && v.category !== "FCRA_REPORTING")
  );

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      {/* Dispute Scanner Progress */}
      <div className="mb-6 bg-card border border-border rounded-xl p-5">
        <h4 className="font-display text-foreground text-sm mb-3">Dispute Scanner</h4>
        <div className="space-y-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span className="text-muted-foreground">
              {hasParsedReport
                ? `Report uploaded & structured — ${negAccounts.length} account(s) detected`
                : `Manual data entry — ${negAccounts.length} account(s) added`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {analysisComplete ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
            ) : pipelineRunning ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
            ) : (
              <Activity className="w-4 h-4 text-primary flex-shrink-0" />
            )}
            <span className={analysisComplete ? "text-muted-foreground" : "text-primary"}>
              {hasParsedReport ? "Structured JSON & AI violation analysis" : "Convert into Structured JSON & AI violation analysis"}
              {analysisComplete && totalViolationCount > 0 ? ` — ${totalViolationCount} violation(s) found` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {analysisComplete ? (
              <ClipboardCheck className="w-4 h-4 text-primary flex-shrink-0" />
            ) : (
              <ClipboardCheck className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
            )}
            <span className={analysisComplete ? "text-primary" : "text-muted-foreground/50"}>
              Paralegal manual review — Edit analysis reports
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
            <span className="text-muted-foreground/50">Export (after review & approval)</span>
          </div>
        </div>
      </div>

      {/* Pipeline Result Banner */}
      {pipelineResult && (
        <div className="mb-6 bg-green-500/5 border border-green-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <h4 className="font-display text-foreground text-sm">Full Analysis Pipeline Complete</h4>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-display text-foreground">{pipelineResult.accountsCreated}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Tradelines</div>
            </div>
            <div>
              <div className="text-2xl font-display text-foreground">{pipelineResult.violationsFound}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Violations</div>
            </div>
            <div>
              <div className="text-2xl font-display text-foreground">{pipelineResult.issueFlagsDetected}</div>
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
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-2xl font-display text-foreground">{negAccounts.length}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Accounts</div>
            </div>
            <div>
              <div className="text-2xl font-display text-foreground">{totalViolationCount}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Violations</div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h2 className="font-display text-2xl text-foreground mb-2">Analyze & Review</h2>
          <p className="text-muted-foreground font-mono text-sm">
            {analysisComplete
              ? "Analysis complete. Review violations below, then proceed to paralegal review."
              : "Convert manual entries to structured JSON and run AI violation analysis, or scan individual accounts."}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {!pipelineResult && !allScanned && (
            <button
              data-testid="button-run-pipeline"
              onClick={handleRunPipeline}
              disabled={pipelineRunning || negAccounts.length === 0}
              className="px-5 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-600/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
            >
              {pipelineRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {pipelineRunning ? "Running Pipeline..." : "Run Full Analysis"}
            </button>
          )}
          {unscannedCount > 0 && !pipelineRunning && (
            <button
              data-testid="button-scan-all"
              onClick={handleScanAll}
              disabled={scanAllRunning}
              className="px-5 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
            >
              {scanAllRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {scanAllRunning ? "Scanning..." : `Scan Individual (${unscannedCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Pipeline running indicator */}
      {pipelineRunning && (
        <div className="mb-6 bg-primary/5 border border-primary/30 rounded-xl p-6 text-center">
          <Activity className="w-8 h-8 text-primary animate-pulse mx-auto mb-3" />
          <h4 className="font-display text-foreground mb-2">Running Full Analysis Pipeline...</h4>
          <p className="text-xs font-mono text-muted-foreground">
            Converting {negAccounts.length} account(s) to structured JSON (scores, personal info, bureau summary, tradelines, public records, inquiries, consumer statement), computing issue flags, and running AI violation analysis...
          </p>
        </div>
      )}

      {scanError && (
        <div data-testid="scan-error" className="mb-6 bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
          <p className="text-sm font-mono text-destructive">{scanError}</p>
        </div>
      )}

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
            <span className="text-muted-foreground">
              {unscannedCount === 0 ? "All accounts scanned" : `${unscannedCount} remaining`}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-6 mb-8">
        {negAccounts.map((acct: any) => {
          const hasViolations = acct.violations && acct.violations.length > 0;
          const isScanning = scanningIds.has(acct.id);
          const isScanned = acct.workflowStep === "scanned";

          // Split violations by category
          const acctFcra = (acct.violations || []).filter((v: any) => !v.category || v.category === "FCRA_REPORTING");
          const acctFdcpa = (acct.violations || []).filter((v: any) => v.category && v.category !== "FCRA_REPORTING");

          return (
            <div key={acct.id} data-testid={`nextstep-account-${acct.id}`} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-secondary/30 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg text-foreground">{acct.creditor}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-mono text-muted-foreground">{formatAccountType(acct.accountType)}</span>
                    {acct.balance && <span className="text-xs font-mono text-foreground">${Number(acct.balance).toLocaleString()}</span>}
                    <WorkflowBadge step={acct.workflowStep} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isScanned && (
                    <button
                      data-testid={`button-scan-${acct.id}`}
                      onClick={() => handleScan(acct.id)}
                      disabled={isScanning || scanAllRunning}
                      className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
                    >
                      {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      {isScanning ? "Scanning..." : "Scan"}
                    </button>
                  )}
                  {isScanned && (
                    <button
                      data-testid={`button-rescan-${acct.id}`}
                      onClick={() => handleScan(acct.id)}
                      disabled={isScanning || scanAllRunning}
                      className="px-3 py-1.5 bg-secondary border border-border text-muted-foreground font-mono rounded-lg hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-xs"
                    >
                      {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                      Re-scan
                    </button>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-4">
                {isScanning && (
                  <div className="flex items-center gap-3 py-4 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <span className="text-sm font-mono text-primary">AI analyzing for FCRA & FDCPA violations...</span>
                  </div>
                )}

                {!isScanning && hasViolations && (
                  <div className="space-y-4">
                    {/* FCRA Violations */}
                    {acctFcra.length > 0 && (
                      <div>
                        <h4 className="text-xs font-mono text-blue-600 mb-3 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> FCRA REPORTING VIOLATIONS ({acctFcra.length})
                        </h4>
                        <div className="space-y-2">
                          {acctFcra.map((v: any) => (
                            <ViolationCard key={v.id} violation={v} />
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
                        <div className="space-y-2">
                          {acctFdcpa.map((v: any) => (
                            <ViolationCard key={v.id} violation={v} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!isScanning && isScanned && !hasViolations && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
                    <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-2" />
                    <p className="text-sm text-green-600 font-mono">No violations detected for this account.</p>
                  </div>
                )}

                {!isScanning && !hasViolations && !isScanned && (
                  <div className="text-center py-4 text-xs font-mono text-muted-foreground">
                    Click "Scan" to analyze this account for FCRA & FDCPA violations
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between">
        <button
          data-testid="button-back-step3"
          onClick={() => goToStep(3)}
          className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex gap-3">
          {(allScanned || pipelineResult) && (
            <button
              data-testid="button-begin-review"
              onClick={() => navigate(`/review/${scanId}`)}
              className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
            >
              <ClipboardCheck className="w-4 h-4" /> Paralegal Review
            </button>
          )}
          <button
            data-testid="button-complete-scan"
            onClick={completeScan}
            className="px-6 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-600/90 transition-colors inline-flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" /> Mark Complete
          </button>
          <button
            data-testid="button-view-profile"
            onClick={() => navigate("/profile")}
            className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-foreground transition-colors inline-flex items-center gap-2"
          >
            <Eye className="w-4 h-4" /> View Profile
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ViolationCard({ violation }: { violation: any }) {
  const confidenceColors: Record<string, string> = {
    confirmed: "border-green-500/30 text-green-600 bg-green-500/10",
    likely: "border-yellow-500/30 text-yellow-600 bg-yellow-500/10",
    possible: "border-orange-500/30 text-orange-600 bg-orange-500/10",
  };

  return (
    <div data-testid={`violation-${violation.id}`} className="bg-background border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <SeverityBadge severity={violation.severity} />
        <span className="text-sm text-foreground font-semibold">{violation.violationType}</span>
        {violation.confidence && (
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${confidenceColors[violation.confidence] || "border-border text-muted-foreground"}`}>
            {violation.confidence}
          </span>
        )}
      </div>
      <p className="text-sm font-mono text-foreground/80 leading-relaxed">{violation.explanation}</p>
      {violation.evidence && (
        <p className="text-sm font-mono text-foreground/60 mt-2 italic">Evidence: {violation.evidence}</p>
      )}
      {violation.evidenceRequired && (
        <p className="text-sm font-mono text-yellow-700 dark:text-yellow-500 mt-1">Evidence needed: {violation.evidenceRequired}</p>
      )}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-mono font-medium text-primary">{violation.fcraStatute}</span>
        {violation.matchedRule && (
          <span className="text-xs font-mono text-foreground/70 bg-secondary px-2 py-1 rounded">{violation.matchedRule}</span>
        )}
      </div>
      {violation.croReminder && (
        <p className="text-sm font-mono text-yellow-700 dark:text-yellow-500 mt-2 italic">CRO: {violation.croReminder}</p>
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

function formatAccountType(type: string): string {
  const map: Record<string, string> = {
    debt_collection: "Debt Collection",
    charge_off: "Charge-Off",
    repossession: "Repossession",
  };
  return map[type] || type;
}
