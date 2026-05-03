# Synthetic Data Specification

## Overview

A deterministic Node.js generator under `scripts/generator/` produces
the four source files in `/data` from a single seed. Running
`npm run generate-data` is reproducible — same seed always produces
the same output. The orchestrator also runs the ETL and the contracts
validator after generation.

The generator's job is the **source files only**. All derived shapes
(per-game rollups, AUR summary, etc.) are computed from those source
files at build time by `src/lib/etl.ts`. See `01-data-model.md` for
the source schemas and `05-etl-contracts.md` for the property-based
ETL invariants.

## Determinism

- Use `seedrandom` (npm: `seedrandom`) for all random draws
- Single top-level seed: `'rsn-yield-platform-v1'`
- All sub-generators receive a derived seed via
  `seedrandom(topSeed + ':' + namespace)` so changes to one section
  don't shift all downstream randomness
- Per-game RNG (`rngForKey(namespace, game_id)`) for any sub-routine
  whose distribution must stay stable when sampling order elsewhere
  shifts

## Generator order

1. `01-schedule.ts` — generate `data/schedule.csv` (25 PR + 145 REG
   games in 10-column Master Game Schedule format)
2. `02-spots.ts` — generate `data/spots.csv` (~18,000 rows in 29-column
   Wide Orbit format)
3. `03-copy-source.ts` — copy `Inventory_Table_synthetic.xlsx` and
   `Dynamic_Rates_synthetic.xlsx` from `docs/reference/` into `/data`

After generation, `scripts/generate-data.ts` parses the four source
files, runs the ETL, runs the property-based contracts validator
(`src/lib/etl-validate.ts`), then runs the distributional validator
(`src/lib/etl-distributional.ts`). Any contract or distributional
miss fails the build with a non-zero exit code.

## 1. Schedule generator (01-schedule.ts)

Outputs `data/schedule.csv` in the 10-column Master Game Schedule shape.
Sentinels (the fictional home team) plays real MLB opponents from
`scripts/generator/_opponents.ts`. The Regional set is fixed to
{Giants, Padres, Angels} per the M chain.

### Inputs
- 29 real MLB opponents (3 Regional, 26 Standard) from `_opponents.ts`
- Calendar window: Feb 21 (PR start) through end of September (REG end)

### Algorithm

**PR phase (25 games, ~5 weeks late Feb to mid-March):**
- 5–6 games per week
- All Standard format
- Mostly day games (12:05pm / 1:05pm) with occasional 5:05pm / 6:10pm games
- Mix of "vs." (home) and "at" (away) — roughly 50/50
- Opponents: rotate through the full pool, regional appear ~2x each, standard ~1–2x each
- No simulcast in PR

**REG phase (145 games, late March through end of September):**

Series structure:
- Generate as 3-game and 4-game series
- Off-days: target 1 per week (typically Mon or Thu)
- Home and away series alternate in blocks of 6–10 games
- Series count: ~50 series (mix of 3-game and 4-game)

Opponent distribution per season:
- 3 Regional opponents: 6 series each = 18 series, ~57 games (39% of REG)
- 11 Standard opponents: average 2.9 series each = 32 series, ~88 games (61% of REG)

Day-of-week distribution (target):

| Day | Frequency |
|-----|-----------|
| Sat | 16.9% |
| Fri | 16.4% |
| Tue | 16.1% |
| Sun | 15.9% |
| Wed | 15.3% |
| Mon | 10.1% |
| Thu | 9.4% |

Start time distribution:
- Home games: 7:10 PM (60%), 1:10 PM (15%), 6:10 PM (10%), 4:10 PM (10%), other (5%)
- Away East Coast: 4:10 PM (4:10/4:05/4:07 PM Pacific)
- Away Central: 5:10 PM
- Away Mountain: 6:10 PM
- Away West Coast: 7:10 PM
- Away day game: 10:05 AM / 1:05 PM (Sundays especially)

In Game variant target after applying half-hour-modulo:
- In Game (baseline): 79%
- In Game-: 11%
- In Game+: 10%

Format and simulcast:
- ~95% Standard format / Exclusive
- ~5% Expanded format / Simulcast (drawn from network partners ESPN, TBS, MLBN, FS1)
- Simulcasts cluster on Sundays and prime weekend nights
- Network partner sampled randomly for simulcasts: 30% MLBN, 25% TBS, 25% ESPN, 20% FS1

Matchup tier assignment:
- Regional opponent → Regional matchup
- Standard opponent → Standard matchup

Validate that the schedule produces the day-of-week, In Game variant, and simulcast distributions within ±2% of targets.

## 2. Demand model (used by 02-spots.ts)

A scalar `demand_score ∈ [0, 1]` per game-inventory cell drives fill rate, oversell probability, and rate tier resolution.

### Computation

```
demand_score = clip(
  base_demand
  × matchup_multiplier
  × dow_multiplier
  × month_multiplier
  × inv_type_multiplier
  × format_multiplier
  × series_position_multiplier
  + noise(σ=0.03),
  0.0, 1.0
)
```

### Multipliers

**base_demand**: 0.92 (calibrated against the validation targets in §5; the
center-of-gravity that lands ~30% of In Game cells under cap, ~50% in the
0–20% over band, and ~20% beyond Bump)

**matchup_multiplier**:
- Regional: 1.15
- Standard: 0.95

**dow_multiplier**:
- Sat: 1.10
- Fri: 1.08
- Sun: 1.05
- Tue: 0.98
- Wed: 0.96
- Mon: 0.88
- Thu: 0.85

**month_multiplier** (drives the season arc):
- Feb (PR): 0.55
- March (PR + REG opener): 0.65
- April: 0.78
- May: 0.85
- June: 0.92
- July: 0.97
- August: 1.02
- September: 1.08 (peak — pennant push)

**inv_type_multiplier**:
- In Game (incl. ± variants): 1.00
- Pregame: 0.85
- Postgame: 0.65

(Floaters A&B was collapsed into In Game in 2026; the +3 eq30 of
term-break capacity is now part of the In Game primary cap and the
FL band is contingent capacity surfaced via tier resolution, not a
separate inv-type.)

**format_multiplier**:
- Standard: 1.00
- Expanded: 1.04 (slight lift from national broadcast spillover)

**series_position_multiplier** (subtle):
- Game 1 of series: 1.00
- Game 2: 0.97
- Game 3: 0.95
- Game 4: 0.93

### Mapping to fill rate

```
expected_paid_fill_pct = clip(0.21 + 1.12 × demand_score, 0.0, 1.21)
```

Near-linear curve faithful to the spec anchor at score 0.95 → fill 1.20.
Calibrated against the §5 validation targets so the three sellout-band
percentages (under cap / 0–20% over / >20% over) all land in tolerance.
Reference points produced by the curve:

- demand_score 0.45 → 71% paid fill
- demand_score 0.65 → 94% paid fill
- demand_score 0.75 → 105% paid fill
- demand_score 0.85 → 116% paid fill (FL band)
- demand_score 0.95 → 121% paid fill (capped; Bump territory)

Final paid_eq30 target = expected_paid_fill_pct × cap, with Gaussian noise (σ=2 eq30) applied.

## 3. Spot generator (02-spots.ts)

For each game-inventory cell:

### Step 1: Determine target eq30 fill

`target_paid_eq30 = max(0, sample_from_demand_curve(demand_score))`

### Step 2: Determine spot length mix

Per inventory type:

RSN inventory is overwhelmingly :30s and :15s. :60s appear as a tail
behavior that matches real Wide Orbit exports (~1% of Pregame/Postgame).
:75s and :45s appear in some real exports but are excluded from the
synthetic generator.

**In Game (incl. ± variants):**
- :30s: 96%
- :15s: 4%

**Pregame:**
- :30s: 92%
- :15s: 7%
- :60s: 1%

**Postgame:**
- :30s: 89%
- :15s: 10%
- :60s: 1%

(No separate Floaters A&B mix after the 2026 collapse — what were
floater spots are now ordinary In Game spots and follow the In Game
length mix. Their rate tier resolves to FL or Bump based on cumulative
sellout per Step 3 below.)

### Step 3: Generate paid spots

While remaining_eq30 > 0:
- Sample a client. With probability `uniform_sample_prob = 0.70`, draw the
  client uniformly from the full roster; otherwise draw weighted by
  `client.buying_intensity × inv_type_match_factor × matchup_familiarity`:
  - inv_type_match_factor: client.preferred_inv_type matches → 1.4, mixed → 1.2, mismatch → 1.2
  - matchup_familiarity: clients buy more on Regional games (×1.3 for buying-intensity > 0.5)
  The uniform component lifts the long tail enough to satisfy the
  Top-50 EQ30 share target on a 60-client roster; with the literal
  spec match/mismatch ratios bottom-tier clients collapse below the
  validation floor.
- Sample spot length per the inv-type mix
- Determine rate tier (In Game): cumulative paid eq30 vs primary cap
  - sold ≤ cap → Base
  - 0 < sold − cap ≤ 3 → FL    (3-eq30 floater band; the "second" floater break)
  - sold − cap > 3 → Bump
- Determine rate tier (Pregame / Postgame): Base when avails > 0, else Bump
- Look up gross_rate from rate_card
- Apply spot-length multiplier: :15 = 0.55×, :30 = 1.0×, :60 = 1.85×
- Apply rack-to-sold discount (see "Rate distribution" below)
- Compute net_rate = gross × 0.85
- Decrement remaining_eq30 by spot_length_eq30

#### Rate distribution

Sold rates run below rack rates in real ad sales. Each spot's gross rate
is scaled by a discount multiplier sampled from a Gaussian centred on
the rack-to-sold ratio with a small spread:

```
discount = clip(Gaussian(μ=0.85, σ=0.05), 0.72, 1.0)
gross_rate_cents = rate_card_lookup × length_multiplier × discount
```

Applied to the rate-card lookup before the spot's gross rate is set.
Without this, computed EUR exceeds the §5 targets even when every spot
resolves to Base tier.

### Step 4: Add NC / ADU / xADU / Bonus spots

Independent of paid fill, sample additional spots per inv-type cell.
Probabilities and Poisson rates here are tuned against the 78% paid-spot
share validation target — the literal-rate version (NC 0.35×Pois(2), ADU
0.25×Pois(1.5), xADU 0.10×Pois(1), Bonus 0.20×Pois(2)) lands paid share
near 93% and misses by ~15 points.

NC (contracted bonus):
- Probability: 0.85 per game-inventory-cell having at least one NC spot
- Count when present: Poisson(λ=4.5)
- Spot rate: $0
- Length: same mix as paid

ADU (make-good):
- Probability: 0.55, modulated by demand (lower-demand games skew higher)
- Count when present: Poisson(λ=3.5)
- Skews toward lower-demand games (correlated with low demand_score) — these are make-goods owed from oversell on other games

xADU (cross-property make-good):
- Probability: 0.30
- Count when present: Poisson(λ=2.0)

Bonus (added value):
- Probability: 0.50
- Count when present: Poisson(λ=4.0)

These all generate $0-rate spots with full eq30 contribution. They show up in AUR Report decomposition but do not affect EUR/AUR (which divide by paid only).

### Step 5: Demo and impressions assignment

(The previous "Step 5: Floater spots" was removed in the 2026 model.
The first floater break is folded into the In Game primary cap; the
second floater break is the FL band in tier resolution; the third+
breaks become Bump-tier In Game spots. None of those are emitted as
separate spot rows — they're regular In Game spots whose rate tier
is determined by their position in the cumulative-sellout sequence.)


Per spot, demo_code = client.preferred_demo with 80% probability, otherwise sampled from {HH, A25-54, A18-49, M25-54, A35+, A21-49}.

booked_rating = sample from demand-correlated distribution:
- HH on regional in-game: 1.5–4.0
- HH on standard in-game: 0.8–2.5
- HH on pre/postgame: 0.4–1.8
- Demo-specific (A25-54, etc.): scale by 0.5–0.7× the HH rating

booked_impressions = booked_rating × demo_universe_size × 1000
- demo_universe_size: HH=5500, A25-54=2200, A18-49=2400, M25-54=1100, A35+=2800, A21-49=2300 (in thousands; LA DMA-scaled fictional values)

## 4. Rate card details

Already specified in 01-data-model.md. Generator emits the table directly.

## 5. Validation targets (etl-distributional.ts)

Hard fail the build if any of these miss. Sellout-band targets and EUR
ranges are computed by `src/lib/etl-distributional.ts` against the ETL
output (specifically `inventoryExc0` for the per-cell sellout bands and
the spec-formula EUR/AUR for EUR ranges and AUR-vs-EUR delta).

| Metric | Target | Tolerance |
|--------|--------|-----------|
| Total games | 170 | exact (25 PR + 145 REG) |
| Day-of-week distribution (REG) | Sat 16.9%, Fri 16.4%, Tue 16.1%, Sun 15.9%, Wed 15.3%, Mon 10.1%, Thu 9.4% | ±2% per day |
| In Game variant split | 79% / 11% / 10% | ±3% per variant |
| Simulcast share (REG) | ~5% | ±2% |
| Regional matchup share (REG) | ~39% | ±3% |
| % In Game cells with paid_eq30 ≤ Primary cap | 30% | ±5% |
| % In Game cells with paid_eq30 0–20% over Primary | 50% | ±5% |
| % In Game cells with paid_eq30 20%+ over Primary | 20% | ±5% |
| Mean EUR REG In Game Standard | $7,500–9,500 | range |
| Mean EUR REG In Game Regional | $11,000–14,000 | range |
| AUR vs EUR delta in Postgame | AUR 3–8% below EUR | range |
| Top 5 client EQ30 share | 25–35% | range |
| Top 50 client EQ30 share | 75–88% | range |
| Spots with priority=paid | ~78% | ±4% |

Two prior targets (`Floater firings (games)`, `% games firing 0 floaters`)
were dropped in the SSRS-input migration. They measured an explicit
`Floaters A&B` inv-type spot count that the M model doesn't have —
floater capacity derives from In Game oversell instead, which is
covered by the `% In Game cells sold > cap` targets above.

ETL output is also gated by the property-based contracts spec
(`05-etl-contracts.md`); both validators run from
`scripts/generate-data.ts`. Build fails non-zero on any miss with one
line per failing contract / metric.

## Output structure

After running `npm run generate-data`:

```
data/
├── spots.csv                 ← generated, 29-col Wide Orbit format
├── schedule.csv              ← generated, 10-col Master Game Schedule format
├── inventory_capacity.xlsx   ← copied from docs/reference/
├── rate_card.xlsx            ← copied from docs/reference/
└── _validation_report.json   ← contracts + distributional metrics, dated
```

Only `_validation_report.json` ships to the deployed site as a build
artifact; the four source files are inlined into the prerendered routes
via the ETL.
