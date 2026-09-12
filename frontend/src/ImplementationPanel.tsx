import { useEffect, useState } from 'react'
import { api } from './api'
import { format, lotNames } from './presentation'
import type { RequestInput, Selection } from './types'

type Risk = { id: string; risk: string; owner: string; trigger: string; consequence: string; action: string; residual: string }
type KPI = { id: string; name: string; unit: string; period: string; objects: string; numerator: string; denominator: string; missing: string; source: string; owner: string; acceptance: string; approve_phase: string }
type FinanceRow = { lot_id: string; mode_id: string; c0_mrub: number; opex_mrub_per_year: number; anchor_cash_mrub_per_year: number; commercial_cash_mrub_per_year: number; cash_mrub_per_year: number; vpub_mrub_per_year: number; lot_coverage_ratio: number; net_operating_balance: number; lot_funding_gap: number }
type Money = { c0_mrub: number; opex_mrub_per_year: number; anchor_cash_mrub_per_year: number; commercial_cash_mrub_per_year: number; cash_mrub_per_year: number; lot_coverage_ratio: number; net_operating_balance: number; portfolio_funding_gap: number; sum_lot_funding_gaps: number; vpub_mrub_per_year: number; kcash: number }
type Flow = { kind: string; amount: number; unit: string; payer: string; payee: string; timing: string; purpose: string; basis: string }
type Service = {
  lot_id: string; mode_id: string; territory: string; need: string; action: string; expected_effect: string
  roles: Record<string, string>; finance: FinanceRow; c0_funding: { payer: string; amount: number; unit: string }[]; c0_timing: string
  flows: Flow[]; agreement_condition: string; liquidity_owner: string; liquidity_gate: string
  contract_subject: string; acceptance: string; payment_condition: string; access_rationale: string; public_layer: string; restricted_data: string; failure_response: string; rights: string
  kpis: KPI[]; risks: Risk[]; export_format: string; control_set: string; migration_owner: string
  replication: { core: string; adaptation: string; first_pilot: string; next_site: string; experience: string; gate: string }
  source_refs: string[]; assumption_refs: string[]
}
type Scenario = { c0_limit: number; c0_margin: number; status: string }
type Coalition = {
  phi: number; standalone_total_mrub: number; grand_cost_mrub: number; cooperation_savings_mrub: number; cooperation_savings_share: number
  core: { ok: boolean; checked: number }
  players: { lot_id: string; region: string; standalone_mrub: number; shapley_mrub: number; share: number; proportional_mrub: number; equal_mrub: number }[]
  sensitivity: { phi: number; grand_cost_mrub: number; shares: Record<string, number>; core_ok: boolean }[]
}
type Brief = { portfolio_id: string; selection: Selection[]; metrics: Record<string, number>; scenarios: Record<string, { status: string }>; portfolio_funding_gap: number; sum_lot_funding_gaps: number }
type Advanced = { strategic_triad: { probability_sigma: number; current: Brief; benefit_maximum: Brief; after_option: Brief; option_changes: { lot_id: string; from: string; to: string }[] } }
type Implementation = {
  submission: { available: boolean; reason?: string; submission_id?: string; publication_id?: string; files?: Record<string, { label: string; mime: string; sha256: string; base64: string }> }
  release_id: string; selection: Selection[]; request: RequestInput; identity: unknown
  finance: { rows: FinanceRow[]; totals: Money }; services: Service[]; distinct_strategy_portfolios: number
  coalition: Coalition; advanced_analysis: Advanced
  stress: { action: string; base: Scenario; stress: Scenario; owner: string; conditions: string[]; timing: string }
  alternatives: { strategy_id: string; title: string; selection: Selection[]; finance: { totals: Money }; same_portfolio_as: string | null; rationale: string; public_core_ids: string[]; scenarios: { BASE: Scenario; STRESS: Scenario } }[]
  sensitivity: { runs: { criterion: string; multiplier: number; leader: { selection: Selection[] }; original_choice_rank: number | null }[] }
  configuration: {
    financing_notes: string[]; choice_rationale: string[]; kpi_protocol: string[]; pilot_order: string
    portfolio_risks: Risk[]; shared_dependencies: { id: string; services: string[]; dependency: string; owner: string; gate: string; residual: string }[]
    access_proposals: Record<string, { label: string; terms: string; public_core: boolean }>
    supplier_switch: { triggers: string[]; sequence: string[]; payload: string[]; interface: string; competition: string; costs_and_time: string; continuity: string; residual: string }
    roadmap: { id: string; start_month: number; end_month: number; result: string; owner: string; resources: string; resource_confirmer: string; availability: string; dependency: string; acceptance: string; defer_if: string }[]
    sources: Record<string, { title: string; uri: string; claim: string; limitation: string; checked: string }>
  }
  materials: Record<string, string>; finance_csv: string
}
const composition = (rows: Selection[]) => rows.map(r => `${r.lot_id} ${r.mode_id}`).join(' · ')
const signature = (rows: Selection[]) => rows.map(r => `${r.lot_id}:${r.mode_id}`).sort().join('|')
const roles: Record<string, string> = { buyer: 'Закупщик', c0_payer: 'Ведущий плательщик C0', anchor_payer: 'Плательщик anchor', commercial_payer: 'Плательщики commercial', gap_payer: 'Плательщик адресного gap', operator: 'Оператор / плательщик OPEX', supplier: 'Поставщик', acceptor: 'Независимый приёмщик', user: 'Пользователь', decision_owner: 'Владелец решения', public_beneficiary: 'Общественный получатель' }
const flowNames: Record<string, string> = { anchor: 'Якорный поток', commercial: 'Коммерческий поток', opex: 'Расходы OPEX', additional_support: 'Адресное покрытие gap' }
const materialNames: Record<string, string> = { 'management-note-draft.md': 'Управленческая записка · Markdown', 'stress-summary-draft.md': 'Стресс-резюме · Markdown', 'presentation-draft.md': 'Сценарий презентации · Markdown' }
function save(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function saveArtifact(file: { mime: string; base64: string }, filename: string) {
  const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function RiskList({ values }: { values: Risk[] }) {
  return <div className="implementation-risk-list">{values.map(r => <article key={r.id}><h4>{r.risk}</h4><p><b>Владелец:</b> {r.owner}</p><p><b>Триггер:</b> {r.trigger}. <b>Последствие:</b> {r.consequence}</p><p><b>Действие:</b> {r.action}</p><p className="muted"><b>Остаточное ограничение:</b> {r.residual}</p></article>)}</div>
}
function FinanceTable({ rows, totals }: { rows: FinanceRow[]; totals: Money }) {
  const cells = (r: Omit<FinanceRow, 'lot_id' | 'mode_id'>) => <><td>{format(r.c0_mrub)}</td><td>{format(r.opex_mrub_per_year)}</td><td>{format(r.anchor_cash_mrub_per_year)}</td><td>{format(r.commercial_cash_mrub_per_year)}</td><td>{format(r.cash_mrub_per_year)}</td><td>{format(r.lot_coverage_ratio * 100, 1)} %</td><td>{format(r.net_operating_balance)}</td><td>{format(r.lot_funding_gap)}</td></>
  return <div className="table-scroll" role="region" aria-label="Финансирование сохранённого портфеля" tabIndex={0}><table><thead><tr><th>Сервис</th><th>C0<small>млн руб.</small></th><th>OPEX</th><th>Anchor</th><th>Commercial</th><th>CASH</th><th>Покрытие</th><th>Баланс</th><th>Адресный gap</th></tr></thead><tbody>{rows.map(r => <tr key={r.lot_id}><th scope="row">{r.lot_id} {r.mode_id}</th>{cells(r)}</tr>)}<tr className="implementation-total"><th scope="row">Итого</th>{cells({ ...totals, lot_funding_gap: totals.sum_lot_funding_gaps })}</tr></tbody></table></div>
}

export function ImplementationPanel({ currentRequest, onLoad }: { currentRequest: RequestInput; onLoad: (name: string, request: RequestInput) => void }) {
  const [data, setData] = useState<Implementation>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setData(undefined); setError('')
    api<Implementation>('/api/implementation', undefined, controller.signal).then(value => { if (live) setData(value) }).catch(failure => { if (live) setError((failure as Error).message) })
    return () => { live = false; controller.abort() }
  }, [retry])
  const c = data?.configuration
  return <section id="implementation" className="panel implementation" aria-busy={!data && !error}>
    <div className="section-heading"><div><p className="eyebrow">Финансирование · доступ · запуск</p><h2>Реализация сохранённого решения</h2></div><button onClick={() => { setData(undefined); setError(''); setRetry(n => n + 1) }}>Пересчитать реализацию</button></div>
    <p>Этот раздел и материалы относятся к принятой сохранённой конфигурации. Новые веса в поиске и ручные портфели имеют собственный расчёт; договорные предложения для них требуют отдельного рассмотрения.</p>
    {error ? <div className="error" role="alert"><b>Реализация не подтверждена</b><p>{error}</p><p>Прежние материалы скрыты до успешного пересчёта.</p></div> : !data || !c ? <p role="status">Заново рассчитываем сохранённый M3 и проверяем условия реализации…</p> : <>
      <div className="access-note"><h3>{composition(data.selection)}</h3><p><b>Предложение команды.</b> Реальные договоры, выделенный штат и достигнутые KPI не заявлены.</p><p>{signature(currentRequest.selection) === signature(data.selection) ? 'Ручной конструктор содержит тот же состав и режимы.' : 'Ручной конструктор сейчас содержит другой состав или режимы. Условия ниже относятся только к сохранённому решению.'}</p><button className="primary" onClick={() => onLoad('Сохранённое решение M4', structuredClone(data.request))}>Загрузить сохранённый состав в конструктор</button><p className="source">Release <code>{data.release_id}</code></p></div>
      <h3>Почему выбран этот состав</h3><ul>{c.choice_rationale.map(text => <li key={text}>{text}</li>)}</ul>
      <h3>Запуск и год эксплуатации</h3><p>C0 — млн руб. при запуске. Все остальные денежные столбцы — млн руб./год устойчивой эксплуатации.</p>
      <FinanceTable rows={data.finance.rows} totals={data.finance.totals} />
      <div className="implementation-summary"><p><b>Портфельный gap</b><strong>{format(data.finance.totals.portfolio_funding_gap)} <small>млн руб./год</small></strong></p><p><b>Сумма положительных lot gaps</b><strong>{format(data.finance.totals.sum_lot_funding_gaps)} <small>млн руб./год</small></strong></p><p><b>VPUB · отдельно от денег</b><strong>{format(data.finance.totals.vpub_mrub_per_year)} <small>синтет. млн руб./год</small></strong></p><p><b>KCASH · CASH/OPEX</b><strong>{format(data.finance.totals.kcash, 6)}</strong></p></div>
      <ul>{c.financing_notes.map(text => <li key={text}>{text}</li>)}</ul>
      <h3>Три управленческих состояния одного состава</h3><p>Вероятности рассчитаны при σ={format(data.advanced_analysis.strategic_triad.probability_sigma * 100)} %. Текущая рекомендация не заменена: инструмент показывает цену договорной гибкости.</p><div className="table-scroll"><table><thead><tr><th>Состояние</th><th>Режимы</th><th>C0</th><th>VPUB</th><th>KCASH</th><th>Портфельный gap</th><th>Σ lot gaps</th><th>BASE / STRESS</th></tr></thead><tbody>{([['Текущий',data.advanced_analysis.strategic_triad.current],['Максимум пользы',data.advanced_analysis.strategic_triad.benefit_maximum],['После опциона',data.advanced_analysis.strategic_triad.after_option]] as [string,Brief][]).map(([name,b]) => <tr key={name}><th>{name}</th><td>{composition(b.selection)}</td><td>{format(b.metrics.c0_mrub)}</td><td>{format(b.metrics.vpub_mrub_per_year)}</td><td>{format(b.metrics.kcash,3)}</td><td>{format(b.portfolio_funding_gap)}</td><td>{format(b.sum_lot_funding_gaps)}</td><td>{b.scenarios.BASE.status} / {b.scenarios.STRESS.status}</td></tr>)}</tbody></table></div><p>Договорное действие: {data.advanced_analysis.strategic_triad.option_changes.map(x => `${x.lot_id} ${x.from}→${x.to}`).join(', ')}.</p>
      <h3>Распределение общей платформы · вектор Шепли</h3><p>Допущение команды φ={format(data.coalition.phi,2)}. Стоимость поодиночке {format(data.coalition.standalone_total_mrub)}; союз {format(data.coalition.grand_cost_mrub)}; экономия объединения {format(data.coalition.cooperation_savings_mrub)} млн руб. ({format(data.coalition.cooperation_savings_share * 100,1)} %). Проверка ядра: <b>{data.coalition.core.ok ? `PASS · ${data.coalition.core.checked} неравенств` : 'FAIL'}</b>.</p><div className="table-scroll"><table><thead><tr><th>Регион / лот</th><th>Поодиночке</th><th>По Шепли</th><th>Доля</th><th>Пропорционально</th><th>Поровну</th></tr></thead><tbody>{data.coalition.players.map(p => <tr key={p.lot_id}><th>{p.region}<small>{p.lot_id}</small></th><td>{format(p.standalone_mrub)}</td><td>{format(p.shapley_mrub)}</td><td>{format(p.share * 100,1)} %</td><td>{format(p.proportional_mrub)}</td><td>{format(p.equal_mrub)}</td></tr>)}</tbody></table></div><details className="disclosure"><summary>Чувствительность долей к φ</summary><div className="table-scroll"><table><thead><tr><th>φ</th>{data.coalition.players.map(p => <th key={p.lot_id}>{p.lot_id}</th>)}<th>Ядро</th></tr></thead><tbody>{data.coalition.sensitivity.map(r => <tr key={r.phi}><th>{format(r.phi,2)}</th>{data.coalition.players.map(p => <td key={p.lot_id}>{format(r.shares[p.lot_id] * 100,1)} %</td>)}<td>{r.core_ok ? 'PASS' : 'FAIL'}</td></tr>)}</tbody></table></div></details>
      <h3>Условия каждой услуги</h3><p>Раскройте карточку: плательщики, сроки, роли, доступ, проверка результата и перенос. Все суммы получены сервером из текущего сохранённого расчёта.</p>
      {data.services.map(s => <details className="disclosure service-card" key={s.lot_id}><summary>{s.lot_id} {s.mode_id} · {lotNames[s.lot_id]} · {s.territory} · C0 {format(s.finance.c0_mrub)} · адресный gap {format(s.finance.lot_funding_gap)}</summary>
        <p><b>Потребность:</b> {s.need}</p><p><b>Действие:</b> {s.action}</p><p><b>Ожидаемый эффект:</b> {s.expected_effect}</p>
        <h4>Участники и ответственность</h4><dl className="implementation-roles">{Object.entries(roles).map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{s.roles[key]}</dd></div>)}</dl>
        <h4>Предложенные обязательства</h4><div className="table-scroll" role="region" aria-label={`Платежи ${s.lot_id}`} tabIndex={0}><table><thead><tr><th>Поток</th><th>Сумма</th><th>Плательщик → получатель</th><th>Срок и назначение</th></tr></thead><tbody>
          {s.c0_funding.map((a,index) => <tr key={`c0-${index}`}><th scope="row">Полный запуск C0</th><td>{format(a.amount)}<small>{a.unit}</small></td><td>{a.payer} → {s.roles.operator}</td><td>{s.c0_timing}</td></tr>)}
          {s.flows.map(f => <tr key={f.kind}><th scope="row">{flowNames[f.kind]}</th><td>{format(f.amount)}<small>{f.unit}</small></td><td>{f.payer} → {f.payee}</td><td>{f.timing}<small>{f.purpose}</small></td></tr>)}
        </tbody></table></div><p><b>Условия согласия:</b> {s.agreement_condition}</p><p><b>Календарь ликвидности согласует:</b> {s.liquidity_owner}. {s.liquidity_gate}</p>
        <h4>Доступ и приёмка</h4><p>{s.access_rationale}</p><p><b>Предмет:</b> {s.contract_subject}</p><p><b>Общественный слой:</b> {s.public_layer}</p><p><b>Ограниченные данные:</b> {s.restricted_data}</p><p>{s.rights}</p><p><b>Приёмка:</b> {s.acceptance}</p><p><b>Оплата:</b> {s.payment_condition}</p><p><b>При недостаточном качестве:</b> {s.failure_response}</p>
        <h4>План измерения KPI</h4><p>Baseline и численные цели неизвестны; результат не заявлен достигнутым.</p>{s.kpis.map(k => <article className="implementation-kpi" key={k.id}><h5>{k.name} · {k.unit}</h5><p><b>Период / объекты:</b> {k.period}; {k.objects}</p><p><b>Числитель:</b> {k.numerator}<br/><b>Знаменатель:</b> {k.denominator}</p><p>{k.missing}</p><p><b>Источник:</b> {k.source}. <b>Владелец:</b> {k.owner}</p><p><b>Приёмка:</b> {k.acceptance}. Протокол/цели: этап {k.approve_phase} после проверки baseline.</p></article>)}
        <h4>Физические риски</h4><RiskList values={s.risks} />
        <h4>Смена поставщика и перенос</h4><p><b>Формат:</b> {s.export_format}</p><p><b>Контрольный набор:</b> {s.control_set}</p><p><b>Ответственность за переход:</b> {s.migration_owner}</p><p><b>Общее ядро:</b> {s.replication.core}</p><p><b>Местная адаптация:</b> {s.replication.adaptation}</p><p><b>Очередь:</b> {s.replication.first_pilot} → {s.replication.next_site}</p><p><b>Передаваемый опыт:</b> {s.replication.experience}</p><p><b>Условие:</b> {s.replication.gate}</p><p className="source">Источники: {s.source_refs.join(', ')} · Допущения: {s.assumption_refs.join(', ')}</p>
      </details>)}
      <h3>Альтернативы при той же политике финансирования</h3><p>{data.distinct_strategy_portfolios} разных состава. Совпавшие роли стратегий не считаются отдельными альтернативами.</p><div className="table-scroll" role="region" aria-label="Финансирование альтернатив" tabIndex={0}><table><thead><tr><th>Стратегия / состав</th><th>C0</th><th>OPEX</th><th>Anchor</th><th>Commercial</th><th>CASH</th><th>Баланс</th><th>Портфельный gap</th><th>Сумма lot gaps</th><th>BASE / STRESS</th></tr></thead><tbody>{data.alternatives.map(a => <tr key={a.strategy_id}><th scope="row">{a.title}<small>{composition(a.selection)}</small>{a.same_portfolio_as && <small>Совпадает: {a.same_portfolio_as}</small>}</th>{(['c0_mrub','opex_mrub_per_year','anchor_cash_mrub_per_year','commercial_cash_mrub_per_year','cash_mrub_per_year','net_operating_balance','portfolio_funding_gap','sum_lot_funding_gaps'] as const).map(k => <td key={k}>{format(a.finance.totals[k])}</td>)}<td>{a.scenarios.BASE.status} / {a.scenarios.STRESS.status}</td></tr>)}</tbody></table></div>
      {data.alternatives.map(a => <p key={a.strategy_id}><b>{a.title}:</b> {a.rationale} Общественное ядро: {a.public_core_ids.join(', ')}.</p>)}
      <h3>Чувствительность сохранённого выбора</h3><div className="table-scroll"><table><thead><tr><th>Изменение веса</th><th>Новый лидер</th><th>Место исходного</th></tr></thead><tbody>{data.sensitivity.runs.map(r => <tr key={`${r.criterion}-${r.multiplier}`}><th scope="row">{r.criterion} × {format(r.multiplier)}</th><td>{composition(r.leader.selection)}</td><td>{format(r.original_choice_rank)}</td></tr>)}</tbody></table></div><p>Все опыты реально пересчитаны Python; изменения лидера показывают условность предпочтений.</p>
      <h3>STRESS · {data.stress.action}: сохранить с условиями</h3><p>C0 прежнего состава: <b>{format(data.finance.totals.c0_mrub)} млн руб.</b> Лимит: {format(data.stress.base.c0_limit)} → {format(data.stress.stress.c0_limit)}; запас: {format(data.stress.base.c0_margin)} → {format(data.stress.stress.c0_margin)} млн руб. Статус BASE / STRESS: {data.stress.base.status} / {data.stress.stress.status}.</p><p>Состав, режимы, денежные потоки, VPUB, общественный слой и адресные gaps неизменны. Снижение лимита не снижает стоимость лотов.</p><p><b>Решение принимает:</b> {data.stress.owner}</p><ul>{data.stress.conditions.map(x => <li key={x}>{x}</li>)}</ul><p>{data.stress.timing}</p>
      <h3>Общие риски и зависимости</h3><RiskList values={c.portfolio_risks}/>{c.shared_dependencies.map(d => <p key={d.id}><b>{d.services.join(', ')} · {d.dependency}:</b> {d.owner}. Фактический поставщик неизвестен. {d.gate}. {d.residual}</p>)}
      <details className="disclosure"><summary>Конкуренция и последовательность смены поставщика</summary><p>{c.supplier_switch.competition}</p><h4>Триггеры</h4><ul>{c.supplier_switch.triggers.map(x => <li key={x}>{x}</li>)}</ul><ol>{c.supplier_switch.sequence.map(x => <li key={x}>{x}</li>)}</ol><h4>Что передаётся</h4><ul>{c.supplier_switch.payload.map(x => <li key={x}>{x}</li>)}</ul><p>{c.supplier_switch.interface}</p><p>{c.supplier_switch.costs_and_time}</p><p>{c.supplier_switch.continuity}</p><p>{c.supplier_switch.residual}</p></details>
      <h3>Дорожная карта · предложенный горизонт</h3><p>{c.pilot_order}</p><div className="table-scroll" role="region" aria-label="Дорожная карта реализации" tabIndex={0}><table><thead><tr><th>Этап / месяц</th><th>Результат / владелец</th><th>Ресурс / подтверждение</th><th>Зависимость / приёмка / перенос</th></tr></thead><tbody>{c.roadmap.map(r => <tr key={r.id}><th scope="row">{r.id}<small>{r.start_month}–{r.end_month}</small></th><td>{r.result}<small>{r.owner}</small></td><td>{r.resources}<small>Подтверждает: {r.resource_confirmer}. {r.availability}</small></td><td>{r.dependency}<p><b>Приёмка:</b> {r.acceptance}</p><p><b>Перенос:</b> {r.defer_if}</p></td></tr>)}</tbody></table></div><ul>{c.kpi_protocol.map(x => <li key={x}>{x}</li>)}</ul>
      <details className="disclosure"><summary>A/B/C, источники и границы применимости</summary>{Object.entries(c.access_proposals).map(([mode,a]) => <p key={mode}><b>{mode} · {a.label}:</b> {a.terms} public core: {format(a.public_core)}.</p>)}{Object.entries(c.sources).map(([id,s]) => <p key={id}><b>{id} · {s.uri.startsWith('https://') ? <a href={s.uri} target="_blank" rel="noreferrer">{s.title}</a> : s.title}:</b> {s.claim}. {s.limitation}. <small>{s.checked}</small></p>)}</details>
      <h3>Материалы сохранённого выпуска</h3><p>PDF, JSON и CSV ниже относятся к показанному выпуску. Ручной портфель и новые веса не меняют их выводы. Для новых сохранённых условий нужно пересобрать комплект и обновить этот раздел.</p>
      {data.submission.available ? <><p className="source">M5 <code>{data.submission.submission_id}</code><br/>Состав файлов <code>{data.submission.publication_id}</code></p><div className="actions">{Object.entries(data.submission.files || {}).map(([name,file]) => <button key={name} onClick={() => saveArtifact(file,name)}>{file.label}</button>)}</div></> : <p role="status">{data.submission.reason}</p>}
      <details className="disclosure"><summary>Полные управленческие протоколы и расчёт</summary><p>Редактируемые протоколы M4 сохраняют полные условия принятого решения. Выпуск PDF M5 имеет собственную вёрстку и идентификатор выше.</p><div className="actions">{Object.entries(data.materials).map(([name,text]) => <button key={name} onClick={() => save(text,name,'text/markdown')}>{materialNames[name] || name}</button>)}<button onClick={() => save(JSON.stringify({ ...data, submission: undefined },null,2)+'\n','kosmos-management.json','application/json')}>Управленческий расчёт JSON</button><button onClick={() => save(data.finance_csv,'kosmos-finance.csv','text/csv')}>Полные финансовые таблицы CSV</button></div></details>
      <details className="disclosure"><summary>Происхождение и версия управленческого решения</summary><p>Источники, сохранённый M3 input и версии/хеши management/assumptions входят в идентификатор. Изменённые условия требуют пересборки материалов.</p><pre>{JSON.stringify(data.identity,null,2)}</pre></details>
    </>}
  </section>
}
