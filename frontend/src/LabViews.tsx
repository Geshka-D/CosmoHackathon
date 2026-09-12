import { composition } from './decision'
import type { Intelligence, Proposal } from './intelligence'
import type { Catalog, Selection } from './types'
import { format, lotNames, metricNames, signed } from './presentation'

export function BudgetMap({ result, onCap }: { result: Intelligence; onCap: (n: number) => void }) {
  const intervals = result.transition_map, cap = result.budget.cap
  return <div className="budget-map" data-testid="budget-map">
    <div className="section-heading"><div><p className="eyebrow">RESEARCH / точные границы из engine</p><h3>Где решение меняется</h3></div><span>Нажмите интервал, чтобы исследовать его нижний C0</span></div>
    <p>Каждый сегмент — один предпочтительный состав. Ширина сегментов условная; реальные границы указаны числами. Все остальные ограничения и locks сохраняются.</p>
    <div className="transition-stations">
      <button className="no-solution-station" aria-pressed={result.status === 'NO_SOLUTION'} onClick={() => onCap(Math.max(0, (result.budget.minimum_feasible_budget ?? 1) - 1))}>
        <b>Нет решения</b><small>{result.budget.minimum_feasible_budget === null ? 'Даже без C0 cap' : `Ниже C0 ${format(result.budget.minimum_feasible_budget)}*`}</small></button>
      {intervals.map((t, i) => <button key={t.portfolio_id + t.lower_inclusive} aria-pressed={cap >= t.lower_inclusive && (t.upper_exclusive === null || cap < t.upper_exclusive)} onClick={() => onCap(t.economic_breakpoint_c0)}>
        <small>Переход {i + 1} · C0</small><strong>{format(t.economic_breakpoint_c0)}</strong>
        <span>{composition(t.request.selection)}</span><small>VPUB {format(t.metrics.vpub_mrub_per_year)}</small>
      </button>)}
    </div>
    <small>* Численный допуск {result.budget.eps}; точные интервалы с учётом допуска — в таблице Portfolio Transition Map. Порог не оценивается по шагам slider.</small>
  </div>
}

export function RecoveryDiff({ proposal, before, catalog, onApply, onCompare }: {
  proposal: Proposal; before: Selection[]; catalog: Catalog; onApply?: () => void; onCompare: () => void
}) {
  const p = proposal, after = p.candidate.selection
  const removed = before.filter(r => !after.some(a => a.lot_id === r.lot_id))
  const added = after.filter(r => !before.some(a => a.lot_id === r.lot_id))
  const title = removed.length === 1 && added.length === 1 ? `${removed[0].lot_id} ${removed[0].mode_id} → ${added[0].lot_id} ${added[0].mode_id}`
    : p.changes.unchanged ? 'Состав сохраняется' : p.changes.mode_changes.length && !removed.length
      ? p.changes.mode_changes.map(c => `${c.lot_id} ${c.from} → ${c.to}`).join(' · ') : 'Изменение набора сервисов'
  return <div className="recovery-diff" data-testid="recovery-diff">
    <h4>{title}</h4>
    <div className="recovery-sides">{[{ label: 'Исходный портфель', rows: before, other: after }, { label: 'Допустимая корректировка', rows: after, other: before }].map((side, i) =>
      <div key={side.label}><span className="eyebrow">{side.label}</span><ul>{side.rows.map(row => {
        const changed = !side.other.some(r => r.lot_id === row.lot_id && r.mode_id === row.mode_id)
        return <li key={row.lot_id} data-changed={changed}><b>{row.lot_id} {row.mode_id}</b><span>{lotNames[row.lot_id]}</span>{changed && <small>{i ? 'Новый сервис / режим' : 'Будет изменён'}</small>}</li>
      })}</ul></div>)}</div>
    <div className="recovery-deltas">{['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year', 'kcash'].map(k =>
      <div key={k}><small>Δ {metricNames[k]}</small><b>{signed(p.delta[k])}</b><small>{catalog.units[k]}</small></div>)}</div>
    <p className="muted">Δ — корректировка минус исходный портфель. Изменение C0 не является стоимостью перехода. Новый сервис означает другую потребность; эффект не считается достигнутым.</p>
    <div className="actions"><button onClick={onCompare}>Сравнить корректировку</button>
      {onApply && <button onClick={onApply}>Применить корректировку в конструкторе</button>}</div>
  </div>
}
