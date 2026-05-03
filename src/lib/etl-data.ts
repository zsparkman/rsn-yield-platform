// Server-only: load + memoize ETL output for use by App Router server
// components. The ETL runs once per process (build time for `next build`,
// once per dev-server boot for `next dev`).
//
// Pages must NOT import this module from client components — it reads
// from the local filesystem.

import "server-only";
import { loadSources, runEtl, type EtlOutputs } from "./etl";

let cached: EtlOutputs | null = null;

export function getEtl(): EtlOutputs {
  if (cached) return cached;
  const inputs = loadSources();
  cached = runEtl(inputs);
  return cached;
}
