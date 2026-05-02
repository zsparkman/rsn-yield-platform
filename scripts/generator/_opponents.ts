// Real MLB opponent names. Sentinels (fictional) is the home team —
// every other team is a real MLB franchise. Matchup tier classification
// mirrors the M code's hardcoded regional set (Giants / Padres / Angels).

import type { MatchupTier } from "../../src/lib/types";

export interface Opponent {
  name: string;          // bare team name, used in "vs. {name}" / "at {name}"
  matchup: MatchupTier;  // M classifier: Giants/Padres/Angels → Regional, else Standard
  division: string;      // for start-time TZ heuristics
}

const REGIONAL = new Set(["Giants", "Padres", "Angels"]);

const TEAMS: ReadonlyArray<Omit<Opponent, "matchup">> = [
  // NL West (regional rivals + non-LA NL West)
  { name: "Giants", division: "NL West" },
  { name: "Padres", division: "NL West" },
  { name: "Angels", division: "AL West" }, // crosstown
  { name: "Diamondbacks", division: "NL West" },
  { name: "Rockies", division: "NL West" },
  // AL West
  { name: "Athletics", division: "AL West" },
  { name: "Mariners", division: "AL West" },
  { name: "Astros", division: "AL West" },
  { name: "Rangers", division: "AL West" },
  // NL Central
  { name: "Cubs", division: "NL Central" },
  { name: "Brewers", division: "NL Central" },
  { name: "Cardinals", division: "NL Central" },
  { name: "Reds", division: "NL Central" },
  { name: "Pirates", division: "NL Central" },
  // NL East
  { name: "Mets", division: "NL East" },
  { name: "Phillies", division: "NL East" },
  { name: "Braves", division: "NL East" },
  { name: "Marlins", division: "NL East" },
  { name: "Nationals", division: "NL East" },
  // AL Central
  { name: "Guardians", division: "AL Central" },
  { name: "White Sox", division: "AL Central" },
  { name: "Tigers", division: "AL Central" },
  { name: "Royals", division: "AL Central" },
  { name: "Twins", division: "AL Central" },
  // AL East (interleague)
  { name: "Yankees", division: "AL East" },
  { name: "Red Sox", division: "AL East" },
  { name: "Orioles", division: "AL East" },
  { name: "Blue Jays", division: "AL East" },
  { name: "Rays", division: "AL East" },
];

export const OPPONENTS: ReadonlyArray<Opponent> = TEAMS.map((t) => ({
  ...t,
  matchup: REGIONAL.has(t.name) ? "Regional" : "Standard",
}));

export const HOME_TEAM = "Sentinels";

export function isRegional(opponentName: string): boolean {
  return REGIONAL.has(opponentName);
}
