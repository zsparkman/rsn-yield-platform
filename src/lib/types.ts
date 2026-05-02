// Shared domain types — see docs/spec/01-data-model.md.

export type SeasonPhase = "PR" | "REG";
export type DayOfWeek = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type InGameVariant = "In Game-" | "In Game" | "In Game+";
export type HomeAway = "Home" | "Away";
export type MatchupTier = "Regional" | "Standard";
export type Format = "Standard" | "Expanded";
export type Simulcast = "Exclusive" | "Simulcast";
export type BroadcastQuarter = "Q1" | "Q2" | "Q3" | "Q4";

export type InventoryType =
  | "Pregame"
  | "In Game"
  | "In Game+"
  | "In Game-"
  | "Postgame"
  | "Floaters A&B";

export type RateInventoryType = "Pregame" | "In Game" | "Postgame";
export type RateTier = "Base" | "FL" | "Bump";

export type LeagueDivision = "Coastal" | "Mountain" | "Heartland" | "Atlantic";

export type ClientCategory =
  | "QSR"
  | "Auto"
  | "Insurance"
  | "Telco"
  | "Retail"
  | "Pharma"
  | "CPG"
  | "Travel"
  | "Finance"
  | "Gaming"
  | "Misc";

export type LineOfBusiness = "Direct" | "Repped";

export type PreferredInvType = "Pregame" | "In Game" | "Postgame" | "mixed";

export type DemoCode =
  | "HH"
  | "A18-49"
  | "A25-54"
  | "M25-54"
  | "A35+"
  | "A21-49";

export type PriorityCode = "paid" | "nc" | "adu" | "xadu" | "bonus";

export type SpotState = "Placed" | "Booked";

export type SpotLength = 15 | 30;

export interface Game {
  game_id: string;
  air_date: string;
  day_of_week: DayOfWeek;
  start_time: string;
  start_minute_mod_30: number;
  in_game_variant: InGameVariant;
  season_phase: SeasonPhase;
  opponent_id: string;
  opponent_name: string;
  home_away: HomeAway;
  matchup_tier: MatchupTier;
  format: Format;
  simulcast: Simulcast;
  network_partner: string | null;
  broadcast_month: string;
  broadcast_year: number;
  broadcast_qtr: "Q1" | "Q2" | "Q3";
  week_start: string;
  series_id: string;
  series_game_num: 1 | 2 | 3 | 4;
}

export interface Opponent {
  opponent_id: string;
  name: string;
  city: string;
  league_division: LeagueDivision;
  matchup_tier: MatchupTier;
  base_demand_multiplier: number;
}

export interface InventoryCapacity {
  season_phase: SeasonPhase;
  inv_type: InventoryType;
  format: Format;
  avails: number;
}

export interface RateCardEntry {
  season_phase: SeasonPhase;
  inv_type: RateInventoryType;
  matchup_tier: MatchupTier;
  rate_tier: RateTier;
  rate_cents: number;
}

export interface Client {
  client_id: string;
  name: string;
  category: ClientCategory;
  lob: LineOfBusiness;
  buying_intensity: number;
  preferred_inv_type: PreferredInvType;
  preferred_demo: string;
  preferred_length_mix: { "15": number; "30": number; "60": number };
  ae_name: string;
}

export interface Spot {
  spot_id: string;
  game_id: string;
  client_id: string;
  inv_type: InventoryType;
  spot_length: SpotLength;
  spot_length_eq30: number;
  rate_tier: RateTier;
  spot_rate_gross_cents: number;
  spot_rate_net_cents: number;
  total_eq30: number;
  priority_code: PriorityCode;
  demo_code: DemoCode;
  booked_impressions: number;
  booked_rating: number;
  spot_state: SpotState;
  ae_name: string;
}

export interface BroadcastDate {
  date: string;
  broadcast_month: string;
  broadcast_year: number;
  broadcast_qtr: BroadcastQuarter;
  week_start: string;
}

export interface GameInventoryCell {
  game_id: string;
  inv_type: InventoryType;
  cap: number;
  effective_cap: number;
  floater_cap: number;
  game: Game;
}

export interface GameRollup {
  game_id: string;
  inv_type: InventoryType;
  cap: number;
  sold_eq30: number;
  paid_eq30: number;
  nc_eq30: number;
  adu_eq30: number;
  xadu_eq30: number;
  bonus_eq30: number;
  oversell_eq30: number;
  rate_tier_resolved: RateTier;
  current_rate_cents: number;
  gross_rev_cents: number;
  net_rev_cents: number;
  eur_cents: number;
  aur_cents: number;
  paid_unit_count: number;
  sellout_pct: number;
  sellout_pct_with_adu: number;
}

export interface AURSummaryRow {
  date: string;
  season_phase: SeasonPhase;
  inv_type: InventoryType;

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
  sellout_pct: number;
  sellout_pct_with_adu: number;
}
