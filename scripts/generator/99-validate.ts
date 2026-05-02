import * as fs from "node:fs";
import * as path from "node:path";
import { DATA_DIR, readJson } from "./_shared";
import type {
  Client,
  DayOfWeek,
  Game,
  GameInventoryCell,
  GameRollup,
  InGameVariant,
  InventoryType,
  Spot,
} from "../../src/lib/types";

interface MetricResult {
  name: string;
  value: string;
  target: string;
  passed: boolean;
  detail?: string;
}

const fmt = (n: number, digits = 2) => n.toFixed(digits);

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function checkInRange(
  name: string,
  value: number,
  lo: number,
  hi: number,
  format: (n: number) => string = fmt,
): MetricResult {
  const passed = value >= lo && value <= hi;
  return {
    name,
    value: format(value),
    target: `[${format(lo)}, ${format(hi)}]`,
    passed,
  };
}

function checkClose(
  name: string,
  value: number,
  target: number,
  tolerance: number,
  format: (n: number) => string = fmt,
): MetricResult {
  const passed = Math.abs(value - target) <= tolerance;
  return {
    name,
    value: format(value),
    target: `${format(target)} ± ${format(tolerance)}`,
    passed,
  };
}

function checkExact(
  name: string,
  value: number,
  target: number,
): MetricResult {
  return {
    name,
    value: String(value),
    target: String(target),
    passed: value === target,
  };
}

export function runValidation(): { results: MetricResult[]; allPassed: boolean } {
  const games = readJson<Game[]>("games.json");
  const rollups = readJson<GameRollup[]>("game_rollup.json");
  const cells = readJson<GameInventoryCell[]>("game_inventory.json");
  const spots = readJson<Spot[]>("spots.json");
  const clients = readJson<Client[]>("clients.json");

  const results: MetricResult[] = [];

  // Total games
  results.push(checkExact("Total games", games.length, 170));
  const prCount = games.filter((g) => g.season_phase === "PR").length;
  const regCount = games.filter((g) => g.season_phase === "REG").length;
  results.push(checkExact("PR games", prCount, 25));
  results.push(checkExact("REG games", regCount, 145));

  // Day-of-week distribution (REG)
  const regGames = games.filter((g) => g.season_phase === "REG");
  const dowTargets: Array<{ day: DayOfWeek; target: number }> = [
    { day: "Sat", target: 0.169 },
    { day: "Fri", target: 0.164 },
    { day: "Tue", target: 0.161 },
    { day: "Sun", target: 0.159 },
    { day: "Wed", target: 0.153 },
    { day: "Mon", target: 0.101 },
    { day: "Thu", target: 0.094 },
  ];
  for (const t of dowTargets) {
    const share =
      regGames.filter((g) => g.day_of_week === t.day).length / regGames.length;
    results.push(checkClose(`DoW share (${t.day})`, share, t.target, 0.02, pct));
  }

  // In Game variant split
  const variantTargets: Array<{ v: InGameVariant; target: number }> = [
    { v: "In Game", target: 0.79 },
    { v: "In Game-", target: 0.11 },
    { v: "In Game+", target: 0.10 },
  ];
  for (const t of variantTargets) {
    const share =
      games.filter((g) => g.in_game_variant === t.v).length / games.length;
    results.push(
      checkClose(`InGame variant (${t.v})`, share, t.target, 0.03, pct),
    );
  }

  // Simulcast share REG
  const simulcastShare =
    regGames.filter((g) => g.simulcast === "Simulcast").length / regGames.length;
  results.push(checkClose("Simulcast share (REG)", simulcastShare, 0.05, 0.02, pct));

  // Regional matchup share REG
  const regionalShare =
    regGames.filter((g) => g.matchup_tier === "Regional").length /
    regGames.length;
  results.push(
    checkClose("Regional share (REG)", regionalShare, 0.39, 0.03, pct),
  );

  // Sold ≤/over Primary cap (per In Game cell). The spec target measures
  // demand-model output (paid_eq30 vs cap), not the inflated sold_eq30 that
  // bundles in NC / ADU / Bonus volume — those non-paid groups are calibrated
  // independently against the "Paid spot share: 78%" target.
  const inGameRollups = rollups.filter(
    (r) =>
      r.inv_type === "In Game" ||
      r.inv_type === "In Game+" ||
      r.inv_type === "In Game-",
  );
  const total = inGameRollups.length;
  const underCap = inGameRollups.filter((r) => r.paid_eq30 <= r.cap).length;
  const within20 = inGameRollups.filter(
    (r) => r.paid_eq30 > r.cap && r.paid_eq30 <= 1.2 * r.cap,
  ).length;
  const over20 = inGameRollups.filter((r) => r.paid_eq30 > 1.2 * r.cap).length;
  results.push(
    checkClose("% In Game cells sold ≤ cap", underCap / total, 0.30, 0.05, pct),
  );
  results.push(
    checkClose(
      "% In Game cells sold 0–20% over",
      within20 / total,
      0.50,
      0.05,
      pct,
    ),
  );
  results.push(
    checkClose("% In Game cells sold >20% over", over20 / total, 0.20, 0.05, pct),
  );

  // Floater firings per season + % games firing 0.
  // A "firing" = the floater rotation triggered for that game, which in our
  // ledger means there is at least one Floaters A&B spot of any priority
  // (the first fire books at $0 / priority='bonus' per the spec's
  // "term break is free" rule; subsequent fires book paid).
  const floaterSpotsByGame = new Map<string, number>();
  for (const s of spots) {
    if (s.inv_type === "Floaters A&B") {
      floaterSpotsByGame.set(
        s.game_id,
        (floaterSpotsByGame.get(s.game_id) ?? 0) + 1,
      );
    }
  }
  // "Per season" = REG; PR is exhibition and not the spec's calibration target.
  let firingGames = 0;
  for (const g of regGames) {
    if ((floaterSpotsByGame.get(g.game_id) ?? 0) > 0) firingGames += 1;
  }
  const zeroFloaterPct = 1 - firingGames / regGames.length;
  results.push(checkClose("Floater firings (games)", firingGames, 138, 15));
  results.push(
    checkClose("% games firing 0 floaters", zeroFloaterPct, 0.08, 0.03, pct),
  );

  // Mean EUR REG In Game (Standard / Regional)
  const eurStandard = inGameRollups.filter(
    (r) => r.eur_cents > 0,
  );
  const standardEUR = mean(
    eurStandard
      .filter((r) => {
        const game = games.find((g) => g.game_id === r.game_id);
        return game?.season_phase === "REG" && game?.matchup_tier === "Standard";
      })
      .map((r) => r.eur_cents / 100),
  );
  const regionalEUR = mean(
    eurStandard
      .filter((r) => {
        const game = games.find((g) => g.game_id === r.game_id);
        return game?.season_phase === "REG" && game?.matchup_tier === "Regional";
      })
      .map((r) => r.eur_cents / 100),
  );
  results.push(checkInRange("EUR REG In Game Standard", standardEUR, 7500, 9500));
  results.push(
    checkInRange("EUR REG In Game Regional", regionalEUR, 11000, 14000),
  );

  // AUR vs EUR delta in Postgame: AUR 3–8% below EUR
  const postRollups = rollups.filter(
    (r) => r.inv_type === "Postgame" && r.eur_cents > 0 && r.aur_cents > 0,
  );
  const postDeltas = postRollups.map(
    (r) => (r.eur_cents - r.aur_cents) / r.eur_cents,
  );
  const meanPostDelta = mean(postDeltas);
  results.push(
    checkInRange("AUR vs EUR delta (Postgame)", meanPostDelta, 0.03, 0.08, pct),
  );

  // Top 5 / Top 50 client EQ30 share
  const eq30ByClient = new Map<string, number>();
  for (const s of spots) {
    if (s.priority_code !== "paid") continue;
    eq30ByClient.set(
      s.client_id,
      (eq30ByClient.get(s.client_id) ?? 0) + s.spot_length_eq30,
    );
  }
  const totalPaidEq30 = Array.from(eq30ByClient.values()).reduce((a, b) => a + b, 0);
  const sortedShares = Array.from(eq30ByClient.values()).sort((a, b) => b - a);
  const top5 = sortedShares.slice(0, 5).reduce((a, b) => a + b, 0) / totalPaidEq30;
  const top50 =
    sortedShares.slice(0, 50).reduce((a, b) => a + b, 0) / totalPaidEq30;
  results.push(checkInRange("Top 5 client EQ30 share", top5, 0.25, 0.35, pct));
  results.push(checkInRange("Top 50 client EQ30 share", top50, 0.75, 0.88, pct));

  // % spots with priority=paid
  const paidShare =
    spots.filter((s) => s.priority_code === "paid").length / spots.length;
  results.push(
    checkClose("Paid spot share", paidShare, 0.78, 0.04, pct),
  );

  void cells;
  void clients;

  const allPassed = results.every((r) => r.passed);
  return { results, allPassed };
}

function printReport(results: MetricResult[]): void {
  const longest = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const tag = r.passed ? "PASS" : "FAIL";
    const padded = r.name.padEnd(longest);
    console.log(
      `[${tag}] ${padded}  value=${r.value}  target=${r.target}`,
    );
  }
}

export function writeReport(results: MetricResult[]): void {
  const report = {
    generated_at: new Date().toISOString(),
    metrics: results.map((r) => ({
      name: r.name,
      value: r.value,
      target: r.target,
      passed: r.passed,
    })),
  };
  fs.writeFileSync(
    path.join(DATA_DIR, "_validation_report.json"),
    JSON.stringify(report, null, 2),
  );
}

export function run(): boolean {
  const { results, allPassed } = runValidation();
  printReport(results);
  writeReport(results);
  if (!allPassed) {
    const failed = results.filter((r) => !r.passed).map((r) => r.name);
    console.error(`\nValidation FAILED for: ${failed.join(", ")}`);
    return false;
  }
  console.log(`\nValidation PASSED for all ${results.length} metrics.`);
  return true;
}

if (require.main === module) {
  const ok = run();
  process.exit(ok ? 0 : 1);
}
