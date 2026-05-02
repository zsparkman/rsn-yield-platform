// Distributional validation against ETL outputs. Mirrors the 26-target
// table from docs/spec/03-synthetic-data-spec.md §5, but reads the
// already-aggregated ETL output (deriveSchedule, deriveInventory,
// deriveSpots) rather than the pre-aggregated JSON files of the
// pre-migration architecture.
//
// Two targets from the prior generator (Floater firings (games) and
// % games firing 0 floaters) are intentionally dropped — they were
// measuring an explicit "Floaters A&B" inv-type spot count that doesn't
// exist in the M model. The M's floater concept derives from In Game
// oversell instead, which is covered by the % In Game cells sold > cap
// targets.

import type {
  EnrichedScheduleRow,
  EnrichedSpot,
  InventoryRollupRow,
} from "./types";

export interface DistMetric {
  name: string;
  value: string;
  target: string;
  passed: boolean;
}

const fmtN = (n: number, d = 2) => n.toFixed(d);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function inRange(name: string, v: number, lo: number, hi: number, fmt = fmtN): DistMetric {
  return { name, value: fmt(v), target: `[${fmt(lo)}, ${fmt(hi)}]`, passed: v >= lo && v <= hi };
}

function close(name: string, v: number, target: number, tol: number, fmt = fmtN): DistMetric {
  return { name, value: fmt(v), target: `${fmt(target)} ± ${fmt(tol)}`, passed: Math.abs(v - target) <= tol };
}

function exact(name: string, v: number, target: number): DistMetric {
  return { name, value: String(v), target: String(target), passed: v === target };
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sumOver<T>(xs: T[], f: (x: T) => number): number {
  return xs.reduce((s, x) => s + f(x), 0);
}

export function runDistributional(
  schedule: EnrichedScheduleRow[],
  spots: EnrichedSpot[],
  inventoryExc0: InventoryRollupRow[],
): DistMetric[] {
  const results: DistMetric[] = [];

  // schedule: 3 rows per game (Pregame / In Game / Postgame); one game = unique (DATE, EVENT_PROGRAM)
  const games = new Map<string, EnrichedScheduleRow>();
  for (const s of schedule) {
    const k = `${s.DATE}|${s.EVENT_PROGRAM}`;
    if (!games.has(k)) games.set(k, s);
  }
  const allGames = [...games.values()];
  const regGames = allGames.filter((g) => g.TYPE2 === "REG");
  const prGames = allGames.filter((g) => g.TYPE2 === "PR");

  results.push(exact("Total games", allGames.length, 170));
  results.push(exact("PR games", prGames.length, 25));
  results.push(exact("REG games", regGames.length, 145));

  // DoW REG distribution
  const DOW_TARGETS: Array<{ day: string; target: number }> = [
    { day: "Saturday", target: 0.169 },
    { day: "Friday", target: 0.164 },
    { day: "Tuesday", target: 0.161 },
    { day: "Sunday", target: 0.159 },
    { day: "Wednesday", target: 0.153 },
    { day: "Monday", target: 0.101 },
    { day: "Thursday", target: 0.094 },
  ];
  for (const t of DOW_TARGETS) {
    const share = regGames.filter((g) => g.DAY === t.day).length / regGames.length;
    results.push(close(`DoW share (${t.day.slice(0, 3)})`, share, t.target, 0.02, pct));
  }

  // In Game variant split (across all 170 games)
  // Variant lives on the In Game schedule row's INV TYPE.1 field.
  const inGameRows = schedule.filter((r) => r["INV TYPE"] === "In Game");
  const variantTargets = [
    { v: "In Game", target: 0.79 },
    { v: "In Game-", target: 0.11 },
    { v: "In Game+", target: 0.10 },
  ];
  for (const t of variantTargets) {
    const share = inGameRows.filter((r) => r["INV TYPE.1"] === t.v).length / inGameRows.length;
    results.push(close(`InGame variant (${t.v})`, share, t.target, 0.03, pct));
  }

  // Simulcast share (REG)
  const regSimulcast = regGames.filter((g) => g.Simulcast === "Simulcast").length / regGames.length;
  results.push(close("Simulcast share (REG)", regSimulcast, 0.05, 0.02, pct));

  // Regional share (REG)
  const regRegional = regGames.filter((g) => g.Matchup === "Regional").length / regGames.length;
  results.push(close("Regional share (REG)", regRegional, 0.39, 0.03, pct));

  // % In Game cells sold ≤ cap / 0-20% over / >20% over (paid_eq30 vs cap)
  // Use inventoryExc0 which has $0-rate spots filtered out (so Sold == paid eq30).
  const inGameInv = inventoryExc0.filter((r) =>
    r["INV TYPE"] === "In Game" || r["INV TYPE"] === "In Game+" || r["INV TYPE"] === "In Game-"
  );
  const total = inGameInv.length;
  const underCap = inGameInv.filter((r) => r.Sold <= r.Cap).length;
  const within20 = inGameInv.filter((r) => r.Sold > r.Cap && r.Sold <= 1.2 * r.Cap).length;
  const over20 = inGameInv.filter((r) => r.Sold > 1.2 * r.Cap).length;
  results.push(close("% In Game cells sold ≤ cap", underCap / total, 0.30, 0.05, pct));
  results.push(close("% In Game cells sold 0-20% over", within20 / total, 0.50, 0.05, pct));
  results.push(close("% In Game cells sold > 20% over", over20 / total, 0.20, 0.05, pct));

  // Mean EUR REG In Game Standard / Regional. Spec definition:
  // EUR = sum(net_rev) / sum(paid_eq30) — volume-weighted, NOT the per-row
  // mean stored on InventoryRollupRow.EUR (which is mean of per-spot
  // EffectiveUnitRate per the M chain — kept for ETL fidelity).
  // Group spots by airDate × inv_type and use the schedule rows to
  // attribute matchup tier (synthetic spots don't carry opponent in their path).
  const matchupByDateAndInv = new Map<string, "Regional" | "Standard">();
  const phaseByDate = new Map<string, "PR" | "REG">();
  for (const sched of schedule) {
    const k = `${sched.DATE}|${sched["INV TYPE"]}`;
    matchupByDateAndInv.set(k, sched.Matchup);
    phaseByDate.set(sched.DATE, sched.TYPE2);
  }
  const paidSpots = spots.filter((s) => s.SpotRate > 0);
  const regInGameStandardSpots = paidSpots.filter((s) => {
    if (phaseByDate.get(s.air_date_iso) !== "REG") return false;
    if (s.inventory_type !== "In Game") return false;
    return matchupByDateAndInv.get(`${s.air_date_iso}|${s.inventory_type}`) === "Standard";
  });
  const regInGameRegionalSpots = paidSpots.filter((s) => {
    if (phaseByDate.get(s.air_date_iso) !== "REG") return false;
    if (s.inventory_type !== "In Game") return false;
    return matchupByDateAndInv.get(`${s.air_date_iso}|${s.inventory_type}`) === "Regional";
  });
  const eurStd = sumOver(regInGameStandardSpots, (s) => s.spot_rate_net) /
    Math.max(1, sumOver(regInGameStandardSpots, (s) => s.TotalEquivSold));
  const eurReg = sumOver(regInGameRegionalSpots, (s) => s.spot_rate_net) /
    Math.max(1, sumOver(regInGameRegionalSpots, (s) => s.TotalEquivSold));
  results.push(inRange("EUR REG In Game Standard", eurStd, 7500, 9500));
  results.push(inRange("EUR REG In Game Regional", eurReg, 11000, 14000));

  // AUR vs EUR delta in Postgame, using the spec definitions:
  // EUR = sum(net) / sum(eq30), AUR = sum(net) / count
  const postSpots = paidSpots.filter((s) => s.inventory_type === "Postgame");
  const postEUR = sumOver(postSpots, (s) => s.spot_rate_net) /
    Math.max(1, sumOver(postSpots, (s) => s.TotalEquivSold));
  const postAUR = sumOver(postSpots, (s) => s.spot_rate_net) / Math.max(1, postSpots.length);
  const postDelta = postEUR > 0 ? (postEUR - postAUR) / postEUR : 0;
  results.push(inRange("AUR vs EUR delta (Postgame)", postDelta, 0.03, 0.08, pct));

  // Top 5 / Top 50 client EQ30 share (paid)
  const eq30ByAdv = new Map<string, number>();
  for (const s of spots) {
    if (s.SpotRate <= 0) continue;
    eq30ByAdv.set(s.AdvertiserName, (eq30ByAdv.get(s.AdvertiserName) ?? 0) + s.TotalEquivSold);
  }
  const sorted = [...eq30ByAdv.values()].sort((a, b) => b - a);
  const totalEq30 = sorted.reduce((a, b) => a + b, 0);
  const top5 = sorted.slice(0, 5).reduce((a, b) => a + b, 0) / totalEq30;
  const top50 = sorted.slice(0, 50).reduce((a, b) => a + b, 0) / totalEq30;
  results.push(inRange("Top 5 client EQ30 share", top5, 0.25, 0.35, pct));
  results.push(inRange("Top 50 client EQ30 share", top50, 0.75, 0.88, pct));

  // Paid spot share
  const paidShare = spots.filter((s) => s.SpotRate > 0).length / spots.length;
  results.push(close("Paid spot share", paidShare, 0.78, 0.04, pct));

  return results;
}
