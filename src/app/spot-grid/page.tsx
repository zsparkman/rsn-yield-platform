import { getEtl } from "@/lib/etl-data";
import { SpotGridMatrix } from "@/components/SpotGridMatrix";

export const metadata = { title: "Spot Grid · RSN Yield Platform" };

export default function SpotGridPage() {
  const etl = getEtl();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Spot Grid
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Top advertisers × dates matrix of EQ30 by spot status and inventory
          type. Sticky client column on the left and sticky date row on top.
        </p>
      </div>
      <SpotGridMatrix cells={etl.spotGrid} />
    </div>
  );
}
