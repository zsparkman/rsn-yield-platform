// Inventory view (/inventory) per docs/spec/02-information-architecture.md View 1.
// Server component: loads ETL output once at build time and hands the rollup
// to the client-side InventoryTable.

import { getEtl } from "@/lib/etl-data";
import { InventoryTable } from "@/components/InventoryTable";

export const metadata = {
  title: "Inventory · RSN Yield Platform",
};

export default function InventoryPage() {
  const etl = getEtl();
  const rows = etl.inventoryExc0; // Exc-$0 = paid-only Sold; matches the screenshot

  // Establish the date range bounds from the data itself.
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";
  for (const r of rows) {
    if (r.DATE < minDate) minDate = r.DATE;
    if (r.DATE > maxDate) maxDate = r.DATE;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Inventory
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Capacity, units sold, avails, sellout & net revenue by date,
          matchup, and inventory type.
        </p>
      </div>
      <InventoryTable rows={rows} minDate={minDate} maxDate={maxDate} />
    </div>
  );
}
