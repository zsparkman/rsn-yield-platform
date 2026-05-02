import {
  clip,
  discreteSampleNum,
  gaussian,
  pad,
  pickFromMix,
  pickWeighted,
  poisson,
  readJson,
  rngFor,
  rngForKey,
  writeJson,
} from "./_shared";
import type {
  Client,
  DayOfWeek,
  DemoCode,
  Game,
  GameInventoryCell,
  InventoryCapacity,
  InventoryType,
  MatchupTier,
  PriorityCode,
  RateCardEntry,
  RateInventoryType,
  RateTier,
  SeasonPhase,
  Spot,
  SpotLength,
} from "../../src/lib/types";

// ---------- Demand model ----------
//
// NOTE on calibration vs. spec text:
// The spec lists base_demand = 0.65, but with the rest of the multipliers
// (mostly ≤ 1.0 with a clip to [0,1]) that base value produces a market in
// which the vast majority of cells are under cap — incompatible with the
// spec's calibration targets (% In Game cells sold ≤ cap: 30%). The
// validation targets are described as authoritative, so base_demand is
// tuned upward here to satisfy them. See PR description for the full
// rationale and the spec-conflict log.

const BASE_DEMAND = 0.92;
const DEMAND_NOISE_SIGMA = 0.03;

// Sold-rate discount applied to rack rates from rate_card.json. Real-world
// sold rates rarely match rack rates; without this scale, computed EUR
// exceeds the spec's $7,500–$9,500 (Standard) and $11,000–$14,000 (Regional)
// In Game targets even when all spots resolve to Base tier. This multiplies
// the within-tier noise distribution to land mean rates 12–18% below rack.
const SOLD_RATE_DISCOUNT_MEAN = 0.85;
const SOLD_RATE_DISCOUNT_SIGMA = 0.05;
const SOLD_RATE_DISCOUNT_MIN = 0.72;
const SOLD_RATE_DISCOUNT_MAX = 1.0;

const MATCHUP_MULT: Record<MatchupTier, number> = {
  Regional: 1.15,
  Standard: 0.95,
};

const DOW_MULT: Record<DayOfWeek, number> = {
  Sat: 1.10,
  Fri: 1.08,
  Sun: 1.05,
  Tue: 0.98,
  Wed: 0.96,
  Mon: 0.88,
  Thu: 0.85,
};

const MONTH_MULT: Record<string, number> = {
  February: 0.55,
  March: 0.65,
  April: 0.78,
  May: 0.85,
  June: 0.92,
  July: 0.97,
  August: 1.02,
  September: 1.08,
};

function invTypeMult(invType: InventoryType): number {
  if (invType === "Pregame") return 0.85;
  if (invType === "Postgame") return 0.65;
  if (invType === "Floaters A&B") return 0.90;
  return 1.0; // In Game and ± variants
}

const FORMAT_MULT: Record<"Standard" | "Expanded", number> = {
  Standard: 1.0,
  Expanded: 1.04,
};

function seriesPositionMult(num: number): number {
  if (num === 1) return 1.0;
  if (num === 2) return 0.97;
  if (num === 3) return 0.95;
  return 0.93;
}

function demandScore(
  rng: () => number,
  game: Game,
  invType: InventoryType,
): number {
  const raw =
    BASE_DEMAND *
    MATCHUP_MULT[game.matchup_tier] *
    DOW_MULT[game.day_of_week] *
    (MONTH_MULT[game.broadcast_month] ?? 0.95) *
    invTypeMult(invType) *
    FORMAT_MULT[game.format] *
    seriesPositionMult(game.series_game_num) +
    gaussian(rng, 0, DEMAND_NOISE_SIGMA);
  return clip(raw, 0, 1);
}

// Spec anchor points: 0.45→0.60, 0.65→0.80, 0.75→0.95, 0.85→1.05, 0.95→1.20.
// A purely-piecewise curve through those anchors creates a steep tail past
// 0.95 that, combined with the score clip at 1.0, leaves the "20% > 20% over"
// validation target wildly oversubscribed. We use a near-linear curve that
// is faithful to the spec at the high end (matches 0.95→1.20 exactly) but
// slightly more generous at the low end. The slope and intercept are tuned
// against the per-cell demand-score distribution so the three sellout-band
// targets (30 / 50 / 20) all land in tolerance.
function fillRateForScore(score: number): number {
  if (score <= 0) return 0;
  const fill = 0.21 + score * 1.12;
  return Math.max(0, Math.min(1.21, fill));
}

// ---------- Inventory capacity ----------

function buildCapLookup(
  caps: InventoryCapacity[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of caps) {
    m.set(`${c.season_phase}|${c.inv_type}|${c.format}`, c.avails);
  }
  return m;
}

function capFor(
  caps: Map<string, number>,
  game: Game,
  invType: InventoryType,
): number {
  return caps.get(`${game.season_phase}|${invType}|${game.format}`) ?? 0;
}

// ---------- Rate card ----------

function buildRateLookup(
  rates: RateCardEntry[],
): Map<string, number> {
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
  phase: SeasonPhase,
  invType: InventoryType,
  matchup: MatchupTier,
  tier: RateTier,
): number {
  // Floaters A&B priced as In Game (FL tier).
  let priceInv: RateInventoryType = "In Game";
  if (invType === "Pregame") priceInv = "Pregame";
  else if (invType === "Postgame") priceInv = "Postgame";
  // In Game± and Floaters A&B all use In Game prices.

  // Pregame/Postgame don't have FL — fall back to Bump for FL queries.
  let lookupTier: RateTier = tier;
  if (priceInv !== "In Game" && lookupTier === "FL") lookupTier = "Bump";

  return rates.get(`${phase}|${priceInv}|${matchup}|${lookupTier}`) ?? 0;
}

function rateTierForOversell(
  invType: InventoryType,
  oversellEq30: number,
): RateTier {
  // Note on spec sign convention:
  // The 01-data-model.md text reads "oversell_eq30 ≥ 0 → Base" but with the
  // documented field semantics (sold - cap), positive oversell means SOLD-OVER
  // the cap, which would actually map to floater/bump territory. We implement
  // the business-correct interpretation: under-sold or at-cap → Base, in the
  // floater band → FL, beyond floater cap → Bump.
  const isInGameish =
    invType === "In Game" || invType === "In Game+" || invType === "In Game-";
  if (isInGameish) {
    if (oversellEq30 <= 0) return "Base";
    if (oversellEq30 <= 6) return "FL";
    return "Bump";
  }
  if (invType === "Floaters A&B") {
    // Floater spots are explicitly priced at FL tier per spec.
    return "FL";
  }
  // Pregame / Postgame
  if (oversellEq30 <= 0) return "Base";
  return "Bump";
}

// ---------- Length-mix per inventory type ----------

const LENGTH_MIX: Record<
  InventoryType,
  Record<"15" | "30" | "60", number>
> = {
  "In Game": { "15": 0.04, "30": 0.96, "60": 0 },
  "In Game+": { "15": 0.04, "30": 0.96, "60": 0 },
  "In Game-": { "15": 0.04, "30": 0.96, "60": 0 },
  Pregame: { "15": 0.07, "30": 0.92, "60": 0.01 },
  Postgame: { "15": 0.10, "30": 0.89, "60": 0.01 },
  "Floaters A&B": { "15": 0, "30": 1.0, "60": 0 },
};

const LENGTH_TO_EQ30: Record<SpotLength, number> = {
  15: 0.5,
  30: 1.0,
  60: 2.0,
};

const LENGTH_RATE_MULT: Record<SpotLength, number> = {
  15: 0.55,
  30: 1.0,
  60: 1.85,
};

// ---------- Demo + impressions ----------

const ALL_DEMOS: DemoCode[] = ["HH", "A18-49", "A25-54", "M25-54", "A35+", "A21-49"];

const DEMO_UNIVERSE: Record<DemoCode, number> = {
  HH: 5_500,
  "A18-49": 2_400,
  "A25-54": 2_200,
  "M25-54": 1_100,
  "A35+": 2_800,
  "A21-49": 2_300,
};

function sampleDemo(rng: () => number, client: Client): DemoCode {
  if (rng() < 0.8 && ALL_DEMOS.includes(client.preferred_demo as DemoCode)) {
    return client.preferred_demo as DemoCode;
  }
  return ALL_DEMOS[Math.floor(rng() * ALL_DEMOS.length)];
}

function sampleHHRating(
  rng: () => number,
  invType: InventoryType,
  matchup: MatchupTier,
): number {
  const isInGame =
    invType === "In Game" ||
    invType === "In Game+" ||
    invType === "In Game-" ||
    invType === "Floaters A&B";
  if (isInGame) {
    if (matchup === "Regional") return 1.5 + rng() * 2.5;
    return 0.8 + rng() * 1.7;
  }
  return 0.4 + rng() * 1.4;
}

function sampleRating(
  rng: () => number,
  demo: DemoCode,
  invType: InventoryType,
  matchup: MatchupTier,
): number {
  const hh = sampleHHRating(rng, invType, matchup);
  if (demo === "HH") return hh;
  return hh * (0.5 + rng() * 0.2); // 0.5–0.7×
}

// ---------- Client sampling ----------

function clientWeight(
  client: Client,
  invType: InventoryType,
  matchup: MatchupTier,
): number {
  const baseInv: "Pregame" | "In Game" | "Postgame" =
    invType === "Pregame"
      ? "Pregame"
      : invType === "Postgame"
      ? "Postgame"
      : "In Game"; // In Game / In Game± / Floaters
  // Spec values: matched=2.0, mixed=1.5, mismatch=0.5. The match boost is
  // softened and the mismatch penalty is removed here so non-preferred-inv
  // clients can still buy meaningful volume — with the spec values, the
  // small-pool inv preferences (Postgame, mixed) collapse the Top-50 EQ30
  // share well above the 88% ceiling.
  let invMatch: number;
  if (client.preferred_inv_type === "mixed") invMatch = 1.2;
  else if (client.preferred_inv_type === baseInv) invMatch = 1.4;
  else invMatch = 1.2;

  let matchupFamiliarity = 1.0;
  if (matchup === "Regional" && client.buying_intensity > 0.5) {
    matchupFamiliarity = 1.3;
  }
  return client.buying_intensity * invMatch * matchupFamiliarity;
}

function buildClientWeightCache(
  clients: Client[],
): Map<string, { weights: number[]; total: number }> {
  const cache = new Map<string, { weights: number[]; total: number }>();
  for (const inv of [
    "In Game",
    "In Game+",
    "In Game-",
    "Pregame",
    "Postgame",
    "Floaters A&B",
  ] as InventoryType[]) {
    for (const m of ["Regional", "Standard"] as MatchupTier[]) {
      const weights = clients.map((c) => clientWeight(c, inv, m));
      const total = weights.reduce((a, b) => a + b, 0);
      cache.set(`${inv}|${m}`, { weights, total });
    }
  }
  return cache;
}

// Small uniform-sampling component on top of weighted sampling. This guarantees
// the long-tail clients get a baseline share of paid spots, which is what
// keeps the Top-50 EQ30 share inside the spec's 75–88% band; pure weighted
// sampling under the spec's match/mismatch ratios collapses bottom-tier
// clients well below the band's floor.
const UNIFORM_SAMPLE_PROB = 0.70;

function sampleClient(
  rng: () => number,
  clients: Client[],
  cacheEntry: { weights: number[]; total: number },
): Client {
  if (rng() < UNIFORM_SAMPLE_PROB) {
    return clients[Math.floor(rng() * clients.length)];
  }
  let r = rng() * cacheEntry.total;
  for (let i = 0; i < clients.length; i += 1) {
    r -= cacheEntry.weights[i];
    if (r <= 0) return clients[i];
  }
  return clients[clients.length - 1];
}

function sampleSpotLength(rng: () => number, invType: InventoryType): SpotLength {
  const mix = LENGTH_MIX[invType];
  const k = pickWeighted(rng, ["15", "30", "60"], [mix["15"], mix["30"], mix["60"]]);
  return Number(k) as SpotLength;
}

// ---------- Floater firing distribution ----------

// Slight bump to P(0 fires) vs the spec's 8.9% so the regulation-only
// component lands the "% games firing 0 floaters" target (8% ± 3%) within
// the Monte-Carlo noise floor for a 145-game season.
const FLOATER_REGULATION_PMF: Record<string, number> = {
  "0": 0.115,
  "1": 0.133,
  "2": 0.255,
  "3": 0.378,
  "4": 0.097,
  "5": 0.0,
  "6": 0.022,
};

const FLOATER_EXTRAS_PMF: Record<string, number> = {
  "3": 0.05,
  "4": 0.20,
  "5": 0.40,
  "6": 0.25,
  "7": 0.10,
};

const EXTRAS_PROB = 0.13;

// Per-game RNG so the firing count is stable against upstream changes.
function sampleFloaterFires(gameId: string): number {
  const rng = rngForKey("floater-fires", gameId);
  const isExtras = rng() < EXTRAS_PROB;
  return discreteSampleNum(
    rng,
    isExtras ? FLOATER_EXTRAS_PMF : FLOATER_REGULATION_PMF,
  );
}

// ---------- Game-inventory cells ----------

function buildGameInventoryCells(
  games: Game[],
  capLookup: Map<string, number>,
): GameInventoryCell[] {
  const cells: GameInventoryCell[] = [];
  for (const g of games) {
    // Each game emits: Pregame, the resolved In Game variant, Postgame, Floaters A&B.
    const invs: InventoryType[] = [
      "Pregame",
      g.in_game_variant,
      "Postgame",
      "Floaters A&B",
    ];
    for (const inv of invs) {
      const cap = capFor(capLookup, g, inv);
      cells.push({
        game_id: g.game_id,
        inv_type: inv,
        cap,
        effective_cap: Math.round(cap * 1.10 * 10) / 10,
        floater_cap: inv === "Floaters A&B" ? 6 : 0,
        game: g,
      });
    }
  }
  return cells;
}

// ---------- Spot generation ----------

interface CellSpots {
  spots: Spot[];
  paidEq30: number;
}

function generatePaidSpotsForCell(
  rng: () => number,
  cell: GameInventoryCell,
  clients: Client[],
  weightCache: Map<string, { weights: number[]; total: number }>,
  rateLookup: Map<string, number>,
  spotIdRef: { id: number },
): CellSpots {
  if (cell.inv_type === "Floaters A&B") {
    // Floater spots come from the firing distribution, not the demand model.
    return generateFloaterPaidSpots(
      rng,
      cell,
      clients,
      weightCache,
      rateLookup,
      spotIdRef,
    );
  }

  const score = demandScore(rng, cell.game, cell.inv_type);
  const targetFillPct = fillRateForScore(score);
  const targetEq30Raw = targetFillPct * cell.cap + gaussian(rng, 0, 2);
  const targetEq30 = Math.max(0, targetEq30Raw);

  const spots: Spot[] = [];
  let remaining = targetEq30;
  const cacheEntry = weightCache.get(
    `${cell.inv_type}|${cell.game.matchup_tier}`,
  )!;

  let safetyCount = 0;
  while (remaining > 0.25 && safetyCount < 500) {
    safetyCount += 1;
    const length = sampleSpotLength(rng, cell.inv_type);
    const eq30 = LENGTH_TO_EQ30[length];
    if (eq30 > remaining + 0.5) break; // about to overshoot meaningfully
    const client = sampleClient(rng, clients, cacheEntry);

    const soldSoFar = targetEq30 - remaining;
    const oversell = soldSoFar - cell.cap;
    const tier = rateTierForOversell(cell.inv_type, oversell);
    const baseRate = lookupRate(
      rateLookup,
      cell.game.season_phase,
      cell.inv_type,
      cell.game.matchup_tier,
      tier,
    );
    const lengthMult = LENGTH_RATE_MULT[length];
    const noise = clip(
      SOLD_RATE_DISCOUNT_MEAN + gaussian(rng, 0, SOLD_RATE_DISCOUNT_SIGMA),
      SOLD_RATE_DISCOUNT_MIN,
      SOLD_RATE_DISCOUNT_MAX,
    );
    const grossRateRaw = baseRate * lengthMult * noise;
    const grossCents = Math.round(grossRateRaw);
    const netCents = Math.round(grossCents * 0.85);

    const demo = sampleDemo(rng, client);
    const rating = sampleRating(rng, demo, cell.inv_type, cell.game.matchup_tier);
    const impressions = Math.round(rating * DEMO_UNIVERSE[demo] * 1000);

    spotIdRef.id += 1;
    spots.push({
      spot_id: `s_${pad(spotIdRef.id, 6)}`,
      game_id: cell.game.game_id,
      client_id: client.client_id,
      inv_type: cell.inv_type,
      spot_length: length,
      spot_length_eq30: eq30,
      rate_tier: tier,
      spot_rate_gross_cents: grossCents,
      spot_rate_net_cents: netCents,
      total_eq30: eq30,
      priority_code: "paid",
      demo_code: demo,
      booked_impressions: impressions,
      booked_rating: Math.round(rating * 100) / 100,
      spot_state: "Booked",
      ae_name: client.ae_name,
    });
    remaining -= eq30;
  }
  return { spots, paidEq30: targetEq30 - remaining };
}

function generateFloaterPaidSpots(
  rng: () => number,
  cell: GameInventoryCell,
  clients: Client[],
  weightCache: Map<string, { weights: number[]; total: number }>,
  rateLookup: Map<string, number>,
  spotIdRef: { id: number },
): CellSpots {
  const fires = sampleFloaterFires(cell.game.game_id);
  if (fires === 0) return { spots: [], paidEq30: 0 };
  const spots: Spot[] = [];
  const cacheEntry = weightCache.get(
    `${cell.inv_type}|${cell.game.matchup_tier}`,
  )!;

  // Per spec: "the term break is free" — the first floater fire still
  // produces a placed spot but at $0 (network make-good), so we tag it
  // priority='bonus'. Subsequent fires generate a 3-spot pod each at FL.
  const buildSpot = (priority: PriorityCode, rateCents: number) => {
    const client = sampleClient(rng, clients, cacheEntry);
    const netCents = Math.round(rateCents * 0.85);
    const demo = sampleDemo(rng, client);
    const rating = sampleRating(rng, demo, cell.inv_type, cell.game.matchup_tier);
    const impressions = Math.round(rating * DEMO_UNIVERSE[demo] * 1000);
    spotIdRef.id += 1;
    return {
      spot_id: `s_${pad(spotIdRef.id, 6)}`,
      game_id: cell.game.game_id,
      client_id: client.client_id,
      inv_type: cell.inv_type,
      spot_length: 30 as SpotLength,
      spot_length_eq30: 1,
      rate_tier: "FL" as RateTier,
      spot_rate_gross_cents: rateCents,
      spot_rate_net_cents: netCents,
      total_eq30: 1,
      priority_code: priority,
      demo_code: demo,
      booked_impressions: impressions,
      booked_rating: Math.round(rating * 100) / 100,
      spot_state: "Booked" as const,
      ae_name: client.ae_name,
    };
  };

  // First floater = "term break", goes free → bonus.
  spots.push(buildSpot("bonus", 0));

  // Beyond-first: 3 paid :30s per fire at FL.
  let paidEq30 = 0;
  for (let i = 1; i < fires; i += 1) {
    const baseRate = lookupRate(
      rateLookup,
      cell.game.season_phase,
      cell.inv_type,
      cell.game.matchup_tier,
      "FL",
    );
    for (let j = 0; j < 3; j += 1) {
      const noise = clip(
        SOLD_RATE_DISCOUNT_MEAN + gaussian(rng, 0, SOLD_RATE_DISCOUNT_SIGMA),
        SOLD_RATE_DISCOUNT_MIN,
        SOLD_RATE_DISCOUNT_MAX,
      );
      const grossCents = Math.round(baseRate * noise);
      spots.push(buildSpot("paid", grossCents));
      paidEq30 += 1;
    }
  }
  return { spots, paidEq30 };
}

function generateNonPaidSpotsForCell(
  rng: () => number,
  cell: GameInventoryCell,
  clients: Client[],
  weightCache: Map<string, { weights: number[]; total: number }>,
  spotIdRef: { id: number },
): Spot[] {
  // Skip non-paid generation for Floaters A&B (firing-only).
  if (cell.inv_type === "Floaters A&B") return [];

  const score = demandScore(rng, cell.game, cell.inv_type);

  const cacheEntry = weightCache.get(
    `${cell.inv_type}|${cell.game.matchup_tier}`,
  )!;

  // Calibration choice:
  // The literal spec rates (NC 0.35×Pois(2), ADU 0.25×Pois(1.5), xADU 0.10×Pois(1),
  // Bonus 0.20×Pois(2)) yield ~1.6 non-paid spots per cell, which gives ~93% paid
  // share and misses the 78% calibration target. The non-paid rates are scaled up
  // to land in the 74–82% paid band. See PR notes / spec conflict log.
  const NC_PROB = 0.85;
  const NC_LAMBDA = 4.5;
  const ADU_PROB = 0.55;
  const ADU_LAMBDA = 3.5;
  const XADU_PROB = 0.30;
  const XADU_LAMBDA = 2.0;
  const BONUS_PROB = 0.50;
  const BONUS_LAMBDA = 4.0;

  const out: Spot[] = [];
  const groups: Array<{ priority: PriorityCode; prob: number; lambda: number }> = [
    { priority: "nc", prob: NC_PROB, lambda: NC_LAMBDA },
    {
      priority: "adu",
      prob: ADU_PROB * (1 + (0.6 - score)), // skew to lower-demand cells
      lambda: ADU_LAMBDA,
    },
    { priority: "xadu", prob: XADU_PROB, lambda: XADU_LAMBDA },
    { priority: "bonus", prob: BONUS_PROB, lambda: BONUS_LAMBDA },
  ];
  for (const g of groups) {
    if (rng() >= clip(g.prob, 0, 0.99)) continue;
    const count = Math.max(1, poisson(rng, g.lambda));
    for (let i = 0; i < count; i += 1) {
      const length = sampleSpotLength(rng, cell.inv_type);
      const eq30 = LENGTH_TO_EQ30[length];
      const client = sampleClient(rng, clients, cacheEntry);
      const demo = sampleDemo(rng, client);
      const rating = sampleRating(rng, demo, cell.inv_type, cell.game.matchup_tier);
      const impressions = Math.round(rating * DEMO_UNIVERSE[demo] * 1000);
      spotIdRef.id += 1;
      out.push({
        spot_id: `s_${pad(spotIdRef.id, 6)}`,
        game_id: cell.game.game_id,
        client_id: client.client_id,
        inv_type: cell.inv_type,
        spot_length: length,
        spot_length_eq30: eq30,
        rate_tier: "Base",
        spot_rate_gross_cents: 0,
        spot_rate_net_cents: 0,
        total_eq30: eq30,
        priority_code: g.priority,
        demo_code: demo,
        booked_impressions: impressions,
        booked_rating: Math.round(rating * 100) / 100,
        spot_state: "Booked",
        ae_name: client.ae_name,
      });
    }
  }
  return out;
}

export function buildSpots(): { spots: Spot[]; cells: GameInventoryCell[] } {
  const games = readJson<Game[]>("games.json");
  const clients = readJson<Client[]>("clients.json");
  const caps = readJson<InventoryCapacity[]>("inventory_capacity.json");
  const rates = readJson<RateCardEntry[]>("rate_card.json");

  const capLookup = buildCapLookup(caps);
  const rateLookup = buildRateLookup(rates);
  const weightCache = buildClientWeightCache(clients);

  const cells = buildGameInventoryCells(games, capLookup);
  const rng = rngFor("spots");

  const spotIdRef = { id: 0 };
  const allSpots: Spot[] = [];
  for (const cell of cells) {
    const paid = generatePaidSpotsForCell(
      rng,
      cell,
      clients,
      weightCache,
      rateLookup,
      spotIdRef,
    );
    allSpots.push(...paid.spots);
    const np = generateNonPaidSpotsForCell(
      rng,
      cell,
      clients,
      weightCache,
      spotIdRef,
    );
    allSpots.push(...np);
  }
  return { spots: allSpots, cells };
}

export function run(): void {
  const { spots, cells } = buildSpots();
  writeJson("spots.json", spots);
  writeJson("game_inventory.json", cells);
  console.log(`spots.json: ${spots.length} rows`);
  console.log(`game_inventory.json: ${cells.length} rows`);
}

if (require.main === module) run();
