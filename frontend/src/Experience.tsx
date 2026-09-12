import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { download } from './api'
import { composition } from './decision'
import type { Candidate, Decision } from './decision'
import type { Intelligence, MainDifference, Passport } from './intelligence'
import type { Catalog, RequestInput, Scenario } from './types'
import { format, lotNames, metricNames, signed } from './presentation'
import { usePassport } from './useEvidence'

export const pitchChapters = [
  ['Задача', 'Выбрать четыре сервиса, которые проходят ограничения и имеют понятные условия внедрения.'],
  ['Пространство решений', 'Покажите полный перебор, причины исключения и допустимое множество.'],
  ['Recommendation', 'Назовите состав и ключевой результат. Рекомендация зависит от объявленных приоритетов.'],
  ['Why this portfolio?', 'Объясните главный выигрыш и уступку относительно ближайшего конкурента.'],
  ['Сильные альтернативы', 'Сопоставьте общественную ценность, стартовый бюджет и поведение в STRESS.'],
  ['BASE → STRESS', 'Уменьшите официальный лимит. Если состав сохраняется, это и есть результат проверки.'],
  ['Research / Recovery', 'Проверьте cap ниже breakpoint, затем зафиксируйте обязательный сервис.'],
  ['Финансирование', 'Разделите запуск, ежегодные деньги и общественную ценность; покажите адресный gap.'],
  ['Условия внедрения', 'Отделите расчёт от договоров, прав, спроса и качества, которые ещё нужно подтвердить.'],
  ['Управленческое решение', 'Сформируйте brief из текущих расчётов и сформулируйте условное решение о пилоте.'],
]

export function PitchControls({ step, onStep, onExit }: {
  step: number; onStep: (n: number) => void; onExit: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [step])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onExit() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onExit])
  return <aside className="pitch-controls" aria-label="Управление защитой">
    <div className="pitch-top"><span className="eyebrow">KOSMOS / Обзор решения · 3–5 минут</span>
      <div className="actions"><button disabled={step === 0} onClick={() => onStep(step - 1)}>Back</button>
        <span className="pitch-count">{step + 1} / {pitchChapters.length}</span>
        <button className="primary" disabled={step === pitchChapters.length - 1} onClick={() => onStep(step + 1)}>Next</button>
        <button onClick={() => onStep(0)}>С начала</button><button onClick={onExit}>Закрыть обзор</button></div></div>
    <h2 ref={heading} tabIndex={-1}>{pitchChapters[step][0]}</h2>
    <p>{pitchChapters[step][1]}</p>
    <small>Данные и настройки продукта общие. «С начала» возвращает к началу рассказа; исследование сбрасывается через Reset DSS.</small>
  </aside>
}

export function Mission({ total }: { total?: number }) {
  return <section id="mission" className="mission panel">
    <p className="eyebrow">Космос как инфраструктура / Decision Intelligence</p>
    <h2>Из множества сервисов —<br />в защищаемое решение.</h2>
    <p>Четыре сервиса. Ограниченный бюджет. Общественная ценность и условия реального запуска.</p>
    <div className="mission-route"><span>{total ? format(total) : '…'} вариантов</span><span>Жёсткие условия</span><span>Приоритеты</span><span>Устойчивость</span><span>Внедрение</span></div>
    <p className="muted">Синтетические данные кейса. Результат — основание для решения о пилоте при выполнении условий, без утверждений о фактическом спросе и достигнутом эффекте.</p>
  </section>
}

function difference(value: MainDifference, catalog: Catalog) {
  return value ? `${metricNames[value.metric]}: ${signed(value.raw_delta)} ${catalog.units[value.metric] || ''}; вклад в преимущество score ${signed(value.score_contribution_delta)}`
    : 'Отдельный фактор не выделяется по взвешенным критериям.'
}

export function WhyNarrative({ value, catalog }: { value?: Intelligence; catalog: Catalog }) {
  if (!value?.explanation || !value.recommendation) return null
  const e = value.explanation
  return <div className="why-narrative" data-testid="why-narrative">
    <div className="why-thesis"><span className="eyebrow">Почему первый, а не второй</span>
      <h3>Предпочтение с понятной ценой.</h3><p>{e.interpretation}</p>
      <small>Текущие веса · фиксированная BASE-шкала · сначала все hard constraints</small></div>
    <div className="why-gain"><b>Главный выигрыш</b><p>{difference(e.main_gain_against_runner_up, catalog)}</p></div>
    <div className="why-sacrifice"><b>Главная уступка</b><p>{difference(e.main_compromise_against_runner_up, catalog)}</p></div>
    <div className="peer-verdicts">{e.nearest_alternatives.slice(0, 2).map((peer, index) => {
      const candidate = value.explorer.points.find(p => p.portfolio_id === peer.portfolio_id)!
      return <article key={peer.portfolio_id}>
        <p className="eyebrow">{index === 0 ? 'Closest alternative · второе место' : 'Следующая сильная альтернатива · третье место'}</p>
        <h4>{composition(candidate.selection)}</h4>
        <p>Преимущество рекомендации по score: <b>{format(peer.score_gap, 6)}</b>.</p>
        <p>Получаем: {peer.gains_under_declared_directions.map(g => `${metricNames[g.metric]} ${signed(g.delta)}`).join('; ') || 'равенство по критериям'}.</p>
        <p>Уступаем: {peer.losses_under_declared_directions.map(g => `${metricNames[g.metric]} ${signed(g.delta)}`).join('; ') || 'уступок по критериям нет'}.</p>
        <small>Δ — рекомендация минус альтернатива; единицы показаны в матрице ниже. При равенстве score действуют меньший C0 и лексикографический порядок.</small>
      </article>
    })}</div>
  </div>
}

export function OfficialShock({ decision }: { decision?: Decision }) {
  const [scenario, setScenario] = useState<Scenario>('BASE')
  if (!decision) return <section id="official-shock" className="panel"><p role="status">Официальный стресс-ответ появится после пересчёта рекомендации.</p></section>
  const r = decision.recommendation, candidate = r.base
  const cost = candidate.metrics.c0_mrub, base = candidate.scenarios.BASE, stress = candidate.scenarios.STRESS
  const active = candidate.scenarios[scenario]
  const min = Math.min(cost, stress.c0_limit) * 0.97, max = Math.max(cost, base.c0_limit) * 1.015
  const at = (n: number) => (n - min) / (max - min) * 100
  return <section id="official-shock" className="panel official-shock" data-testid="official-shock" data-scenario={scenario}>
    <div className="section-heading"><div><p className="eyebrow">OFFICIAL / сценарии организаторов</p><h2>Меняется лимит. Что происходит с решением?</h2></div>
      <div className="actions" role="group" aria-label="Официальный бюджетный переход">{(['BASE', 'STRESS'] as const).map(s =>
        <button key={s} aria-pressed={scenario === s} onClick={() => setScenario(s)}>{s}</button>)}</div></div>
    <p className="shock-selection">{composition(candidate.selection)}</p>
    <div className="shock-numbers" aria-live="polite"><div><small>Неизменная стоимость · C0</small><strong>{format(cost)}</strong><span>млн руб. при запуске</span></div>
      <div><small>Официальный cap · {scenario}</small><strong>{format(active.c0_limit)}</strong><span>{format(base.c0_limit)} → {format(stress.c0_limit)} млн руб.</span></div>
      <div><small>Запас бюджета · {scenario}</small><strong>{signed(active.c0_margin)}</strong><span>{active.status} · все условия сценария</span></div></div>
    <div className="shock-axis" role="img" aria-label={`Стоимость ${cost}; BASE cap ${base.c0_limit}; STRESS cap ${stress.c0_limit}; текущий cap ${active.c0_limit}`}>
      <div className="shock-axis-line">
        <span className="shock-cost" style={{ left: `${at(cost)}%` }}>C0<small>{format(cost)}</small></span>
        <span className="shock-cap" style={{ transform: `translateX(${at(active.c0_limit)}%)` }}><i /><b>{scenario}<small>{format(active.c0_limit)}</small></b></span>
      </div>
    </div>
    <div className="shock-verdict"><b>{r.action === 'RETAIN' ? 'Состав и режимы сохраняются' : 'Официальное правило требует пересмотра состава'}</b>
      <p>{r.action === 'RETAIN'
        ? `Портфель выдерживает заданный бюджетный shock: запас ${format(base.c0_margin)} → ${format(stress.c0_margin)} млн руб. Снижение cap не уменьшает его стоимость, OPEX, CASH или VPUB.`
        : `BASE-состав: ${stress.status}. Стресс-ответ по правилу метода: ${composition(r.stress.selection)}. ΔC0 ${signed(r.stress_delta_to_base.c0_mrub)} млн руб.`}</p>
      <small>Это устойчивость к заданному ограничению C0. Произвольный бюджет и locks исследуются отдельно.</small></div>
    <a className="next-link" href="#intelligence">Дальше: найти границу устойчивости в Research Budget Lab →</a>
  </section>
}

const chainLabels = ['Кто финансирует¹', 'Кому', 'За что', 'Кто использует', 'Ожидаемый результат']
export function FinanceFlow({ value, title = 'Финансирование рекомендации' }: { value: Passport; title?: string }) {
  const [selected, setSelected] = useState('')
  const service = value.services.find(s => s.lot_id === selected) || value.services[0]
  const t = value.finance.totals
  return <div className="finance-flow" data-testid="finance-flow">
    <h3>{title}</h3>
    <p className="muted">{value.interpretation}</p>
    <div className="finance-ledgers">
      <article><span className="eyebrow">Capital / launch</span><h4>Запуск</h4><strong>{format(t.c0_mrub)}</strong><small>C0 · млн руб., однократно</small><p className="claim-unknown">UNKNOWN · обязательства по финансированию запуска не подтверждены.</p></article>
      <article><span className="eyebrow">Annual operation</span><h4>Один год эксплуатации</h4><strong>{format(t.opex_mrub_per_year)}</strong><small>OPEX · млн руб./год</small><p>Якорный {format(t.anchor_cash_mrub_per_year)} + коммерческий {format(t.commercial_cash_mrub_per_year)} = CASH {format(t.cash_mrub_per_year)}.</p></article>
      <article className="public-ledger"><span className="eyebrow">Public value</span><h4>Общественная ценность</h4><strong>{format(t.vpub_mrub_per_year)}</strong><small>VPUB · синтет. млн руб./год</small><p>Не платёж и не источник покрытия OPEX.</p></article>
    </div>
    <div className="finance-gap"><b>Portfolio gap {format(t.portfolio_funding_gap)}</b><span>≠</span><b>Сумма service gaps {format(t.sum_lot_funding_gaps)} млн руб./год</b><p>Нулевой суммарный gap не разрешает переносить деньги между сервисами.</p></div>
    <div className="service-tabs" role="group" aria-label="Сервис финансовой цепочки">{value.services.map(s =>
      <button key={s.lot_id} aria-pressed={service.lot_id === s.lot_id} onClick={() => setSelected(s.lot_id)}>{s.lot_id} {s.mode_id}<small>{lotNames[s.lot_id]}</small></button>)}</div>
    <ol className="responsibility-chain">{service.chain.map((claim, i) => <li key={i} data-provenance={claim.provenance}>
      <span className="chain-label">{chainLabels[i]}</span><p>{claim.text}</p><small>{claim.provenance}</small>
    </li>)}</ol>
    <small>¹ Заказчик — предложенная роль из M4; подтверждённого плательщика или договора нет.</small>
    <p><b>{service.lot_id} {service.mode_id} · service gap {format(service.finance.lot_funding_gap)} млн руб./год.</b> {service.gap_condition.text}</p>
    <div className="claim-unknown"><b>{service.confirmed_contracts.provenance}</b><p>{service.confirmed_contracts.text}</p></div>
    <details><summary>Условия выбранного сервиса и происхождение</summary>{service.conditions.map((c, i) => <p key={i} className={c.provenance === 'UNKNOWN' ? 'claim-unknown' : 'claim-condition'}><b>{c.provenance}</b> · {c.text}</p>)}<pre>{JSON.stringify(value.active_sources, null, 2)}</pre></details>
  </div>
}

export function ImplementationConditions({ candidate }: { candidate?: Candidate }) {
  return <section id="conditions" className="panel conditions">
    <p className="eyebrow">От расчёта к пилоту</p><h2>Сильное решение требует выполненных условий.</h2>
    <div className="conditions-grid">
      <article><span className="chip">CALCULATED</span><h3>Модель даёт основание</h3>
        <p>{candidate ? `${composition(candidate.selection)}. Сумма адресных дефицитов ${format(candidate.sum_lot_funding_gaps)} млн руб./год.` : 'Ожидаем подтверждённый расчёт.'}</p>
        <p>Допустимость и рейтинг действуют при указанных данных, ограничениях и весах.</p></article>
      <article><span className="chip chip-draft">IMPLEMENTATION CONDITIONS</span><h3>До запуска подтвердить</h3>
        <p>Финансирование C0, адресное покрытие дефицитов, договоры, права на данные, качество на территории, SLA и ответственность.</p>
        <small>Проверка условий — предлагаемое действие команды.</small></article>
      <article><span className="chip">UNKNOWN</span><h3>Не выдаём предположение за факт</h3>
        <p>Фактический спрос, обязательства покупателей, ликвидность, KPI baseline и достигнутые KPI не представлены.</p>
        <small>Следующий шаг: измерить baseline в пилоте и согласовать критерии приёмки.</small></article>
    </div>
  </section>
}

export function briefSections(value: Intelligence, passport: Passport, catalog: Catalog) {
  const p = value.recommendation!.candidate, e = value.explanation!, t = passport.finance.totals
  const peers = e.nearest_alternatives.slice(0, 2)
  const rows = [
    { title: 'Recommendation', text: `${composition(p.selection)}. ${value.context} / ${value.active_scenario}; cap ${format(value.budget.cap)} млн руб.; ${value.feasible_count} допустимых при текущих условиях. C0 ${format(p.metrics.c0_mrub)} млн руб.; OPEX ${format(p.metrics.opex_mrub_per_year)} млн руб./год; VPUB ${format(p.metrics.vpub_mrub_per_year)} синтет. млн руб./год; CASH ${format(p.metrics.cash_mrub_per_year)} млн руб./год; KCASH ${format(p.metrics.kcash, 6)}.` },
    { title: 'Почему выбрана', text: `${e.interpretation} Главный выигрыш относительно второго места: ${difference(e.main_gain_against_runner_up, catalog)}. При равном score действуют меньший C0 и лексикографический состав.` },
    { title: 'Главные альтернативы', text: peers.length ? peers.map(a => { const peer = value.explorer.points.find(x => x.portfolio_id === a.portfolio_id)!; return `${composition(peer.selection)} — score gap ${format(a.score_gap, 6)}; C0 ${format(peer.metrics.c0_mrub)} млн руб.; VPUB ${format(peer.metrics.vpub_mrub_per_year)} синтет. млн руб./год.` }).join(' ') : 'Других допустимых вариантов при этих условиях нет.' },
    { title: 'Главный компромисс', text: difference(e.main_compromise_against_runner_up, catalog) },
    { title: 'Official STRESS', text: `Для выбранного состава: ${p.scenarios.STRESS.status}. Cap ${format(catalog.scenarios.BASE.c0_max_mrub)} → ${format(catalog.scenarios.STRESS.c0_max_mrub)} млн руб.; запас ${format(p.scenarios.BASE.c0_margin)} → ${format(p.scenarios.STRESS.c0_margin)} млн руб. Стоимость одного состава не меняется. ${p.scenarios.STRESS.ok ? 'Состав допустим в официальном STRESS.' : 'Этот состав не проходит официальный STRESS; требуется отдельный официальный стресс-ответ.'}` },
  ]
  if (value.context === 'RESEARCH') rows.push({ title: 'Research breakpoint', text: `WHAT-IF, не сценарий организаторов. Исследуемый исходный состав ${composition(value.current.candidate.selection)}: breakpoint C0 ${value.budget.current_breakpoint} млн руб.; текущий cap ${value.budget.cap}. Минимум с текущими locks ${value.budget.minimum_feasible_budget ?? 'отсутствует'} млн руб. Численный допуск ${value.budget.eps}. Breakpoint проверяет C0; остальные условия и locks обязательны.` })
  rows.push(
    { title: 'Финансирование', text: `CALCULATED: C0 ${format(t.c0_mrub)} млн руб. при запуске; OPEX ${format(t.opex_mrub_per_year)}, anchor ${format(t.anchor_cash_mrub_per_year)}, commercial ${format(t.commercial_cash_mrub_per_year)}, CASH ${format(t.cash_mrub_per_year)} млн руб./год. VPUB отдельно от денег. Portfolio gap ${format(t.portfolio_funding_gap)}, сумма service gaps ${format(t.sum_lot_funding_gaps)} млн руб./год. ${passport.services.map(s => `${s.lot_id} ${s.mode_id}: ${s.chain[0].provenance} — ${s.chain[0].text}; service gap ${format(s.finance.lot_funding_gap)}.`).join(' ')}` },
    { title: 'Главная уязвимость', text: `Сумма адресных дефицитов сервисов ${format(p.sum_lot_funding_gaps)} млн руб./год; нулевой portfolio gap не подтверждает их покрытие. Финансирование запуска и коммерческие обязательства не подтверждены.` },
    { title: 'Условия реального внедрения', text: `${e.unconfirmed_conditions.join(' ')} Фактический спрос, ликвидность, права, SLA, KPI baseline и достигнутые KPI не подтверждены. Для несовпадающих lot/mode паспорт показывает UNKNOWN.` },
    { title: 'Что контролировать дальше', text: 'Предложение команды: до пилота согласовать плательщика, получателя, предмет договора и права; обеспечить адресное покрытие gap; измерить локальное качество и baseline KPI; затем контролировать C0 относительно cap, OPEX, договорный CASH и качество сервиса. VPUB учитывать отдельно. Решение о внедрении условное, после проверки этих условий.' },
  )
  return rows
}

export function DecisionBrief({ value, catalog, pendingContext }: {
  value?: Intelligence; catalog: Catalog; pendingContext?: string
}) {
  const request: RequestInput | undefined = value?.recommendation ? value.recommendation.request : undefined
  const passport = usePassport(request)
  const [openedKey, setOpenedKey] = useState('')
  const key = value && passport.data ? JSON.stringify([value.input_fingerprint, passport.data.active_sources]) : ''
  const ready = !!value?.recommendation && !!value.explanation && !!passport.data && !pendingContext
  const rows = ready ? briefSections(value!, passport.data!, catalog) : []
  const open = !!key && key === openedKey && ready
  const markdown = () => '# KOSMOS · Управленческий brief\n\n' + rows.map((r, i) => `## ${i + 1}. ${r.title}\n\n${r.text}`).join('\n\n')
    + '\n\nКонтекст и происхождение:\n\n```json\n' + JSON.stringify({ context: value!.context, scenario: value!.active_scenario,
      budget_cap: value!.budget.cap, ranking: value!.ranking_context, locks: value!.locks, sources: passport.data!.active_sources }, null, 2) + '\n```\n'
  return <section id="decision-brief" className="panel decision-brief" data-testid="decision-brief">
    <p className="eyebrow">Deterministic / из текущих расчётов</p><h2>Управленческий brief</h2>
    <p>Рекомендация → альтернативы → компромисс → стресс → условия запуска. Контекст: <b>{pendingContext ? `${pendingContext} · ожидаем актуальные данные` : value ? `${value.context} / ${value.active_scenario}` : 'ожидаем расчёт'}</b>.</p>
    {value && <p className="muted">Locks: {value.locks.map(l => `${l.lot_id} ${l.mode_id || 'любой режим'}`).join(' · ') || 'нет'}. Веса и источники включены в скачиваемый brief.</p>}
    {value?.status === 'NO_SOLUTION' && <p className="notice">Допустимого решения нет. Brief с рекомендацией недоступен; измените cap или locks в Budget Lab.</p>}
    {passport.error && <p role="alert">{passport.error} <button onClick={passport.retry}>Повторить паспорт для brief</button></p>}
    {!ready && !passport.error && value?.recommendation && <p role="status">Проверяем паспорт именно этой рекомендации…</p>}
    <div className="actions"><button className="primary" disabled={!ready} onClick={() => setOpenedKey(key)}>Сформировать управленческий brief</button>
      {open && <button onClick={() => download(markdown(), 'kosmos-decision-brief.md', 'text/markdown;charset=utf-8')}>Скачать brief · Markdown</button>}</div>
    {open && <ol className="brief-sections">{rows.map(r => <li key={r.title}><h3>{r.title}</h3><p>{r.text}</p></li>)}</ol>}
  </section>
}

export function DecisionCorridor({ decision }: { decision: Decision }) {
  const [replay, setReplay] = useState(0)
  const p = decision.search.population, active = decision.search.scenario
  const steps = [
    [p.total, 'Полное пространство', 'Все сочетания четырёх сервисов и A/B/C'],
    [p.scenarios[active].feasible, `Hard constraints · ${active}`, 'Допустимое множество до предпочтений'],
    [decision.search.ranking.length, 'Сильные альтернативы', 'Шортлист при текущих управленческих весах'],
    [1, 'Recommendation', 'Предпочтительный состав на фиксированной шкале'],
  ] as const
  return <div className="decision-corridor">
    <div className="corridor-caption"><span>Решения уже рассчитаны · визуальный разбор отбора</span><button className="quiet" onClick={() => setReplay(n => n + 1)}>Показать путь решения</button></div>
    <ol key={replay} className={replay ? 'corridor-steps replay' : 'corridor-steps'}>{steps.map(([number, title, note], i) =>
      <li key={title} style={{ '--stage': i } as CSSProperties}><span className="corridor-count">{format(number)}</span><b>{title}</b><small>{note}</small><i aria-hidden="true" /></li>)}</ol>
    <p className="corridor-official">OFFICIAL <b>BASE {format(p.scenarios.BASE.feasible)}</b><span>→</span><b>STRESS {format(p.scenarios.STRESS.feasible)}</b><small>допустимых составов; управленческие веса не меняют hard constraints</small></p>
  </div>
}
