/** Shared decision contract. Types mirror /api/decision/recompute; no economics here. */
import type { RequestInput, Scenario, Selection } from './types'

export type Weights = Record<string, number>
export type Candidate = {
  portfolio_id: string; selection: Selection[]; score: number; rank: number
  metrics: Record<string, number>; normalized: Weights; contributions: Weights; public_core_ids: string[]
  scenarios: Record<Scenario, { status: string; c0_limit: number; c0_margin: number; ok: boolean; checks: Record<string, boolean> }>
  net_operating_balance: number; portfolio_funding_gap: number; sum_lot_funding_gaps: number
}
export type Method = {
  method_version: string; weights: Weights; applied_weights: Weights; equal_weight_profile: Weights
  field_mapping: Record<string, string>; directions: Record<string, string>; provenance: Record<string, unknown>
  strategy_thesis: string; limitations: string[]; score_interpretation: string; recommendation_rule: string
}
export type Configuration = {
  format_version: 'kosmos-decision/1'; expected_population_id: string | null
  request: {
    format_version: 'kosmos-search/1'; case_id: string; case_version: string; source_hashes: Record<string, string>
    modes: 'A/B/C'; method_version: string; scenario: Scenario; weights: Weights; limit: number; baseline: RequestInput | null
  }
}
export type Change = { added: string[]; removed: string[]; mode_changes: { lot_id: string; from: string; to: string }[]; unchanged: boolean }
export type ServiceContext = { lot_id: string; mode_id: string; service: string; task_proposal: string; public_core: boolean; mode_coefficients: Weights }
export type Run = {
  criterion: string; multiplier: number; applied_weights: Weights; leader: Candidate; original_choice_rank: number | null
  original_choice_score: number | null; selection_changes: Change; zero_weight_unchanged: boolean
}
/** Canonical Result shape reused by the stress explanation (recommendation.results). */
export type Diagnostic = {
  id: string; condition: string; metric: string; comparator: string; limit: number; fact: number | null
  unit: string; status: string; ok: boolean | null; margin: number | null; deficit: number | null; action: string
}
export type DecisionResult = { scenarios: Record<Scenario, { status: string; diagnostics: Diagnostic[] }>; metrics: Record<string, number | string | string[] | boolean | null> }
export type Alternative = {
  strategy_id: string; title: string; rationale: string; candidate: Candidate; strategy_weights: Weights
  current_profile_rank: number | null; current_profile_score: number | null; same_portfolio_as: string | null
  request: RequestInput; delta_to_current_leader: Weights; selection_changes: Change; service_context: ServiceContext[]
}
export type Decision = {
  configuration: Configuration; input_fingerprint: string; method: Method
  search: {
    scenario: Scenario; weights: { original: Weights; applied: Weights }; ranking: Candidate[]; ranked_count: number
    reference_population: { population_id: string; size: number; bounds: Record<string, { min: number; max: number }> }
    population: {
      total: number; stress_is_subset_of_base: boolean
      scenarios: Record<Scenario, { feasible: number; excluded: number; exclusion_reasons: { id: string; condition: string; count: number }[] }>
    }
  }
  alternatives: Alternative[]
  recommendation: {
    base: Candidate; stress: Candidate; action: string; condition: string; selection_changes: Change
    stress_delta_to_base: Weights; results: Record<Scenario, DecisionResult>; service_context: ServiceContext[]
  }
  sensitivity: {
    runs: Run[]; interpretation: string; original_choice: Candidate; baseline_kind: string
    equal_weight_profile: Omit<Run, 'criterion' | 'multiplier' | 'zero_weight_unchanged'>
  }
}

/** Same shape the Python search module builds, so ids compare directly. */
export const portfolioId = (rows: Selection[]) =>
  [...rows].sort((a, b) => (a.lot_id < b.lot_id ? -1 : a.lot_id > b.lot_id ? 1 : 0))
    .map(row => `${row.lot_id}:${row.mode_id}`).join('|')
export const composition = (rows: Selection[]) => rows.map(row => `${row.lot_id} ${row.mode_id}`).join(' · ')
export function changes(value: Change) {
  if (value.unchanged) return 'Состав и режимы сохранились'
  return [value.added.length ? `Добавлены: ${value.added.join(', ')}` : '', value.removed.length ? `Исключены: ${value.removed.join(', ')}` : '',
    ...value.mode_changes.map(row => `${row.lot_id}: ${row.from} → ${row.to}`)].filter(Boolean).join('; ')
}
/** Russian plural forms: 1 лот, 2 лота, 5 лотов. */
export function plural(count: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`
  if (mod10 === 1) return `${count} ${one}`
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`
  return `${count} ${many}`
}

/** Composition difference between two selections; a set comparison, not a score. */
export function differenceCount(from: Selection[], to: Selection[]) {
  const before = new Map(from.map(row => [row.lot_id, row.mode_id]))
  const after = new Map(to.map(row => [row.lot_id, row.mode_id]))
  let lots = 0, modes = 0
  for (const lot of after.keys()) if (!before.has(lot)) lots += 1
  for (const [lot, mode] of after) if (before.has(lot) && before.get(lot) !== mode) modes += 1
  return { lots, modes, total: lots + modes }
}
