import { useState } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import { exportPdf, exportCsv } from "@/lib/api";

interface ExportButtonsProps {
  scanId: number;
}

export default function ExportButtons({ scanId }: ExportButtonsProps) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExportPdf = async () => {
    setError(null);
    setExportingPdf(true);
    try {
      const data = await exportPdf(scanId);
      // Download as JSON (would be actual PDF in production)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lexa-report-${scanId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportCsv = async () => {
    setError(null);
    setExportingCsv(true);
    try {
      const csv = await exportCsv(scanId);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lexa-report-${scanId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <button
          onClick={handleExportPdf}
          disabled={exportingPdf}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
        >
          {exportingPdf ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          Export PDF
        </button>

        <button
          onClick={handleExportCsv}
          disabled={exportingCsv}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
        >
          {exportingCsv ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Export CSV
        </button>
      </div>

      {error && (
        <p className="text-xs font-mono text-destructive">{error}</p>
      )}
    </div>
  );
}
