"use client";

// Booking Matrix view per IA View 4. Top-N clients × dates matrix; cell value
// = total EQ30 (or paid-spot count when Metric=Units) matching active filters;
// green saturation by intensity. Sticky client column on the left, sticky
// date row on top. Per-client twirl-down expands to one sub-row per
// OrderNumber the client booked, with the same date×cell layout.

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { SpotGridCell, SpotGridOrderCell, SpotGroupKind } from "@/lib/types";
import { fmtEq30, fmtIntCount, fmtIsoShort, gridDensityHeat } from "@/lib/format";
import { Segment } from "@/components/FilterStrip";
import { ReportHeaderSelectors, type CalendarMode } from "@/components/ReportHeaderSelectors";

type InvFilter = "All" | "Pregame" | "In Game" | "Postgame";
type StatusFilter = "All" | SpotGroupKind;
type TopNFilter = "25" | "50" | "100";
type MetricFilter = "EQ30" | "Units";

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx("size-3", className)}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function BookingMatrix({
  cells,
  orderCells,
}: {
  cells: SpotGridCell[];
  orderCells: SpotGridOrderCell[];
}) {
  const [inv, setInv] = useState<InvFilter>("All");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [topN, setTopN] = useState<TopNFilter>("50");
  const [metric, setMetric] = useState<MetricFilter>("EQ30");
  const [year, setYear] = useState("2026");
  const [calendar, setCalendar] = useState<CalendarMode>("standard");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  void calendar; // selector mounted; matrix is per-day so calendar mode is informational only

  const valueOf = (c: SpotGridCell) => (metric === "Units" ? c.units : c.eq30);

  // When the inv filter pins a specific inv-type, the matrix should only
  // surface clients/orders that actually transacted PAID inventory in that
  // segment — a client with only ADU/NC In Game spots isn't an "In Game
  // advertiser" in the sales-facing sense. Compute the qualifying sets up
  // front; null means no gating (inv === "All").
  const qualifyingClients = useMemo(() => {
    if (inv === "All") return null;
    const set = new Set<string>();
    for (const c of cells) {
      if (c.inv_type === inv && c.group === "Paid" && c.eq30 > 0) set.add(c.client);
    }
    return set;
  }, [cells, inv]);

  const qualifyingOrders = useMemo(() => {
    if (inv === "All") return null;
    const set = new Set<string>();
    for (const c of orderCells) {
      if (c.inv_type === inv && c.group === "Paid" && c.eq30 > 0) {
        set.add(`${c.client}|${c.order_number}`);
      }
    }
    return set;
  }, [orderCells, inv]);

  const filtered = useMemo(
    () => cells.filter((c) =>
      (inv === "All" || c.inv_type === inv) &&
      (status === "All" || c.group === status) &&
      (qualifyingClients === null || qualifyingClients.has(c.client)),
    ),
    [cells, inv, status, qualifyingClients],
  );

  const filteredOrders = useMemo(
    () => orderCells.filter((c) =>
      (inv === "All" || c.inv_type === inv) &&
      (status === "All" || c.group === status) &&
      (qualifyingOrders === null || qualifyingOrders.has(`${c.client}|${c.order_number}`)),
    ),
    [orderCells, inv, status, qualifyingOrders],
  );

  // (client, date) → cell value
  const cellMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filtered) {
      const k = `${c.client}|${c.date}`;
      m.set(k, (m.get(k) ?? 0) + valueOf(c));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, metric]);

  // (client, order_number, date) → cell value
  const orderCellMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filteredOrders) {
      const k = `${c.client}|${c.order_number}|${c.date}`;
      m.set(k, (m.get(k) ?? 0) + valueOf(c));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders, metric]);

  // client → totals (for ranking)
  const clientTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filtered) m.set(c.client, (m.get(c.client) ?? 0) + valueOf(c));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, metric]);

  // client → ordered list of order numbers (descending volume)
  const ordersByClient = useMemo(() => {
    const totals = new Map<string, Map<number, number>>();
    for (const c of filteredOrders) {
      let inner = totals.get(c.client);
      if (!inner) { inner = new Map(); totals.set(c.client, inner); }
      inner.set(c.order_number, (inner.get(c.order_number) ?? 0) + valueOf(c));
    }
    const out = new Map<string, number[]>();
    for (const [client, inner] of totals) {
      out.set(client, Array.from(inner.entries()).sort((a, b) => b[1] - a[1]).map(([o]) => o));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders, metric]);

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

  function toggleClient(client: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(client)) next.delete(client);
      else next.add(client);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-5">
        <ReportHeaderSelectors
          year={year}
          onYear={setYear}
          calendar={calendar}
          onCalendar={setCalendar}
        />
      </div>
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
        <Segment<MetricFilter>
          label="Metric"
          value={metric}
          options={[
            { value: "EQ30", label: "EQ30" },
            { value: "Units", label: "Units" },
          ]}
          onChange={setMetric}
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
        <table className="table-fixed border-separate border-spacing-0 text-[11px] leading-tight">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 w-[220px] min-w-[220px] max-w-[220px] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-600"
              >
                Client
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  className="sticky top-0 z-20 w-[56px] min-w-[56px] max-w-[56px] border-b border-l border-slate-200 bg-slate-100 px-1 py-2 text-center text-[10px] font-normal text-slate-500"
                >
                  {fmtIsoShort(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topClients.map((client) => (
              <ClientRow
                key={client}
                client={client}
                dates={dates}
                cellMap={cellMap}
                metric={metric}
                expanded={expanded.has(client)}
                onToggle={() => toggleClient(client)}
                orders={ordersByClient.get(client) ?? []}
                orderCellMap={orderCellMap}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientRow({
  client, dates, cellMap, metric, expanded, onToggle, orders, orderCellMap,
}: {
  client: string;
  dates: string[];
  cellMap: Map<string, number>;
  metric: MetricFilter;
  expanded: boolean;
  onToggle: () => void;
  orders: number[];
  orderCellMap: Map<string, number>;
}) {
  return (
    <>
      <tr>
        <th
          scope="row"
          className="sticky left-0 z-10 w-[220px] min-w-[220px] max-w-[220px] border-b border-r border-slate-200 bg-white px-2 py-1 text-left font-normal text-slate-700"
        >
          <div className="flex items-center gap-1 overflow-hidden">
            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? "Collapse orders" : "Expand orders"}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <ChevronRight className={clsx("transition-transform", expanded && "rotate-90")} />
            </button>
            <span
              title={client}
              className="block overflow-hidden text-ellipsis whitespace-nowrap"
            >
              {client}
            </span>
          </div>
        </th>
        {dates.map((d) => {
          const v = cellMap.get(`${client}|${d}`) ?? 0;
          return (
            <td
              key={d}
              className={clsx(
                "num border-b border-l border-slate-200 px-1 text-center",
                v === 0 ? "bg-white text-slate-300" : gridDensityHeat(v),
              )}
            >
              {v === 0 ? "" : metric === "Units" ? fmtIntCount(v) : fmtEq30(v)}
            </td>
          );
        })}
      </tr>
      {expanded && orders.map((order) => (
        <tr key={`${client}-${order}`} className="bg-slate-50/40">
          <th
            scope="row"
            className="sticky left-0 z-10 w-[220px] min-w-[220px] max-w-[220px] border-b border-r border-slate-200 bg-slate-50/80 px-2 py-1 text-left font-normal text-slate-600"
          >
            <div className="flex items-center gap-1 overflow-hidden pl-5">
              <span
                title={`Order #${order}`}
                className="block overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-slate-500"
              >
                Order #{order}
              </span>
            </div>
          </th>
          {dates.map((d) => {
            const v = orderCellMap.get(`${client}|${order}|${d}`) ?? 0;
            return (
              <td
                key={d}
                className={clsx(
                  "num border-b border-l border-slate-200 px-1 text-center",
                  v === 0 ? "bg-white text-slate-300" : gridDensityHeat(v),
                )}
              >
                {v === 0 ? "" : metric === "Units" ? fmtIntCount(v) : fmtEq30(v)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
