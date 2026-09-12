/** First screen: what is recommended, whether it survives the official budget shock,
 *  and how the recommendation was reached. Every count comes from
 *  /api/decision/recompute; nothing here is hardcoded. */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { criterionNames, format, lotNames, metricHints, money, signed } from './presentation'
import { composition } from './decision'
import { Block, Callout, Fact, Facts, Verdict, ViewHead } from './ui'
import type { DecisionState } from './useDecision'
import type { Catalog, Scenario } from './types'
import type { ViewId } from './routes'

export function Overview({ decision, catalog, appliedId, go }: {
  decision: DecisionState; catalog: Catalog; appliedId: string | null
  go: (view: ViewId, tab?: string) => void
}) {
  const [open, setOpen] = useState('')
  const { result, scenario, error, busy, valid } = decision
  const population = result?.search.population
  const feasible = population?.scenarios[scenario]
  const leader = result?.search.ranking[0]
  const runnerUp = result?.search.ranking[1]
  const recommendation = result?.recommendation
  const stress = leader?.scenarios.STRESS
  const holds = stress?.status === 'PASS'
  const drivers = leader ? Object.entries(leader.contributions).sort((a, b) => b[1] - a[1]).slice(0, 3) : []

  if (!result || !leader || !feasible || !population) return <>
    <ViewHead title="Обзор" state={`${scenario} · лимит C0 ${money(catalog.scenarios[scenario].c0_max_mrub)}`} />
    <Callout tone={error ? 'error' : 'note'} role={error ? 'alert' : 'status'}>
      {error ? `Рекомендация скрыта до успешного пересчёта. ${error}`
        : !valid ? 'Рейтинг скрыт: исправьте веса в разделе «Поиск».'
          : busy ? 'Проверяем ввод…' : 'Перебираем все составы и пересчитываем рейтинг…'}
    </Callout>
    {error && <p><button type="button" onClick={decision.invalidate}>Повторить расчёт</button></p>}
  </>

  return <>
    <ViewHead title="Обзор"
      state={`${scenario} · лимит C0 ${money(catalog.scenarios[scenario].c0_max_mrub)} · ${format(feasible.feasible)} допустимых`}
      actions={<button type="button" className="primary" onClick={() => go('search', 'shortlist')}>Открыть поиск</button>} />

    <div className="overview-decision">
      <div className="decision-card">
        <p className="object-role">Рекомендуемый портфель</p>
        <p className="object-title">{composition(leader.selection)}</p>
        <p className="object-meta">№{leader.rank} из {format(result.search.ranked_count)} · score {format(leader.score, 3)}</p>
        <ol className="lot-strip">{leader.selection.map(row => {
          const core = leader.public_core_ids.includes(row.lot_id)
          return <li key={row.lot_id} className={core ? 'core' : ''}>
            <span className="lot-strip-id">{row.lot_id}</span>
            <span className="lot-strip-mode" aria-label={`режим ${row.mode_id}`}>{row.mode_id}</span>
            <span className="lot-strip-name">{lotNames[row.lot_id]}</span>
            <span className="lot-strip-core">{core ? 'общественное ядро' : 'вне ядра'}</span>
          </li>
        })}</ol>
      </div>
      <Facts className="decision-figures">
        <Fact label="Стартовые затраты" code="C0" hint={metricHints.c0_mrub} value={money(leader.metrics.c0_mrub)} />
        <Fact label="Общественная ценность" code="VPUB" tone="accent" hint={metricHints.vpub_mrub_per_year}
          value={money(leader.metrics.vpub_mrub_per_year, 'синт. млн ₽/год')} />
        <Fact label="Годовая эксплуатация" code="OPEX" value={money(leader.metrics.opex_mrub_per_year, 'млн ₽/год')} />
        <Fact label="Денежное покрытие" code="KCASH" hint={metricHints.kcash} value={format(leader.metrics.kcash, 3)} />
      </Facts>
    </div>

    <Verdict tone={holds ? 'pass' : 'fail'} badge={`STRESS ${stress?.status}`}
      headline={holds ? 'Портфель не меняется' : 'Состав не проходит STRESS'}
      figures={<>
        <Fact label="Запас BASE" value={signed(leader.scenarios.BASE.c0_margin)} />
        <Fact label="Запас STRESS" tone={holds ? 'pass' : 'fail'} value={signed(stress?.c0_margin)} />
        <Fact label="Допустимых составов" value={`${format(population.scenarios.BASE.feasible)} → ${format(population.scenarios.STRESS.feasible)}`} />
      </>}>
      <p>{holds
        ? `Лимит C0 снижается с ${format(leader.scenarios.BASE.c0_limit)} до ${format(stress!.c0_limit)} млн ₽, стоимость состава не меняется.`
        : `Превышение лимита ${format(stress?.c0_limit)} млн ₽ на ${format(Math.abs(stress?.c0_margin || 0))} млн ₽. Правило метода: ${composition(recommendation!.stress.selection)}.`}
        {' '}<button type="button" className="link" onClick={() => go('stress', 'recommendation')}>Разобрать стресс</button></p>
    </Verdict>

    <div className="overview-columns">
      <Block title="Главные факторы выбора" note="вклад в score при текущих весах">
        <Facts className="driver-facts">
          {drivers.map(([key, value]) => <Fact key={key} label={criterionNames[key] || key} value={format(value, 3)} />)}
        </Facts>
        {runnerUp && <p className="compare-hint">
          Второе место <b>{composition(runnerUp.selection)}</b>: отрыв по score {format(leader.score - runnerUp.score, 3)},
          C0 {signed(runnerUp.metrics.c0_mrub - leader.metrics.c0_mrub)}, VPUB {signed(runnerUp.metrics.vpub_mrub_per_year - leader.metrics.vpub_mrub_per_year)} млн ₽.
          {' '}<button type="button" className="link" onClick={() => go('compare', 'search')}>Цена компромисса</button>
        </p>}
      </Block>

      <Block title="Как получено решение" note={`${format(population.total)} сочетаний → одна рекомендация`}>
        <Path decision={decision} scenario={scenario} open={open} setOpen={setOpen} go={go} />
      </Block>
    </div>

    <p className="view-foot">
      {appliedId === leader.portfolio_id ? 'В конструкторе открыт этот же состав.'
        : appliedId ? 'В конструкторе открыт другой состав.' : 'Конструктор пока пуст.'}
      {' '}Синтетические данные кейса: C0 при запуске и один год эксплуатации.
      {' '}<button type="button" className="link" onClick={() => go('search', 'method')}>О расчёте</button>
    </p>
  </>
}

/** The path of the decision: five real counts, each one openable. Not a progress bar. */
function Path({ decision, scenario, open, setOpen, go }: {
  decision: DecisionState; scenario: Scenario; open: string; setOpen: (id: string) => void
  go: (view: ViewId, tab?: string) => void
}) {
  const result = decision.result!
  const population = result.search.population
  const feasible = population.scenarios[scenario]
  const stages = [
    { id: 'total', label: 'Все сочетания', value: population.total, note: 'четыре лота × режимы A/B/C' },
    { id: 'excluded', label: 'Отсечено условиями', value: feasible.excluded, note: 'девять жёстких условий' },
    { id: 'feasible', label: `Допустимо в ${scenario}`, value: feasible.feasible, note: scenario === 'BASE' ? `STRESS проходят ${format(population.scenarios.STRESS.feasible)}` : 'подмножество BASE' },
    { id: 'shortlist', label: 'Шортлист', value: result.search.ranking.length, note: `из ${format(result.search.ranked_count)} допустимых` },
    { id: 'choice', label: 'Рекомендация', value: 1, note: 'первая по сумме восьми критериев' },
  ]
  const widest = stages[0].value || 1
  const action = (id: string) => id === 'excluded'
    ? <button type="button" className="path-action" aria-expanded={open === 'excluded'} onClick={() => setOpen(open === 'excluded' ? '' : 'excluded')}>Причины исключения</button>
    : id === 'choice' ? <button type="button" className="path-action" onClick={() => go('search', 'why')}>Почему выбрана</button>
      : id === 'total' ? <button type="button" className="path-action" onClick={() => go('search', 'method')}>Каталог и веса</button>
        : <button type="button" className="path-action" onClick={() => go('search', 'shortlist')}>Открыть</button>

  return <>
    <ol className="path">
      {stages.map((stage, index) => <li key={stage.id} className={open === stage.id ? 'open' : ''}>
        <span className="path-index" aria-hidden="true">{index + 1}</span>
        <span className="path-label">{stage.label}</span>
        <span className="path-value">{format(stage.value)}</span>
        <span className="path-bar" aria-hidden="true"><i style={{ '--w': `${(stage.value / widest) * 100}%` } as CSSProperties} /></span>
        <span className="path-note">{stage.note}</span>
        {action(stage.id)}
      </li>)}
    </ol>
    {open === 'excluded' && <Exclusions decision={decision} scenario={scenario} />}
  </>
}

function Exclusions({ decision, scenario }: { decision: DecisionState; scenario: Scenario }) {
  const reasons = decision.result!.search.population.scenarios[scenario].exclusion_reasons
  const excluded = decision.result!.search.population.scenarios[scenario].excluded
  const widest = Math.max(...reasons.map(reason => reason.count), 1)
  return <div className="exclusions">
    <ul>{reasons.map(reason => <li key={reason.id}>
      <span className="exclusion-name">{reason.condition}</span>
      <span className="exclusion-bar" aria-hidden="true"><i style={{ '--w': `${(reason.count / widest) * 100}%` } as CSSProperties} /></span>
      <span className="exclusion-count">{format(reason.count)}</span>
    </li>)}</ul>
    <p className="meta">Один состав может нарушать несколько условий, поэтому доли пересекаются: их сумма больше {format(excluded)} исключённых и не образует взаимно исключающих сегментов.</p>
  </div>
}
