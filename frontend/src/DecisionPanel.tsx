/** Search, evidence and the case for the chosen portfolio. Every number is produced by
 *  /api/decision/recompute; this file only arranges and labels it. */
import { useState } from 'react'
import { format, metricNames } from './presentation'
import { changes, composition } from './decision'
import type { Alternative, Candidate } from './decision'
import { ComparisonMatrix } from './ComparisonMatrix'
import type { Column } from './ComparisonMatrix'
import { TradeoffPlot } from './TradeoffPlot'
import { ServiceMap } from './ServiceMap'
import { PreferencePanel } from './PreferencePanel'
import type { DecisionState } from './useDecision'
import type { Catalog, RequestInput } from './types'

const DEFAULT_STRATEGIES = ['max_vpub', 'min_c0']
const MAX_COLUMNS = 5

export function DecisionPanel({ catalog, currentRequest, appliedId, decision, onLoad }: {
  catalog: Catalog; currentRequest: RequestInput; appliedId: string | null; decision: DecisionState
  onLoad: (name: string, request: RequestInput) => void
}) {
  const [viewed, setViewed] = useState<string | null>(null)
  const [extra, setExtra] = useState<string[]>([])
  const [strategies, setStrategies] = useState<string[]>(DEFAULT_STRATEGIES)
  const { method, result, error, storage, busy, valid, scenario } = decision
  const exploratory = !!method && !!decision.weights
    && !Object.keys(method.weights).every(key => Math.abs((decision.weights![key] ?? NaN) - method.weights[key]) < 1e-12)

  const request = (row: Candidate): RequestInput => ({
    schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: row.selection,
  })
  const leader = result?.search.ranking[0]
  const columns: Column[] = !result || !leader ? [] : [
    { candidate: leader, title: 'Предпочтительный', note: 'лидер при текущих весах' },
    ...result.alternatives
      .filter(item => strategies.includes(item.strategy_id) && item.candidate.portfolio_id !== leader.portfolio_id && !item.same_portfolio_as)
      .map(item => ({ candidate: item.candidate, title: item.title, note: 'объявленная стратегия', alternative: item })),
    ...extra.map(id => result.search.ranking.find(row => row.portfolio_id === id))
      .filter((row): row is Candidate => !!row && row.portfolio_id !== leader.portfolio_id)
      .map(row => ({ candidate: row, title: `Шортлист · место ${row.rank}`, note: 'добавлен вручную' })),
  ].slice(0, MAX_COLUMNS)
  const tie = !!result && result.search.ranking.length > 1 && Math.abs(result.search.ranking[0].score - result.search.ranking[1].score) < 1e-12

  return <section id="decision" className="panel decision-panel" aria-label="Поиск и выбор">
    <div className="section-heading">
      <div><p className="eyebrow">Полный перебор → ограничения → предпочтения → проверка</p><h2>Поиск и обоснованный выбор</h2></div>
    </div>
    <p>Исследуйте допустимые A/B/C-портфели. Поиск не меняет ручной состав: любой вариант открывается в конструкторе отдельным действием.</p>

    {decision.pendingRestore ? <>
      <p role="status">{error || 'Загружаем объявленный метод и пересчитываем сохранённый поиск…'}</p>
      {error && <button type="button" onClick={decision.reboot}>Повторить загрузку поиска</button>}
    </> : <>
      <p className="method-thesis">{method!.strategy_thesis}</p>

      <PreferencePanel decision={decision} currentRequest={currentRequest} exploratory={exploratory} />

      {storage && <p className="muted" role="status">{storage}</p>}
      {decision.backup !== null && <button type="button" onClick={decision.downloadBackup}>Скачать прежний поиск</button>}
      {error && <div className="error" role="alert"><p>{error}</p><button type="button" onClick={decision.invalidate}>Повторить поиск</button></div>}

      {!result ? <p role="status">{busy ? 'Проверяем JSON выбора…' : !valid ? 'Рейтинг скрыт: исправьте веса.' : error ? 'Результат скрыт до успешного пересчёта.' : 'Python перебирает варианты и пересчитывает рейтинги… Первый поиск требует подготовки всей популяции.'}</p> : <>
        <div className="search-summary" data-testid="search-summary">
          <b>Всего {result.search.population.total} уникальных вариантов</b>
          {(['BASE', 'STRESS'] as const).map(name => <span key={name}>{name}: {result.search.population.scenarios[name].feasible} допустимых / {result.search.population.scenarios[name].excluded} исключённых</span>)}
          <span>STRESS ⊆ BASE: {result.search.population.stress_is_subset_of_base ? 'да' : 'нет'}</span>
        </div>
        <details className="disclosure"><summary>Причины исключения в {scenario}</summary>
          <p>Причины пересекаются: один вариант может нарушать несколько условий. Их сумма не равна числу исключённых.</p>
          <ul>{result.search.population.scenarios[scenario].exclusion_reasons.map(reason => <li key={reason.id}>{reason.condition}: {reason.count}</li>)}</ul>
        </details>

        <div id="why" className="why">
          <div className="section-heading"><div><p className="eyebrow">Доказательство выбора</p><h3>Почему этот портфель</h3></div>
            <span>{columns.length} столбца в сравнении · {result.search.ranking.length} в шортлисте</span></div>
          <p>Сравнение идёт на одной конфигурации и одной фиксированной шкале. Разницы объявленных стратегий рассчитаны сервером относительно текущего лидера.</p>
          {tie && <p className="notice">Первые две строки имеют равный неокруглённый score. Порядок разрешён объявленным правилом: меньший C0, затем лексикографический состав.</p>}

          <div className="why-grid">
            <TradeoffPlot shortlist={result.search.ranking}
              extras={columns.map(column => column.candidate).filter(candidate => !result.search.ranking.some(row => row.portfolio_id === candidate.portfolio_id))}
              bounds={result.search.reference_population.bounds}
              referenceSize={result.search.reference_population.size} leaderId={leader!.portfolio_id} viewedId={viewed}
              comparedIds={columns.map(column => column.candidate.portfolio_id)} appliedId={appliedId}
              scenario={scenario} caps={{ BASE: catalog.scenarios.BASE.c0_max_mrub, STRESS: catalog.scenarios.STRESS.c0_max_mrub }}
              onView={setViewed} />
            <Readout result={result} viewed={viewed} leader={leader!} appliedId={appliedId}
              pool={[...result.search.ranking, ...columns.map(column => column.candidate)]} />
          </div>

          <div className="strategy-toggle" role="group" aria-label="Столбцы объявленных стратегий">
            <span>Стратегии в сравнении:</span>
            {result.alternatives.filter(item => !item.same_portfolio_as).map(item => <label key={item.strategy_id}>
              <input type="checkbox" checked={strategies.includes(item.strategy_id)}
                onChange={() => setStrategies(current => current.includes(item.strategy_id) ? current.filter(id => id !== item.strategy_id) : [...current, item.strategy_id])} />
              {item.title.replace(/^BASE: /, '')}
            </label>)}
          </div>

          <ComparisonMatrix columns={columns} leader={leader!} catalog={catalog} directions={method!.directions}
            scenario={scenario} viewedId={viewed} appliedId={appliedId} onView={setViewed}
            onOpen={column => onLoad(column.alternative ? column.alternative.title : `Шортлист ${scenario} · ${column.candidate.rank}`, column.alternative ? column.alternative.request : request(column.candidate))}
            onDrop={id => setExtra(current => current.filter(item => item !== id))} />

          <h4 id="shortlist">Лидеры {scenario}</h4>
          <p>Показаны первые {result.search.ranking.length} из {result.search.ranked_count} допустимых. Все исходные метрики — расчёт Python. Наведение или фокус на строке подсвечивает точку на графике; состав применяется только кнопкой.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Лидеры поиска">
            <table className="ranking-table">
              <thead><tr><th>Ранг / состав</th><th>Score</th>{Object.values(method!.field_mapping).map(field => <th key={field}>{metricNames[field]}<small>{catalog.units[field]}</small></th>)}<th>Действие</th></tr></thead>
              <tbody>{result.search.ranking.map(row => <tr key={row.portfolio_id} data-portfolio-id={row.portfolio_id} data-score={row.score}
                className={[viewed === row.portfolio_id ? 'is-viewed' : '', row.portfolio_id === leader!.portfolio_id ? 'is-leader' : '', appliedId === row.portfolio_id ? 'is-applied' : ''].filter(Boolean).join(' ')}
                onMouseEnter={() => setViewed(row.portfolio_id)} onMouseLeave={() => setViewed(null)}
                onFocus={() => setViewed(row.portfolio_id)} onBlur={() => setViewed(null)}>
                <th>{row.rank}. {composition(row.selection)}</th>
                <td>{format(row.score, 6)}</td>
                {Object.values(method!.field_mapping).map(field => <td key={field}>{format(row.metrics[field], 6)}</td>)}
                <td className="ranking-actions">
                  <button type="button" onClick={() => onLoad(`MCDA ${scenario} · ${row.rank}`, request(row))}>В конструктор</button>
                  {row.portfolio_id !== leader!.portfolio_id && (extra.includes(row.portfolio_id)
                    ? <button type="button" className="quiet" onClick={() => setExtra(current => current.filter(id => id !== row.portfolio_id))}>Убрать</button>
                    : <button type="button" className="quiet" disabled={columns.length >= MAX_COLUMNS} onClick={() => setExtra(current => [...current, row.portfolio_id])}>В сравнение</button>)}
                </td>
              </tr>)}</tbody>
            </table>
          </div>

          <h4>Портфель как связанные сервисы</h4>
          <ServiceMap candidate={leader!} services={result.recommendation.service_context} catalog={catalog} />
        </div>

        <details className="disclosure"><summary>Веса, фиксированная шкала и происхождение</summary>
          <p>R = все {result.search.reference_population.size} BASE-допустимых варианта. Min/max не меняются при STRESS и сравнении. Постоянный критерий даёт 0. Выгода: (x−min)/(max−min); затраты: (max−x)/(max−min). Score = сумма вес × нормированный показатель.</p>
          <p>При равенстве неокруглённого score: меньший C0, затем лексикографический состав lot_id:mode_id. Подписи UI не определяют порядок.</p>
          <div className="table-scroll"><table><thead><tr><th>Критерий</th><th>Введённый вес</th><th>Применённый вес</th><th>Min R</th><th>Max R</th></tr></thead>
            <tbody>{Object.keys(method!.weights).map(key => <tr key={key}><th>{key}</th>
              <td>{format(result.search.weights.original[key], 6)}</td>
              <td data-value={result.search.weights.applied[key]}>{format(result.search.weights.applied[key], 6)}</td>
              <td>{format(result.search.reference_population.bounds[key].min, 6)}</td>
              <td>{format(result.search.reference_population.bounds[key].max, 6)}</td></tr>)}</tbody></table></div>
          <p className="source">Population ID: {result.search.reference_population.population_id}</p>
          <pre>{JSON.stringify(method!.provenance, null, 2)}</pre>
          <ul>{method!.limitations.map(text => <li key={text}>{text}</li>)}</ul>
        </details>

        <h3>Стратегии и цена компромисса</h3>
        <p>Предметные стратегии выбираются из BASE-допустимых, стресс-ответ — по заявленному правилу. Стратегии могут совпасть; это отмечено явно. Разницы ниже — к текущему лидеру {scenario} на одной BASE-шкале. Недопустимый в {scenario} состав не получает место.</p>
        <div className="strategy-grid">{result.alternatives.map(item => <StrategyCard key={item.strategy_id} item={item} catalog={catalog}
          fields={Object.values(method!.field_mapping)} onOpen={() => onLoad(item.title, item.request)}
          inComparison={strategies.includes(item.strategy_id)}
          onCompare={() => setStrategies(current => current.includes(item.strategy_id) ? current.filter(id => id !== item.strategy_id) : [...current, item.strategy_id])}
          onView={setViewed} />)}</div>

        <div className="access-note recommendation" data-testid="recommendation">
          <h3>Рекомендация BASE и действие при STRESS</h3>
          <p>{method!.recommendation_rule}</p>
          <p><b>BASE:</b> {composition(result.recommendation.base.selection)}; C0 {format(result.recommendation.base.metrics.c0_mrub)} млн руб.; запас STRESS {format(result.recommendation.base.scenarios.STRESS.c0_margin)} млн руб.</p>
          <p><b>{result.recommendation.action === 'RETAIN' ? 'Сохранить состав' : 'Пересмотреть состав'}:</b> {composition(result.recommendation.stress.selection)}. {changes(result.recommendation.selection_changes)}.</p>
          <p>Изменение C0: {format(result.recommendation.stress_delta_to_base.c0_mrub)} млн руб.; OPEX: {format(result.recommendation.stress_delta_to_base.opex_mrub_per_year)} млн руб./год; VPUB: {format(result.recommendation.stress_delta_to_base.vpub_mrub_per_year)} синтетических млн руб./год; CASH: {format(result.recommendation.stress_delta_to_base.cash_mrub_per_year)} млн руб./год.</p>
          <p>{result.recommendation.condition}</p>
        </div>

        <h3>Чувствительность предпочтений</h3>
        <p data-testid="sensitivity-baseline">Исходный выбор: {composition(result.sensitivity.original_choice.selection)}. {result.sensitivity.baseline_kind === 'EXPLICIT_PORTFOLIO' ? 'Явно сохранённый ручной состав.' : `Лидер ${scenario} при текущем введённом векторе.`} Каждый опыт меняет только один вес и заново нормирует весь вектор. Недопустимый в {scenario} исходный состав не ранжируется.</p>
        <p className="muted">±20 % — локальная проверка двух весов, а не гарантия полной устойчивости решения. Отсутствие смены лидера — тоже корректный результат.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Четыре пересчёта чувствительности">
          <table className="sensitivity-table"><thead><tr><th>Опыт</th><th>Лидер / score</th><th>Ранг исходного выбора / его score</th><th>Изменения</th><th>Применённые веса</th></tr></thead>
            <tbody>{result.sensitivity.runs.map(run => <tr key={`${run.criterion}-${run.multiplier}`} data-sensitivity={`${run.criterion}-${run.multiplier}`}
              className={run.selection_changes.unchanged ? 'is-stable' : 'is-shifted'}>
              <th>{run.criterion} × {run.multiplier}{run.zero_weight_unchanged && <small>Нулевой вес остаётся нулевым</small>}</th>
              <td>{composition(run.leader.selection)}<small>{format(run.leader.score, 6)}</small></td>
              <td>{run.original_choice_rank ?? 'Не ранжируется'}<small>{format(run.original_choice_score, 6)}</small></td>
              <td>{changes(run.selection_changes)}</td>
              <td>{Object.entries(run.applied_weights).map(([key, number]) => <small key={key}>{key}: {format(number, 6)}</small>)}</td>
            </tr>)}</tbody></table>
        </div>
        <p><b>Равновесный профиль:</b> все восемь весов 0,125. Лидер {composition(result.sensitivity.equal_weight_profile.leader.selection)}; score {format(result.sensitivity.equal_weight_profile.leader.score, 6)}. Ранг исходного выбора: {result.sensitivity.equal_weight_profile.original_choice_rank ?? 'не ранжируется'}. {changes(result.sensitivity.equal_weight_profile.selection_changes)}.</p>
        <p className="muted">{result.sensitivity.interpretation}</p>
        <p className="source">Fingerprint конфигурации: {result.input_fingerprint}</p>
      </>}
    </>}
  </section>
}

/** Fixed readout beside the plot: important numbers never live only in a tooltip. */
function Readout({ result, viewed, leader, appliedId, pool }: {
  result: NonNullable<DecisionState['result']>; viewed: string | null; leader: Candidate; appliedId: string | null; pool: Candidate[]
}) {
  const row = pool.find(item => item.portfolio_id === viewed) || leader
  const isLeader = row.portfolio_id === leader.portfolio_id
  return <div className="readout" aria-live="polite">
    <p className="readout-role">{viewed && !isLeader ? 'Просматриваемый вариант' : isLeader && viewed ? 'Просматриваемый — он же предпочтительный' : 'Предпочтительный вариант'}</p>
    <p className="readout-composition">{composition(row.selection)}</p>
    <dl>
      <div><dt>Место</dt><dd>{row.rank} из {result.search.ranked_count}</dd></div>
      <div><dt>Score</dt><dd>{format(row.score, 6)}</dd></div>
      <div><dt>C0</dt><dd>{format(row.metrics.c0_mrub)} млн руб.</dd></div>
      <div><dt>VPUB</dt><dd>{format(row.metrics.vpub_mrub_per_year)} синтет. млн руб./год</dd></div>
      <div><dt>OPEX</dt><dd>{format(row.metrics.opex_mrub_per_year)} млн руб./год</dd></div>
      <div><dt>Запас C0 · BASE</dt><dd>{format(row.scenarios.BASE.c0_margin)} млн руб.</dd></div>
      <div><dt>Запас C0 · STRESS</dt><dd>{format(row.scenarios.STRESS.c0_margin)} млн руб. · {row.scenarios.STRESS.status}</dd></div>
    </dl>
    <p className="muted">{appliedId === row.portfolio_id ? 'Этот состав открыт в конструкторе.' : 'Просмотр ничего не применяет: состав в конструкторе меняется только кнопкой «В конструктор».'}</p>
  </div>
}

function StrategyCard({ item, catalog, fields, onOpen, onCompare, inComparison, onView }: {
  item: Alternative; catalog: Catalog; fields: string[]; onOpen: () => void; onCompare: () => void
  inComparison: boolean; onView: (id: string | null) => void
}) {
  return <article className="strategy" data-strategy={item.strategy_id}
    onMouseEnter={() => onView(item.candidate.portfolio_id)} onMouseLeave={() => onView(null)}>
    <h4>{item.title}</h4>
    <p><b>{composition(item.candidate.selection)}</b></p>
    {item.same_portfolio_as && <p className="muted">Совпадает по составу с {item.same_portfolio_as}; это не отдельная альтернатива.</p>}
    <p>{item.rationale}</p>
    <p>Ранг при текущих весах: {item.current_profile_rank ?? 'вне допустимых'}; score: {item.current_profile_score === null ? '—' : format(item.current_profile_score, 6)}</p>
    <p>BASE {item.candidate.scenarios.BASE.status} / STRESS {item.candidate.scenarios.STRESS.status}. Запас C0: BASE {format(item.candidate.scenarios.BASE.c0_margin)} / STRESS {format(item.candidate.scenarios.STRESS.c0_margin)} млн руб.</p>
    <p>Общественное ядро: {item.candidate.public_core_ids.join(', ')}. {changes(item.selection_changes)}.</p>
    <details><summary>Пользователи, задачи и режимы доступа</summary>
      <p>Ниже — предложения команды из service-design M0, а не утверждённые договоры. A/B/C меняет C0, OPEX, VPUB, якорный и коммерческий CASH и признак общественного ядра одновременно. A не означает, что весь сервис бесплатен.</p>
      {item.service_context.map(service => <div key={service.lot_id}>
        <b>{service.lot_id} {service.mode_id} · {service.public_core ? 'общественное ядро' : 'вне общественного ядра'}</b>
        <p>{service.task_proposal}</p>
        <small>Исходные коэффициенты: {Object.entries(service.mode_coefficients).map(([key, value]) => `${key}=${format(value)}`).join('; ')}</small>
      </div>)}
    </details>
    <div className="table-scroll"><table><thead><tr><th>Показатель</th><th>Значение</th><th>Δ к лидеру</th></tr></thead>
      <tbody>{[...fields, 'cash_mrub_per_year', 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year'].map(field => <tr key={field}>
        <th>{metricNames[field]}<small>{catalog.units[field]}</small></th>
        <td>{format(item.candidate.metrics[field], 6)}</td>
        <td>{format(item.delta_to_current_leader[field], 6)}</td></tr>)}</tbody></table></div>
    <p>CASH − OPEX: {format(item.candidate.net_operating_balance)} млн руб./год; портфельный gap: {format(item.candidate.portfolio_funding_gap)}; сумма дефицитов лотов: {format(item.candidate.sum_lot_funding_gaps)}. Это диагностика финансирования, не прибыль; перераспределение между лотами требует условий.</p>
    <details><summary>Вклады в score стратегии</summary><pre>{JSON.stringify({ weights: item.strategy_weights, normalized: item.candidate.normalized, contributions: item.candidate.contributions }, null, 2)}</pre></details>
    <div className="actions">
      <button type="button" onClick={onOpen}>Открыть стратегию</button>
      <button type="button" className="quiet" onClick={onCompare}>{inComparison ? 'Убрать из матрицы' : 'Добавить в матрицу'}</button>
    </div>
  </article>
}
