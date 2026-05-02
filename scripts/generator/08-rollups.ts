import { readJson, writeJson } from "./_shared";
import type {
  AURSummaryRow,
  Client,
  Game,
  GameInventoryCell,
  GameRollup,
  InventoryType,
  RateCardEntry,
  RateTier,
  Spot,
} from "../../src/lib/types";

function rateTierForOversell(
  invType: InventoryType,
  oversellEq30: number,
): RateTier {
  // Same business-correct interpretation as in 07-spots.ts.
  const isInGameish =
    invType === "In Game" || invType === "In Game+" || invType === "In Game-";
  if (isInGameish) {
    if (oversellEq30 <= 0) return "Base";
    if (oversellEq30 <= 6) return "FL";
    return "Bump";
  }
  if (invType === "Floaters A&B") return "FL";
  if (oversellEq30 <= 0) return "Base";
  return "Bump";
}

function buildRateLookup(rates: RateCardEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rates) {
    m.set(
      `${r.season_phase}|${r.inv_type}|${r.matchup_tier}|${r.rate_tier}`,
      r.rate_cents,
    );
  }
  return m;
}

function lookupRate(
  rates: Map<string, number>,
  game: Game,
  invType: InventoryType,
  tier: RateTier,
): number {
  let priceInv: "Pregame" | "In Game" | "Postgame" = "In Game";
  if (invType === "Pregame") priceInv = "Pregame";
  else if (invType === "Postgame") priceInv = "Postgame";
  let lookupTier: RateTier = tier;
  if (priceInv !== "In Game" && lookupTier === "FL") lookupTier = "Bump";
  return (
    rates.get(
      `${game.season_phase}|${priceInv}|${game.matchup_tier}|${lookupTier}`,
    ) ?? 0
  );
}

function emptyRollup(cell: GameInventoryCell): GameRollup {
  return {
    game_id: cell.game_id,
    inv_type: cell.inv_type,
    cap: cell.cap,
    sold_eq30: 0,
    paid_eq30: 0,
    nc_eq30: 0,
    adu_eq30: 0,
    xadu_eq30: 0,
    bonus_eq30: 0,
    oversell_eq30: 0 - cell.cap,
    rate_tier_resolved: "Base",
    current_rate_cents: 0,
    gross_rev_cents: 0,
    net_rev_cents: 0,
    eur_cents: 0,
    aur_cents: 0,
    paid_unit_count: 0,
    sellout_pct: 0,
    sellout_pct_with_adu: 0,
  };
}

export function buildRollups(): { rollups: GameRollup[]; aur: AURSummaryRow[] } {
  const games = readJson<Game[]>("games.json");
  const cells = readJson<GameInventoryCell[]>("game_inventory.json");
  const spots = readJson<Spot[]>("spots.json");
  const rates = readJson<RateCardEntry[]>("rate_card.json");
  const clients = readJson<Client[]>("clients.json");
  const rateLookup = buildRateLookup(rates);

  const gameById = new Map(games.map((g) => [g.game_id, g]));
  const clientById = new Map(clients.map((c) => [c.client_id, c]));

  // Initialize rollup buckets keyed by game+inv.
  const rollups = new Map<string, GameRollup>();
  for (const c of cells) {
    rollups.set(`${c.game_id}|${c.inv_type}`, emptyRollup(c));
  }

  for (const s of spots) {
    const key = `${s.game_id}|${s.inv_type}`;
    const r = rollups.get(key);
    if (!r) continue;
    r.sold_eq30 += s.spot_length_eq30;
    if (s.priority_code === "paid") {
      r.paid_eq30 += s.spot_length_eq30;
      r.paid_unit_count += 1;
      r.gross_rev_cents += s.spot_rate_gross_cents;
      r.net_rev_cents += s.spot_rate_net_cents;
    } else if (s.priority_code === "nc") r.nc_eq30 += s.spot_length_eq30;
    else if (s.priority_code === "adu") r.adu_eq30 += s.spot_length_eq30;
    else if (s.priority_code === "xadu") r.xadu_eq30 += s.spot_length_eq30;
    else if (s.priority_code === "bonus") r.bonus_eq30 += s.spot_length_eq30;
  }

  // Resolve derived fields.
  const rollupArray: GameRollup[] = [];
  for (const r of rollups.values()) {
    const game = gameById.get(r.game_id);
    if (!game) continue;
    r.oversell_eq30 = Math.round((r.sold_eq30 - r.cap) * 10) / 10;
    r.rate_tier_resolved = rateTierForOversell(
      r.inv_type as InventoryType,
      r.oversell_eq30,
    );
    r.current_rate_cents = lookupRate(
      rateLookup,
      game,
      r.inv_type as InventoryType,
      r.rate_tier_resolved,
    );
    r.eur_cents =
      r.paid_eq30 > 0 ? Math.round(r.net_rev_cents / r.paid_eq30) : 0;
    r.aur_cents =
      r.paid_unit_count > 0
        ? Math.round(r.net_rev_cents / r.paid_unit_count)
        : 0;
    const denom = r.cap > 0 ? r.cap : 1;
    r.sellout_pct = Math.round(((r.paid_eq30 + r.nc_eq30) / denom) * 1000) / 1000;
    r.sellout_pct_with_adu =
      Math.round(
        ((r.paid_eq30 + r.nc_eq30 + r.adu_eq30 + r.xadu_eq30) / denom) * 1000,
      ) / 1000;
    // Round numeric fields for storage.
    r.sold_eq30 = Math.round(r.sold_eq30 * 10) / 10;
    r.paid_eq30 = Math.round(r.paid_eq30 * 10) / 10;
    r.nc_eq30 = Math.round(r.nc_eq30 * 10) / 10;
    r.adu_eq30 = Math.round(r.adu_eq30 * 10) / 10;
    r.xadu_eq30 = Math.round(r.xadu_eq30 * 10) / 10;
    r.bonus_eq30 = Math.round(r.bonus_eq30 * 10) / 10;
    rollupArray.push(r);
  }

  // Build AUR summary: per (date, season_phase, inv_type), split by LOB.
  type AURKey = string;
  const aurMap = new Map<AURKey, AURSummaryRow>();
  for (const s of spots) {
    const game = gameById.get(s.game_id);
    if (!game) continue;
    const client = clientById.get(s.client_id);
    if (!client) continue;
    const key = `${game.air_date}|${game.season_phase}|${s.inv_type}`;
    let row = aurMap.get(key);
    if (!row) {
      row = {
        date: game.air_date,
        season_phase: game.season_phase,
        inv_type: s.inv_type,
        direct_paid_eq30: 0,
        direct_nc_eq30: 0,
        direct_adu_eq30: 0,
        direct_xadu_eq30: 0,
        direct_bonus_eq30: 0,
        direct_paid_gross_cents: 0,
        direct_paid_net_cents: 0,
        repped_paid_eq30: 0,
        repped_nc_eq30: 0,
        repped_adu_eq30: 0,
        repped_xadu_eq30: 0,
        repped_bonus_eq30: 0,
        repped_paid_gross_cents: 0,
        repped_paid_net_cents: 0,
        total_paid_eq30: 0,
        total_paid_unit_count: 0,
        total_paid_net_cents: 0,
        cap: 0,
        eur_cents: 0,
        aur_cents: 0,
        sellout_pct: 0,
        sellout_pct_with_adu: 0,
      };
      aurMap.set(key, row);
    }
    const isDirect = client.lob === "Direct";
    if (s.priority_code === "paid") {
      if (isDirect) {
        row.direct_paid_eq30 += s.spot_length_eq30;
        row.direct_paid_gross_cents += s.spot_rate_gross_cents;
        row.direct_paid_net_cents += s.spot_rate_net_cents;
      } else {
        row.repped_paid_eq30 += s.spot_length_eq30;
        row.repped_paid_gross_cents += s.spot_rate_gross_cents;
        row.repped_paid_net_cents += s.spot_rate_net_cents;
      }
      row.total_paid_eq30 += s.spot_length_eq30;
      row.total_paid_unit_count += 1;
      row.total_paid_net_cents += s.spot_rate_net_cents;
    } else if (s.priority_code === "nc") {
      if (isDirect) row.direct_nc_eq30 += s.spot_length_eq30;
      else row.repped_nc_eq30 += s.spot_length_eq30;
    } else if (s.priority_code === "adu") {
      if (isDirect) row.direct_adu_eq30 += s.spot_length_eq30;
      else row.repped_adu_eq30 += s.spot_length_eq30;
    } else if (s.priority_code === "xadu") {
      if (isDirect) row.direct_xadu_eq30 += s.spot_length_eq30;
      else row.repped_xadu_eq30 += s.spot_length_eq30;
    } else if (s.priority_code === "bonus") {
      if (isDirect) row.direct_bonus_eq30 += s.spot_length_eq30;
      else row.repped_bonus_eq30 += s.spot_length_eq30;
    }
  }
  // Backfill cap and ratios.
  const capByKey = new Map<string, number>();
  for (const c of cells) {
    capByKey.set(
      `${c.game.air_date}|${c.game.season_phase}|${c.inv_type}`,
      c.cap,
    );
  }
  const aurArray: AURSummaryRow[] = [];
  for (const row of aurMap.values()) {
    const cap = capByKey.get(`${row.date}|${row.season_phase}|${row.inv_type}`) ?? 0;
    row.cap = cap;
    const denom = cap > 0 ? cap : 1;
    const ncTotal = row.direct_nc_eq30 + row.repped_nc_eq30;
    const aduTotal =
      row.direct_adu_eq30 +
      row.repped_adu_eq30 +
      row.direct_xadu_eq30 +
      row.repped_xadu_eq30;
    row.eur_cents =
      row.total_paid_eq30 > 0
        ? Math.round(row.total_paid_net_cents / row.total_paid_eq30)
        : 0;
    row.aur_cents =
      row.total_paid_unit_count > 0
        ? Math.round(row.total_paid_net_cents / row.total_paid_unit_count)
        : 0;
    row.sellout_pct =
      Math.round(((row.total_paid_eq30 + ncTotal) / denom) * 1000) / 1000;
    row.sellout_pct_with_adu =
      Math.round(((row.total_paid_eq30 + ncTotal + aduTotal) / denom) * 1000) /
      1000;

    // Round storage values.
    const r2 = (n: number) => Math.round(n * 10) / 10;
    row.direct_paid_eq30 = r2(row.direct_paid_eq30);
    row.direct_nc_eq30 = r2(row.direct_nc_eq30);
    row.direct_adu_eq30 = r2(row.direct_adu_eq30);
    row.direct_xadu_eq30 = r2(row.direct_xadu_eq30);
    row.direct_bonus_eq30 = r2(row.direct_bonus_eq30);
    row.repped_paid_eq30 = r2(row.repped_paid_eq30);
    row.repped_nc_eq30 = r2(row.repped_nc_eq30);
    row.repped_adu_eq30 = r2(row.repped_adu_eq30);
    row.repped_xadu_eq30 = r2(row.repped_xadu_eq30);
    row.repped_bonus_eq30 = r2(row.repped_bonus_eq30);
    row.total_paid_eq30 = r2(row.total_paid_eq30);
    aurArray.push(row);
  }
  // Stable order: by date then phase then inv.
  aurArray.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.season_phase !== b.season_phase)
      return a.season_phase < b.season_phase ? -1 : 1;
    return a.inv_type < b.inv_type ? -1 : 1;
  });

  return { rollups: rollupArray, aur: aurArray };
}

export function run(): void {
  const { rollups, aur } = buildRollups();
  writeJson("game_rollup.json", rollups);
  writeJson("aur_summary.json", aur);
  console.log(`game_rollup.json: ${rollups.length} rows`);
  console.log(`aur_summary.json: ${aur.length} rows`);
}

if (require.main === module) run();
