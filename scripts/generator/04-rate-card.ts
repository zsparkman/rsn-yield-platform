import { writeJson } from "./_shared";
import type {
  RateCardEntry,
  RateInventoryType,
  RateTier,
  SeasonPhase,
  MatchupTier,
} from "../../src/lib/types";

// Synthetic rates from docs/spec/01-data-model.md. Stored in cents.
// FL tier exists only for In Game.
type Row = {
  phase: SeasonPhase;
  inv: RateInventoryType;
  tier: RateTier;
  std: number;
  reg: number; // Regional rate
};

const TABLE: Row[] = [
  { phase: "PR", inv: "Pregame", tier: "Base", std: 400_00, reg: 400_00 },
  { phase: "PR", inv: "Pregame", tier: "Bump", std: 800_00, reg: 800_00 },
  { phase: "PR", inv: "In Game", tier: "Base", std: 1_650_00, reg: 1_650_00 },
  { phase: "PR", inv: "In Game", tier: "FL", std: 1_950_00, reg: 1_950_00 },
  { phase: "PR", inv: "In Game", tier: "Bump", std: 3_300_00, reg: 3_300_00 },
  { phase: "PR", inv: "Postgame", tier: "Base", std: 175_00, reg: 175_00 },
  { phase: "PR", inv: "Postgame", tier: "Bump", std: 350_00, reg: 350_00 },
  { phase: "REG", inv: "Pregame", tier: "Base", std: 1_375_00, reg: 1_375_00 },
  { phase: "REG", inv: "Pregame", tier: "Bump", std: 2_750_00, reg: 2_750_00 },
  { phase: "REG", inv: "In Game", tier: "Base", std: 11_500_00, reg: 17_250_00 },
  { phase: "REG", inv: "In Game", tier: "FL", std: 13_800_00, reg: 20_700_00 },
  { phase: "REG", inv: "In Game", tier: "Bump", std: 23_000_00, reg: 34_500_00 },
  { phase: "REG", inv: "Postgame", tier: "Base", std: 3_650_00, reg: 3_650_00 },
  { phase: "REG", inv: "Postgame", tier: "Bump", std: 7_300_00, reg: 7_300_00 },
];

export function buildRateCard(): RateCardEntry[] {
  const rows: RateCardEntry[] = [];
  for (const row of TABLE) {
    for (const tier of ["Standard", "Regional"] as MatchupTier[]) {
      rows.push({
        season_phase: row.phase,
        inv_type: row.inv,
        matchup_tier: tier,
        rate_tier: row.tier,
        rate_cents: tier === "Regional" ? row.reg : row.std,
      });
    }
  }
  return rows;
}

export function run(): void {
  const rows = buildRateCard();
  writeJson("rate_card.json", rows);
  console.log(`rate_card.json: ${rows.length} rows`);
}

if (require.main === module) run();
