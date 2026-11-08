export type Phase = "lobby" | "building" | "round" | "round_end" | "finished";

export interface Game {
  id: string; code: string; name: string; solo: boolean; phase: Phase; round: number; total_rounds: number;
  build_seconds: number; round_seconds: number; starting_cash: number; fee_rate: number; loan_rate: number;
  max_debt: number; volatility: number; rent_months: number; scarcity: boolean; trading_locked: boolean;
  leaderboard_hidden: boolean; gamble_enabled: boolean; loan_cheap_limit: number; tax_rent: number; tax_gains: number; tax_gamble: number; gamble_limit: number; loan_penalty_rate: number; paused: boolean; paused_remaining: number | null; ends_at: string | null;
  event_id: string | null; seconds_left: number | null;
}

export interface Property {
  game_id: string; property_id: string; name: string; label: string; location: string; type: string;
  description: string; highlight: string; base_price: number; current_value: number; base_rent: number;
  monthly_rent: number; risk: "low" | "medium" | "high"; maintenance_rate: number; supply: number | null;
  enabled: boolean; sort: number; owned: number; image_url: string | null;
}

export interface PlayerRow {
  id: string; nickname: string; emoji: string; net_worth: number; cash: number; debt: number;
  rent_total: number; expense_total: number; is_bot: boolean; props: number; rank: number;
}

export interface Holding { property_id: string; purchase_price: number; bought_round: number }
export interface Me extends PlayerRow { holdings: Holding[]; tax_total: number }

export interface Hint { type: string; v: number; r: number; m: number }
export interface GameEvent { id: string; title: string; emoji: string; headline: string; description: string; hints: Hint[]; rate?: number }

export interface PropChange { property_id: string; old_value: number; new_value: number; value_pct: number; rent_pct: number; maint_pct: number }
export interface RoundLog { round: number; event: { id: string; title: string; emoji: string; headline: string; description: string }; changes: PropChange[]; loan_rate: number }
export interface RoundResult { round: number; player_id: string; net_worth: number; cash: number; debt: number; rent_income: number; expenses: number; rank: number }

export type Effects = Record<string, Partial<Record<"v" | "r" | "m", [number, number]>>>;
export interface EventDef {
  id: string; title: string; emoji: string; headline: string; description: string;
  effects: Effects; loan_rate_delta: number; custom: boolean;
}

export interface AdminExtra {
  events: EventDef[]; event_plan: Record<string, string>;
  holdings: { player_id: string; property_id: string; purchase_price: number }[];
}

export interface GameState {
  error?: string; server_now: number; role: "admin" | "player" | "viewer"; kicked: boolean;
  game: Game; event: GameEvent | null; properties: Property[]; players: PlayerRow[]; me: Me | null;
  round_log: RoundLog[]; results: RoundResult[]; admin: Partial<AdminExtra>;
}
