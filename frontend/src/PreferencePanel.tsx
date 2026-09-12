/** Preference controls. The weight vector is sent to the existing decision API and the
 *  applied (normalised) share comes back from it; nothing is ranked or normalised here.
 *  Only the two profiles that exist in the declared method are offered as presets. */
import { useRef } from 'react'
import { format } from './presentation'
import { composition } from './decision'
import type { DecisionState } from './useDecision'
import type { RequestInput, Scenario } from './types'

const meaning: Record<string, { title: string; hint: string }> = {
  vpub: { title: 'Общественная ценность за год', hint: 'Синтетическая VPUB кейса. Не деньги и не выручка.' },
  c0: { title: 'Экономия стартовых затрат', hint: 'Единовременный C0 при запуске.' },
  opex: { title: 'Экономия годовой эксплуатации', hint: 'OPEX устойчивой эксплуатации.' },
  kcash: { title: 'Покрытие эксплуатации потоком', hint: 'KCASH — отношение сумм CASH/OPEX, не прибыльность.' },
  t_rep: { title: 'Заданный индекс t_rep', hint: 'Безразмерный индекс кейса; расшифровка не задана, это не окупаемость.' },
  readiness: { title: 'Готовность', hint: 'Индекс 1–5, среднее по выбранным лотам.' },
  resilience: { title: 'Устойчивость', hint: 'Индекс 1–5, среднее по выбранным лотам.' },
  scale: { title: 'Масштабируемость', hint: 'Индекс 1–5, среднее по выбранным лотам.' },
}

export function PreferencePanel({ decision, currentRequest, exploratory }: {
  decision: DecisionState; currentRequest: RequestInput; exploratory: boolean
}) {
  const upload = useRef<HTMLInputElement>(null)
  const { method, draft, result, busy, valid, scenario, limit, baseline } = decision
  if (!method || !draft) return null
  const applied = result?.search.weights.applied
  const order = Object.keys(method.field_mapping).sort((a, b) => (method.weights[b] - method.weights[a]) || (a < b ? -1 : 1))

  return <div id="preferences" className="preferences">
    <div className="section-heading">
      <div><h3>Приоритеты заказчика</h3><p className="muted">Вес — относительная важность критерия. Вектор нормируется целиком: применяется доля веса в сумме всех восьми, поэтому абсолютные числа значения не имеют.</p></div>
      <div className="preference-mode">
        <span className={exploratory ? 'chip chip-draft' : 'chip'}>{exploratory ? 'Исследовательский режим' : 'Объявленный профиль'}</span>
        <small>{exploratory ? 'Веса изменены вручную. Утверждённое решение, документы и выпуск не меняются.' : 'Веса совпадают с объявленным профилем.'}</small>
      </div>
    </div>

    <div className="weight-rows">{order.map(key => {
      const share = applied?.[key]
      const numeric = Number(draft[key])
      return <div className="weight-row" key={key}>
        <div className="weight-name"><b>{meaning[key]?.title || key}</b><small>{key} · {method.directions[key] === 'minimize' ? 'меньше — предпочтительнее' : 'больше — предпочтительнее'}. {meaning[key]?.hint}</small></div>
        <input className="weight-slider" type="range" min="0" max={Math.max(1, Number.isFinite(numeric) ? numeric : 1)} step="0.005" disabled={busy}
          aria-label={`Ползунок веса ${key}`} value={Number.isFinite(numeric) ? numeric : 0}
          onChange={event => decision.setWeight(key, event.target.value)} />
        <input className="weight-number" type="number" min="0" step="any" aria-label={`Вес ${key}`} value={draft[key]} disabled={busy}
          onChange={event => decision.setWeight(key, event.target.value)} />
        <div className="weight-applied">
          <span className="weight-bar" aria-hidden="true"><i style={{ width: `${(share ?? 0) * 100}%` }} /></span>
          <span className="weight-share" data-testid={`applied-${key}`} data-value={share}>{share === undefined ? '—' : `${format(share * 100, 1)} %`}</span>
          <small>объявлено M0: {format(method.weights[key])}</small>
        </div>
      </div>
    })}</div>
    {!valid && <p className="field-error" role="alert">Все восемь весов должны быть конечными и неотрицательными; хотя бы один — больше нуля.</p>}

    <div className="preference-actions actions">
      <button type="button" disabled={busy} onClick={() => decision.setWeights(method.weights)}>Веса M0</button>
      <button type="button" disabled={busy} onClick={() => decision.setWeights(method.equal_weight_profile)}>Равные веса</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => {
        decision.setWeights(method.weights); decision.setScenario('BASE'); decision.setLimit(10); decision.setBaseline(null)
      }}>Сбросить конфигурацию поиска</button>
      <label>Сценарий поиска<select aria-label="Сценарий поиска" disabled={busy} value={scenario}
        onChange={event => decision.setScenario(event.target.value as Scenario)}><option>BASE</option><option>STRESS</option></select></label>
      <label>Размер шортлиста<select aria-label="Размер шортлиста" disabled={busy} value={limit}
        onChange={event => decision.setLimit(Number(event.target.value))}>{[10, 25, 50].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="button" disabled={busy || !result} onClick={() => void decision.exportFile()}>Скачать JSON выбора</button>
      <button type="button" disabled={busy} onClick={() => upload.current?.click()}>Импорт выбора</button>
      <input hidden ref={upload} type="file" accept=".json,application/json" aria-label="Файл JSON выбора"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void decision.importFile(file) }} />
    </div>

    {result && <div className="preference-effect">
      <div><span>Лидер при этом векторе</span><b>{composition(result.search.ranking[0].selection)}</b>
        <small>score {format(result.search.ranking[0].score, 6)}{result.search.ranking.length > 1 && Math.abs(result.search.ranking[0].score - result.search.ranking[1].score) < 1e-12
          ? ' · ничья по неокруглённому score, порядок разрешён правилом: меньший C0, затем лексикографический состав'
          : result.search.ranking.length > 1 ? ` · отрыв от второго места ${format(result.search.ranking[0].score - result.search.ranking[1].score, 6)}` : ''}</small></div>
      <div><span>Исходный портфель для sensitivity</span><b>{composition(result.sensitivity.original_choice.selection)}</b>
        <small>{result.sensitivity.original_choice.portfolio_id === result.search.ranking[0].portfolio_id
          ? 'совпадает с текущим лидером'
          : `место при текущем векторе: ${result.sensitivity.original_choice.rank}; рекомендация сместилась относительно этого снимка`}</small></div>
      <div><span>Смена лидера при ±20 %</span><b>{result.sensitivity.runs.filter(run => !run.selection_changes.unchanged).length} из {result.sensitivity.runs.length}</b>
        <small>локальная проверка двух весов, не гарантия полной устойчивости</small></div>
    </div>}

    <div className="preference-scope">
      <p><b>Область анализа.</b> {result
        ? `${result.search.ranked_count} составов, допустимых в ${scenario}; показаны первые ${result.search.ranking.length}. Шкала нормирования критериев зафиксирована по ${result.search.reference_population.size} BASE-допустимым вариантам и не меняется при STRESS и при сравнении.`
        : 'Рассчитывается на сервере.'}</p>
      <p className="muted">{method.score_interpretation}</p>
    </div>

    <div className="access-note">
      <b>Исходное решение для чувствительности</b>
      <p>{baseline ? `Зафиксирован ручной состав: ${baseline.selection.map(row => `${row.lot_id} ${row.mode_id}`).join(' · ')}. Последующие правки конструктора не меняют этот снимок.`
        : 'Лидер текущего профиля и сценария. Ручной состав не выбран как исходное решение для sensitivity.'}</p>
      <div className="actions">
        <button type="button" disabled={busy || currentRequest.selection.length !== 4} onClick={() => decision.setBaseline(structuredClone(currentRequest))}>Использовать ручной состав для sensitivity</button>
        <button type="button" disabled={busy} onClick={() => decision.setBaseline(null)}>Использовать лидера для sensitivity</button>
      </div>
    </div>
  </div>
}
