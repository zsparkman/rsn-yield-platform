// Number formatting helpers, matching the spec's display conventions.
// All functions are pure and isomorphic.

export function fmtCurrencyRolled(cents: number): string {
  // "$1,234,567" — no cents, with commas
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function fmtCurrencyDollars(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

export function fmtCurrencyUnit(cents: number): string {
  // "$XXX" — EUR/AUR display (no cents). For sub-thousand keep the natural form.
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

export function fmtPercent(ratio: number): string {
  // Integer percent, "87%"
  if (!isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

export function fmtEq30(eq: number): string {
  // One decimal — "26.5"
  return eq.toFixed(1);
}

export function fmtAvails(n: number): string {
  return n.toFixed(1);
}

export function fmtIntCount(n: number): string {
  return n.toLocaleString("en-US");
}

// Heat scale helpers ----------------------------------------------------------

// Sellout %: red-500 (low) → amber-400 (mid) → green-500 (high) per the spec.
// Returns Tailwind background class with opacity tier.
export function selloutHeat(pct: number): string {
  if (!isFinite(pct) || pct < 0) return "";
  if (pct < 0.5) return "bg-red-500/30 text-slate-900";
  if (pct < 0.75) return "bg-red-500/15 text-slate-900";
  if (pct < 0.9) return "bg-amber-400/30 text-slate-900";
  if (pct < 1.0) return "bg-amber-400/15 text-slate-900";
  if (pct < 1.05) return "bg-green-500/30 text-slate-900";
  return "bg-green-500/45 text-slate-900";
}

// Heatmap view uses a continuous red gradient (0% white → high red → deeper at oversold).
export function heatmapRedGradient(pct: number): { bg: string; text: string } {
  if (!isFinite(pct) || pct <= 0) return { bg: "rgb(255,255,255)", text: "rgb(15,23,42)" };
  // Map [0, 1.0] → white→saturated red, [1.0, 1.4] → deeper red.
  const clamped = Math.min(pct, 1.4);
  // Below 1.0: lerp white (255,255,255) → red-400 (248, 113, 113)
  // Above 1.0: lerp red-400 → red-700 (185, 28, 28)
  let r: number, g: number, b: number;
  if (clamped <= 1.0) {
    const t = clamped;
    r = 255 + (248 - 255) * t;
    g = 255 + (113 - 255) * t;
    b = 255 + (113 - 255) * t;
  } else {
    const t = (clamped - 1.0) / 0.4;
    r = 248 + (185 - 248) * t;
    g = 113 + (28 - 113) * t;
    b = 113 + (28 - 113) * t;
  }
  // Pick text color based on luminance.
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const text = lum < 140 ? "rgb(248,250,252)" : "rgb(15,23,42)";
  return { bg: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`, text };
}

// Open inventory column in Rates view: green=high open, red=low open, bold red=negative.
export function openHeat(open: number): string {
  if (open < 0) return "bg-red-600/40 text-slate-900 font-semibold";
  if (open < 5) return "bg-red-500/25 text-slate-900";
  if (open < 15) return "bg-amber-400/25 text-slate-900";
  if (open < 30) return "bg-green-500/20 text-slate-900";
  return "bg-green-500/35 text-slate-900";
}

// Booking Matrix density heat — emerald scale capped at emerald-300 so black
// text remains legible at every saturation level. The signal still reads
// (lighter = lower volume, darker = higher volume) on a shallower curve;
// any text-color flip to white at high values is gone.
export function gridDensityHeat(eq: number): string {
  if (eq <= 0) return "";
  if (eq < 0.5) return "bg-emerald-50";
  if (eq < 1.5) return "bg-emerald-100";
  if (eq < 3.0) return "bg-emerald-200";
  return "bg-emerald-300";
}

// Date formatting -------------------------------------------------------------

const SHORT_MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function fmtIsoShort(iso: string): string {
  // "Mar 27" style
  if (!iso) return "";
  const m = SHORT_MONTH[Number(iso.slice(5, 7)) - 1];
  const d = Number(iso.slice(8, 10));
  return `${m} ${d}`;
}

export function fmtIsoLong(iso: string): string {
  // "Mar 27, 2026"
  if (!iso) return "";
  const m = SHORT_MONTH[Number(iso.slice(5, 7)) - 1];
  const d = Number(iso.slice(8, 10));
  const y = iso.slice(0, 4);
  return `${m} ${d}, ${y}`;
}

export function fmtDow(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
}
