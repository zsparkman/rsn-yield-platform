import { getEtl } from "@/lib/etl-data";
import { RatesTable } from "@/components/RatesTable";

export const metadata = { title: "Rates · RSN Yield Platform" };

export default function RatesPage() {
  const etl = getEtl();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Rates
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Open avails and the resolved rate per inventory type, grouped by week.
          Rate columns are bold when the row resolves to FL or Bump tier.
        </p>
      </div>
      <RatesTable rows={etl.inventoryExc0} />
    </div>
  );
}
