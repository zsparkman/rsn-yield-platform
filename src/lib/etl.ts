// ETL — re-implements the M chain from docs/reference/SNLA_Dodgers_Snapshot.txt
// in idiomatic TypeScript. Five named functions correspond to the M queries:
//
//   deriveSpots()           ←  Lakers Spot Data 19-22
//   deriveSchedule()        ←  Lakers Combined Schedules
//   deriveSpotsByClient()   ←  Lakers by Client (Inc $0)
//   deriveInventory()       ←  Inventory (Exc $0) / Inventory (Inc $0)
//   deriveAurSummary()      ←  AUR Summary
//
// Each function takes typed input and produces typed output. Joins use
// Map<string, T> on tuple keys instead of literal "SPOT KEY" / "Avails Key"
// columns; the join keys remain visible on outputs for parity with the M
// schema and for the contracts validator.

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import type {
  AurSummaryRow,
  BroadcastQuarter,
  EnrichedScheduleRow,
  EnrichedSpot,
  Format,
  InGameWithVariant,
  InventoryGroup,
  InventoryRollupRow,
  MatchupTier,
  RateInventoryType,
  RateTier,
  RawInventoryCapRow,
  RawRateCardRow,
  RawScheduleRow,
  RawSpot,
  SeasonPhase,
  Simulcast,
  SpotGridCell,
  SpotGroupKind,
  SpotsByClientRow,
} from "./types";

// ============================================================================
// File loaders
// ============================================================================

// Resolve relative to process.cwd(). Next.js runs both `next dev` and
// `next build` from the project root, so this lands on /<project>/data.
// __dirname doesn't work here — the bundler relocates the module to .next/.
const DATA_DIR = path.join(process.cwd(), "data");

export interface EtlInputs {
  spots: RawSpot[];
  schedule: RawScheduleRow[];
  inventoryCapacity: RawInventoryCapRow[];
  rateCard: RawRateCardRow[];
}

export interface EtlOutputs {
  spots: EnrichedSpot[];
  schedule: EnrichedScheduleRow[];
  spotsByClient: SpotsByClientRow[];
  inventoryExc0: InventoryRollupRow[];
  inventoryInc0: InventoryRollupRow[];
  aurSummary: AurSummaryRow[];
  spotGrid: SpotGridCell[];
}

// ---- CSV: minimal, comma-only, supports quoted fields with embedded quotes ----

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ""; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.length === 1 && r[0] === "") continue;
    const o: Record<string, string> = {};
    header.forEach((col, idx) => { o[col] = r[idx] ?? ""; });
    out.push(o);
  }
  return out;
}

export function parseSpotsCsv(text: string): RawSpot[] {
  const rows = parseCsv(text);
  return rows.map((r) => ({
    ChannelName: r.ChannelName,
    AdvertiserName: r.AdvertiserName,
    RevenueCode2: r.RevenueCode2,
    OrderNumber: r.OrderNumber === "" ? null : Number(r.OrderNumber),
    LineNumber: r.LineNumber === "" ? null : Number(r.LineNumber),
    SpotNumber: r.SpotNumber === "" ? null : Number(r.SpotNumber),
    SpotLength: Number(r.SpotLength),
    SpotRate: Number(r.SpotRate),
    SpotState: r.SpotState as RawSpot["SpotState"],
    PriorityCode: r.PriorityCode,
    AirDate: r.AirDate,
    AirTime1: r.AirTime1,
    InventoryCodeBooked: r.InventoryCodeBooked,
    PathBooked: r.PathBooked,
    InventoryCodePlaced: r.InventoryCodePlaced,
    PathPlaced: r.PathPlaced,
    TimePeriod: r.TimePeriod,
    AEFullName: r.AEFullName,
    ProductCode: r.ProductCode,
    ParentProductCode: r.ParentProductCode,
    DemoCode: r.DemoCode,
    BookedRating: Number(r.BookedRating || "0"),
    BookedImpressions: Number(r.BookedImpressions || "0"),
    UnitCode: r.UnitCode,
    CPP: r.CPP === "" ? null : Number(r.CPP),
    TotalEquivSold: Number(r.TotalEquivSold || "0"),
    EffectiveUnitRate: Number(r.EffectiveUnitRate || "0"),
    UnitAirStatusCode: r.UnitAirStatusCode,
    InventoryType: r.InventoryType as RawSpot["InventoryType"],
  }));
}

export function parseScheduleCsv(text: string): RawScheduleRow[] {
  const rows = parseCsv(text);
  return rows.map((r) => ({
    "#": r["#"],
    DAY: r.DAY,
    DATE: r.DATE,
    TIME: r.TIME,
    OPPONENT: r.OPPONENT,
    TV: r.TV,
    "OTHER TV": r["OTHER TV"],
    NOTES: r.NOTES,
    FORMAT: r.FORMAT,
    "SQUEEZE PLAY BUG": r["SQUEEZE PLAY BUG"],
  }));
}

// Note on xlsx + Next.js: XLSX.readFile() doesn't survive the Next.js
// bundler (xlsx's `fs` reference gets shimmed out). Use fs.readFileSync
// + XLSX.read(buffer) instead — works in both Node-only contexts (the
// generator) and bundled server contexts (App Router server components).
export function parseInventoryCapacityXlsx(filePath: string): RawInventoryCapRow[] {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  return json.map((r) => ({
    Syscode: Number(r.Syscode),
    Team: String(r.Team),
    Type: r.Type as SeasonPhase,
    Inventory: r.Inventory as RawInventoryCapRow["Inventory"],
    Format: r.Format as Format,
    Avails: Number(r.Avails),
  })).filter((r) => r.Team === "Sentinels");
}

export function parseRateCardXlsx(filePath: string): RawRateCardRow[] {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  return json.map((r) => ({
    Syscode: Number(r.Syscode),
    Net: String(r.Net),
    Team: String(r.Team),
    Type: r.Type as SeasonPhase,
    Inv: r.Inv as RateInventoryType,
    Matchup: r.Matchup as MatchupTier,
    Tier: r.Tier as RateTier,
    Rate: Number(r.Rate),
  })).filter((r) => r.Team === "Sentinels");
}

export function loadSources(dataDir = DATA_DIR): EtlInputs {
  return {
    spots: parseSpotsCsv(fs.readFileSync(path.join(dataDir, "spots.csv"), "utf-8")),
    schedule: parseScheduleCsv(fs.readFileSync(path.join(dataDir, "schedule.csv"), "utf-8")),
    inventoryCapacity: parseInventoryCapacityXlsx(path.join(dataDir, "inventory_capacity.xlsx")),
    rateCard: parseRateCardXlsx(path.join(dataDir, "rate_card.xlsx")),
  };
}

// ============================================================================
// Helpers
// ============================================================================

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function quarterOfMonth(monthName: string): BroadcastQuarter {
  const m = MONTHS.indexOf(monthName) + 1;
  if (m <= 3) return "Q1";
  if (m <= 6) return "Q2";
  if (m <= 9) return "Q3";
  return "Q4";
}

export function isoFromUSDate(us: string): string {
  if (!us) return "";
  const [m, d, y] = us.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function monthOfIso(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1];
}

function yearOfIso(iso: string): number {
  return Number(iso.slice(0, 4));
}

function startMinute(time24OrStartObj: string | Date): number {
  if (time24OrStartObj instanceof Date) return time24OrStartObj.getMinutes();
  // "HH:MM" 24h
  const m = time24OrStartObj.match(/^\d{1,2}:(\d{2})/);
  return m ? Number(m[1]) : 0;
}

function startHourFrom12h(time12: string): { hour: number; minute: number } {
  const m = time12.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return { hour: 19, minute: 10 };
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ap = m[3].toLowerCase();
  if (ap === "pm" && hour !== 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function to24hHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const REGIONAL_TEAMS = ["Giants", "Padres", "Angels"];

function matchupOf(opponentLabel: string): MatchupTier {
  return REGIONAL_TEAMS.some((t) => opponentLabel.includes(t)) ? "Regional" : "Standard";
}

function expandedFor(rawFormat: string, eventProgram: string): Format {
  const isExpanded = /Expanded/i.test(rawFormat);
  const isDH = /DH/i.test(eventProgram);
  if (isExpanded && isDH) return "Expanded DH";
  if (isExpanded) return "Expanded";
  if (isDH) return "DH";
  return "Standard";
}

// ============================================================================
// 1. deriveSpots — Lakers Spot Data 19-22
// ============================================================================

function classifyInvFromPath(path: string): InventoryGroup {
  if (/Galaxy|Sparks/.test(path)) return "Ancillary";
  if (/In ?Game/.test(path)) return "In Game";
  if (/Pregame/.test(path)) return "Pregame";
  if (/Postgame/.test(path)) return "Postgame";
  return "Ancillary";
}

function classifyInvFromPathPlaced(pathPlaced: string, spotState: string): string {
  if (/Galaxy|Sparks/.test(pathPlaced)) return "Ancillary";
  if (/Re-air/.test(pathPlaced)) return "Ancillary";
  // M code: when PathPlaced is " " (whitespace, was empty), use SpotState as the value.
  if (pathPlaced.trim() === "") return spotState;
  if (/In ?Game/.test(pathPlaced)) return "In Game";
  if (/Pregame/.test(pathPlaced)) return "Pregame";
  if (/Postgame/.test(pathPlaced)) return "Postgame";
  return "Ancillary";
}

function resolveInventoryType(
  invBooked: InventoryGroup,
  invPlaced: string,
  spotState: string,
): InventoryGroup {
  if (spotState === "Placed" && invPlaced === "Placed") return invBooked;
  if (spotState === "Placed") return invPlaced as InventoryGroup;
  return invBooked;
}

function bookedDisplayStatus(spotState: string, invBooked: InventoryGroup, invPlaced: string): "As Booked" | "As Placed" {
  if (spotState !== "Placed") return "As Booked";
  return invPlaced === invBooked ? "As Booked" : "As Placed";
}

function postSuffixFromPaths(pathPlaced: string, pathBooked: string): string | null {
  for (const p of [pathPlaced, pathBooked]) {
    if (/PR/.test(p)) return ".PR";
    if (/Regular Season/.test(p)) return ".REG";
    if (/PS/.test(p)) return ".PS";
  }
  return null;
}

function postCodeFinal(rawPostCode: string): string {
  if (/Sparks/.test(rawPostCode)) return "ROS";
  if (/Pregame|In Game|Postgame/.test(rawPostCode)) return rawPostCode.replace(" Premiere", "");
  if (rawPostCode === "Backstage Lakers Premiere") return "Backstage Lakers";
  if (/Lakers Compacto|Laker Encore/.test(rawPostCode)) return rawPostCode.replace(" Premiere", "");
  return "ROS";
}

export function deriveSpots(spots: RawSpot[]): EnrichedSpot[] {
  const out: EnrichedSpot[] = [];
  for (const s of spots) {
    if (s.OrderNumber == null || String(s.OrderNumber).trim() === "") continue; // M filter
    const pathPlaced = (s.PathPlaced ?? "").trim() === "" ? " " : s.PathPlaced;
    const invBooked = classifyInvFromPath(s.PathBooked || "");
    const invPlaced = classifyInvFromPathPlaced(pathPlaced, s.SpotState);
    const invType = resolveInventoryType(invBooked, invPlaced, s.SpotState);
    const displayStatus = bookedDisplayStatus(s.SpotState, invBooked, invPlaced);
    const postInvCode =
      invType !== "Ancillary"
        ? invType
        : (s.InventoryCodePlaced ?? "").trim() !== ""
          ? s.InventoryCodePlaced
          : s.InventoryCodeBooked;
    const suffix = postSuffixFromPaths(pathPlaced, s.PathBooked) ?? "";
    const postCodeRaw = postInvCode + suffix;
    const postCode = postCodeFinal(postCodeRaw);
    const airDateIso = isoFromUSDate(s.AirDate);
    const month = monthOfIso(airDateIso);
    const year = yearOfIso(airDateIso);
    const qtr = quarterOfMonth(month);
    const period: EnrichedSpot["period"] =
      qtr === "Q4" ? "4Q" : qtr === "Q1" || qtr === "Q2" ? "1-2Q" : null;
    out.push({
      ...s,
      inventory_type_booked: invBooked,
      inventory_type_placed: invPlaced,
      inventory_type: invType,
      spot_rate_net: Math.round(s.SpotRate * 0.85 * 100) / 100,
      booked_display_status: displayStatus,
      post_inv_code: postInvCode,
      post_code: postCode,
      post_key: `${postCode}.${s.DemoCode}`,
      spot_key: `${s.AirDate}.${invType}`,
      air_date_iso: airDateIso,
      broadcast_month: month,
      broadcast_year: year,
      broadcast_qtr: qtr,
      period,
      booked_impressions_thousands: s.BookedImpressions / 1000,
      fl_flag: (s.InventoryCodePlaced || "").includes("Timeout") ? "FL" : "P",
      hts_flag: (s.AEFullName || "").includes("HomeTeamSports") ? "HTS" : "Non-HTS",
    });
  }
  return out;
}

// ============================================================================
// 2. deriveSchedule — Lakers Combined Schedules
// ============================================================================

function plusMinusFor(invType: RateInventoryType, hourMinute24: { hour: number; minute: number }): "+" | "-" | null {
  if (invType !== "In Game") return null;
  const half = hourMinute24.minute % 30;
  if (half < 8) return "-";
  if (half > 14) return "+";
  return null;
}

export function deriveSchedule(rows: RawScheduleRow[]): EnrichedScheduleRow[] {
  const out: EnrichedScheduleRow[] = [];
  for (const r of rows) {
    if (r["#"] == null || r["#"].trim() === "") continue;        // OFF DAY filter
    if (r.TIME === "OFF DAY") continue;
    if (r.TV.includes("(Confirmed Exclusive)")) continue;
    const dateIso = isoFromUSDate(r.DATE);
    if (dateIso && new Date(`${dateIso}T00:00:00Z`).getTime() <= new Date("2019-12-29T00:00:00Z").getTime()) continue;
    const type2: SeasonPhase = r["#"].includes("PRE") ? "PR" : "REG";
    const hm = startHourFrom12h(r.TIME);
    const start24 = to24hHHMM(hm.hour, hm.minute);
    const matchup = matchupOf(r.OPPONENT);
    const expanded = expandedFor(r.FORMAT, "");
    const titlePrefix = type2 === "PR" ? "PR: " : "";
    const evt = `${titlePrefix}Sentinels ${r.OPPONENT}`;
    const month = monthOfIso(dateIso);
    const year = yearOfIso(dateIso);
    const qtr = quarterOfMonth(month);
    const simulcast: Simulcast = (r["OTHER TV"] ?? "").trim() === "" ? "Exclusive" : "Simulcast";

    for (const inv of ["Pregame", "In Game", "Postgame"] as RateInventoryType[]) {
      const variantSign = plusMinusFor(inv, hm);
      const invType1 = inv === "In Game"
        ? (variantSign === "-" ? "In Game-" : variantSign === "+" ? "In Game+" : "In Game")
        : inv;
      const ns: "Spectrum" | "NonSpectrum" = r.TV !== "SNLA" ? "NonSpectrum" : "Spectrum";
      const nsAnc = `${ns}.${inv}`;
      if (nsAnc === "NonSpectrum.In Game") continue; // M filter
      const avails_key = ["Sentinels", type2, invType1, expanded].join(".");
      const spot_key = `${r.DATE}.${inv}`;
      const net = "SNLA";
      const ndt = `${net}.${r.DATE}.${r.TIME.toUpperCase()}`;

      out.push({
        "#": r["#"],
        DAY: r.DAY,
        DATE: dateIso,
        START: start24,
        OPPONENT: r.OPPONENT,
        TV: r.TV,
        "OTHER TV": (r["OTHER TV"] ?? "").trim() === "" ? null : r["OTHER TV"],
        NOTES: r.NOTES === "" ? null : r.NOTES,
        FORMAT: r.FORMAT,
        EVENT_PROGRAM: evt,
        TYPE: "Sentinels",
        TYPE2: type2,
        SEASON: "26",
        NET: net,
        "NET.DATE.TIME": ndt,
        Simulcast: simulcast,
        Expanded: expanded,
        Matchup: matchup,
        "INV TYPE": inv,
        "+/-": variantSign,
        "INV TYPE.1": invType1 as InGameWithVariant | RateInventoryType,
        "Avails Key": avails_key,
        broadcast_month: month,
        broadcast_year: year,
        broadcast_qtr: qtr,
        NonSpectrum: ns,
        "NS-Ancillary": nsAnc,
        "SPOT KEY": spot_key,
      });
    }
  }
  return out;
}

// ============================================================================
// 3. deriveSpotsByClient — Lakers by Client (Inc $0)
// ============================================================================

interface IndexedSpots {
  byKey: Map<string, EnrichedSpot[]>;
}

function indexSpotsByKey(spots: EnrichedSpot[]): IndexedSpots {
  const byKey = new Map<string, EnrichedSpot[]>();
  for (const s of spots) {
    const k = `${s.AirDate}|${s.inventory_type}`;
    const list = byKey.get(k) ?? [];
    list.push(s);
    byKey.set(k, list);
  }
  return { byKey };
}

function todayUtc(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function deriveSpotsByClient(
  schedule: EnrichedScheduleRow[],
  spots: EnrichedSpot[],
): SpotsByClientRow[] {
  const idx = indexSpotsByKey(spots);
  const today = todayUtc();
  const out: SpotsByClientRow[] = [];
  for (const sched of schedule) {
    const key = `${isoToUSFormat(sched.DATE)}|${sched["INV TYPE"]}`;
    const matched = idx.byKey.get(key) ?? [];
    if (matched.length === 0) {
      out.push(makeSpotsByClientRow(sched, null, today));
    } else {
      for (const s of matched) {
        out.push(makeSpotsByClientRow(sched, s, today));
      }
    }
  }
  return out;
}

function isoToUSFormat(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function makeSpotsByClientRow(
  sched: EnrichedScheduleRow,
  s: EnrichedSpot | null,
  today: number,
): SpotsByClientRow {
  const air = s?.AirDate ?? "";
  const airTime = s ? new Date(`${s.air_date_iso}T00:00:00Z`).getTime() : 0;
  const afterToday: 0 | 1 = s && airTime > today ? 1 : 0;
  const spotRate = s?.SpotRate ?? 0;
  return {
    DATE: sched.DATE,
    EVENT_PROGRAM: sched.EVENT_PROGRAM,
    TYPE: sched.TYPE,
    TYPE2: sched.TYPE2,
    SEASON: sched.SEASON,
    "INV TYPE": sched["INV TYPE"],
    "+/-": sched["+/-"],
    "INV TYPE.1": sched["INV TYPE.1"],
    Matchup: sched.Matchup,
    Expanded: sched.Expanded,
    "Avails Key": sched["Avails Key"],
    "SPOT KEY": sched["SPOT KEY"],
    broadcast_month: sched.broadcast_month,
    broadcast_year: sched.broadcast_year,
    broadcast_qtr: sched.broadcast_qtr,

    "spot.AdvertiserName": s?.AdvertiserName ?? "",
    "spot.OrderNumber": s?.OrderNumber ?? 0,
    "spot.LineNumber": s?.LineNumber ?? 0,
    "spot.SpotLength": s?.SpotLength ?? 0,
    "spot.SpotRate": spotRate,
    "spot.SpotRate (Net)": s?.spot_rate_net ?? 0,
    "spot.SpotState": s?.SpotState ?? "",
    "spot.PriorityCode": s?.PriorityCode ?? "",
    "spot.AirDate": air,
    "spot.AEFullName": s?.AEFullName ?? "",
    "spot.DemoCode": s?.DemoCode ?? "",
    "spot.BookedRating": s?.BookedRating ?? 0,
    "spot.BookedImpressions": s?.BookedImpressions ?? 0,
    "spot.CPP": s?.CPP === 0 ? null : (s?.CPP ?? null),
    "spot.TotalEquivSold": s?.TotalEquivSold ?? 0,
    "spot.EffectiveUnitRate": s?.EffectiveUnitRate ?? 0,
    "spot.UnitAirStatusCode": s?.UnitAirStatusCode ?? "",
    "spot.InventoryType": s?.InventoryType ?? "",
    "spot.inventory_type": s?.inventory_type ?? "",
    "spot.fl_flag": s?.fl_flag ?? "",
    "spot.hts_flag": s?.hts_flag ?? "",

    $0: spotRate > 0 ? "Paid" : "$0",
    AfterToday: afterToday,
  };
}

// ============================================================================
// 4. deriveInventory — Inventory (Exc $0) / Inventory (Inc $0)
// ============================================================================

export interface InventoryOpts {
  include0: boolean; // true = Inc $0 variant; false = Exc $0
}

function inventoryAvailsLookup(caps: RawInventoryCapRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of caps) {
    const key = ["Sentinels", c.Type, c.Inventory, c.Format].join(".");
    m.set(key, c.Avails);
  }
  return m;
}

function rateLookup(card: RawRateCardRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of card) {
    const key = [r.Type, r.Inv, r.Matchup, r.Tier].join(".");
    m.set(key, r.Rate);
  }
  return m;
}

function rateTierForOversell(invType: string, oversellMSign: number): RateTier {
  // M sign convention: oversell = avails - sold. Positive = under primary cap.
  // After the Floaters A&B collapse, In Game capacity already includes the
  // first floater break; the FL band is the next 3 eq30 of contingent
  // capacity (second floater break, pitching-change-driven), beyond which
  // the rate jumps to Bump.
  if (invType === "In Game" || invType === "In Game+" || invType === "In Game-") {
    if (oversellMSign >= 0) return "Base";    // sold ≤ primary cap
    if (oversellMSign >= -3) return "FL";     // 0 < (sold − cap) ≤ 3
    return "Bump";                              // sold − cap > 3
  }
  return oversellMSign >= 0 ? "Base" : "Bump";
}

function rateInvFor(invType: string): RateInventoryType {
  if (invType.startsWith("In Game") || invType === "Floaters A&B") return "In Game";
  if (invType === "Pregame") return "Pregame";
  return "Postgame";
}

interface GroupedAgg {
  date: string;
  evtProgram: string;
  type2: SeasonPhase;
  invType1: string;          // "In Game", "In Game+", "In Game-", "Pregame", "Postgame"
  avails_key: string;
  broadcast_month: string;
  broadcast_year: number;
  season: string;
  matchup: MatchupTier;
  expanded: Format;
  sold: number;              // sum of TotalEquivSold across all spots (paid + non-paid)
  grossRev: number;          // sum of SpotRate (gross dollars; non-paid contribute 0)
  netRev: number;            // sum of SpotRate (Net) (net dollars)
  paidEq30: number;          // sum of TotalEquivSold for SpotRate > 0
  paidGross: number;         // sum of SpotRate for SpotRate > 0
  paidNet: number;           // sum of SpotRate (Net) for SpotRate > 0
  paidCount: number;         // count of paid spots
}

function aggregateForInventory(
  rows: SpotsByClientRow[],
  include0: boolean,
): Map<string, GroupedAgg> {
  const grouped = new Map<string, GroupedAgg>();
  for (const r of rows) {
    if (!include0 && r.$0 !== "Paid") continue;
    const inv1 = r["INV TYPE.1"];
    const key = [
      r.DATE, r.EVENT_PROGRAM, r.TYPE2, inv1, r["Avails Key"],
      r.broadcast_month, r.broadcast_year, r.SEASON, r.Matchup,
    ].join("||");
    const g = grouped.get(key) ?? {
      date: r.DATE,
      evtProgram: r.EVENT_PROGRAM,
      type2: r.TYPE2,
      invType1: String(inv1),
      avails_key: r["Avails Key"],
      broadcast_month: r.broadcast_month,
      broadcast_year: r.broadcast_year,
      season: r.SEASON,
      matchup: r.Matchup,
      expanded: r.Expanded,
      sold: 0,
      grossRev: 0,
      netRev: 0,
      paidEq30: 0,
      paidGross: 0,
      paidNet: 0,
      paidCount: 0,
    };
    g.sold += r["spot.TotalEquivSold"];
    g.grossRev += r["spot.SpotRate"];
    g.netRev += r["spot.SpotRate (Net)"];
    if (r["spot.SpotRate"] > 0) {
      g.paidEq30 += r["spot.TotalEquivSold"];
      g.paidGross += r["spot.SpotRate"];
      g.paidNet += r["spot.SpotRate (Net)"];
      g.paidCount += 1;
    }
    grouped.set(key, g);
  }
  return grouped;
}

export function deriveInventory(
  spotsByClient: SpotsByClientRow[],
  caps: RawInventoryCapRow[],
  rateCard: RawRateCardRow[],
  opts: InventoryOpts,
): InventoryRollupRow[] {
  const capLookup = inventoryAvailsLookup(caps);
  const rateLk = rateLookup(rateCard);
  const grouped = aggregateForInventory(spotsByClient, opts.include0);

  const out: InventoryRollupRow[] = [];
  const today = todayUtc();
  for (const g of grouped.values()) {
    const avails = capLookup.get(g.avails_key) ?? 0;
    const oversellMSign = avails - g.sold;

    // One row per (game, INV TYPE.1) — Pregame / In Game variant / Postgame.
    // The previous Floaters A&B unpivot is gone: In Game capacity already
    // includes the first floater break and the FL band lives in tier
    // resolution.
    const v = {
      inv: g.invType1,
      cap: avails,
      sold: g.sold,
    };

    const rateTier = rateTierForOversell(v.inv, oversellMSign);
    const rateKey = [g.type2, v.inv, g.matchup, rateTier].join(".");
    const rateInv = rateInvFor(v.inv);
    const rate = rateLk.get([g.type2, rateInv, g.matchup, rateTier].join(".")) ?? 0;

    const grossRev = g.grossRev;
    const netRev = g.netRev;
    // Volume-weighted unit-rate metrics. All in integer cents. Paid-only.
    const eur_gross_cents = g.paidEq30 <= 0
      ? 0
      : Math.round((g.paidGross / g.paidEq30) * 100);
    const eur_net_cents = g.paidEq30 <= 0
      ? 0
      : Math.round((g.paidNet / g.paidEq30) * 100);
    const aur_cents = g.paidCount <= 0
      ? 0
      : Math.round((g.paidNet / g.paidCount) * 100);

    const dateIso = g.date;
    const startWeek = startOfWeek(dateIso);
    const dateMillis = new Date(`${dateIso}T00:00:00Z`).getTime();

    const soldRounded = Math.round(v.sold * 100) / 100;
    out.push({
      DATE: dateIso,
      EVENT_PROGRAM: g.evtProgram,
      TYPE2: g.type2,
      "INV TYPE": v.inv as InventoryRollupRow["INV TYPE"],
      "Avails Key": g.avails_key,
      broadcast_month: g.broadcast_month,
      broadcast_year: g.broadcast_year,
      SEASON: g.season,
      Matchup: g.matchup,
      Format: g.expanded,
      Cap: v.cap,
      Sold: soldRounded,
      avail: Math.max(0, Math.round((v.cap - v.sold) * 100) / 100),
      Sellout: v.cap > 0 ? Math.round((v.sold / v.cap) * 10000) / 10000 : 0,
      Oversell: Math.round(oversellMSign * 100) / 100,
      "Rate Tier": rateTier,
      "Rate Key": rateKey,
      Rate: rate,
      current_rate_cents: Math.round(rate * 100),
      "Start of Week": startWeek,
      "Gross Rev": Math.round(grossRev * 100) / 100,
      "Net Rev": Math.round(netRev * 100) / 100,
      gross_rev_cents: Math.round(grossRev * 100),
      net_rev_cents: Math.round(netRev * 100),
      eur_gross_cents,
      eur_net_cents,
      aur_cents,
      AfterToday: dateMillis > today ? 1 : 0,
    });
  }
  return out;
}

// ============================================================================
// 5. deriveAurSummary — AUR Summary
// ============================================================================

type LobGroup = "HTS" | "Non-HTS";
type SpotGroup = "Paid" | "NC" | "ADU" | "Cross Property ADU" | "Bonus";

function spotGroupOf(r: SpotsByClientRow): SpotGroup | null {
  if (r.$0 === "Paid") return "Paid";
  const pc = r["spot.PriorityCode"];
  if (pc === "P-80") return "NC";
  if (pc === "P-19") return "NC";
  if (pc === "P-09") return "ADU";
  if (pc === "P-08") return "Cross Property ADU";
  if (pc === "P-04") return "Bonus";
  return null;
}

function lobGroupOf(r: SpotsByClientRow): LobGroup {
  return r["spot.AEFullName"]?.includes("HomeTeamSports") ? "HTS" : "Non-HTS";
}

interface AurBucket {
  // structural keys
  date: string;
  invType: string;          // INV TYPE.1 (no Floaters split, but with +/-)
  type2: SeasonPhase;
  season: string;
  broadcast_month: string;
  broadcast_year: number;
  broadcast_qtr: BroadcastQuarter;
  expanded: Format;
  primary_avails_key: string;
  // metric buckets
  hts: Record<SpotGroup, { eq30: number; gross: number; net: number; count: number }>;
  nonHts: Record<SpotGroup, { eq30: number; gross: number; net: number; count: number }>;
}

function emptyMetric() {
  return { eq30: 0, gross: 0, net: 0, count: 0 };
}

function emptySpotGroupMap(): Record<SpotGroup, { eq30: number; gross: number; net: number; count: number }> {
  return {
    Paid: emptyMetric(),
    NC: emptyMetric(),
    ADU: emptyMetric(),
    "Cross Property ADU": emptyMetric(),
    Bonus: emptyMetric(),
  };
}

export function deriveAurSummary(
  spotsByClient: SpotsByClientRow[],
  caps: RawInventoryCapRow[],
): AurSummaryRow[] {
  const capLookup = inventoryAvailsLookup(caps);
  const buckets = new Map<string, AurBucket>();

  for (const r of spotsByClient) {
    const group = spotGroupOf(r);
    if (group == null) continue;
    const lob = lobGroupOf(r);
    const invType = String(r["INV TYPE.1"]);
    const primaryAvailsKey = ["Sentinels", r.TYPE2, invType, r.Expanded].join(".");
    const k = [r.DATE, invType, r.TYPE2, r.SEASON, r.broadcast_year, r.broadcast_month, r.broadcast_qtr, r.Expanded].join("||");
    let b = buckets.get(k);
    if (!b) {
      b = {
        date: r.DATE,
        invType,
        type2: r.TYPE2,
        season: r.SEASON,
        broadcast_month: r.broadcast_month,
        broadcast_year: r.broadcast_year,
        broadcast_qtr: r.broadcast_qtr,
        expanded: r.Expanded,
        primary_avails_key: primaryAvailsKey,
        hts: emptySpotGroupMap(),
        nonHts: emptySpotGroupMap(),
      };
      buckets.set(k, b);
    }
    const bucket = lob === "HTS" ? b.hts[group] : b.nonHts[group];
    bucket.eq30 += r["spot.TotalEquivSold"];
    bucket.gross += r["spot.SpotRate"];
    bucket.net += r["spot.SpotRate (Net)"];
    bucket.count += 1;
  }

  const out: AurSummaryRow[] = [];
  for (const b of buckets.values()) {
    if (b.invType === "Floaters A&B") continue; // M filter
    const avails = capLookup.get(b.primary_avails_key) ?? 0;
    const htsTotal = (["Paid", "NC", "ADU", "Cross Property ADU", "Bonus"] as SpotGroup[])
      .reduce((s, g) => s + b.hts[g].eq30, 0);
    const nonHtsTotal = (["Paid", "NC", "ADU", "Cross Property ADU", "Bonus"] as SpotGroup[])
      .reduce((s, g) => s + b.nonHts[g].eq30, 0);
    const totalPaid = b.hts.Paid.eq30 + b.nonHts.Paid.eq30;
    const totalNC = b.hts.NC.eq30 + b.nonHts.NC.eq30;
    const totalADU = b.hts.ADU.eq30 + b.nonHts.ADU.eq30;
    const totalXADU = b.hts["Cross Property ADU"].eq30 + b.nonHts["Cross Property ADU"].eq30;
    const totalBonus = b.hts.Bonus.eq30 + b.nonHts.Bonus.eq30;
    const totalPaidGross = b.hts.Paid.gross + b.nonHts.Paid.gross;
    const totalPaidNet = b.hts.Paid.net + b.nonHts.Paid.net;
    const totalPaidCount = b.hts.Paid.count + b.nonHts.Paid.count;
    const sellout = avails > 0 ? (totalPaid + totalNC) / avails : 0;
    const selloutAdu = avails > 0 ? (totalPaid + totalNC + totalADU + totalXADU) / avails : 0;
    // Volume-weighted yield metrics for the AUR Report view (integer cents).
    const eur_net_cents = totalPaid > 0 ? Math.round((totalPaidNet / totalPaid) * 100) : 0;
    const aur_cents = totalPaidCount > 0 ? Math.round((totalPaidNet / totalPaidCount) * 100) : 0;
    out.push({
      SEASON: b.season,
      broadcast_year: b.broadcast_year,
      broadcast_qtr: b.broadcast_qtr,
      broadcast_month: b.broadcast_month,
      TYPE2: b.type2,
      DATE: b.date,
      "INV TYPE": b.invType as AurSummaryRow["INV TYPE"],
      "Primary Avails Key": b.primary_avails_key,
      "HTS Paid.EQ30": Math.round(b.hts.Paid.eq30 * 100) / 100,
      "HTS Paid.Gross REV": Math.round(b.hts.Paid.gross * 100) / 100,
      "HTS Paid.Net REV": Math.round(b.hts.Paid.net * 100) / 100,
      "HTS Paid.count": b.hts.Paid.count,
      "HTS NC.EQ30": Math.round(b.hts.NC.eq30 * 100) / 100,
      "HTS ADU.EQ30": Math.round(b.hts.ADU.eq30 * 100) / 100,
      "HTS Cross Property ADU.EQ30": Math.round(b.hts["Cross Property ADU"].eq30 * 100) / 100,
      "HTS Bonus.EQ30": Math.round(b.hts.Bonus.eq30 * 100) / 100,
      "Non-HTS Paid.EQ30": Math.round(b.nonHts.Paid.eq30 * 100) / 100,
      "Non-HTS Paid.Gross REV": Math.round(b.nonHts.Paid.gross * 100) / 100,
      "Non-HTS Paid.Net REV": Math.round(b.nonHts.Paid.net * 100) / 100,
      "Non-HTS Paid.count": b.nonHts.Paid.count,
      "Non-HTS NC.EQ30": Math.round(b.nonHts.NC.eq30 * 100) / 100,
      "Non-HTS ADU.EQ30": Math.round(b.nonHts.ADU.eq30 * 100) / 100,
      "Non-HTS Cross Property ADU.EQ30": Math.round(b.nonHts["Cross Property ADU"].eq30 * 100) / 100,
      "Non-HTS Bonus.EQ30": Math.round(b.nonHts.Bonus.eq30 * 100) / 100,
      "Total Paid.EQ30": Math.round(totalPaid * 100) / 100,
      "Total Paid.Gross REV": Math.round(totalPaidGross * 100) / 100,
      "Total Paid.Net REV": Math.round(totalPaidNet * 100) / 100,
      "Total NC.EQ30": Math.round(totalNC * 100) / 100,
      "Total ADU.EQ30": Math.round(totalADU * 100) / 100,
      "Total Cross Property ADU.EQ30": Math.round(totalXADU * 100) / 100,
      "Total Bonus.EQ30": Math.round(totalBonus * 100) / 100,
      "HTS Total.EQ30": Math.round(htsTotal * 100) / 100,
      "Non-HTS Total.EQ30": Math.round(nonHtsTotal * 100) / 100,
      "Total Total.EQ30": Math.round((htsTotal + nonHtsTotal) * 100) / 100,
      Avails: avails,
      Sellout: Math.round(sellout * 10000) / 10000,
      "Sellout + ADU": Math.round(selloutAdu * 10000) / 10000,
      eur_net_cents,
      aur_cents,
    });
  }
  // Stable order by date / inv type.
  out.sort((a, b) => {
    if (a.DATE !== b.DATE) return a.DATE < b.DATE ? -1 : 1;
    return a["INV TYPE"] < b["INV TYPE"] ? -1 : 1;
  });
  return out;
}

// ============================================================================
// Orchestrator
// ============================================================================

// Per-(client, date, inv_type, spot_group) eq30 aggregate. Pre-aggregated
// here so the Spot Grid view doesn't ship 18k spots to the client.
export function deriveSpotGrid(spots: EnrichedSpot[]): SpotGridCell[] {
  const tally = new Map<string, SpotGridCell>();
  for (const s of spots) {
    if (s.inventory_type !== "Pregame" && s.inventory_type !== "In Game" && s.inventory_type !== "Postgame") {
      continue; // Spot Grid view excludes Ancillary
    }
    const group: SpotGroupKind =
      s.SpotRate > 0 ? "Paid"
      : s.PriorityCode === "P-80" || s.PriorityCode === "P-19" ? "NC"
      : s.PriorityCode === "P-09" ? "ADU"
      : s.PriorityCode === "P-08" ? "xADU"
      : s.PriorityCode === "P-04" ? "Bonus"
      : "Other";
    const key = `${s.AdvertiserName}||${s.air_date_iso}||${s.inventory_type}||${group}`;
    const cell = tally.get(key);
    if (cell) {
      cell.eq30 += s.TotalEquivSold;
    } else {
      tally.set(key, {
        client: s.AdvertiserName,
        date: s.air_date_iso,
        inv_type: s.inventory_type as "Pregame" | "In Game" | "Postgame",
        group,
        eq30: s.TotalEquivSold,
      });
    }
  }
  // Round per-cell eq30 to 1 decimal for stable display.
  for (const cell of tally.values()) {
    cell.eq30 = Math.round(cell.eq30 * 10) / 10;
  }
  return Array.from(tally.values());
}

export function runEtl(inputs: EtlInputs): EtlOutputs {
  const spots = deriveSpots(inputs.spots);
  const schedule = deriveSchedule(inputs.schedule);
  const spotsByClient = deriveSpotsByClient(schedule, spots);
  const inventoryExc0 = deriveInventory(spotsByClient, inputs.inventoryCapacity, inputs.rateCard, { include0: false });
  const inventoryInc0 = deriveInventory(spotsByClient, inputs.inventoryCapacity, inputs.rateCard, { include0: true });
  const aurSummary = deriveAurSummary(spotsByClient, inputs.inventoryCapacity);
  const spotGrid = deriveSpotGrid(spots);
  return { spots, schedule, spotsByClient, inventoryExc0, inventoryInc0, aurSummary, spotGrid };
}
