import { queryClient } from "./queryClient";

export async function uploadReport(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/reports/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Upload failed");
  }
  return res.json();
}

export async function fetchReports() {
  const res = await fetch("/api/reports");
  if (!res.ok) throw new Error("Failed to fetch reports");
  return res.json();
}

export async function fetchReport(id: number) {
  const res = await fetch(`/api/reports/${id}`);
  if (!res.ok) throw new Error("Failed to fetch report");
  return res.json();
}

export async function deleteReport(id: number) {
  const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete report");
  queryClient.invalidateQueries({ queryKey: ["reports"] });
}

export async function createScan(consumerName: string) {
  const res = await fetch("/api/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consumerName }),
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

export async function updateScan(id: number, data: { currentStep?: number; status?: string }) {
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
  if (!res.ok) throw new Error("Failed to scan account");
  return res.json();
}

