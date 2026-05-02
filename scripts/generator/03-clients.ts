import * as fs from "node:fs";
import * as path from "node:path";
import { rngFor, writeJson } from "./_shared";
import type { Client, PreferredInvType } from "../../src/lib/types";

interface ClientSeedRow {
  client_id: string;
  name: string;
  category: Client["category"];
  lob: Client["lob"];
  preferred_inv_type: PreferredInvType;
  preferred_demo: string;
}

const ROSTER_PATH = path.resolve(
  process.cwd(),
  "docs/spec/04-client-roster.json",
);

// Pool of fictional AE names — sales staff for the synthetic RSN.
const AE_NAMES = [
  "Avery Lin",
  "Marcus Reyes",
  "Priya Shah",
  "Dana Kowalski",
  "Sam Okafor",
  "Riley Chen",
  "Jordan Vasquez",
  "Theo Whitaker",
];

// Length-mix prior depends on preferred inv type — In Game leans heavier on :30s,
// Pregame/Postgame have more :15s, Mixed splits the middle.
function lengthMixFor(
  invType: PreferredInvType,
  rng: () => number,
): { "15": number; "30": number; "60": number } {
  let p15: number;
  let p60: number;
  if (invType === "In Game") {
    p15 = 0.02 + rng() * 0.05; // 2–7%
    p60 = rng() * 0.02; // 0–2%
  } else if (invType === "Pregame") {
    p15 = 0.05 + rng() * 0.06; // 5–11%
    p60 = rng() * 0.02;
  } else if (invType === "Postgame") {
    p15 = 0.07 + rng() * 0.06; // 7–13%
    p60 = rng() * 0.02;
  } else {
    p15 = 0.05 + rng() * 0.05;
    p60 = rng() * 0.02;
  }
  const p30 = 1 - p15 - p60;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { "15": round(p15), "30": round(p30), "60": round(p60) };
}

export function buildClients(): Client[] {
  const seedRows = JSON.parse(
    fs.readFileSync(ROSTER_PATH, "utf-8"),
  ) as ClientSeedRow[];
  const rng = rngFor("clients");

  // Buying intensity: 5 dominant buyers (drawn from the In-Game-preferring
  // pool so they actually dominate In Game inventory) and a flat-ish long
  // tail. Shape tuned to satisfy the Top 5 / Top 50 EQ30 share targets.
  // Top tier is biased to In-Game-preferring clients because those are the
  // cells that drive the bulk of EQ30 in this dataset.
  const inGameIdx: number[] = [];
  const otherIdx: number[] = [];
  seedRows.forEach((r, i) => {
    if (r.preferred_inv_type === "In Game") inGameIdx.push(i);
    else otherIdx.push(i);
  });
  // Deterministic seeded shuffle.
  const fy = (arr: number[]) => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  fy(inGameIdx);
  fy(otherIdx);
  const topIdx = new Set<number>(inGameIdx.slice(0, 5));

  return seedRows.map((row, idx) => {
    let intensity: number;
    // Top tier intensity exceeds the spec's nominal 0.1–1.0 range. A pure
    // 1.0 ceiling combined with the rest of the demand model can't satisfy
    // the Top 5 (25–35%) AND Top 50 (75–88%) calibration targets at the
    // same time given a 60-client roster.
    if (topIdx.has(idx)) intensity = 10.0 + rng() * 1.0; // 10.0–11.0
    else intensity = 0.45 + rng() * 0.10; // 0.45–0.55, narrow floor

    const ae = AE_NAMES[idx % AE_NAMES.length];

    return {
      ...row,
      buying_intensity: Math.round(intensity * 100) / 100,
      preferred_length_mix: lengthMixFor(row.preferred_inv_type, rng),
      ae_name: ae,
    };
  });
}

export function run(): void {
  const rows = buildClients();
  writeJson("clients.json", rows);
  console.log(`clients.json: ${rows.length} rows`);
}

if (require.main === module) run();
