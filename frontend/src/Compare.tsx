/** Comparison in two layers: what an alternative buys and what it costs first, the dense
 *  matrix second. Deltas for declared strategies come from the server; nothing is
 *  recomputed here. */
import { ComparisonMatrix, TradeoffCards } from './ComparisonMatrix'
import { buildColumns } from './comparison'
import type { CompareState } from './comparison'
import { compareMetrics, format, lotNames, metricHuman, metricNames, signed, unitOf } from './presentation'
import { Block, Callout, Empty, Status, Tabs, ViewHead } from './ui'
import type { DecisionState } from './useDecision'
import type { Catalog, Envelope, RequestInput, Workspace } from './types'
import type { ViewId } from './routes'

export function Compare({ tab, catalog, decision, compare, workspace, computed, appliedId, onLoad, onRemove, go }: {
  tab: string; catalog: Catalog; decision: DecisionState; compare: CompareState
  workspace: Workspace; computed: Envelope['computed']; appliedId: string | null
  onLoad: (name: string, request: RequestInput) => void
  onRemove: (index: number) => void
  go: (view: ViewId, tab?: string) => void
}) {
  const { result, method, scenario } = decision
  const columns = result ? buildColumns(result, compare) : []
  const leader = result?.search.ranking[0]

  return <>
    <ViewHead title="Сравнение"
      state={tab === 'saved' ? `${workspace.alternatives.length} из 3 сохранённых составов` : `рекомендация и ${Math.max(columns.length - 1, 0)} альтернатив`}>
      <Tabs label="Что сравнивается" value={tab} items={[
        { id: 'search', title: 'Варианты поиска' }, { id: 'saved', title: 'Сохранённые составы' },
      ]} onChange={next => go('compare', next)} />
    </ViewHead>

    {tab === 'saved'
      ? <Saved workspace={workspace} computed={computed} onLoad={onLoad} onRemove={onRemove} go={go} />
      : !result || !leader || !method ? <Callout tone="note" role="status">Сравнение появится после успешного расчёта поиска.</Callout> : <>
        <Block title="Цена компромисса" note="что альтернатива даёт и чем за это платит">
          <TradeoffCards columns={columns} leader={leader} catalog={catalog} directions={method.directions}
            scenario={scenario} viewedId={compare.viewed} onView={compare.setViewed} />
          <div className="strategy-toggle" role="group" aria-label="Столбцы объявленных стратегий">
            <span>Стратегии в сравнении:</span>
            {result.alternatives.filter(item => !item.same_portfolio_as).map(item => <label key={item.strategy_id}>
              <input type="checkbox" checked={compare.strategies.includes(item.strategy_id)}
                onChange={() => compare.toggleStrategy(item.strategy_id)} />
              {item.title.replace(/^BASE:\s*/, '')}
            </label>)}
          </div>
        </Block>

        <Block title="Показатели" note="одна конфигурация и одна фиксированная шкала; VPUB отдельно от CASH"
          actions={<Tabs label="Глубина сравнения" value={compare.density} onChange={compare.setDensity}
            items={[{ id: 'key', title: 'Основные' }, { id: 'all', title: 'Все показатели' }]} />}>
          <ComparisonMatrix columns={columns} leader={leader} catalog={catalog} directions={method.directions}
            scenario={scenario} viewedId={compare.viewed} appliedId={appliedId} onView={compare.setViewed} detail={compare.density}
            onOpen={column => onLoad(column.alternative ? column.alternative.title : `Шортлист ${scenario} · ${column.candidate.rank}`,
              column.alternative ? column.alternative.request : {
                schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version,
                selection: column.candidate.selection,
              })}
            onDrop={compare.drop} />
        </Block>
      </>}
  </>
}

function Saved({ workspace, computed, onLoad, onRemove, go }: {
  workspace: Workspace; computed: Envelope['computed']
  onLoad: (name: string, request: RequestInput) => void
  onRemove: (index: number) => void
  go: (view: ViewId, tab?: string) => void
}) {
  if (workspace.alternatives.length === 0) return <>
    <Empty>Здесь появятся составы, собранные вручную. Соберите четыре лота в конструкторе и нажмите «Добавить в сравнение».</Empty>
    <div className="actions"><button type="button" onClick={() => go('builder')}>Открыть конструктор</button></div>
  </>

  return <>
    <Block title="Сохранённые составы" note="созданы вручную и не являются рекомендацией">
      <div className="alternative-actions">{workspace.alternatives.map((item, index) => <article key={item.alternative_id}>
        <p className="object-role">{item.name}</p>
        <p className="object-title">{item.request.selection.map(row => `${row.lot_id} ${row.mode_id}`).join(' · ')}</p>
        <div className="actions">
          <button type="button" onClick={() => onLoad(item.name, item.request)}>В конструктор</button>
          <button type="button" className="quiet" onClick={() => onRemove(index)} aria-label={`Удалить ${item.name}`}>Удалить</button>
        </div>
      </article>)}</div>
    </Block>

    {workspace.alternatives.length < 2
      ? <Callout tone="note">Для таблицы нужен ещё один полный состав с другими лотами или режимами.</Callout>
      : !computed ? <Callout tone="note" role="status">Пересчитываем сравнение текущих входов…</Callout>
        : <Block title="Показатели сохранённых составов" note={`Δ относительно «${computed.alternatives[0].name}»`}>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Сравнение альтернатив">
            <table className="comparison-table">
              <thead><tr><th>Показатель</th>{computed.alternatives.map(item => <th key={item.name}>{item.name}</th>)}</tr></thead>
              <tbody>
                <tr><th scope="row">Состав и режимы</th>{computed.alternatives.map(item => <td key={item.name}>
                  {item.result.original_request.selection.map(row => <div key={row.lot_id}>{row.lot_id} · {lotNames[row.lot_id]} · <b>{row.mode_id}</b></div>)}
                </td>)}</tr>
                {(['BASE', 'STRESS'] as const).map(scenario => <tr key={scenario}>
                  <th scope="row">{scenario}</th>{computed.alternatives.map(item => <td key={item.name}>
                    <Status value={item.result.scenarios[scenario].status} />
                    <ul>{item.result.scenarios[scenario].diagnostics.filter(check => check.ok === false).map(check =>
                      <li key={check.id}>{check.condition}: нарушение {format(check.deficit, 3)} {check.unit}</li>)}</ul>
                  </td>)}</tr>)}
                {compareMetrics.map(key => <tr key={key}>
                  <th scope="row">{metricHuman[key] || metricNames[key]}<small>{unitOf(key) || computed.current.units[key]}</small></th>
                  {computed.alternatives.map((item, index) => <td key={item.name}>
                    <b>{format(item.result.metrics[key], 3)}</b>{index > 0 && <small>Δ {signed(computed.deltas[index]?.metrics[key])}</small>}
                  </td>)}</tr>)}
                {(['BASE', 'STRESS'] as const).map(scenario => <tr key={`margin-${scenario}`}>
                  <th scope="row">Запас C0 · {scenario}<small>отрицательный — превышение</small></th>
                  {computed.alternatives.map(item => <td key={item.name}>
                    {signed(item.result.scenarios[scenario].diagnostics.find(check => check.id === 'c0_limit')?.margin)}
                  </td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <p className="meta">Знак Δ показывает направление изменения, а не итоговую оценку. Доступ, общественная ценность и денежный поток сопоставляются отдельно.</p>
        </Block>}
  </>
}
