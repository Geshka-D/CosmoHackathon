/** Search and the case for the chosen portfolio. Every number is produced by
 *  /api/decision/recompute; this file only arranges and labels it.
 *
 *  Three columns that stay put — priorities · the variant space · the decision itself —
 *  and three tabs for the depth: the shortlist, why this one, and the full calculation. */
import { composition, changes } from './decision'
import type { Alternative, Candidate } from './decision'
import { criterionNames, format, lotNames, metricCode, metricHints, metricHuman, metricNames, metricShort, money, signed, unitOf } from './presentation'
import { TradeoffPlot } from './TradeoffPlot'
import { ServiceMap } from './ServiceMap'
import { PreferencePanel } from './PreferencePanel'
import { Block, Callout, Disclosure, Fact, Facts, Status, Tabs, Tip, ViewHead } from './ui'
import { buildColumns, MAX_COLUMNS } from './comparison'
import type { CompareState } from './comparison'
import type { Intelligence, MainDifference } from './intelligence'
import type { DecisionState } from './useDecision'
import type { Catalog, RequestInput } from './types'
import type { ViewId } from './routes'

const KEY_FIELDS = ['c0_mrub', 'vpub_mrub_per_year', 'opex_mrub_per_year']

export function Search({ catalog, currentRequest, appliedId, decision, compare, evidence, tab, onLoad, go }: {
  catalog: Catalog; currentRequest: RequestInput; appliedId: string | null; decision: DecisionState
  compare: CompareState; evidence: { data?: Intelligence; error: string; retry: () => void }; tab: string
  onLoad: (name: string, request: RequestInput) => void
  go: (view: ViewId, tab?: string) => void
}) {
  const { method, result, error, storage, busy, valid, scenario } = decision
  const exploratory = !!method && !!decision.weights
    && !Object.keys(method.weights).every(key => Math.abs((decision.weights![key] ?? NaN) - method.weights[key]) < 1e-12)
  const request = (row: Candidate): RequestInput => ({
    schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: row.selection,
  })
  const leader = result?.search.ranking[0]
  const columns = result ? buildColumns(result, compare) : []

  if (decision.pendingRestore) return <>
    <ViewHead title="Поиск и выбор" />
    <Callout tone={error ? 'error' : 'note'} role={error ? 'alert' : 'status'}>
      {error || 'Загружаем объявленный метод и пересчитываем сохранённый поиск…'}
    </Callout>
    {error && <p><button type="button" onClick={decision.reboot}>Повторить загрузку</button></p>}
  </>

  const state = result
    ? `${format(result.search.population.scenarios[scenario].feasible)} допустимых в ${scenario} · шортлист ${result.search.ranking.length} · ранжирование по восьми критериям`
    : 'Расчёт выполняется'

  return <>
    <ViewHead title="Поиск и выбор"
      state={<>{state} <Tip label="Объявленный метод выбора">{method!.strategy_thesis}</Tip></>}>
      <Tabs label="Глубина поиска" value={tab} items={[
        { id: 'shortlist', title: 'Шортлист' }, { id: 'why', title: 'Почему выбран' }, { id: 'method', title: 'Расчёт' },
      ]} onChange={next => go('search', next)} />
    </ViewHead>

    {storage && <Callout tone="quiet" role="status">{storage}
      {decision.backup !== null && <> <button type="button" className="link" onClick={decision.downloadBackup}>Скачать прежний поиск</button></>}
    </Callout>}
    {error && <div className="error" role="alert"><p>{error}</p><button type="button" onClick={decision.invalidate}>Повторить поиск</button></div>}

    {tab === 'method'
      ? <Method decision={decision} catalog={catalog} compare={compare} onLoad={onLoad} />
      : <div className="workspace">
        <div className="workspace-side">
          <PreferencePanel decision={decision} currentRequest={currentRequest} exploratory={exploratory} />
        </div>

        <div className="workspace-main">
          {!result || !leader ? <Callout tone="note" role="status">
            {busy ? 'Проверяем ввод…' : !valid ? 'Рейтинг скрыт: исправьте веса.' : error ? 'Результат скрыт до успешного пересчёта.' : 'Перебираем варианты и пересчитываем рейтинги…'}
          </Callout> : tab === 'why'
            ? <Why evidence={evidence} result={result} catalog={catalog} go={go} />
            : <Shortlist decision={decision} catalog={catalog} compare={compare} columns={columns}
              appliedId={appliedId} onLoad={onLoad} />}
        </div>

        <div className="workspace-detail">
          {result && leader && <Readout result={result} leader={leader} compare={compare} appliedId={appliedId}
            pool={[...result.search.ranking, ...columns.map(column => column.candidate)]}
            compared={columns.map(column => column.candidate.portfolio_id)} full={columns.length >= MAX_COLUMNS}
            onOpen={row => onLoad(`MCDA ${scenario} · ${row.rank}`, request(row))} go={go} />}
        </div>
      </div>}

    {tab === 'why' && result && leader && <Block title="Состав как связанные сервисы" note="сервисы → кто платит → территории">
      <ServiceMap candidate={leader} services={result.recommendation.service_context} catalog={catalog} />
    </Block>}
  </>
}

/** Centre column, default tab: the variant space and the ranked list. */
function Shortlist({ decision, catalog, compare, columns, appliedId, onLoad }: {
  decision: DecisionState; catalog: Catalog; compare: CompareState; columns: ReturnType<typeof buildColumns>
  appliedId: string | null; onLoad: (name: string, request: RequestInput) => void
}) {
  const result = decision.result!
  const leader = result.search.ranking[0]
  const scenario = decision.scenario
  const fields = decision.method ? Object.values(decision.method.field_mapping) : []
  const request = (row: Candidate): RequestInput => ({
    schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: row.selection,
  })
  return <>
    <Block title="Пространство вариантов" note={<>C0 × VPUB · {format(result.search.population.total)} составов</>}>
      <TradeoffPlot shortlist={result.search.ranking}
        extras={columns.map(column => column.candidate).filter(candidate => !result.search.ranking.some(row => row.portfolio_id === candidate.portfolio_id))}
        bounds={result.search.reference_population.bounds}
        referenceSize={result.search.reference_population.size} leaderId={leader.portfolio_id} viewedId={compare.viewed}
        comparedIds={columns.map(column => column.candidate.portfolio_id)} appliedId={appliedId}
        scenario={scenario} caps={{ BASE: catalog.scenarios.BASE.c0_max_mrub, STRESS: catalog.scenarios.STRESS.c0_max_mrub }}
        onView={compare.setViewed} />
    </Block>

    <Block title={`Шортлист ${scenario}`} note={`первые ${result.search.ranking.length} из ${format(result.search.ranked_count)}`}
      actions={<Tabs label="Показатели шортлиста" value={compare.density} onChange={compare.setDensity}
        items={[{ id: 'key', title: 'Ключевые' }, { id: 'all', title: 'Все показатели' }]} />}>
      <div className="table-scroll ranking-scroll" tabIndex={0} role="region" aria-label="Лидеры поиска">
        <table className="ranking-table">
          <thead><tr><th>Состав</th><th>Score</th>
            {fields.map(field => <th key={field} hidden={compare.density === 'key' && !KEY_FIELDS.includes(field)}
              title={`${metricNames[field]} · ${catalog.units[field]}`}>{metricShort[field] || metricHuman[field] || field}<small>{metricCode[field] || ''}</small></th>)}
            <th>STRESS</th><th>Действие</th></tr></thead>
          <tbody>{result.search.ranking.map(row => <tr key={row.portfolio_id} data-portfolio-id={row.portfolio_id} data-score={row.score}
            className={[compare.viewed === row.portfolio_id ? 'is-viewed' : '', row.portfolio_id === leader.portfolio_id ? 'is-leader' : '', appliedId === row.portfolio_id ? 'is-applied' : ''].filter(Boolean).join(' ')}
            onMouseEnter={() => compare.setViewed(row.portfolio_id)} onMouseLeave={() => compare.setViewed(null)}
            onFocus={() => compare.setViewed(row.portfolio_id)} onBlur={() => compare.setViewed(null)}>
            <th><span className="ranking-rank">{row.rank}</span>{composition(row.selection)}</th>
            <td>{format(row.score, 3)}</td>
            {fields.map(field => <td key={field} hidden={compare.density === 'key' && !KEY_FIELDS.includes(field)}>{format(row.metrics[field], 3)}</td>)}
            <td className={row.scenarios.STRESS.status === 'PASS' ? 'tone-pass' : 'tone-fail'}>{row.scenarios.STRESS.status}</td>
            <td className="ranking-actions">
              <button type="button" onClick={() => onLoad(`MCDA ${scenario} · ${row.rank}`, request(row))}>В конструктор</button>
              {row.portfolio_id !== leader.portfolio_id && (compare.extra.includes(row.portfolio_id)
                ? <button type="button" className="quiet" onClick={() => compare.drop(row.portfolio_id)}>Убрать</button>
                : <button type="button" className="quiet" disabled={columns.length >= MAX_COLUMNS} onClick={() => compare.add(row.portfolio_id)}>В сравнение</button>)}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </Block>
  </>
}

function difference(value: MainDifference, catalog: Catalog) {
  return value
    ? `${metricHuman[value.metric] || metricNames[value.metric]} ${signed(value.raw_delta)} ${unitOf(value.metric) || catalog.units[value.metric] || ''}`.trim()
    : 'по взвешенным критериям не выделяется'
}

/** Centre column, second tab: why the first one and not the second. */
function Why({ evidence, result, catalog, go }: {
  evidence: { data?: Intelligence; error: string; retry: () => void }
  result: NonNullable<DecisionState['result']>; catalog: Catalog
  go: (view: ViewId, tab?: string) => void
}) {
  const value = evidence.data
  const tie = result.search.ranking.length > 1 && Math.abs(result.search.ranking[0].score - result.search.ranking[1].score) < 1e-12
  const explanation = value?.explanation
  return <>
    {tie && <Callout tone="warn">Первые две строки имеют равный неокруглённый score. Порядок разрешён правилом: меньший C0, затем лексикографический состав.</Callout>}

    {!explanation ? <Callout tone={evidence.error ? 'error' : 'note'} role={evidence.error ? 'alert' : 'status'}>
      {evidence.error
        ? <>{evidence.error} <button type="button" className="link" onClick={evidence.retry}>Повторить объяснение</button></>
        : 'Готовим объяснение выбора для этой конфигурации…'}
    </Callout> : <>
      <Block title="Предпочтение с понятной ценой">
        <p className="block-lead">{explanation.interpretation}</p>
        <div className="why-pair">
          <div className="why-gain">
            <p className="object-role">Главный выигрыш</p>
            <p className="why-figure">{difference(explanation.main_gain_against_runner_up, catalog)}</p>
          </div>
          <div className="why-sacrifice">
            <p className="object-role">Главная уступка</p>
            <p className="why-figure">{difference(explanation.main_compromise_against_runner_up, catalog)}</p>
          </div>
        </div>
      </Block>

      <Block title="Ближайшие альтернативы" note="Δ — рекомендация минус альтернатива"
        actions={<button type="button" className="quiet" onClick={() => go('compare', 'search')}>Полное сравнение</button>}>
        <div className="peer-grid">{explanation.nearest_alternatives.slice(0, 2).map((peer, index) => {
          const candidate = value!.explorer.points.find(point => point.portfolio_id === peer.portfolio_id)
          return <article key={peer.portfolio_id} className="peer">
            <p className="object-role">{index === 0 ? 'Второе место' : 'Третье место'}</p>
            <p className="object-title">{candidate ? composition(candidate.selection) : peer.portfolio_id}</p>
            <Facts>
              <Fact label="Отрыв по score" value={format(peer.score_gap, 3)} />
              <Fact label="Получаем" tone="pass" value={peer.gains_under_declared_directions.map(row => `${metricCode[row.metric] || row.metric} ${signed(row.delta)}`).join(' · ') || 'равенство'} />
              <Fact label="Уступаем" tone="fail" value={peer.losses_under_declared_directions.map(row => `${metricCode[row.metric] || row.metric} ${signed(row.delta)}`).join(' · ') || 'нет'} />
            </Facts>
          </article>
        })}</div>
      </Block>
    </>}

  </>
}

/** Fixed readout beside the plot: important numbers never live only in a tooltip. */
function Readout({ result, leader, compare, appliedId, pool, onOpen, compared, full, go }: {
  result: NonNullable<DecisionState['result']>; leader: Candidate; compare: CompareState
  appliedId: string | null; pool: Candidate[]; onOpen: (row: Candidate) => void
  compared: string[]; full: boolean; go: (view: ViewId, tab?: string) => void
}) {
  const row = pool.find(item => item.portfolio_id === compare.viewed) || leader
  const isLeader = row.portfolio_id === leader.portfolio_id
  const drivers = Object.entries(row.contributions).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const stress = row.scenarios.STRESS
  return <div className="readout" aria-live="polite">
    <p className="object-role">{isLeader ? 'Рекомендуемый портфель' : 'Просматриваемый вариант'}</p>
    <p className="object-title">{composition(row.selection)}</p>
    <p className="object-meta">№{row.rank} из {format(result.search.ranked_count)} · score {format(row.score, 3)}</p>
    <Facts>
      <Fact label="Стартовые затраты" code="C0" hint={metricHints.c0_mrub} value={money(row.metrics.c0_mrub)} />
      <Fact label="Общественная ценность" code="VPUB" hint={metricHints.vpub_mrub_per_year} value={format(row.metrics.vpub_mrub_per_year, 1)} />
      <Fact label="Годовая эксплуатация" code="OPEX" value={money(row.metrics.opex_mrub_per_year, 'млн ₽/год')} />
      <Fact label="Запас BASE" value={signed(row.scenarios.BASE.c0_margin)} />
      <Fact label="Запас STRESS" tone={stress.status === 'PASS' ? 'pass' : 'fail'}
        value={<>{signed(stress.c0_margin)} <Status value={stress.status} /></>} />
    </Facts>
    <p className="readout-drivers-title">Главные факторы</p>
    <Facts className="driver-facts">
      {drivers.map(([key, value]) => <Fact key={key} label={criterionNames[key] || key} value={format(value, 3)} />)}
    </Facts>
    <div className="actions">
      <button type="button" className="primary" onClick={() => onOpen(row)}>В конструктор</button>
      {!isLeader
        ? <button type="button" disabled={full || compared.includes(row.portfolio_id)} onClick={() => compare.add(row.portfolio_id)}>В сравнение</button>
        : <button type="button" onClick={() => go('compare', 'search')}>Сравнение</button>}
    </div>
    {appliedId === row.portfolio_id && <p className="meta">Этот состав открыт в конструкторе.</p>}
  </div>
}

/** Third tab: the calculation itself — weights, scale, sensitivity, strategies, catalogue. */
function Method({ decision, catalog, compare, onLoad }: {
  decision: DecisionState; catalog: Catalog; compare: CompareState
  onLoad: (name: string, request: RequestInput) => void
}) {
  const { method, result, scenario } = decision
  const fields = method ? Object.values(method.field_mapping) : []
  if (!method || !result) return <Callout tone="note" role="status">Расчёт ещё не подтверждён сервером.</Callout>
  return <div className="method-page">
    <Block title="Веса и фиксированная шкала"
      note={`нормирование по ${format(result.search.reference_population.size)} BASE-допустимым составам; шкала не меняется при STRESS`}>
      <div className="table-scroll"><table><thead><tr><th>Критерий</th><th>Введённый вес</th><th>Применённый вес</th><th>Min</th><th>Max</th></tr></thead>
        <tbody>{Object.keys(method.weights).map(key => <tr key={key}>
          <th>{criterionNames[key] || key}<small>{key}</small></th>
          <td>{format(result.search.weights.original[key], 3)}</td>
          <td data-value={result.search.weights.applied[key]}>{format(result.search.weights.applied[key], 3)}</td>
          <td>{format(result.search.reference_population.bounds[key].min, 3)}</td>
          <td>{format(result.search.reference_population.bounds[key].max, 3)}</td></tr>)}</tbody></table></div>
      <p className="meta">Выгода: (x−min)/(max−min); затраты: (max−x)/(max−min). Score — сумма вес × нормированный показатель.
        При равенстве неокруглённого score действуют меньший C0, затем лексикографический состав lot_id:mode_id.</p>
    </Block>

    <Block title="Чувствительность приоритетов" note={`±20 % · ${result.sensitivity.runs.filter(run => !run.selection_changes.unchanged).length} из ${result.sensitivity.runs.length} опытов меняют лидера`}>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Пересчёты чувствительности">
        <table className="sensitivity-table"><thead><tr><th>Опыт</th><th>Лидер</th><th>Место исходного выбора</th><th>Изменения</th></tr></thead>
          <tbody>{result.sensitivity.runs.map(run => <tr key={`${run.criterion}-${run.multiplier}`} data-sensitivity={`${run.criterion}-${run.multiplier}`}
            className={run.selection_changes.unchanged ? 'is-stable' : 'is-shifted'}>
            <th>{criterionNames[run.criterion] || run.criterion} × {run.multiplier}</th>
            <td>{composition(run.leader.selection)}<small>score {format(run.leader.score, 3)}</small></td>
            <td>{run.original_choice_rank ?? 'не ранжируется'}</td>
            <td>{changes(run.selection_changes)}</td>
          </tr>)}</tbody></table>
      </div>
      <Facts>
        <Fact label="Равные веса, все восемь по 0,125" value={composition(result.sensitivity.equal_weight_profile.leader.selection)} />
        <Fact label="Место исходного выбора при равных весах" value={result.sensitivity.equal_weight_profile.original_choice_rank ?? 'не ранжируется'} />
      </Facts>
      <p className="meta">±20 % — локальная проверка двух весов, а не гарантия полной устойчивости решения. Каждый опыт меняет один вес и заново нормирует весь вектор. {result.sensitivity.interpretation}</p>
    </Block>

    <Block title="Объявленные стратегии" note={`${result.alternatives.length} стратегий и их отличия от лидера ${scenario}`}>
      <div className="strategy-grid">{result.alternatives.map(item => <StrategyCard key={item.strategy_id} item={item} catalog={catalog}
        fields={fields} onOpen={() => onLoad(item.title, item.request)}
        inComparison={compare.strategies.includes(item.strategy_id)}
        onCompare={() => compare.toggleStrategy(item.strategy_id)} onView={compare.setViewed} />)}</div>
    </Block>

    <Block title="Каталог и коэффициенты" note="сохранённая версия источника, только для чтения">
      <Disclosure summary="Восемь лотов: исходные значения" note="C0, OPEX, VPUB, CASH и индексы каждого лота">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Каталог восьми лотов"><table id="catalog-lots">
          <thead><tr><th>Лот / сервис</th><th>Архетип / группы</th><th>C0</th><th>OPEX</th><th>VPUB</th><th>Якорный / коммерческий CASH</th><th>Индексы</th></tr></thead>
          <tbody>{catalog.lots.map(lot => <tr key={lot.lot_id}>
            <th scope="row">{lot.lot_id} · {lotNames[lot.lot_id]}<small>{lot.service}</small></th>
            <td>{lot.territorial_archetype}<small>{lot.capability_groups}</small>{lot.federal ? <small>федеральный</small> : null}</td>
            <td>{format(lot.c0_mrub)}</td><td>{format(lot.opex_mrub_per_year)}</td><td>{format(lot.vpub_mrub_per_year)}</td>
            <td>{format(lot.anchor_cash_mrub_per_year)} / {format(lot.commercial_cash_mrub_per_year)}</td>
            <td>{['t_rep', 'readiness_1_5', 'resilience_1_5', 'scale_1_5'].map(key => <small key={key}>{metricShort[key] || key}: {format(lot[key])}</small>)}</td>
          </tr>)}</tbody>
        </table></div>
      </Disclosure>
      <Disclosure summary="Режимы A / B / C" note="множители исходных показателей">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Коэффициенты режимов"><table>
          <thead><tr><th>Режим</th><th>k_C0</th><th>k_OPEX</th><th>k_VPUB</th><th>k_anchor</th><th>k_commercial</th><th>общественное ядро</th></tr></thead>
          <tbody>{catalog.modes.map(mode => <tr key={mode.mode_id}><th scope="row">{mode.mode_id}</th>
            <td>{format(mode.k_c0)}</td><td>{format(mode.k_opex)}</td><td>{format(mode.k_vpub)}</td>
            <td>{format(mode.k_anchor)}</td><td>{format(mode.k_commercial)}</td><td>{mode.public_core ? 'да' : 'нет'}</td></tr>)}</tbody>
        </table></div>
        <p className="meta">По исходным данным только режим A имеет public_core = true. Это не означает, что весь сервис бесплатен.
          SSA исключается только из территориального счёта; PNT, InSAR и PNT/InSAR считаются одной группой возможностей.</p>
      </Disclosure>
    </Block>

    <Block title="О расчёте и данных">
      <Facts>
        <Fact label="Кейс" value={`${catalog.case_id} · v${catalog.case_version}`} />
        <Fact label="Данные" value="синтетические данные кейса; C0 при запуске + один год эксплуатации" />
        <Fact label="Инструмент" value="локальный расчёт, без внешних сервисов" />
      </Facts>
      <p className="meta">Результат — основание для решения о пилоте при выполнении условий, без утверждений о фактическом спросе и достигнутом эффекте.</p>
      <Disclosure summary="Ограничения метода и происхождение">
        <ul>{method.limitations.map(text => <li key={text}>{text}</li>)}</ul>
        <p className="meta">Population ID: {result.search.reference_population.population_id} · fingerprint {result.input_fingerprint}</p>
        <pre>{JSON.stringify({ method: method.provenance, constraints_common: catalog.constraints_common, scenarios: catalog.scenarios, source_hashes: catalog.source_hashes }, null, 2)}</pre>
      </Disclosure>
    </Block>
  </div>
}

function StrategyCard({ item, catalog, fields, onOpen, onCompare, inComparison, onView }: {
  item: Alternative; catalog: Catalog; fields: string[]; onOpen: () => void; onCompare: () => void
  inComparison: boolean; onView: (id: string | null) => void
}) {
  return <article className="strategy" data-strategy={item.strategy_id}
    onMouseEnter={() => onView(item.candidate.portfolio_id)} onMouseLeave={() => onView(null)}>
    <p className="object-role">{item.title.replace(/^BASE:\s*/, '')}</p>
    <p className="object-title">{composition(item.candidate.selection)}</p>
    {item.same_portfolio_as && <p className="meta">Совпадает по составу с {item.same_portfolio_as}; это не отдельная альтернатива.</p>}
    <Facts>
      <Fact label="Место при текущих весах" value={item.current_profile_rank ?? 'вне допустимых'} />
      <Fact label="BASE / STRESS" value={<>{item.candidate.scenarios.BASE.status} / {item.candidate.scenarios.STRESS.status}</>} />
      <Fact label="Запас C0 · STRESS" tone={item.candidate.scenarios.STRESS.ok ? 'pass' : 'fail'} value={signed(item.candidate.scenarios.STRESS.c0_margin)} />
    </Facts>
    <p className="strategy-rationale">{item.rationale}</p>
    <div className="actions">
      <button type="button" onClick={onOpen}>В конструктор</button>
      <button type="button" className="quiet" onClick={onCompare}>{inComparison ? 'Убрать из сравнения' : 'В сравнение'}</button>
    </div>
    <Disclosure summary="Показатели и отличия от лидера">
      <div className="table-scroll"><table><thead><tr><th>Показатель</th><th>Значение</th><th>Δ к лидеру</th></tr></thead>
        <tbody>{[...fields, 'cash_mrub_per_year'].map(field => <tr key={field}>
          <th>{metricHuman[field] || metricNames[field]}<small>{unitOf(field) || catalog.units[field]}</small></th>
          <td>{format(item.candidate.metrics[field], 3)}</td>
          <td>{signed(item.delta_to_current_leader[field])}</td></tr>)}</tbody></table></div>
      <p className="meta">Общественное ядро: {item.candidate.public_core_ids.join(', ') || '—'}. {changes(item.selection_changes)}.
        CASH − OPEX {format(item.candidate.net_operating_balance)}; сумма адресных дефицитов {format(item.candidate.sum_lot_funding_gaps)} млн ₽/год. Это диагностика финансирования, не прибыль.</p>
    </Disclosure>
    <Disclosure summary="Задачи сервисов и коэффициенты режимов">
      <p className="meta">Предложения команды из service-design M0, а не утверждённые договоры. Режим A/B/C меняет C0, OPEX, VPUB, якорный и коммерческий CASH и признак общественного ядра одновременно.</p>
      {item.service_context.map(service => <div key={service.lot_id} className="service-note">
        <p className="object-role">{service.lot_id} {service.mode_id} · {service.public_core ? 'общественное ядро' : 'вне общественного ядра'}</p>
        <p>{service.task_proposal}</p>
        <p className="meta">{Object.entries(service.mode_coefficients).map(([key, value]) => `${key} = ${format(value)}`).join('; ')}</p>
      </div>)}
    </Disclosure>
  </article>
}
