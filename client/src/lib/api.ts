export async function createScan(consumerName: string, clientName?: string, clientState?: string) {
  const res = await fetch("/api/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consumerName, clientName, clientState }),
  });
  if (!res.ok) throw new Error("Failed to create scan");
  return res.json();
}

export async function fetchScans() {
  const res = await fetch("/api/scans");
  if (!res.ok) throw new Error("Failed to fetch scans");
  return res.json();
}

export async function fetchScan(id: number) {
  const res = await fetch(`/api/scans/${id}`);
  if (!res.ok) throw new Error("Failed to fetch scan");
  return res.json();
}

export async function updateScan(id: number, data: {
  currentStep?: number;
  status?: string;
  clientName?: string | null;
  clientState?: string | null;
  scanNotes?: string | null;
}) {
  const res = await fetch(`/api/scans/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update scan");
  return res.json();
}

export async function deleteScan(id: number) {
  const res = await fetch(`/api/scans/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete scan");
}

export async function addNegativeAccount(scanId: number, data: {
  creditor: string;
  accountNumber?: string;
  accountType: string;
  originalCreditor?: string;
  balance?: number;
  dateOpened?: string;
  dateOfDelinquency?: string;
  status?: string;
  bureaus?: string;
  rawDetails?: string;
}) {
  const res = await fetch(`/api/scans/${scanId}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to add account");
  return res.json();
}

export async function updateNegativeAccount(scanId: number, accountId: number, data: Record<string, any>) {
  const res = await fetch(`/api/scans/${scanId}/accounts/${accountId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update account");
  return res.json();
}

export async function deleteNegativeAccount(scanId: number, accountId: number) {
  const res = await fetch(`/api/scans/${scanId}/accounts/${accountId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete account");
}

export async function scanAccountForViolations(accountId: number) {
  const res = await fetch(`/api/accounts/${accountId}/scan`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to scan account for violations");
  }
  return res.json();
}

export async function uploadScanFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/scans/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Upload failed");
  }
  return res.json();
}

// ========== REVIEW WORKFLOW API ==========

export async function reviewViolation(violationId: number, data: {
  reviewStatus: string;
  reviewerNotes?: string | null;
  severityOverride?: string | null;
  descriptionOverride?: string | null;
  reviewedBy?: string | null;
}) {
  const res = await fetch(`/api/violations/${violationId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to review violation");
  }
  return res.json();
}

export async function approveScan(scanId: number, data: {
  reviewedBy: string;
  reviewNotes?: string | null;
}) {
  const res = await fetch(`/api/scans/${scanId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to approve scan");
  }
  return res.json();
}

export async function reopenScan(scanId: number) {
  const res = await fetch(`/api/scans/${scanId}/reopen`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to reopen scan");
  }
  return res.json();
}

export async function fetchReviewSummary(scanId: number) {
  const res = await fetch(`/api/scans/${scanId}/review-summary`);
  if (!res.ok) throw new Error("Failed to fetch review summary");
  return res.json();
}

export async function exportPdf(scanId: number) {
  const res = await fetch(`/api/scans/${scanId}/export/pdf`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Export not available");
  }
  return res.json();
}

export async function exportCsv(scanId: number, includeRejected = false) {
  const res = await fetch(`/api/scans/${scanId}/export/csv?include_rejected=${includeRejected}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Export not available");
  }
  return res.text();
}

export async function updateReportMetadata(scanId: number, data: {
  reportTitle?: string | null;
  clientName?: string | null;
  clientState?: string | null;
  scanNotes?: string | null;
}) {
  const res = await fetch(`/api/scans/${scanId}/report`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update report metadata");
  return res.json();
}
