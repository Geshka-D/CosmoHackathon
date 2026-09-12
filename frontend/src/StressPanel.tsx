import type { Result } from './types'
import { format, signed } from './presentation'
import { Status } from './ResultPanel'

/** All facts and margins come from Python; no duplicated economic arithmetic. */
export function StressPanel({ result, pending, onApply, disabled }: { result?: Result; pending: boolean; onApply: () => void; disabled: boolean }) {
  const complete = result?.completeness.status === 'COMPLETE'
  return <section id="stress" className="panel" aria-labelledby="stress-title" aria-busy={pending}>
    <div className="section-heading"><div><p className="eyebrow">Один состав · два бюджетных лимита</p><h2 id="stress-title">Стресс-сценарий</h2></div><button disabled={disabled} onClick={onApply}>Показать ограничения STRESS</button></div>
    <p>BASE → STRESS сокращает допустимый C0. Стоимость лотов, CASH, OPEX и VPUB у неизменённого состава остаются прежними. Риски поставщика рассматриваются отдельно и не меняют коэффициенты этого сценария.</p>
    {!result ? <p role="status">{pending ? 'Пересчитываем оба сценария для текущего ввода…' : 'Результат скрыт до успешного пересчёта. Исправьте ошибку выше.'}</p> : <>
      {!complete && <p className="notice">Сначала выберите четыре лота. Показанные суммы промежуточные, допустимость пока не установлена.</p>}
      <div className="stress-grid">{(['BASE', 'STRESS'] as const).map(scenario => {
        const budget = result.scenarios[scenario].diagnostics.find(item => item.id === 'c0_limit')!
        return <article className="stress-card" key={scenario} data-testid={`stress-summary-${scenario}`}><h3>{scenario}</h3><Status value={result.scenarios[scenario].status} /><dl>
          <div><dt>Стоимость состава</dt><dd>{format(result.metrics.c0_mrub)} млн руб.</dd></div>
          <div><dt>Лимит C0</dt><dd>{format(budget.limit)} млн руб.</dd></div>
          <div><dt>{complete ? 'Запас (+) / превышение (−)' : 'Промежуточная разница'}</dt><dd>{signed(budget.margin)} млн руб.</dd></div>
        </dl></article>
      })}</div>
      {complete && <p className={result.scenarios.STRESS.status === 'PASS' ? 'notice' : 'error'}>{result.scenarios.STRESS.status === 'PASS' ? 'Текущий состав проходит формальные условия STRESS. Это не подтверждение договоров, доступности поставщиков или достигнутого общественного эффекта.' : 'Текущий состав не проходит STRESS. Откройте ограничения, измените состав или сравните допустимые альтернативы; снижение лимита само по себе не удешевляет портфель.'}</p>}
      <p className="muted">Это проверка текущего ручного состава. Управленческое стресс-решение и отдельный одностраничный PDF сохранённого выпуска находятся в разделе <a href="#implementation">«Реализация и материалы»</a>.</p>
    </>}
  </section>
}
