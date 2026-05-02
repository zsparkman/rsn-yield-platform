# Information Architecture

## Overview

Five views plus a landing page. One persistent navigation pattern. The visual target is Linear/Stripe — neutral, dense, operational. Heat scales reserved for data columns where they carry meaning. No gratuitous color, no animation, no marketing copy.

## Routes

```
/                  Landing page
/inventory         Inventory view
/rates             Rates view
/heatmap           Heatmap view
/spot-grid         Spot Grid view
/aur-report        AUR Report view
/about             Sanitization disclosure + spec link
```

Static export. Each route prerenders to a static HTML file at build.

## Persistent navigation

Top bar:
- Left: Project name "RSN Yield Platform" (links to /)
- Center: five view links (Inventory, Rates, Heatmap, Spot Grid, AUR Report)
- Right: Season selector (defaulted to current synthetic year), "About" link

Below the nav, a contextual filter strip per view (date range, season phase filter, etc.) where applicable.

## Visual standards

### Typography
- Sans-serif system stack (Inter or system-ui)
- Body: 14px / 1.5
- Table cells: 13px / 1.4
- Numerical cells: tabular-nums (`font-variant-numeric: tabular-nums`)

### Color (Tailwind tokens)
- Background: `slate-50` (page), `white` (cards/tables)
- Primary text: `slate-900`
- Secondary text: `slate-600`
- Borders: `slate-200`
- Single accent: `indigo-600` for active nav, links

### Heat scales
- Sellout %: red-500 (low fill) → amber-400 (mid) → green-500 (high). Use `bg-` with opacity tier (e.g., `bg-green-500/40`)
- Oversell: white (no oversell) → amber-300 (mild) → red-400 (FL) → red-600 (Bump)
- Spot Grid density: white → green-200 → green-400 → green-600 (saturation by spot count)

### Numerical formatting
- Currency rolled-up: `$1,234,567` (no cents, with commas)
- Currency per-spot: `$12,345`
- EUR/AUR: `$XXX` (no cents)
- Sellout %: integer percent `87%`
- EQ30: one decimal `26.5`
- Avails: one decimal `21.0`

### Empty states
- Off-day rows in any date-keyed view: visible but visually dimmed (`text-slate-400 italic`), label `No game`
- Months with no games: hidden from monthly subtotals
- Empty filter results: explicit "No games match these filters" message

## Landing page (/)

One screen, no scroll on desktop. Three sections:

**Header (top 40% of viewport):**
- H1: "RSN Yield Platform"
- Subhead: "Inventory, rate, and yield management for a regional sports network"
- Lede paragraph (3 sentences max): describes this as a sanitized portfolio version of a production tool, names the scale (NN games per season, $XX MM in annual ad revenue range), explicitly states "synthetic data" once.

**View cards (middle 50%):**
- 5-column grid (collapses to 2 columns on mobile)
- Each card: view name, one-line description, small icon, hover state
- Descriptions match the real Table of Contents tab copy (Inventory: "Capacity, units sold, avails, sellout & net revenue by date, match-up and inventory type")

**Footer (bottom 10%):**
- Sanitization disclosure: "All data shown is synthetic. No real client names, rates, fill numbers, or revenue figures appear in this demo." Link to /about.
- "Built by [Name]" link
- Optional: link to GitHub repo

## View 1: Inventory (/inventory)

The flagship view. Mirrors the real Inventory tab.

**Layout:** Single dense table, full-width.

**Filter strip:**
- Date range picker (start / end)
- Season phase: PR / REG / All
- Matchup tier: Regional / Standard / All
- Format: Standard / Expanded / All

**Table structure:**
- Grouped by date, with date as the leftmost column (rowspan-merged across the 4 inv-type rows per game)
- Second column: Event/Program (e.g., "Dodgers vs. Coastal Mariners" — sanitized)
- Third column: Inventory type (Pregame / In Game / Postgame / Floaters A&B)
- Numeric columns: Avail, Cap, Sold, Sellout%, REV (Net), EUR (Gross)
- Per-game total row beneath each game's 4 rows: total Net REV, weighted average EUR

**Heat formatting:**
- Sellout%: heat scale across all rows
- Avail: subtle red shade if 0 (oversold)

**Sorting:**
- Default: ascending by date
- Click any column header to sort

**Pagination:**
- Show 50 games per page (200 rows incl. inv types)
- Pagination controls below table

## View 2: Rates (/rates)

Mirrors the real Rates tab.

**Layout:** Wider table with weekly grouping.

**Filter strip:**
- Season phase, matchup tier filters
- Year selector (typically static for one season demo)

**Table structure:**
- Grouped by week_start (rowspan-merged date column on left)
- Per-game row with columns:
  - Date, Event
  - Pregame Open, Pregame Rate
  - In Game Open, In Game Rate
  - Postgame Open, Postgame Rate
  - FL A&B Open
- Weekly subtotal row at bottom of each week group (sums of Open columns, single representative rate)

**Heat formatting:**
- Open columns: heat scale (high open = green, low open = red, negative = bold red)
- Rate columns: no heat, just bold the FL or Bump tier rates so the tier shift is visible

**Annotation:**
- Small inline tooltip on the Rate column header explaining tier resolution: "Base when avails > 0, FL when oversold within floater band, Bump when oversold beyond floater cap"

## View 3: Heatmap (/heatmap)

Mirrors the real Heatmap tab.

**Layout:** Single dense table, vertically scrollable.

**Filter strip:**
- Year, Month, Season phase

**Table structure:**
- Grouped by month with month subtotal rows
- Per-game row: Air Date, Event/Program, Pregame %, In Game %, Postgame %
- Cells display sellout % as integer
- No Floaters column (kept simple per real heatmap tab)

**Heat formatting:**
- White at 0%, light red at low fill, saturated red at 100%, deeper red at oversold
- Use a continuous scale not bucketed — the gradient itself is the visual signal

**Subtotals:**
- Month subtotal row: weighted average sellout % per inv type
- Section divider every month

## View 4: Spot Grid (/spot-grid)

Mirrors the real Spot Grid tab.

**Layout:** Two-axis matrix. Clients down, dates across. Generous horizontal scroll.

**Filter strip:**
- Inventory type chips: All / Pregame / In Game / Postgame
- Spot status chips: All / Paid / NC / ADU / xADU / Bonus
- Top N clients selector (default 50, options 25/50/100)

**Matrix:**
- Y-axis: Client name (top N by total EQ30, sorted descending)
- X-axis: Date (chronological)
- Cell value: total EQ30 for that client on that date matching active filters
- Empty cells: white/blank
- Populated cells: green shade by intensity

**Heat scale for cells:**
- 0 → white
- 0.5–1.5 → green-200
- 1.5–3.0 → green-300
- 3.0–5.0 → green-400
- 5.0+ → green-500/600

**Sticky:**
- Client column sticky on left during horizontal scroll
- Date row sticky on top during vertical scroll

## View 5: AUR Report (/aur-report)

The senior view. Mirrors the real AUR Report tab.

**Layout:** Wide dense table, vertically scrollable.

**Filter strip:**
- Year, Month range, Season phase

**Table structure:**
- LOB toggle at top: All / Direct / Repped (or split into two stacked tables — pick toggle for cleaner default)
- Grouped by month with month subtotal rows + season-to-date total
- Per-date row, columns:
  - Type (PR/REG), Month, Date
  - Avail
  - Paid (eq30), NC, ADU, xADU, Bonus, Total
  - Net REV, AUR, EUR
  - Sellout%, Sellout+ADU%

**Legend at top (small text, dismissible):**
- "NC = contracted bonus | ADU = make-good | xADU = cross-property make-good | Bonus = added value"
- "EUR = Net Rev / Paid eq30 (duration-normalized)"
- "AUR = Net Rev / Paid units (count-based, skewed lower by :15s, higher by :60s)"
- "Sellout = (Paid + NC) / Avails"

**Heat formatting:**
- Sellout columns: standard heat
- AUR vs EUR: when AUR < EUR by >5%, subtle yellow flag (signals length-mix drag)

## /about

Single page, plain prose. Three sections:

1. **What this is** — A portfolio demonstration of an RSN ad inventory and yield management platform. The real platform manages [scale] in annual revenue across [scope]; this demo replicates its structure with synthetic data.

2. **Sanitization commitment** — Explicit statement: no real client names, rates, fill numbers, revenue, or schedule data appear anywhere in this codebase. Synthetic data was generated from distributional priors derived from operational experience, not from any real dataset.

3. **Technical approach** — Brief: Next.js, static export, build-time JSON generation, deterministic seed. Link to GitHub repo.
