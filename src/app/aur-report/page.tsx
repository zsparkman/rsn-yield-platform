import { getEtl } from "@/lib/etl-data";
import { AurReportTable } from "@/components/AurReportTable";

export const metadata = { title: "AUR Report · RSN Yield Platform" };

export default function AurReportPage() {
  const etl = getEtl();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          AUR Report
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          LOB × spot-group decomposition with AUR (per-unit) and EUR (Net,
          per-eq30) yield metrics. Toggle Direct / Repped to slice the
          decomposition by line of business.
        </p>
      </div>
      <AurReportTable rows={etl.aurSummary} />
    </div>
  );
}
