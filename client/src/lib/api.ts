import { queryClient } from "./queryClient";

export async function uploadReport(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/reports/upload", {
    method: "POST",
    body: formData,
  });

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
