# Data Model

## Overview

The app is a faithful re-implementation of the Power Query / Pivot Table
chain that powers the existing Excel-based reports. The data flow has
two layers:

1. **Source files** — four files in `/data` that mirror the real
   SSRS / Wide Orbit / Excel inputs the production workbook consumes.
   The synthetic generator produces these; the same pipeline could in
   theory be pointed at real exports with no code change other than
   swapping the input files.
2. **ETL output** — typed in-memory shapes computed at build time by
   `src/lib/etl.ts`, mirroring the named M queries in
   `docs/reference/SNLA_Dodgers_Snapshot.txt`. Views consume these.

The browser performs filtering, sorting, and lightweight aggregation
only. No API calls, no server, no live recomputation: everything is
prerendered at build.

## Naming conventions

- **Source field names** preserve the SSRS / Excel column names exactly
  (`SpotRate`, `AdvertiserName`, `INV TYPE`, `Avails Key`). The ETL is
  the only place that translates between the SSRS shape and app
  conventions.
- **App identifiers** (within ETL outputs and views): `snake_case` for
  fields, `PascalCase` for interfaces.
- **Currency** in source files is dollars-and-cents floats (matches Wide
  Orbit). The ETL preserves that representation; views format on render.
- **Dates** in source files: `MM/DD/YYYY` (Wide Orbit / Master Game
  Schedule convention). The ETL converts to ISO `YYYY-MM-DD` on
  derived shapes (e.g., `air_date_iso`).
- **Times** in source files: `HH:MM:SS` 24h for spots; `H:MMam/pm` for
  schedule. ETL normalizes to 24h `HH:MM` for derived shapes.

## Source files

### `data/spots.csv` — Wide Orbit SSRS export (29 columns)

One row per booked spot, exactly mirroring `PPIRSNBookedSpots*.csv`:

```typescript
interface RawSpot {
  ChannelName: string;             // 'BSWN'
  AdvertiserName: string;          // canonical, with optional " /Repped" suffix
  RevenueCode2: string;            // 'National' / 'Local' / 'National Political'
  OrderNumber: number | null;
  LineNumber: number | null;
  SpotNumber: number | null;
  SpotLength: number;              // 15 / 30 / 60 (other sizes possible in real data)
  SpotRate: number;                // gross dollars
  SpotState: 'Placed' | 'Booked';
  PriorityCode: string;            // 'P-04' / 'P-08' / 'P-09' / 'P-19' / 'P-80' / etc.
  AirDate: string;                 // 'MM/DD/YYYY'
  AirTime1: string;                // 'HH:MM:SS' 24h
  InventoryCodeBooked: string;
  PathBooked: string;              // 'Sentinels --> Sentinels Regular Season --> ...'
  InventoryCodePlaced: string;     // empty when unplaced
  PathPlaced: string;              // empty when unplaced
  TimePeriod: string;
  AEFullName: string;              // contains 'HomeTeamSports' for repped spots
  ProductCode: string;
  ParentProductCode: string;       // 'AUTO' / 'FINANCE' / etc.
  DemoCode: string;                // 'HH' / 'A25-54' / etc.
  BookedRating: number;
  BookedImpressions: number;       // raw count
  UnitCode: string;                // 'Sponsor' / 'General'
  CPP: number | null;
  TotalEquivSold: number;          // 0.5 / 1.0 / 2.0
  EffectiveUnitRate: number;       // gross per :30-equivalent
  UnitAirStatusCode: string;       // 'Aired' / 'Late Add' / etc.
  InventoryType: 'BK' | 'NM';      // booked vs no-charge
}
```

Reference: `docs/reference/PPIRSNBookedSpots2026_synthetic.csv`. Target
size for the Sentinels season: ~18,000 rows.

### `data/schedule.csv` — Master Game Schedule (10 columns)

One row per scheduled event:

```typescript
interface RawScheduleRow {
  '#': string;                     // 'PRE 1' / '1' / '2' / ... ('PRE *' = preseason)
  DAY: string;                     // full day name
  DATE: string;                    // 'MM/DD/YYYY'
  TIME: string;                    // 'H:MMam/pm' or 'OFF DAY'
  OPPONENT: string;                // 'vs. Angels' / 'at Padres'
  TV: string;                      // 'SNLA' (drop rows with '(Confirmed Exclusive)')
  'OTHER TV': string;              // simulcast partner or empty
  NOTES: string;
  FORMAT: string;                  // 'Home Standard -- 5421' etc. (Expanded → Expanded)
  'SQUEEZE PLAY BUG': string;
}
```

Reference structure:
`docs/reference/2026_Dodgers_Master_Game_Schedule__02_27_26.xlsx`
(provided externally; not committed to the repo). Target: 25 PR + 145
REG = 170 game rows.

### `data/inventory_capacity.xlsx` — Inventory Table

One row per `(Team, Type, Inventory, Format)` capacity bucket:

```typescript
interface RawInventoryCapRow {
  Syscode: number;
  Team: string;                    // 'Sentinels'
  Type: 'PR' | 'REG';
  Inventory:
    | 'Pregame' | 'In Game' | 'In Game+' | 'In Game-'
    | 'Postgame' | 'Floaters A&B';
  Format: 'Standard' | 'Expanded' | 'DH' | 'Expanded DH';
  Avails: number;                  // eq30 capacity
}
```

Source-of-truth: `docs/reference/Inventory_Table_synthetic.xlsx`,
copied verbatim into `data/` by the generator's
`scripts/generator/03-copy-source.ts`.

### `data/rate_card.xlsx` — Dynamic Rates

One row per `(Type, Inv, Matchup, Tier)` rate cell:

```typescript
interface RawRateCardRow {
  Syscode: number;
  Net: string;                     // 'BSWN'
  Team: string;                    // 'Sentinels'
  Type: 'PR' | 'REG';
  Inv: 'Pregame' | 'In Game' | 'Postgame';
  Matchup: 'Standard' | 'Regional';
  Tier: 'Base' | 'FL' | 'Bump';    // FL only for In Game
  Rate: number;                    // gross dollars per :30
}
```

Source-of-truth: `docs/reference/Dynamic_Rates_synthetic.xlsx`, copied
verbatim. The generator does not modify rates.

## ETL output shapes

The five named functions in `src/lib/etl.ts` correspond to the M
queries in `SNLA_Dodgers_Snapshot.txt`. Inputs and outputs are typed;
joins use `Map<string, T>` on tuple keys instead of literal join-key
columns, but the join-key strings remain on outputs for parity with
the M schema and for the contracts validator.

### `EnrichedSpot[]` — `deriveSpots()` ← *Lakers Spot Data 19-22*

`RawSpot` plus derived columns:
- `inventory_type_booked`, `inventory_type_placed`, `inventory_type` —
  the cascaded classification (Galaxy/Sparks/default → Ancillary;
  In Game / Pregame / Postgame from path text).
- `spot_rate_net` — `SpotRate * 0.85`.
- `booked_display_status` — `'As Booked' | 'As Placed'`.
- `post_inv_code`, `post_code`, `post_key` — the "Post Code" cascade.
- `air_date_iso`, `broadcast_month`, `broadcast_year`, `broadcast_qtr`
  (`'Q1' | 'Q2' | 'Q3' | 'Q4'`), `period` (`'4Q' | '1-2Q' | null`).
- `booked_impressions_thousands` — raw `/ 1000`.
- `fl_flag` — `'FL'` iff `InventoryCodePlaced` contains `'Timeout'`.
- `hts_flag` — `'HTS'` iff `AEFullName` contains `'HomeTeamSports'`.

### `EnrichedScheduleRow[]` — `deriveSchedule()` ← *Lakers Combined Schedules*

One row per `(game, INV TYPE)`. Each calendar game emits three rows
(Pregame / In Game / Postgame). Adds:
- `+/-` — `'+'` if start minute mod 30 > 14, `'-'` if < 8, else `null`
  (set only for In Game).
- `INV TYPE.1` — `INV TYPE` concatenated with `+/-`
  (e.g., `'In Game+'`, `'In Game-'`).
- `Simulcast` — `'Simulcast'` iff `OTHER TV` is non-empty.
- `Expanded` — `'Expanded' | 'DH' | 'Expanded DH' | 'Standard'`.
- `Matchup` — `'Regional'` if opponent ∈ {Giants, Padres, Angels} else
  `'Standard'`.
- `Avails Key` — `[TYPE, TYPE2, INV TYPE.1, Expanded].join('.')`.
- `EVENT_PROGRAM` — `'Sentinels {OPPONENT}'` with `'PR: '` prefix for PR.
- Broadcast calendar columns.

Filters: drops `OFF DAY` rows, `(Confirmed Exclusive)` TV rows,
`NonSpectrum.In Game` rows, and `DATE <= 2019-12-29`.

### `SpotsByClientRow[]` — `deriveSpotsByClient()` ← *Lakers by Client (Inc $0)*

Left outer join of `EnrichedScheduleRow` (left) onto `EnrichedSpot`
(right) on the tuple `(DATE, INV TYPE)`. Schedule rows without
matching spots are kept with all spot fields zero-filled. Adds:
- `$0` — `'Paid'` iff `SpotRate > 0`, else `'$0'`.
- `AfterToday` — `1` iff `AirDate > today`, else `0`.

### `InventoryRollupRow[]` — `deriveInventory(opts)` ← *Inventory (Exc $0) / (Inc $0)*

Per-game-per-inv-type rollup. Two variants by `opts.include0`:
- `Exc $0` filters paid spots only before grouping (`SpotRate > 0`).
- `Inc $0` groups everything.

Each game emits four rows: Pregame, the resolved In Game variant
(`In Game` / `In Game+` / `In Game-`), Postgame, and Floaters A&B.
The Floaters row's `Cap` is fixed at 6; its `Sold` derives from the
In Game oversell (`max(0, -Oversell_M)`); its revenue / EUR / AUR are
forced to 0 (no double-counting — revenue lives on the In Game row).

Rate tier (M sign convention `Oversell = Avails - Sold`):
- In Game with `Oversell > 0` → `Base`
- In Game with `Oversell > -6` → `FL`
- In Game with `Oversell <= -6` → `Bump`
- Floaters A&B → `FL` (priced at the floater rack rate)
- Pregame / Postgame with `Avail > 0` → `Base`
- Pregame / Postgame else → `Bump`

Three volume-weighted unit-rate metrics, all stored as integer cents
on every `InventoryRollupRow`:

- **`eur_gross_cents`** — sum of `gross_rev_cents` divided by sum of
  `total_eq30` over paid spots in the row's aggregation window. The
  sales-facing EUR. Surfaces in the **Inventory view** as the
  "EUR (Gross)" column and in the **Rates view**.
- **`eur_net_cents`** — sum of `net_rev_cents` divided by sum of
  `total_eq30` over paid spots. The yield/finance-facing EUR.
  Surfaces in the **AUR Report view** as the "EUR (Net)" column.
- **`aur_cents`** — sum of `net_rev_cents` divided by `count(paid_spots)`,
  length-agnostic. Surfaces in the **AUR Report view** alongside
  `eur_net_cents`.

Both EUR variants are volume-weighted (sum/sum); they differ only in
the numerator. The M chain maintains both deliberately because sales
leadership and yield/finance leadership need different views of the
same data. The mean-of-means form (`List.Average(EffectiveUnitRate)`)
that appears in the M source is a Power Query convenience that
produces statistically incorrect values for non-uniform aggregation
windows; the ETL replaces it with volume-weighted formulas across the
board.

For Floaters A&B rows all three resolve to 0 (no double-counting —
revenue lives on the In Game row).

### `AurSummaryRow[]` — `deriveAurSummary()` ← *AUR Summary*

Per-`(DATE, INV TYPE)` wide-form pivot. Floaters A&B rows are
filtered out. One column per `(LOB Group × Spot Group × metric)`
bucket plus totals. Empty intersections resolve to `0`, never
`null` or `undefined`.

LOB Group: `'HTS'` iff `AEFullName` contains `'HomeTeamSports'`.

Spot Group:
- `SpotRate > 0` → `'Paid'`
- `PriorityCode = 'P-80'` → `'NC'`
- `PriorityCode = 'P-19'` → `'NC'`
- `PriorityCode = 'P-09'` → `'ADU'`
- `PriorityCode = 'P-08'` → `'Cross Property ADU'`
- `PriorityCode = 'P-04'` → `'Bonus'`
- else → null (excluded)

For Paid: all three of `Gross REV`, `Net REV`, `EQ30` carried.
For non-Paid: only `EQ30`.

Per-row rollups: `HTS Total.EQ30`, `Non-HTS Total.EQ30`,
`Total Total.EQ30`, `Sellout = (Paid + NC) / Avails`,
`Sellout + ADU = (Paid + NC + ADU + Cross Property ADU) / Avails`.

The AUR Report view also consumes two volume-weighted unit-rate
metrics off this row, both in integer cents:

- **`eur_net_cents`** = `Total Paid.Net REV / Total Paid.EQ30`. The
  AUR-Report-facing EUR. Same definition as `InventoryRollupRow.eur_net_cents`,
  recomputed at this aggregation level.
- **`aur_cents`** = `Total Paid.Net REV / count(paid spots)`. Length-
  agnostic per-spot rate.

## File size targets

| File | Approx rows | Approx size |
|------|-------------|-------------|
| spots.csv | ~18,000 | 5–6 MB |
| schedule.csv | 170 | 15 KB |
| inventory_capacity.xlsx | ~36 | 6 KB |
| rate_card.xlsx | ~28 | 6 KB |
| _validation_report.json | — | 10 KB |

ETL outputs are not persisted to disk — they live in memory during
the build and are inlined into the prerendered routes.
