import type { Result, Scenario } from './types'
import { format, indexMetrics, lotNames, mainMetrics, metricNames, signed } from './presentation'

export function Status({ value }: { value: string }) {
  const label = value === 'PASS' ? 'PASS · условия выполнены' : value === 'FAIL' ? 'FAIL · есть нарушения' : 'Не завершён'
  return <span className={`status ${value.toLowerCase()}`}>{label}</span>
}

export function ResultPanel({ result, scenario }: { result: Result; scenario: Scenario }) {
  const checks = result.scenarios[scenario].diagnostics
  const budget = checks.find(item => item.id === 'c0_limit')!
  const complete = result.completeness.status === 'COMPLETE'
  return <>
    <div className="result-heading">
      <div><p className="eyebrow">Расчёт текущего состава · {scenario}</p><h2>Цена и ограничения</h2></div>
      <Status value={result.scenarios[scenario].status} />
    </div>
    {!complete && <p className="notice">Выбрано {result.completeness.selected_lots} из {result.completeness.required_lots} лотов. Числа — промежуточные; ни одно условие ещё не принято.</p>}
    <div className="metric-grid">
      {mainMetrics.map(key => <article className={`metric ${key === 'vpub_mrub_per_year' ? 'public-value' : ''}`} key={key} data-testid={`metric-${key}`}>
        <h3>{metricNames[key]}</h3><strong title={format(result.metrics[key], 9)}>{format(result.metrics[key], key === 'kcash' ? 6 : 3)}</strong>
        <span>{result.units[key]}</span>
        <details><summary>Формула и источник</summary><p className="formula">{result.provenance.aggregates[key].formula}</p>
          <p className="source">{result.provenance.aggregates[key].formula_source}</p>
          <ul>{result.provenance.aggregates[key].contributors.map((item, i) => <li key={i}><code>{JSON.stringify(item)}</code></li>)}</ul>
        </details>
      </article>)}
    </div>
    <div className="financial-note">
      <p><b>CASH:</b> якорный {format(result.metrics.anchor_cash_mrub_per_year)} + коммерческий {format(result.metrics.commercial_cash_mrub_per_year)} млн руб./год. KCASH — отношение сумм CASH/OPEX, не прибыльность.</p>
      <p><b>VPUB:</b> отдельная синтетическая общественная ценность; она не оплачивает OPEX и не складывается с CASH.</p>
    </div>
    <div className={`budget-strip ${budget.ok === false ? 'over-budget' : ''}`} data-testid="budget-strip">
      <div><span>Стоимость состава</span><strong>{format(result.metrics.c0_mrub)} <small>млн руб.</small></strong></div>
      <span className="budget-divider" aria-hidden="true">/</span>
      <div><span>Лимит {scenario}</span><strong>{format(budget.limit)} <small>млн руб.</small></strong></div>
      <div><span>{complete ? 'Запас (+) / превышение (−)' : 'Промежуточная разница с лимитом'}</span><strong>{signed(budget.margin)} <small>млн руб.</small></strong></div>
      <p>BASE → STRESS меняет лимит. Стоимость того же состава остаётся прежней.</p>
    </div>
    <div className="section-heading"><h3>Девять условий · {scenario}</h3><span>Решения до округления · допуск до 10⁻⁹</span></div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Девять ограничений">
      <table className="checks-table"><thead><tr><th>Условие</th><th>Лимит</th><th>Факт</th><th>Запас / нарушение</th><th>Статус и действие</th></tr></thead>
        <tbody>{checks.map(check => <tr key={check.id} data-testid={`check-${check.id}`} className={check.ok === false ? 'failed-row' : ''}>
          <th scope="row">{check.condition}<small>{check.unit}</small>
            <details><summary>Источник порога</summary><p className="source">{check.limit_source.file}{check.limit_source.pointer}</p><p className="source">{check.formula_source}</p><p>Допуск: {check.eps}</p></details>
          </th>
          <td>{check.comparator} {format(check.limit, 6)}</td><td title={format(check.fact, 9)}>{format(check.fact, 6)}</td>
          <td><b>{signed(check.margin)}</b>{check.deficit !== null && check.deficit > 0 && <small>Нарушение: {format(check.deficit, 9)}</small>}{check.tolerance_accepted && <small>Принято в пределах допуска</small>}</td>
          <td><span className={`check-label ${check.status.toLowerCase()}`}>{check.status === 'NOT_EVALUATED' ? 'Не проверено' : check.status === 'PASS' ? '✓ PASS' : '× FAIL'}</span><p>{check.action}</p></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="index-grid">{indexMetrics.map(key => <div key={key}><span>{metricNames[key]}</span><strong>{format(result.metrics[key], 6)}</strong><small>{result.units[key]} · среднее по выбранным лотам</small></div>)}</div>
    <p className="muted">Расшифровка t_rep в кейсе не задана. Это безразмерный индекс, не срок окупаемости. Смена A/B/C не меняет исходные индексы.</p>
    <details className="disclosure"><summary>Вклад каждого лота и происхождение расчёта</summary>
      <p>{result.period}</p>
      {result.detail.map(row => <details className="lot-detail" key={row.lot_id}><summary>{row.lot_id} · {lotNames[row.lot_id]} · режим {row.mode_id} · {row.public_core ? 'общественное ядро' : 'вне общественного ядра'}</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`Вклад ${row.lot_id}`}><table><thead><tr><th>Показатель</th><th>Вклад</th><th>Происхождение</th></tr></thead><tbody>
          {[...mainMetrics.filter(key => key !== 'kcash'), 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year', ...indexMetrics].map(key => <tr key={key}><th scope="row">{metricNames[key]}<small>{result.units[key]}</small></th><td>{format(row[key], 6)}</td><td><pre>{JSON.stringify(row.provenance[key], null, 2)}</pre></td></tr>)}
        </tbody></table></div>
      </details>)}
      <p className="source">Идентификатор входа: {result.input_fingerprint}</p>
      <details><summary>Хеши сохранённых источников</summary><pre>{JSON.stringify(result.source_hashes, null, 2)}</pre></details>
    </details>
  </>
}
