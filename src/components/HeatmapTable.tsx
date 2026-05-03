"use client";

// Heatmap view per IA View 3.
// Per-game row with sellout % for Pregame / In Game / Postgame, grouped
// by month with weighted subtotal rows. Continuous red gradient per cell.

import { useMemo, useState } from "react";
import type { InventoryRollupRow, SeasonPhase } from "@/lib/types";
import { fmtIsoLong, fmtDow, fmtPercent, heatmapRedGradient } from "@/lib/format";
import { Segment } from "@/components/FilterStrip";
import { ReportHeaderSelectors, type CalendarMode } from "@/components/ReportHeaderSelectors";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
type MonthFilter = "All" | (typeof MONTHS)[number];
type PhaseFilter = "All" | SeasonPhase;

interface GameRow {
  date: string;
  evtProgram: string;
  type2: SeasonPhase;
  matchup: string;
  standardMonth: string;
  bcastMonth: string;
  pregame: { sellout: number; sold: number; cap: number } | null;
  inGame: { sellout: number; sold: number; cap: number } | null;
  postgame: { sellout: number; sold: number; cap: number } | null;
}

function buildGameRows(rows: InventoryRollupRow[]): GameRow[] {
  const byKey = new Map<string, InventoryRollupRow[]>();
  for (const r of rows) {
    const k = `${r.DATE}|${r.EVENT_PROGRAM}`;
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const out: GameRow[] = [];
  for (const list of byKey.values()) {
    const head = list[0];
    const find = (predicate: (s: string) => boolean) => {
      const r = list.find((x) => predicate(x["INV TYPE"]));
      return r ? { sellout: r.Sellout, sold: r.Sold, cap: r.Cap } : null;
    };
    out.push({
      date: head.DATE,
      evtProgram: head.EVENT_PROGRAM,
      type2: head.TYPE2,
      matchup: head.Matchup,
      standardMonth: head.broadcast_month,  // existing field is standard-derived
      bcastMonth: head.bcast_month,
      pregame: find((s) => s === "Pregame"),
      inGame: find((s) => s === "In Game" || s === "In Game+" || s === "In Game-"),
      postgame: find((s) => s === "Postgame"),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function weighted(rows: GameRow[], pick: (g: GameRow) => { sellout: number; sold: number; cap: number } | null): number {
  let sold = 0; let cap = 0;
  for (const g of rows) {
    const c = pick(g);
    if (!c) continue;
    sold += c.sold; cap += c.cap;
  }
  return cap > 0 ? sold / cap : 0;
}

export function HeatmapTable({ rows }: { rows: InventoryRollupRow[] }) {
  const [phase, setPhase] = useState<PhaseFilter>("All");
  const [month, setMonth] = useState<MonthFilter>("All");
  const [year, setYear] = useState("2026");
  const [calendar, setCalendar] = useState<CalendarMode>("standard");

  const monthOf = (g: GameRow) =>
    calendar === "broadcast" ? g.bcastMonth : g.standardMonth;

  const allGames = useMemo(() => buildGameRows(rows), [rows]);
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const g of allGames) set.add(monthOf(g));
    return Array.from(set).sort((a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGames, calendar]);

  const filtered = useMemo(() => {
    return allGames.filter((g) => {
      if (phase !== "All" && g.type2 !== phase) return false;
      if (month !== "All" && monthOf(g) !== month) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGames, phase, month, calendar]);

  const groupedByMonth = useMemo(() => {
    const map = new Map<string, GameRow[]>();
    for (const g of filtered) {
      const k = monthOf(g);
      const list = map.get(k) ?? [];
      list.push(g);
      map.set(k, list);
    }
    return Array.from(map.entries()).sort(
      (a, b) => MONTHS.indexOf(a[0]) - MONTHS.indexOf(b[0]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, calendar]);

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
        <Segment<PhaseFilter>
          label="Phase"
          value={phase}
          options={[
            { value: "All", label: "All" },
            { value: "PR", label: "PR" },
            { value: "REG", label: "REG" },
          ]}
          onChange={setPhase}
        />
        <Segment<MonthFilter>
          label="Month"
          value={month}
          options={[
            { value: "All" as MonthFilter, label: "All" },
            ...months.map((m) => ({ value: m as MonthFilter, label: m.slice(0, 3) })),
          ]}
          onChange={setMonth}
        />
        <span className="ml-auto text-xs text-slate-500">
          {filtered.length} games
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No games match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="grid-table w-full table-fixed text-[13px] leading-tight">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="min-w-[168px] px-3 py-2">Air Date</th>
                <th className="min-w-[280px] px-3 py-2">Event / Program</th>
                <th className="min-w-[96px] px-3 py-2 text-right num">Pregame</th>
                <th className="min-w-[96px] px-3 py-2 text-right num">In Game</th>
                <th className="min-w-[96px] px-3 py-2 text-right num">Postgame</th>
              </tr>
            </thead>
            <tbody>
              {groupedByMonth.map(([m, games]) => (
                <MonthBlock key={m} monthName={m} games={games} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MonthBlock({ monthName, games }: { monthName: string; games: GameRow[] }) {
  return (
    <>
      <tr className="border-b border-slate-200 bg-slate-100">
        <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
          {monthName} · {games.length} games
        </td>
      </tr>
      {games.map((g) => (
        <tr key={`${g.date}|${g.evtProgram}`} className="border-b border-slate-50 last:border-b-0">
          <td className="px-3 py-1.5 text-slate-700">
            <span className="text-xs text-slate-500">{fmtDow(g.date)} </span>
            {fmtIsoLong(g.date)}
          </td>
          <td className="truncate px-3 py-1.5 text-slate-700" title={`${g.evtProgram} · ${g.type2} · ${g.matchup}`}>
            {g.evtProgram}
            <span className="ml-2 text-[11px] text-slate-400">{g.type2} · {g.matchup}</span>
          </td>
          <HeatCell pct={g.pregame?.sellout ?? null} />
          <HeatCell pct={g.inGame?.sellout ?? null} />
          <HeatCell pct={g.postgame?.sellout ?? null} />
        </tr>
      ))}
      <tr className="border-y-2 border-slate-300 bg-slate-50 font-medium">
        <td colSpan={2} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">
          {monthName} weighted avg
        </td>
        <HeatCell pct={weighted(games, (g) => g.pregame)} bold />
        <HeatCell pct={weighted(games, (g) => g.inGame)} bold />
        <HeatCell pct={weighted(games, (g) => g.postgame)} bold />
      </tr>
    </>
  );
}

function HeatCell({ pct, bold = false }: { pct: number | null; bold?: boolean }) {
  if (pct == null) {
    return <td className="px-3 py-1.5 text-right text-xs italic text-slate-400">No game</td>;
  }
  const { bg, text } = heatmapRedGradient(pct);
  return (
    <td
      className={`num px-3 py-1.5 text-right ${bold ? "font-semibold" : ""}`}
      style={{ backgroundColor: bg, color: text }}
    >
      {fmtPercent(pct)}
    </td>
  );
}
