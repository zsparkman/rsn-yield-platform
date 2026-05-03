// Type system for the SSRS-input + ETL architecture.
//
// Two layers of types live here:
//   * "Raw" / source types — mirror the four source files exactly
//     (Wide Orbit spots CSV, master game schedule CSV, inventory
//     capacity xlsx, dynamic rate card xlsx).
//   * "Enriched" / ETL output types — produced by src/lib/etl.ts.
//
// The split exists so the ETL layer is the only place that converts
// SSRS field names (PascalCase / spaces / "/Repped" suffixes) into
// app-friendly shapes.

// ------------------------------ Source types ------------------------------

export type SeasonPhase = 'PR' | 'REG';
export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type InGameVariant = 'In Game-' | 'In Game' | 'In Game+';
export type HomeAway = 'Home' | 'Away';
export type MatchupTier = 'Regional' | 'Standard';
export type Format =
  | 'Standard'
  | 'Expanded'
  | 'DH'
  | 'Expanded DH';
export type Simulcast = 'Exclusive' | 'Simulcast';
export type BroadcastQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export type InventoryGroup =
  | 'Pregame'
  | 'In Game'
  | 'Postgame'
  | 'Ancillary';

export type InGameWithVariant =
  | 'In Game'
  | 'In Game+'
  | 'In Game-';

export type InventoryGroupWithVariant =
  | InGameWithVariant
  | 'Pregame'
  | 'Postgame';

export type RateInventoryType = 'Pregame' | 'In Game' | 'Postgame';
export type RateTier = 'Base' | 'FL' | 'Bump';

export type SpotLength = 15 | 30 | 60;
export type SpotState = 'Placed' | 'Booked';

export type LineOfBusiness = 'Direct' | 'Repped';

// 29-column Wide Orbit SSRS export. Column order matters for round-tripping
// to/from the CSV; see scripts/generator/_csv.ts and src/lib/etl.ts.
export interface RawSpot {
  ChannelName: string;
  AdvertiserName: string;
  RevenueCode2: string;
  OrderNumber: number | null;
  LineNumber: number | null;
  SpotNumber: number | null;
  SpotLength: number;            // 15 / 30 / 60 (occasionally other in real data)
  SpotRate: number;              // gross rate, dollars
  SpotState: SpotState;
  PriorityCode: string;          // P-04 / P-08 / P-09 / P-19 / P-20 / P-40 / P-80 / P-90
  AirDate: string;               // MM/DD/YYYY (source format)
  AirTime1: string;              // HH:MM:SS (source format)
  InventoryCodeBooked: string;
  PathBooked: string;
  InventoryCodePlaced: string;   // " " when unplaced (per M code)
  PathPlaced: string;            // " " when unplaced
  TimePeriod: string;
  AEFullName: string;
  ProductCode: string;
  ParentProductCode: string;
  DemoCode: string;
  BookedRating: number;
  BookedImpressions: number;     // raw (per spot)
  UnitCode: string;
  CPP: number | null;
  TotalEquivSold: number;        // 0.5 / 1.0 / 2.0
  EffectiveUnitRate: number;
  UnitAirStatusCode: string;
  InventoryType: 'BK' | 'NM';    // booked vs no-charge
}

// Master Game Schedule columns (matches the 2026 xlsx, output as CSV).
export interface RawScheduleRow {
  '#': string;                   // "PRE 1" / "1" / etc.
  DAY: string;                   // "Saturday"
  DATE: string;                  // MM/DD/YYYY
  TIME: string;                  // "12:10pm"
  OPPONENT: string;              // "vs. Angels" / "at Padres"
  TV: string;                    // usually "SNLA"
  'OTHER TV': string;            // simulcast partner or empty
  NOTES: string;
  FORMAT: string;                // "ST Away 1A -- 6422" etc.
  'SQUEEZE PLAY BUG': string;
}

export interface RawInventoryCapRow {
  Syscode: number;
  Team: string;                  // "Sentinels"
  Type: SeasonPhase;             // "PR" / "REG"
  // Inventory is restricted to the resolved In Game variant + Pregame +
  // Postgame after the Floaters A&B collapse — no separate floater rows.
  Inventory: InventoryGroupWithVariant;
  Format: Format;
  Avails: number;
}

export interface RawRateCardRow {
  Syscode: number;
  Net: string;                   // "BSWN"
  Team: string;                  // "Sentinels"
  Type: SeasonPhase;
  Inv: RateInventoryType;
  Matchup: MatchupTier;
  Tier: RateTier;
  Rate: number;                  // gross rate, dollars
}

// ------------------------------ ETL output types ------------------------------

// deriveSpots() output — the "Lakers Spot Data 19-22" equivalent.
export interface EnrichedSpot extends RawSpot {
  inventory_type_booked: InventoryGroup;
  inventory_type_placed: string;      // 'In Game' | 'Pregame' | 'Postgame' | 'Ancillary' | SpotState fall-through
  inventory_type: InventoryGroup;
  spot_rate_net: number;              // SpotRate * 0.85
  booked_display_status: 'As Booked' | 'As Placed';
  post_inv_code: string;
  post_code: string;
  post_key: string;                   // post_code + '.' + DemoCode
  spot_key: string;                   // AirDate + '.' + inventory_type
  air_date_iso: string;               // YYYY-MM-DD parsed from AirDate
  broadcast_month: string;
  broadcast_year: number;
  broadcast_qtr: BroadcastQuarter;
  period: '4Q' | '1-2Q' | null;
  booked_impressions_thousands: number; // BookedImpressions / 1000
  fl_flag: 'FL' | 'P';
  hts_flag: 'HTS' | 'Non-HTS';
}

// deriveSchedule() output — the "Lakers Combined Schedules" equivalent.
// One row per (game, INV TYPE) so each game emits 3 rows
// (Pregame / In Game / Postgame).
export interface EnrichedScheduleRow {
  '#': string;
  DAY: string;
  DATE: string;                       // YYYY-MM-DD
  START: string;                      // HH:MM 24h
  OPPONENT: string;
  TV: string;
  'OTHER TV': string | null;
  NOTES: string | null;
  FORMAT: string;
  EVENT_PROGRAM: string;              // "Sentinels vs. Angels", with "PR: " prefix for PR
  TYPE: string;                       // "Sentinels"
  TYPE2: SeasonPhase;
  SEASON: string;                     // "26"
  NET: string;                        // "SNLA"
  'NET.DATE.TIME': string;
  Simulcast: Simulcast;
  Expanded: Format;
  Matchup: MatchupTier;
  'INV TYPE': RateInventoryType;
  '+/-': '+' | '-' | null;
  'INV TYPE.1': InGameWithVariant | RateInventoryType;
  'Avails Key': string;
  broadcast_month: string;
  broadcast_year: number;
  broadcast_qtr: BroadcastQuarter;
  NonSpectrum: 'Spectrum' | 'NonSpectrum';
  'NS-Ancillary': string;
  'SPOT KEY': string;
}

// deriveSpotsByClient() output — left outer join of schedule onto spots.
// Spot fields are namespaced with "spot." prefix to keep the row flat
// while still mirroring the M chain's naming.
export interface SpotsByClientRow {
  // Schedule fields
  DATE: string;
  EVENT_PROGRAM: string;
  TYPE: string;
  TYPE2: SeasonPhase;
  SEASON: string;
  'INV TYPE': RateInventoryType;
  '+/-': '+' | '-' | null;
  'INV TYPE.1': InGameWithVariant | RateInventoryType;
  Matchup: MatchupTier;
  Expanded: Format;
  'Avails Key': string;
  'SPOT KEY': string;
  broadcast_month: string;
  broadcast_year: number;
  broadcast_qtr: BroadcastQuarter;

  // Spot fields (left outer; defaulted to 0/empty when no match)
  'spot.AdvertiserName': string;
  'spot.OrderNumber': number;
  'spot.LineNumber': number;
  'spot.SpotLength': number;
  'spot.SpotRate': number;
  'spot.SpotRate (Net)': number;
  'spot.SpotState': string;
  'spot.PriorityCode': string;
  'spot.AirDate': string;
  'spot.AEFullName': string;
  'spot.DemoCode': string;
  'spot.BookedRating': number;
  'spot.BookedImpressions': number;
  'spot.CPP': number | null;
  'spot.TotalEquivSold': number;
  'spot.EffectiveUnitRate': number;
  'spot.UnitAirStatusCode': string;
  'spot.InventoryType': string;
  'spot.inventory_type': string;
  'spot.fl_flag': string;
  'spot.hts_flag': string;

  // Derived
  '$0': 'Paid' | '$0';
  AfterToday: 0 | 1;
}

// deriveInventory() output — per-game-per-inv-type rollup.
// Modeled on M Inventory (Exc $0) / Inventory (Inc $0). Inc-$0 includes
// $0-rate spots in the grouping; Exc-$0 filters them out.
export interface InventoryRollupRow {
  DATE: string;                       // YYYY-MM-DD
  EVENT_PROGRAM: string;
  TYPE2: SeasonPhase;
  'INV TYPE': InventoryGroupWithVariant;
  'Avails Key': string;
  broadcast_month: string;
  broadcast_year: number;
  SEASON: string;
  Matchup: MatchupTier;
  Format: Format;                     // 'Standard' | 'Expanded' | 'DH' | 'Expanded DH'
  // Broadcast calendar — Mon-Sun week containing the air date, with the
  // week's broadcast-month assignment determined by which standard month
  // contains the Wednesday of that week (Nielsen-style 4-4-5).
  bcast_month: string;
  bcast_year: number;
  bcast_qtr: BroadcastQuarter;
  bcast_week_start: string;           // YYYY-MM-DD (Monday)
  Cap: number;                        // primary cap from inventory_capacity (includes the
                                      // first floater break since the Floaters A&B collapse)
  Sold: number;                       // sum of TotalEquivSold (paid-only when Exc-$0)
  avail: number;                      // max(0, Cap - Sold); the Inventory view's "Avail"
  Sellout: number;                    // Sold / Cap
  Oversell: number;                   // M sign: Avails - Sold
  'Rate Tier': RateTier;
  'Rate Key': string;
  Rate: number;                       // looked up from rate_card (dollars)
  current_rate_cents: number;         // round(Rate * 100); the Rates view's rate column
  'Start of Week': string;            // YYYY-MM-DD (Monday)
  'Gross Rev': number;
  'Net Rev': number;
  gross_rev_cents: number;            // round(Gross Rev * 100)
  net_rev_cents: number;              // round(Net Rev * 100); the Inventory view's "REV (Net)"
  // Three volume-weighted unit-rate metrics, all in integer cents.
  // ALL THREE COMPUTED OVER PAID SPOTS ONLY (spot.SpotRate > 0).
  // NC, ADU, xADU, and Bonus spots are excluded from both numerator
  // and denominator — these are yield metrics (realized rate per unit
  // of inventory sold), not capacity-utilization metrics.
  // - eur_gross_cents: sum(gross_rev) / sum(total_eq30) — sales-facing.
  //   Used by the Inventory and Rates views ("EUR (Gross)" column).
  // - eur_net_cents:   sum(net_rev)   / sum(total_eq30) — yield/finance-facing.
  //   Used by the Yield Summary view ("EUR (Net)" column).
  // - aur_cents:       sum(net_rev)   / count(paid_spots) — length-agnostic.
  //   Used by the Yield Summary view alongside eur_net_cents.
  // 0 for Floaters A&B (no double-counting; revenue lives on the In Game row).
  eur_gross_cents: number;
  eur_net_cents: number;
  aur_cents: number;
  AfterToday: 0 | 1;
}

// deriveAurSummary() output — per-(date, inv-type) wide-form pivot.
// One column per (LOB Group × Spot Group × metric). Empty intersections
// resolve to 0, never null/undefined.
export interface AurSummaryRow {
  SEASON: string;
  broadcast_year: number;
  broadcast_qtr: BroadcastQuarter;
  broadcast_month: string;
  TYPE2: SeasonPhase;
  DATE: string;                       // YYYY-MM-DD
  'INV TYPE': InGameWithVariant | RateInventoryType;
  'Primary Avails Key': string;
  // Broadcast calendar parallel fields (see InventoryRollupRow for derivation).
  bcast_month: string;
  bcast_year: number;
  bcast_qtr: BroadcastQuarter;

  // HTS LOB ("Repped")
  'HTS Paid.EQ30': number;
  'HTS Paid.Gross REV': number;
  'HTS Paid.Net REV': number;
  'HTS Paid.count': number;            // count of paid HTS spots — for per-LOB AUR
  'HTS NC.EQ30': number;
  'HTS ADU.EQ30': number;
  'HTS Cross Property ADU.EQ30': number;
  'HTS Bonus.EQ30': number;

  // Non-HTS LOB ("Direct")
  'Non-HTS Paid.EQ30': number;
  'Non-HTS Paid.Gross REV': number;
  'Non-HTS Paid.Net REV': number;
  'Non-HTS Paid.count': number;        // count of paid Non-HTS spots
  'Non-HTS NC.EQ30': number;
  'Non-HTS ADU.EQ30': number;
  'Non-HTS Cross Property ADU.EQ30': number;
  'Non-HTS Bonus.EQ30': number;

  // Totals
  'Total Paid.EQ30': number;
  'Total Paid.Gross REV': number;
  'Total Paid.Net REV': number;
  'Total NC.EQ30': number;
  'Total ADU.EQ30': number;
  'Total Cross Property ADU.EQ30': number;
  'Total Bonus.EQ30': number;
  'HTS Total.EQ30': number;
  'Non-HTS Total.EQ30': number;
  'Total Total.EQ30': number;

  Avails: number;
  Sellout: number;
  'Sellout + ADU': number;
  // Volume-weighted yield metrics for the Yield Summary view. All in integer cents.
  // eur_net_cents = sum(Total Paid.Net REV) / sum(Total Paid.EQ30); aur_cents
  // = sum(Total Paid.Net REV) / count(paid spots). 0 when there are no paid
  // spots in the bucket.
  eur_net_cents: number;
  aur_cents: number;
}

// Booking Matrix view aggregate. Pre-aggregated in deriveSpotGrid() so the
// client component receives ~5k rows instead of ~18k.
export type SpotGroupKind = 'Paid' | 'NC' | 'ADU' | 'xADU' | 'Bonus' | 'Other';

export interface SpotGridCell {
  client: string;            // AdvertiserName (canonical, "/Repped" suffix preserved)
  date: string;              // YYYY-MM-DD
  inv_type: 'Pregame' | 'In Game' | 'Postgame';
  group: SpotGroupKind;
  eq30: number;
  units: number;             // count of paid spots (length-agnostic, for the Booking Matrix Metric=Units mode)
}

// Per-(client, order_number, date, inv_type, group) cell for the Booking
// Matrix's per-client order-number twirl-down. Same shape as SpotGridCell
// plus the order_number key.
export interface SpotGridOrderCell extends SpotGridCell {
  order_number: number;
}
