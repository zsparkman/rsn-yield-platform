// Generates data/schedule.csv in the same shape as the
// 2026 Dodgers Master Game Schedule.xlsx (10 columns, exported as CSV).
//
// 25 PR + 145 REG = 170 games. Sentinels is the home team; opponents are
// real MLB teams from _opponents.ts. Calibration carried over from the
// pre-migration generator: DoW distribution, simulcast share, regional
// share, In Game variant split.

import {
  DEMO_YEAR,
  addDays,
  dayNameFull,
  dayOfWeekFromIso,
  isoDate,
  isoToUSDate,
  pad,
  pickFromMix,
  pickWeighted,
  rngFor,
  shuffle,
  writeCsv,
} from "./_shared";
import { OPPONENTS, HOME_TEAM, isRegional } from "./_opponents";
import type { DayOfWeek, RawScheduleRow } from "../../src/lib/types";

const PR_GAMES = 25;
const REG_GAMES = 145;

const PR_START = isoDate(DEMO_YEAR, 2, 21);
const REG_START = isoDate(DEMO_YEAR, 3, 27);
const REG_END = isoDate(DEMO_YEAR, 9, 28);

// REG-phase target distribution from the spec validation table.
const DOW_PLAY_RATE: Record<DayOfWeek, number> = {
  Sat: 0.943,
  Fri: 0.916,
  Tue: 0.896,
  Sun: 0.888,
  Wed: 0.853,
  Mon: 0.563,
  Thu: 0.470,
};

const SIMULCAST_PROB_REG = 0.05;
const NETWORK_PARTNER_MIX = {
  "MLBN (Confirmed Share)": 0.30,
  "TBS (Confirmed Share)": 0.25,
  "ESPN (Confirmed Share)": 0.25,
  "FS1 (Confirmed Share)": 0.20,
};

// Pacific-time start mixes. Home games skew night; away depends on opponent TZ.
// Need a mix of minute offsets for In Game variant (-/baseline/+) per the
// half-hour-modulo rule (<8 = -, 8–14 = baseline, >14 = +).
const HOME_TIME_MIX = {
  "7:10pm": 0.40,
  "7:05pm": 0.07,    // → In Game-
  "7:25pm": 0.10,    // → In Game+
  "7:40pm": 0.05,    // → In Game+
  "1:10pm": 0.10,
  "1:05pm": 0.04,    // → In Game-
  "6:10pm": 0.06,
  "6:25pm": 0.05,    // → In Game+
  "4:10pm": 0.05,
  "4:05pm": 0.03,    // → In Game-
  "4:40pm": 0.03,    // → In Game+
  "12:10pm": 0.02,
};

const PR_TIME_MIX = {
  "1:10pm": 0.32,
  "12:10pm": 0.28,
  "5:10pm": 0.12,
  "1:05pm": 0.10,
  "12:05pm": 0.08,
  "6:10pm": 0.05,
  "1:20pm": 0.03,    // → In Game+
  "5:20pm": 0.02,    // → In Game+
};

const EAST_AWAY_MIX = { "4:10pm": 0.6, "4:05pm": 0.15, "4:07pm": 0.10, "4:20pm": 0.10, "4:40pm": 0.05 };
const CENTRAL_AWAY_MIX = { "5:10pm": 0.7, "5:20pm": 0.10, "5:40pm": 0.05, "1:10pm": 0.15 };
const MOUNTAIN_AWAY_MIX = { "6:10pm": 0.7, "6:20pm": 0.10, "6:40pm": 0.05, "1:10pm": 0.15 };
const WEST_AWAY_MIX = { "7:10pm": 0.7, "7:20pm": 0.10, "7:40pm": 0.05, "1:10pm": 0.15 };

function awayTimeFor(division: string, rng: () => number): string {
  if (division.startsWith("AL East") || division === "NL East") return pickFromMix(rng, EAST_AWAY_MIX);
  if (division.includes("Central")) return pickFromMix(rng, CENTRAL_AWAY_MIX);
  if (division === "NL West" || division === "AL West") return pickFromMix(rng, WEST_AWAY_MIX);
  return pickFromMix(rng, MOUNTAIN_AWAY_MIX);
}

function timeMinute(text: string): number {
  // "12:10pm" → 10
  const m = text.match(/^\d{1,2}:(\d{2})/);
  return m ? Number(m[1]) : 10;
}

interface SeriesPlan {
  opponent: typeof OPPONENTS[number];
  length: number; // 3 or 4
  homeAway: "Home" | "Away";
}

function buildSeriesPlan(rng: () => number): SeriesPlan[] {
  const regionalTeams = OPPONENTS.filter((o) => o.matchup === "Regional");
  const standardTeams = OPPONENTS.filter((o) => o.matchup === "Standard");

  // Regional: 18 series total, ~57 games (15 × 3-game + 3 × 4-game).
  const regional: SeriesPlan[] = [];
  for (const r of regionalTeams) {
    regional.push({ opponent: r, length: 4, homeAway: "Home" });
    for (let i = 0; i < 5; i += 1) {
      regional.push({ opponent: r, length: 3, homeAway: "Home" });
    }
  }

  // Standard: 29 series total, ~88 games (28 × 3-game + 1 × 4-game).
  // Pick 11 standard teams to play 2.6 series each on average (some 2, some 3).
  const stdShuffled = shuffle(rng, standardTeams).slice(0, 11);
  const seriesCounts = [3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2]; // sums to 29
  const standard: SeriesPlan[] = [];
  let fourGameUsed = false;
  for (let i = 0; i < stdShuffled.length; i += 1) {
    for (let j = 0; j < seriesCounts[i]; j += 1) {
      let len = 3;
      if (!fourGameUsed && i === 0 && j === 0) {
        len = 4;
        fourGameUsed = true;
      }
      standard.push({ opponent: stdShuffled[i], length: len, homeAway: "Home" });
    }
  }

  // Half home / half away per opponent.
  const all: SeriesPlan[] = [...regional, ...standard];
  const grouped = new Map<string, SeriesPlan[]>();
  for (const s of all) {
    const k = s.opponent.name;
    const list = grouped.get(k) ?? [];
    list.push(s);
    grouped.set(k, list);
  }
  for (const list of grouped.values()) {
    const sh = shuffle(rng, list);
    const half = Math.floor(sh.length / 2);
    for (let i = 0; i < half; i += 1) sh[i].homeAway = "Away";
    if (sh.length % 2 === 1) {
      sh[half].homeAway = rng() < 0.5 ? "Home" : "Away";
    }
  }
  return all;
}

function orderByBlocks(rng: () => number, series: SeriesPlan[]): SeriesPlan[] {
  const homePool = shuffle(rng, series.filter((s) => s.homeAway === "Home"));
  const awayPool = shuffle(rng, series.filter((s) => s.homeAway === "Away"));
  const ordered: SeriesPlan[] = [];
  let nextSide: "Home" | "Away" = rng() < 0.5 ? "Home" : "Away";
  while (homePool.length || awayPool.length) {
    const pool = nextSide === "Home" ? homePool : awayPool;
    const otherPool = nextSide === "Home" ? awayPool : homePool;
    if (!pool.length) {
      nextSide = nextSide === "Home" ? "Away" : "Home";
      continue;
    }
    const targetGames = 6 + Math.floor(rng() * 5);
    let inBlock = 0;
    while (pool.length && inBlock < targetGames) {
      const s = pool.shift()!;
      ordered.push(s);
      inBlock += s.length;
      if (pool[0] && inBlock + pool[0].length > targetGames + 1 && otherPool.length) break;
    }
    nextSide = nextSide === "Home" ? "Away" : "Home";
  }
  return ordered;
}

function placeSeriesOnCalendar(
  rng: () => number,
  series: SeriesPlan[],
): Array<{ series: SeriesPlan; dates: string[] }> {
  // First, pick which calendar days are play-days vs off-days (per DoW rate).
  const playDays: string[] = [];
  let cursor = REG_START;
  while (cursor <= REG_END) {
    const dow = dayOfWeekFromIso(cursor);
    if (rng() < DOW_PLAY_RATE[dow]) playDays.push(cursor);
    cursor = addDays(cursor, 1);
  }

  // Bring the play-day count exactly to REG_GAMES by trimming or adding edges.
  while (playDays.length > REG_GAMES) {
    // Drop a random play-day. Don't bias against Mon/Thu — the
    // play-rate already accounts for those being lighter.
    const i = Math.floor(rng() * playDays.length);
    playDays.splice(i, 1);
  }
  while (playDays.length < REG_GAMES) {
    // Find a non-play-day adjacent to existing play-days; convert to play-day.
    cursor = REG_START;
    let added = false;
    while (cursor <= REG_END && !added) {
      if (!playDays.includes(cursor)) {
        playDays.push(cursor);
        playDays.sort();
        added = true;
      }
      cursor = addDays(cursor, 1);
    }
    if (!added) break;
  }

  // Group consecutive play-days into runs.
  const runs: string[][] = [];
  let cur: string[] = [];
  for (let i = 0; i < playDays.length; i += 1) {
    const d = playDays[i];
    if (i === 0 || addDays(playDays[i - 1], 1) !== d) {
      if (cur.length) runs.push(cur);
      cur = [d];
    } else {
      cur.push(d);
    }
  }
  if (cur.length) runs.push(cur);

  // Take series.length consecutive days from runs.
  const placed: Array<{ series: SeriesPlan; dates: string[] }> = [];
  let runIdx = 0;
  let runOff = 0;
  function nextDate(): string | null {
    while (runIdx < runs.length) {
      const run = runs[runIdx];
      if (runOff < run.length) {
        const d = run[runOff];
        runOff += 1;
        return d;
      }
      runIdx += 1;
      runOff = 0;
    }
    return null;
  }
  for (const s of series) {
    const dates: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const d = nextDate();
      if (!d) {
        throw new Error(
          `Calendar exhausted at series ${s.opponent.name}; placed ${placed.length}/${series.length}`,
        );
      }
      dates.push(d);
    }
    placed.push({ series: s, dates });
  }
  placed.sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));
  return placed;
}

// PR phase: 25 games starting Feb 21, mostly day games, "ST" notation.
function buildPRRows(rng: () => number): RawScheduleRow[] {
  const regionalTeams = OPPONENTS.filter((o) => o.matchup === "Regional");
  const standardTeams = OPPONENTS.filter((o) => o.matchup === "Standard");
  const slots = [
    ...regionalTeams.flatMap((r) => [r, r]),               // 6 regional
    ...shuffle(rng, standardTeams).slice(0, 19),           // 19 standard
  ];
  const opponentOrder = shuffle(rng, slots);

  const rows: RawScheduleRow[] = [];
  let cursor = PR_START;
  let placed = 0;
  let oppIdx = 0;
  while (placed < PR_GAMES && cursor < REG_START) {
    const dow = dayOfWeekFromIso(cursor);
    let play = true;
    if (dow === "Mon") play = rng() < 0.55;
    else if (dow === "Thu") play = rng() < 0.5;
    else play = rng() < 0.92;

    if (play) {
      const opp = opponentOrder[oppIdx % opponentOrder.length];
      oppIdx += 1;
      const homeAway = rng() < 0.55 ? "Home" : "Away";
      const time = pickFromMix(rng, PR_TIME_MIX);
      const opponentLabel = `${homeAway === "Home" ? "vs." : "at"} ${opp.name}`;
      const formatLabel = homeAway === "Home"
        ? "ST Home Standard -- 6423"
        : pickWeighted(rng, ["ST Away Standard -- 5425", "ST Away 1A -- 6422"], [0.55, 0.45]);
      placed += 1;
      rows.push({
        "#": `PRE ${placed}`,
        DAY: dayNameFull(cursor),
        DATE: isoToUSDate(cursor),
        TIME: time,
        OPPONENT: opponentLabel,
        TV: "SNLA",
        "OTHER TV": "",
        NOTES: "",
        FORMAT: formatLabel,
        "SQUEEZE PLAY BUG": `${cursor.slice(5, 7)}/${cursor.slice(8, 10)} ${homeAway === "Home" ? "vs." : "@"} ${opp.name.slice(0, 3).toUpperCase()}`,
      });
    }
    cursor = addDays(cursor, 1);
  }
  if (placed < PR_GAMES) {
    throw new Error(`PR underbuild: placed ${placed} of ${PR_GAMES}`);
  }
  return rows;
}

function buildREGRows(rng: () => number): RawScheduleRow[] {
  const plan = buildSeriesPlan(rng);
  const ordered = orderByBlocks(rng, plan);
  const placed = placeSeriesOnCalendar(rng, ordered);

  const rows: RawScheduleRow[] = [];
  let regNum = 0;
  for (const { series, dates } of placed) {
    for (let i = 0; i < dates.length; i += 1) {
      const d = dates[i];
      const dow = dayOfWeekFromIso(d);
      const isHome = series.homeAway === "Home";
      const time = isHome ? pickFromMix(rng, HOME_TIME_MIX) : awayTimeFor(series.opponent.division, rng);
      const opponentLabel = `${isHome ? "vs." : "at"} ${series.opponent.name}`;

      // Simulcast: small chance, biased toward weekend nights / Sundays.
      const weekendNight =
        dow === "Sun" ||
        (dow === "Sat" && (timeMinute(time) >= 0 && time.includes("pm") && Number(time.split(":")[0]) >= 4))
          ? 1.2
          : 0.95;
      const isSimulcast = rng() < SIMULCAST_PROB_REG * weekendNight;
      const otherTv = isSimulcast ? pickFromMix(rng, NETWORK_PARTNER_MIX) : "";
      const notes = isSimulcast && otherTv.includes("ESPN") ? "NOT Blacked out Locally" : "";

      const formatLabel = isHome
        ? (isSimulcast ? "Home Expanded -- Traffic Manual" : "Home Standard -- 5421")
        : (isSimulcast ? "Away Expanded -- Traffic Manual" : "Away Standard -- 5422");

      regNum += 1;
      rows.push({
        "#": `${regNum}`,
        DAY: dayNameFull(d),
        DATE: isoToUSDate(d),
        TIME: time,
        OPPONENT: opponentLabel,
        TV: "SNLA",
        "OTHER TV": otherTv,
        NOTES: notes,
        FORMAT: formatLabel,
        "SQUEEZE PLAY BUG": `${d.slice(5, 7)}/${d.slice(8, 10)} ${isHome ? "vs." : "@"} ${series.opponent.name.slice(0, 3).toUpperCase()}`,
      });
    }
  }
  return rows;
}

export function buildSchedule(): RawScheduleRow[] {
  const rng = rngFor("schedule");
  const pr = buildPRRows(rng);
  const reg = buildREGRows(rng);
  return [...pr, ...reg];
}

export function run(): void {
  const rows = buildSchedule();
  const cols = [
    "#", "DAY", "DATE", "TIME", "OPPONENT",
    "TV", "OTHER TV", "NOTES", "FORMAT", "SQUEEZE PLAY BUG",
  ] as const;
  writeCsv("schedule.csv", cols, rows as unknown as Record<string, unknown>[]);
  const pr = rows.filter((r) => r["#"].startsWith("PRE")).length;
  const reg = rows.length - pr;
  console.log(`schedule.csv: ${rows.length} rows (${pr} PR + ${reg} REG)`);
}

if (require.main === module) run();
void HOME_TEAM;
void isRegional;
void pad;
