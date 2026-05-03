import { getEtl } from "@/lib/etl-data";
import { HeatmapTable } from "@/components/HeatmapTable";

export const metadata = { title: "Heatmap · RSN Yield Platform" };

export default function HeatmapPage() {
  const etl = getEtl();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Heatmap
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Per-game sellout percentage by inventory type, grouped by month with
          weighted month subtotals.
        </p>
      </div>
      <HeatmapTable rows={etl.inventoryExc0} />
    </div>
  );
}
