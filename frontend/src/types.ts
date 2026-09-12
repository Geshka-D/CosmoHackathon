export type Scenario = 'BASE' | 'STRESS'
export type ModeId = 'A' | 'B' | 'C'
export type Selection = { lot_id: string; mode_id: ModeId }
export type RequestInput = { schema_version: string; case_id: string; case_version: string; selection: Selection[] }
export type StressPlan = {
  trigger: string
  actions: { lot_id: string; from: ModeId; to: ModeId }[]
  rationale: string
}
export type TeamSettings = {
  optimism_uplift: number; sigma: number; rho: number; confidence: number; alpha: number; phi: number
  stress_plan: StressPlan
}
export type NamedPortfolio = { name: string; request: RequestInput }
export type SavedAlternative = NamedPortfolio & { alternative_id: string }
export type Workspace = { current: NamedPortfolio; alternatives: SavedAlternative[]; scenario: Scenario; team_settings?: TeamSettings }
export type Scalar = number | string | string[] | boolean | null
export type Lot = {
  lot_id: string; service: string; territorial_archetype: string; capability_groups: string; federal: boolean
} & Record<string, Scalar>
export type Mode = { mode_id: ModeId; public_core: boolean; k_c0: number; k_opex: number; k_vpub: number; k_anchor: number; k_commercial: number }
export type Catalog = {
  schema_version: string; case_id: string; case_version: string; source_hashes: Record<string, string>
  lots: Lot[]; modes: Mode[]; units: Record<string, string>; period: string
  constraints_common: Record<string, number>; scenarios: Record<Scenario, { c0_max_mrub: number }>
  team_defaults: TeamSettings
  team_presets: { reliability_sigma: number; optimism_ladder: number[]; phi_sensitivity: number[] }
  team_setting_provenance: Record<string, unknown>
}
export type Diagnostic = {
  id: string; condition: string; metric: string; comparator: string; limit: number; fact: number | null
  unit: string; status: string; ok: boolean | null; margin: number | null; deficit: number | null
  action: string; eps: number; tolerance_accepted: boolean
  limit_source: { file: string; pointer: string }; formula_source: string
  critical_change_fraction?: number; probability?: number; reliability_status?: string
  target_reserve_mrub?: number; target_reserve_share?: number
}
export type Result = {
  selection: Selection[]
  original_request: RequestInput; input_fingerprint: string; source_hashes: Record<string, string>
  metrics: Record<string, Scalar>; units: Record<string, string>; period: string
  completeness: { status: string; selected_lots: number; required_lots: number }
  scenarios: Record<Scenario, { status: string; diagnostics: Diagnostic[] }>
  detail: (Lot & { mode_id: ModeId; public_core: boolean; provenance: Record<string, unknown> })[]
  provenance: { aggregates: Record<string, { formula: string; formula_source: string; contributors: unknown[]; value: Scalar }> }
  team_analysis: {
    marker: string; settings: TeamSettings; setting_provenance: Record<string, unknown>
    reliability: Record<Scenario, ReliabilityIndicator>
    risk_tornado?: TornadoRow[]
    stress_response?: StressResponse
    nearest_repairs?: Partial<Record<Scenario, RepairResult>>
  }
}
export type ReliabilityIndicator = {
  probability: number; status: string; risk_premium_mrub: number; target_reserve_share: number
  herfindahl: number; effective_lots: number; standard_deviation_mrub: number; reliable: boolean
}
export type TornadoRow = {
  id: string; risk: string; scenario: Scenario; rule_id: string; critical_change_fraction: number
  fact: number; limit: number; status: string; marker: string; formula: string
}
export type PopulationRow = { portfolio_id: string; selection: Selection[]; metrics: Record<string, number>; scenarios: Record<Scenario, { ok: boolean; status: string }> }
export type StressResponse = {
  type: number; label: string; changes: number | null; candidate: PopulationRow | null; sunk_cost_mrub: number | null
}
export type RepairResult = {
  available: boolean; reason?: string; minimum_distance?: number; one_change_available?: boolean
  best?: { distance: number; vpub_loss_mrub_per_year: number; candidate: PopulationRow }
}
export type Envelope = {
  format_version: 'kosmos-workspace/1'; source_hashes: Record<string, string>; workspace: Workspace
  computed?: {
    current: Result; alternatives: { name: string; result: Result }[]
    deltas: { name: string; reference_name: string; metrics: Record<string, number> }[]
  }
}
