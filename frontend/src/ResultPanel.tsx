/** The calculation of the manually assembled portfolio: five figures, the budget line and
 *  the nine conditions. Every number and every threshold comes from the server. */
import type { Result, Scenario } from './types'
import { format, indexMetrics, lotNames, mainMetrics, metricCode, metricHints, metricHuman, metricNames, money, signed, unitOf } from './presentation'
import { Callout, Disclosure, Fact, Facts, Kpi, KpiRow } from './ui'

export function ResultPanel({ result, scenario }: { result: Result; scenario: Scenario }) {
  const checks = result.scenarios[scenario].diagnostics
  const budget = checks.find(item => item.id === 'c0_limit')!
  const complete = result.completeness.status === 'COMPLETE'
  const failed = checks.filter(item => item.ok === false)
  return <>
    {!complete && <Callout tone="warn">Выбрано {result.completeness.selected_lots} из {result.completeness.required_lots} лотов.
      Числа промежуточные, ни одно условие ещё не принято.</Callout>}

    <KpiRow>
      {mainMetrics.map(key => <Kpi key={key} label={metricHuman[key] || metricNames[key]} code={metricCode[key]}
        tone={key === 'vpub_mrub_per_year' ? 'accent' : 'plain'} hint={metricHints[key]}
        value={<span data-testid={`metric-${key}`}>{format(result.metrics[key], key === 'kcash' ? 3 : 1)}</span>}
        unit={unitOf(key)} />)}
    </KpiRow>

    <Facts className={`facts-row budget-strip ${budget.ok === false ? 'over-budget' : ''}`} testId="budget-strip">
      <Fact label="Стоимость состава" code="C0" value={money(result.metrics.c0_mrub)} />
      <Fact label={`Лимит ${scenario}`} value={money(budget.limit)} />
      <Fact label={complete ? 'Запас до лимита' : 'Промежуточная разница'} tone={budget.ok === false ? 'fail' : 'pass'} value={signed(budget.margin)} />
    </Facts>

    <Disclosure summary={`Девять условий · ${scenario}`} open={result.scenarios[scenario].status === 'FAIL'}
      note={failed.length ? `${failed.length} нарушено` : complete ? 'все выполнены' : 'не проверены: состав не полон'}>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Девять ограничений">
        <table className="checks-table"><thead><tr><th>Условие</th><th>Порог</th><th>Факт</th><th>Запас</th><th>Статус и действие</th></tr></thead>
          <tbody>{checks.map(check => <tr key={check.id} data-testid={`check-${check.id}`} className={check.ok === false ? 'failed-row' : ''}>
            <th scope="row">{check.condition}<small>{check.unit}</small></th>
            <td>{check.comparator} {format(check.limit, 3)}</td>
            <td title={format(check.fact, 9)}>{format(check.fact, 3)}</td>
            <td><b>{signed(check.margin)}</b>{check.deficit !== null && check.deficit > 0 && <small>нарушение {format(check.deficit, 3)}</small>}</td>
            <td><span className={`check-label ${check.status.toLowerCase()}`}>{check.status === 'NOT_EVALUATED' ? 'не проверено' : check.status === 'PASS' ? 'PASS' : 'FAIL'}</span>
              {check.ok === false && <p>{check.action}</p>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="meta">Решения принимаются до округления, допуск до 10⁻⁹. Пороги и формулы — из сохранённого источника кейса.</p>
    </Disclosure>

    <Disclosure summary="Индексы готовности, устойчивости, масштабируемости">
      <Facts className="facts-row">
        {indexMetrics.map(key => <Fact key={key} label={metricHuman[key] || metricNames[key]} code={metricCode[key]}
          value={format(result.metrics[key], 3)} />)}
      </Facts>
      <p className="meta">Среднее по выбранным лотам. Расшифровка t_rep в кейсе не задана: это безразмерный индекс, не срок окупаемости. Смена A/B/C не меняет исходные индексы.</p>
    </Disclosure>

    <Disclosure summary="Вклад каждого лота и происхождение расчёта">
      <p className="meta">{result.period}</p>
      {result.detail.map(row => <details className="lot-detail" key={row.lot_id}>
        <summary>{row.lot_id} · {lotNames[row.lot_id]} · режим {row.mode_id} · {row.public_core ? 'общественное ядро' : 'вне общественного ядра'}</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`Вклад ${row.lot_id}`}>
          <table><thead><tr><th>Показатель</th><th>Вклад</th><th>Происхождение</th></tr></thead><tbody>
            {[...mainMetrics.filter(key => key !== 'kcash'), 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year', ...indexMetrics].map(key =>
              <tr key={key}><th scope="row">{metricHuman[key] || metricNames[key]}<small>{result.units[key]}</small></th>
                <td>{format(row[key], 3)}</td><td><pre>{JSON.stringify(row.provenance[key], null, 2)}</pre></td></tr>)}
          </tbody></table>
        </div>
      </details>)}
      <p className="meta">Идентификатор входа: {result.input_fingerprint}</p>
      <details><summary>Формулы и хеши источников</summary>
        <pre>{JSON.stringify({ aggregates: Object.fromEntries(mainMetrics.map(key => [key, result.provenance.aggregates[key]?.formula])), source_hashes: result.source_hashes }, null, 2)}</pre>
      </details>
    </Disclosure>
  </>
}
