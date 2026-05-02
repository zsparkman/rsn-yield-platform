import { rngFor, writeJson } from "./_shared";
import type { Opponent } from "../../src/lib/types";

// 14 fictional teams: 3 Regional, 11 Standard.
// Names are deliberately neutral — no real MLB team or city.
const ROSTER: Array<Omit<Opponent, "base_demand_multiplier">> = [
  // Regional rivals (high demand)
  {
    opponent_id: "o_001",
    name: "Coastal Mariners",
    city: "Bayport",
    league_division: "Coastal",
    matchup_tier: "Regional",
  },
  {
    opponent_id: "o_002",
    name: "Highland Stags",
    city: "Glenmoor",
    league_division: "Mountain",
    matchup_tier: "Regional",
  },
  {
    opponent_id: "o_003",
    name: "Heartland Outlaws",
    city: "Cedar Falls",
    league_division: "Heartland",
    matchup_tier: "Regional",
  },
  // Standard opponents
  {
    opponent_id: "o_004",
    name: "Granite Wolves",
    city: "Stonebridge",
    league_division: "Mountain",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_005",
    name: "Northern Lakers",
    city: "Pinehaven",
    league_division: "Coastal",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_006",
    name: "Atlantic Pilots",
    city: "Harborview",
    league_division: "Atlantic",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_007",
    name: "Prairie Bisons",
    city: "Wheatfield",
    league_division: "Heartland",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_008",
    name: "Riverside Steel",
    city: "Mill City",
    league_division: "Heartland",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_009",
    name: "Desert Foxes",
    city: "Sandstone",
    league_division: "Mountain",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_010",
    name: "Bay City Anchors",
    city: "Marlow Bay",
    league_division: "Coastal",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_011",
    name: "Capital Sentinels",
    city: "Fort Linden",
    league_division: "Atlantic",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_012",
    name: "Summit Eagles",
    city: "Eaglepoint",
    league_division: "Mountain",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_013",
    name: "Delta Riverdogs",
    city: "Old Delta",
    league_division: "Heartland",
    matchup_tier: "Standard",
  },
  {
    opponent_id: "o_014",
    name: "Tidewater Sharks",
    city: "Salt Cove",
    league_division: "Atlantic",
    matchup_tier: "Standard",
  },
];

export function buildOpponents(): Opponent[] {
  const rng = rngFor("opponents");
  return ROSTER.map((r) => {
    const lo = r.matchup_tier === "Regional" ? 1.0 : 0.85;
    const hi = r.matchup_tier === "Regional" ? 1.1 : 1.0;
    const m = lo + rng() * (hi - lo);
    return { ...r, base_demand_multiplier: Math.round(m * 100) / 100 };
  });
}

export function run(): void {
  const rows = buildOpponents();
  writeJson("opponents.json", rows);
  console.log(`opponents.json: ${rows.length} rows`);
}

if (require.main === module) run();
