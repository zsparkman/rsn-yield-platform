import { writeJson } from "./_shared";
import type {
  InventoryCapacity,
  InventoryType,
  SeasonPhase,
  Format,
} from "../../src/lib/types";

// Synthetic absolutes from docs/spec/01-data-model.md.
type Row = {
  phase: SeasonPhase;
  inv: InventoryType;
  std: number;
  exp: number;
};

const TABLE: Row[] = [
  { phase: "PR", inv: "Pregame", std: 21, exp: 21 },
  { phase: "PR", inv: "In Game", std: 43.5, exp: 52.5 },
  { phase: "PR", inv: "In Game+", std: 47.5, exp: 56.5 },
  { phase: "PR", inv: "In Game-", std: 39.5, exp: 48.5 },
  { phase: "PR", inv: "Postgame", std: 17, exp: 17 },
  { phase: "PR", inv: "Floaters A&B", std: 6, exp: 6 },
  { phase: "REG", inv: "Pregame", std: 21, exp: 21 },
  { phase: "REG", inv: "In Game", std: 51, exp: 58 },
  { phase: "REG", inv: "In Game+", std: 55, exp: 62 },
  { phase: "REG", inv: "In Game-", std: 47, exp: 54 },
  { phase: "REG", inv: "Postgame", std: 17, exp: 17 },
  { phase: "REG", inv: "Floaters A&B", std: 6, exp: 6 },
];

export function buildInventoryCapacity(): InventoryCapacity[] {
  const rows: InventoryCapacity[] = [];
  for (const row of TABLE) {
    for (const fmt of ["Standard", "Expanded"] as Format[]) {
      rows.push({
        season_phase: row.phase,
        inv_type: row.inv,
        format: fmt,
        avails: fmt === "Expanded" ? row.exp : row.std,
      });
    }
  }
  return rows;
}

export function run(): void {
  const rows = buildInventoryCapacity();
  writeJson("inventory_capacity.json", rows);
  console.log(`inventory_capacity.json: ${rows.length} rows`);
}

if (require.main === module) run();
