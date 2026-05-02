#!/usr/bin/env tsx
//
// Top-level orchestrator: runs all eight generator modules in order then
// validates. Exits non-zero on any validation failure.
//
import { run as runCalendar } from "./generator/01-broadcast-calendar";
import { run as runOpponents } from "./generator/02-opponents";
import { run as runClients } from "./generator/03-clients";
import { run as runRateCard } from "./generator/04-rate-card";
import { run as runInventoryCapacity } from "./generator/05-inventory-capacity";
import { run as runSchedule } from "./generator/06-schedule";
import { run as runSpots } from "./generator/07-spots";
import { run as runRollups } from "./generator/08-rollups";
import { run as runValidate } from "./generator/99-validate";

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log("=== rsn-yield-platform synthetic data generator ===\n");

  console.log("[1/8] broadcast calendar");
  runCalendar();
  console.log("[2/8] opponents");
  runOpponents();
  console.log("[3/8] clients");
  runClients();
  console.log("[4/8] rate card");
  runRateCard();
  console.log("[5/8] inventory capacity");
  runInventoryCapacity();
  console.log("[6/8] schedule");
  runSchedule();
  console.log("[7/8] spots + game inventory");
  runSpots();
  console.log("[8/8] rollups + AUR summary");
  runRollups();

  console.log("\n=== validation ===\n");
  const ok = runValidate();

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nTotal: ${dt}s`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
