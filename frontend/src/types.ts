export type Scenario = 'BASE' | 'STRESS'
export type ModeId = 'A' | 'B' | 'C'
export type Selection = { lot_id: string; mode_id: ModeId }
export type RequestInput = { schema_version: string; case_id: string; case_version: string; selection: Selection[] }
export type NamedPortfolio = { name: string; request: RequestInput }
export type SavedAlternative = NamedPortfolio & { alternative_id: string }
export type Workspace = { current: NamedPortfolio; alternatives: SavedAlternative[]; scenario: Scenario }
export type Scalar = number | string | string[] | boolean | null
export type Lot = {
  lot_id: string; service: string; territorial_archetype: string; capability_groups: string; federal: boolean
} & Record<string, Scalar>
export type Mode = { mode_id: ModeId; public_core: boolean; k_c0: number; k_opex: number; k_vpub: number; k_anchor: number; k_commercial: number }
export type Catalog = {
  schema_version: string; case_id: string; case_version: string; source_hashes: Record<string, string>
  lots: Lot[]; modes: Mode[]; units: Record<string, string>; period: string
  constraints_common: Record<string, number>; scenarios: Record<Scenario, { c0_max_mrub: number }>
}
export type Diagnostic = {
  id: string; condition: string; metric: string; comparator: string; limit: number; fact: number | null
  unit: string; status: string; ok: boolean | null; margin: number | null; deficit: number | null
  action: string; eps: number; tolerance_accepted: boolean
  limit_source: { file: string; pointer: string }; formula_source: string
}
export type Result = {
  original_request: RequestInput; input_fingerprint: string; source_hashes: Record<string, string>
  metrics: Record<string, Scalar>; units: Record<string, string>; period: string
  completeness: { status: string; selected_lots: number; required_lots: number }
  scenarios: Record<Scenario, { status: string; diagnostics: Diagnostic[] }>
  detail: (Lot & { mode_id: ModeId; public_core: boolean; provenance: Record<string, unknown> })[]
  provenance: { aggregates: Record<string, { formula: string; formula_source: string; contributors: unknown[]; value: Scalar }> }
}
export type Envelope = {
  format_version: 'kosmos-workspace/1'; source_hashes: Record<string, string>; workspace: Workspace
  computed?: {
    current: Result; alternatives: { name: string; result: Result }[]
    deltas: { name: string; reference_name: string; metrics: Record<string, number> }[]
  }
}
