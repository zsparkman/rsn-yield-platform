// Advertiser pool — extracted from docs/reference/PPIRSNBookedSpots2026_synthetic.csv
// at generator startup. The reference file is the calibration target; reading
// from it directly keeps the generator's roster locked to the SSRS shape.

import * as fs from "node:fs";
import * as path from "node:path";
import { REFERENCE_DIR } from "./_shared";

export type Lob = "Direct" | "Repped";

export interface Advertiser {
  name: string;            // canonical name (no " /Repped" suffix)
  raw: string;             // exact AdvertiserName value as it appears in spots.csv
  lob: Lob;                // Direct or Repped (derived from " /Repped" suffix)
  product_code: string;    // ProductCode
  parent_product_code: string; // ParentProductCode (FINANCE / AUTO / etc.)
  preferred_demo: string;  // most common DemoCode for this advertiser
  channel: string;         // ChannelName (typically National)
}

const REPPED_SUFFIX = " /Repped";
const REF_FILE = "PPIRSNBookedSpots2026_synthetic.csv";

interface Tally {
  raw: string;
  count: Record<string, number>; // demo histogram
  product_code: string;
  parent_product_code: string;
  channel: string;
}

export function loadAdvertisers(): Advertiser[] {
  const csvPath = path.join(REFERENCE_DIR, REF_FILE);
  const text = fs.readFileSync(csvPath, "utf-8");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const idx = (col: string) => header.indexOf(col);
  const advCol = idx("AdvertiserName");
  const channelCol = idx("ChannelName");
  const productCol = idx("ProductCode");
  const parentCol = idx("ParentProductCode");
  const demoCol = idx("DemoCode");

  const tally = new Map<string, Tally>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    // Trivial split is fine — the reference file has no embedded commas / quotes.
    const cells = line.split(",");
    const raw = cells[advCol];
    if (!raw) continue;
    const t = tally.get(raw) ?? {
      raw,
      count: {},
      product_code: cells[productCol] || "",
      parent_product_code: cells[parentCol] || "",
      channel: cells[channelCol] || "",
    };
    const demo = cells[demoCol] || "HH";
    t.count[demo] = (t.count[demo] ?? 0) + 1;
    tally.set(raw, t);
  }

  const out: Advertiser[] = [];
  for (const t of tally.values()) {
    const lob: Lob = t.raw.endsWith(REPPED_SUFFIX) ? "Repped" : "Direct";
    const name = lob === "Repped"
      ? t.raw.slice(0, -REPPED_SUFFIX.length)
      : t.raw;
    const preferred_demo = Object.entries(t.count)
      .sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      name,
      raw: t.raw,
      lob,
      product_code: t.product_code,
      parent_product_code: t.parent_product_code,
      preferred_demo,
      channel: t.channel,
    });
  }
  // Stable order: by raw advertiser string, alpha.
  out.sort((a, b) => (a.raw < b.raw ? -1 : 1));
  return out;
}
