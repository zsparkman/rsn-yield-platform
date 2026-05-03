// Generates data/spots.csv in the 29-column Wide Orbit SSRS export shape.
//
// One row per booked spot. The ETL (src/lib/etl.ts) is the only consumer of
// these rows — it derives inventory_type, post_code, $0 status, LOB groups,
// and rate tiers downstream. This generator does NOT emit a separate
// "Floaters A&B" inventory type at the spot level; floater capacity is
// inferred from In Game oversell during ETL aggregation, exactly as the
// M chain does.
//
// Calibration targets carry over from the pre-migration generator: paid
// spot share ~78%, EUR / AUR within range, top-5/top-50 client EQ30 share,
// and the In Game sold-vs-cap distribution (30 / 50 / 20).

import * as fs from "node:fs";
import {
  REFERENCE_DIR,
  clip,
  gaussian,
  isoToUSDate,
  pad,
  pickFromMix,
  pickWeighted,
  poisson,
  quarterOf,
  rngFor,
  shuffle,
  timeWithSeconds,
  writeCsv,
} from "./_shared";
import { loadAdvertisers, type Advertiser } from "./_advertisers";
import type {
  DayOfWeek,
  Format,
  InGameWithVariant,
  MatchupTier,
  RateInventoryType,
  RateTier,
  RawScheduleRow,
  RawInventoryCapRow,
  RawRateCardRow,
  RawSpot,
  SeasonPhase,
  SpotLength,
} from "../../src/lib/types";
import * as path from "node:path";
import { OPPONENTS, isRegional } from "./_opponents";

// ------------------------------ small inputs ------------------------------

const REAL_AE_POOL = [
  "Naomi Foster",
  "Marcus Davenport",
  "Aisha Patel",
  "Christopher Yates",
  "Diana Whitaker",
  "Olivia Marsh",
  "James O'Brien",
  "Priya Ramachandran",
  "Robert Vance",
  "Sarah Chen",
  "Tyler Brennan",
  "Daniel Kowalski",
];

// Repped advertisers get an AEFullName starting with "HomeTeamSports" so
// the ETL's HTS classifier (mirrors M `Text.Contains([AEFullName], "HomeTeamSports")`)
// resolves to HTS for them.
function rep_firm_ae(rng: () => number): string {
  return `HomeTeamSports ${REAL_AE_POOL[Math.floor(rng() * REAL_AE_POOL.length)]}`;
}

function direct_ae(rng: () => number): string {
  return REAL_AE_POOL[Math.floor(rng() * REAL_AE_POOL.length)];
}

// ------------------------------ demand model ------------------------------

const BASE_DEMAND = 0.92;
const DEMAND_NOISE_SIGMA = 0.03;

const MATCHUP_MULT: Record<MatchupTier, number> = { Regional: 1.15, Standard: 0.95 };
const DOW_MULT: Record<DayOfWeek, number> = {
  Sat: 1.10, Fri: 1.08, Sun: 1.05,
  Tue: 0.98, Wed: 0.96, Mon: 0.88, Thu: 0.85,
};
const MONTH_MULT: Record<string, number> = {
  February: 0.55, March: 0.65, April: 0.78, May: 0.85,
  June: 0.92, July: 0.97, August: 1.02, September: 1.08, October: 1.05,
};
const FORMAT_MULT: Record<"Standard" | "Expanded" | "DH" | "Expanded DH", number> = {
  Standard: 1.0, Expanded: 1.04, DH: 1.0, "Expanded DH": 1.04,
};

function invTypeMult(invType: RateInventoryType): number {
  if (invType === "Pregame") return 0.85;
  if (invType === "Postgame") return 0.65;
  return 1.0; // In Game
}

function seriesPositionMult(num: number): number {
  if (num <= 1) return 1.0;
  if (num === 2) return 0.97;
  if (num === 3) return 0.95;
  return 0.93;
}

function fillRateForScore(score: number): number {
  if (score <= 0) return 0;
  return Math.max(0, Math.min(1.20, 0.21 + score * 1.12));
}

// ------------------------------ length & rate mix ------------------------------

const LENGTH_MIX: Record<RateInventoryType, Record<"15" | "30" | "60", number>> = {
  "In Game": { "15": 0.04, "30": 0.96, "60": 0 },
  Pregame: { "15": 0.07, "30": 0.92, "60": 0.01 },
  Postgame: { "15": 0.10, "30": 0.89, "60": 0.01 },
};
const LENGTH_TO_EQ30: Record<SpotLength, number> = { 15: 0.5, 30: 1.0, 60: 2.0 };
const LENGTH_RATE_MULT: Record<SpotLength, number> = { 15: 0.55, 30: 1.0, 60: 1.85 };

const SOLD_RATE_DISCOUNT_MEAN = 0.85;
const SOLD_RATE_DISCOUNT_SIGMA = 0.05;

// ------------------------------ priority codes ------------------------------

// ------------------------------ booked-impressions sampler ------------------------------
//
// Means by (demo, inv-type) computed from docs/reference/PPIRSNBookedSpots2026_synthetic.csv,
// paid-only (SpotRate > 0), excluding zero-impression rows. Each generated paid
// spot samples from a Gaussian centred on `mean × 0.85` (15% cut) with
// `σ = mean × 0.18`, clipped at a 1,000-impression floor and rounded.
// The 0.18 σ ratio is intentionally looser than the source data's typical
// 0.05–0.10 σ so the synthetic distribution is clearly not a 1:1 copy.
const IMPRESSIONS_MEAN: Record<string, Record<RateInventoryType, number>> = {
  HH:        { Pregame: 1_162_224, "In Game":   813_120, Postgame:   683_880 },
  "A18-49":  { Pregame:   812_070, "In Game":   776_342, Postgame:   937_158 },
  "A25-54":  { Pregame:   867_341, "In Game":   916_241, Postgame:   739_253 },
  "M25-54":  { Pregame:   690_530, "In Game":   993_866, Postgame:   962_017 },
  "A35+":    { Pregame:   575_291, "In Game":   890_909, Postgame: 1_175_382 },
  "A21-49":  { Pregame:   645_200, "In Game":   645_200, Postgame:   645_200 }, // ref had only In Game; reuse
};

const IMPRESSIONS_DISCOUNT = 0.85;
const IMPRESSIONS_SIGMA_RATIO = 0.18;
const IMPRESSIONS_FLOOR = 1_000;

function sampleBookedImpressions(rng: () => number, demo: string, invType: RateInventoryType): number {
  const row = IMPRESSIONS_MEAN[demo] ?? IMPRESSIONS_MEAN["HH"];
  const mean = row[invType] ?? row["In Game"];
  const center = mean * IMPRESSIONS_DISCOUNT;
  const sigma = mean * IMPRESSIONS_SIGMA_RATIO;
  const sample = gaussian(rng, center, sigma);
  return Math.max(IMPRESSIONS_FLOOR, Math.round(sample));
}

const PAID_PRIORITY = "P-80";
const NC_PRIORITIES: Array<"P-80" | "P-19"> = ["P-80", "P-19"]; // NC zero-rate
const ADU_PRIORITY = "P-09";
const XADU_PRIORITY = "P-08";
const BONUS_PRIORITY = "P-04";

// ------------------------------ paths ------------------------------

function pathFor(phase: SeasonPhase, invType: RateInventoryType): string {
  if (phase === "PR") {
    if (invType === "In Game") return "Sentinels --> ST - SentinelSpringTraining --> ST - Sentinels In Game";
    if (invType === "Pregame") return "Sentinels --> ST - SentinelSpringTraining --> ST - Sentinels Pregame";
    return "Sentinels --> ST - SentinelSpringTraining --> ST - Sentinels Postgame";
  }
  if (invType === "In Game") return "Sentinels --> Sentinels Regular Season --> Sentinel Game plus Floater --> Sentinels In Game";
  if (invType === "Pregame") return "Sentinels --> Sentinels Regular Season --> Sentinels Pregame";
  return "Sentinels --> Sentinels Regular Season --> Sentinels Postgame";
}

function inventoryCodeFor(phase: SeasonPhase, invType: RateInventoryType): string {
  const stem = invType === "In Game" ? "Sentinels In Game"
    : invType === "Pregame" ? "Sentinels Pregame"
    : "Sentinels Postgame";
  return phase === "PR" ? `ST - ${stem}` : stem;
}

// ------------------------------ schedule reader ------------------------------

function parseTime(timeStr: string): { hour: number; minute: number } {
  // "12:10pm" / "5:05pm" / "10:05am"
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return { hour: 19, minute: 10 };
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ap = m[3].toLowerCase();
  if (ap === "pm" && hour !== 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function dowFromUSDate(us: string): DayOfWeek {
  const [m, d, y] = us.split("/").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const map: DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return map[date.getUTCDay()];
}

function monthNameOfUSDate(us: string): string {
  const m = Number(us.split("/")[0]);
  return [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][m - 1];
}

function isoFromUSDate(us: string): string {
  const [m, d, y] = us.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function startMinuteMod30(timeStr: string): number {
  const { minute } = parseTime(timeStr);
  return minute % 30;
}

function inGameVariantFor(timeStr: string): InGameWithVariant {
  const mod = startMinuteMod30(timeStr);
  if (mod < 8) return "In Game-";
  if (mod > 14) return "In Game+";
  return "In Game";
}

function formatTagFor(rawFormat: string): "Standard" | "Expanded" {
  return /Expanded/i.test(rawFormat) ? "Expanded" : "Standard";
}

function opponentFromRaw(opponentLabel: string): typeof OPPONENTS[number] | undefined {
  // "vs. Angels (ss)" or "at Padres" etc.
  const m = opponentLabel.match(/(?:vs\.|at)\s+(.+?)(?:\s*\(.*\))?$/);
  const name = m ? m[1].trim() : opponentLabel.trim();
  return OPPONENTS.find((o) => name === o.name);
}

// ------------------------------ inventory cap reader ------------------------------

interface Cap {
  phase: SeasonPhase;
  inventory: string;
  format: string;
  avails: number;
}

function readInventoryCaps(): Cap[] {
  // Read the synthetic xlsx via openpyxl-style parse — we already vendored
  // the data via openpyxl earlier; here we keep the generator dependency-free
  // by hand-parsing the small xlsx into a Map. For runtime simplicity we use
  // a tiny inline lookup based on the spec's table.
  // (At ETL load time the xlsx is parsed via a real lib; the generator only
  // needs the values for the demand-cap calculation.)
  return INVENTORY_CAPS;
}

// Mirror of docs/reference/Inventory_Table_synthetic.xlsx (Sentinels rows).
// In Game capacities include the previously-separate "Floaters A&B" term-
// break of +3 eq30. The remaining FL band (3 eq30 above primary) is
// contingent capacity surfaced as the FL rate tier — no separate inv-type
// row anywhere in the chain.
const INVENTORY_CAPS: Cap[] = [
  { phase: "PR", inventory: "Pregame", format: "Standard", avails: 21 },
  { phase: "PR", inventory: "In Game", format: "Standard", avails: 46.5 },
  { phase: "PR", inventory: "In Game+", format: "Standard", avails: 50.5 },
  { phase: "PR", inventory: "In Game-", format: "Standard", avails: 42.5 },
  { phase: "PR", inventory: "Postgame", format: "Standard", avails: 17 },
  { phase: "PR", inventory: "Pregame", format: "Expanded", avails: 21 },
  { phase: "PR", inventory: "In Game", format: "Expanded", avails: 55.5 },
  { phase: "PR", inventory: "In Game+", format: "Expanded", avails: 59.5 },
  { phase: "PR", inventory: "In Game-", format: "Expanded", avails: 51.5 },
  { phase: "PR", inventory: "Postgame", format: "Expanded", avails: 17 },
  { phase: "REG", inventory: "Pregame", format: "Standard", avails: 21 },
  { phase: "REG", inventory: "In Game", format: "Standard", avails: 54 },
  { phase: "REG", inventory: "In Game+", format: "Standard", avails: 58 },
  { phase: "REG", inventory: "In Game-", format: "Standard", avails: 50 },
  { phase: "REG", inventory: "Postgame", format: "Standard", avails: 17 },
  { phase: "REG", inventory: "Pregame", format: "Expanded", avails: 21 },
  { phase: "REG", inventory: "In Game", format: "Expanded", avails: 61 },
  { phase: "REG", inventory: "In Game+", format: "Expanded", avails: 65 },
  { phase: "REG", inventory: "In Game-", format: "Expanded", avails: 57 },
  { phase: "REG", inventory: "Postgame", format: "Expanded", avails: 17 },
];

function capFor(phase: SeasonPhase, invType: RateInventoryType, variant: InGameWithVariant, format: string): number {
  const fmt = format === "Expanded" ? "Expanded" : "Standard";
  const inv = invType === "In Game" ? variant : invType;
  return INVENTORY_CAPS.find((c) => c.phase === phase && c.inventory === inv && c.format === fmt)?.avails ?? 0;
}

// ------------------------------ rate card reader ------------------------------

const RATE_CARD: RawRateCardRow[] = [
  // PR
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Pregame", Matchup: "Standard", Tier: "Base", Rate: 400 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "In Game", Matchup: "Standard", Tier: "Base", Rate: 1650 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Postgame", Matchup: "Standard", Tier: "Base", Rate: 175 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Pregame", Matchup: "Regional", Tier: "Base", Rate: 400 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "In Game", Matchup: "Regional", Tier: "Base", Rate: 1650 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Postgame", Matchup: "Regional", Tier: "Base", Rate: 175 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "In Game", Matchup: "Standard", Tier: "FL", Rate: 1980 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "In Game", Matchup: "Regional", Tier: "FL", Rate: 1980 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Pregame", Matchup: "Standard", Tier: "Bump", Rate: 800 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "In Game", Matchup: "Standard", Tier: "Bump", Rate: 3300 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Postgame", Matchup: "Standard", Tier: "Bump", Rate: 350 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Pregame", Matchup: "Regional", Tier: "Bump", Rate: 800 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "In Game", Matchup: "Regional", Tier: "Bump", Rate: 3300 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "PR", Inv: "Postgame", Matchup: "Regional", Tier: "Bump", Rate: 350 },
  // REG
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Pregame", Matchup: "Standard", Tier: "Base", Rate: 1375 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "In Game", Matchup: "Standard", Tier: "Base", Rate: 11500 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Postgame", Matchup: "Standard", Tier: "Base", Rate: 3650 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Pregame", Matchup: "Regional", Tier: "Base", Rate: 1375 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "In Game", Matchup: "Regional", Tier: "Base", Rate: 17250 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Postgame", Matchup: "Regional", Tier: "Base", Rate: 3650 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "In Game", Matchup: "Standard", Tier: "FL", Rate: 13800 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "In Game", Matchup: "Regional", Tier: "FL", Rate: 20700 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Pregame", Matchup: "Standard", Tier: "Bump", Rate: 2750 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "In Game", Matchup: "Standard", Tier: "Bump", Rate: 23000 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Postgame", Matchup: "Standard", Tier: "Bump", Rate: 7300 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Pregame", Matchup: "Regional", Tier: "Bump", Rate: 2750 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "In Game", Matchup: "Regional", Tier: "Bump", Rate: 34500 },
  { Syscode: 4500, Net: "BSWN", Team: "Sentinels", Type: "REG", Inv: "Postgame", Matchup: "Regional", Tier: "Bump", Rate: 7300 },
];

function rackRate(phase: SeasonPhase, inv: RateInventoryType, matchup: MatchupTier, tier: RateTier): number {
  return (
    RATE_CARD.find(
      (r) => r.Type === phase && r.Inv === inv && r.Matchup === matchup && r.Tier === tier,
    )?.Rate ?? 0
  );
}

function rateTierForOversell(invType: RateInventoryType, oversellEq30: number): RateTier {
  // FL band is now 3 eq30 wide above primary cap (the second floater break,
  // pitching-change-driven). Beyond the FL band → Bump.
  if (invType === "In Game") {
    if (oversellEq30 <= 0) return "Base";
    if (oversellEq30 <= 3) return "FL";
    return "Bump";
  }
  return oversellEq30 <= 0 ? "Base" : "Bump";
}

// ------------------------------ client sampling ------------------------------

// Three-tier intensity calibrated for a 220-advertiser pool to satisfy
// Top 5 EQ30 share (25–35%) and Top 50 EQ30 share (75–88%) simultaneously.
// Pure analytical solve (assuming uniform within each tier):
//   top 5 intensity ≈ 6.0   → 30% of total weight
//   mid 45 intensity ≈ 1.3  → 58% of total weight
//   low 170 intensity ≈ 0.07 → 12% of total weight
// With UNIFORM_SAMPLE_PROB = 0 — at this pool size the uniform component
// flattens distribution against the Top-50 target.
const UNIFORM_SAMPLE_PROB = 0.0;
const TOP_TIER = 5;
const MID_TIER = 45;
const TOP_INTENSITY = 6.0;
const MID_INTENSITY = 1.3;
const LOW_INTENSITY = 0.07;

// ------------------------------ order cadence ------------------------------
//
// Real Wide Orbit OrderNumbers represent an advertiser's signed contract for
// a flight of spots — typically one per active billing period (quarterly is
// the modal cadence, with annual sponsorships and monthly retail flights as
// the long-tail). The pre-C5 generator allocated one OrderNumber per
// (game, inv-type), which inflated order count and conflated multiple
// advertisers under each order. Cadence is now assigned per-advertiser at
// pool-build time and OrderNumbers are looked up lazily per-spot:
//   - sponsor (~12%): 1 season order, plus ~10% of those carry a tactical
//     quarterly overlay (concurrent secondary order in their tactical Q)
//   - quarterly (~80%): 1 order per active broadcast quarter (Q1/Q2/Q3)
//   - monthly (~8%): 1 order per active broadcast month (Feb..Sep)
//
// Non-paid spots (NC / ADU / xADU / Bonus) reuse the same allocator, so they
// inherit the advertiser's order for the period in which they air. If a
// non-paid spot lands in a period the advertiser hasn't transacted in yet,
// the allocator opens a fresh order (rare; bonus inventory house-orders
// behave similarly in production).

type Cadence = "sponsor" | "quarterly" | "monthly";

const CADENCE_MIX: Record<Cadence, number> = {
  sponsor: 0.12,
  quarterly: 0.80,
  monthly: 0.08,
};

const SPONSOR_TACTICAL_PROB = 0.10;
const SPONSOR_TACTICAL_QUARTERS = ["Q2", "Q3"]; // playoff-push windows
// In a sponsor's tactical quarter, fraction of paid In Game spots that
// route to the tactical (overlay) order rather than the season order.
const TACTICAL_ROUTE_PROB = 0.40;

interface AdvertiserWithIntensity {
  adv: Advertiser;
  intensity: number;
  ae: string;
  cadence: Cadence;
  tacticalQtr: string | null;          // 'Q2' | 'Q3' | null
  orders: Map<string, number>;          // periodKey → OrderNumber
}

function buildAdvertiserPool(rng: () => number): AdvertiserWithIntensity[] {
  const advs = loadAdvertisers();
  const indexes = Array.from({ length: advs.length }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  const topSet = new Set(indexes.slice(0, TOP_TIER));
  const midSet = new Set(indexes.slice(TOP_TIER, TOP_TIER + MID_TIER));
  return advs.map((a, idx) => {
    let intensity: number;
    if (topSet.has(idx)) intensity = TOP_INTENSITY + rng() * 0.5;
    else if (midSet.has(idx)) intensity = MID_INTENSITY + rng() * 0.2;
    else intensity = LOW_INTENSITY + rng() * 0.03;
    const ae = a.lob === "Repped" ? rep_firm_ae(rng) : direct_ae(rng);
    const cadence = pickFromMix(rng, CADENCE_MIX);
    const tacticalQtr = cadence === "sponsor" && rng() < SPONSOR_TACTICAL_PROB
      ? SPONSOR_TACTICAL_QUARTERS[Math.floor(rng() * SPONSOR_TACTICAL_QUARTERS.length)]
      : null;
    return { adv: a, intensity, ae, cadence, tacticalQtr, orders: new Map() };
  });
}

function periodKeyFor(cadence: Cadence, isoDate: string, monthName: string): string {
  if (cadence === "sponsor") return "S";
  if (cadence === "quarterly") return quarterOf(isoDate);
  return monthName;
}

function allocateOrder(
  rng: () => number,
  adv: AdvertiserWithIntensity,
  isoDate: string,
  monthName: string,
  isInGame: boolean,
  counter: { id: number },
): number {
  if (
    adv.cadence === "sponsor" &&
    adv.tacticalQtr &&
    quarterOf(isoDate) === adv.tacticalQtr &&
    isInGame &&
    rng() < TACTICAL_ROUTE_PROB
  ) {
    const tk = `T:${adv.tacticalQtr}`;
    let n = adv.orders.get(tk);
    if (n == null) {
      n = ++counter.id;
      adv.orders.set(tk, n);
    }
    return n;
  }
  const k = periodKeyFor(adv.cadence, isoDate, monthName);
  let n = adv.orders.get(k);
  if (n == null) {
    n = ++counter.id;
    adv.orders.set(k, n);
  }
  return n;
}

function clientWeight(c: AdvertiserWithIntensity, matchup: MatchupTier): number {
  let mult = 1.0;
  if (matchup === "Regional" && c.intensity > 4.0) mult = 1.3;
  return c.intensity * mult;
}

interface WeightCache {
  weights: number[];
  total: number;
}

function buildWeightCache(pool: AdvertiserWithIntensity[]): Map<MatchupTier, WeightCache> {
  const cache = new Map<MatchupTier, WeightCache>();
  for (const m of ["Regional", "Standard"] as MatchupTier[]) {
    const weights = pool.map((c) => clientWeight(c, m));
    const total = weights.reduce((a, b) => a + b, 0);
    cache.set(m, { weights, total });
  }
  return cache;
}

function sampleAdvertiser(
  rng: () => number,
  pool: AdvertiserWithIntensity[],
  cacheEntry: WeightCache,
): AdvertiserWithIntensity {
  if (rng() < UNIFORM_SAMPLE_PROB) return pool[Math.floor(rng() * pool.length)];
  let r = rng() * cacheEntry.total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= cacheEntry.weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function sampleSpotLength(rng: () => number, invType: RateInventoryType): SpotLength {
  const mix = LENGTH_MIX[invType];
  return Number(pickWeighted(rng, ["15", "30", "60"], [mix["15"], mix["30"], mix["60"]])) as SpotLength;
}

// ------------------------------ row construction ------------------------------

interface SpotCtx {
  schedule: RawScheduleRow;
  phase: SeasonPhase;
  invType: RateInventoryType;
  variant: InGameWithVariant;
  matchup: MatchupTier;
  format: "Standard" | "Expanded";
  airDate: string; // MM/DD/YYYY
  hour: number;
  minute: number;
  lineRef: { id: number };
  spotIdRef: { id: number };
}

function buildSpotRow(
  rng: () => number,
  ctx: SpotCtx,
  adv: AdvertiserWithIntensity,
  orderNumber: number,
  opts: {
    paid: boolean;
    length: SpotLength;
    grossRate: number;
    rateTier: RateTier;
    priorityCode: string;
  },
): RawSpot {
  const eq30 = LENGTH_TO_EQ30[opts.length];
  const demo = (() => {
    if (rng() < 0.8) return adv.adv.preferred_demo || "HH";
    return ["HH", "A18-49", "A25-54", "M25-54", "A35+", "A21-49"][Math.floor(rng() * 6)];
  })();
  const rating = opts.paid
    ? Math.round((1.0 + rng() * 2.5) * 100) / 100
    : 0;
  const impressions = opts.paid
    ? sampleBookedImpressions(rng, demo, ctx.invType)
    : 0;

  ctx.spotIdRef.id += 1;

  return {
    ChannelName: "BSWN",
    AdvertiserName: adv.adv.raw,
    RevenueCode2: adv.adv.channel || "National",
    OrderNumber: orderNumber,
    LineNumber: ctx.lineRef.id,
    SpotNumber: ctx.spotIdRef.id,
    SpotLength: opts.length,
    SpotRate: opts.paid ? Math.round(opts.grossRate * 100) / 100 : 0,
    SpotState: "Placed",
    PriorityCode: opts.priorityCode,
    AirDate: ctx.airDate,
    AirTime1: timeWithSeconds(rng, ctx.hour, ctx.minute),
    InventoryCodeBooked: inventoryCodeFor(ctx.phase, ctx.invType),
    PathBooked: pathFor(ctx.phase, ctx.invType),
    InventoryCodePlaced: "",
    PathPlaced: "",
    TimePeriod: "Various",
    AEFullName: adv.ae,
    ProductCode: adv.adv.product_code,
    ParentProductCode: adv.adv.parent_product_code,
    DemoCode: demo,
    BookedRating: rating,
    BookedImpressions: impressions,
    UnitCode: opts.paid ? "General" : "Sponsor",
    CPP: null,
    TotalEquivSold: eq30,
    // EffectiveUnitRate is per-eq30 GROSS rate (matching real Wide Orbit's
    // semantics). For a :15 spot at $X gross: EffectiveUnitRate = $X / 0.5,
    // so :15s pull mean(EffectiveUnitRate) UP and :60s pull it DOWN. The
    // M chain's EUR = mean(EffectiveUnitRate) and AUR = mean(SpotRate)
    // produce a positive AUR-vs-EUR delta when length mix includes :15s.
    EffectiveUnitRate: opts.paid ? Math.round((opts.grossRate / eq30) * 100) / 100 : 0,
    UnitAirStatusCode: opts.paid ? "Aired" : "Late Add",
    InventoryType: opts.paid ? "BK" : "NM",
  };
}

// ------------------------------ generation main ------------------------------

interface SchedRow {
  schedule: RawScheduleRow;
  phase: SeasonPhase;
  matchup: MatchupTier;
  variant: InGameWithVariant;
  format: "Standard" | "Expanded";
  hour: number;
  minute: number;
  airDate: string;
  isoDate: string;
  monthName: string;
  dow: DayOfWeek;
  seriesPos: number;
}

function describeSchedule(rows: RawScheduleRow[]): SchedRow[] {
  let lastOpponent: string | null = null;
  let posInSeries = 0;
  return rows.map((r) => {
    const phase: SeasonPhase = r["#"].startsWith("PRE") ? "PR" : "REG";
    const opp = opponentFromRaw(r.OPPONENT);
    const matchup: MatchupTier = opp ? opp.matchup : "Standard";
    const variant = inGameVariantFor(r.TIME);
    const format = formatTagFor(r.FORMAT);
    const { hour, minute } = parseTime(r.TIME);
    const airDate = r.DATE;
    const iso = isoFromUSDate(r.DATE);
    const monthN = monthNameOfUSDate(r.DATE);
    const dow = dowFromUSDate(r.DATE);

    if (opp && opp.name === lastOpponent) posInSeries += 1;
    else { posInSeries = 1; lastOpponent = opp?.name ?? null; }

    return {
      schedule: r,
      phase,
      matchup,
      variant,
      format,
      hour,
      minute,
      airDate,
      isoDate: iso,
      monthName: monthN,
      dow,
      seriesPos: posInSeries,
    };
  });
}

function demandScore(rng: () => number, sr: SchedRow, invType: RateInventoryType): number {
  const raw =
    BASE_DEMAND *
    MATCHUP_MULT[sr.matchup] *
    DOW_MULT[sr.dow] *
    (MONTH_MULT[sr.monthName] ?? 0.95) *
    invTypeMult(invType) *
    FORMAT_MULT[sr.format] *
    seriesPositionMult(sr.seriesPos) +
    gaussian(rng, 0, DEMAND_NOISE_SIGMA);
  return clip(raw, 0, 1);
}

const NC_PROB = 0.85;
const NC_LAMBDA = 4.5;
const ADU_PROB = 0.55;
const ADU_LAMBDA = 3.5;
const XADU_PROB = 0.30;
const XADU_LAMBDA = 2.0;
const BONUS_PROB = 0.50;
const BONUS_LAMBDA = 4.0;

export function buildSpots(schedule: RawScheduleRow[]): RawSpot[] {
  const rng = rngFor("spots");
  const pool = buildAdvertiserPool(rng);
  const cache = buildWeightCache(pool);
  const rows = describeSchedule(schedule);

  const out: RawSpot[] = [];
  const orderCtr = { id: 40000 };
  let lineCounter = 0;
  const spotIdRef = { id: 0 };

  const INV_TYPES: RateInventoryType[] = ["Pregame", "In Game", "Postgame"];

  for (const sr of rows) {
    for (const invType of INV_TYPES) {
      const ce = cache.get(sr.matchup)!;
      const cap = capFor(sr.phase, invType, sr.variant, sr.format);
      const score = demandScore(rng, sr, invType);
      const targetFill = fillRateForScore(score);
      const targetEq30 = Math.max(0, targetFill * cap + gaussian(rng, 0, 2));
      const isInGame = invType === "In Game";

      const ctx: SpotCtx = {
        schedule: sr.schedule, phase: sr.phase, invType, variant: sr.variant, matchup: sr.matchup,
        format: sr.format, airDate: sr.airDate, hour: sr.hour, minute: sr.minute,
        lineRef: { id: 0 }, spotIdRef,
      };

      // Paid loop — allocate OrderNumber per advertiser×period (lazy)
      let remaining = targetEq30;
      let paidEq30 = 0;
      let safety = 0;
      while (remaining > 0.25 && safety < 500) {
        safety += 1;
        const length = sampleSpotLength(rng, invType);
        const eq30 = LENGTH_TO_EQ30[length];
        if (eq30 > remaining + 0.5) break;
        const oversell = paidEq30 - cap;
        const tier = rateTierForOversell(invType, oversell);
        const base = rackRate(sr.phase, invType, sr.matchup, tier);
        const lengthMult = LENGTH_RATE_MULT[length];
        const noise = clip(SOLD_RATE_DISCOUNT_MEAN + gaussian(rng, 0, SOLD_RATE_DISCOUNT_SIGMA), 0.72, 1.0);
        const grossRate = base * lengthMult * noise;
        const adv = sampleAdvertiser(rng, pool, ce);
        const orderNumber = allocateOrder(rng, adv, sr.isoDate, sr.monthName, isInGame, orderCtr);
        ctx.lineRef = { id: ++lineCounter };
        out.push(buildSpotRow(rng, ctx, adv, orderNumber,
          { paid: true, length, grossRate, rateTier: tier, priorityCode: PAID_PRIORITY }));
        remaining -= eq30;
        paidEq30 += eq30;
      }

      // Non-paid groups: NC, ADU, xADU, Bonus.
      // Each non-paid spot samples its own advertiser and inherits that
      // advertiser's order for the broadcast period (or opens a new one
      // on first encounter — the same allocator is reused).
      const groups: Array<{ priority: string; prob: number; lambda: number; isNC?: boolean }> = [
        { priority: NC_PRIORITIES[0], prob: NC_PROB, lambda: NC_LAMBDA, isNC: true },
        { priority: ADU_PRIORITY, prob: ADU_PROB * (1 + (0.6 - score)), lambda: ADU_LAMBDA },
        { priority: XADU_PRIORITY, prob: XADU_PROB, lambda: XADU_LAMBDA },
        { priority: BONUS_PRIORITY, prob: BONUS_PROB, lambda: BONUS_LAMBDA },
      ];
      for (const g of groups) {
        if (rng() >= clip(g.prob, 0, 0.99)) continue;
        const count = Math.max(1, poisson(rng, g.lambda));
        for (let i = 0; i < count; i += 1) {
          const length = sampleSpotLength(rng, invType);
          // NC group splits between P-80 and P-19 (per reference distribution)
          const pri = g.isNC && rng() < 0.30 ? "P-19" : g.priority;
          const adv = sampleAdvertiser(rng, pool, ce);
          const orderNumber = allocateOrder(rng, adv, sr.isoDate, sr.monthName, isInGame, orderCtr);
          ctx.lineRef = { id: ++lineCounter };
          out.push(buildSpotRow(rng, ctx, adv, orderNumber,
            { paid: false, length, grossRate: 0, rateTier: "Base", priorityCode: pri }));
        }
      }
    }
  }
  return out;
}

// ------------------------------ main ------------------------------

const COLUMNS = [
  "ChannelName", "AdvertiserName", "RevenueCode2", "OrderNumber", "LineNumber", "SpotNumber",
  "SpotLength", "SpotRate", "SpotState", "PriorityCode", "AirDate", "AirTime1",
  "InventoryCodeBooked", "PathBooked", "InventoryCodePlaced", "PathPlaced", "TimePeriod",
  "AEFullName", "ProductCode", "ParentProductCode", "DemoCode", "BookedRating",
  "BookedImpressions", "UnitCode", "CPP", "TotalEquivSold", "EffectiveUnitRate",
  "UnitAirStatusCode", "InventoryType",
] as const;

export function run(): void {
  // Read schedule.csv from data/.
  const schedPath = path.join(REFERENCE_DIR, "..", "..", "data", "schedule.csv");
  const text = fs.readFileSync(schedPath, "utf-8");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const rows: RawScheduleRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    // Schedule cells may include commas inside quoted fields ("vs. Cubs (ss)" etc.) but our
    // own writer guarantees no commas in schedule fields except inside the SQUEEZE PLAY BUG
    // column which is comma-free; trivial split is fine.
    const cells = line.split(",");
    const row: any = {};
    header.forEach((col, idx) => { row[col] = cells[idx] ?? ""; });
    rows.push(row);
  }
  const spots = buildSpots(rows);
  writeCsv("spots.csv", COLUMNS as unknown as string[], spots as unknown as Record<string, unknown>[]);
  console.log(`spots.csv: ${spots.length} rows`);
}

if (require.main === module) run();
void pad; void shuffle; void readInventoryCaps; void isRegional; void isoToUSDate;
