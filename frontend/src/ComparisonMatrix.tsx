/** Dense side-by-side matrix: the preferred composition against real alternatives on
 *  one configuration and one fixed scale. Deltas for declared strategies come from the
 *  server (delta_to_current_leader); added shortlist columns show the same difference
 *  of the same server metrics. No score is recomputed here. */
import { format, lotNames, metricNames, signed } from './presentation'
import type { Alternative, Candidate } from './decision'
import type { Catalog, Scenario } from './types'

const CRITERIA = ['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'kcash', 't_rep', 'readiness_1_5', 'resilience_1_5', 'scale_1_5']
const MONEY = ['cash_mrub_per_year', 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year']
const LIMITS: { id: string; metric: string; label: string; comparator: '≤' | '≥'; key: string }[] = [
  { id: 'opex_limit', metric: 'opex_mrub_per_year', label: 'OPEX за год', comparator: '≤', key: 'opex_max_mrub_per_year' },
  { id: 'vpub_floor', metric: 'vpub_mrub_per_year', label: 'VPUB за год', comparator: '≥', key: 'vpub_min_mrub_per_year' },
  { id: 'kcash_floor', metric: 'kcash', label: 'KCASH', comparator: '≥', key: 'kcash_min' },
  { id: 't_rep_floor', metric: 't_rep', label: 'Индекс t_rep', comparator: '≥', key: 't_rep_min' },
  { id: 'public_core_lots', metric: 'public_core_lots', label: 'Лоты общественного ядра', comparator: '≥', key: 'min_public_core_lots' },
  { id: 'territorial_archetypes', metric: 'territorial_archetypes', label: 'Территориальные архетипы', comparator: '≥', key: 'min_territorial_archetypes' },
  { id: 'capability_groups', metric: 'capability_groups', label: 'Группы возможностей', comparator: '≥', key: 'min_capability_groups' },
]

export type Column = { candidate: Candidate; title: string; note: string; alternative?: Alternative }

export function ComparisonMatrix({ columns, leader, catalog, directions, scenario, viewedId, appliedId, onView, onOpen, onDrop }: {
  columns: Column[]; leader: Candidate; catalog: Catalog; directions: Record<string, string>; scenario: Scenario
  viewedId: string | null; appliedId: string | null; onView: (id: string | null) => void
  onOpen: (column: Column) => void; onDrop?: (id: string) => void
}) {
  const fieldDirection = Object.fromEntries(Object.entries(directions).map(([key, value]) => [
    { vpub: 'vpub_mrub_per_year', c0: 'c0_mrub', opex: 'opex_mrub_per_year', kcash: 'kcash', t_rep: 't_rep',
      readiness: 'readiness_1_5', resilience: 'resilience_1_5', scale: 'scale_1_5' }[key] as string, value]))
  const delta = (column: Column, field: string) => column.alternative
    ? column.alternative.delta_to_current_leader[field]
    : column.candidate.metrics[field] - leader.metrics[field]
  const verdict = (column: Column, field: string) => {
    if (column.candidate.portfolio_id === leader.portfolio_id) return ''
    const value = delta(column, field)
    if (!Number.isFinite(value) || Math.abs(value) < 1e-12) return 'same'
    const better = fieldDirection[field] === 'minimize' ? value < 0 : value > 0
    return better ? 'win' : 'lose'
  }
  const summary = (column: Column) => {
    const wins: string[] = [], loses: string[] = []
    for (const field of CRITERIA) {
      const state = verdict(column, field)
      if (state === 'win') wins.push(`${shortName(field)} ${signed(delta(column, field))}`)
      else if (state === 'lose') loses.push(`${shortName(field)} ${signed(delta(column, field))}`)
    }
    return { wins, loses }
  }
  const cellProps = (column: Column) => ({
    className: [column.candidate.portfolio_id === leader.portfolio_id ? 'is-leader' : '',
      viewedId === column.candidate.portfolio_id ? 'is-viewed' : '',
      appliedId === column.candidate.portfolio_id ? 'is-applied' : ''].filter(Boolean).join(' '),
    onMouseEnter: () => onView(column.candidate.portfolio_id),
    onMouseLeave: () => onView(null),
  })

  return <div className="table-scroll matrix-scroll" tabIndex={0} role="region" aria-label="Матрица сравнения портфелей">
    <table className="matrix">
      <thead>
        <tr>
          <th scope="row" className="matrix-corner">Показатель<small>{`сценарий ${scenario}`}</small></th>
          {columns.map(column => <th key={column.candidate.portfolio_id} scope="col" {...cellProps(column)}>
            <span className="matrix-role">{column.title}</span>
            <span className="matrix-composition">{column.candidate.selection.map(row => <b key={row.lot_id}>{row.lot_id}<i>{row.mode_id}</i></b>)}</span>
            <small>{column.note}</small>
            {appliedId === column.candidate.portfolio_id && <small className="matrix-flag">открыт в конструкторе</small>}
          </th>)}
        </tr>
      </thead>
      <tbody>
        <tr className="matrix-rank"><th scope="row">Место при текущих весах<small>ранг и score при текущем векторе</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)}>
            {column.alternative && column.alternative.current_profile_rank === null ? <span className="matrix-void">вне допустимых</span>
              : <><b>{column.alternative ? column.alternative.current_profile_rank : column.candidate.rank}</b>
                <small>score {format(column.alternative?.current_profile_score ?? column.candidate.score, 6)}</small></>}
          </td>)}
        </tr>
        {CRITERIA.map(field => <tr key={field}>
          <th scope="row">{metricNames[field]}<small>{catalog.units[field]} · {fieldDirection[field] === 'minimize' ? 'меньше лучше' : 'больше лучше'}</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)} data-verdict={verdict(column, field)}>
            <b>{format(column.candidate.metrics[field], field === 'kcash' || field === 't_rep' ? 4 : 3)}</b>
            {column.candidate.portfolio_id !== leader.portfolio_id && <small className={`delta ${verdict(column, field)}`}>{signed(delta(column, field))}</small>}
          </td>)}
        </tr>)}
        <tr className="matrix-band"><th scope="row" colSpan={columns.length + 1}>Денежные потоки · VPUB отдельно от CASH</th></tr>
        {MONEY.map(field => <tr key={field}>
          <th scope="row">{metricNames[field]}<small>{catalog.units[field]}</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)}>
            <b>{format(column.candidate.metrics[field], 3)}</b>
            {column.candidate.portfolio_id !== leader.portfolio_id && <small className="delta">{signed(delta(column, field))}</small>}
          </td>)}
        </tr>)}
        <tr><th scope="row">CASH − OPEX<small>млн руб./год · диагностика, не прибыль</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)}><b>{format(column.candidate.net_operating_balance, 3)}</b></td>)}
        </tr>
        <tr><th scope="row">Портфельный дефицит<small>млн руб./год · 0 не означает разрешённое перераспределение между лотами</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)}><b>{format(column.candidate.portfolio_funding_gap, 3)}</b><small>сумма дефицитов лотов {format(column.candidate.sum_lot_funding_gaps, 3)}</small></td>)}
        </tr>
        <tr className="matrix-band"><th scope="row" colSpan={columns.length + 1}>Бюджетные лимиты и запас</th></tr>
        {(['BASE', 'STRESS'] as const).map(name => <tr key={name} className={scenario === name ? 'matrix-active-scenario' : ''}>
          <th scope="row">Запас C0 · {name}<small>лимит {format(catalog.scenarios[name].c0_max_mrub)} млн руб.; отрицательный — превышение</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)} data-verdict={column.candidate.scenarios[name].c0_margin < 0 ? 'lose' : ''}>
            <b>{signed(column.candidate.scenarios[name].c0_margin)}</b>
            <small className={`badge ${column.candidate.scenarios[name].status.toLowerCase()}`}>{column.candidate.scenarios[name].status}</small>
          </td>)}
        </tr>)}
        <tr className="matrix-band"><th scope="row" colSpan={columns.length + 1}>Остальные жёсткие условия · факт и официальный порог</th></tr>
        {LIMITS.map(rule => <tr key={rule.id}>
          <th scope="row">{rule.label}<small>{rule.comparator} {format(catalog.constraints_common[rule.key], 6)}</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)} data-verdict={column.candidate.scenarios[scenario].checks?.[rule.id] === false ? 'lose' : ''}>
            <b>{format(column.candidate.metrics[rule.metric], 4)}</b>
            <small className={`badge ${column.candidate.scenarios[scenario].checks?.[rule.id] === false ? 'fail' : 'pass'}`}>{column.candidate.scenarios[scenario].checks?.[rule.id] === false ? 'нарушено' : 'выполнено'}</small>
          </td>)}
        </tr>)}
        <tr><th scope="row">Общественное ядро<small>лоты с public_core</small></th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)}>{column.candidate.public_core_ids.map(id => `${id} · ${lotNames[id]}`).join('; ') || '—'}</td>)}
        </tr>
        <tr className="matrix-verdicts"><th scope="row">Выигрываем / уступаем<small>относительно предпочтительного, по восьми критериям</small></th>
          {columns.map(column => {
            const { wins, loses } = summary(column)
            return <td key={column.candidate.portfolio_id} {...cellProps(column)}>
              {column.candidate.portfolio_id === leader.portfolio_id ? <span className="matrix-void">точка отсчёта</span> : <>
                <p className="win">Выигрывает: {wins.length ? wins.join('; ') : 'ни по одному критерию'}</p>
                <p className="lose">Уступает: {loses.length ? loses.join('; ') : 'ни по одному критерию'}</p>
              </>}
            </td>
          })}
        </tr>
        <tr className="matrix-actions"><th scope="row">Действие</th>
          {columns.map(column => <td key={column.candidate.portfolio_id} {...cellProps(column)}>
            <button type="button" onClick={() => onOpen(column)}>В конструктор</button>
            {onDrop && !column.alternative && column.candidate.portfolio_id !== leader.portfolio_id
              && <button type="button" className="quiet" onClick={() => onDrop(column.candidate.portfolio_id)}>Убрать из сравнения</button>}
          </td>)}
        </tr>
      </tbody>
    </table>
  </div>
}

const shortName = (field: string) => ({
  c0_mrub: 'C0', opex_mrub_per_year: 'OPEX', vpub_mrub_per_year: 'VPUB', kcash: 'KCASH', t_rep: 't_rep',
  readiness_1_5: 'готовность', resilience_1_5: 'устойчивость', scale_1_5: 'масштабируемость',
}[field] || field)
