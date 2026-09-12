import { useEffect, useState } from 'react'
import { api } from './api'
import type { Catalog, ModeId, RequestInput, Result, Scenario, TeamSettings, Workspace } from './types'
import { format, signed } from './presentation'
import { Status } from './ResultPanel'

type OptionResponse = { after: Result; before: Result; capital_preserved: boolean; interpretation: string }
const indicators = ['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year', 'kcash']
const labels: Record<string, string> = { c0_mrub: 'C0', opex_mrub_per_year: 'OPEX', vpub_mrub_per_year: 'VPUB', cash_mrub_per_year: 'CASH', kcash: 'KCASH' }

function ScenarioCard({ title, result, scenario }: { title: string; result: Result; scenario: Scenario }) {
  const checks = result.scenarios[scenario].diagnostics
  const budget = checks.find(item => item.id === 'c0_limit')!
  return <article className="stress-card" data-testid={`stress-summary-${scenario}`}><h3>{title}</h3><Status value={result.scenarios[scenario].status}/>
    <dl>{indicators.map(key => <div key={key}><dt>{labels[key]}</dt><dd>{format(result.metrics[key], key === 'kcash' ? 3 : 1)}</dd></div>)}
      <div><dt>Запас C0</dt><dd>{signed(budget.margin)} млн руб.</dd></div>
      <div><dt>P(C0≤лимит)</dt><dd>{format((budget.probability ?? 0) * 100, 1)} %</dd></div>
      <div><dt>Целевой резерв</dt><dd>{format(budget.target_reserve_mrub)} млн руб.</dd></div>
    </dl><div className="check-chips" aria-label={`Статусы ограничений ${title}`}>{checks.map(c => <span key={c.id} className={c.ok ? 'pass' : 'fail'} title={`${c.condition}: ${c.status}`}>{c.ok ? '✓' : '×'} {c.id}</span>)}</div>
  </article>
}

export function StressPanel({ catalog, workspace, result, pending, onSettings, onApplyScenario, onLoad, disabled }: {
  catalog: Catalog; workspace: Workspace; result?: Result; pending: boolean
  onSettings: (value: TeamSettings) => void; onApplyScenario: () => void
  onLoad: (name: string, request: RequestInput) => void; disabled: boolean
}) {
  const settings = workspace.team_settings || catalog.team_defaults
  const [option, setOption] = useState<OptionResponse>()
  const [optionError, setOptionError] = useState('')
  const [optionBusy, setOptionBusy] = useState(false)
  useEffect(() => { setOption(undefined); setOptionError('') }, [result?.input_fingerprint, settings.stress_plan])
  const patch = (values: Partial<TeamSettings>) => onSettings({ ...settings, ...values })
  const action = settings.stress_plan.actions[0]
  const actualMode = result?.selection.find(row => row.lot_id === action.lot_id)?.mode_id
  const applicable = !!result && actualMode === action.from
  async function exercise() {
    if (!result || !applicable) return
    setOptionBusy(true); setOptionError('')
    try {
      const value = await api<OptionResponse>('/api/option/exercise', JSON.stringify({
        format_version: 'kosmos-option/1', case_id: catalog.case_id, case_version: catalog.case_version,
        source_hashes: catalog.source_hashes, request: result.original_request,
        stress_plan: settings.stress_plan, team_settings: settings,
      }))
      setOption(value)
    } catch (failure) { setOptionError((failure as Error).message) } finally { setOptionBusy(false) }
  }
  return <section id="stress" className="panel" aria-labelledby="stress-title" aria-busy={pending}>
    <div className="section-heading"><div><p className="eyebrow">Канонические проверки + допущения команды</p><h2 id="stress-title">Стресс и договорный опцион</h2></div><button disabled={disabled} onClick={onApplyScenario}>Показать ограничения STRESS</button></div>
    <p>Сначала проверяется неизменный портфель; договорное действие применяется отдельно, после чего все показатели заново считает канонический адаптер.</p>
    {result?.completeness.status !== 'COMPLETE' && <p className="notice">Сначала выберите четыре лота.</p>}
    <details className="team-settings" open><summary>Допущения команды · текущие входы</summary>
      <div className="settings-grid">
        <label>Надбавка на оптимизм, %<input type="range" min="0" max="20" step="5" value={settings.optimism_uplift * 100} onChange={e => patch({ optimism_uplift: Number(e.target.value) / 100 })}/><output>{format(settings.optimism_uplift * 100)} %</output><small>Пресеты: 0 / 5 / 10 / 15 / 20</small></label>
        <label>σ, относительное отклонение<input type="number" min="0" max="1" step="0.01" value={settings.sigma} onChange={e => patch({ sigma: Number(e.target.value) })}/><small>0 — точное совпадение с канонической моделью</small></label>
        <label>ρ, связанность<input type="number" min="0" max="1" step="0.05" value={settings.rho} onChange={e => patch({ rho: Number(e.target.value) })}/></label>
        <label>Надёжность<input type="number" min="0.51" max="0.99" step="0.01" value={settings.confidence} onChange={e => patch({ confidence: Number(e.target.value) })}/></label>
        <label>α, безвозвратная доля<input type="number" min="0" max="1" step="0.05" value={settings.alpha} onChange={e => patch({ alpha: Number(e.target.value) })}/></label>
        <label>φ, общая платформа<input type="number" min="0" max="1" step="0.05" value={settings.phi} onChange={e => patch({ phi: Number(e.target.value) })}/></label>
      </div>
      <div className="option-editor"><label>Триггер<textarea maxLength={500} value={settings.stress_plan.trigger} onChange={e => patch({ stress_plan: { ...settings.stress_plan, trigger: e.target.value } })}/></label>
        <label>Лот<select value={action.lot_id} onChange={e => patch({ stress_plan: { ...settings.stress_plan, actions: [{ ...action, lot_id: e.target.value }] } })}>{catalog.lots.map(l => <option key={l.lot_id}>{l.lot_id}</option>)}</select></label>
        <label>Из режима<select value={action.from} onChange={e => patch({ stress_plan: { ...settings.stress_plan, actions: [{ ...action, from: e.target.value as ModeId }] } })}>{catalog.modes.map(m => <option key={m.mode_id}>{m.mode_id}</option>)}</select></label>
        <label>В режим<select value={action.to} onChange={e => patch({ stress_plan: { ...settings.stress_plan, actions: [{ ...action, to: e.target.value as ModeId }] } })}>{catalog.modes.map(m => <option key={m.mode_id}>{m.mode_id}</option>)}</select></label>
        <label>Обоснование<textarea maxLength={2000} value={settings.stress_plan.rationale} onChange={e => patch({ stress_plan: { ...settings.stress_plan, rationale: e.target.value } })}/></label></div>
      <p className="source">Поля A16–A22 из config/assumptions.json; это параметры команды, а не изменение исходных данных кейса.</p>
    </details>
    {!result ? <p role="status">{pending ? 'Пересчитываем оба сценария…' : 'Результат скрыт до успешного пересчёта.'}</p> : <>
      <div className="stress-grid three"><ScenarioCard title="BASE · без действий" result={result} scenario="BASE"/><ScenarioCard title="STRESS · без действий" result={result} scenario="STRESS"/>
        {option ? <ScenarioCard title="STRESS · после опциона" result={option.after} scenario="STRESS"/> : <article className="stress-card"><h3>STRESS · после опциона</h3><p>{applicable ? `Готово действие ${action.lot_id} ${action.from}→${action.to}.` : `Опцион ожидает ${action.lot_id}·${action.from}; сейчас ${actualMode || 'лот не выбран'}.`}</p><button className="primary" disabled={!applicable || optionBusy} onClick={() => void exercise()}>{optionBusy ? 'Пересчитываем…' : 'Исполнить опцион'}</button>{optionError && <p className="error">{optionError}</p>}</article>}
      </div>
      {option && <p className="notice">Капитал сохраняется: {option.capital_preserved ? 'да' : 'нет'}. {option.interpretation} <button onClick={() => onLoad('После договорного опциона', option.after.original_request)}>Загрузить результат в конструктор</button></p>}
      {result.team_analysis.stress_response && <div className="access-note"><b>Тип стресс-ответа: {result.team_analysis.stress_response.type} · {result.team_analysis.stress_response.label}</b><p>{result.team_analysis.stress_response.type === 1 ? `Лучший ответ при том же составе требует изменений режимов: ${result.team_analysis.stress_response.changes}.` : result.team_analysis.stress_response.type === 0 ? 'Портфель уже проходит STRESS.' : 'Для этого состава простого договорного переключения недостаточно.'}</p>{result.team_analysis.stress_response.candidate && result.team_analysis.stress_response.type === 1 && <button onClick={() => onLoad('Лучший договорный стресс-ответ', { ...result.original_request, selection: result.team_analysis.stress_response!.candidate!.selection })}>Загрузить лучший стресс-ответ</button>}</div>}
    </>}
  </section>
}
