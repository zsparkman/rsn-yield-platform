import seedrandom from "seedrandom";
import * as fs from "node:fs";
import * as path from "node:path";

export const TOP_SEED = "rsn-yield-platform-v1";
export const DEMO_YEAR = 2025;

export const DATA_DIR = path.resolve(process.cwd(), "data");

export type RNG = () => number;

export function rngFor(namespace: string): RNG {
  return seedrandom(`${TOP_SEED}:${namespace}`);
}

// Per-key RNG so a sub-routine's outcomes stay stable when unrelated upstream
// random calls change. Use this anywhere the stability of a derived metric
// matters (e.g., floater firings per game must not drift when sampling
// weights elsewhere change).
export function rngForKey(namespace: string, key: string): RNG {
  return seedrandom(`${TOP_SEED}:${namespace}:${key}`);
}

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function writeJson(filename: string, data: unknown): void {
  ensureDataDir();
  const full = path.join(DATA_DIR, filename);
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

export function readJson<T>(filename: string): T {
  const full = path.join(DATA_DIR, filename);
  return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
}

// Standard normal via Box-Muller.
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

// Knuth-style Poisson sampler for small lambda.
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

export function pickFromMix<K extends string>(
  rng: RNG,
  mix: Record<K, number>,
): K {
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

export function isoDate(year: number, month1Indexed: number, day: number): string {
  const m = month1Indexed.toString().padStart(2, "0");
  const d = day.toString().padStart(2, "0");
  return `${year}-${m}-${d}`;
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

export function mondayOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // 0=Sun, 1=Mon, ..., 6=Sat. Move back to Mon (or stay if already Mon).
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function monthName(iso: string): string {
  const idx = Number(iso.slice(5, 7)) - 1;
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][idx];
}

export function quarterOf(iso: string): "Q1" | "Q2" | "Q3" | "Q4" {
  const m = Number(iso.slice(5, 7));
  if (m <= 3) return "Q1";
  if (m <= 6) return "Q2";
  if (m <= 9) return "Q3";
  return "Q4";
}

// Sample from a discrete distribution where values are explicit.
// e.g. discreteSample(rng, { "0": 0.089, "1": 0.133, ... }) → numeric key as number.
export function discreteSampleNum(
  rng: RNG,
  pmf: Record<string, number>,
): number {
  const keys = Object.keys(pmf);
  const weights = keys.map((k) => pmf[k]);
  const k = pickWeighted(rng, keys, weights);
  return Number(k);
}
