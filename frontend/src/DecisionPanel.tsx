import { useEffect, useRef, useState } from 'react'
import { api, download } from './api'
import { format, metricNames } from './presentation'
import type { Catalog, RequestInput, Scenario, Selection } from './types'

type Weights = Record<string, number>
type Candidate = {
  portfolio_id: string; selection: Selection[]; score: number; rank: number
  metrics: Record<string, number>; normalized: Weights; contributions: Weights; public_core_ids: string[]
  scenarios: Record<Scenario, { status: string; c0_limit: number; c0_margin: number }>
  net_operating_balance: number; portfolio_funding_gap: number; sum_lot_funding_gaps: number
}
type Method = {
  method_version: string; weights: Weights; applied_weights: Weights; equal_weight_profile: Weights
  field_mapping: Record<string, string>; directions: Record<string, string>; provenance: Record<string, unknown>
  strategy_thesis: string; limitations: string[]; score_interpretation: string; recommendation_rule: string
}
type Configuration = {
  format_version: 'kosmos-decision/1'; expected_population_id: string | null
  request: { format_version: 'kosmos-search/1'; case_id: string; case_version: string; source_hashes: Record<string, string>
    modes: 'A/B/C'; method_version: string; scenario: Scenario; weights: Weights; limit: number; baseline: RequestInput | null }
}
type Change = { added: string[]; removed: string[]; mode_changes: { lot_id: string; from: string; to: string }[]; unchanged: boolean }
type Run = { criterion: string; multiplier: number; applied_weights: Weights; leader: Candidate; original_choice_rank: number | null
  original_choice_score: number | null; selection_changes: Change; zero_weight_unchanged: boolean }
type Decision = {
  configuration: Configuration; input_fingerprint: string; method: Method
  search: { scenario: Scenario; weights: { original: Weights; applied: Weights }; ranking: Candidate[]; ranked_count: number
    reference_population: { population_id: string; size: number; bounds: Record<string, { min: number; max: number }> }
    population: { total: number; stress_is_subset_of_base: boolean; scenarios: Record<Scenario, { feasible: number; excluded: number; exclusion_reasons: { id: string; condition: string; count: number }[] }> } }
  alternatives: { strategy_id: string; title: string; rationale: string; candidate: Candidate; strategy_weights: Weights; current_profile_rank: number | null
    current_profile_score: number | null; same_portfolio_as: string | null; request: RequestInput; delta_to_current_leader: Weights; selection_changes: Change
    service_context: { lot_id: string; mode_id: string; service: string; task_proposal: string; public_core: boolean; mode_coefficients: Weights }[] }[]
  recommendation: { base: Candidate; stress: Candidate; action: string; condition: string; selection_changes: Change; stress_delta_to_base: Weights }
  sensitivity: { runs: Run[]; interpretation: string; original_choice: Candidate; baseline_kind: string; equal_weight_profile: Omit<Run, 'criterion' | 'multiplier' | 'zero_weight_unchanged'> }
}
const KEY = 'kosmos.decision.v1'
const strings = (values: Weights) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
const composition = (rows: Selection[]) => rows.map(row => `${row.lot_id} ${row.mode_id}`).join(' · ')
function changes(value: Change) {
  if (value.unchanged) return 'Состав и режимы сохранились'
  return [value.added.length ? `Добавлены: ${value.added.join(', ')}` : '', value.removed.length ? `Исключены: ${value.removed.join(', ')}` : '',
    ...value.mode_changes.map(row => `${row.lot_id}: ${row.from} → ${row.to}`)].filter(Boolean).join('; ')
}

export function DecisionPanel({ catalog, currentRequest, onLoad }: { catalog: Catalog; currentRequest: RequestInput; onLoad: (name: string, request: RequestInput) => void }) {
  const [method, setMethod] = useState<Method>()
  const [draft, setDraft] = useState<Record<string, string>>()
  const [scenario, setScenario] = useState<Scenario>('BASE')
  const [populationId, setPopulationId] = useState<string | null>(null)
  const [limit, setLimit] = useState(10)
  const [baseline, setBaseline] = useState<RequestInput | null>(null)
  const [response, setResponse] = useState<{ key: string; value: Decision }>()
  const [error, setError] = useState('')
  const [storage, setStorage] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [boot, setBoot] = useState(0)
  const revision = useRef(0)
  const operation = useRef<AbortController | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const backup = useRef<string | null>(null)
  const saveAllowed = useRef(false)
  const weights = draft ? Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() === '' ? NaN : Number(value)])) : undefined
  const valid = weights && Object.values(weights).every(value => Number.isFinite(value) && value >= 0) && Object.values(weights).some(value => value > 0)
  const makeConfig = (selectedWeights: Weights, selectedScenario: Scenario, expected: string | null, selectedMethod: Method, selectedLimit = limit, selectedBaseline = baseline): Configuration => ({
    format_version: 'kosmos-decision/1', expected_population_id: expected,
    request: { format_version: 'kosmos-search/1', case_id: catalog.case_id, case_version: catalog.case_version,
      source_hashes: catalog.source_hashes, modes: 'A/B/C', method_version: selectedMethod.method_version,
      scenario: selectedScenario, weights: selectedWeights, limit: selectedLimit, baseline: selectedBaseline },
  })
  const serialized = method && weights && valid ? JSON.stringify(makeConfig(weights, scenario, populationId, method)) : ''
  const result = response?.key === serialized ? response.value : undefined

  function persist(configuration: Configuration) {
    try {
      localStorage.setItem(KEY, JSON.stringify(configuration))
      backup.current = null
      setStorage('Настройки поиска сохранены. При восстановлении все рейтинги рассчитываются заново.')
    } catch { setStorage('Не удалось сохранить поиск в браузере. Скачайте JSON выбора.') }
  }

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    async function start() {
      try {
        const currentMethod = await api<Method>('/api/decision-method', undefined, controller.signal)
        let restored: Decision | undefined
        let stored: string | null = null
        try { stored = localStorage.getItem(KEY) } catch { setStorage('Хранилище недоступно. Доступен JSON выбора.') }
        if (stored) {
          try { restored = await api<Decision>('/api/decision/recompute', stored, controller.signal) } catch (failure) {
            if (!live) return
            backup.current = stored
            setStorage(`Сохранённый поиск не восстановлен: ${(failure as Error).message} Исходную запись можно скачать. Следующая правка заменит её.`)
          }
        }
        if (!live) return
        setMethod(currentMethod)
        setDraft(strings(restored?.configuration.request.weights || currentMethod.weights))
        setScenario(restored?.configuration.request.scenario || 'BASE')
        setPopulationId(restored?.configuration.expected_population_id || null)
        setLimit(restored?.configuration.request.limit || 10)
        setBaseline(restored?.configuration.request.baseline || null)
        setError('')
        if (restored) setResponse({ key: JSON.stringify(restored.configuration), value: restored })
      } catch (failure) { if (live) setError((failure as Error).message) }
    }
    void start()
    return () => { live = false; controller.abort() }
  }, [catalog, boot])

  useEffect(() => {
    if (!serialized) return
    const controller = new AbortController()
    const ownRevision = revision.current
    let live = true
    const timer = setTimeout(async () => {
      try {
        const value = await api<Decision>('/api/decision/recompute', serialized, controller.signal)
        if (!live || ownRevision !== revision.current) return
        setResponse({ key: serialized, value })
        setError('')
        if (saveAllowed.current) persist(value.configuration)
      } catch (failure) {
        if (!live || ownRevision !== revision.current) return
        setResponse(undefined)
        setError((failure as Error).message)
      }
    }, 250)
    return () => { live = false; controller.abort(); clearTimeout(timer) }
  }, [serialized, retry])
  useEffect(() => () => operation.current?.abort(), [])

  function invalidate() {
    revision.current += 1
    operation.current?.abort()
    setBusy(false)
    setResponse(undefined)
    setError('')
    saveAllowed.current = true
    setRetry(value => value + 1)
  }

  async function importFile(file: File) {
    if (!method) return
    revision.current += 1
    operation.current?.abort()
    setResponse(undefined)
    setError('')
    if (file.size > 65_536) { setError('JSON выбора превышает 65 536 байт. Импортируйте настройки, без вычисленных результатов.'); return }
    const controller = new AbortController()
    operation.current = controller
    const ownRevision = revision.current
    setBusy(true)
    try {
      const value = await api<Decision>('/api/decision/recompute', file, controller.signal)
      if (revision.current !== ownRevision) return
      setDraft(strings(value.configuration.request.weights))
      setScenario(value.configuration.request.scenario)
      setPopulationId(value.configuration.expected_population_id)
      setLimit(value.configuration.request.limit)
      setBaseline(value.configuration.request.baseline)
      saveAllowed.current = true
      // Use the exact locally serialized input key, not server property order.
      setResponse({ key: JSON.stringify(makeConfig(value.configuration.request.weights, value.configuration.request.scenario, value.configuration.expected_population_id, method, value.configuration.request.limit, value.configuration.request.baseline)), value })
      persist(value.configuration)
    } catch (failure) {
      if (revision.current === ownRevision) setError(`Импорт выбора не выполнен; настройки не изменены. ${(failure as Error).message}`)
    } finally { if (revision.current === ownRevision) setBusy(false) }
  }

  async function exportFile() {
    if (!result) return
    const controller = new AbortController()
    operation.current?.abort()
    operation.current = controller
    const ownRevision = revision.current
    setBusy(true)
    try {
      const value = await api<Configuration>('/api/decision/export', serialized, controller.signal)
      if (revision.current === ownRevision) download(JSON.stringify(value, null, 2) + '\n', 'kosmos-decision.json')
    } catch (failure) { if (revision.current === ownRevision) setError((failure as Error).message) }
    finally { if (revision.current === ownRevision) setBusy(false) }
  }

  return <section id="decision" className="panel decision-panel" aria-label="Поиск и выбор">
    <p className="eyebrow">Полный перебор → ограничения → предпочтения</p><h2>Поиск и обоснованный выбор</h2>
    <p>Исследуйте допустимые A/B/C-портфели. Поиск не меняет ручной состав: любой вариант можно открыть в конструкторе отдельным действием.</p>
    {!method || !draft ? <><p role="status">{error || 'Загружаем объявленный метод и пересчитываем сохранённый поиск…'}</p>{error && <button onClick={() => setBoot(value => value + 1)}>Повторить загрузку поиска</button>}</> : <>
      <p>{method.strategy_thesis}</p><p className="notice">{method.score_interpretation}</p>
      <div className="weight-grid">{Object.entries(method.field_mapping).map(([key, field]) => <label key={key}>
        {metricNames[field] || key}<small>{method.directions[key] === 'minimize' ? 'Меньше — предпочтительнее' : 'Больше — предпочтительнее'}</small>
        <input type="number" min="0" step="any" aria-label={`Вес ${key}`} value={draft[key]} disabled={busy} onChange={event => { invalidate(); setDraft({ ...draft, [key]: event.target.value }) }} />
        <small>Объявлено M0: {format(method.weights[key])}</small>
      </label>)}</div>
      {!valid && <p className="field-error" role="alert">Все восемь весов должны быть конечными и неотрицательными; хотя бы один — больше нуля.</p>}
      <div className="actions"><button disabled={busy} onClick={() => { invalidate(); setDraft(strings(method.weights)) }}>Веса M0</button>
        <button disabled={busy} onClick={() => { invalidate(); setDraft(strings(method.equal_weight_profile)) }}>Равные веса</button>
        <label>Сценарий поиска<select aria-label="Сценарий поиска" disabled={busy} value={scenario} onChange={event => { invalidate(); setScenario(event.target.value as Scenario) }}><option>BASE</option><option>STRESS</option></select></label>
        <button disabled={busy || !result} onClick={() => void exportFile()}>Скачать JSON выбора</button>
        <button disabled={busy} onClick={() => upload.current?.click()}>Импорт выбора</button>
        <input hidden ref={upload} type="file" accept=".json,application/json" aria-label="Файл JSON выбора" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
      </div>
      <div className="access-note"><b>Исходное решение для чувствительности</b><p>{baseline ? `Зафиксирован ручной состав: ${composition(baseline.selection)}. Последующие правки конструктора не меняют этот снимок.` : 'Лидер текущего профиля и сценария. Ручной состав не выбран как исходное решение для sensitivity.'}</p>
        <div className="actions"><button disabled={busy || currentRequest.selection.length !== 4} onClick={() => { invalidate(); setBaseline(structuredClone(currentRequest)) }}>Использовать ручной состав для sensitivity</button>
          <button disabled={busy} onClick={() => { invalidate(); setBaseline(null) }}>Использовать лидера для sensitivity</button></div></div>
      {storage && <p className="muted" role="status">{storage}</p>}{backup.current !== null && <button onClick={() => download(backup.current!, 'kosmos-decision-backup.json')}>Скачать прежний поиск</button>}
      {error && <div className="error" role="alert"><p>{error}</p><button onClick={invalidate}>Повторить поиск</button></div>}
      {!result ? <p role="status">{busy ? 'Проверяем JSON выбора…' : !valid ? 'Рейтинг скрыт: исправьте веса.' : error ? 'Результат скрыт до успешного пересчёта.' : 'Python перебирает варианты и пересчитывает рейтинги… Первый поиск требует подготовки всей популяции.'}</p> : <>
        <div className="search-summary" data-testid="search-summary"><b>Всего {result.search.population.total} уникальных вариантов</b>
          {(['BASE', 'STRESS'] as const).map(s => <span key={s}>{s}: {result.search.population.scenarios[s].feasible} допустимых / {result.search.population.scenarios[s].excluded} исключённых</span>)}
          <span>STRESS ⊆ BASE: {result.search.population.stress_is_subset_of_base ? 'да' : 'нет'}</span></div>
        <details className="disclosure"><summary>Причины исключения в {scenario}</summary><p>Причины пересекаются: один вариант может нарушать несколько условий. Их сумма не равна числу исключённых.</p><ul>{result.search.population.scenarios[scenario].exclusion_reasons.map(reason => <li key={reason.id}>{reason.condition}: {reason.count}</li>)}</ul></details>
        <details className="disclosure"><summary>Веса, фиксированная шкала и происхождение</summary>
          <p>R = все {result.search.reference_population.size} BASE-допустимых варианта. Min/max не меняются при STRESS и сравнении карточек. Постоянный критерий даёт 0. Выгода: (x−min)/(max−min); затраты: (max−x)/(max−min). Score = сумма вес × нормированный показатель.</p>
          <p>При равенстве неокруглённого score: меньший C0, затем лексикографический состав lot_id:mode_id. Подписи UI не определяют порядок.</p>
          <div className="table-scroll"><table><thead><tr><th>Критерий</th><th>Введённый вес</th><th>Применённый вес</th><th>Min R</th><th>Max R</th></tr></thead><tbody>{Object.keys(method.weights).map(key => <tr key={key}><th>{key}</th><td>{format(result.search.weights.original[key], 6)}</td><td data-testid={`applied-${key}`} data-value={result.search.weights.applied[key]}>{format(result.search.weights.applied[key], 6)}</td><td>{format(result.search.reference_population.bounds[key].min, 6)}</td><td>{format(result.search.reference_population.bounds[key].max, 6)}</td></tr>)}</tbody></table></div>
          <p className="source">Population ID: {result.search.reference_population.population_id}</p><pre>{JSON.stringify(method.provenance, null, 2)}</pre>
          <ul>{method.limitations.map(text => <li key={text}>{text}</li>)}</ul>
        </details>
        <h3>Лидеры {scenario}</h3><p>Показаны первые {result.search.ranking.length} из {result.search.ranked_count} допустимых. Все исходные метрики — расчёт Python.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Лидеры поиска"><table className="ranking-table"><thead><tr><th>Ранг / состав</th><th>Score</th>{Object.values(method.field_mapping).map(field => <th key={field}>{metricNames[field]}<small>{catalog.units[field]}</small></th>)}<th>Действие</th></tr></thead><tbody>{result.search.ranking.map(row => <tr key={row.portfolio_id} data-portfolio-id={row.portfolio_id} data-score={row.score}><th>{row.rank}. {composition(row.selection)}</th><td>{format(row.score, 6)}</td>{Object.values(method.field_mapping).map(field => <td key={field}>{format(row.metrics[field], 6)}</td>)}<td><button onClick={() => onLoad(`MCDA ${scenario} · ${row.rank}`, { schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: row.selection })}>В конструктор</button></td></tr>)}</tbody></table></div>
        <h3>Стратегии и цена компромисса</h3><p>Предметные стратегии выбираются из BASE-допустимых, стресс-ответ — по заявленному правилу. Стратегии могут совпасть; это отмечено явно. Разницы ниже — к текущему лидеру {scenario} на одной BASE-шкале. Недопустимый в {scenario} состав не получает место.</p>
        <div className="strategy-grid">{result.alternatives.map(item => <article key={item.strategy_id} className="strategy" data-strategy={item.strategy_id}>
          <h4>{item.title}</h4><p><b>{composition(item.candidate.selection)}</b></p>{item.same_portfolio_as && <p className="muted">Совпадает по составу с {item.same_portfolio_as}; это не отдельная альтернатива.</p>}
          <p>{item.rationale}</p><p>Ранг при текущих весах: {item.current_profile_rank ?? 'вне допустимых'}; score: {item.current_profile_score === null ? '—' : format(item.current_profile_score, 6)}</p>
          <p>BASE {item.candidate.scenarios.BASE.status} / STRESS {item.candidate.scenarios.STRESS.status}. Запас C0: BASE {format(item.candidate.scenarios.BASE.c0_margin)} / STRESS {format(item.candidate.scenarios.STRESS.c0_margin)} млн руб.</p>
          <p>Общественное ядро: {item.candidate.public_core_ids.join(', ')}. {changes(item.selection_changes)}.</p>
          <details><summary>Пользователи, задачи и режимы доступа</summary><p>Ниже — предложения команды из service-design M0, а не утверждённые договоры. A/B/C меняет C0, OPEX, VPUB, якорный и коммерческий CASH и признак общественного ядра одновременно. A не означает, что весь сервис бесплатен.</p>
            {item.service_context.map(service => <div key={service.lot_id}><b>{service.lot_id} {service.mode_id} · {service.public_core ? 'общественное ядро' : 'вне общественного ядра'}</b><p>{service.task_proposal}</p><small>Исходные коэффициенты: {Object.entries(service.mode_coefficients).map(([key, value]) => `${key}=${format(value)}`).join('; ')}</small></div>)}
          </details>
          <div className="table-scroll"><table><thead><tr><th>Показатель</th><th>Значение</th><th>Δ к лидеру</th></tr></thead><tbody>{[...Object.values(method.field_mapping), 'cash_mrub_per_year', 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year'].map(field => <tr key={field}><th>{metricNames[field]}<small>{catalog.units[field]}</small></th><td>{format(item.candidate.metrics[field], 6)}</td><td>{format(item.delta_to_current_leader[field], 6)}</td></tr>)}</tbody></table></div>
          <p>CASH − OPEX: {format(item.candidate.net_operating_balance)} млн руб./год; портфельный gap: {format(item.candidate.portfolio_funding_gap)}; сумма дефицитов лотов: {format(item.candidate.sum_lot_funding_gaps)}. Это диагностика финансирования, не прибыль; перераспределение между лотами требует условий.</p>
          <details><summary>Вклады в score стратегии</summary><pre>{JSON.stringify({ weights: item.strategy_weights, normalized: item.candidate.normalized, contributions: item.candidate.contributions }, null, 2)}</pre></details>
          <button onClick={() => onLoad(item.title, item.request)}>Открыть стратегию</button>
        </article>)}</div>
        <div className="access-note" data-testid="recommendation"><h3>Рекомендация BASE и действие при STRESS</h3><p>{method.recommendation_rule}</p>
          <p><b>BASE:</b> {composition(result.recommendation.base.selection)}; C0 {format(result.recommendation.base.metrics.c0_mrub)} млн руб.; запас STRESS {format(result.recommendation.base.scenarios.STRESS.c0_margin)} млн руб.</p>
          <p><b>{result.recommendation.action === 'RETAIN' ? 'Сохранить состав' : 'Пересмотреть состав'}:</b> {composition(result.recommendation.stress.selection)}. {changes(result.recommendation.selection_changes)}.</p>
          <p>Изменение C0: {format(result.recommendation.stress_delta_to_base.c0_mrub)} млн руб.; OPEX: {format(result.recommendation.stress_delta_to_base.opex_mrub_per_year)} млн руб./год; VPUB: {format(result.recommendation.stress_delta_to_base.vpub_mrub_per_year)} синтетических млн руб./год; CASH: {format(result.recommendation.stress_delta_to_base.cash_mrub_per_year)} млн руб./год.</p>
          <p>{result.recommendation.condition}</p></div>
        <h3>Чувствительность предпочтений</h3><p data-testid="sensitivity-baseline">Исходный выбор: {composition(result.sensitivity.original_choice.selection)}. {result.sensitivity.baseline_kind === 'EXPLICIT_PORTFOLIO' ? 'Явно сохранённый ручной состав.' : `Лидер ${scenario} при текущем введённом векторе.`} Каждый опыт меняет только один вес и заново нормирует весь вектор. Недопустимый в {scenario} исходный состав не ранжируется.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Четыре пересчёта чувствительности"><table><thead><tr><th>Опыт</th><th>Лидер / score</th><th>Ранг исходного выбора / его score</th><th>Изменения</th><th>Применённые веса</th></tr></thead><tbody>{result.sensitivity.runs.map(run => <tr key={`${run.criterion}-${run.multiplier}`} data-sensitivity={`${run.criterion}-${run.multiplier}`}><th>{run.criterion} × {run.multiplier}{run.zero_weight_unchanged && <small>Нулевой вес остаётся нулевым</small>}</th><td>{composition(run.leader.selection)}<small>{format(run.leader.score, 6)}</small></td><td>{run.original_choice_rank ?? 'Не ранжируется'}<small>{format(run.original_choice_score, 6)}</small></td><td>{changes(run.selection_changes)}</td><td>{Object.entries(run.applied_weights).map(([key, number]) => <small key={key}>{key}: {format(number, 6)}</small>)}</td></tr>)}</tbody></table></div>
        <p><b>Равновесный профиль:</b> все восемь весов 0,125. Лидер {composition(result.sensitivity.equal_weight_profile.leader.selection)}; score {format(result.sensitivity.equal_weight_profile.leader.score, 6)}. Ранг исходного выбора: {result.sensitivity.equal_weight_profile.original_choice_rank ?? 'не ранжируется'}. {changes(result.sensitivity.equal_weight_profile.selection_changes)}.</p>
        <p className="muted">{result.sensitivity.interpretation}</p><p className="source">Fingerprint конфигурации: {result.input_fingerprint}</p>
      </>}
    </>}
  </section>
}
