#!/usr/bin/env tsx
//
// Top-level orchestrator for the SSRS-input + ETL architecture.
//
// 1. Generate the four source files (data/spots.csv, data/schedule.csv,
//    data/inventory_capacity.xlsx, data/rate_card.xlsx).
// 2. Parse them.
// 3. Run the ETL (src/lib/etl.ts).
// 4. Run the contracts validator (src/lib/etl-validate.ts).
// 5. Run the distributional validator (src/lib/etl-distributional.ts).
// 6. Exit non-zero on any failure.

import * as fs from "node:fs";
import * as path from "node:path";

import { run as runSchedule } from "./generator/01-schedule";
import { run as runSpots } from "./generator/02-spots";
import { run as runCopy } from "./generator/03-copy-source";
import { loadSources, runEtl } from "../src/lib/etl";
import { runContracts } from "../src/lib/etl-validate";
import { runDistributional } from "../src/lib/etl-distributional";

const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log("=== rsn-yield-platform synthetic data + ETL pipeline ===\n");

  console.log("[1/6] schedule.csv");
  runSchedule();
  console.log("[2/6] spots.csv");
  runSpots();
  console.log("[3/6] inventory_capacity.xlsx + rate_card.xlsx (copy)");
  runCopy();

  console.log("\n[4/6] ETL");
  const inputs = loadSources(DATA_DIR);
  console.log(`  parsed ${inputs.spots.length} spots, ${inputs.schedule.length} schedule rows, ${inputs.inventoryCapacity.length} inv caps, ${inputs.rateCard.length} rate-card rows`);
  const outputs = runEtl(inputs);
  console.log(`  derived ${outputs.spots.length} spots, ${outputs.schedule.length} schedule, ${outputs.spotsByClient.length} sbc, ${outputs.inventoryExc0.length} inv (Exc), ${outputs.inventoryInc0.length} inv (Inc), ${outputs.aurSummary.length} aur`);

  console.log("\n[5/6] Property-based contract validation");
  const cr = runContracts(inputs, outputs);
  let failed = 0;
  for (const r of cr.results) {
    const tag = r.passed ? "PASS" : "FAIL";
    const line = `  [${tag}] ${r.id.padEnd(4)} ${r.summary}`;
    console.log(line);
    if (!r.passed) {
      failed += 1;
      if (r.reason) console.log(`         reason: ${r.reason}`);
    }
  }
  console.log(`  ${cr.results.length - failed}/${cr.results.length} contracts passed`);

  console.log("\n[6/6] Distributional validation");
  const dist = runDistributional(outputs.schedule, outputs.spots, outputs.inventoryExc0);
  let distFailed = 0;
  const longest = Math.max(...dist.map((m) => m.name.length));
  for (const m of dist) {
    const tag = m.passed ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${m.name.padEnd(longest)}  value=${m.value}  target=${m.target}`);
    if (!m.passed) distFailed += 1;
  }
  console.log(`  ${dist.length - distFailed}/${dist.length} distributional metrics passed`);

  // Persist the validation report
  fs.writeFileSync(
    path.join(DATA_DIR, "_validation_report.json"),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      contracts: cr.results.map((r) => ({ id: r.id, summary: r.summary, passed: r.passed, reason: r.reason })),
      distributional: dist,
    }, null, 2),
  );

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nTotal: ${dt}s`);

  if (failed > 0 || distFailed > 0) {
    console.error(`\nFAIL: ${failed} contracts + ${distFailed} distributional checks`);
    process.exit(1);
  }
  console.log("\nAll validations passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
