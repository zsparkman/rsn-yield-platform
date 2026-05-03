"use client";

// Inventory view table per docs/spec/02-information-architecture.md View 1.
// Server component (page.tsx) passes the full inventory rollup; this client
// component handles filter state, sort, and paging.

import { useMemo, useState } from "react";
import clsx from "clsx";
import type {
  InventoryRollupRow,
  Format,
  MatchupTier,
  SeasonPhase,
} from "@/lib/types";
import {
  fmtAvails,
  fmtCurrencyRolled,
  fmtCurrencyUnit,
  fmtDow,
  fmtEq30,
  fmtIsoLong,
  fmtPercent,
  selloutHeat,
} from "@/lib/format";
import { DateRangeFilter, Segment } from "@/components/FilterStrip";
import { ReportHeaderSelectors, type CalendarMode } from "@/components/ReportHeaderSelectors";

const PAGE_SIZE_GAMES = 50;

type PhaseFilter = SeasonPhase | "All";
type MatchupFilter = MatchupTier | "All";
type FormatFilter = Format | "All";

type SortKey =
  | "DATE" | "EVENT_PROGRAM" | "INV TYPE"
  | "avail" | "Cap" | "Sold" | "Sellout"
  | "net_rev_cents" | "eur_gross_cents";
type SortDir = "asc" | "desc";

const INV_ORDER: Record<string, number> = {
  Pregame: 0, "In Game": 1, "In Game+": 1, "In Game-": 1,
  Postgame: 2,
};

function compareCells(a: InventoryRollupRow, b: InventoryRollupRow, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  if (key === "DATE") cmp = a.DATE.localeCompare(b.DATE);
  else if (key === "EVENT_PROGRAM") cmp = a.EVENT_PROGRAM.localeCompare(b.EVENT_PROGRAM);
  else if (key === "INV TYPE") cmp = (INV_ORDER[a["INV TYPE"]] ?? 9) - (INV_ORDER[b["INV TYPE"]] ?? 9);
  else cmp = (a[key] as number) - (b[key] as number);
  return dir === "asc" ? cmp : -cmp;
}

// Sort whole *games* by the chosen column (using the In Game row's value as the
// game-level proxy for non-DATE/non-EVENT/non-INV-TYPE sorts).
function gameKey(rows: InventoryRollupRow[], key: SortKey): number | string {
  const inGame = rows.find((r) => r["INV TYPE"].startsWith("In Game")) ?? rows[0];
  if (key === "DATE") return inGame.DATE;
  if (key === "EVENT_PROGRAM") return inGame.EVENT_PROGRAM;
  if (key === "INV TYPE") return inGame["INV TYPE"];
  return inGame[key] as number;
}

interface GroupedGame {
  date: string;
  evtProgram: string;
  type2: SeasonPhase;
  matchup: MatchupTier;
  format: Format;
  rows: InventoryRollupRow[]; // sorted by inv-type
  totalNetCents: number;
  weightedEurGrossCents: number;
}

function groupGames(rows: InventoryRollupRow[]): GroupedGame[] {
  const byKey = new Map<string, InventoryRollupRow[]>();
  for (const r of rows) {
    const k = `${r.DATE}|${r.EVENT_PROGRAM}`;
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const out: GroupedGame[] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort(
      (a, b) => (INV_ORDER[a["INV TYPE"]] ?? 9) - (INV_ORDER[b["INV TYPE"]] ?? 9),
    );
    const head = sorted[0];
    const totalNetCents = sorted.reduce((s, r) => s + r.net_rev_cents, 0);
    const totalEq30 = sorted.reduce((s, r) => s + (r.gross_rev_cents > 0 ? r.Sold : 0), 0);
    const totalGrossCents = sorted.reduce((s, r) => s + r.gross_rev_cents, 0);
    const weightedEurGrossCents = totalEq30 > 0
      ? Math.round(totalGrossCents / totalEq30)
      : 0;
    out.push({
      date: head.DATE,
      evtProgram: head.EVENT_PROGRAM,
      type2: head.TYPE2,
      matchup: head.Matchup,
      format: head.Format,
      rows: sorted,
      totalNetCents,
      weightedEurGrossCents,
    });
  }
  return out;
}

export function InventoryTable({
  rows,
  minDate,
  maxDate,
}: {
  rows: InventoryRollupRow[];
  minDate: string;
  maxDate: string;
}) {
  const [startDate, setStartDate] = useState(minDate);
  const [endDate, setEndDate] = useState(maxDate);
  const [phase, setPhase] = useState<PhaseFilter>("All");
  const [matchup, setMatchup] = useState<MatchupFilter>("All");
  const [format, setFormat] = useState<FormatFilter>("All");
  const [sortKey, setSortKey] = useState<SortKey>("DATE");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [year, setYear] = useState("2026");
  const [calendar, setCalendar] = useState<CalendarMode>("standard");
  void calendar; // selector mounted as placeholder; calendar mode does not change date-range filter behavior

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.DATE < startDate || r.DATE > endDate) return false;
      if (phase !== "All" && r.TYPE2 !== phase) return false;
      if (matchup !== "All" && r.Matchup !== matchup) return false;
      if (format !== "All" && r.Format !== format) return false;
      return true;
    });
  }, [rows, startDate, endDate, phase, matchup, format]);

  const games = useMemo(() => {
    const grouped = groupGames(filtered);
    grouped.sort((a, b) => {
      const av = gameKey(a.rows, sortKey);
      const bv = gameKey(b.rows, sortKey);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return grouped;
  }, [filtered, sortKey, sortDir]);

  const totalGames = games.length;
  const totalPages = Math.max(1, Math.ceil(totalGames / PAGE_SIZE_GAMES));
  const pageGames = games.slice(page * PAGE_SIZE_GAMES, (page + 1) * PAGE_SIZE_GAMES);

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "DATE" || k === "EVENT_PROGRAM" || k === "INV TYPE" ? "asc" : "desc"); }
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
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          min={minDate}
          max={maxDate}
          onStart={(d) => { setStartDate(d); setPage(0); }}
          onEnd={(d) => { setEndDate(d); setPage(0); }}
        />
        <Segment<PhaseFilter>
          label="Phase"
          value={phase}
          options={[
            { value: "All", label: "All" },
            { value: "PR", label: "PR" },
            { value: "REG", label: "REG" },
          ]}
          onChange={(v) => { setPhase(v); setPage(0); }}
        />
        <Segment<MatchupFilter>
          label="Matchup"
          value={matchup}
          options={[
            { value: "All", label: "All" },
            { value: "Regional", label: "Regional" },
            { value: "Standard", label: "Standard" },
          ]}
          onChange={(v) => { setMatchup(v); setPage(0); }}
        />
        <Segment<FormatFilter>
          label="Format"
          value={format}
          options={[
            { value: "All", label: "All" },
            { value: "Standard", label: "Standard" },
            { value: "Expanded", label: "Expanded" },
          ]}
          onChange={(v) => { setFormat(v); setPage(0); }}
        />
        <span className="ml-auto text-xs text-slate-500">
          {totalGames} games · page {page + 1} of {totalPages}
        </span>
      </div>

      {totalGames === 0 ? (
        <p className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No games match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="grid-table w-full text-[13px] leading-tight">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <Th onClick={() => setSort("DATE")} active={sortKey === "DATE"} dir={sortDir}>Date</Th>
                <Th onClick={() => setSort("EVENT_PROGRAM")} active={sortKey === "EVENT_PROGRAM"} dir={sortDir}>Event / Program</Th>
                <Th onClick={() => setSort("INV TYPE")} active={sortKey === "INV TYPE"} dir={sortDir}>Inventory</Th>
                <Th onClick={() => setSort("avail")} active={sortKey === "avail"} dir={sortDir} numeric>Avail</Th>
                <Th onClick={() => setSort("Cap")} active={sortKey === "Cap"} dir={sortDir} numeric>Cap</Th>
                <Th onClick={() => setSort("Sold")} active={sortKey === "Sold"} dir={sortDir} numeric>Sold</Th>
                <Th onClick={() => setSort("Sellout")} active={sortKey === "Sellout"} dir={sortDir} numeric>Sellout%</Th>
                <Th onClick={() => setSort("net_rev_cents")} active={sortKey === "net_rev_cents"} dir={sortDir} numeric>REV (Net)</Th>
                <Th onClick={() => setSort("eur_gross_cents")} active={sortKey === "eur_gross_cents"} dir={sortDir} numeric>EUR (Gross)</Th>
              </tr>
            </thead>
            <tbody>
              {pageGames.map((g) => (
                <GameBlock key={`${g.date}|${g.evtProgram}`} g={g} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border border-slate-200 bg-white px-3 py-1 text-slate-700 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-2 text-slate-500">page {page + 1} / {totalPages}</span>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="rounded border border-slate-200 bg-white px-3 py-1 text-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function Th({
  children, onClick, active, dir, numeric = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  numeric?: boolean;
}) {
  return (
    <th className={clsx("px-3 py-2", numeric && "text-right num")}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-slate-900"
      >
        {children}
        {active && <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function GameBlock({ g }: { g: GroupedGame }) {
  return (
    <>
      {g.rows.map((r, i) => (
        <tr key={`${g.date}|${g.evtProgram}|${r["INV TYPE"]}`} className="border-b border-slate-100 last:border-b-0">
          {i === 0 ? (
            <>
              <td rowSpan={g.rows.length + 1} className="border-r border-slate-100 px-3 py-2 align-top text-slate-700">
                <div className="text-xs text-slate-500">{fmtDow(g.date)}</div>
                <div>{fmtIsoLong(g.date)}</div>
                <div className="mt-1 text-[11px] text-slate-400">{g.type2} · {g.matchup}</div>
              </td>
              <td rowSpan={g.rows.length + 1} className="border-r border-slate-100 px-3 py-2 align-top text-slate-700">
                {g.evtProgram}
                <div className="mt-1 text-[11px] text-slate-400">{g.format}</div>
              </td>
            </>
          ) : null}
          <td className="px-3 py-2 text-slate-700">{r["INV TYPE"]}</td>
          <td className={clsx("num px-3 py-2 text-right", r.avail === 0 && "bg-red-100 text-red-900 font-medium")}>
            {fmtAvails(r.avail)}
          </td>
          <td className="num px-3 py-2 text-right text-slate-700">{fmtAvails(r.Cap)}</td>
          <td className="num px-3 py-2 text-right text-slate-700">{fmtEq30(r.Sold)}</td>
          <td className={clsx("num px-3 py-2 text-right", selloutHeat(r.Sellout))}>
            {fmtPercent(r.Sellout)}
          </td>
          <td className="num px-3 py-2 text-right text-slate-700">{fmtCurrencyRolled(r.net_rev_cents)}</td>
          <td className="num px-3 py-2 text-right text-slate-700">{fmtCurrencyUnit(r.eur_gross_cents)}</td>
        </tr>
      ))}
      <tr className="bg-slate-50 font-semibold text-slate-900">
        {/* Date and Event/Program are rowspan-merged from the first data row,
            so the GAME TOTAL row only fills the remaining 7 columns:
            Inv + Avail + Cap + Sold + Sellout + REV (Net) + EUR (Gross). */}
        <td
          colSpan={5}
          className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-700"
        >
          Game total
        </td>
        <td className="num px-3 py-2 text-right text-xs font-semibold">
          {fmtCurrencyRolled(g.totalNetCents)}
        </td>
        <td className="num px-3 py-2 text-right text-xs font-semibold">
          {fmtCurrencyUnit(g.weightedEurGrossCents)}
        </td>
      </tr>
    </>
  );
}
