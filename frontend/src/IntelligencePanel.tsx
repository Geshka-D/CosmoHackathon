import { useEffect, useState } from 'react'
import { api } from './api'
import { changes, composition } from './decision'
import type { Candidate, Change, Configuration } from './decision'
import { format, metricNames } from './presentation'
import type { Catalog, Diagnostic, RequestInput, Scenario, Selection } from './types'

type Point = { portfolio_id: string; selection: Selection[]; metrics: Record<string, number>; score: number; rank: number }
type Tradeoff = { delta: Record<string, number>; gains_under_declared_directions: { metric: string; delta: number }[]; losses_under_declared_directions: { metric: string; delta: number }[] }
type MainDifference = { metric: string; raw_delta: number; score_contribution_delta: number } | null
type Proposal = Tradeoff & { strategies: string[]; candidate: Candidate; request: RequestInput; changes: Change; resolved_constraints: string[] }
type Intelligence = {
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
type Claim = { text: string; provenance: string; source: string | null }
type Passport = { interpretation: string; finance: { totals: Record<string, number> }; active_sources: Record<string, string>; services: { lot_id: string; mode_id: string; chain: Claim[]; finance: Record<string, number>; conditions: Claim[]; gap_condition: Claim; confirmed_contracts: Claim }[] }
const financialFields = ['c0_mrub', 'opex_mrub_per_year', 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year', 'cash_mrub_per_year']
const deltaFields = ['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year', 'kcash', 't_rep', 'readiness_1_5', 'resilience_1_5', 'scale_1_5']
const strategyNames: Record<string, string> = { A_MINIMAL_CHANGE: 'A · минимальное изменение', B_MAX_VPUB: 'B · сохранить общественную ценность', C_MIN_C0: 'C · минимальный C0' }

export function IntelligencePanel({ catalog, current, search, onCompare }: {
  catalog: Catalog; current: RequestInput; search: Configuration['request'] | undefined
  onCompare: (name: string, request: RequestInput) => void
}) {
  const [context, setContext] = useState<'OFFICIAL' | 'RESEARCH'>('OFFICIAL')
  const [scenario, setScenario] = useState<Scenario>('BASE')
  const [cap, setCap] = useState(String(catalog.scenarios.BASE.c0_max_mrub))
  const [locks, setLocks] = useState<Record<string, string>>({})
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState<{ key: string; value: Intelligence }>()
  const [error, setError] = useState<{ key: string; text: string }>()
  const [passportResponse, setPassportResponse] = useState<{ key: string; value: Passport }>()
  const [passportError, setPassportError] = useState<{ key: string; text: string }>()
  const [passportOpen, setPassportOpen] = useState(false)
  const [viewed, setViewed] = useState<string>()
  const complete = current.selection.length === 4
  const validCap = cap.trim() !== '' && Number.isFinite(Number(cap)) && Number(cap) >= 0
  const input = search && complete && (context === 'OFFICIAL' || validCap) ? JSON.stringify({
    format_version: 'kosmos-intelligence/1', search: { ...search, scenario }, current, context,
    budget_cap: context === 'RESEARCH' ? Number(cap) : null,
    locks: Object.entries(locks).filter(([, v]) => v).map(([lot_id, mode]) => ({ lot_id, mode_id: mode === 'LOT' ? null : mode })),
  }) : ''
  const key = `${input}:${attempt}`
  const result = response?.key === key ? response.value : undefined
  const failure = error?.key === key ? error.text : ''
  const passportKey = JSON.stringify(current)
  const savedPassport = passportResponse?.key === passportKey ? passportResponse.value : undefined
  const passportFailure = passportError?.key === passportKey ? passportError.text : ''
  useEffect(() => {
    if (!input || !attempt) return
    const controller = new AbortController()
    let live = true
    const timer = setTimeout(() => {
      api<Intelligence>('/api/intelligence', input, controller.signal).then(value => {
        if (live) { setResponse({ key, value }); setError(undefined) }
      }).catch(err => { if (live) setError({ key, text: (err as Error).message }) })
    }, 120)
    return () => { live = false; clearTimeout(timer); controller.abort() }
  }, [input, key, attempt])
  useEffect(() => {
    if (!passportOpen || !complete) return
    const controller = new AbortController()
    let live = true
    api<Passport>('/api/passport', passportKey, controller.signal).then(value => {
      if (live) { setPassportResponse({ key: passportKey, value }); setPassportError(undefined) }
    }).catch(err => { if (live) setPassportError({ key: passportKey, text: (err as Error).message }) })
    return () => { live = false; controller.abort() }
  }, [passportOpen, complete, passportKey])
  const compare = (point: { selection: Selection[]; portfolio_id: string }) => {
    setViewed(point.portfolio_id)
    onCompare(`${context} ${scenario} · ${composition(point.selection)}`, { ...current, selection: point.selection })
  }
  function reset() {
    setContext('OFFICIAL'); setScenario('BASE'); setCap(String(catalog.scenarios.BASE.c0_max_mrub)); setLocks({})
    setAttempt(0); setResponse(undefined); setError(undefined); setViewed(undefined); setPassportOpen(false)
  }
  const point = result?.explorer.points.find(p => p.portfolio_id === viewed)
  return <section id="intelligence" className="panel" data-testid="intelligence">
    <p className="eyebrow">Deterministic Decision Support</p><h2>Корректировка и бюджетные переходы</h2>
    <p>Предпочтительный портфель при заданных управленческих приоритетах. Сначала hard constraints и locks, затем сравнение. Исследование не меняет официальный выпуск.</p>
    <div className="actions">
      <label>Контекст <select aria-label="Контекст DSS" value={context} onChange={e => setContext(e.target.value as typeof context)}><option value="OFFICIAL">OFFICIAL BASE/STRESS</option><option value="RESEARCH">RESEARCH / WHAT-IF</option></select></label>
      <label>Официальная основа <select aria-label="Сценарий DSS" value={scenario} onChange={e => setScenario(e.target.value as Scenario)}><option>BASE</option><option>STRESS</option></select></label>
      {context === 'RESEARCH' && <label>Research cap · млн руб. <input aria-label="Research budget cap" type="number" step="any" min="0" value={cap} onChange={e => setCap(e.target.value)} /></label>}
      <button onClick={reset}>Reset DSS</button>
    </div>
    <p><b>{context === 'RESEARCH' ? 'RESEARCH / WHAT-IF — меняется только исследовательский C0 cap' : `OFFICIAL ${scenario} — ограничения кейса`}</b>. Веса берутся из текущей панели приоритетов; fixed BASE reference сохраняется. Locks — дополнительные условия пользователя.</p>
    <details><summary>Обязательные сервисы / locks</summary><p>«Сервис» допускает A/B/C; конкретный режим фиксирует и сервис, и режим. Автоматического ослабления нет.</p>
      <div className="actions">{catalog.lots.map(lot => <label key={lot.lot_id}>{lot.lot_id} <select aria-label={`Lock ${lot.lot_id}`} value={locks[lot.lot_id] || ''} onChange={e => setLocks({ ...locks, [lot.lot_id]: e.target.value })}>
        <option value="">Без фиксации</option><option value="LOT">Сервис · любой режим</option><option value="A">Сервис + A</option><option value="B">Сервис + B</option><option value="C">Сервис + C</option>
      </select></label>)}</div>
    </details>
    {!complete && <p className="empty">Соберите четыре сервиса в конструкторе или примените рекомендацию, затем запустите поиск корректировки.</p>}
    {context === 'RESEARCH' && !validCap && <p role="alert">Введите конечный неотрицательный cap.</p>}
    <button disabled={!input} onClick={() => setAttempt(n => n + 1)}>Найти допустимую корректировку</button>
    {!!attempt && !!input && !result && !failure && <p role="status">Перебираем допустимые варианты…</p>}
    {failure && <p role="alert">{failure} Повторите поиск кнопкой выше.</p>}
    {result && <div data-testid="intelligence-result">
      <h3>{result.message}</h3><p>{result.active_scenario}: {result.feasible_count} допустимых. Текущий портфель: <b>{result.current.feasible ? 'PASS' : 'FAIL'}</b>; locks: {result.current.locks_satisfied ? 'выполнены' : 'нарушены'}.</p>
      <p>Cap {format(result.budget.cap)}; запас текущего C0 {format(result.budget.current_margin)} млн руб. Точный экономический breakpoint: <b>{result.budget.current_breakpoint}</b> млн руб.; минимальный бюджет допустимого решения с locks: <b>{result.budget.minimum_feasible_budget ?? 'решения нет даже без cap'}</b>.</p>
      <p className="muted">У breakpoint проверяются также остальные условия. Исходный численный допуск {result.budget.eps}; граница допуска текущего C0: {result.budget.current_acceptance_boundary}. Slider не используется для поиска границ.</p>
      {result.status === 'NO_SOLUTION' && <p className="notice">{result.budget.budget_only_blocker ? `Единственный оставшийся барьер — C0 cap. Решение появляется при бюджете ${result.budget.minimum_feasible_budget} млн руб.` : 'Снятие C0 cap не даёт решения. Причина в остальных ограничениях и/или locks; увеличение бюджета не обещает решения.'}</p>}
      <h3>Фактические запасы текущего портфеля</h3>
      {[false, true].map(structural => <div key={String(structural)}><h4>{structural ? 'Структурные ограничения' : 'Показатели модели'}</h4><div className="table-scroll"><table><thead><tr><th>Условие</th><th>Actual</th><th>Threshold</th><th>Margin</th><th>Status</th></tr></thead><tbody>
        {result.current.diagnostics.diagnostics.filter(d => ['exact_lot_count', 'territorial_archetypes', 'capability_groups', 'public_core_lots'].includes(d.id) === structural).map(d => <tr key={d.id}><th>{d.condition}<small>{d.unit}</small></th><td>{format(d.fact)}</td><td>{d.comparator} {format(d.limit)}</td><td>{format(d.margin)}</td><td>{d.status}</td></tr>)}
      </tbody></table></div></div>)}
      <h3>Допустимые корректировки</h3><p>Дельты относительно текущего состава; ΔC0 не является стоимостью перехода. Совпавшие стратегии объединены.</p>
      {result.recovery.map(p => <article className="access-note" key={p.candidate.portfolio_id}><h4>{p.strategies.map(s => strategyNames[s]).join(' / ')}</h4><b>{composition(p.candidate.selection)}</b><p>{changes(p.changes)}</p>
        <p>Устранены нарушения: {p.resolved_constraints.join(', ') || 'исходные hard constraints уже выполнены'}.</p><Delta value={p} catalog={catalog} />
        <button onClick={() => compare(p.candidate)}>Сравнить корректировку</button></article>)}
      {result.explanation && <><h3>Почему предпочтителен этот вариант</h3><p>{result.explanation.interpretation}</p><b>{composition(result.recommendation!.candidate.selection)}</b>
        <p>Относительно второго места, по величине разницы вкладов в MCDA: главный выигрыш — <Difference value={result.explanation.main_gain_against_runner_up} catalog={catalog} />; главный компромисс — <Difference value={result.explanation.main_compromise_against_runner_up} catalog={catalog} />. Это сравнение при текущих весах.</p>
        <p>Наибольший вклад в score: {result.explanation.strongest_weighted_criterion}. OFFICIAL STRESS: {result.explanation.official_stress.status}, запас C0 {format(result.explanation.official_stress.c0_margin)} млн руб. Уязвимость финансирования: сумма дефицитов сервисов {format(result.recommendation!.candidate.sum_lot_funding_gaps)} млн руб./год.</p>
        <button onClick={() => compare(result.recommendation!.candidate)}>Сравнить рекомендацию DSS</button>
        {result.explanation.nearest_alternatives.map(p => <details key={p.portfolio_id}><summary>В сравнении с {p.portfolio_id} · score gap {format(p.score_gap, 6)}</summary><p>Δ — рекомендация минус эта альтернатива.</p><Delta value={p} catalog={catalog} /></details>)}
        {result.explanation.unconfirmed_conditions.map(c => <p key={c}>{c}</p>)}</>}
      <details><summary>Portfolio Transition Map · {result.transition_map.length} смен рекомендации</summary><p>RESEARCH / WHAT-IF. Интервалы [нижняя, верхняя), последний до ∞; последовательные одинаковые рекомендации объединены. Численные границы учитывают исходный EPS; экономический breakpoint указан отдельно.</p>
        <div className="table-scroll"><table><thead><tr><th>Budget interval / C0 breakpoint</th><th>Предпочтительный состав / изменение</th><th>VPUB / C0 / KCASH</th></tr></thead><tbody>{result.transition_map.map(t => <tr key={t.lower_inclusive}><td>[{t.lower_inclusive}, {t.upper_exclusive ?? '∞'})<small>C0 = {t.economic_breakpoint_c0}</small></td><td><button onClick={() => compare({ portfolio_id: t.portfolio_id, selection: t.request.selection })}>{composition(t.request.selection)}</button><small>{t.change_from_previous ? changes(t.change_from_previous.changes) : 'Первое допустимое решение'}</small></td><td>{format(t.metrics.vpub_mrub_per_year)} / {format(t.metrics.c0_mrub)} / {format(t.metrics.kcash, 6)}{t.change_from_previous && <small>Δ {format(t.change_from_previous.delta.vpub_mrub_per_year)} / {format(t.change_from_previous.delta.c0_mrub)} / {format(t.change_from_previous.delta.kcash, 6)}</small>}</td></tr>)}</tbody></table></div>
      </details>
      <h3>Trade-off Explorer · {result.active_scenario}</h3><p>Все {result.feasible_count} допустимых с locks. C0 по X, VPUB по Y. Это две оси из восьми, не полный многомерный frontier. Клик открывает существующее сравнение в official BASE/STRESS; research cap туда не переносится.</p>
      <Explorer result={result} onCompare={compare} onView={setViewed} />
      {point && <p aria-live="polite">{composition(point.selection)} · C0 {format(point.metrics.c0_mrub)} · VPUB {format(point.metrics.vpub_mrub_per_year)} · KCASH {format(point.metrics.kcash, 6)} · место {point.rank}</p>}
      <label>Любой допустимый вариант <select aria-label="Вариант Explorer" value={viewed || ''} onChange={e => { const p = result.explorer.points.find(r => r.portfolio_id === e.target.value); if (p) compare(p) }}><option value="">Выберите для сравнения</option>{result.explorer.points.map(p => <option key={p.portfolio_id} value={p.portfolio_id}>{p.rank}. {composition(p.selection)}</option>)}</select></label>
      <details><summary>Локальная sensitivity ±20% · сохранённая рекомендация</summary><p>Исходная рекомендация: {result.accepted_recommendation_id}. Четыре настоящих перерасчёта с текущими locks и cap; не полная robustness analysis. Отсутствие ранга означает недопустимость. Для изменения весов используйте существующую панель приоритетов и её Reset.</p><div className="table-scroll"><table><thead><tr><th>Опыт</th><th>Новый лидер</th><th>Место исходного / score gap</th><th>Смена лидера</th><th>Weights</th></tr></thead><tbody>{result.local_sensitivity.map(r => <tr key={`${r.criterion}${r.multiplier}`}><td>{r.criterion} × {r.multiplier}</td><td>{r.leader_id ?? 'Нет решения'}</td><td>{r.original_recommendation_rank ?? 'Вне допустимых'} / {r.score_gap_to_original === null ? '—' : format(r.score_gap_to_original, 6)}</td><td>{r.leader_changed === null ? '—' : r.leader_changed ? 'Да' : 'Нет'}</td><td>{Object.entries(r.weights).map(([k, v]) => <small key={k}>{k}: {format(v, 6)}</small>)}</td></tr>)}</tbody></table></div></details>
      <details><summary>Ranking context</summary><p>BASE reference {result.ranking_context.reference.population_id} · {result.ranking_context.reference.size} составов. Вне диапазона BASE формула экстраполируется без clipping и без перенормировки.</p><pre>{JSON.stringify(result.ranking_context.weights, null, 2)}</pre></details>
    </div>}
    <h3>Financing & Responsibility Passport · текущий состав</h3>
    <button disabled={!complete} onClick={() => setPassportOpen(v => !v)}>{passportOpen ? 'Скрыть паспорт' : 'Открыть паспорт'}</button>
    {passportOpen && complete && !savedPassport && !passportFailure && <p role="status">Проверяем активные M4/M5…</p>}
    {passportOpen && passportFailure && <p role="alert">{passportFailure}</p>}
    {passportOpen && savedPassport && <div data-testid="dss-passport"><p>{savedPassport.interpretation}</p>
      <p>CALCULATED · весь портфель: {financialFields.map(k => `${metricNames[k]} ${format(savedPassport.finance.totals[k])}`).join(' · ')}. C0 — млн руб. при запуске, потоки — млн руб./год.</p>
      <p>VPUB отдельно от денег: {format(savedPassport.finance.totals.vpub_mrub_per_year)} синтетических млн руб./год общественной ценности.</p>
      <p>CALCULATED · portfolio gap {format(savedPassport.finance.totals.portfolio_funding_gap)}; сумма service gaps {format(savedPassport.finance.totals.sum_lot_funding_gaps)} млн руб./год.</p>
      {savedPassport.services.map(s => <article className="access-note" key={s.lot_id}><h4>{s.lot_id} {s.mode_id}</h4>
        {s.chain.map((c, i) => <p key={i}>{i ? '↓ ' : ''}{c.text} <small>{c.provenance}{c.source && ` · ${c.source}`}</small></p>)}
        <p>CALCULATED · {financialFields.map(k => `${metricNames[k]} ${format(s.finance[k])}`).join(' · ')} · service gap {format(s.finance.lot_funding_gap)} млн руб./год (C0 — при запуске).</p>
        {[...s.conditions, s.gap_condition, s.confirmed_contracts].map((c, i) => <p key={i}>{c.provenance} · {c.text}</p>)}
      </article>)}<details><summary>Provenance · active pointers</summary><pre>{JSON.stringify(savedPassport.active_sources, null, 2)}</pre></details></div>}
  </section>
}

function Difference({ value, catalog }: { value: MainDifference; catalog: Catalog }) {
  return <>{value ? `${metricNames[value.metric]}: Δ ${format(value.raw_delta, 6)} ${catalog.units[value.metric]}; вклад Δ ${format(value.score_contribution_delta, 6)}` : 'не выделен по взвешенным критериям'}</>
}

function Delta({ value, catalog }: { value: Tradeoff; catalog: Catalog }) {
  return <><p>Выигрыш: {value.gains_under_declared_directions.map(d => metricNames[d.metric]).join(', ') || 'нет по восьми критериям'}. Компромисс: {value.losses_under_declared_directions.map(d => metricNames[d.metric]).join(', ') || 'нет по восьми критериям'}.</p><div className="table-scroll"><table><thead><tr>{deltaFields.map(k => <th key={k}>Δ {metricNames[k]}<small>{catalog.units[k]}</small></th>)}</tr></thead><tbody><tr>{deltaFields.map(k => <td key={k}>{format(value.delta[k], 6)}</td>)}</tr></tbody></table></div></>
}

function Explorer({ result, onCompare, onView }: { result: Intelligence; onCompare: (p: Point) => void; onView: (id: string) => void }) {
  const points = result.explorer.points
  if (!points.length) return <p className="empty">Нет допустимых точек при заданных условиях.</p>
  const current = result.current.candidate
  const all = [...points, current]
  const xs = all.map(p => p.metrics.c0_mrub), ys = all.map(p => p.metrics.vpub_mrub_per_year)
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const x = (v: number) => 65 + (v - xmin) / (xmax - xmin || 1) * 710
  const y = (v: number) => 290 - (v - ymin) / (ymax - ymin || 1) * 245
  const leaderId = result.recommendation?.candidate.portfolio_id
  const special = (p: Point) => p.portfolio_id === leaderId || Object.values(result.explorer.extrema).includes(p.portfolio_id) || result.explorer.strong_alternatives.includes(p.portfolio_id)
  return <><svg viewBox="0 0 840 345" role="img" aria-label="Все допустимые портфели C0 VPUB" style={{ width: '100%', maxHeight: 430 }}>
    <path d="M65 35V290H790" fill="none" stroke="currentColor" /><text x="65" y="20">VPUB · {format(ymin)}–{format(ymax)}</text><text x="320" y="335">C0 · {format(xmin)}–{format(xmax)} млн руб.</text>
    {[...points.filter(p => !special(p)), ...points.filter(special)].map(p => <circle key={p.portfolio_id} cx={x(p.metrics.c0_mrub)} cy={y(p.metrics.vpub_mrub_per_year)} r={special(p) ? 6 : 3}
      fill={p.portfolio_id === leaderId ? '#0f5468' : p.portfolio_id === result.explorer.extrema.max_vpub ? '#2a5c46' : p.portfolio_id === result.explorer.extrema.min_c0 ? '#8a5510' : '#74797e'} opacity={special(p) ? 1 : 0.4}
      role="button" tabIndex={special(p) ? 0 : -1} aria-label={`Сравнить ${composition(p.selection)}`} onMouseEnter={() => onView(p.portfolio_id)} onFocus={() => onView(p.portfolio_id)} onClick={() => onCompare(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCompare(p) } }}><title>{composition(p.selection)}</title></circle>)}
    <path d={`M${x(current.metrics.c0_mrub)-7} ${y(current.metrics.vpub_mrub_per_year)-7}l14 14m0 -14l-14 14`} stroke="#8f3227" strokeWidth="3"><title>Текущий пользовательский портфель</title></path>
    {result.accepted_recommendation_id !== leaderId && points.filter(p => p.portfolio_id === result.accepted_recommendation_id).map(p => <circle key="accepted" cx={x(p.metrics.c0_mrub)} cy={y(p.metrics.vpub_mrub_per_year)} r="9" fill="none" stroke="#0f5468" strokeWidth="2" />)}
  </svg><p>Бирюзовый — текущая рекомендация DSS; зелёный — max VPUB; охра — min C0; крупные серые — ближайшие альтернативы; красный крест — пользовательский состав. Контур — сохранённая рекомендация, если допустима и отличается. Роли могут совпадать.</p></>
}
