import {
  DEMO_YEAR,
  addDays,
  dayOfWeekFromIso,
  isoDate,
  monthName,
  mondayOfWeek,
  pad,
  pickFromMix,
  pickWeighted,
  quarterOf,
  readJson,
  rngFor,
  shuffle,
  writeJson,
} from "./_shared";
import type {
  DayOfWeek,
  Format,
  Game,
  HomeAway,
  InGameVariant,
  Opponent,
  SeasonPhase,
  Simulcast,
} from "../../src/lib/types";

// --- Constants ---

const PR_START = isoDate(DEMO_YEAR, 2, 21);
const PR_END_TARGET = isoDate(DEMO_YEAR, 3, 23); // PR runs ~5 weeks
const REG_START = isoDate(DEMO_YEAR, 3, 27); // Thursday opener
const REG_END = isoDate(DEMO_YEAR, 9, 28); // last Sunday in Sept

const PR_GAMES = 25;
const REG_GAMES = 145;

// DoW play-rate target → matches validation distribution exactly when integrated
// over a full REG span of ~26 weeks. Targets in spec:
//   Sat 16.9%, Fri 16.4%, Tue 16.1%, Sun 15.9%, Wed 15.3%, Mon 10.1%, Thu 9.4%
const DOW_PLAY_RATE: Record<DayOfWeek, number> = {
  Sat: 0.943,
  Fri: 0.916,
  Tue: 0.896,
  Sun: 0.888,
  Wed: 0.853,
  Mon: 0.563,
  Thu: 0.524,
};

const IN_GAME_VARIANT_MIX: Record<InGameVariant, number> = {
  "In Game": 0.76,
  "In Game-": 0.12,
  "In Game+": 0.12,
};

const SIMULCAST_PROB_REG = 0.05;
const NETWORK_PARTNER_MIX = {
  MLBN: 0.30,
  TBS: 0.25,
  ESPN: 0.25,
  FS1: 0.20,
};

const HOME_TIME_MIX = {
  "19:10": 0.6,
  "13:10": 0.15,
  "18:10": 0.10,
  "16:10": 0.10,
  "12:10": 0.05,
};
const PR_TIME_MIX = {
  "13:05": 0.45,
  "12:05": 0.40,
  "17:05": 0.10,
  "18:10": 0.05,
};

function homeStartTime(rng: () => number): string {
  return pickFromMix(rng, HOME_TIME_MIX);
}

function awayStartTimeFor(division: string, rng: () => number): string {
  // Map opponent division to a Pacific-time start.
  if (division === "Atlantic") {
    // East coast: 4:10 PM Pacific
    return pickWeighted(rng, ["16:10", "16:05", "16:07"], [0.7, 0.2, 0.1]);
  }
  if (division === "Heartland") {
    // Central: 5:10 PM Pacific
    return pickWeighted(rng, ["17:10", "13:10"], [0.85, 0.15]);
  }
  if (division === "Mountain") {
    return pickWeighted(rng, ["18:10", "13:10"], [0.85, 0.15]);
  }
  // Coastal: 7:10 PM Pacific (same TZ) or day game
  return pickWeighted(rng, ["19:10", "13:10"], [0.85, 0.15]);
}

function prStartTime(rng: () => number): string {
  return pickFromMix(rng, PR_TIME_MIX);
}

function startMinuteMod30(time: string): number {
  const minute = Number(time.slice(3));
  return minute % 30;
}

// Build PR schedule: 25 games, mostly day games, all Standard, no simulcast.
function buildPRSchedule(rng: () => number, opponents: Opponent[]): Game[] {
  const regionals = opponents.filter((o) => o.matchup_tier === "Regional");
  const standards = opponents.filter((o) => o.matchup_tier === "Standard");

  // Build a roster of 25 PR opponent slots. Regional ~2x each (6), Standard fills 19.
  // 11 standards × ~1.7 = 18.7, round up = 19.
  const slots: Opponent[] = [];
  for (const r of regionals) {
    slots.push(r, r);
  }
  // 19 standard slots: each appears once, 8 chosen randomly to repeat.
  const stdShuffled = shuffle(rng, standards);
  for (const s of stdShuffled) slots.push(s);
  for (let i = 0; i < 8; i += 1) slots.push(stdShuffled[i]);
  if (slots.length !== PR_GAMES) {
    throw new Error(`PR slot allocation: ${slots.length} vs target ${PR_GAMES}`);
  }
  const opponentOrder = shuffle(rng, slots);

  // Walk Feb 21 forward; ~5–6 games per week. Skip Mon/Thu sometimes.
  const games: Game[] = [];
  let cursor = PR_START;
  let placed = 0;
  let opponentIdx = 0;
  while (placed < PR_GAMES && cursor <= addDays(PR_END_TARGET, 14)) {
    const dow = dayOfWeekFromIso(cursor);
    // PR cadence: skip ~1-2 days per week. Never play 7 days straight.
    let play = true;
    if (dow === "Mon") play = rng() < 0.55;
    else if (dow === "Thu") play = rng() < 0.50;
    else play = rng() < 0.92;

    if (play) {
      const opp = opponentOrder[opponentIdx];
      opponentIdx += 1;
      const homeAway: HomeAway = rng() < 0.55 ? "Home" : "Away";
      const startTime = prStartTime(rng);
      const variant = pickFromMix(rng, IN_GAME_VARIANT_MIX);
      const weekStart = mondayOfWeek(cursor);
      const seriesId = `pr_${pad(games.length + 1, 3)}`;
      games.push({
        game_id: `g_${pad(games.length + 1)}`,
        air_date: cursor,
        day_of_week: dow,
        start_time: startTime,
        start_minute_mod_30: startMinuteMod30(startTime),
        in_game_variant: variant,
        season_phase: "PR",
        opponent_id: opp.opponent_id,
        opponent_name: opp.name,
        home_away: homeAway,
        matchup_tier: opp.matchup_tier,
        format: "Standard",
        simulcast: "Exclusive",
        network_partner: null,
        broadcast_month: monthName(cursor),
        broadcast_year: DEMO_YEAR,
        broadcast_qtr: quarterOf(cursor) as "Q1" | "Q2" | "Q3",
        week_start: weekStart,
        series_id: seriesId,
        series_game_num: 1,
      });
      placed += 1;
    }
    cursor = addDays(cursor, 1);
  }
  if (placed < PR_GAMES) {
    throw new Error(`PR underbuild: only placed ${placed} of ${PR_GAMES}`);
  }
  return games;
}

// --- REG schedule ---

interface SeriesPlan {
  opponent: Opponent;
  length: number; // 3 or 4 games
  homeAway: HomeAway;
}

function buildSeriesPlan(rng: () => number, opponents: Opponent[]): SeriesPlan[] {
  const regionals = opponents.filter((o) => o.matchup_tier === "Regional");
  const standards = opponents.filter((o) => o.matchup_tier === "Standard");
  if (regionals.length !== 3 || standards.length !== 11) {
    throw new Error("Expected 3 Regional + 11 Standard opponents");
  }

  // Regional: 18 series total — 15× three-game + 3× four-game.
  // Each Regional opponent gets 6 series; one of them becomes a 4-game.
  const regional: SeriesPlan[] = [];
  for (const r of regionals) {
    const lengths = [4, 3, 3, 3, 3, 3];
    for (const len of lengths) {
      regional.push({ opponent: r, length: len, homeAway: "Home" });
    }
  }
  // Standard: 29 series total — 28×3 + 1×4 = 88 games. 11 opponents distribute
  // those 29 series; some get 3, others get 2.
  const stdSlots: number[] = []; // series counts per opponent
  // Make 7 opponents have 3 series, 4 opponents have 2 series → 21 + 8 = 29.
  for (let i = 0; i < 7; i += 1) stdSlots.push(3);
  for (let i = 0; i < 4; i += 1) stdSlots.push(2);
  const shuffledStd = shuffle(rng, standards);
  const standard: SeriesPlan[] = [];
  let fourGameUsed = false;
  for (let i = 0; i < shuffledStd.length; i += 1) {
    const opp = shuffledStd[i];
    const seriesCount = stdSlots[i];
    for (let j = 0; j < seriesCount; j += 1) {
      let len = 3;
      if (!fourGameUsed && j === 0 && i === 0) {
        len = 4;
        fourGameUsed = true;
      }
      standard.push({ opponent: opp, length: len, homeAway: "Home" });
    }
  }

  // Assign home/away per opponent: roughly 50/50 series each.
  const all: SeriesPlan[] = [...regional, ...standard];
  // Group by opponent and flip half to away.
  const grouped = new Map<string, SeriesPlan[]>();
  for (const s of all) {
    const list = grouped.get(s.opponent.opponent_id) ?? [];
    list.push(s);
    grouped.set(s.opponent.opponent_id, list);
  }
  for (const list of grouped.values()) {
    const shuffled = shuffle(rng, list);
    const half = Math.floor(shuffled.length / 2);
    for (let i = 0; i < half; i += 1) shuffled[i].homeAway = "Away";
    // For odd counts, randomize the leftover home/away.
    if (shuffled.length % 2 === 1) {
      shuffled[half].homeAway = rng() < 0.5 ? "Home" : "Away";
    }
  }

  // Total games sanity.
  const total = all.reduce((acc, s) => acc + s.length, 0);
  if (total !== REG_GAMES) {
    throw new Error(`Series plan totals ${total} games, expected ${REG_GAMES}`);
  }
  return all;
}

// Order series so home/away forms blocks of 6–10 games.
function orderSeriesByBlock(rng: () => number, series: SeriesPlan[]): SeriesPlan[] {
  const homePool = shuffle(rng, series.filter((s) => s.homeAway === "Home"));
  const awayPool = shuffle(rng, series.filter((s) => s.homeAway === "Away"));

  const ordered: SeriesPlan[] = [];
  let nextSide: HomeAway = rng() < 0.5 ? "Home" : "Away";
  while (homePool.length || awayPool.length) {
    const pool = nextSide === "Home" ? homePool : awayPool;
    const otherPool = nextSide === "Home" ? awayPool : homePool;
    if (!pool.length) {
      // Fall back to whichever pool has anything.
      nextSide = nextSide === "Home" ? "Away" : "Home";
      continue;
    }
    // Block target: 6–10 games. Aim for 2–3 series.
    const blockTargetGames = 6 + Math.floor(rng() * 5); // 6..10
    let gamesInBlock = 0;
    while (pool.length && gamesInBlock < blockTargetGames) {
      const s = pool.shift()!;
      ordered.push(s);
      gamesInBlock += s.length;
      // Stop if we'd exceed the block significantly with another series.
      if (
        pool[0] &&
        gamesInBlock + pool[0].length > blockTargetGames + 1 &&
        otherPool.length
      ) {
        break;
      }
    }
    nextSide = nextSide === "Home" ? "Away" : "Home";
  }

  return ordered;
}

// Lay series onto the calendar, marking off-days probabilistically by DoW
// to hit the target distribution.
function placeSeriesOnCalendar(
  rng: () => number,
  series: SeriesPlan[],
): Array<{ series: SeriesPlan; dates: string[] }> {
  // Build the day-by-day pool: from REG_START to REG_END, decide play/off
  // per DoW play-rate. Then carve into series-length runs (no off-days
  // within a series; off-days only between series).
  const playDays: string[] = [];
  const offDays = new Set<string>();
  let cursor = REG_START;
  while (cursor <= REG_END) {
    const dow = dayOfWeekFromIso(cursor);
    if (rng() < DOW_PLAY_RATE[dow]) {
      playDays.push(cursor);
    } else {
      offDays.add(cursor);
    }
    cursor = addDays(cursor, 1);
  }

  // Group playDays into runs of consecutive dates.
  const runs: string[][] = [];
  let current: string[] = [];
  for (let i = 0; i < playDays.length; i += 1) {
    const date = playDays[i];
    if (i === 0) {
      current = [date];
    } else {
      const prev = playDays[i - 1];
      if (addDays(prev, 1) === date) {
        current.push(date);
      } else {
        runs.push(current);
        current = [date];
      }
    }
  }
  if (current.length) runs.push(current);

  // Now we need to map series (each with length 3 or 4) onto these runs,
  // splitting longer runs as needed and merging too-short runs by inserting
  // synthetic "no off-day" between series.
  const targetDates: string[][] = [];
  let runIdx = 0;
  let runOffset = 0;
  let extraDayQueue: string[] = []; // dates we've consumed from runs but haven't filled yet

  const remainingPlayDayCount = () => {
    let count = extraDayQueue.length;
    for (let i = runIdx; i < runs.length; i += 1) {
      count += runs[i].length - (i === runIdx ? runOffset : 0);
    }
    return count;
  };

  function takeNextDate(): string | null {
    if (extraDayQueue.length) return extraDayQueue.shift()!;
    while (runIdx < runs.length) {
      const run = runs[runIdx];
      if (runOffset < run.length) {
        const d = run[runOffset];
        runOffset += 1;
        return d;
      }
      runIdx += 1;
      runOffset = 0;
    }
    return null;
  }

  // We may end up needing more or fewer playing days than runs offer.
  // Target: exactly REG_GAMES playing days. Adjust by adding/removing days.
  let totalAvailable = playDays.length;
  // Drop extra days (off-days at random) or add days (convert off-days to play).
  if (totalAvailable > REG_GAMES) {
    const toDrop = totalAvailable - REG_GAMES;
    // Drop from runs of length > 4 (split them) or from short runs.
    // Simplest: drop random play-days, prefer from longer runs.
    const candidates = playDays.slice();
    const dropped = new Set<string>();
    // Sort candidates by their run length descending.
    const dateRunLen = new Map<string, number>();
    for (const r of runs) for (const d of r) dateRunLen.set(d, r.length);
    candidates.sort((a, b) => (dateRunLen.get(b)! - dateRunLen.get(a)!));
    for (let i = 0; i < toDrop; i += 1) dropped.add(candidates[i]);
    // Rebuild runs without dropped dates.
    runs.length = 0;
    let cur: string[] = [];
    for (let i = 0; i < playDays.length; i += 1) {
      const d = playDays[i];
      if (dropped.has(d)) {
        if (cur.length) runs.push(cur);
        cur = [];
        continue;
      }
      if (cur.length === 0 || addDays(cur[cur.length - 1], 1) === d) {
        cur.push(d);
      } else {
        runs.push(cur);
        cur = [d];
      }
    }
    if (cur.length) runs.push(cur);
    runIdx = 0;
    runOffset = 0;
    totalAvailable = REG_GAMES;
  } else if (totalAvailable < REG_GAMES) {
    // Add days from off-days set, prefer those adjacent to existing runs.
    const need = REG_GAMES - totalAvailable;
    const addable = Array.from(offDays).sort();
    for (let i = 0; i < need && i < addable.length; i += 1) {
      // Naive: just add it as a singleton run.
      runs.push([addable[i]]);
    }
    // Re-sort runs by start date.
    runs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    runIdx = 0;
    runOffset = 0;
    totalAvailable += need;
  }

  // Assign each series.length consecutive playing days from runs.
  for (const s of series) {
    const dates: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const d = takeNextDate();
      if (!d) {
        throw new Error(
          `Calendar exhausted at series ${s.opponent.name} (${s.length}); ` +
            `placed ${targetDates.length} of ${series.length} series`,
        );
      }
      dates.push(d);
    }
    targetDates.push(dates);
    void remainingPlayDayCount;
    void extraDayQueue;
  }

  // Sort series by their start date so chronological order is preserved.
  const paired: Array<{ series: SeriesPlan; dates: string[] }> = series.map(
    (s, i) => ({ series: s, dates: targetDates[i] }),
  );
  paired.sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));
  return paired;
}

function buildREGSchedule(
  rng: () => number,
  opponents: Opponent[],
  startGameId: number,
): Game[] {
  const plan = buildSeriesPlan(rng, opponents);
  const ordered = orderSeriesByBlock(rng, plan);
  const placed = placeSeriesOnCalendar(rng, ordered);

  const games: Game[] = [];
  let gameId = startGameId;
  let seriesNum = 0;
  for (const { series, dates } of placed) {
    seriesNum += 1;
    const seriesId = `reg_${pad(seriesNum, 3)}`;
    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      const dow = dayOfWeekFromIso(date);
      const startTime =
        series.homeAway === "Home"
          ? homeStartTime(rng)
          : awayStartTimeFor(series.opponent.league_division, rng);
      const variant = pickFromMix(rng, IN_GAME_VARIANT_MIX);

      // Format/simulcast: ~5% Expanded/Simulcast, slight weekend lean.
      const weekendNight =
        dow === "Sun" || (dow === "Sat" && Number(startTime.slice(0, 2)) >= 17)
          ? 1.2
          : 0.95;
      const isSimulcast = rng() < SIMULCAST_PROB_REG * weekendNight;
      const fmt: Format = isSimulcast ? "Expanded" : "Standard";
      const simulcastTag: Simulcast = isSimulcast ? "Simulcast" : "Exclusive";
      const networkPartner = isSimulcast
        ? pickFromMix(rng, NETWORK_PARTNER_MIX)
        : null;

      games.push({
        game_id: `g_${pad(gameId)}`,
        air_date: date,
        day_of_week: dow,
        start_time: startTime,
        start_minute_mod_30: startMinuteMod30(startTime),
        in_game_variant: variant,
        season_phase: "REG",
        opponent_id: series.opponent.opponent_id,
        opponent_name: series.opponent.name,
        home_away: series.homeAway,
        matchup_tier: series.opponent.matchup_tier,
        format: fmt,
        simulcast: simulcastTag,
        network_partner: networkPartner,
        broadcast_month: monthName(date),
        broadcast_year: DEMO_YEAR,
        broadcast_qtr: quarterOf(date) as "Q1" | "Q2" | "Q3",
        week_start: mondayOfWeek(date),
        series_id: seriesId,
        series_game_num: (i + 1) as 1 | 2 | 3 | 4,
      });
      gameId += 1;
    }
  }
  return games;
}

export function buildSchedule(opponents: Opponent[]): Game[] {
  const rng = rngFor("schedule");
  const pr = buildPRSchedule(rng, opponents);
  const reg = buildREGSchedule(rng, opponents, pr.length + 1);
  const all = [...pr, ...reg];
  // Sort overall by date for stable game_id ordering, then re-id.
  all.sort((a, b) => (a.air_date < b.air_date ? -1 : 1));
  return all.map((g, i) => ({ ...g, game_id: `g_${pad(i + 1)}` }));
}

export function run(): void {
  const opponents = readJson<Opponent[]>("opponents.json");
  const games = buildSchedule(opponents);
  writeJson("games.json", games);
  const pr = games.filter((g) => g.season_phase === "PR").length;
  const reg = games.filter((g) => g.season_phase === "REG").length;
  console.log(`games.json: ${games.length} rows (${pr} PR + ${reg} REG)`);
}

if (require.main === module) run();
