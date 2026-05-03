"use client";

// Rates view per IA View 2.
// Per-game row × inv-type columns. Open = avail; Rate = current_rate_cents.
// Heat scale on Open columns (red→amber→green); rate cells bold when FL or
// Bump tier (signals tier shift).

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { InventoryRollupRow, MatchupTier, SeasonPhase } from "@/lib/types";
import { fmtAvails, fmtCurrencyUnit, fmtIsoLong, fmtDow, openHeat } from "@/lib/format";
import { Segment } from "@/components/FilterStrip";

type PhaseFilter = "All" | SeasonPhase;
type MatchupFilter = "All" | MatchupTier;

interface CellFig {
  avail: number;
  rateCents: number;
  tier: "Base" | "FL" | "Bump";
}

interface GameRow {
  date: string;
  weekStart: string;
  evtProgram: string;
  type2: SeasonPhase;
  matchup: MatchupTier;
  pregame: CellFig | null;
  inGame: CellFig | null;
  postgame: CellFig | null;
}

function cellOf(rows: InventoryRollupRow[], inv: (s: string) => boolean): CellFig | null {
  const r = rows.find((x) => inv(x["INV TYPE"]));
  if (!r) return null;
  return {
    avail: r.avail,
    rateCents: r.current_rate_cents,
    tier: r["Rate Tier"],
  };
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
    out.push({
      date: head.DATE,
      weekStart: list[0]["Start of Week"],
      evtProgram: head.EVENT_PROGRAM,
      type2: head.TYPE2,
      matchup: head.Matchup,
      pregame: cellOf(list, (s) => s === "Pregame"),
      inGame: cellOf(list, (s) => s === "In Game" || s === "In Game+" || s === "In Game-"),
      postgame: cellOf(list, (s) => s === "Postgame"),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function sumOpen(games: GameRow[], pick: (g: GameRow) => CellFig | null): number {
  let total = 0;
  for (const g of games) {
    const c = pick(g);
    if (c) total += c.avail;
  }
  return total;
}

function avgRate(games: GameRow[], pick: (g: GameRow) => CellFig | null): number {
  let sum = 0; let count = 0;
  for (const g of games) {
    const c = pick(g);
    if (c && c.rateCents > 0) { sum += c.rateCents; count += 1; }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

export function RatesTable({ rows }: { rows: InventoryRollupRow[] }) {
  const [phase, setPhase] = useState<PhaseFilter>("All");
  const [matchup, setMatchup] = useState<MatchupFilter>("All");

  const allGames = useMemo(() => buildGameRows(rows), [rows]);
  const filtered = useMemo(
    () => allGames.filter((g) =>
      (phase === "All" || g.type2 === phase) &&
      (matchup === "All" || g.matchup === matchup),
    ),
    [allGames, phase, matchup],
  );

  const groupedByWeek = useMemo(() => {
    const map = new Map<string, GameRow[]>();
    for (const g of filtered) {
      const list = map.get(g.weekStart) ?? [];
      list.push(g);
      map.set(g.weekStart, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="space-y-4">
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
        <Segment<MatchupFilter>
          label="Matchup"
          value={matchup}
          options={[
            { value: "All", label: "All" },
            { value: "Regional", label: "Regional" },
            { value: "Standard", label: "Standard" },
          ]}
          onChange={setMatchup}
        />
        <span className="ml-auto text-xs text-slate-500">
          Year 2026 · {filtered.length} games
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-[13px] leading-tight">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th rowSpan={2} className="px-3 py-2">Week</th>
              <th rowSpan={2} className="px-3 py-2">Date · Event</th>
              <th colSpan={2} className="px-3 py-2 text-center">Pregame</th>
              <th colSpan={2} className="px-3 py-2 text-center">In Game</th>
              <th colSpan={2} className="px-3 py-2 text-center">Postgame</th>
            </tr>
            <tr>
              <th className="px-3 py-1 text-right num">Open</th>
              <th
                className="px-3 py-1 text-right num"
                title="Base when avails > 0, FL when oversold within floater band, Bump when oversold beyond floater cap"
              >
                Rate
              </th>
              <th className="px-3 py-1 text-right num">Open</th>
              <th
                className="px-3 py-1 text-right num"
                title="Base when avails > 0, FL when oversold within floater band, Bump when oversold beyond floater cap"
              >
                Rate
              </th>
              <th className="px-3 py-1 text-right num">Open</th>
              <th
                className="px-3 py-1 text-right num"
                title="Base when avails > 0, FL when oversold within floater band, Bump when oversold beyond floater cap"
              >
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedByWeek.map(([weekStart, games]) => (
              <WeekBlock key={weekStart} weekStart={weekStart} games={games} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeekBlock({ weekStart, games }: { weekStart: string; games: GameRow[] }) {
  return (
    <>
      {games.map((g, i) => (
        <tr key={`${g.date}|${g.evtProgram}`} className="border-b border-slate-100 last:border-b-0">
          {i === 0 ? (
            <td rowSpan={games.length + 1} className="border-r border-slate-100 px-3 py-2 align-top text-xs uppercase tracking-wide text-slate-500">
              Wk {fmtIsoLong(weekStart)}
              <div className="mt-1 text-[11px] normal-case text-slate-400">{games.length} game{games.length === 1 ? "" : "s"}</div>
            </td>
          ) : null}
          <td className="px-3 py-2 text-slate-700">
            <span className="text-xs text-slate-500">{fmtDow(g.date)} </span>
            {fmtIsoLong(g.date)}
            <div className="text-[11px] text-slate-400">{g.evtProgram} · {g.matchup}</div>
          </td>
          <RateOpenCell cell={g.pregame} />
          <RateRateCell cell={g.pregame} />
          <RateOpenCell cell={g.inGame} />
          <RateRateCell cell={g.inGame} />
          <RateOpenCell cell={g.postgame} />
          <RateRateCell cell={g.postgame} />
        </tr>
      ))}
      <tr className="border-y-2 border-slate-300 bg-slate-50 text-xs font-medium">
        <td className="px-3 py-2 text-right uppercase tracking-wide text-slate-500">
          Week total
        </td>
        <td className="num px-3 py-2 text-right text-slate-700">{fmtAvails(sumOpen(games, (g) => g.pregame))}</td>
        <td className="num px-3 py-2 text-right text-slate-700">{fmtCurrencyUnit(avgRate(games, (g) => g.pregame))}</td>
        <td className="num px-3 py-2 text-right text-slate-700">{fmtAvails(sumOpen(games, (g) => g.inGame))}</td>
        <td className="num px-3 py-2 text-right text-slate-700">{fmtCurrencyUnit(avgRate(games, (g) => g.inGame))}</td>
        <td className="num px-3 py-2 text-right text-slate-700">{fmtAvails(sumOpen(games, (g) => g.postgame))}</td>
        <td className="num px-3 py-2 text-right text-slate-700">{fmtCurrencyUnit(avgRate(games, (g) => g.postgame))}</td>
      </tr>
    </>
  );
}

function RateOpenCell({ cell }: { cell: CellFig | null }) {
  if (!cell) return <td className="px-3 py-2 text-right text-xs italic text-slate-300">—</td>;
  return (
    <td className={clsx("num px-3 py-2 text-right", openHeat(cell.avail))}>
      {fmtAvails(cell.avail)}
    </td>
  );
}

function RateRateCell({ cell }: { cell: CellFig | null }) {
  if (!cell) return <td className="px-3 py-2 text-right text-xs italic text-slate-300">—</td>;
  const isShifted = cell.tier === "FL" || cell.tier === "Bump";
  return (
    <td className={clsx("num px-3 py-2 text-right text-slate-700", isShifted && "font-semibold text-slate-900")}>
      {fmtCurrencyUnit(cell.rateCents)}
      {isShifted && (
        <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-700">{cell.tier}</span>
      )}
    </td>
  );
}
