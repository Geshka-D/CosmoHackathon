import { composition } from './decision'
import type { Intelligence, Proposal } from './intelligence'
import type { Catalog, Selection } from './types'
import { format, lotNames, metricHuman, money, signed, unitOf } from './presentation'
import { Tip } from './ui'

/** Where the preferred composition changes as the budget moves. Widths are schematic;
 *  the real boundaries are the numbers. */
export function BudgetMap({ result, onCap }: { result: Intelligence; onCap: (value: number) => void }) {
  const intervals = result.transition_map, cap = result.budget.cap
  return <div className="budget-map" data-testid="budget-map">
    <p className="meta">Каждый сегмент — один предпочтительный состав. Нажатие исследует его нижнюю границу C0.
      <Tip label="О сегментах">Ширина сегментов условная; реальные границы указаны числами. Все остальные ограничения и обязательные сервисы сохраняются.
        Численный допуск {result.budget.eps}; точные интервалы — в таблице «Где меняется решение».</Tip>
    </p>
    <div className="transition-stations">
      <button type="button" className="no-solution-station" aria-pressed={result.status === 'NO_SOLUTION'}
        onClick={() => onCap(Math.max(0, (result.budget.minimum_feasible_budget ?? 1) - 1))}>
        <strong>Нет решения</strong>
        <small>{result.budget.minimum_feasible_budget === null ? 'даже без лимита' : `ниже C0 ${format(result.budget.minimum_feasible_budget)}`}</small>
      </button>
      {intervals.map((row, index) => <button key={row.portfolio_id + row.lower_inclusive} type="button"
        aria-pressed={cap >= row.lower_inclusive && (row.upper_exclusive === null || cap < row.upper_exclusive)}
        onClick={() => onCap(row.economic_breakpoint_c0)}>
        <small>Переход {index + 1} · C0</small>
        <strong>{format(row.economic_breakpoint_c0)}</strong>
        <span>{composition(row.request.selection)}</span>
        <small>VPUB {format(row.metrics.vpub_mrub_per_year, 0)}</small>
      </button>)}
    </div>
  </div>
}

/** Before → after, and the price of the move. ΔC0 is not a transition cost. */
export function RecoveryDiff({ proposal, before, catalog, onApply, onCompare }: {
  proposal: Proposal; before: Selection[]; catalog: Catalog; onApply?: () => void; onCompare: () => void
}) {
  const after = proposal.candidate.selection
  const removed = before.filter(row => !after.some(item => item.lot_id === row.lot_id))
  const added = after.filter(row => !before.some(item => item.lot_id === row.lot_id))
  const title = removed.length === 1 && added.length === 1 ? `${removed[0].lot_id} ${removed[0].mode_id} → ${added[0].lot_id} ${added[0].mode_id}`
    : proposal.changes.unchanged ? 'Состав сохраняется'
      : proposal.changes.mode_changes.length && !removed.length
        ? proposal.changes.mode_changes.map(change => `${change.lot_id} ${change.from} → ${change.to}`).join(' · ')
        : 'Изменение набора сервисов'
  return <div className="recovery-diff" data-testid="recovery-diff">
    <p className="object-title">{title}</p>
    <div className="recovery-sides">{[{ label: 'Было', rows: before, other: after }, { label: 'Стало', rows: after, other: before }].map((side, index) =>
      <div key={side.label}>
        <p className="object-role">{side.label}</p>
        <ul>{side.rows.map(row => {
          const changed = !side.other.some(item => item.lot_id === row.lot_id && item.mode_id === row.mode_id)
          return <li key={row.lot_id} data-changed={changed}><b>{row.lot_id} {row.mode_id}</b><span>{lotNames[row.lot_id]}</span>
            {changed && <small>{index ? 'новый сервис или режим' : 'будет изменён'}</small>}</li>
        })}</ul>
      </div>)}</div>
    <div className="recovery-deltas">{['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year', 'kcash'].map(field =>
      <div key={field}>
        <small>Δ {metricHuman[field] || field}</small>
        <b>{signed(proposal.delta[field])}</b>
        <small>{unitOf(field) || catalog.units[field]}</small>
      </div>)}</div>
    <p className="meta">Δ — корректировка минус исходный состав. Изменение C0 не является стоимостью перехода; новый сервис означает другую потребность.
      Сумма адресных дефицитов {money(proposal.candidate.sum_lot_funding_gaps, 'млн ₽/год')}.</p>
    <div className="actions">
      <button type="button" onClick={onCompare}>Сравнить корректировку</button>
      {onApply && <button type="button" className="primary" onClick={onApply}>Применить в конструкторе</button>}
    </div>
  </div>
}
