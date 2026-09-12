import type { Candidate, Change } from './decision'
import type { Diagnostic, RequestInput, Selection } from './types'

export type Point = { portfolio_id: string; selection: Selection[]; metrics: Record<string, number>; score: number; rank: number }
export type Tradeoff = { delta: Record<string, number>; gains_under_declared_directions: { metric: string; delta: number }[]; losses_under_declared_directions: { metric: string; delta: number }[] }
export type MainDifference = { metric: string; raw_delta: number; score_contribution_delta: number } | null
export type Proposal = Tradeoff & { strategies: string[]; candidate: Candidate; request: RequestInput; changes: Change; resolved_constraints: string[] }
export type Intelligence = {
  input_fingerprint: string
  locks: { lot_id: string; mode_id: string | null }[]
  context: string; active_scenario: string; status: string; message: string; feasible_count: number; no_solution_reason: string | null
  budget: { cap: number; current_margin: number; current_breakpoint: number; current_acceptance_boundary: number; minimum_feasible_budget: number | null; eps: number; budget_only_blocker: boolean }
  current: { candidate: Candidate; feasible: boolean; locks_satisfied: boolean; diagnostics: { diagnostics: Diagnostic[] } }
  recovery: Proposal[]; recommendation: Proposal | null; accepted_recommendation_id: string
  ranking_context: { reference: { population_id: string; size: number }; weights: { applied: Record<string, number> } }
  transition_map: { lower_inclusive: number; upper_exclusive: number | null; economic_breakpoint_c0: number; portfolio_id: string; request: RequestInput; metrics: Record<string, number>; change_from_previous: (Tradeoff & { changes: Change }) | null }[]
  explorer: { points: Point[]; extrema: Record<string, string>; strong_alternatives: string[] }
  explanation: { interpretation: string; strongest_weighted_criterion: string; main_gain_against_runner_up: MainDifference; main_compromise_against_runner_up: MainDifference; nearest_alternatives: (Tradeoff & { portfolio_id: string; score_gap: number })[]; official_stress: { status: string; c0_margin: number }; unconfirmed_conditions: string[] } | null
  local_sensitivity: { criterion: string; multiplier: number; weights: Record<string, number>; leader_id: string | null; original_recommendation_rank: number | null; score_gap_to_original: number | null; leader_changed: boolean | null }[]
}
export type Claim = { text: string; provenance: string; source: string | null }
export type Passport = { interpretation: string; finance: { totals: Record<string, number> }; active_sources: Record<string, string>; services: { lot_id: string; mode_id: string; chain: Claim[]; finance: Record<string, number>; conditions: Claim[]; gap_condition: Claim; confirmed_contracts: Claim }[] }
