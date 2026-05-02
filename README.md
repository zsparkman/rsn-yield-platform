# RSN Yield Platform

A web-based re-implementation of the Excel/Power Query yield-management
chain that runs the inventory, rates, fill, and AUR reports for a
regional sports network.

The app is structured so the same pipeline could in theory be pointed
at real Wide Orbit / SSRS exports with no code change other than
swapping the input files.

## Architecture

```
docs/reference/                        ← real-world artifacts (M code,
  ├── PPIRSNBookedSpots2026_synthetic.csv      synthetic SSRS reference,
  ├── Inventory_Table_synthetic.xlsx           inventory cap table,
  ├── Dynamic_Rates_synthetic.xlsx             dynamic rate card)
  └── SNLA_Dodgers_Snapshot.txt                M chain (the ETL contract)

scripts/generator/                     ← deterministic synthetic data generator
  ├── 01-schedule.ts                   produces data/schedule.csv
  ├── 02-spots.ts                      produces data/spots.csv
  └── 03-copy-source.ts                copies the two reference xlsx files

data/                                  ← the four source files (gitignored)
  ├── spots.csv                        29-column Wide Orbit SSRS shape
  ├── schedule.csv                     10-column Master Game Schedule shape
  ├── inventory_capacity.xlsx          (copied from docs/reference/)
  └── rate_card.xlsx                   (copied from docs/reference/)

src/lib/etl.ts                         ← five named ETL functions
src/lib/etl-validate.ts                ← property-based contracts validator
src/lib/etl-distributional.ts          ← 24 distributional calibration checks

scripts/generate-data.ts               ← orchestrator: generate → parse →
                                         ETL → contracts → distributional →
                                         exit non-zero on any miss

src/app/                               ← Next.js App Router pages (views
                                         consume the in-memory ETL output)
```

The five ETL functions mirror the named M queries in
`docs/reference/SNLA_Dodgers_Snapshot.txt`:

- `deriveSpots()` — Lakers Spot Data 19-22
- `deriveSchedule()` — Lakers Combined Schedules
- `deriveSpotsByClient()` — Lakers by Client (Inc $0)
- `deriveInventory()` — Inventory (Exc $0) / Inventory (Inc $0)
- `deriveAurSummary()` — AUR Summary

Implementations are idiomatic TypeScript (single-pass map / reduce,
tuple keys via `Map<string, T>`) — they preserve the M output
contracts but not its procedural shape. Equivalence is enforced by
the property-based contracts in `docs/spec/05-etl-contracts.md`.

## Build and run

```bash
npm install
npm run generate-data    # generate sources + run ETL + run validators
npm run dev              # start the Next.js dev server
npm run build            # static export
```

`npm run generate-data` is deterministic — same seed (`'rsn-yield-platform-v1'`)
always produces the same outputs.

## Spec docs

See `docs/spec/`:

- `01-data-model.md` — source file schemas + ETL output schemas
- `02-information-architecture.md` — view-level layout and styling
- `03-synthetic-data-spec.md` — generator algorithm + calibration targets
- `05-etl-contracts.md` — property-based ETL invariants

## Data sanitization

All data shown in the demo is synthetic. No real client names, rates,
fill numbers, or revenue figures appear in this codebase. Synthetic
data was generated from distributional priors derived from operational
experience, not from any real dataset. The reference files in
`docs/reference/` are themselves synthetic placeholders for the real
SSRS / Wide Orbit / Excel exports.
