/** Implementation of the saved decision: the money, the responsibility, the services and
 *  the artefacts of one release. Everything on this screen belongs to the accepted saved
 *  configuration, which is a different object from the live search. */
import { useEffect, useState } from 'react'
import { api } from './api'
import { format, lotNames, money } from './presentation'
import { Block, Callout, Disclosure, Fact, Facts, Kpi, KpiRow, Status, Tabs, Tip, ViewHead } from './ui'
import { Finance, FinanceUnavailable } from './Finance'
import { Brief } from './Brief'
import type { Intelligence, Passport } from './intelligence'
import type { Catalog, RequestInput, Selection } from './types'
import type { ViewId } from './routes'

type Risk = { id: string; risk: string; owner: string; trigger: string; consequence: string; action: string; residual: string }
type KPI = { id: string; name: string; unit: string; period: string; objects: string; numerator: string; denominator: string; missing: string; source: string; owner: string; acceptance: string; approve_phase: string }
type FinanceRow = { lot_id: string; mode_id: string; c0_mrub: number; opex_mrub_per_year: number; anchor_cash_mrub_per_year: number; commercial_cash_mrub_per_year: number; cash_mrub_per_year: number; net_operating_balance: number; lot_funding_gap: number }
type Money = { c0_mrub: number; opex_mrub_per_year: number; anchor_cash_mrub_per_year: number; commercial_cash_mrub_per_year: number; cash_mrub_per_year: number; net_operating_balance: number; portfolio_funding_gap: number; sum_lot_funding_gaps: number; vpub_mrub_per_year: number; kcash: number }
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
type ScenarioState = { c0_limit: number; c0_margin: number; status: string }
type Implementation = {
  submission: { available: boolean; reason?: string; submission_id?: string; publication_id?: string; files?: Record<string, { label: string; mime: string; sha256: string; base64: string }> }
  release_id: string; selection: Selection[]; request: RequestInput; identity: unknown
  finance: { rows: FinanceRow[]; totals: Money }; services: Service[]; distinct_strategy_portfolios: number
  stress: { action: string; base: ScenarioState; stress: ScenarioState; owner: string; conditions: string[]; timing: string }
  alternatives: { strategy_id: string; title: string; selection: Selection[]; finance: { totals: Money }; same_portfolio_as: string | null; rationale: string; public_core_ids: string[]; scenarios: { BASE: ScenarioState; STRESS: ScenarioState } }[]
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

const composition = (rows: Selection[]) => rows.map(row => `${row.lot_id} ${row.mode_id}`).join(' · ')
const signature = (rows: Selection[]) => rows.map(row => `${row.lot_id}:${row.mode_id}`).sort().join('|')
const roleNames: Record<string, string> = {
  buyer: 'Закупщик', c0_payer: 'Ведущий плательщик C0', anchor_payer: 'Плательщик якорного потока',
  commercial_payer: 'Плательщики коммерческого потока', gap_payer: 'Плательщик адресного дефицита',
  operator: 'Оператор и плательщик OPEX', supplier: 'Поставщик', acceptor: 'Независимый приёмщик',
  user: 'Пользователь', decision_owner: 'Владелец решения', public_beneficiary: 'Общественный получатель',
}
const flowNames: Record<string, string> = {
  anchor: 'Якорный поток', commercial: 'Коммерческий поток', opex: 'Расходы OPEX', additional_support: 'Адресное покрытие дефицита',
}
const materialNames: Record<string, string> = {
  'management-note-draft.md': 'Управленческая записка', 'stress-summary-draft.md': 'Стресс-резюме', 'presentation-draft.md': 'Сценарий презентации',
}

/** One fetch per session: moving between screens must not refetch the release. */
let cache: Implementation | undefined

function save(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function saveArtifact(file: { mime: string; base64: string }, filename: string) {
  const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Delivery({ tab, catalog, currentRequest, evidence, passport, pendingContext, onLoad, go }: {
  tab: string; catalog: Catalog; currentRequest: RequestInput
  evidence?: Intelligence; passport: { data?: Passport; error: string; retry: () => void }
  pendingContext?: string
  onLoad: (name: string, request: RequestInput) => void
  go: (view: ViewId, tab?: string) => void
}) {
  const [data, setData] = useState<Implementation | undefined>(cache)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (cache && !retry) return
    let live = true
    const controller = new AbortController()
    setError('')
    api<Implementation>('/api/implementation', undefined, controller.signal)
      .then(value => { cache = value; if (live) setData(value) })
      .catch(failure => { if (live && (failure as Error).name !== 'AbortError') setError((failure as Error).message) })
    return () => { live = false; controller.abort() }
  }, [retry])

  const configuration = data?.configuration
  const totals = data?.finance.totals

  return <>
    <ViewHead title="Реализация решения"
      state={data ? `${composition(data.selection)} · сохранённый выпуск` : 'загружаем сохранённый выпуск'}
      actions={data ? <>
        <button type="button" className="primary" onClick={() => onLoad('Сохранённое решение', structuredClone(data.request))}>Загрузить состав в конструктор</button>
        <button type="button" className="quiet" onClick={() => { cache = undefined; setData(undefined); setRetry(value => value + 1) }}>Пересчитать</button>
      </> : undefined}>
      <Tabs label="Раздел реализации" value={tab} items={[
        { id: 'rationale', title: 'Обоснование' }, { id: 'finance', title: 'Финансирование' },
        { id: 'services', title: 'Сервисы' }, { id: 'materials', title: 'Материалы' },
      ]} onChange={next => go('delivery', next)} />
    </ViewHead>

    {error ? <div className="error" role="alert">
      <b>Реализация не подтверждена</b><p>{error}</p>
      <button type="button" onClick={() => { cache = undefined; setData(undefined); setRetry(value => value + 1) }}>Повторить</button>
    </div> : !data || !configuration || !totals ? <Callout tone="note" role="status">Заново рассчитываем сохранённый M3 и проверяем условия реализации…</Callout> : <>
      <KpiRow className="delivery-hero">
        <Kpi label="Старт" code="C0" value={format(totals.c0_mrub, 1)} unit="млн ₽" />
        <Kpi label="Год эксплуатации" code="OPEX" value={format(totals.opex_mrub_per_year, 1)} unit="млн ₽/год" />
        <Kpi label="Денежный поток" code="CASH" value={format(totals.cash_mrub_per_year, 1)} unit="млн ₽/год" />
        <Kpi label="Адресные дефициты" tone={totals.sum_lot_funding_gaps > 0 ? 'stress' : 'plain'}
          value={format(totals.sum_lot_funding_gaps, 1)} unit="млн ₽/год"
          hint="Сумма положительных дефицитов сервисов. Нулевой портфельный дефицит не подтверждает их покрытие." />
      </KpiRow>

      {signature(currentRequest.selection) !== signature(data.selection) &&
        <Callout tone="note">Конструктор сейчас содержит другой состав. Условия ниже относятся только к сохранённому решению.</Callout>}

      {tab === 'finance' ? <FinanceTab data={data} totals={totals} configuration={configuration} evidence={evidence} passport={passport} />
        : tab === 'services' ? <ServicesTab data={data} configuration={configuration} />
          : tab === 'materials' ? <MaterialsTab data={data} configuration={configuration} catalog={catalog} evidence={evidence} pendingContext={pendingContext} />
            : <RationaleTab data={data} configuration={configuration} go={go} />}
    </>}
  </>
}

function RationaleTab({ data, configuration, go }: {
  data: Implementation; configuration: Implementation['configuration']; go: (view: ViewId, tab?: string) => void
}) {
  return <>
    <Block title="Почему выбран этот состав" note="предложение команды на сохранённом расчёте">
      <div className="reason-grid">{configuration.choice_rationale.map((text, index) => <article key={text} className="reason">
        <span className="reason-index" aria-hidden="true">{index + 1}</span>
        <p>{text}</p>
      </article>)}</div>
    </Block>

    <Block title="Что подтверждено и что нет">
      <Facts>
        <Fact label={<span className="tone-pass">Рассчитано</span>} code="CALCULATED"
          value={`${composition(data.selection)}; допустимость и рейтинг действуют при указанных данных, ограничениях и весах`} />
        <Fact label={<span className="tone-stress">Подтвердить до запуска</span>} code="CONDITIONS"
          value="финансирование C0, адресное покрытие дефицитов, договоры, права на данные, качество на территории, SLA и ответственность" />
        <Fact label={<span className="tone-fail">Не известно</span>} code="UNKNOWN"
          value="фактический спрос, обязательства покупателей, ликвидность, KPI baseline и достигнутые KPI не представлены" />
      </Facts>
      <p className="meta">Следующий шаг: измерить baseline в пилоте и согласовать критерии приёмки.</p>
    </Block>

    <Block title={`STRESS сохранённого решения · ${data.stress.action}`}
      actions={<button type="button" className="quiet" onClick={() => go('stress', 'recommendation')}>Стресс текущего поиска</button>}>
      <Facts className="facts-row">
        <Fact label="Стоимость состава" code="C0" value={money(data.finance.totals.c0_mrub)} />
        <Fact label="Лимит" value={`${format(data.stress.base.c0_limit)} → ${format(data.stress.stress.c0_limit)} млн ₽`} />
        <Fact label="Запас" value={`${format(data.stress.base.c0_margin)} → ${format(data.stress.stress.c0_margin)} млн ₽`} />
        <Fact label="BASE / STRESS" value={<><Status value={data.stress.base.status} /> <Status value={data.stress.stress.status} /></>} />
      </Facts>
      <p className="meta">Состав, режимы, потоки и адресные дефициты неизменны: снижение лимита не снижает стоимость лотов.</p>
      <Disclosure summary="Условия сохранения состава" note={`${data.stress.conditions.length} условий`}>
        <Facts><Fact label="Решение принимает" value={data.stress.owner} /></Facts>
        <ul>{data.stress.conditions.map(text => <li key={text}>{text}</li>)}</ul>
        <p className="meta">{data.stress.timing}</p>
      </Disclosure>
    </Block>

    <Disclosure summary="Чувствительность сохранённого выбора" note="реальные пересчёты Python">
      <div className="table-scroll"><table><thead><tr><th>Изменение веса</th><th>Новый лидер</th><th>Место исходного</th></tr></thead>
        <tbody>{data.sensitivity.runs.map(run => <tr key={`${run.criterion}-${run.multiplier}`}>
          <th scope="row">{run.criterion} × {format(run.multiplier)}</th>
          <td>{composition(run.leader.selection)}</td><td>{format(run.original_choice_rank)}</td></tr>)}</tbody></table></div>
      <p className="meta">Смена лидера показывает условность предпочтений.</p>
    </Disclosure>
  </>
}

function FinanceTab({ data, totals, configuration, evidence, passport }: {
  data: Implementation; totals: Money; configuration: Implementation['configuration']
  evidence?: Intelligence; passport: { data?: Passport; error: string; retry: () => void }
}) {
  const cells = (row: Omit<FinanceRow, 'lot_id' | 'mode_id'>) => <>
    <td>{format(row.c0_mrub)}</td><td>{format(row.opex_mrub_per_year)}</td><td>{format(row.anchor_cash_mrub_per_year)}</td>
    <td>{format(row.commercial_cash_mrub_per_year)}</td><td>{format(row.cash_mrub_per_year)}</td>
    <td>{format(row.net_operating_balance)}</td><td>{format(row.lot_funding_gap)}</td></>
  return <>
    <Block title="Запуск и год эксплуатации" note="C0 — млн ₽ при запуске; остальные столбцы — млн ₽/год">
      <div className="table-scroll" role="region" aria-label="Финансирование сохранённого портфеля" tabIndex={0}>
        <table><thead><tr><th>Сервис</th><th>Старт<small>C0</small></th><th>Эксплуатация<small>OPEX</small></th><th>Якорный</th><th>Коммерческий</th><th>Поток<small>CASH</small></th><th>Баланс</th><th>Адресный дефицит</th></tr></thead>
          <tbody>{data.finance.rows.map(row => <tr key={row.lot_id}><th scope="row">{row.lot_id} {row.mode_id}</th>{cells(row)}</tr>)}
            <tr className="implementation-total"><th scope="row">Итого</th>{cells({ ...totals, lot_funding_gap: totals.sum_lot_funding_gaps })}</tr></tbody></table>
      </div>
      <Facts className="facts-row">
        <Fact label="Портфельный дефицит" value={money(totals.portfolio_funding_gap, 'млн ₽/год')} />
        <Fact label="Общественная ценность" code="VPUB" tone="accent" value={money(totals.vpub_mrub_per_year, 'синт. млн ₽/год')} />
        <Fact label="Денежное покрытие" code="KCASH" value={format(totals.kcash, 3)}
          hint="Отношение сумм CASH/OPEX, не прибыльность." />
      </Facts>
      <Disclosure summary="Правила финансирования" note={`${configuration.financing_notes.length} условий`}>
        <ul>{configuration.financing_notes.map(text => <li key={text}>{text}</li>)}</ul>
      </Disclosure>
    </Block>

    <Block title="Кто платит и за что" note="цепочка ответственности по текущей рекомендации поиска">
      {passport.data ? <Finance value={passport.data} />
        : <FinanceUnavailable message={passport.error || (evidence?.status === 'NO_SOLUTION' ? 'Нет допустимой рекомендации для финансирования: измените условия в корректировке бюджета.' : '')}
          onRetry={passport.retry} />}
    </Block>

    <Block title="Альтернативы при той же политике финансирования" note={`${data.distinct_strategy_portfolios} разных состава`}>
      <div className="table-scroll" role="region" aria-label="Финансирование альтернатив" tabIndex={0}>
        <table><thead><tr><th>Стратегия / состав</th><th>C0</th><th>OPEX</th><th>CASH</th><th>Баланс</th><th>Адресные дефициты</th><th>BASE / STRESS</th></tr></thead>
          <tbody>{data.alternatives.map(item => <tr key={item.strategy_id}>
            <th scope="row">{item.title}<small>{composition(item.selection)}</small>{item.same_portfolio_as && <small>совпадает: {item.same_portfolio_as}</small>}</th>
            <td>{format(item.finance.totals.c0_mrub)}</td><td>{format(item.finance.totals.opex_mrub_per_year)}</td>
            <td>{format(item.finance.totals.cash_mrub_per_year)}</td><td>{format(item.finance.totals.net_operating_balance)}</td>
            <td>{format(item.finance.totals.sum_lot_funding_gaps)}</td>
            <td>{item.scenarios.BASE.status} / {item.scenarios.STRESS.status}</td></tr>)}</tbody></table>
      </div>
      <Disclosure summary="Обоснование каждой стратегии">
        <Facts>{data.alternatives.map(item => <Fact key={item.strategy_id} label={item.title}
          value={`${item.rationale} Общественное ядро: ${item.public_core_ids.join(', ') || '—'}.`} />)}</Facts>
      </Disclosure>
    </Block>
  </>
}

function ServicesTab({ data, configuration }: { data: Implementation; configuration: Implementation['configuration'] }) {
  return <>
    <Block title="Условия каждого сервиса" note="плательщики, сроки, роли, доступ, приёмка и перенос">
      {data.services.map(service => <details className="disclosure service-card" key={service.lot_id}>
        <summary>{service.lot_id} {service.mode_id} · {lotNames[service.lot_id]}
          <small>{service.territory} · C0 {format(service.finance.c0_mrub)} · адресный дефицит {format(service.finance.lot_funding_gap)}</small></summary>
        <Facts>
          <Fact label="Потребность" value={service.need} />
          <Fact label="Действие" value={service.action} />
          <Fact label="Ожидаемый эффект" value={service.expected_effect} />
          <Fact label="Предмет договора" value={service.contract_subject} />
          <Fact label="Общественный слой" value={service.public_layer} />
          <Fact label="Ограниченные данные" value={service.restricted_data} />
          <Fact label="Приёмка" value={service.acceptance} />
          <Fact label="Оплата" value={service.payment_condition} />
          <Fact label="При недостаточном качестве" value={service.failure_response} />
        </Facts>

        <h4 className="block-title">Предложенные обязательства</h4>
        <div className="table-scroll" role="region" aria-label={`Платежи ${service.lot_id}`} tabIndex={0}>
          <table><thead><tr><th>Поток</th><th>Сумма</th><th>Плательщик → получатель</th><th>Срок и назначение</th></tr></thead><tbody>
            {service.c0_funding.map((row, index) => <tr key={`c0-${index}`}><th scope="row">Полный запуск C0</th>
              <td>{format(row.amount)}<small>{row.unit}</small></td><td>{row.payer} → {service.roles.operator}</td><td>{service.c0_timing}</td></tr>)}
            {service.flows.map(flow => <tr key={flow.kind}><th scope="row">{flowNames[flow.kind] || flow.kind}</th>
              <td>{format(flow.amount)}<small>{flow.unit}</small></td><td>{flow.payer} → {flow.payee}</td><td>{flow.timing}<small>{flow.purpose}</small></td></tr>)}
          </tbody></table>
        </div>
        <p className="meta">Условия согласия: {service.agreement_condition} Календарь ликвидности согласует {service.liquidity_owner}. {service.liquidity_gate}</p>

        <Disclosure summary="Участники и ответственность">
          <Facts>{Object.entries(roleNames).map(([key, label]) => <Fact key={key} label={label} value={service.roles[key]} />)}</Facts>
          <p className="meta">{service.access_rationale} {service.rights}</p>
        </Disclosure>

        <Disclosure summary="План измерения KPI" note="baseline и численные цели неизвестны">
          {service.kpis.map(kpi => <div key={kpi.id} className="implementation-kpi">
            <p className="object-title">{kpi.name}<small>{kpi.unit}</small></p>
            <Facts className="facts-tight">
              <Fact label="Период и объекты" value={`${kpi.period}; ${kpi.objects}`} />
              <Fact label="Числитель" value={kpi.numerator} />
              <Fact label="Знаменатель" value={kpi.denominator} />
              <Fact label="Источник и владелец" value={`${kpi.source}. ${kpi.owner}`} />
              <Fact label="Приёмка" value={`${kpi.acceptance} Протокол и цели: этап ${kpi.approve_phase} после проверки baseline.`} />
            </Facts>
            <p className="meta">{kpi.missing}</p>
          </div>)}
        </Disclosure>

        <Disclosure summary="Физические риски" note={`${service.risks.length}`}>
          <RiskList values={service.risks} />
        </Disclosure>

        <Disclosure summary="Смена поставщика и перенос">
          <Facts>
            <Fact label="Формат" value={service.export_format} />
            <Fact label="Контрольный набор" value={service.control_set} />
            <Fact label="Ответственность за переход" value={service.migration_owner} />
            <Fact label="Общее ядро" value={service.replication.core} />
            <Fact label="Местная адаптация" value={service.replication.adaptation} />
            <Fact label="Очередь" value={`${service.replication.first_pilot} → ${service.replication.next_site}`} />
            <Fact label="Передаваемый опыт" value={service.replication.experience} />
            <Fact label="Условие" value={service.replication.gate} />
          </Facts>
          <p className="meta">Источники: {service.source_refs.join(', ')} · допущения: {service.assumption_refs.join(', ')}</p>
        </Disclosure>
      </details>)}
    </Block>

    <Block title="Общие риски и зависимости">
      <RiskList values={configuration.portfolio_risks} />
      <Disclosure summary="Общие зависимости" note={`${configuration.shared_dependencies.length}`}>
        <Facts>{configuration.shared_dependencies.map(item => <Fact key={item.id}
          label={`${item.services.join(', ')} · ${item.dependency}`}
          value={`${item.owner}. Фактический поставщик неизвестен. ${item.gate} ${item.residual}`} />)}</Facts>
      </Disclosure>
      <Disclosure summary="Конкуренция и последовательность смены поставщика">
        <p>{configuration.supplier_switch.competition}</p>
        <h4 className="block-title">Триггеры</h4>
        <ul>{configuration.supplier_switch.triggers.map(text => <li key={text}>{text}</li>)}</ul>
        <h4 className="block-title">Последовательность</h4>
        <ol>{configuration.supplier_switch.sequence.map(text => <li key={text}>{text}</li>)}</ol>
        <h4 className="block-title">Что передаётся</h4>
        <ul>{configuration.supplier_switch.payload.map(text => <li key={text}>{text}</li>)}</ul>
        <p className="meta">{configuration.supplier_switch.interface} {configuration.supplier_switch.costs_and_time} {configuration.supplier_switch.continuity} {configuration.supplier_switch.residual}</p>
      </Disclosure>
    </Block>

    <Block title="Дорожная карта" note={configuration.pilot_order}>
      <div className="table-scroll" role="region" aria-label="Дорожная карта реализации" tabIndex={0}>
        <table><thead><tr><th>Этап / месяц</th><th>Результат / владелец</th><th>Ресурс / подтверждение</th><th>Зависимость, приёмка, перенос</th></tr></thead>
          <tbody>{configuration.roadmap.map(row => <tr key={row.id}>
            <th scope="row">{row.id}<small>{row.start_month}–{row.end_month}</small></th>
            <td>{row.result}<small>{row.owner}</small></td>
            <td>{row.resources}<small>подтверждает {row.resource_confirmer}. {row.availability}</small></td>
            <td>{row.dependency}<small>приёмка: {row.acceptance}</small><small>перенос: {row.defer_if}</small></td></tr>)}</tbody></table>
      </div>
      <Disclosure summary="Протокол KPI" note={`${configuration.kpi_protocol.length} пунктов`}>
        <ul>{configuration.kpi_protocol.map(text => <li key={text}>{text}</li>)}</ul>
      </Disclosure>
    </Block>
  </>
}

function MaterialsTab({ data, configuration, catalog, evidence, pendingContext }: {
  data: Implementation; configuration: Implementation['configuration']; catalog: Catalog
  evidence?: Intelligence; pendingContext?: string
}) {
  return <>
    <Brief value={evidence} catalog={catalog} pendingContext={pendingContext} />

    <Block title="Материалы сохранённого выпуска" note="PDF, JSON и CSV относятся к показанному выпуску">
      {data.submission.available
        ? <div className="actions">{Object.entries(data.submission.files || {}).map(([name, file]) =>
          <button key={name} type="button" onClick={() => saveArtifact(file, name)}>{file.label}</button>)}</div>
        : <Callout tone="note" role="status">{data.submission.reason}</Callout>}
      <div className="actions">
        {Object.entries(data.materials).map(([name, text]) =>
          <button key={name} type="button" className="quiet" onClick={() => save(text, name, 'text/markdown')}>{materialNames[name] || name}</button>)}
        <button type="button" className="quiet" onClick={() => save(JSON.stringify({ ...data, submission: undefined }, null, 2) + '\n', 'kosmos-management.json', 'application/json')}>Управленческий расчёт · JSON</button>
        <button type="button" className="quiet" onClick={() => save(data.finance_csv, 'kosmos-finance.csv', 'text/csv')}>Финансовые таблицы · CSV</button>
      </div>
      <p className="meta">Ручной портфель и новые веса не меняют выводы этих файлов. Для новых сохранённых условий комплект нужно пересобрать.
        <Tip label="Что такое выпуск">Выпуск — зафиксированная конфигурация со своими источниками, версиями и хешами. Его материалы не пересчитываются вместе с живым поиском.</Tip>
      </p>
    </Block>

    <Block title="Режимы доступа и источники">
      <Facts>{Object.entries(configuration.access_proposals).map(([mode, proposal]) => <Fact key={mode}
        label={`${mode} · ${proposal.label}`} value={`${proposal.terms} Общественное ядро: ${proposal.public_core ? 'да' : 'нет'}.`} />)}</Facts>
      <Disclosure summary="Источники и границы применимости" note={`${Object.keys(configuration.sources).length}`}>
        <Facts>{Object.entries(configuration.sources).map(([id, source]) => <Fact key={id}
          label={`${id} · ${source.title}`}
          value={<>{source.uri.startsWith('https://') ? <a href={source.uri} target="_blank" rel="noreferrer">{source.uri}</a> : source.uri}
            {' — '}{source.claim} {source.limitation} <span className="meta">{source.checked}</span></>} />)}</Facts>
      </Disclosure>
      <Disclosure summary="Происхождение и версия выпуска">
        <Facts className="facts-tight">
          <Fact label="Выпуск" value={<code>{data.release_id}</code>} />
          {data.submission.available && <Fact label="Комплект" value={<code>{data.submission.submission_id}</code>} />}
          {data.submission.available && <Fact label="Состав файлов" value={<code>{data.submission.publication_id}</code>} />}
        </Facts>
        <pre>{JSON.stringify(data.identity, null, 2)}</pre>
      </Disclosure>
    </Block>
  </>
}

function RiskList({ values }: { values: Risk[] }) {
  return <div className="implementation-risk-list">{values.map(risk => <article key={risk.id}>
    <p className="object-title">{risk.risk}</p>
    <Facts className="facts-tight">
      <Fact label="Владелец" value={risk.owner} />
      <Fact label="Триггер" value={risk.trigger} />
      <Fact label="Последствие" value={risk.consequence} />
      <Fact label="Действие" value={risk.action} />
      <Fact label="Остаточное ограничение" value={risk.residual} />
    </Facts>
  </article>)}</div>
}
