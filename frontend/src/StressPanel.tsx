/** STRESS as a managerial condition, not a second ranking stage. All facts and margins
 *  come from Python; the panel never reduces a portfolio's cost to the new cap and never
 *  calls the C0 difference a transition cost or a refund. */
import { useState } from 'react'
import type { Result, RequestInput, Scenario } from './types'
import type { Candidate } from './decision'
import type { DecisionState } from './useDecision'
import { format, signed } from './presentation'
import { composition, differenceCount, plural, portfolioId } from './decision'
import { Status } from './ResultPanel'

const RAW = [
  ['c0_mrub', 'C0 · запуск', 'млн руб.'], ['opex_mrub_per_year', 'OPEX · год', 'млн руб./год'],
  ['vpub_mrub_per_year', 'VPUB · год', 'синтет. млн руб./год'], ['cash_mrub_per_year', 'CASH · год', 'млн руб./год'],
  ['kcash', 'KCASH', 'отношение'], ['t_rep', 't_rep', 'индекс'], ['readiness_1_5', 'Готовность', '1–5'],
  ['resilience_1_5', 'Устойчивость', '1–5'], ['scale_1_5', 'Масштабируемость', '1–5'],
] as const

export function StressPanel({ result, pending, onApply, disabled, decision, currentRequest, currentName, onLoad }: {
  result?: Result; pending: boolean; onApply: () => void; disabled: boolean; decision: DecisionState
  currentRequest: RequestInput; currentName: string; onLoad: (name: string, request: RequestInput) => void
}) {
  const [preview, setPreview] = useState<Candidate | null>(null)
  const [previous, setPrevious] = useState<{ name: string; request: RequestInput } | null>(null)
  const complete = result?.completeness.status === 'COMPLETE'
  const stressOk = result?.scenarios.STRESS.status === 'PASS'
  const budget = (scenario: Scenario) => result?.scenarios[scenario].diagnostics.find(item => item.id === 'c0_limit')
  const base = budget('BASE'), stress = budget('STRESS')
  const cost = typeof result?.metrics.c0_mrub === 'number' ? result.metrics.c0_mrub : 0
  const scenarioSensitive = !result ? [] : result.scenarios.BASE.diagnostics
    .filter(item => { const twin = result.scenarios.STRESS.diagnostics.find(other => other.id === item.id); return twin && twin.limit !== item.limit })
    .map(item => item.condition)
  const failing = !result ? [] : result.scenarios.STRESS.diagnostics.filter(item => item.ok === false)
  const currentId = portfolioId(currentRequest.selection)
  const leader = decision.result?.search.ranking[0]
  const candidates = (decision.result?.search.ranking || []).filter(row => row.scenarios.STRESS.ok && row.portfolio_id !== currentId)

  return <section id="stress" className="panel stress" aria-labelledby="stress-title" aria-busy={pending}>
    <div className="section-heading">
      <div><p className="eyebrow">Один состав · два бюджетных лимита</p><h2 id="stress-title">Стресс-сценарий</h2></div>
      <button type="button" disabled={disabled} onClick={onApply}>Показать ограничения STRESS</button>
    </div>
    <p>BASE и STRESS — разные условия для одного и того же состава, а не две стадии ранжирования. Меняется допустимый C0; стоимость лотов, CASH, OPEX и VPUB неизменённого состава остаются прежними. Риски поставщика рассматриваются отдельно и не меняют коэффициенты этого сценария.</p>
    {!result ? <p role="status">{pending ? 'Пересчитываем оба сценария для текущего ввода…' : 'Результат скрыт до успешного пересчёта. Исправьте ошибку выше.'}</p> : <>
      {!complete && <p className="notice">Сначала выберите четыре лота. Показанные суммы промежуточные, допустимость пока не установлена.
        {leader && <> <button type="button" className="quiet" disabled={disabled} onClick={() => onLoad(`Предпочтительный ${decision.scenario}`, { schema_version: currentRequest.schema_version, case_id: currentRequest.case_id, case_version: currentRequest.case_version, selection: leader.selection })}>Открыть предпочтительный состав</button></>}
      </p>}

      {base && stress && <BudgetAxis cost={cost} base={base.limit} stress={stress.limit} complete={complete} ok={stress.ok !== false} />}

      <div className="stress-grid">{(['BASE', 'STRESS'] as const).map(scenario => {
        const value = budget(scenario)!
        return <article className="stress-card" key={scenario} data-testid={`stress-summary-${scenario}`} data-scenario={scenario}>
          <h3>{scenario}</h3><Status value={result.scenarios[scenario].status} />
          <dl>
            <div><dt>Стоимость состава</dt><dd>{format(result.metrics.c0_mrub)} млн руб.</dd></div>
            <div><dt>Лимит C0</dt><dd>{format(value.limit)} млн руб.</dd></div>
            <div><dt>{complete ? 'Запас (+) / превышение (−)' : 'Промежуточная разница'}</dt><dd>{signed(value.margin)} млн руб.</dd></div>
          </dl>
        </article>
      })}</div>

      {complete && <div className={`stress-verdict ${stressOk ? 'holds' : 'breaks'}`}>
        {stressOk ? <>
          <h3>Состав сохраняется</h3>
          <p>Запас стартового бюджета — <b>{format(stress!.margin)} млн руб.</b> в условиях STRESS. Стоимость состава остаётся {format(cost)} млн руб.: снижение лимита не удешевляет портфель и не требует сокращать состав до нового лимита.</p>
          <p className="muted">Устойчив в границах этого сценария STRESS (лимит C0 {format(stress!.limit)} млн руб.). Это не общий вывод об устойчивости и не подтверждение договоров, доступности поставщиков или достигнутого общественного эффекта.</p>
        </> : <>
          <h3>Состав не проходит STRESS</h3>
          {failing.map(item => <p key={item.id}><b>{item.condition}:</b> факт {format(item.fact, 6)} {item.unit} при условии {item.comparator} {format(item.limit, 6)}; нарушение {format(item.deficit, 6)} {item.unit}. {item.action}</p>)}
          <p className="muted">Разница C0 — это только превышение лимита. Модель не содержит переходных затрат, штрафов, сроков и уже потраченных средств, поэтому её нельзя называть полной стоимостью перехода или возвратом денег.</p>
        </>}
        {scenarioSensitive.length > 0 && <p className="muted">Из девяти условий сценарий меняет только: {scenarioSensitive.join(', ')}. Остальные пороги общие для BASE и STRESS.</p>}
      </div>}

      {complete && !stressOk && <div className="stress-actions">
        <h3>Допустимые в STRESS составы из расчёта</h3>
        <p>Ниже — варианты текущего шортлиста, которые сервер отметил допустимыми в STRESS. Заявленное правило метода выбирает <b>лучшего по score</b>; задача «минимально изменить состав» с обязательными сервисами решается в разделе «Budget Lab / Recovery». Колонка «отличие состава» — точное сравнение наборов лотов и режимов, а не оценка близости.</p>
        {candidates.length === 0
          ? <p className="empty">В текущем шортлисте нет допустимых в STRESS составов. Переключите сценарий поиска на STRESS в разделе «Приоритеты», чтобы сервер ранжировал все допустимые в STRESS варианты.</p>
          : <div className="table-scroll" tabIndex={0} role="region" aria-label="Допустимые в STRESS кандидаты">
            <table><thead><tr><th>Состав</th><th>Место по score</th><th>C0<small>млн руб.</small></th><th>Запас STRESS<small>млн руб.</small></th><th>Отличие состава</th><th>Действие</th></tr></thead>
              <tbody>{candidates.map(row => {
                const diff = differenceCount(currentRequest.selection, row.selection)
                return <tr key={row.portfolio_id} className={preview?.portfolio_id === row.portfolio_id ? 'is-preview' : ''}>
                  <th scope="row">{composition(row.selection)}</th>
                  <td>{row.rank}<small>score {format(row.score, 6)}</small></td>
                  <td>{format(row.metrics.c0_mrub)}</td>
                  <td>{signed(row.scenarios.STRESS.c0_margin)}</td>
                  <td>{diff.total === 0 ? 'совпадает' : `${plural(diff.lots, 'лот', 'лота', 'лотов')}, ${plural(diff.modes, 'режим', 'режима', 'режимов')}`}</td>
                  <td><button type="button" onClick={() => setPreview(preview?.portfolio_id === row.portfolio_id ? null : row)}
                    aria-expanded={preview?.portfolio_id === row.portfolio_id}>Предпросмотр</button></td>
                </tr>
              })}</tbody></table>
          </div>}
      </div>}

      {preview && <div className="stress-preview" aria-live="polite">
        <div className="section-heading"><h3>Предпросмотр: {composition(preview.selection)}</h3><span>Текущий состав не изменён</span></div>
        <p>Сравнение исходных показателей сервера. Предпросмотр ничего не применяет: конструктор и сохранённые материалы остаются прежними, пока вы не нажмёте «Применить состав».</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Показатели до и после предпросмотра">
          <table><thead><tr><th>Показатель</th><th>Сейчас</th><th>В предпросмотре</th><th>Разница</th></tr></thead>
            <tbody>{RAW.map(([field, label, unit]) => {
              const before = typeof result.metrics[field] === 'number' ? result.metrics[field] as number : NaN
              const after = preview.metrics[field]
              return <tr key={field}><th scope="row">{label}<small>{unit}</small></th>
                <td>{format(before, 6)}</td><td>{format(after, 6)}</td>
                <td>{Number.isFinite(before) ? signed(after - before) : '—'}</td></tr>
            })}
              <tr><th scope="row">Запас C0 · STRESS<small>млн руб.</small></th><td>{signed(stress?.margin)}</td><td>{signed(preview.scenarios.STRESS.c0_margin)}</td><td>—</td></tr>
            </tbody></table>
        </div>
        <p className="muted">Разница C0 показывает только изменение стартовой суммы состава. Она не является выручкой, возвратом средств, погашенным дефицитом или разрешённым перераспределением между лотами.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => {
            setPrevious({ name: currentName, request: structuredClone(currentRequest) })
            onLoad(`STRESS-допустимый · место ${preview.rank}`, { schema_version: currentRequest.schema_version, case_id: currentRequest.case_id, case_version: currentRequest.case_version, selection: preview.selection })
            setPreview(null)
          }}>Применить состав</button>
          <button type="button" className="quiet" onClick={() => setPreview(null)}>Отменить предпросмотр</button>
        </div>
      </div>}

      {previous && <p className="notice stress-restore">Состав заменён из этого раздела: «{previous.name}» → текущий. <button type="button" className="quiet" onClick={() => { onLoad(previous.name, structuredClone(previous.request)); setPrevious(null) }}>Вернуть прежний состав</button></p>}

      <p className="muted">Это проверка текущего ручного состава. Управленческое стресс-решение и отдельный одностраничный PDF сохранённого выпуска находятся в разделе <a href="#implementation">«Реализация и материалы»</a>.</p>
    </>}
  </section>
}

/** One shared axis: the cost stays put while the cap moves between the two conditions. */
function BudgetAxis({ cost, base, stress, complete, ok }: { cost: number; base: number; stress: number; complete: boolean; ok: boolean }) {
  const min = Math.min(cost, stress) * 0.985, max = Math.max(cost, base) * 1.012
  const at = (value: number) => `${((value - min) / (max - min)) * 100}%`
  return <div className={`budget-axis ${ok ? '' : 'over'}`} role="img"
    aria-label={`Стоимость состава ${format(cost)} млн руб.; лимит BASE ${format(base)}; лимит STRESS ${format(stress)} млн руб.`}>
    <div className="budget-axis-track">
      <span className="budget-axis-fill" style={{ width: at(cost) }} />
      <span className="budget-axis-cap base" style={{ left: at(base) }}><small>BASE {format(base)}</small></span>
      <span className="budget-axis-cap stress" style={{ left: at(stress) }}><small>STRESS {format(stress)}</small></span>
      <span className="budget-axis-cost" style={{ left: at(cost) }}><small>состав {format(cost)}</small></span>
    </div>
    <p>{complete ? 'Стоимость состава не меняется между условиями. Двигается только граница допустимого C0.' : 'Промежуточные значения: состав ещё не полон.'}</p>
  </div>
}
