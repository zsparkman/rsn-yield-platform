import seedrandom from "seedrandom";
import * as fs from "node:fs";
import * as path from "node:path";

export const TOP_SEED = "rsn-yield-platform-v1";
export const DEMO_YEAR = 2026;

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const REFERENCE_DIR = path.join(REPO_ROOT, "docs", "reference");

export type RNG = () => number;

export function rngFor(namespace: string): RNG {
  return seedrandom(`${TOP_SEED}:${namespace}`);
}

// Per-key RNG so a sub-routine's outcomes stay stable when unrelated
// upstream random calls change (e.g. floater fires per game).
export function rngForKey(namespace: string, key: string): RNG {
  return seedrandom(`${TOP_SEED}:${namespace}:${key}`);
}

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function writeText(filename: string, text: string): void {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, filename), text);
}

export function copyFromReference(filename: string, outName?: string): void {
  ensureDataDir();
  const src = path.join(REFERENCE_DIR, filename);
  const dst = path.join(DATA_DIR, outName ?? filename);
  fs.copyFileSync(src, dst);
}

// ------------------------------ random helpers ------------------------------

export function gaussian(rng: RNG, mean = 0, stdDev = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
}

export function clip(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function poisson(rng: RNG, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function pickWeighted<T>(rng: RNG, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickFromMix<K extends string>(rng: RNG, mix: Record<K, number>): K {
  const keys = Object.keys(mix) as K[];
  const weights = keys.map((k) => mix[k]);
  return pickWeighted(rng, keys, weights);
}

export function shuffle<T>(rng: RNG, arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pad(n: number, width = 4): string {
  return n.toString().padStart(width, "0");
}

export function discreteSampleNum(rng: RNG, pmf: Record<string, number>): number {
  const keys = Object.keys(pmf);
  const weights = keys.map((k) => pmf[k]);
  return Number(pickWeighted(rng, keys, weights));
}

// ------------------------------ date helpers ------------------------------

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeekFromIso(
  iso: string,
): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" {
  const d = new Date(`${iso}T00:00:00Z`);
  const map = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  return map[d.getUTCDay()];
}

export function dayNameFull(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return [
    "Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday",
  ][d.getUTCDay()];
}

export function mondayOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function monthName(iso: string): string {
  const idx = Number(iso.slice(5, 7)) - 1;
  return [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][idx];
}

export function quarterOf(iso: string): "Q1" | "Q2" | "Q3" | "Q4" {
  const m = Number(iso.slice(5, 7));
  if (m <= 3) return "Q1";
  if (m <= 6) return "Q2";
  if (m <= 9) return "Q3";
  return "Q4";
}

// MM/DD/YYYY (Wide Orbit / schedule source format)
export function isoToUSDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// HH:MM:SS — Wide Orbit AirTime1 format
export function timeWithSeconds(rng: RNG, hour: number, minute: number): string {
  const sec = Math.floor(rng() * 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ------------------------------ csv helpers ------------------------------

const NEEDS_QUOTE = /[",\n\r]/;

function csvField(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (NEEDS_QUOTE.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function writeCsv<T extends Record<string, unknown>>(
  filename: string,
  columns: readonly (keyof T & string)[],
  rows: readonly T[],
): void {
  const header = columns.join(",");
  const body = rows
    .map((r) => columns.map((c) => csvField(r[c])).join(","))
    .join("\n");
  writeText(filename, `${header}\n${body}\n`);
}
