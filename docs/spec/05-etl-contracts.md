# ETL Contracts Specification

## Purpose

The ETL module (`src/lib/etl.ts`) re-implements the Power Query M chain
documented in `docs/reference/SNLA_Dodgers_Snapshot.txt`. The M code is
a sequence of named queries that derive analytic shapes from a small
set of source tables (`spots`, `schedule`, `inventory_capacity`,
`rate_card`). We mirror the **outputs** of those queries with five
named TypeScript functions; we do **not** mirror the M code's
procedural shape.

Because the M code is the functional reference but its implementation
is not portable, equivalence is enforced two ways:

1. **Property-based assertions (this document, primary).** Each ETL
   function has a set of contracts — invariants over its output that
   must hold regardless of input. The build fails if any contract is
   violated. Contracts capture (a) structural invariants, (b) value-
   relationship invariants, (c) referential integrity, and (d) the
   business semantics of the originating M query.
2. **Golden-file comparison (one-shot gate).** Before declaring the
   migration done, run the M queries against the synthetic source
   files in Excel, snapshot the outputs, and diff against the ETL
   output row-for-row and column-for-column. The golden gate is not
   carried forward as a regression test; the property contracts cover
   the durable behavior.

## Implementation pattern

Each contract is a pure TypeScript predicate function. They live in
`src/lib/etl-validate.ts` alongside a single entry-point validator:

```ts
type Contract<I, O> = {
  id: string;          // e.g. "S3"
  summary: string;     // one-line description
  check: (input: I, output: O) => ContractResult;
};

type ContractResult =
  | { passed: true }
  | { passed: false; reason: string; sample?: unknown };

export function runContracts(
  inputs: EtlInputs,
  outputs: EtlOutputs,
): { results: ContractResult[]; allPassed: boolean };
```

The orchestrator (`scripts/generate-data.ts`) calls `runContracts`
after running the ETL and exits non-zero on any failed contract,
printing the failing contract's ID, summary, and a representative
sample row.

## Conventions

- IDs use a one-letter prefix per function: `S` for `deriveSpots`,
  `G` for `deriveSchedule`, `C` for `deriveSpotsByClient`, `I` for
  `deriveInventory`, `A` for `deriveAurSummary`. Numbering is
  sequential within each function.
- Predicates are written in TS-shaped pseudocode in this spec; the
  actual implementations may use helper utilities (`approxEq`,
  `forAll`, etc.) for readability.
- Floating-point comparisons use `approxEq(a, b, eps)` with `eps`
  chosen per the contract (typically `1e-4` for ratios, `0.01` for
  cents-level money).
- "M lines X–Y" references in section headers anchor each ETL
  function back to the line range in
  `docs/reference/SNLA_Dodgers_Snapshot.txt`.

---

## deriveSpots() — `Lakers Spot Data 19-22` (M lines 131–153)

Takes raw Wide Orbit spots (the union of yearly `PPI RSN Booked Spots`
queries) and adds derived classification columns. Input type
`RawSpot[]` mirrors the 29-column SSRS export; output type
`EnrichedSpot[]` adds `inventory_type`, `inventory_type_booked`,
`inventory_type_placed`, `spot_rate_net`, `booked_display_status`,
`post_inv_code`, `post_code`, `post_key`, `period`, `fl_flag`,
`hts_flag`, broadcast calendar columns, and a normalized
`booked_impressions` (raw / 1000).

#### S1. Filter preserves only rows with a non-empty OrderNumber

```ts
output.length ===
  input.filter(r => r.OrderNumber != null && String(r.OrderNumber).trim() !== '').length
```

Anchored at M `#"Filtered Rows"` step (line 6).

#### S2. Inventory-type domain is closed

```ts
output.every(s =>
  ['In Game', 'Pregame', 'Postgame', 'Ancillary'].includes(s.inventory_type)
)
```

Anchored at M `#"Added Custom2"` (line 12) and the booked / placed
classifier cascades.

#### S3. Inventory-type classifier precedence (booked path)

```ts
output.every(s => s.inventory_type_booked === classifyInvFromPath(s.PathBooked))

function classifyInvFromPath(path: string): InventoryType {
  if (/Galaxy|Sparks/.test(path)) return 'Ancillary';
  if (/In ?Game/.test(path)) return 'In Game';
  if (/Pregame/.test(path)) return 'Pregame';
  if (/Postgame/.test(path)) return 'Postgame';
  return 'Ancillary';
}
```

Anchored at M `#"Added Conditional Column"` (line 9). Note Galaxy/
Sparks short-circuit before the In Game/Pregame/Postgame check.

#### S4. Inventory-type resolution rule

```ts
output.every(s => {
  const expected =
    s.SpotState === 'Placed' && s.inventory_type_placed === 'Placed'
      ? s.inventory_type_booked
      : s.SpotState === 'Placed'
        ? s.inventory_type_placed
        : s.inventory_type_booked;
  return s.inventory_type === expected;
})
```

Anchored at M `#"Added Custom2"` (line 12).

#### S5. Net rate is exactly 85 % of gross rate

```ts
output.every(s => approxEq(s.spot_rate_net, s.SpotRate * 0.85, 0.005))
```

Anchored at M `#"Added Custom"` "SpotRate (Net)" (line 135).

#### S6. Booked display status follows As Booked / As Placed rule

```ts
output.every(s => {
  const expected =
    s.SpotState !== 'Placed'
      ? 'As Booked'
      : s.inventory_type_placed === s.inventory_type_booked
        ? 'As Booked'
        : 'As Placed';
  return s.booked_display_status === expected;
})
```

Anchored at M `#"Added Custom1"` (line 137).

#### S7. Post inventory code falls back through inventory_type → placed → booked

```ts
output.every(s => {
  if (s.inventory_type !== 'Ancillary') return s.post_inv_code === s.inventory_type;
  if (s.InventoryCodePlaced.trim() !== '') return s.post_inv_code === s.InventoryCodePlaced;
  return s.post_inv_code === s.InventoryCodeBooked;
})
```

Anchored at M `#"Added Conditional Column"` (line 138).

#### S8. Post code never carries the " Premiere" suffix

```ts
output.every(s => !s.post_code.includes(' Premiere'))
```

Anchored at M `#"Replaced Value1"` (line 142).

#### S9. Post code is in the curated set or "ROS"

```ts
output.every(s =>
  s.post_code === 'ROS' ||
  /Pregame|In Game|Postgame|Backstage|Compacto|Encore/.test(s.post_code)
)
```

Anchored at M `#"Added Conditional Column2"` (line 141).

#### S10. Booked impressions are reported in thousands (raw / 1000)

```ts
output.every((s, i) =>
  approxEq(s.booked_impressions, input[matchIdx(i)].BookedImpressions / 1000, 0.001)
)
```

Anchored at M `#"Divided Column"` (line 149).

#### S11. FL flag is "FL" iff InventoryCodePlaced contains "Timeout"

```ts
output.every(s =>
  s.fl_flag === (s.InventoryCodePlaced.includes('Timeout') ? 'FL' : 'P')
)
```

Anchored at M `#"Added Conditional Column5"` (line 150).

#### S12. HTS flag is "HTS" iff AEFullName contains "HomeTeamSports"

```ts
output.every(s =>
  s.hts_flag === (s.AEFullName.includes('HomeTeamSports') ? 'HTS' : 'Non-HTS')
)
```

Anchored at M `#"Added Conditional Column6"` (line 151).

#### S13. Period derives from broadcast quarter

```ts
output.every(s => {
  if (s.broadcast_qtr === 'Q4') return s.period === '4Q';
  if (s.broadcast_qtr === 'Q1' || s.broadcast_qtr === 'Q2') return s.period === '1-2Q';
  return s.period === null;
})
```

Anchored at M `#"Added Conditional Column3"` (line 147).

#### S14. SpotRate is non-negative

```ts
output.every(s => s.SpotRate >= 0)
```

Defensive contract — the M chain assumes non-negative rates.

#### S15. AirDate parses to a valid ISO date

```ts
output.every(s => {
  const d = new Date(s.AirDate);
  return !isNaN(d.getTime()) && d.getUTCFullYear() >= 2018;
})
```

Lower bound matches M `#"Filtered Rows"` (line 159) range.

---

## deriveSchedule() — `Lakers Combined Schedules` (M lines 196–233)

Combines historical (`Lakers Historical Schedules`, line 155) and
current-year (`Lakers 21-22 Schedule`, line 163) schedules and unpivots
each game into one row per inventory type. Adds `+/-` half-hour-modulo
variant, `Simulcast` flag, `Expanded` format classification, `Matchup`
tier, broadcast calendar columns, and a logical `Avails Key`.

#### G1. Three INV TYPE rows per source game

```ts
const gamesByDate = groupBy(output, r => `${r.DATE}|${r['EVENT/PROGRAM']}`);
gamesByDate.every(g =>
  new Set(g.map(r => r['INV TYPE'])).size === 3 &&
  ['Pregame', 'In Game', 'Postgame'].every(t => g.some(r => r['INV TYPE'] === t))
)
```

Anchored at M `#"Unpivoted Columns"` (line 204) which produces one row
per inv type from the comma-split column.

#### G2. Per-game columns are constant across the three INV TYPE rows

```ts
gamesByDate.every(g =>
  ['DATE', 'OPPONENT', 'START', 'TV', 'OTHER TV', 'TYPE2', 'Matchup', 'Expanded']
    .every(col => new Set(g.map(r => r[col])).size === 1)
)
```

Structural invariant: the unpivot only varies INV TYPE / +/- / INV TYPE.1.

#### G3. +/- variant is set only for In Game and follows half-hour-modulo rule

```ts
output.every(r => {
  if (r['INV TYPE'] !== 'In Game') return r['+/-'] === null;
  const hh = startMinute(r.START) % 30;
  if (hh < 8) return r['+/-'] === '-';
  if (hh > 14) return r['+/-'] === '+';
  return r['+/-'] === null;
})
```

Anchored at M `#"Added Custom2"` (line 209). One TS expression replaces
M's three sequential AddColumn steps (Minute → Half Hour → +/-).

#### G4. Simulcast flag derives from OTHER TV emptiness

```ts
output.every(r =>
  r.Simulcast === (r['OTHER TV'] == null || r['OTHER TV'] === '' ? 'Exclusive' : 'Simulcast')
)
```

Anchored at M `#"Added Conditional Column"` (line 212).

#### G5. Expanded format domain is closed

```ts
output.every(r =>
  ['Standard', 'Expanded', 'DH', 'Expanded DH'].includes(r.Expanded)
)
```

Anchored at M `#"Added Conditional Column3"` (line 217).

#### G6. Matchup tier is deterministic from opponent

```ts
const REGIONAL = new Set(['Giants', 'Padres', 'Angels']);
output.every(r => {
  const opp = r.OPPONENT;
  const isRegional = [...REGIONAL].some(t => opp.includes(t));
  return r.Matchup === (isRegional ? 'Regional' : 'Standard');
})
```

Anchored at M `#"Added Conditional Column4"` (line 218). The set is
fixed in the M code (Giants, Padres, Angels). Note: synthetic data
may use the team list directly; real data uses the opponent name.

#### G7. INV TYPE.1 is INV TYPE concatenated with +/- (or just INV TYPE)

```ts
output.every(r =>
  r['INV TYPE.1'] === (r['+/-'] != null ? r['INV TYPE'] + r['+/-'] : r['INV TYPE'])
)
```

Anchored at M `#"Inserted Merged Column"` (line 219).

#### G8. TYPE2 ∈ {"PR", "REG"} and matches "PRE" prefix in #

```ts
output.every(r => {
  const isPR = String(r['#']).includes('PRE');
  return r.TYPE2 === (isPR ? 'PR' : 'REG');
})
```

Anchored at M `#"Added Conditional Column1"` (line 177) in the 21-22
schedule query.

#### G9. Output excludes any row with "(Confirmed Exclusive)" in TV

```ts
output.every(r => !r.TV.includes('(Confirmed Exclusive)'))
```

Anchored at M `#"Filtered Rows3"` (line 192) and the equivalent filter
on Combined Schedules (line 231).

#### G10. Output excludes OFF DAY rows

```ts
output.every(r => r['#'] != null && r.TIME !== 'OFF DAY')
```

Anchored at M `#"Filtered Rows"` (line 172) which filters
non-numeric/non-PRE `#` values.

#### G11. DATE > 2019-12-29

```ts
output.every(r => new Date(r.DATE).getTime() > new Date('2019-12-29').getTime())
```

Anchored at M `#"Filtered Rows1"` (line 229).

#### G12. PR games carry "PR: " prefix on EVENT/PROGRAM

```ts
output.every(r =>
  (r.TYPE2 === 'PR') === r['EVENT/PROGRAM'].startsWith('PR: ')
)
```

Anchored at M `#"Added Conditional Column2"` (line 226) and the
subsequent merge.

#### G13. NonSpectrum + In Game rows are excluded

```ts
output.every(r => !(r.TV !== 'SNLA' && r['INV TYPE'] === 'In Game'))
```

Anchored at M `#"Filtered Rows"` (line 225). Synthetic data is
all-Spectrum so this is a defensive contract.

#### G14. DATE and START are valid

```ts
output.every(r =>
  !isNaN(new Date(r.DATE).getTime()) && r.START != null
)
```

#### G15. Avails Key is the deterministic concatenation

```ts
output.every(r =>
  r['Avails Key'] === [r.TYPE, r.TYPE2, r['INV TYPE.1'], r.Expanded].join('.')
)
```

Anchored at M `#"Inserted Merged Column1"` (line 220).

---

## deriveSpotsByClient() — `Lakers by Client (Inc $0)` (M lines 243–253)

Performs a left outer join from `deriveSchedule` (left) onto
`deriveSpots` (right) on `SPOT KEY = DATE.INV TYPE`. Schedule rows
without matching spots are preserved with zero-filled spot fields. We
implement the join on the tuple `[DATE, INV TYPE]` directly; no
literal SPOT KEY string is required.

#### C1. Output preserves every schedule row at least once

```ts
const scheduleKeys = new Set(schedule.map(r => `${r.DATE}|${r['INV TYPE']}`));
const outputKeys = new Set(output.map(r => `${r.DATE}|${r['INV TYPE']}`));
[...scheduleKeys].every(k => outputKeys.has(k))
```

Anchored at M `Table.NestedJoin(... LeftOuter)` (line 244).

#### C2. Every output row has non-null DATE / EVENT/PROGRAM / INV TYPE

```ts
output.every(r => r.DATE != null && r['EVENT/PROGRAM'] != null && r['INV TYPE'] != null)
```

#### C3. $0 column derives from spot rate

```ts
output.every(r => r['$0'] === (r['Lakers Spot Data 19-22.SpotRate'] > 0 ? 'Paid' : '$0'))
```

Anchored at M `#"Added Conditional Column"` (line 247).

#### C4. Numeric spot fields default to 0 (not null/undefined) on unmatched schedule rows

```ts
const NUMERIC_FIELDS = [
  'Lakers Spot Data 19-22.SpotRate',
  'Lakers Spot Data 19-22.BookedRating',
  'Lakers Spot Data 19-22.BookedImpressions',
  'Lakers Spot Data 19-22.CPP',
  'Lakers Spot Data 19-22.TotalEquivSold',
  'Lakers Spot Data 19-22.EffectiveUnitRate',
  'Lakers Spot Data 19-22.SpotRate (Net)',
];
output.every(r =>
  NUMERIC_FIELDS.every(f => typeof r[f] === 'number' && !isNaN(r[f]))
)
```

Anchored at M `#"Convert value nulls to 0"` (line 246).

#### C5. After Today flag is correct relative to "today"

```ts
output.every(r => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const air = r['Lakers Spot Data 19-22.AirDate']
    ? new Date(r['Lakers Spot Data 19-22.AirDate']) : null;
  const expected = air != null && air.getTime() > today.getTime() ? 1 : 0;
  return r['After Today'] === expected;
})
```

Anchored at M `#"Added Custom"` (line 251).

#### C6. Every spot's joined schedule row exists with matching SPOT KEY

```ts
const enrichedSpots = deriveSpots(rawSpots);
const scheduleKeys = new Set(schedule.map(r => `${r.DATE}|${r['INV TYPE']}`));
enrichedSpots
  .filter(s => scheduleKeys.has(`${s.AirDate}|${s.inventory_type}`))
  .every(s => {
    const matchedRows = output.filter(r =>
      r.DATE === s.AirDate && r['INV TYPE'] === s.inventory_type &&
      r['Lakers Spot Data 19-22.OrderNumber'] === s.OrderNumber
    );
    return matchedRows.length >= 1;
  })
```

Anchored at the join behavior (line 244). Pairs with the unmatched-
spots query (M line 368), which collects the right-anti complement.

#### C7. $0 = "Paid" implies SpotRate > 0

```ts
output.filter(r => r['$0'] === 'Paid')
  .every(r => r['Lakers Spot Data 19-22.SpotRate'] > 0)
```

Tautology of C3 — kept as an independent assertion since this
invariant is what the AUR-Summary spot-group classifier relies on.

#### C8. $0 = "$0" implies SpotRate === 0

```ts
output.filter(r => r['$0'] === '$0')
  .every(r => r['Lakers Spot Data 19-22.SpotRate'] === 0)
```

Tautology of C3, retained for the same reason.

#### C9. Schedule rows without matching spots produce zero-spot rows

```ts
schedule
  .filter(s => !enrichedSpots.some(r =>
    r.AirDate === s.DATE && r.inventory_type === s['INV TYPE']))
  .every(s => {
    const placeholder = output.find(r =>
      r.DATE === s.DATE && r['INV TYPE'] === s['INV TYPE']);
    return placeholder &&
      placeholder['Lakers Spot Data 19-22.SpotRate'] === 0 &&
      placeholder['Lakers Spot Data 19-22.TotalEquivSold'] === 0;
  })
```

Anchored at the LeftOuter semantics of line 244.

#### C10. Output row count = matched spot count + unmatched schedule row count

```ts
const matched = enrichedSpots.filter(s =>
  scheduleKeys.has(`${s.AirDate}|${s.inventory_type}`)).length;
const unmatchedSchedule = schedule.length -
  countSchedulesWithMatchingSpot(schedule, enrichedSpots);
output.length === matched + unmatchedSchedule
```

#### C11. SPOT KEY referential integrity

```ts
output.every(r =>
  schedule.some(s => s.DATE === r.DATE && s['INV TYPE'] === r['INV TYPE'])
)
```

Every output row's `(DATE, INV TYPE)` tuple corresponds to a real
schedule row.

#### C12. CPP nulled back out post-replace

```ts
output.every(r =>
  r['Lakers Spot Data 19-22.CPP'] === null ||
  typeof r['Lakers Spot Data 19-22.CPP'] === 'number' &&
  r['Lakers Spot Data 19-22.CPP'] !== 0
)
```

Anchored at M `#"Replaced Value"` (line 248) which converts CPP=0
back to null after the bulk null→0 fill.

---

## deriveInventory() — `Inventory (Exc $0)` / `Inventory (Inc $0)` (M lines 255–347)

Per-game-per-inv-type rollup with rate-tier resolution and rate-card
join. The Exc-$0 variant filters paid spots only before grouping; the
Inc-$0 variant groups everything. Both share the post-grouping logic.

### Sign convention

The M code defines `Oversell = Avails - Sold` (positive when avails
remain). The data model uses `oversell_eq30 = sold - cap` (positive
when over cap). Contracts below state the rule both ways for
clarity; the implementation may use either internally.

### Contracts

#### I1. Exactly four INV TYPE rows per game

```ts
const gamesByPair = groupBy(output, r => `${r.DATE}|${r['EVENT/PROGRAM']}`);
gamesByPair.every(g =>
  new Set(g.map(r => r['INV TYPE'])).size === 4 &&
  ['Pregame', 'In Game', 'Postgame', 'Floaters A&B'].every(t =>
    g.some(r => r['INV TYPE'] === t))
)
```

Anchored at M `#"Unpivoted Columns"` (line 268) which splits "In Game"
into "In Game" and "Floaters A&B".

#### I2. Cap = 6 for Floaters A&B, else from Inventory Table

```ts
output.every(r =>
  r['INV TYPE'] === 'Floaters A&B'
    ? r.Cap === 6
    : approxEq(r.Cap, capacityLookup(r['Avails Key']), 0.01)
)
```

Anchored at M `#"Added Custom10"` (line 286).

#### I3. Floater Sold derives from In Game oversell

```ts
output
  .filter(r => r['INV TYPE'] === 'Floaters A&B')
  .every(r => {
    const inGameRow = inGameSiblingOf(r, output);
    const m_oversell = inGameRow.Avail_initial - inGameRow.Primary_Sold; // M sign
    const expected = m_oversell < 0 ? -m_oversell : 0;
    return approxEq(r.Sold, expected, 0.01);
  })
```

Anchored at M `#"Added Custom9"` (FL Sold) and `#"Added Custom11"`
(Sold) (lines 285, 287).

#### I4. Sold for non-Floaters = sum of TotalEquivSold from joined paid spots

```ts
output
  .filter(r => r['INV TYPE'] !== 'Floaters A&B')
  .every(r => {
    const matched = spotsByClient.filter(s =>
      s.DATE === r.DATE && s['EVENT/PROGRAM'] === r['EVENT/PROGRAM'] &&
      s['INV TYPE'] === r['INV TYPE']);
    const expected = sum(matched, s => s['Lakers Spot Data 19-22.TotalEquivSold']);
    return approxEq(r.Sold, expected, 0.01);
  })
```

Anchored at M `#"Grouped Rows"` aggregator (line 260).

#### I5. Sellout = Sold / Cap

```ts
output.every(r => approxEq(r.Sellout, r.Sold / r.Cap, 1e-4))
```

Anchored at M `#"Added Custom12"` (line 289).

#### I6. Rate Tier follows the M rule

In the M sign convention (`Oversell = Avails - Sold`):

```
INV TYPE = 'In Game' && Oversell > 0   → 'Base'
INV TYPE = 'In Game' && Oversell > -6  → 'FL'
INV TYPE = 'In Game' && Oversell <= -6 → 'Bump'
else if Avail > 0                       → 'Base'
else                                    → 'Bump'
```

Equivalent in `oversell_eq30 = sold - cap` form:

```
INV TYPE = 'In Game' && oversell_eq30 < 0  → 'Base'
INV TYPE = 'In Game' && 0 <= oversell_eq30 < 6 → 'FL'
INV TYPE = 'In Game' && oversell_eq30 >= 6 → 'Bump'
else if cap - sold > 0                      → 'Base'
else                                        → 'Bump'
```

Predicate (using M sign internally):

```ts
output.every(r => {
  const m_oversell = r.Avails_raw - r.Primary_Sold;
  const expected =
    r['INV TYPE'] === 'In Game'
      ? m_oversell > 0 ? 'Base' : m_oversell > -6 ? 'FL' : 'Bump'
      : r.Avail > 0 ? 'Base' : 'Bump';
  return r['Rate Tier'] === expected;
})
```

Anchored at M `#"Added Custom7"` (line 276).

#### I7. Pregame / Postgame / Floaters A&B never resolve to FL

```ts
output
  .filter(r => r['INV TYPE'] !== 'In Game')
  .every(r => r['Rate Tier'] !== 'FL')
```

Corollary of I6 — explicitly asserted because the rate card has no
FL row for non-In-Game inv types.

#### I8. Rate (looked up from Dynamic Rates) is non-negative

```ts
output.every(r => r['Dynamic Rates.Rate'] >= 0)
```

Anchored at M `#"Expanded Dynamic Rates"` (line 279).

#### I9. Floaters A&B rows have zeroed Gross/Net/EUR/AUR

```ts
output
  .filter(r => r['INV TYPE'] === 'Floaters A&B')
  .every(r =>
    r['Gross Rev'] === 0 && r['Net Rev'] === 0 &&
    r.eur_gross_cents === 0 && r.eur_net_cents === 0 && r.aur_cents === 0)
```

Anchored at M `#"Added Conditional Column"` through `#"Added
Conditional Column5"` (lines 292–296). Floater capacity is tracked
without double-counting revenue.

#### I10. Net Rev = Gross Rev × 0.85 for non-Floater rows

```ts
output
  .filter(r => r['INV TYPE'] !== 'Floaters A&B' && r['Gross Rev'] > 0)
  .every(r => approxEq(r['Net Rev'], r['Gross Rev'] * 0.85, 1.0))
```

Aggregation may introduce up to ~$1 of float drift; tolerance set
accordingly.

#### I11. eur_gross_cents = sum(gross_rev) / sum(total_eq30) over paid spots

Volume-weighted, sales-facing EUR. Surfaces in the Inventory view's
"EUR (Gross)" column and in the Rates view. Stored in integer cents.

**Scope: paid spots only.** A "paid spot" is a row whose `$0` column
resolves to `"Paid"` — equivalently, `spot.SpotRate > 0`. NC, ADU,
xADU, and Bonus spots are excluded from **both** the numerator and
the denominator. EUR is a yield metric (realized rate per unit of
inventory sold), not a capacity-utilization metric; including
non-revenue eq30 in the denominator would dilute it.

```ts
output
  .filter(r => r['INV TYPE'] !== 'Floaters A&B')
  .every(r => {
    const paid = spotsByClient.filter(s =>
      s.DATE === r.DATE && s['EVENT/PROGRAM'] === r['EVENT/PROGRAM'] &&
      s['INV TYPE.1'] === r['INV TYPE'] &&
      s['spot.SpotRate'] > 0);
    const sumGross = sum(paid, s => s['spot.SpotRate']);
    const sumEq30 = sum(paid, s => s['spot.TotalEquivSold']);
    const expected = sumEq30 > 0 ? Math.round(sumGross / sumEq30 * 100) : 0;
    return Math.abs(r.eur_gross_cents - expected) <= 1;
  })
```

This **replaces** the prior I11 contract (M-style `mean(EffectiveUnitRate)`).
The mean-of-means form double-weights low-volume cells and is statistically
incorrect for non-uniform aggregation windows; the volume-weighted form is
the spec definition and what the views display. Rationale anchored at M
`#"Grouped Rows"` (line 260) but corrected to use sum/sum rather than
`List.Average` of per-spot EUR.

#### I12. eur_net_cents = sum(net_rev) / sum(total_eq30) over paid spots

Volume-weighted, AUR-facing EUR. Surfaces in the AUR Report view's
"EUR (Net)" column. Stored in integer cents.

**Scope: paid spots only**, same as I11. NC, ADU, xADU, and Bonus
spots are excluded from both numerator and denominator.

```ts
output
  .filter(r => r['INV TYPE'] !== 'Floaters A&B')
  .every(r => {
    const paid = spotsByClient.filter(s =>
      s.DATE === r.DATE && s['EVENT/PROGRAM'] === r['EVENT/PROGRAM'] &&
      s['INV TYPE.1'] === r['INV TYPE'] &&
      s['spot.SpotRate'] > 0);
    const sumNet = sum(paid, s => s['spot.SpotRate (Net)']);
    const sumEq30 = sum(paid, s => s['spot.TotalEquivSold']);
    const expected = sumEq30 > 0 ? Math.round(sumNet / sumEq30 * 100) : 0;
    return Math.abs(r.eur_net_cents - expected) <= 1;
  })
```

This **replaces** the prior I12 contract (M-style `mean(SpotRate)`,
which was actually documenting a gross-based unit-rate metric of
the same broken mean-of-means shape). The two EUR variants —
gross and net — are maintained explicitly because sales leadership
(Inventory / Rates views) and yield/finance leadership (AUR Report)
need different views of the same data; the M code maintains both
deliberately.

#### I13. Inc-$0 row count >= Exc-$0 row count

```ts
deriveInventory(input, { include0: true }).length >=
  deriveInventory(input, { include0: false }).length
```

Inc-$0 keeps spots with rate == 0 in the grouping; those spots
contribute eq30 but no revenue.

#### I14. Start of Week is the Monday on or before DATE

```ts
output.every(r => {
  const d = new Date(r.DATE);
  const dow = d.getUTCDay(); // 0=Sun .. 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  const expected = new Date(d); expected.setUTCDate(d.getUTCDate() + offset);
  return r['Start of Week'] === expected.toISOString().slice(0, 10);
})
```

Anchored at M `#"Inserted Start of Week"` (line 280).

#### I15. Rate Key is the deterministic concatenation

```ts
output.every(r =>
  r['Rate Key'] === [r.TYPE2, r['INV TYPE'], r.Matchup, r['Rate Tier']].join('.')
)
```

Anchored at M `#"Inserted Merged Column"` (line 277). Implementation
may join on the tuple instead of the literal string.

#### I16. aur_cents = sum(net_rev) / count(paid_spots) over paid spots

Volume-weighted in numerator, count-based in denominator. Length-
agnostic — :15s drag the value down, :60s push it up. Surfaces in the
AUR Report view alongside `eur_net_cents`. Stored in integer cents.

**Scope: paid spots only**, same as I11/I12. NC, ADU, xADU, and Bonus
spots are excluded from both numerator and denominator (the count is
of paid spots, not of all spots).

```ts
output
  .filter(r => r['INV TYPE'] !== 'Floaters A&B')
  .every(r => {
    const paid = spotsByClient.filter(s =>
      s.DATE === r.DATE && s['EVENT/PROGRAM'] === r['EVENT/PROGRAM'] &&
      s['INV TYPE.1'] === r['INV TYPE'] &&
      s['spot.SpotRate'] > 0);
    const sumNet = sum(paid, s => s['spot.SpotRate (Net)']);
    const expected = paid.length > 0 ? Math.round(sumNet / paid.length * 100) : 0;
    return Math.abs(r.aur_cents - expected) <= 1;
  })
```

The M chain's `List.Average(SpotRate)` was a statistically broken
proxy for this: per-cell mean-of-spot-rates is sensitive to row count
in the joined table (which depends on whether $0 rows are excluded
during aggregation), but `sum(net) / count(paid)` is invariant. The
volume-weighted form is what the AUR Report actually wants.

---

## deriveAurSummary() — `AUR Summary` (M lines 393–428)

The highest-stakes pivot. Decomposes spots into a per-(DATE × INV
TYPE) wide-format row with one column per (LOB Group × Spot Group ×
metric) bucket. LOB Group is `HTS` or `Non-HTS`; Spot Group is
`Paid`, `NC`, `ADU`, `Cross Property ADU`, or `Bonus`. For non-Paid
groups only `EQ30` is carried; for Paid all three of `Gross REV`,
`Net REV`, and `EQ30` are carried.

Pay extra attention to **null handling** (every empty intersection
must become `0`, never `undefined`) and **sum invariants** (totals
must equal the LOB-group decomposition exactly).

#### A1. Floaters A&B is excluded from output

```ts
output.every(r => r['INV TYPE'] !== 'Floaters A&B')
```

Anchored at M `#"Filtered Rows2"` (line 419).

#### A2. Every output row has a complete column set with no nulls

```ts
const REQUIRED_COLUMNS = [
  'HTS Paid.EQ30', 'HTS Paid.Gross REV', 'HTS Paid.Net REV',
  'HTS NC.EQ30', 'HTS ADU.EQ30', 'HTS Cross Property ADU.EQ30', 'HTS Bonus.EQ30',
  'Non-HTS Paid.EQ30', 'Non-HTS Paid.Gross REV', 'Non-HTS Paid.Net REV',
  'Non-HTS NC.EQ30', 'Non-HTS ADU.EQ30', 'Non-HTS Cross Property ADU.EQ30',
  'Non-HTS Bonus.EQ30',
  'Total Paid.EQ30', 'Total Paid.Gross REV', 'Total Paid.Net REV',
  'Total NC.EQ30', 'Total ADU.EQ30', 'Total Cross Property ADU.EQ30',
  'Total Bonus.EQ30',
  'HTS Total.EQ30', 'Non-HTS Total.EQ30', 'Total Total.EQ30',
  'Sellout', 'Sellout + ADU', 'Avails',
];
output.every(r =>
  REQUIRED_COLUMNS.every(col => typeof r[col] === 'number' && !isNaN(r[col]))
)
```

**Critical null-handling contract.** Anchored at the two M
`Replaced Value` steps (lines 408 and 416) and the post-pivot fills.

#### A3. Total = HTS + Non-HTS for every (Spot Group, metric) pair

```ts
const PAIRS = [
  'Paid.EQ30', 'Paid.Gross REV', 'Paid.Net REV',
  'NC.EQ30', 'ADU.EQ30', 'Cross Property ADU.EQ30', 'Bonus.EQ30',
];
output.every(r =>
  PAIRS.every(pair =>
    approxEq(r[`Total ${pair}`], r[`HTS ${pair}`] + r[`Non-HTS ${pair}`], 0.01)
  )
)
```

**Critical sum contract.** Anchored at M `Inserted Addition` ×7
(lines 409–415).

#### A4. Spot Group classifier is deterministic from PriorityCode and SpotRate

Predicate over the underlying `spotsByClient` rows, asserted before
the second grouping (line 401):

```ts
spotsByClient.forEach(s => {
  const expected =
    s['$0'] === 'Paid' ? 'Paid' :
    s['Lakers Spot Data 19-22.PriorityCode'] === 'P-80' ? 'NC' :
    s['Lakers Spot Data 19-22.PriorityCode'] === 'P-19' ? 'NC' :
    s['Lakers Spot Data 19-22.PriorityCode'] === 'P-09' ? 'ADU' :
    s['Lakers Spot Data 19-22.PriorityCode'] === 'P-08' ? 'Cross Property ADU' :
    s['Lakers Spot Data 19-22.PriorityCode'] === 'P-04' ? 'Bonus' :
    null;
  // every spot's contribution to the AUR Summary buckets must match `expected`
});
```

Anchored at M `#"Added Conditional Column1"` (line 400).

#### A5. LOB Group classifier is deterministic from AEFullName

```ts
spotsByClient.forEach(s => {
  const expected =
    (s['Lakers Spot Data 19-22.AEFullName'] || '').includes('HomeTeamSports')
      ? 'HTS' : 'Non-HTS';
  // contributes to the matching `expected` bucket only
});
```

Anchored at M `#"Added Conditional Column"` (line 399).

#### A6. Sellout = (Total Paid.EQ30 + Total NC.EQ30) / Avails

```ts
output.every(r =>
  approxEq(r.Sellout, (r['Total Paid.EQ30'] + r['Total NC.EQ30']) / r.Avails, 1e-4)
)
```

Anchored at M `#"Added Custom1"` (line 425).

#### A7. Sellout + ADU includes ADU and Cross Property ADU

```ts
output.every(r =>
  approxEq(
    r['Sellout + ADU'],
    (r['Total Paid.EQ30'] + r['Total NC.EQ30'] +
     r['Total ADU.EQ30'] + r['Total Cross Property ADU.EQ30']) / r.Avails,
    1e-4
  )
)
```

Anchored at M `#"Added Custom2"` (line 426).

#### A8. Sellout + ADU >= Sellout

```ts
output.every(r => r['Sellout + ADU'] >= r.Sellout - 1e-9)
```

Algebraic corollary — adding non-negative terms never decreases the
ratio.

#### A9. All EQ30 columns are >= 0

```ts
const EQ30_COLS = REQUIRED_COLUMNS.filter(c => c.endsWith('.EQ30'));
output.every(r => EQ30_COLS.every(c => r[c] >= 0))
```

#### A10. All Revenue columns are >= 0

```ts
const REV_COLS = REQUIRED_COLUMNS.filter(c => c.includes('.Gross REV') || c.includes('.Net REV'));
output.every(r => REV_COLS.every(c => r[c] >= 0))
```

#### A11. Per-LOB Net REV ≈ Gross REV × 0.85 (Paid only)

```ts
output.every(r =>
  approxEq(r['HTS Paid.Net REV'], r['HTS Paid.Gross REV'] * 0.85, 1.0) &&
  approxEq(r['Non-HTS Paid.Net REV'], r['Non-HTS Paid.Gross REV'] * 0.85, 1.0) &&
  approxEq(r['Total Paid.Net REV'], r['Total Paid.Gross REV'] * 0.85, 1.0)
)
```

Anchored at the M `SpotRate (Net) = SpotRate * 0.85` definition
(line 135) propagated through aggregation.

#### A12. Avails resolves for every output row

```ts
output.every(r => r.Avails != null && r.Avails > 0)
```

Anchored at M `#"Merged Queries"` (line 417). Rows for which the
join fails would carry `null` Avails and divide-by-zero in Sellout
— this contract guards against that.

#### A13. HTS Total.EQ30 = sum of HTS spot-group EQ30 buckets

```ts
output.every(r =>
  approxEq(
    r['HTS Total.EQ30'],
    r['HTS Bonus.EQ30'] + r['HTS Cross Property ADU.EQ30'] +
    r['HTS ADU.EQ30'] + r['HTS NC.EQ30'] + r['HTS Paid.EQ30'],
    0.01
  )
)
```

Anchored at M `#"Added Custom4"` (line 423).

#### A14. Non-HTS Total.EQ30 = sum of Non-HTS spot-group EQ30 buckets

```ts
output.every(r =>
  approxEq(
    r['Non-HTS Total.EQ30'],
    r['Non-HTS Bonus.EQ30'] + r['Non-HTS Cross Property ADU.EQ30'] +
    r['Non-HTS ADU.EQ30'] + r['Non-HTS NC.EQ30'] + r['Non-HTS Paid.EQ30'],
    0.01
  )
)
```

Anchored at M `#"Added Custom3"` (line 422).

#### A15. Total Total.EQ30 = HTS Total.EQ30 + Non-HTS Total.EQ30

```ts
output.every(r =>
  approxEq(r['Total Total.EQ30'], r['HTS Total.EQ30'] + r['Non-HTS Total.EQ30'], 0.01)
)
```

Anchored at M `#"Added Custom"` (line 424).

#### A16. Spots with PriorityCode outside the classifier set are excluded

```ts
const KNOWN = new Set(['P-04', 'P-08', 'P-09', 'P-19', 'P-80']);
spotsByClient.forEach(s => {
  const pc = s['Lakers Spot Data 19-22.PriorityCode'];
  const paid = s['$0'] === 'Paid';
  if (!paid && !KNOWN.has(pc)) {
    // this spot must NOT contribute to any AUR Summary bucket
  }
});
```

Anchored at M `#"Filtered Rows"` (line 402) where rows with null
Spot Group are dropped.

#### A17. Primary Avails Key is the deterministic concatenation used for the Inventory Table join

```ts
output.every(r =>
  r['Primary Avails Key'] === [r.TYPE, r.TYPE2, r['INV TYPE'], r.Expanded].join('.')
)
```

Anchored at M `#"Inserted Merged Column"` (line 397). Implementation
may use a tuple lookup instead of the string key.

#### A18. Output row count equals number of (DATE × INV TYPE × broadcast-cal) tuples that have at least one classified spot

```ts
const expected = new Set(
  spotsByClient
    .filter(s => spotGroupOf(s) != null)
    .map(s => `${s.DATE}|${s['INV TYPE']}|${s['Broadcast Calendar.Broadcast Year']}|${s['Broadcast Calendar.Broadcast Month']}`)
).size;
output.length === expected
```

Anchored at the second `#"Grouped Rows1"` (line 401) followed by the
null-Spot-Group filter (line 402).

---

## Validator entry point

`src/lib/etl-validate.ts` exports a single `runContracts` function. It
accepts the four parsed source tables plus the five ETL outputs and
runs every contract above. The result is a list of `ContractResult`
objects with `id`, `summary`, `passed`, and (on failure) a `reason`
plus a representative `sample` row. The orchestrator
`scripts/generate-data.ts` exits non-zero on any failure, printing one
line per failing contract.

Contracts are ordered by ID (S1, S2, ..., G1, ..., A18). Implementation
may parallelize independent contracts but failure messages print in
ID order.

## Future maintenance

When adding a new contract:

1. Allocate the next ID in the appropriate prefix (S/G/C/I/A).
2. Anchor the contract to a specific M line range or rule. If a
   contract has no anchor in the M source, mark it "Defensive" so
   reviewers know it is implementation-driven, not spec-driven.
3. If the contract is a sum / decomposition rule (like A3, A13–A15),
   prefer expressing it as an algebraic identity over the output
   columns rather than re-deriving from the input.
4. Set the floating-point tolerance based on the magnitude of the
   numbers involved: 1e-4 for ratios in [0,1], 0.01 for cents,
   1.0 for aggregated currency over many spots.

When removing a contract: leave the ID retired, do not renumber.
