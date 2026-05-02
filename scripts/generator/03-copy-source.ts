// Copies inventory_capacity.xlsx and rate_card.xlsx from
// docs/reference/ into data/. These two files are not generated —
// the synthetic versions live in docs/reference/ and the build just
// places them where the ETL expects to find them.

import { copyFromReference } from "./_shared";

export function run(): void {
  copyFromReference("Inventory_Table_synthetic.xlsx", "inventory_capacity.xlsx");
  copyFromReference("Dynamic_Rates_synthetic.xlsx", "rate_card.xlsx");
  console.log("inventory_capacity.xlsx, rate_card.xlsx copied");
}

if (require.main === module) run();
