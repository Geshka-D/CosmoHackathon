/** First screen: what is open, how many variants survived, what is recommended and
 *  what STRESS does to it. Every count comes from /api/decision/recompute; nothing
 *  here is hardcoded and no stage is animated as if it were being computed now. */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { format, lotNames } from './presentation'
import { composition } from './decision'
import type { DecisionState } from './useDecision'
import type { Catalog, Scenario } from './types'

const criterionNames: Record<string, string> = {
  vpub: 'общественная ценность', c0: 'стартовые затраты', opex: 'эксплуатация', kcash: 'денежное покрытие',
  t_rep: 'индекс t_rep', readiness: 'готовность', resilience: 'устойчивость', scale: 'масштабируемость',
}

export function DecisionAtlas({ decision, catalog, appliedId }: { decision: DecisionState; catalog: Catalog; appliedId: string | null }) {
  const [open, setOpen] = useState('')
  const { result, method, scenario, error, busy, valid } = decision
  const population = result?.search.population
  const feasible = population?.scenarios[scenario]
  const leader = result?.search.ranking[0]
  const recommendation = result?.recommendation
  const stressOfLeader = leader?.scenarios.STRESS
  const profile = !method || !decision.draft ? '' : sameWeights(decision.weights, method.weights) ? 'Объявленный профиль M0'
    : sameWeights(decision.weights, method.equal_weight_profile) ? 'Равные веса, восемь критериев' : 'Исследовательский профиль'
  const exploratory = profile === 'Исследовательский профиль'
  const drivers = leader ? Object.entries(leader.contributions).sort((a, b) => b[1] - a[1]).slice(0, 3) : []
  const stages = !result || !feasible || !leader ? [] : [
    { id: 'total', label: 'Полный перебор', value: population!.total, note: 'четыре лота × режимы A/B/C', target: '#catalog' },
    { id: 'excluded', label: `Не проходят условия ${scenario}`, value: feasible.excluded, note: 'девять жёстких условий', target: '' },
    { id: 'feasible', label: `Допустимы в ${scenario}`, value: feasible.feasible, note: scenario === 'BASE' ? `из них ${population!.scenarios.STRESS.feasible} проходят и STRESS` : 'подмножество BASE', target: '#why' },
    { id: 'shortlist', label: 'Шортлист по приоритетам', value: result.search.ranking.length, note: `показано из ${result.search.ranked_count} допустимых`, target: '#why' },
    { id: 'choice', label: 'Предпочтительный состав', value: 1, note: 'лидер при текущих весах', target: '#why' },
  ]
  const widest = stages.length ? stages[0].value : 1

  return <section id="overview" className="atlas" aria-labelledby="atlas-title">
    <div className="atlas-sheet">
      <div className="atlas-meta">
        <span className="chip chip-scenario" data-scenario={scenario}>Условия {scenario}</span>
        <span>Лимит C0 {format(catalog.scenarios[scenario].c0_max_mrub)} млн руб.</span>
        <span className={exploratory ? 'chip chip-draft' : 'chip'}>{profile || 'Профиль загружается'}</span>
        <span className="atlas-case">Кейс {catalog.case_id} · v{catalog.case_version} · расчёт локальный</span>
      </div>

      {!result ? <div className="atlas-pending" role="status">
        <p className="atlas-kicker" id="atlas-title">Предпочтительный состав при заданных приоритетах</p>
        <p>{error ? 'Рекомендация скрыта до успешного пересчёта. Подробности и повтор — в разделе «Поиск и выбор».'
          : !valid ? 'Рейтинг скрыт: исправьте веса в разделе «Приоритеты».'
            : busy ? 'Проверяем JSON выбора…' : 'Python перебирает все составы и пересчитывает рейтинг…'}</p>
        {error && <p className="atlas-error">{error}</p>}
      </div> : <>
        <div className="atlas-headline">
          <div className="atlas-choice">
            <p className="atlas-kicker" id="atlas-title">Предпочтительный состав при заданных приоритетах</p>
            <ol className="atlas-lots">{leader!.selection.map(row => {
              const core = leader!.public_core_ids.includes(row.lot_id)
              return <li key={row.lot_id} className={core ? 'core' : ''}>
                <span className="atlas-lot-id">{row.lot_id}</span>
                <span className="atlas-lot-mode" aria-label={`режим ${row.mode_id}`}>{row.mode_id}</span>
                <span className="atlas-lot-name">{lotNames[row.lot_id]}</span>
                <span className="atlas-lot-core">{core ? 'общественное ядро' : 'вне ядра'}</span>
              </li>
            })}</ol>
            <p className="atlas-caveat">Предпочтительный при заданных приоритетах, не единственный объективно оптимальный. Score — представление взвешенного индекса на фиксированной шкале, не процент прибыли или вероятности.</p>
          </div>
          <dl className="atlas-figures">
            <div><dt>C0 · запуск</dt><dd>{format(leader!.metrics.c0_mrub)}<small>млн руб.</small></dd></div>
            <div><dt>VPUB · общественная ценность</dt><dd>{format(leader!.metrics.vpub_mrub_per_year)}<small>синтет. млн руб./год</small></dd></div>
            <div><dt>OPEX · год</dt><dd>{format(leader!.metrics.opex_mrub_per_year)}<small>млн руб./год</small></dd></div>
            <div><dt>KCASH · CASH/OPEX</dt><dd>{format(leader!.metrics.kcash, 6)}<small>отношение сумм</small></dd></div>
          </dl>
        </div>

        <div className="atlas-verdict">
          <div className="atlas-why">
            <h2>Почему этот</h2>
            <p>Наибольший вклад в score: {drivers.map(([key, value]) => `${criterionNames[key] || key} ${format(value, 3)}`).join(', ')}.</p>
            <p className="muted">Из {result.search.ranked_count} допустимых составов это первый по сумме восьми взвешенных критериев на фиксированной BASE-шкале.</p>
          </div>
          <div className={`atlas-stress ${stressOfLeader?.status === 'PASS' ? 'holds' : 'breaks'}`}>
            <h2>Что при STRESS</h2>
            {stressOfLeader?.status === 'PASS'
              ? <p><b>Состав сохраняется.</b> Лимит C0 {format(leader!.scenarios.BASE.c0_limit)} → {format(stressOfLeader.c0_limit)} млн руб.; запас {format(leader!.scenarios.BASE.c0_margin)} → {format(stressOfLeader.c0_margin)} млн руб. при неизменной стоимости {format(leader!.metrics.c0_mrub)}.</p>
              : <p><b>Состав не проходит STRESS.</b> Превышение лимита {format(stressOfLeader?.c0_limit)} млн руб. составляет {format(Math.abs(stressOfLeader?.c0_margin || 0))} млн руб. Заявленное правило берёт лидера среди допустимых в STRESS.</p>}
            <p className="muted">Действие по правилу метода: {recommendation?.action === 'RETAIN' ? 'сохранить состав' : `пересмотреть состав → ${composition(recommendation!.stress.selection)}`}.</p>
          </div>
        </div>

        <div className="funnel" role="group" aria-label="Путь решения: от полного перебора к рекомендации">
          {stages.map((stage, index) => <div key={stage.id} className={`funnel-stage ${open === stage.id ? 'open' : ''}`}>
            <span className="funnel-index" aria-hidden="true">{index + 1}</span>
            <span className="funnel-label">{stage.label}</span>
            <span className="funnel-value">{format(stage.value)}</span>
            <span className="funnel-bar" aria-hidden="true"><i style={{ '--w': `${(stage.value / widest) * 100}%` } as CSSProperties} /></span>
            <span className="funnel-note">{stage.note}</span>
            {stage.id === 'excluded'
              ? <button type="button" className="funnel-action" aria-expanded={open === 'excluded'} onClick={() => setOpen(open === 'excluded' ? '' : 'excluded')}>Причины исключения</button>
              : stage.target ? <a className="funnel-action" href={stage.target}>Открыть</a> : null}
          </div>)}
        </div>
        {open === 'excluded' && <ExclusionReasons decision={decision} scenario={scenario} />}

        <div className="atlas-actions">
          <a className="atlas-primary" href="#why">Сравнить с альтернативами</a>
          <a href="#preferences">Изменить приоритеты</a>
          <a href="#stress">Проверить сценарий STRESS</a>
          <a href="#builder">Собрать состав вручную</a>
          <a href="#implementation">Открыть утверждённые материалы</a>
        </div>
        <p className="atlas-foot">
          {appliedId === leader!.portfolio_id
            ? 'В конструкторе сейчас открыт этот же состав.'
            : appliedId ? 'В конструкторе открыт другой состав; расчёт ниже относится к нему отдельно.' : 'Конструктор пока пуст.'}
          {' '}Сохранённые управленческие материалы относятся к своему выпуску и не меняются вместе с этим поиском.
        </p>
      </>}
    </div>
  </section>
}

function ExclusionReasons({ decision, scenario }: { decision: DecisionState; scenario: Scenario }) {
  const reasons = decision.result!.search.population.scenarios[scenario].exclusion_reasons
  const excluded = decision.result!.search.population.scenarios[scenario].excluded
  const widest = Math.max(...reasons.map(reason => reason.count), 1)
  return <div className="exclusions">
    <p>Один состав может нарушать несколько условий сразу, поэтому доли пересекаются: их сумма больше {format(excluded)} исключённых и не образует взаимно исключающих сегментов.</p>
    <ul>{reasons.map(reason => <li key={reason.id}>
      <span className="exclusion-name">{reason.condition}</span>
      <span className="exclusion-bar" aria-hidden="true"><i style={{ '--w': `${(reason.count / widest) * 100}%` } as CSSProperties} /></span>
      <span className="exclusion-count">{format(reason.count)}<small>составов</small></span>
    </li>)}</ul>
  </div>
}

function sameWeights(current: Record<string, number> | undefined, reference: Record<string, number>) {
  if (!current) return false
  return Object.keys(reference).every(key => Math.abs((current[key] ?? NaN) - reference[key]) < 1e-12)
}
