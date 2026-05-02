# Data Model

## Overview

Six entities, three derived layers. Entities mirror the source tables in the reference Power Query workbook; derived layers mirror the joins. Everything is generated at build time and seeded as static JSON. The browser performs filtering, sorting, and lightweight aggregation only — no API calls, no server, no live computation.

## Naming conventions

- Identifiers: `snake_case`
- TypeScript interfaces: `PascalCase`
- Currency: stored as integer cents (avoid floating-point); convert at render
- Dates: ISO 8601 strings (`YYYY-MM-DD`); times stored separately as `HH:MM` 24h
- Enums: typed unions in TypeScript (e.g., `'PR' | 'REG'`)

## Entities (seeded JSON files in /data)

### games.json

One row per televised game.

```typescript
interface Game {
  game_id: string;              // 'g_0001' through 'g_0170'
  air_date: string;             // ISO date
  day_of_week: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  start_time: string;           // 'HH:MM' 24h
  start_minute_mod_30: number;  // for In Game ± derivation
  in_game_variant: 'In Game-' | 'In Game' | 'In Game+';
  season_phase: 'PR' | 'REG';
  opponent_id: string;
  opponent_name: string;
  home_away: 'Home' | 'Away';
  matchup_tier: 'Regional' | 'Standard';
  format: 'Standard' | 'Expanded';
  simulcast: 'Exclusive' | 'Simulcast';
  network_partner: string | null;  // 'ESPN', 'TBS', etc. when Simulcast
  broadcast_month: string;          // 'March' through 'September'
  broadcast_year: number;
  broadcast_qtr: 'Q1' | 'Q2' | 'Q3';
  week_start: string;               // ISO date, Monday
  series_id: string;
  series_game_num: 1 | 2 | 3 | 4;
}
```

Target count: 170 (25 PR + 145 REG).

### opponents.json

```typescript
interface Opponent {
  opponent_id: string;
  name: string;                    // fictional team name
  city: string;                    // fictional
  league_division: 'Coastal' | 'Mountain' | 'Heartland' | 'Atlantic';
  matchup_tier: 'Regional' | 'Standard';
  base_demand_multiplier: number;  // 0.85 to 1.10
}
```

Three Regional opponents, ~11 Standard. Use neutral fictional names (e.g., "Coastal Mariners," "Highland Stags") — do NOT use any real MLB team or city name.

### inventory_capacity.json

```typescript
interface InventoryCapacity {
  season_phase: 'PR' | 'REG';
  inv_type: 'Pregame' | 'In Game' | 'In Game+' | 'In Game-' | 'Postgame' | 'Floaters A&B';
  format: 'Standard' | 'Expanded';
  avails: number;  // eq30 units
}
```

Values follow the reference Inventory Table structure. Synthetic absolutes:

| Phase | Inv          | Standard | Expanded |
|-------|--------------|----------|----------|
| PR    | Pregame      | 21       | 21       |
| PR    | In Game      | 43.5     | 52.5     |
| PR    | In Game+     | 47.5     | 56.5     |
| PR    | In Game-     | 39.5     | 48.5     |
| PR    | Postgame     | 17       | 17       |
| PR    | Floaters A&B | 6        | 6        |
| REG   | Pregame      | 21       | 21       |
| REG   | In Game      | 51       | 58       |
| REG   | In Game+     | 55       | 62       |
| REG   | In Game-     | 47       | 54       |
| REG   | Postgame     | 17       | 17       |
| REG   | Floaters A&B | 6        | 6        |

### rate_card.json

```typescript
interface RateCardEntry {
  season_phase: 'PR' | 'REG';
  inv_type: 'Pregame' | 'In Game' | 'Postgame';
  matchup_tier: 'Standard' | 'Regional';
  rate_tier: 'Base' | 'FL' | 'Bump';
  rate_cents: number;
}
```

Synthetic rates (deliberately not matching real values, but preserving ratios):

| Phase | Inv      | Tier     | Standard | Regional |
|-------|----------|----------|----------|----------|
| PR    | Pregame  | Base     | $400     | $400     |
| PR    | Pregame  | Bump     | $800     | $800     |
| PR    | In Game  | Base     | $1,650   | $1,650   |
| PR    | In Game  | FL       | $1,950   | $1,950   |
| PR    | In Game  | Bump     | $3,300   | $3,300   |
| PR    | Postgame | Base     | $175     | $175     |
| PR    | Postgame | Bump     | $350     | $350     |
| REG   | Pregame  | Base     | $1,375   | $1,375   |
| REG   | Pregame  | Bump     | $2,750   | $2,750   |
| REG   | In Game  | Base     | $11,500  | $17,250  |
| REG   | In Game  | FL       | $13,800  | $20,700  |
| REG   | In Game  | Bump     | $23,000  | $34,500  |
| REG   | Postgame | Base     | $3,650   | $3,650   |
| REG   | Postgame | Bump     | $7,300   | $7,300   |

FL tier exists only for In Game inventory.

### clients.json

See `04-client-roster.json` for the data. Schema:

```typescript
interface Client {
  client_id: string;
  name: string;
  category: 'QSR' | 'Auto' | 'Insurance' | 'Telco' | 'Retail' |
            'Pharma' | 'CPG' | 'Travel' | 'Finance' | 'Gaming' | 'Misc';
  lob: 'Direct' | 'Repped';
  buying_intensity: number;       // relative weight ≥ 0; used as a sampling weight, no upper bound enforced
  preferred_inv_type: 'Pregame' | 'In Game' | 'Postgame' | 'mixed';
  preferred_demo: string;          // 'HH', 'A25-54', etc.
  preferred_length_mix: { '15': number; '30': number };  // sums to 1.0
  ae_name: string;
}
```

### spots.json

The booked-spot ledger. Largest file — target ~10,000–14,000 rows.

```typescript
interface Spot {
  spot_id: string;
  game_id: string;
  client_id: string;
  inv_type: 'Pregame' | 'In Game' | 'Postgame' | 'Floaters A&B';
  spot_length: 15 | 30 | 60;
  spot_length_eq30: number;        // 0.5 | 1.0 | 2.0
  rate_tier: 'Base' | 'FL' | 'Bump';
  spot_rate_gross_cents: number;
  spot_rate_net_cents: number;     // gross * 0.85
  total_eq30: number;              // = spot_length_eq30
  priority_code: 'paid' | 'nc' | 'adu' | 'xadu' | 'bonus';
  demo_code: 'HH' | 'A18-49' | 'A25-54' | 'M25-54' | 'A35+' | 'A21-49';
  booked_impressions: number;
  booked_rating: number;
  spot_state: 'Placed' | 'Booked';
  ae_name: string;
}
```

### broadcast_calendar.json

```typescript
interface BroadcastDate {
  date: string;
  broadcast_month: string;
  broadcast_year: number;
  broadcast_qtr: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  week_start: string;
}
```

Generate for the full demo year (Feb through October).

## Derived layers (also seeded as JSON)

These pre-aggregations exist so views read directly without recomputing across thousands of rows.

### game_inventory.json

Cartesian product of Games × valid InventoryCapacity rows for that game's (phase, format), expanded so each game emits 4–5 rows (Pregame, the resolved In Game ± variant, Postgame, Floaters A&B).

```typescript
interface GameInventoryCell {
  game_id: string;
  inv_type: string;
  cap: number;                    // primary avails
  effective_cap: number;          // primary * 1.10 (operational ceiling per business logic)
  floater_cap: number;            // 6 for Floaters A&B rows, 0 elsewhere
  game: Game;                     // denormalized for fast lookup
}
```

### game_rollup.json

Per-game per-inv-type spot aggregates with rate tier resolution.

```typescript
interface GameRollup {
  game_id: string;
  inv_type: string;
  cap: number;
  sold_eq30: number;
  paid_eq30: number;
  nc_eq30: number;
  adu_eq30: number;
  xadu_eq30: number;
  bonus_eq30: number;
  oversell_eq30: number;          // sold - cap, can be negative (under-sold)
  rate_tier_resolved: 'Base' | 'FL' | 'Bump';
  current_rate_cents: number;     // the rate the next sold spot would book at
  gross_rev_cents: number;
  net_rev_cents: number;
  eur_cents: number;              // net_rev / paid_eq30
  aur_cents: number;              // net_rev / paid_unit_count
  paid_unit_count: number;        // count of paid spots regardless of length
  sellout_pct: number;            // (paid_eq30 + nc_eq30) / cap
  sellout_pct_with_adu: number;
}
```

Rate tier resolution rule (mirrors the reference query logic). Recall
`oversell_eq30 = sold - cap`, so positive oversell means we are *over*
the cap and into the floater band:

- In Game with oversell_eq30 ≤ 0 → Base
- In Game with 0 < oversell_eq30 ≤ 6 → FL
- In Game with oversell_eq30 > 6 → Bump
- Floaters A&B → always FL (priced at the floater rack rate)
- Pregame/Postgame with sold ≤ cap → Base
- Pregame/Postgame with sold > cap → Bump

### aur_summary.json

Per-(date, season_phase, inv_type) decomposition by LOB × spot group.

```typescript
interface AURSummaryRow {
  date: string;
  season_phase: 'PR' | 'REG';
  inv_type: string;
  // Direct LOB
  direct_paid_eq30: number;
  direct_nc_eq30: number;
  direct_adu_eq30: number;
  direct_xadu_eq30: number;
  direct_bonus_eq30: number;
  direct_paid_gross_cents: number;
  direct_paid_net_cents: number;
  // Repped LOB
  repped_paid_eq30: number;
  repped_nc_eq30: number;
  repped_adu_eq30: number;
  repped_xadu_eq30: number;
  repped_bonus_eq30: number;
  repped_paid_gross_cents: number;
  repped_paid_net_cents: number;
  // Totals
  total_paid_eq30: number;
  total_paid_unit_count: number;
  total_paid_net_cents: number;
  cap: number;
  eur_cents: number;
  aur_cents: number;
  sellout_pct: number;            // (paid + nc) / cap
  sellout_pct_with_adu: number;   // (paid + nc + adu + xadu) / cap
}
```

## File size targets

| File | Approx rows | Approx size |
|------|-------------|-------------|
| games.json | 170 | 50 KB |
| opponents.json | 14 | 3 KB |
| inventory_capacity.json | 24 | 2 KB |
| rate_card.json | 28 | 3 KB |
| clients.json | 60 | 12 KB |
| spots.json | 10,000–14,000 | 2–3 MB |
| game_inventory.json | ~700 | 200 KB |
| game_rollup.json | ~700 | 250 KB |
| aur_summary.json | ~400 | 150 KB |
| broadcast_calendar.json | ~250 | 25 KB |

Spots is the only file that needs care for browser delivery. Acceptable to ship at 2–3 MB unminified, ~700 KB gzipped over Vercel's edge. For static export, this is fine.
