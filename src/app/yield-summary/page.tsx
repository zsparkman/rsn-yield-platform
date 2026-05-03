import { getEtl } from "@/lib/etl-data";
import { YieldSummaryTable } from "@/components/YieldSummaryTable";

export const metadata = { title: "Yield Summary · RSN Yield Platform" };

export default function YieldSummaryPage() {
  const etl = getEtl();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Yield Summary
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          LOB × spot-group decomposition with AUR (per-unit) and EUR (Net,
          per-eq30) yield metrics. Toggle Direct / Repped to slice the
          decomposition by line of business.
        </p>
      </div>
      <YieldSummaryTable rows={etl.aurSummary} />
    </div>
  );
}
