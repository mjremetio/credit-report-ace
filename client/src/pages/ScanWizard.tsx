import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  BrainCircuit, ArrowLeft, ArrowRight, Plus, Trash2, Shield, FileText,
  Activity, Loader2, CheckCircle2, ChevronRight, Zap, AlertTriangle,
  Send, ClipboardList, Eye, Edit3, Download, X, Check
} from "lucide-react";
import {
  fetchScan, updateScan, addNegativeAccount, updateNegativeAccount,
  deleteNegativeAccount, scanAccountForViolations, generateLetterForAccount,
  updateLetter
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
    mutationFn: (data: { currentStep?: number; status?: string }) => updateScan(scanId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scan", scanId] }),
  });

  const step = scan?.currentStep || 1;

  const goToStep = (s: number) => {
    if (s >= 1 && s <= 4) {
      updateScanMutation.mutate({ currentStep: s });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="font-display text-xl text-white mb-2">Scan Not Found</h2>
          <button onClick={() => navigate("/")} className="text-primary font-mono text-sm hover:underline">Go Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button data-testid="button-back-home" onClick={() => navigate("/")} className="text-muted-foreground hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <BrainCircuit className="text-primary w-6 h-6" />
              <h1 className="font-display font-bold text-xl text-white">{scan.consumerName}</h1>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.num} className="flex items-center">
                <button
                  data-testid={`step-indicator-${s.num}`}
                  onClick={() => goToStep(s.num)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-all ${
                    step === s.num
                      ? "bg-primary text-black"
                      : s.num < step
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  <s.icon className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`w-6 h-0.5 mx-1 ${s.num < step ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {step === 1 && <Step1Welcome key="s1" scan={scan} goToStep={goToStep} />}
          {step === 2 && <Step2AddAccounts key="s2" scan={scan} scanId={scanId} goToStep={goToStep} />}
          {step === 3 && <Step3Classify key="s3" scan={scan} scanId={scanId} goToStep={goToStep} />}
          {step === 4 && <Step4NextSteps key="s4" scan={scan} scanId={scanId} goToStep={goToStep} navigate={navigate} />}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Step1Welcome({ scan, goToStep }: { scan: any; goToStep: (s: number) => void }) {
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-2xl mx-auto">
      <div className="text-center mb-10">
        <div className="p-4 rounded-full bg-primary/10 inline-block mb-4">
          <Shield className="w-10 h-10 text-primary" />
        </div>
        <h2 className="font-display text-3xl text-white mb-3">Welcome, {scan.consumerName}</h2>
        <p className="text-muted-foreground font-mono text-sm max-w-lg mx-auto">
          This guided workflow will help you organize your negative credit accounts, identify potential FCRA violations, and prepare dispute letters.
        </p>
      </div>

      <div className="space-y-4 mb-10">
        {[
          { step: 1, title: "Start Your Scan", desc: "You're here. Ready to begin." },
          { step: 2, title: "Add Negative Accounts", desc: "Paste or enter the negative items from your credit reports." },
          { step: 3, title: "Classify Each Account", desc: "Categorize accounts as Debt Collection, Charge-Off, or Repossession." },
          { step: 4, title: "Follow Next Steps", desc: "Track progress and know what to do next for each account." },
        ].map((item) => (
          <div key={item.step} className={`flex items-start gap-4 p-4 rounded-lg border ${item.step === 1 ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono flex-shrink-0 ${item.step === 1 ? "bg-primary text-black" : "bg-secondary text-muted-foreground"}`}>
              {item.step}
            </div>
            <div>
              <h4 className="font-display text-white">{item.title}</h4>
              <p className="text-sm text-muted-foreground font-mono">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <button
          data-testid="button-start-step2"
          onClick={() => goToStep(2)}
          className="px-8 py-3 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2 text-lg"
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
        <h2 className="font-display text-2xl text-white mb-2">Add Negative Accounts</h2>
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
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-white placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Account Type *</label>
            <select
              data-testid="select-account-type"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-primary appearance-none"
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
            className="w-full bg-background border border-border rounded-lg px-4 py-3 text-white placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary resize-none"
          />
        </div>
        <button
          data-testid="button-add-account"
          onClick={handleAdd}
          disabled={!creditor.trim() || addMutation.isPending}
          className="px-6 py-2.5 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
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
                  <div className="text-white font-medium">{acct.creditor}</div>
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
          className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-white transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          data-testid="button-next-step3"
          onClick={() => goToStep(3)}
          disabled={negAccounts.length === 0}
          className="px-6 py-3 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
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
        <h2 className="font-display text-2xl text-white mb-2">Classify Your Accounts</h2>
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
          className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-white transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          data-testid="button-next-step4"
          onClick={() => goToStep(4)}
          className="px-6 py-3 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
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
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-black text-xs font-mono font-bold">
            {index + 1}
          </div>
          <h3 className="font-display text-lg text-white">{account.creditor}</h3>
        </div>
        <span className={`text-xs font-mono px-2 py-1 rounded border ${
          account.workflowStep === "pending" ? "border-yellow-500/30 text-yellow-400 bg-yellow-500/10" :
          "border-primary/30 text-primary bg-primary/10"
        }`}>
          {account.workflowStep}
        </span>
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

  const [scanningId, setScanningId] = useState<number | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [editingLetterId, setEditingLetterId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  const scanMutation = useMutation({
    mutationFn: scanAccountForViolations,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      setScanningId(null);
    },
    onError: () => setScanningId(null),
  });

  const generateMutation = useMutation({
    mutationFn: ({ accountId, letterType }: { accountId: number; letterType: string }) =>
      generateLetterForAccount(accountId, letterType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      setGeneratingId(null);
    },
    onError: () => setGeneratingId(null),
  });

  const updateLetterMutation = useMutation({
    mutationFn: ({ letterId, data }: { letterId: number; data: any }) => updateLetter(letterId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
      setEditingLetterId(null);
    },
  });

  const handleScan = (accountId: number) => {
    setScanningId(accountId);
    scanMutation.mutate(accountId);
  };

  const handleGenerate = (accountId: number, letterType: string) => {
    setGeneratingId(accountId);
    generateMutation.mutate({ accountId, letterType });
  };

  const handleMarkSent = (letterId: number) => {
    updateLetterMutation.mutate({ letterId, data: { status: "sent" } });
  };

  const handleSaveEdit = (letterId: number) => {
    updateLetterMutation.mutate({ letterId, data: { content: editContent } });
  };

  const completeScan = () => {
    updateScan(scanId, { status: "completed" }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
    });
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div className="mb-8">
        <h2 className="font-display text-2xl text-white mb-2">Next Steps</h2>
        <p className="text-muted-foreground font-mono text-sm">
          For each account, scan for violations, generate dispute letters, and track your progress.
        </p>
      </div>

      <div className="space-y-6 mb-8">
        {negAccounts.map((acct: any) => {
          const hasViolations = acct.violations && acct.violations.length > 0;
          const hasLetters = acct.letters && acct.letters.length > 0;
          const isScanning = scanningId === acct.id;
          const isGenerating = generatingId === acct.id;

          return (
            <div key={acct.id} data-testid={`nextstep-account-${acct.id}`} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-secondary/30 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg text-white">{acct.creditor}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-mono text-muted-foreground">{formatAccountType(acct.accountType)}</span>
                    {acct.balance && <span className="text-xs font-mono text-white">${acct.balance}</span>}
                    <WorkflowBadge step={acct.workflowStep} />
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex flex-wrap gap-3">
                  {acct.workflowStep === "pending" || acct.workflowStep === "classified" ? (
                    <button
                      data-testid={`button-scan-${acct.id}`}
                      onClick={() => handleScan(acct.id)}
                      disabled={isScanning}
                      className="px-4 py-2 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
                    >
                      {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      {isScanning ? "Scanning..." : "Scan for Violations"}
                    </button>
                  ) : null}

                  {(acct.workflowStep === "scanned" || hasViolations) && !hasLetters && (
                    <>
                      <button
                        data-testid={`button-generate-dispute-${acct.id}`}
                        onClick={() => handleGenerate(acct.id, "initial_dispute")}
                        disabled={isGenerating}
                        className="px-4 py-2 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
                      >
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                        Generate Dispute Letter
                      </button>
                      {acct.accountType === "debt_collection" && (
                        <button
                          data-testid={`button-generate-validation-${acct.id}`}
                          onClick={() => handleGenerate(acct.id, "validation_request")}
                          disabled={isGenerating}
                          className="px-4 py-2 bg-secondary border border-border text-white font-medium rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
                        >
                          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          Validation Request
                        </button>
                      )}
                    </>
                  )}

                  {hasLetters && (
                    <button
                      data-testid={`button-generate-followup-${acct.id}`}
                      onClick={() => handleGenerate(acct.id, "follow_up")}
                      disabled={isGenerating}
                      className="px-4 py-2 bg-secondary border border-border text-white font-medium rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-50 inline-flex items-center gap-2 text-sm"
                    >
                      {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      Generate Follow-Up
                    </button>
                  )}
                </div>

                {hasViolations && (
                  <div>
                    <h4 className="text-xs font-mono text-primary mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> DETECTED VIOLATIONS ({acct.violations.length})
                    </h4>
                    <div className="space-y-2">
                      {acct.violations.map((v: any) => (
                        <div key={v.id} data-testid={`violation-${v.id}`} className="bg-background border border-border rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <SeverityBadge severity={v.severity} />
                            <span className="text-sm text-white font-medium">{v.violationType}</span>
                          </div>
                          <p className="text-xs font-mono text-muted-foreground">{v.explanation}</p>
                          <div className="mt-1 text-xs font-mono text-primary">{v.fcraStatute}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {hasLetters && (
                  <div>
                    <h4 className="text-xs font-mono text-primary mb-2 flex items-center gap-1">
                      <FileText className="w-3 h-3" /> GENERATED LETTERS ({acct.letters.length})
                    </h4>
                    <div className="space-y-3">
                      {acct.letters.map((letter: any) => (
                        <div key={letter.id} data-testid={`letter-${letter.id}`} className="bg-background border border-border rounded-lg overflow-hidden">
                          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white font-medium">{formatLetterType(letter.letterType)}</span>
                              <span className="text-xs font-mono text-muted-foreground">To: {letter.recipient}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                                letter.status === "sent" ? "border-green-500/30 text-green-400 bg-green-500/10" :
                                letter.status === "ready" ? "border-primary/30 text-primary bg-primary/10" :
                                "border-border text-muted-foreground bg-secondary"
                              }`}>
                                {letter.status}
                              </span>
                              {letter.status !== "sent" && (
                                <>
                                  <button
                                    data-testid={`button-edit-letter-${letter.id}`}
                                    onClick={() => { setEditingLetterId(letter.id); setEditContent(letter.content); }}
                                    className="p-1 text-muted-foreground hover:text-white transition-colors"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    data-testid={`button-mark-sent-${letter.id}`}
                                    onClick={() => handleMarkSent(letter.id)}
                                    className="px-2 py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 transition-colors inline-flex items-center gap-1"
                                  >
                                    <Check className="w-3 h-3" /> Mark Sent
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {editingLetterId === letter.id ? (
                            <div className="p-4">
                              <textarea
                                data-testid={`textarea-edit-letter-${letter.id}`}
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                rows={15}
                                className="w-full bg-card border border-border rounded-lg px-4 py-3 text-white font-mono text-xs focus:outline-none focus:border-primary resize-none"
                              />
                              <div className="flex gap-2 mt-3">
                                <button
                                  data-testid={`button-save-letter-${letter.id}`}
                                  onClick={() => handleSaveEdit(letter.id)}
                                  className="px-4 py-2 bg-primary text-black font-medium rounded-lg text-xs inline-flex items-center gap-1"
                                >
                                  <Check className="w-3 h-3" /> Save
                                </button>
                                <button
                                  onClick={() => setEditingLetterId(null)}
                                  className="px-4 py-2 bg-secondary border border-border text-muted-foreground rounded-lg text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 max-h-60 overflow-y-auto">
                              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{letter.content}</pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!hasViolations && !hasLetters && acct.workflowStep === "pending" && (
                  <div className="text-center py-4 text-xs font-mono text-muted-foreground">
                    Click "Scan for Violations" to analyze this account for FCRA issues
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
          className="px-6 py-3 bg-secondary border border-border text-muted-foreground rounded-lg hover:text-white transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex gap-3">
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
            className="px-6 py-3 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
          >
            <Eye className="w-4 h-4" /> View Profile
          </button>
        </div>
      </div>
    </motion.div>
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
        className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary"
      />
    </div>
  );
}

function WorkflowBadge({ step }: { step: string }) {
  const colors: Record<string, string> = {
    pending: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
    classified: "border-blue-500/30 text-blue-400 bg-blue-500/10",
    scanned: "border-purple-500/30 text-purple-400 bg-purple-500/10",
    letter_generated: "border-primary/30 text-primary bg-primary/10",
    letter_sent: "border-green-500/30 text-green-400 bg-green-500/10",
    follow_up: "border-orange-500/30 text-orange-400 bg-orange-500/10",
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
    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${colors[severity] || colors.medium}`}>
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

function formatLetterType(type: string): string {
  const map: Record<string, string> = {
    initial_dispute: "Initial Dispute Letter",
    validation_request: "Debt Validation Request",
    follow_up: "Follow-Up Letter",
    intent_to_sue: "Intent to Sue Letter",
  };
  return map[type] || type;
}
