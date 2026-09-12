/** Budget correction: one working tool, not a laboratory of switches.
 *
 *  The user states a budget limit and the services that must stay, asks the server for a
 *  feasible correction, and reads what changes. Hard constraints and locks are applied by
 *  Python first; nothing here relaxes a condition on its own.
 *
 *  The state lives in a hook so moving between screens never loses a search. */
import { useEffect, useState } from 'react'
import { api } from './api'
import { changes, composition } from './decision'
import type { Configuration } from './decision'
import { criterionNames, format, metricCode, metricHuman, metricNames, money, signed, unitOf } from './presentation'
import { Block, Callout, Disclosure, Empty, Fact, Facts, Tabs, Tip, Verdict } from './ui'
import { BudgetMap, RecoveryDiff } from './LabViews'
import type { Intelligence, MainDifference, Point } from './intelligence'
import type { LabSnapshot } from './useEvidence'
import type { Catalog, RequestInput, Scenario, Selection } from './types'
import { initialResearch, ResearchInputs, ResearchReadout, researchSettings } from './ResearchMath'
import type { ResearchResult } from './ResearchMath'

const strategyNames: Record<string, string> = {
  A_MINIMAL_CHANGE: 'Минимальное изменение', B_MAX_VPUB: 'Сохранить общественную ценность', C_MIN_C0: 'Минимальные стартовые затраты',
}
const deltaFields = ['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year', 'kcash']

export type BudgetState = ReturnType<typeof useBudget>

export function useBudget({ catalog, search, scenario, subject, subjectLabel, officialBreakpoint, onApply, onCompare }: {
  catalog?: Catalog; search?: Configuration['request']; scenario: Scenario
  subject?: RequestInput; subjectLabel: string; officialBreakpoint?: number
  onApply: (name: string, request: RequestInput) => void
  onCompare: (name: string, request: RequestInput) => void
}) {
  const [limitText, setLimitText] = useState<string | null>(null)
  const [locks, setLocks] = useState<Record<string, string>>({})
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState<{ key: string; value: Intelligence }>()
  const [failure, setFailure] = useState<{ key: string; text: string }>()
  const [strategy, setStrategy] = useState('')
  const [viewed, setViewed] = useState<string>()
  const [research, setResearch] = useState(initialResearch)
  const [mathReply, setMathReply] = useState<{ key: string; value: ResearchResult }>()
  const mathSettings = researchSettings(research)

  const officialCap = catalog ? catalog.scenarios[scenario].c0_max_mrub : 0
  const custom = limitText !== null
  const numericLimit = custom ? Number(limitText) : officialCap
  const validLimit = !custom || (limitText!.trim() !== '' && Number.isFinite(numericLimit) && numericLimit >= 0)
  const complete = subject?.selection.length === 4
  const context: 'OFFICIAL' | 'RESEARCH' = custom || research.enabled ? 'RESEARCH' : 'OFFICIAL'

  const baseInput = search && subject && complete && validLimit ? {
    format_version: 'kosmos-intelligence/1', search: { ...search, scenario }, current: subject, context,
    budget_cap: context === 'RESEARCH' ? numericLimit : null,
    locks: Object.entries(locks).filter(([, value]) => value).map(([lot_id, mode]) => ({ lot_id, mode_id: mode === 'LOT' ? null : mode })),
  } : undefined
  const input = baseInput && (!research.enabled || mathSettings.valid) ? JSON.stringify(research.enabled ? {
    format_version: 'kosmos-research-math/1', intelligence: baseInput, u: mathSettings.u, cost_risk: mathSettings.cost_risk,
  } : baseInput) : ''
  const key = `${input}:${attempt}`
  const result = response?.key === key ? response.value : undefined
  const error = failure?.key === key ? failure.text : ''
  const mathResult = research.enabled && mathReply?.key === key ? mathReply.value : undefined

  useEffect(() => {
    if (!input || !attempt) return
    const controller = new AbortController()
    let live = true
    const timer = setTimeout(() => {
      api<Intelligence | ResearchResult>(research.enabled ? '/api/research-math' : '/api/intelligence', input, controller.signal).then(value => {
        if (live) {
          if ('analysis' in value) { setMathReply({ key, value }); setResponse({ key, value: value.analysis }) }
          else setResponse({ key, value })
          setFailure(undefined)
        }
      }).catch(problem => { if (live && (problem as Error).name !== 'AbortError') setFailure({ key, text: (problem as Error).message }) })
    }, 120)
    return () => { live = false; clearTimeout(timer); controller.abort() }
  }, [input, key, attempt, research.enabled])

  const subjectKey = JSON.stringify(subject), searchKey = JSON.stringify(search)
  // New research never becomes an input to the ordinary brief/export.
  const snapshot: LabSnapshot = { active: !!attempt && !research.enabled, context, subjectKey, searchKey, result: research.enabled ? undefined : result }

  return {
    limitText, custom, numericLimit, officialCap, validLimit, locks, complete, context, result, error,
    research, setResearch, mathResult,
    attempt, scenario, subject, subjectLabel, snapshot, strategy, viewed, officialBreakpoint,
    pending: !!attempt && !!input && !result && !error,
    ready: !!input,
    setLimit: (value: string) => setLimitText(value),
    useOfficialLimit: () => setLimitText(null),
    toggleLock: (lotId: string, mode: string) => setLocks(current => ({ ...current, [lotId]: mode })),
    setStrategy, setViewed,
    run: () => setAttempt(value => value + 1),
    cancel: () => { setAttempt(0); setResponse(undefined); setMathReply(undefined); setFailure(undefined) },
    explore: (value: number) => { setLimitText(String(Math.max(0, value))); setAttempt(step => step + 1) },
    reset: () => {
      setLimitText(null); setLocks({}); setAttempt(0)
      setResponse(undefined); setFailure(undefined); setStrategy(''); setViewed(undefined)
      setResearch(initialResearch); setMathReply(undefined)
    },
    compare: (point: { selection: Selection[]; portfolio_id: string }) => {
      setViewed(point.portfolio_id)
      onCompare(`${research.enabled ? `RESEARCH cap=${numericLimit}, u=${research.u} · канонические метрики` : scenario} · ${composition(point.selection)}`, { ...subject!, selection: point.selection })
    },
    apply: (name: string, request: RequestInput) => onApply(name, request),
  }
}

export function Budget({ state, catalog }: { state: BudgetState; catalog: Catalog }) {
  const { result } = state
  const chosen = result?.recovery.find(item => item.candidate.portfolio_id === state.strategy) || result?.recovery[0]
  return <>
    <Block title="Условия корректировки"
      note={<>сначала жёсткие ограничения и обязательные сервисы, затем сравнение <Tip label="Что делает корректировка">Поиск минимального изменения состава, при котором выполняются все девять условий и заданный лимит. Исследование не меняет официальный выпуск и сохранённые материалы.</Tip></>}>
      <Facts className="facts-row">
        <Fact label={state.subjectLabel} value={state.subject ? composition(state.subject.selection) : '—'} />
        <Fact label="Официальная основа" value={`${state.scenario} · лимит ${money(state.officialCap)}`} />
      </Facts>

      <div className="budget-controls">
        <label className="budget-limit">Лимит бюджета · млн ₽
          <input aria-label="Лимит бюджета" type="number" step="any" min="0"
            value={state.custom ? state.limitText! : String(state.officialCap)}
            onChange={event => state.setLimit(event.target.value)} />
        </label>
        <span className={state.custom ? 'chip chip-draft' : 'chip chip-scenario'}>
          {state.custom ? 'свой лимит' : `официальный лимит ${state.scenario}`}
        </span>
        {state.custom && <button type="button" className="quiet" onClick={state.useOfficialLimit}>Вернуть официальный лимит</button>}
      </div>
      {state.custom && !state.validLimit && <p className="field-error" role="alert">Введите конечный неотрицательный лимит.</p>}

      <div className="lock-strip">
        <span className="lock-strip-title">Обязательные сервисы</span>
        {(state.subject?.selection || []).map(row => {
          const value = state.locks[row.lot_id] || ''
          return <button key={row.lot_id} type="button" className={value ? 'lock-active' : ''}
            aria-pressed={!!value} onClick={() => state.toggleLock(row.lot_id, value ? '' : 'LOT')}>
            <i aria-hidden="true">{value ? '●' : '○'}</i>{row.lot_id}{value && value !== 'LOT' ? ` ${value}` : ''}
          </button>
        })}
        {!Object.values(state.locks).some(Boolean) && <span className="meta">не заданы: допустимы замены сервисов</span>}
      </div>
      <Disclosure summary="Зафиксировать конкретный режим" note="«сервис» допускает A/B/C; режим фиксирует и сервис, и режим">
        <div className="lock-grid">{catalog.lots.map(lot => <label key={lot.lot_id}>{lot.lot_id}
          <select aria-label={`Обязательный сервис ${lot.lot_id}`} value={state.locks[lot.lot_id] || ''}
            onChange={event => state.toggleLock(lot.lot_id, event.target.value)}>
            <option value="">Не обязателен</option><option value="LOT">Любой режим</option>
            <option value="A">Режим A</option><option value="B">Режим B</option><option value="C">Режим C</option>
          </select></label>)}</div>
        <p className="meta">Автоматического ослабления обязательных сервисов нет.</p>
      </Disclosure>

      {!state.complete && <Empty>Соберите четыре сервиса в конструкторе или откройте рекомендацию, затем запустите поиск корректировки.</Empty>}
      <ResearchInputs value={state.research} onChange={state.setResearch} />
      <div className="actions">
        <button type="button" className="primary" disabled={!state.ready} onClick={state.run}>Найти допустимую корректировку</button>
        {state.officialBreakpoint !== undefined && <button type="button" onClick={() => state.explore(state.officialBreakpoint! - 1)}>Исследовать ниже границы</button>}
        <button type="button" className="quiet" onClick={state.reset}>Сбросить условия</button>
        {state.pending && <button type="button" className="quiet" onClick={state.cancel}>Отменить расчёт</button>}
      </div>
      {state.pending && <Callout tone="note" role="status">Перебираем допустимые варианты…</Callout>}
      {state.error && <Callout tone="error" role="alert">{state.error} Повторите поиск кнопкой выше.</Callout>}
    </Block>

    {result && <div data-testid="intelligence-result">
      {state.mathResult && <ResearchReadout value={state.mathResult} onCap={state.explore} onCompare={state.compare} />}
      <Verdict tone={result.current.feasible ? 'pass' : 'fail'} badge={result.current.feasible ? 'PASS' : 'FAIL'}
        headline={result.message}
        figures={<>
          <Fact label="Лимит" value={money(result.budget.cap)} />
          <Fact label="Запас текущего C0" tone={result.budget.current_margin < 0 ? 'fail' : 'plain'} value={signed(result.budget.current_margin)} />
          <Fact label={`Допустимо в ${result.active_scenario}`} value={format(result.feasible_count)} />
        </>}>
        <p>{result.current.diagnostics.diagnostics.filter(item => item.ok === false).map(item => `${item.condition}: нарушение ${format(item.deficit)} ${item.unit}`).join('; ')
          || (result.current.locks_satisfied ? 'Все ограничения выполнены.' : 'Исходный состав нарушает обязательные сервисы.')}</p>
      </Verdict>

      {result.status === 'NO_SOLUTION'
        ? <Callout tone="warn">{result.budget.budget_only_blocker
          ? `Единственный барьер — лимит C0. Решение появляется при бюджете ${format(result.budget.minimum_feasible_budget)} млн ₽.`
          : 'Снятие лимита C0 не даёт решения: причина в остальных ограничениях или обязательных сервисах.'}</Callout>
        : chosen && <Block title="Предложенная корректировка" note="Δ относительно исходного состава; ΔC0 не является стоимостью перехода"
          actions={result.recovery.length > 1 ? <Tabs label="Стратегия корректировки" value={state.strategy || result.recovery[0].candidate.portfolio_id}
            onChange={state.setStrategy}
            items={result.recovery.map(item => ({ id: item.candidate.portfolio_id, title: item.strategies.map(id => strategyNames[id] || id).join(' / ') }))} /> : undefined}>
          <p className="block-lead">{chosen.strategies.map(id => strategyNames[id] || id).join(' / ')}</p>
          <p className="meta">Устранены нарушения: {chosen.resolved_constraints.map(id => result.current.diagnostics.diagnostics.find(item => item.id === id)?.condition || id).join(', ') || 'исходные ограничения уже выполнены'}.</p>
          <RecoveryDiff proposal={chosen} before={state.subject!.selection} catalog={catalog}
            onCompare={() => state.compare(chosen.candidate)}
            onApply={() => state.apply(`Корректировка · ${composition(chosen.candidate.selection)}`, chosen.request)} />
        </Block>}

      {state.custom && <Block title="Граница устойчивости" note="при каком лимите решение меняется">
        <Facts className="facts-row">
          <Fact label="Граница исходного состава" code="C0" value={money(result.budget.current_breakpoint)} />
          <Fact label="Минимум с обязательными сервисами" value={result.budget.minimum_feasible_budget === null ? 'нет решения' : money(result.budget.minimum_feasible_budget)} />
        </Facts>
        <div className="actions">
          <button type="button" onClick={() => state.explore(result.budget.current_breakpoint)}>Проверить точную границу</button>
        </div>
        <p className="meta">Численный допуск {result.budget.eps}; граница принятия {result.budget.current_acceptance_boundary}. Граница проверяет C0; остальные условия и обязательные сервисы сохраняются.</p>
        <BudgetMap result={result} onCap={state.explore} />
      </Block>}

      <Block title="Подробности расчёта">
        <Disclosure summary="Все ограничения текущего состава" note="факт, порог, запас">
          {[false, true].map(structural => <div key={String(structural)}>
            <h3 className="object-title">{structural ? 'Структурные ограничения' : 'Показатели модели'}</h3>
            <div className="table-scroll"><table><thead><tr><th>Условие</th><th>Факт</th><th>Порог</th><th>Запас</th><th>Статус</th></tr></thead><tbody>
              {result.current.diagnostics.diagnostics.filter(item => ['exact_lot_count', 'territorial_archetypes', 'capability_groups', 'public_core_lots'].includes(item.id) === structural)
                .map(item => <tr key={item.id}><th>{item.condition}<small>{item.unit}</small></th><td>{format(item.fact)}</td>
                  <td>{item.comparator} {format(item.limit)}</td><td>{signed(item.margin)}</td><td>{item.status}</td></tr>)}
            </tbody></table></div>
          </div>)}
        </Disclosure>

        <Disclosure summary="Карта допустимых вариантов" note={`все ${format(result.feasible_count)} допустимых с учётом обязательных сервисов`}>
          <Explorer result={result} onCompare={state.compare} onView={state.setViewed} viewed={state.viewed} />
        </Disclosure>

        <Disclosure summary="Где меняется решение" note={`${result.transition_map.length} интервалов бюджета`}>
          <div className="table-scroll"><table><thead><tr><th>Интервал бюджета</th><th>Предпочтительный состав</th><th>Ценность / старт / покрытие</th></tr></thead>
            <tbody>{result.transition_map.map(row => <tr key={row.lower_inclusive}>
              <td>[{format(row.lower_inclusive)}, {row.upper_exclusive === null ? '∞' : format(row.upper_exclusive)})<small>C0 = {format(row.economic_breakpoint_c0)}</small></td>
              <td><button type="button" className="link" onClick={() => state.compare({ portfolio_id: row.portfolio_id, selection: row.request.selection })}>{composition(row.request.selection)}</button>
                <small>{row.change_from_previous ? changes(row.change_from_previous.changes) : 'первое допустимое решение'}</small></td>
              <td>{format(row.metrics.vpub_mrub_per_year, 1)} / {format(row.metrics.c0_mrub, 1)} / {format(row.metrics.kcash, 3)}</td>
            </tr>)}</tbody></table></div>
          <p className="meta">Интервалы [нижняя, верхняя), последний до ∞; последовательные одинаковые рекомендации объединены.</p>
        </Disclosure>

        {result.explanation && <Disclosure summary="Почему предпочтителен этот вариант">
          <p className="block-lead">{result.explanation.interpretation}</p>
          <p className="object-title">{composition(result.recommendation!.candidate.selection)}</p>
          <Facts>
            <Fact label="Главный выигрыш" tone="pass" value={<Difference value={result.explanation.main_gain_against_runner_up} catalog={catalog} />} />
            <Fact label="Главная уступка" tone="fail" value={<Difference value={result.explanation.main_compromise_against_runner_up} catalog={catalog} />} />
            <Fact label="Наибольший вклад в score" value={criterionNames[result.explanation.strongest_weighted_criterion] || result.explanation.strongest_weighted_criterion} />
            <Fact label="Официальный STRESS" value={`${result.explanation.official_stress.status} · запас ${signed(result.explanation.official_stress.c0_margin)}`} />
            <Fact label="Сумма адресных дефицитов" value={money(result.recommendation!.candidate.sum_lot_funding_gaps, 'млн ₽/год')} />
          </Facts>
          <div className="actions"><button type="button" onClick={() => state.compare(result.recommendation!.candidate)}>Сравнить этот вариант</button></div>
          {result.explanation.unconfirmed_conditions.map(text => <p key={text} className="meta">{text}</p>)}
        </Disclosure>}

        <Disclosure summary="Локальная чувствительность ±20 %" note="четыре настоящих перерасчёта с текущими условиями">
          <div className="table-scroll"><table><thead><tr><th>Опыт</th><th>Новый лидер</th><th>Место исходного</th><th>Смена лидера</th></tr></thead>
            <tbody>{result.local_sensitivity.map(row => <tr key={`${row.criterion}${row.multiplier}`}>
              <td>{criterionNames[row.criterion] || row.criterion} × {row.multiplier}</td>
              <td>{row.leader_id ?? 'нет решения'}</td>
              <td>{row.original_recommendation_rank ?? 'вне допустимых'}</td>
              <td>{row.leader_changed === null ? '—' : row.leader_changed ? 'да' : 'нет'}</td>
            </tr>)}</tbody></table></div>
          <p className="meta">Исходная рекомендация: {result.accepted_recommendation_id}. Не полная robustness analysis; веса меняются в разделе «Поиск».</p>
        </Disclosure>
      </Block>
    </div>}
  </>
}

function Difference({ value, catalog }: { value: MainDifference; catalog: Catalog }) {
  return <>{value
    ? `${metricHuman[value.metric] || metricNames[value.metric]} ${signed(value.raw_delta)} ${unitOf(value.metric) || catalog.units[value.metric] || ''}`.trim()
    : 'не выделен по взвешенным критериям'}</>
}

function Explorer({ result, onCompare, onView, viewed }: {
  result: Intelligence; onCompare: (point: Point) => void; onView: (id: string) => void; viewed?: string
}) {
  const points = result.explorer.points
  if (!points.length) return <Empty>Нет допустимых точек при заданных условиях.</Empty>
  const current = result.current.candidate
  const all = [...points, current]
  const xs = all.map(point => point.metrics.c0_mrub), ys = all.map(point => point.metrics.vpub_mrub_per_year)
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const x = (value: number) => 65 + (value - xmin) / (xmax - xmin || 1) * 710
  const y = (value: number) => 290 - (value - ymin) / (ymax - ymin || 1) * 245
  const leaderId = result.recommendation?.candidate.portfolio_id
  const special = (point: Point) => point.portfolio_id === leaderId
    || Object.values(result.explorer.extrema).includes(point.portfolio_id)
    || result.explorer.strong_alternatives.includes(point.portfolio_id)
  const roles = [
    { id: leaderId, label: 'Рекомендация' },
    { id: result.explorer.extrema.min_c0, label: 'Минимальный старт' },
    { id: result.explorer.extrema.max_vpub, label: 'Максимум ценности' },
    ...result.explorer.strong_alternatives.map((id, index) => ({ id, label: `Альтернатива ${index + 1}` })),
  ]
  const point = points.find(item => item.portfolio_id === viewed)
    || (current.portfolio_id === viewed ? current : undefined)
  return <>
    <div className="explorer-highlights" role="group" aria-label="Ключевые варианты">
      {roles.map(role => {
        const found = points.find(item => item.portfolio_id === role.id)
        return found && <button key={role.label} type="button" onMouseEnter={() => onView(found.portfolio_id)}
          onFocus={() => onView(found.portfolio_id)} onClick={() => onCompare(found)}>{role.label}<small>{composition(found.selection)}</small></button>
      })}
      <button type="button" onMouseEnter={() => onView(current.portfolio_id)} onFocus={() => onView(current.portfolio_id)}
        onClick={() => onCompare(current)}>Текущий состав<small>{composition(current.selection)}</small></button>
    </div>
    <svg viewBox="0 0 840 345" role="img" aria-label="Все допустимые составы: C0 по X, VPUB по Y" style={{ width: '100%', maxHeight: 380 }}>
      <path d="M65 35V290H790" fill="none" stroke="currentColor" />
      <text x="65" y="20">VPUB · {format(ymin, 0)}–{format(ymax, 0)}</text>
      <text x="320" y="335">C0 · {format(xmin, 0)}–{format(xmax, 0)} млн ₽</text>
      {[...points.filter(item => !special(item)), ...points.filter(special)].map(item => <circle key={item.portfolio_id}
        cx={x(item.metrics.c0_mrub)} cy={y(item.metrics.vpub_mrub_per_year)} r={special(item) ? 6 : 3}
        fill={item.portfolio_id === leaderId ? 'var(--accent)' : special(item) ? 'var(--sunken)' : 'var(--text-3)'}
        stroke={special(item) ? 'var(--accent)' : 'none'} strokeWidth={special(item) ? 2 : 0} opacity={special(item) ? 1 : 0.45}
        role="button" tabIndex={special(item) ? 0 : -1} aria-label={`Сравнить ${composition(item.selection)}`}
        onMouseEnter={() => onView(item.portfolio_id)} onFocus={() => onView(item.portfolio_id)} onClick={() => onCompare(item)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCompare(item) } }}>
        <title>{composition(item.selection)}</title></circle>)}
      <path d={`M${x(current.metrics.c0_mrub) - 7} ${y(current.metrics.vpub_mrub_per_year) - 7}l14 14m0 -14l-14 14`} stroke="var(--fail)" strokeWidth="3"
        role="button" tabIndex={0} aria-label="Сравнить текущий состав"
        onMouseEnter={() => onView(current.portfolio_id)} onFocus={() => onView(current.portfolio_id)} onClick={() => onCompare(current)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCompare(current) } }}>
        <title>Текущий состав</title></path>
      {result.accepted_recommendation_id !== leaderId && points.filter(item => item.portfolio_id === result.accepted_recommendation_id).map(item =>
        <circle key="accepted" cx={x(item.metrics.c0_mrub)} cy={y(item.metrics.vpub_mrub_per_year)} r="9" fill="none" stroke="var(--accent)" strokeWidth="2" />)}
    </svg>
    {point && <div aria-live="polite"><Facts className="facts-row">
      <Fact label="Состав" value={composition(point.selection)} />
      {deltaFields.slice(0, 3).map(field => <Fact key={field} label={metricHuman[field] || field} code={metricCode[field]} value={format(point.metrics[field], 1)} />)}
      <Fact label="Место" value={point.rank ? point.rank : 'вне допустимого множества'} />
    </Facts></div>}
    <label className="explorer-pick">Любой допустимый вариант
      <select aria-label="Вариант для сравнения" value={viewed || ''} onChange={event => {
        const found = points.find(item => item.portfolio_id === event.target.value); if (found) onCompare(found)
      }}><option value="">Выберите для сравнения</option>
        {points.map(item => <option key={item.portfolio_id} value={item.portfolio_id}>{item.rank}. {composition(item.selection)}</option>)}</select>
    </label>
    <p className="meta">Две оси из восьми: C0 и VPUB. Клик открывает сравнение в официальном BASE/STRESS; свой лимит туда не переносится.</p>
  </>
}
