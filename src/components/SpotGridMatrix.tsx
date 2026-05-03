"use client";

// Spot Grid view per IA View 4. Top-N clients × dates matrix; cell value
// = total EQ30 matching active filters; green saturation by intensity.
// Sticky client column on the left, sticky date row on top.

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { SpotGridCell, SpotGroupKind } from "@/lib/types";
import { fmtEq30, fmtIsoShort, gridDensityHeat } from "@/lib/format";
import { Segment } from "@/components/FilterStrip";

type InvFilter = "All" | "Pregame" | "In Game" | "Postgame";
type StatusFilter = "All" | SpotGroupKind;
type TopNFilter = "25" | "50" | "100";

export function SpotGridMatrix({ cells }: { cells: SpotGridCell[] }) {
  const [inv, setInv] = useState<InvFilter>("All");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [topN, setTopN] = useState<TopNFilter>("50");

  const filtered = useMemo(
    () => cells.filter((c) =>
      (inv === "All" || c.inv_type === inv) &&
      (status === "All" || c.group === status),
    ),
    [cells, inv, status],
  );

  // Aggregate per (client, date) for the cell value.
  const cellMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filtered) {
      const k = `${c.client}|${c.date}`;
      m.set(k, (m.get(k) ?? 0) + c.eq30);
    }
    return m;
  }, [filtered]);

  // Client totals (for ranking).
  const clientTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filtered) m.set(c.client, (m.get(c.client) ?? 0) + c.eq30);
    return m;
  }, [filtered]);

  const topClients = useMemo(() => {
    return Array.from(clientTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Number(topN))
      .map(([client]) => client);
  }, [clientTotals, topN]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const c of filtered) set.add(c.date);
    return Array.from(set).sort();
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Segment<InvFilter>
          label="Inventory"
          value={inv}
          options={[
            { value: "All", label: "All" },
            { value: "Pregame", label: "Pregame" },
            { value: "In Game", label: "In Game" },
            { value: "Postgame", label: "Postgame" },
          ]}
          onChange={setInv}
        />
        <Segment<StatusFilter>
          label="Status"
          value={status}
          options={[
            { value: "All", label: "All" },
            { value: "Paid", label: "Paid" },
            { value: "NC", label: "NC" },
            { value: "ADU", label: "ADU" },
            { value: "xADU", label: "xADU" },
            { value: "Bonus", label: "Bonus" },
          ]}
          onChange={setStatus}
        />
        <Segment<TopNFilter>
          label="Top"
          value={topN}
          options={[
            { value: "25", label: "25" },
            { value: "50", label: "50" },
            { value: "100", label: "100" },
          ]}
          onChange={setTopN}
        />
        <span className="ml-auto text-xs text-slate-500">
          {topClients.length} clients · {dates.length} dates
        </span>
      </div>

      <div className="relative max-h-[78vh] overflow-auto rounded border border-slate-200 bg-white">
        <table className="border-separate border-spacing-0 text-[11px] leading-tight">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-600"
              >
                Client
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  className="sticky top-0 z-20 min-w-[44px] border-b border-l border-slate-200 bg-slate-100 px-1 py-2 text-center text-[10px] font-normal text-slate-500"
                >
                  {fmtIsoShort(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topClients.map((client) => (
              <tr key={client}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[200px] border-b border-r border-slate-200 bg-white px-3 py-1 text-left font-normal text-slate-700"
                >
                  {client}
                </th>
                {dates.map((d) => {
                  const eq = cellMap.get(`${client}|${d}`) ?? 0;
                  return (
                    <td
                      key={d}
                      className={clsx(
                        "num border-b border-l border-slate-200 px-1 py-1 text-center",
                        eq === 0 ? "bg-white text-slate-300" : gridDensityHeat(eq),
                      )}
                    >
                      {eq === 0 ? "" : fmtEq30(eq)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
