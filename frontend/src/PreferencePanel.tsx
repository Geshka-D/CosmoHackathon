/** Preference controls. The weight vector is sent to the existing decision API and the
 *  applied (normalised) share comes back from it; nothing is ranked or normalised here.
 *  One compact row per criterion; everything that is not a priority lives under «Ещё». */
import { useRef } from 'react'
import { format } from './presentation'
import { composition } from './decision'
import { Disclosure, Tip } from './ui'
import type { DecisionState } from './useDecision'
import type { RequestInput } from './types'

const meaning: Record<string, { title: string; hint: string }> = {
  vpub: { title: 'Общественная ценность', hint: 'Синтетическая VPUB кейса за год. Не деньги и не выручка.' },
  c0: { title: 'Стартовые затраты', hint: 'Единовременный C0 при запуске: чем ниже, тем предпочтительнее.' },
  opex: { title: 'Годовая эксплуатация', hint: 'OPEX устойчивой эксплуатации: чем ниже, тем предпочтительнее.' },
  kcash: { title: 'Денежное покрытие', hint: 'KCASH — отношение сумм CASH/OPEX, не прибыльность.' },
  t_rep: { title: 'Заданный индекс', hint: 'Безразмерный индекс кейса t_rep; расшифровка не задана, это не окупаемость.' },
  readiness: { title: 'Готовность', hint: 'Индекс 1–5, среднее по выбранным лотам.' },
  resilience: { title: 'Устойчивость', hint: 'Индекс 1–5, среднее по выбранным лотам.' },
  scale: { title: 'Масштабируемость', hint: 'Индекс 1–5, среднее по выбранным лотам.' },
}

export function PreferencePanel({ decision, currentRequest, exploratory }: {
  decision: DecisionState; currentRequest: RequestInput; exploratory: boolean
}) {
  const upload = useRef<HTMLInputElement>(null)
  const { method, draft, result, busy, valid, limit, baseline } = decision
  if (!method || !draft) return null
  const applied = result?.search.weights.applied
  const order = Object.keys(method.field_mapping).sort((a, b) => (method.weights[b] - method.weights[a]) || (a < b ? -1 : 1))

  return <div id="preferences" className="preferences">
    <div className="preferences-head">
      <h2 className="block-title">Приоритеты</h2>
      {exploratory && <span className="chip chip-draft">Веса изменены</span>}
    </div>

    <div className="weight-rows">{order.map(key => {
      const share = applied?.[key]
      const numeric = Number(draft[key])
      return <div className="weight-row" key={key}>
        <div className="weight-name">
          <b>{meaning[key]?.title || key}</b>
          <Tip label={`Что означает вес ${key}`}>
            <b>{meaning[key]?.title || key}</b> · <code>{key}</code><br />
            {method.directions[key] === 'minimize' ? 'Меньше — предпочтительнее.' : 'Больше — предпочтительнее.'} {meaning[key]?.hint}<br />
            Объявлено M0: {format(method.weights[key])}
          </Tip>
        </div>
        <span className="weight-share" data-testid={`applied-${key}`} data-value={share}>{share === undefined ? '—' : `${format(share * 100, 1)} %`}</span>
        <input className="weight-slider" type="range" min="0" max={Math.max(1, Number.isFinite(numeric) ? numeric : 1)} step="0.005" disabled={busy}
          aria-label={`Ползунок веса ${key}`} value={Number.isFinite(numeric) ? numeric : 0}
          onChange={event => decision.setWeight(key, event.target.value)} />
        <input className="weight-number" type="number" min="0" step="any" aria-label={`Вес ${key}`} value={draft[key]} disabled={busy}
          onChange={event => decision.setWeight(key, event.target.value)} />
      </div>
    })}</div>

    {!valid && <p className="field-error" role="alert">Все восемь весов должны быть конечными и неотрицательными; хотя бы один — больше нуля.</p>}

    <div className="preference-presets actions">
      <button type="button" disabled={busy} onClick={() => decision.setWeights(method.weights)}>Веса M0</button>
      <button type="button" disabled={busy} onClick={() => decision.setWeights(method.equal_weight_profile)}>Равные веса</button>
    </div>

    <Disclosure summary="Ещё" note="шортлист, исходное решение, файлы">
      <label className="preference-field">Размер шортлиста
        <select aria-label="Размер шортлиста" disabled={busy} value={limit}
          onChange={event => decision.setLimit(Number(event.target.value))}>{[10, 25, 50].map(value => <option key={value} value={value}>{value}</option>)}</select>
      </label>

      <p className="meta">Исходное решение для чувствительности: {baseline
        ? `ручной состав ${composition(baseline.selection)}`
        : 'лидер текущего профиля'}.</p>
      <div className="actions">
        <button type="button" className="quiet" disabled={busy || currentRequest.selection.length !== 4}
          onClick={() => decision.setBaseline(structuredClone(currentRequest))}>Взять ручной состав</button>
        <button type="button" className="quiet" disabled={busy || !baseline} onClick={() => decision.setBaseline(null)}>Взять лидера</button>
      </div>

      <div className="actions">
        <button type="button" className="quiet" disabled={busy || !result} onClick={() => void decision.exportFile()}>Скачать JSON выбора</button>
        <button type="button" className="quiet" disabled={busy} onClick={() => upload.current?.click()}>Импорт выбора</button>
        <input hidden ref={upload} type="file" accept=".json,application/json" aria-label="Файл JSON выбора"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void decision.importFile(file) }} />
      </div>

      <div className="actions">
        <button type="button" className="quiet" disabled={busy} onClick={() => {
          decision.setWeights(method.weights); decision.setLimit(10); decision.setBaseline(null)
        }}>Сбросить настройки поиска</button>
      </div>
    </Disclosure>
  </div>
}
