# Synthetic Data Specification

## Overview

A deterministic Node.js generator under `scripts/generator/` produces all JSON files in `/data` from a single seed. Running `npm run generate-data` is reproducible — same seed always produces the same output. This is critical for build stability and for review.

## Determinism

- Use `seedrandom` (npm: `seedrandom`) for all random draws
- Single top-level seed: `'rsn-yield-platform-v1'`
- All sub-generators receive a derived seed via `seedrandom(topSeed + ':' + namespace)` so changes to one section don't shift all downstream randomness

## Generator order

1. `01-broadcast-calendar.ts` — date dimension
2. `02-opponents.ts` — fictional team roster
3. `03-clients.ts` — load from `04-client-roster.json`, augment with synthetic AE assignments and buying intensities
4. `04-rate-card.ts` — emit rate_card.json from spec table
5. `05-inventory-capacity.ts` — emit inventory_capacity.json from spec table
6. `06-schedule.ts` — generate 25 PR + 145 REG games
7. `07-spots.ts` — generate ~10–14k spots
8. `08-rollups.ts` — compute game_rollup.json and aur_summary.json
9. `99-validate.ts` — run validation targets, fail build if any miss

## 1. Schedule generator (06-schedule.ts)

### Inputs
- 14 opponents (3 Regional, 11 Standard) from opponents.json
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

## 2. Demand model (used by 07-spots.ts)

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
  + noise(σ=0.05),
  0.0, 1.0
)
```

### Multipliers

**base_demand**: 0.65 (a center-of-gravity that puts the operational normal range in the right zone)

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
- Floaters A&B: 0.90 (when fired they fill at high rates)

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
expected_paid_fill_pct = sigmoid_curve(demand_score)
```

Calibrated so:
- demand_score 0.45 → 60% paid fill
- demand_score 0.65 → 80% paid fill
- demand_score 0.75 → 95% paid fill (operational normal)
- demand_score 0.85 → 105% paid fill (oversell into FL)
- demand_score 0.95 → 120% paid fill (deep oversell, Bump tier)

Final paid_eq30 target = expected_paid_fill_pct × cap, with Gaussian noise (σ=2 eq30) applied.

## 3. Spot generator (07-spots.ts)

For each game-inventory cell:

### Step 1: Determine target eq30 fill

`target_paid_eq30 = max(0, sample_from_demand_curve(demand_score))`

### Step 2: Determine spot length mix

Per inventory type:

RSN inventory is :30s and :15s only — no :60s.

**In Game (incl. ± variants):**
- :30s: 96%
- :15s: 4%

**Pregame:**
- :30s: 92%
- :15s: 8%

**Postgame:**
- :30s: 89%
- :15s: 11%

**Floaters A&B:**
- :30s: 100% (operationally always :30s in floater rotation)

### Step 3: Generate paid spots

While remaining_eq30 > 0:
- Sample a client weighted by: `client.buying_intensity × inv_type_match_factor × matchup_familiarity`
  - inv_type_match_factor: client.preferred_inv_type matches → 2.0, mixed → 1.5, mismatch → 0.5
  - matchup_familiarity: clients buy more on Regional games (×1.3 for buying-intensity > 0.5)
- Sample spot length per the inv-type mix
- Determine rate tier:
  - In Game oversell → FL or Bump per the rules
  - Otherwise Base
- Look up gross_rate from rate_card
- Apply spot-length multiplier: :15 = 0.55×, :30 = 1.0×
- Apply within-tier noise: Gaussian σ=4% of base rate, clipped to [0.85×, 1.15×]
- Compute net_rate = gross × 0.85
- Decrement remaining_eq30 by spot_length_eq30

### Step 4: Add NC / ADU / xADU / Bonus spots

Independent of paid fill, sample additional spots per inv-type cell:

NC (contracted bonus):
- Probability: 0.35 per game-inventory-cell having at least one NC spot
- Count when present: Poisson(λ=2)
- Spot rate: $0
- Length: same mix as paid

ADU (make-good):
- Probability: 0.25
- Count when present: Poisson(λ=1.5)
- Skews toward lower-demand games (correlated with low demand_score) — these are make-goods owed from oversell on other games

xADU (cross-property make-good):
- Probability: 0.10
- Count when present: Poisson(λ=1)

Bonus (added value):
- Probability: 0.20
- Count when present: Poisson(λ=2)

These all generate $0-rate spots with full eq30 contribution. They show up in AUR Report decomposition but do not affect EUR/AUR (which divide by paid only).

### Step 5: Floater spots

Per game, sample floaters_fired from the empirical distribution:

- 13% probability of extras game
- Regulation: discrete distribution from 2021 worksheet — 0:8.9%, 1:13.3%, 2:26.7%, 3:40%, 4:8.9%, 5:0%, 6:2.2%
- Extras: shifted distribution — mean 4.86, median 5, max 7+

For each floater fired beyond the first (the term break is "free"):
- Generate 3 :30s spots at FL tier rate
- Same client sampling as In Game
- Tag with priority='paid', inv_type='Floaters A&B'

### Step 6: Demo and impressions assignment

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

## 5. Validation targets (99-validate.ts)

Hard fail the build if any of these miss:

| Metric | Target | Tolerance |
|--------|--------|-----------|
| Total games | 170 | exact (25 PR + 145 REG) |
| Day-of-week distribution (REG) | Sat 16.9%, Fri 16.4%, Tue 16.1%, Sun 15.9%, Wed 15.3%, Mon 10.1%, Thu 9.4% | ±2% per day |
| In Game variant split | 79% / 11% / 10% | ±3% per variant |
| Simulcast share (REG) | ~5% | ±2% |
| Regional matchup share (REG) | ~39% | ±3% |
| % games sold ≤ Primary cap | 30% | ±5% |
| % games sold 0–20% over Primary | 50% | ±5% |
| % games sold 20%+ over Primary | 20% | ±5% |
| Floater firings per season | ~138 | ±15 |
| % games firing 0 floaters | ~8% | ±3% |
| Mean EUR REG In Game Standard | $7,500–9,500 | range |
| Mean EUR REG In Game Regional | $11,000–14,000 | range |
| AUR vs EUR delta in Postgame | AUR 3–8% below EUR | range |
| Top 5 client EQ30 share | 25–35% | range |
| Top 50 client EQ30 share | 75–88% | range |
| Spots with priority=paid | ~78% | ±4% |

Validation script prints all metrics to stdout. Build fails on any miss with a specific error message naming the metric.

## Output structure

After running `npm run generate-data`:

```
data/
├── games.json
├── opponents.json
├── inventory_capacity.json
├── rate_card.json
├── clients.json
├── spots.json
├── broadcast_calendar.json
├── game_inventory.json
├── game_rollup.json
├── aur_summary.json
└── _validation_report.json   ← validation metrics, dated, stored
```

Only `_validation_report.json` and minified production data ship to the deployed site.
