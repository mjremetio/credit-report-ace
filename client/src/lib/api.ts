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
  reviewStatus?: string;
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3 min timeout per account scan
  try {
    const res = await fetch(`/api/accounts/${accountId}/scan`, {
      method: "POST",
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to scan account for violations");
    }
    return res.json();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("Violation scan timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function extractFileText(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 min for text extraction
  try {
    const res = await fetch("/api/scans/upload-extract", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let message = "Text extraction failed";
      try { message = JSON.parse(text).error || message; } catch {}
      throw new Error(message);
    }
    return res.json() as Promise<{
      rawText: string;
      organizedText: string | null;
      fileName: string;
      fileType: string;
      isImage: boolean;
      isTriBureau: boolean;
      bureauCount: number;
    }>;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("Text extraction timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function analyzeExtractedText(rawText: string, fileName?: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600_000); // 10 min for AI analysis
  try {
    const res = await fetch("/api/scans/analyze-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText, fileName }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let message = "Analysis failed";
      try { message = JSON.parse(text).error || message; } catch {}
      throw new Error(message);
    }
    return res.json();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("Analysis timed out. The report may be too large. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadScanFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600_000); // 10 min timeout for upload + AI analysis
  try {
    const res = await fetch("/api/scans/upload", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let message = "Upload failed";
      try {
        const error = JSON.parse(text);
        message = error.error || message;
      } catch {
        message = text || message;
      }
      throw new Error(message);
    }
    return res.json();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("Upload timed out. The file may be too large or the server is busy. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
