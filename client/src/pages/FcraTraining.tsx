import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Plus, Trash2, Edit3, BookOpen, BarChart3,
  CheckCircle, AlertTriangle, Scale, FileText,
} from "lucide-react";

interface TrainingExample {
  id: number;
  violationType: string;
  category: string;
  severity: string;
  fcraStatute: string;
  accountType: string;
  title: string;
  scenario: string;
  expectedEvidence: string;
  expectedExplanation: string;
  reportExcerpt: string | null;
  commonMistakes: string | null;
  keyIndicators: string | null;
  caseLawReference: string | null;
  regulatoryGuidance: string | null;
  isActive: boolean;
  source: string | null;
  sourceScanId: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TrainingStats {
  total: number;
  active: number;
  byCategory: Record<string, number>;
  byAccountType: Record<string, number>;
  learnedPatterns: number;
  confirmedPatterns: number;
}

const CATEGORIES = [
  "FCRA_REPORTING",
  "DEBT_COLLECTOR_DISCLOSURE",
  "CA_LICENSE_MISSING",
  "CEASE_CONTACT_VIOLATION",
  "INCONVENIENT_CONTACT",
  "THIRD_PARTY_DISCLOSURE",
  "HARASSMENT_EXCESSIVE_CALLS",
  "PRIVACY_VIOLATION",
  "IMPERMISSIBLE_PURPOSE",
  "WITHHOLDING_NOTICES",
];

const ACCOUNT_TYPES = [
  { value: "debt_collection", label: "Debt Collection" },
  { value: "charge_off", label: "Charge-Off" },
  { value: "repossession", label: "Repossession" },
];

const SEVERITIES = ["critical", "high", "medium", "low"];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

const emptyForm = {
  violationType: "",
  category: "FCRA_REPORTING",
  severity: "high" as string,
  fcraStatute: "",
  accountType: "debt_collection",
  title: "",
  scenario: "",
  expectedEvidence: "",
  expectedExplanation: "",
  reportExcerpt: "",
  commonMistakes: "",
  keyIndicators: "",
  caseLawReference: "",
  regulatoryGuidance: "",
  isActive: true,
  source: "manual",
  createdBy: "",
};

export default function FcraTraining() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterAccountType, setFilterAccountType] = useState<string>("all");

  const { data: examples = [], isLoading } = useQuery<TrainingExample[]>({
    queryKey: ["/api/training/examples"],
  });

  const { data: stats } = useQuery<TrainingStats>({
    queryKey: ["/api/training/stats"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof emptyForm) => {
      const res = await apiRequest("POST", "/api/training/examples", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training/examples"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
      setShowCreateDialog(false);
      setForm(emptyForm);
      toast({ title: "Training example created", description: "The AI will use this example to improve violation detection." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof emptyForm> }) => {
      const res = await apiRequest("PATCH", `/api/training/examples/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training/examples"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
      setEditingId(null);
      setForm(emptyForm);
      toast({ title: "Training example updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/training/examples/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training/examples"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
      toast({ title: "Training example deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/training/examples/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training/examples"] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/stats"] });
    },
  });

  const filteredExamples = examples.filter((e) => {
    if (filterCategory !== "all" && e.category !== filterCategory) return false;
    if (filterAccountType !== "all" && e.accountType !== filterAccountType) return false;
    return true;
  });

  function openEdit(example: TrainingExample) {
    setEditingId(example.id);
    setForm({
      violationType: example.violationType,
      category: example.category,
      severity: example.severity,
      fcraStatute: example.fcraStatute,
      accountType: example.accountType,
      title: example.title,
      scenario: example.scenario,
      expectedEvidence: example.expectedEvidence,
      expectedExplanation: example.expectedExplanation,
      reportExcerpt: example.reportExcerpt || "",
      commonMistakes: example.commonMistakes || "",
      keyIndicators: example.keyIndicators || "",
      caseLawReference: example.caseLawReference || "",
      regulatoryGuidance: example.regulatoryGuidance || "",
      isActive: example.isActive,
      source: example.source || "manual",
      createdBy: example.createdBy || "",
    });
    setShowCreateDialog(true);
  }

  function handleSubmit() {
    if (!form.title || !form.scenario || !form.violationType || !form.fcraStatute) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">FCRA AI Training</h1>
            <p className="text-sm text-muted-foreground">
              Curate violation examples to improve AI scanning accuracy
            </p>
          </div>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) { setEditingId(null); setForm(emptyForm); }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Training Example
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Training Example" : "Add Training Example"}</DialogTitle>
            </DialogHeader>
            <TrainingForm form={form} setForm={setForm} onSubmit={handleSubmit} isPending={createMutation.isPending || updateMutation.isPending} isEditing={!!editingId} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{stats.active}</p>
                  <p className="text-xs text-muted-foreground">Active Examples</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.learnedPatterns}</p>
                  <p className="text-xs text-muted-foreground">Learned Patterns</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.confirmedPatterns}</p>
                  <p className="text-xs text-muted-foreground">Confirmed Patterns</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-purple-600" />
                <div>
                  <p className="text-2xl font-bold">{Object.keys(stats.byCategory).length}</p>
                  <p className="text-xs text-muted-foreground">Categories Covered</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Coverage Breakdown */}
      {stats && (Object.keys(stats.byCategory).length > 0 || Object.keys(stats.byAccountType).length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Training Coverage</CardTitle>
            <CardDescription>Distribution of training examples across categories and account types</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {Object.keys(stats.byCategory).length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">By Category</h4>
                  <div className="space-y-1">
                    {Object.entries(stats.byCategory).sort(([, a], [, b]) => b - a).map(([cat, count]) => (
                      <div key={cat} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground truncate">{cat.replace(/_/g, " ")}</span>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(stats.byAccountType).length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">By Account Type</h4>
                  <div className="space-y-1">
                    {Object.entries(stats.byAccountType).sort(([, a], [, b]) => b - a).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{ACCOUNT_TYPES.find(t => t.value === type)?.label || type}</span>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Training Examples List */}
      <Tabs defaultValue="examples">
        <TabsList>
          <TabsTrigger value="examples">Training Examples</TabsTrigger>
          <TabsTrigger value="patterns">Learned Patterns</TabsTrigger>
        </TabsList>

        <TabsContent value="examples" className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterAccountType} onValueChange={setFilterAccountType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Account Types</SelectItem>
                {ACCOUNT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground ml-auto">
              {filteredExamples.length} example{filteredExamples.length !== 1 ? "s" : ""}
            </span>
          </div>

          {isLoading ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Loading training examples...</CardContent></Card>
          ) : filteredExamples.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Brain className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No training examples yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Add curated FCRA violation scenarios to teach the AI what to look for when scanning credit reports.
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Example
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredExamples.map((example) => (
                <Card key={example.id} className={!example.isActive ? "opacity-60" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-medium text-sm">{example.title}</h3>
                          <Badge className={`text-[10px] ${SEVERITY_COLORS[example.severity] || ""}`}>
                            {example.severity}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {example.category.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {ACCOUNT_TYPES.find(t => t.value === example.accountType)?.label || example.accountType}
                          </Badge>
                          {example.source === "confirmed_scan" && (
                            <Badge variant="secondary" className="text-[10px] bg-green-50 text-green-700">
                              <FileText className="w-3 h-3 mr-1" />
                              From Scan
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">
                          {example.fcraStatute} | {example.violationType}
                        </p>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {example.scenario}
                        </p>
                        {example.keyIndicators && (
                          <p className="text-xs text-blue-600 mt-1">
                            <AlertTriangle className="w-3 h-3 inline mr-1" />
                            Key indicators: {example.keyIndicators}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Switch
                          checked={example.isActive}
                          onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: example.id, isActive: checked })}
                        />
                        <Button variant="ghost" size="sm" onClick={() => openEdit(example)}>
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Delete this training example?")) {
                              deleteMutation.mutate(example.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="patterns">
          <LearnedPatternsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LearnedPatternsTab() {
  const { data: patterns = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/violation-patterns"],
  });

  if (isLoading) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">Loading learned patterns...</CardContent></Card>;
  }

  if (patterns.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No learned patterns yet</h3>
          <p className="text-sm text-muted-foreground">
            Patterns are automatically learned when violations are confirmed or rejected during scan review.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {patterns.map((p: any) => {
        const net = p.timesConfirmed - p.timesRejected;
        const isPositive = net > 0;
        return (
          <Card key={p.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-sm">{p.violationType}</h3>
                    <Badge className={`text-[10px] ${SEVERITY_COLORS[p.severity] || ""}`}>{p.severity}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{p.accountType}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.fcraStatute || "N/A"} | Rule: {p.matchedRule || "N/A"}
                  </p>
                  {p.creditorPattern && (
                    <p className="text-xs text-muted-foreground mt-1">Creditor pattern: {p.creditorPattern}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-green-600">+{p.timesConfirmed} confirmed</span>
                    <span className="text-red-500">-{p.timesRejected} rejected</span>
                  </div>
                  <p className={`text-xs mt-1 font-medium ${isPositive ? "text-green-600" : "text-red-500"}`}>
                    Net score: {net > 0 ? "+" : ""}{net}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TrainingForm({
  form,
  setForm,
  onSubmit,
  isPending,
  isEditing,
}: {
  form: typeof emptyForm;
  setForm: (f: typeof emptyForm) => void;
  onSubmit: () => void;
  isPending: boolean;
  isEditing: boolean;
}) {
  const update = (field: string, value: any) => setForm({ ...form, [field]: value });

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Title *</Label>
          <Input value={form.title} onChange={e => update("title", e.target.value)} placeholder="e.g., Paid Account Still Shows Balance" />
        </div>
        <div>
          <Label>Violation Type *</Label>
          <Input value={form.violationType} onChange={e => update("violationType", e.target.value)} placeholder="e.g., BALANCE_PAID_NOT_ZERO" />
        </div>
        <div>
          <Label>FCRA Statute *</Label>
          <Input value={form.fcraStatute} onChange={e => update("fcraStatute", e.target.value)} placeholder="e.g., §1681e(b)" />
        </div>
        <div>
          <Label>Category *</Label>
          <Select value={form.category} onValueChange={v => update("category", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => (
                <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Account Type *</Label>
          <Select value={form.accountType} onValueChange={v => update("accountType", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Severity *</Label>
          <Select value={form.severity} onValueChange={v => update("severity", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEVERITIES.map(s => (
                <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Created By</Label>
          <Input value={form.createdBy} onChange={e => update("createdBy", e.target.value)} placeholder="e.g., Analyst Name" />
        </div>
      </div>

      {/* Scenario & Evidence */}
      <div>
        <Label>Scenario Description *</Label>
        <Textarea
          value={form.scenario}
          onChange={e => update("scenario", e.target.value)}
          placeholder="Describe the violation scenario in detail. Include the account situation, what the report shows, and why it's a violation."
          rows={3}
        />
      </div>
      <div>
        <Label>Expected Evidence *</Label>
        <Textarea
          value={form.expectedEvidence}
          onChange={e => update("expectedEvidence", e.target.value)}
          placeholder="What evidence should the AI cite? e.g., 'TransUnion shows balance=$500, status=Paid'"
          rows={2}
        />
      </div>
      <div>
        <Label>Expected Explanation *</Label>
        <Textarea
          value={form.expectedExplanation}
          onChange={e => update("expectedExplanation", e.target.value)}
          placeholder="The correct explanation the AI should provide for this violation."
          rows={2}
        />
      </div>

      {/* Teaching Signals */}
      <div>
        <Label>Key Indicators</Label>
        <Textarea
          value={form.keyIndicators}
          onChange={e => update("keyIndicators", e.target.value)}
          placeholder="What patterns should the AI look for in the report data?"
          rows={2}
        />
      </div>
      <div>
        <Label>Common AI Mistakes to Avoid</Label>
        <Textarea
          value={form.commonMistakes}
          onChange={e => update("commonMistakes", e.target.value)}
          placeholder="What mistakes has the AI made on similar violations? e.g., 'Don't flag zero balance as violation when account is paid'"
          rows={2}
        />
      </div>
      <div>
        <Label>Sample Report Excerpt</Label>
        <Textarea
          value={form.reportExcerpt}
          onChange={e => update("reportExcerpt", e.target.value)}
          placeholder="Paste a sample credit report excerpt showing this violation pattern"
          rows={3}
        />
      </div>

      {/* Legal References */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Case Law Reference</Label>
          <Textarea
            value={form.caseLawReference}
            onChange={e => update("caseLawReference", e.target.value)}
            placeholder="e.g., Safeco Ins. Co. v. Burr, 551 U.S. 47 (2007)"
            rows={2}
          />
        </div>
        <div>
          <Label>Regulatory Guidance</Label>
          <Textarea
            value={form.regulatoryGuidance}
            onChange={e => update("regulatoryGuidance", e.target.value)}
            placeholder="e.g., CFPB Bulletin 2013-09 on indirect auto lending"
            rows={2}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <Switch checked={form.isActive} onCheckedChange={v => update("isActive", v)} />
          <Label>Active (included in AI training)</Label>
        </div>
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending ? "Saving..." : (isEditing ? "Update Example" : "Create Example")}
        </Button>
      </div>
    </div>
  );
}
