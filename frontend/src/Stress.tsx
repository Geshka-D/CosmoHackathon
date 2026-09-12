/** STRESS as a managerial condition, not a second ranking stage. All facts and margins
 *  come from Python; the view never reduces a portfolio's cost to the new cap and never
 *  calls the C0 difference a transition cost or a refund. */
import { useState } from 'react'
import { changes, composition, differenceCount, plural, portfolioId } from './decision'
import type { Candidate } from './decision'
import { format, money, signed } from './presentation'
import { Block, Callout, Disclosure, Empty, Fact, Facts, Status, Tabs, Tip, Verdict, ViewHead } from './ui'
import { Budget } from './Budget'
import type { BudgetState } from './Budget'
import type { DecisionState } from './useDecision'
import type { Catalog, RequestInput, Result, Scenario } from './types'
import type { ViewId } from './routes'

const RAW = [
  ['c0_mrub', 'Стартовые затраты', 'млн ₽'], ['opex_mrub_per_year', 'Годовая эксплуатация', 'млн ₽/год'],
  ['vpub_mrub_per_year', 'Общественная ценность', 'синт. млн ₽/год'], ['cash_mrub_per_year', 'Денежный поток', 'млн ₽/год'],
  ['kcash', 'Денежное покрытие', ''], ['t_rep', 'Заданный индекс', ''], ['readiness_1_5', 'Готовность', '1–5'],
  ['resilience_1_5', 'Устойчивость', '1–5'], ['scale_1_5', 'Масштабируемость', '1–5'],
] as const

export function Stress({ tab, catalog, decision, result, pending, busy, workspace, budget, onLoad, go }: {
  tab: string; catalog: Catalog; decision: DecisionState; result?: Result; pending: boolean; busy: boolean
  workspace: { name: string; request: RequestInput }
  budget: BudgetState
  onLoad: (name: string, request: RequestInput) => void
  go: (view: ViewId, tab?: string) => void
}) {
  const population = decision.result?.search.population
  return <>
    <ViewHead title="Устойчивость к бюджетному шоку"
      state={population ? `STRESS проходят ${format(population.scenarios.STRESS.feasible)} из ${format(population.scenarios.BASE.feasible)} допустимых в BASE` : undefined}>
      <Tabs label="Раздел устойчивости" value={tab} items={[
        { id: 'recommendation', title: 'Рекомендация' }, { id: 'own', title: 'Мой состав' }, { id: 'budget', title: 'Корректировка бюджета' },
      ]} onChange={next => go('stress', next)} />
    </ViewHead>

    {tab === 'budget' ? <Budget state={budget} catalog={catalog} />
      : tab === 'own' ? <OwnComposition result={result} pending={pending} busy={busy} decision={decision}
        workspace={workspace} onLoad={onLoad} go={go} />
        : <RecommendationStress decision={decision} catalog={catalog} go={go} />}
  </>
}

/** One shared axis: the cost stays put while the cap moves between the two conditions. */
function BudgetAxis({ cost, base, stress, ok, note }: {
  cost: number; base: number; stress: number; ok: boolean; note?: string
}) {
  const min = Math.min(cost, stress) * 0.985, max = Math.max(cost, base) * 1.012
  const at = (value: number) => `${((value - min) / (max - min)) * 100}%`
  return <div className={`budget-axis ${ok ? '' : 'over'}`} role="img"
    aria-label={`Стоимость состава ${format(cost)} млн руб.; лимит BASE ${format(base)}; лимит STRESS ${format(stress)} млн руб.`}>
    <div className="budget-axis-track">
      <span className="budget-axis-fill" style={{ width: at(cost) }} />
      <span className="budget-axis-cap base" style={{ left: at(base) }}><small>BASE {format(base)}</small></span>
      <span className="budget-axis-cap stress" style={{ left: at(stress) }}><small>STRESS {format(stress)}</small></span>
      <span className="budget-axis-cost" style={{ left: at(cost) }}><small>состав {format(cost)}</small></span>
    </div>
    {note && <p className="meta">{note}</p>}
  </div>
}

/** First tab: does the recommendation survive the official cut? */
function RecommendationStress({ decision, catalog, go }: {
  decision: DecisionState; catalog: Catalog; go: (view: ViewId, tab?: string) => void
}) {
  const result = decision.result
  const leader = result?.search.ranking[0]
  if (!result || !leader) return <Callout tone="note" role="status">Стресс-ответ появится после пересчёта рекомендации.</Callout>
  const recommendation = result.recommendation
  const base = leader.scenarios.BASE, stress = leader.scenarios.STRESS
  const holds = stress.status === 'PASS'
  const population = result.search.population
  return <>
    <Verdict tone={holds ? 'pass' : 'fail'} badge={`STRESS ${stress.status}`}
      headline={recommendation.action === 'RETAIN' ? 'Портфель не меняется' : 'Правило метода требует пересмотра состава'}
      figures={<>
        <Fact label="Запас BASE" value={signed(base.c0_margin)} />
        <Fact label="Запас STRESS" tone={holds ? 'pass' : 'fail'} value={signed(stress.c0_margin)} />
        <Fact label="Допустимых составов" value={`${format(population.scenarios.BASE.feasible)} → ${format(population.scenarios.STRESS.feasible)}`} />
      </>}>
      <p className="object-title">{composition(leader.selection)}</p>
      {recommendation.action !== 'RETAIN' && <p>Стресс-ответ: {composition(recommendation.stress.selection)} · ΔC0 {signed(recommendation.stress_delta_to_base.c0_mrub)} млн ₽.</p>}
    </Verdict>

    <Block title="Стоимость состава не меняется, меняется граница"
      note={<>снижается только лимит C0 <Tip label="Что меняет сценарий">Из девяти условий сценарий меняет только лимит стартовых затрат. Остальные пороги общие для BASE и STRESS. Снижение лимита не удешевляет портфель и не требует сокращать состав.</Tip></>}>
      <BudgetAxis cost={leader.metrics.c0_mrub} base={base.c0_limit} stress={stress.c0_limit} ok={stress.ok !== false} />
      <Facts className="facts-row">
        <Fact label="Стоимость состава" code="C0" value={money(leader.metrics.c0_mrub)} />
        <Fact label="Лимит BASE" value={money(catalog.scenarios.BASE.c0_max_mrub)} />
        <Fact label="Лимит STRESS" value={money(catalog.scenarios.STRESS.c0_max_mrub)} />
      </Facts>
    </Block>

    <Block title="Что делать по правилу метода">
      <p className="block-lead">{recommendation.action === 'RETAIN' ? 'Сохранить состав и режимы.' : 'Пересмотреть состав на лидера STRESS.'}
        <Tip label="Объявленное правило">{decision.method?.recommendation_rule}</Tip></p>
      <Facts>
        <Fact label="Состав при STRESS" value={composition(recommendation.stress.selection)} />
        <Fact label="Изменения состава" value={changes(recommendation.selection_changes)} />
      </Facts>
      <Disclosure summary="Изменения показателей BASE → STRESS и условие">
        <Facts className="facts-tight">
          {(['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year'] as const).map(field =>
            <Fact key={field} label={RAW.find(row => row[0] === field)![1]} value={signed(recommendation.stress_delta_to_base[field])} />)}
        </Facts>
        <p className="meta">{recommendation.condition}</p>
      </Disclosure>
      <div className="actions">
        <button type="button" onClick={() => go('stress', 'budget')}>Найти корректировку бюджета</button>
        <button type="button" className="quiet" onClick={() => go('stress', 'own')}>Проверить свой состав</button>
      </div>
    </Block>
  </>
}

/** Second tab: the same question asked of the manually assembled portfolio. */
function OwnComposition({ result, pending, busy, decision, workspace, onLoad, go }: {
  result?: Result; pending: boolean; busy: boolean; decision: DecisionState
  workspace: { name: string; request: RequestInput }
  onLoad: (name: string, request: RequestInput) => void
  go: (view: ViewId, tab?: string) => void
}) {
  const [preview, setPreview] = useState<Candidate | null>(null)
  const complete = result?.completeness.status === 'COMPLETE'
  const stressOk = result?.scenarios.STRESS.status === 'PASS'
  const budgetOf = (scenario: Scenario) => result?.scenarios[scenario].diagnostics.find(item => item.id === 'c0_limit')
  const base = budgetOf('BASE'), stress = budgetOf('STRESS')
  const cost = typeof result?.metrics.c0_mrub === 'number' ? result.metrics.c0_mrub : 0
  const failing = !result ? [] : result.scenarios.STRESS.diagnostics.filter(item => item.ok === false)
  const currentId = portfolioId(workspace.request.selection)
  const leader = decision.result?.search.ranking[0]
  const candidates = (decision.result?.search.ranking || []).filter(row => row.scenarios.STRESS.ok && row.portfolio_id !== currentId)

  if (!result) return <Callout tone="note" role="status">
    {pending ? 'Пересчитываем оба сценария для текущего состава…' : 'Результат скрыт до успешного пересчёта.'}
  </Callout>

  if (!complete) return <>
    <Callout tone="warn">Соберите четыре лота в конструкторе: допустимость пока не установлена.</Callout>
    <div className="actions">
      {leader && <button type="button" className="primary" disabled={busy} onClick={() => onLoad(`Рекомендация ${decision.scenario}`,
        { ...workspace.request, selection: leader.selection })}>Открыть рекомендуемый состав</button>}
      <button type="button" onClick={() => go('builder')}>Открыть конструктор</button>
    </div>
  </>

  return <>
    <Verdict tone={stressOk ? 'pass' : 'fail'} badge={`STRESS ${result.scenarios.STRESS.status}`}
      headline={stressOk ? 'Состав сохраняется' : 'Состав не проходит STRESS'}
      figures={<>
        <Fact label="Запас BASE" value={signed(base?.margin)} />
        <Fact label="Запас STRESS" tone={stressOk ? 'pass' : 'fail'} value={signed(stress?.margin)} />
        <Fact label="Стоимость состава" code="C0" value={money(cost)} />
      </>}>
      <p className="object-title">{composition(workspace.request.selection)}</p>
      {!stressOk && failing.map(item => <p key={item.id}>{item.condition}: факт {format(item.fact, 3)} {item.unit} при условии {item.comparator} {format(item.limit, 3)}; нарушение {format(item.deficit, 3)} {item.unit}.</p>)}
    </Verdict>

    <Block title="Один состав, два лимита"
      note={<>меняется только граница допустимого C0 <Tip label="Почему стоимость не меняется">BASE и STRESS — разные условия для одного и того же состава, а не две стадии ранжирования. Разница C0 — это только превышение лимита: модель не содержит переходных затрат, штрафов, сроков и уже потраченных средств.</Tip></>}>
      {base && stress && <BudgetAxis cost={cost} base={base.limit} stress={stress.limit} ok={stress.ok !== false} />}
      <div className="stress-grid">{(['BASE', 'STRESS'] as const).map(scenario => {
        const value = budgetOf(scenario)!
        return <article className="stress-card" key={scenario} data-testid={`stress-summary-${scenario}`} data-scenario={scenario}>
          <div className="stress-card-head"><h3 className="object-title">{scenario}</h3><Status value={result.scenarios[scenario].status} /></div>
          <Facts className="facts-tight">
            <Fact label="Стоимость состава" value={money(result.metrics.c0_mrub)} />
            <Fact label="Лимит C0" value={money(value.limit)} />
            <Fact label="Запас" tone={value.ok === false ? 'fail' : 'plain'} value={signed(value.margin)} />
          </Facts>
        </article>
      })}</div>
    </Block>

    {!stressOk && <Block title="Допустимые в STRESS составы из шортлиста"
      note="выбор лучшего по score; задача «минимально изменить состав» решается в корректировке бюджета"
      actions={<button type="button" className="quiet" onClick={() => go('stress', 'budget')}>Корректировка бюджета</button>}>
      {candidates.length === 0
        ? <Empty>В текущем шортлисте нет допустимых в STRESS составов. Переключите сценарий в заголовке на STRESS, чтобы сервер ранжировал допустимые в STRESS варианты.</Empty>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="Допустимые в STRESS кандидаты">
          <table><thead><tr><th>Состав</th><th>Место</th><th>Старт<small>C0</small></th><th>Запас STRESS</th><th>Отличие состава</th><th>Действие</th></tr></thead>
            <tbody>{candidates.map(row => {
              const diff = differenceCount(workspace.request.selection, row.selection)
              return <tr key={row.portfolio_id} className={preview?.portfolio_id === row.portfolio_id ? 'is-preview' : ''}>
                <th scope="row">{composition(row.selection)}</th>
                <td>{row.rank}<small>score {format(row.score, 3)}</small></td>
                <td>{format(row.metrics.c0_mrub)}</td>
                <td>{signed(row.scenarios.STRESS.c0_margin)}</td>
                <td>{diff.total === 0 ? 'совпадает' : `${plural(diff.lots, 'лот', 'лота', 'лотов')}, ${plural(diff.modes, 'режим', 'режима', 'режимов')}`}</td>
                <td><button type="button" onClick={() => setPreview(preview?.portfolio_id === row.portfolio_id ? null : row)}
                  aria-expanded={preview?.portfolio_id === row.portfolio_id}>Предпросмотр</button></td>
              </tr>
            })}</tbody></table>
        </div>}
    </Block>}

    {preview && <Block title={`Предпросмотр: ${composition(preview.selection)}`} note="текущий состав не изменён"
      className="stress-preview">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Показатели до и после предпросмотра">
        <table><thead><tr><th>Показатель</th><th>Сейчас</th><th>В предпросмотре</th><th>Разница</th></tr></thead>
          <tbody>{RAW.map(([field, label, unit]) => {
            const before = typeof result.metrics[field] === 'number' ? result.metrics[field] as number : NaN
            const after = preview.metrics[field]
            return <tr key={field}><th scope="row">{label}{unit && <small>{unit}</small>}</th>
              <td>{format(before, 3)}</td><td>{format(after, 3)}</td>
              <td>{Number.isFinite(before) ? signed(after - before) : '—'}</td></tr>
          })}
            <tr><th scope="row">Запас C0 · STRESS<small>млн ₽</small></th><td>{signed(stress?.margin)}</td><td>{signed(preview.scenarios.STRESS.c0_margin)}</td><td>—</td></tr>
          </tbody></table>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => {
          onLoad(`STRESS-допустимый · место ${preview.rank}`, { ...workspace.request, selection: preview.selection })
          setPreview(null)
        }}>Применить состав</button>
        <button type="button" className="quiet" onClick={() => setPreview(null)}>Отменить предпросмотр</button>
      </div>
      <p className="meta">Применение открывает состав в конструкторе; там же изменение отменяется кнопкой «Отменить изменение».
        Разница C0 показывает только изменение стартовой суммы состава: она не является выручкой, возвратом средств или разрешённым перераспределением между лотами.</p>
    </Block>}

  </>
}
