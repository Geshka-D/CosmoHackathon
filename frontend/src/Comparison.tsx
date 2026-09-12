import type { Envelope, Workspace } from './types'
import { compareMetrics, format, lotNames, metricNames, signed } from './presentation'
import { Status } from './ResultPanel'

export function Comparison({ workspace, computed, onLoad, onRemove }: {
  workspace: Workspace; computed: Envelope['computed']; onLoad: (index: number) => void; onRemove: (index: number) => void
}) {
  return <section id="comparison" className="panel">
    <div className="section-heading"><div><p className="eyebrow">Сохранённые варианты</p><h2>Сравнение</h2></div><span>{workspace.alternatives.length} / 3</span></div>
    <p>Сохраните полный состав, измените лоты или режимы и добавьте ещё один вариант. Эти варианты созданы вручную и не являются финальной рекомендацией.</p>
    {workspace.alternatives.length === 0 ? <p className="empty">В сравнении пока нет вариантов. Соберите четыре лота и нажмите «Добавить в сравнение».</p> : <>
      <div className="alternative-actions">{workspace.alternatives.map((item, i) => <article key={item.name}>
        <h3>{item.name}</h3><p>{item.request.selection.map(row => `${row.lot_id} ${row.mode_id}`).join(' · ')}</p>
        <div className="actions"><button onClick={() => onLoad(i)}>Открыть «{item.name}»</button><button className="quiet" onClick={() => onRemove(i)} aria-label={`Удалить ${item.name}`}>Удалить</button></div>
      </article>)}</div>
      {workspace.alternatives.length < 2 && <p className="notice">Для сравнения нужен ещё один полный вариант с другим составом или режимами.</p>}
      {workspace.alternatives.length >= 2 && !computed && <p role="status">Пересчитываем сравнение текущих входов…</p>}
      {workspace.alternatives.length >= 2 && computed && <>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Сравнение альтернатив"><table className="comparison-table">
          <thead><tr><th>Показатель / сценарий</th>{computed.alternatives.map(item => <th key={item.name}>{item.name}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">Состав и режимы</th>{computed.alternatives.map(item => <td key={item.name}>{item.result.original_request.selection.map(row => <div key={row.lot_id}>{row.lot_id} · {lotNames[row.lot_id]} · <b>{row.mode_id}</b></div>)}</td>)}</tr>
            {(['BASE', 'STRESS'] as const).map(scenario => <tr key={scenario}><th scope="row">{scenario}</th>{computed.alternatives.map(item => <td key={item.name}><Status value={item.result.scenarios[scenario].status} />
              <ul>{item.result.scenarios[scenario].diagnostics.filter(check => check.ok === false).map(check => <li key={check.id}>{check.condition}: нарушение {format(check.deficit, 6)} {check.unit}</li>)}</ul>
            </td>)}</tr>)}
            {compareMetrics.map(key => <tr key={key}><th scope="row">{metricNames[key]}<small>{computed.current.units[key]}</small></th>{computed.alternatives.map((item, i) => <td key={item.name}><b>{format(item.result.metrics[key], 6)}</b>{i > 0 && <small>Δ {signed(computed.deltas[i]?.metrics[key])}</small>}</td>)}</tr>)}
            <tr><th scope="row">Группы возможностей</th>{computed.alternatives.map(item => <td key={item.name}>{format(item.result.metrics.capability_set)}</td>)}</tr>
            <tr><th scope="row">Общественное ядро: лоты</th>{computed.alternatives.map(item => <td key={item.name}>{item.result.detail.filter(row => row.public_core).map(row => `${row.lot_id} ${row.mode_id}`).join(', ') || 'Нет'}</td>)}</tr>
            {(['BASE', 'STRESS'] as const).map(scenario => <tr key={`margin-${scenario}`}><th scope="row">Запас C0 · {scenario}<small>млн руб.; отрицательный — превышение</small></th>{computed.alternatives.map(item => <td key={item.name}>{signed(item.result.scenarios[scenario].diagnostics.find(check => check.id === 'c0_limit')?.margin)}</td>)}</tr>)}
          </tbody>
        </table></div>
        <p className="muted">Δ — разница относительно «{computed.alternatives[0].name}», рассчитанная сервером. Знак показывает направление изменения, а не итоговую оценку. Доступ, общественная ценность и денежный поток сопоставляются отдельно.</p>
      </>}
    </>}
  </section>
}
