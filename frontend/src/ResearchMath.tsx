import { composition } from './decision'
import type { Intelligence, Proposal } from './intelligence'
import { format, money, signed } from './presentation'
import { Block, Callout, Disclosure, Empty, Fact, Facts } from './ui'
import type { RequestInput, Selection } from './types'

export type ResearchControls = { enabled: boolean; u: string; riskEnabled: boolean; sigma: string; rho: string; q: string }
export const initialResearch: ResearchControls = { enabled: false, u: '0', riskEnabled: false, sigma: '', rho: '0', q: '0.9' }
export function researchSettings(value: ResearchControls) {
  const finite = (text: string) => text.trim() !== '' && Number.isFinite(Number(text))
  const valid = finite(value.u) && Number(value.u) >= 0 && (!value.riskEnabled || (
    finite(value.sigma) && Number(value.sigma) >= 0 && finite(value.rho) && Number(value.rho) >= 0 && Number(value.rho) <= 1
    && finite(value.q) && Number(value.q) > 0 && Number(value.q) < 1))
  return { valid, u: Number(value.u), cost_risk: value.riskEnabled ? { sigma: Number(value.sigma), rho: Number(value.rho), q: Number(value.q) } : null }
}
type Proof = { portfolio_id: string; canonical_c0: number; research_c0: number; cap: number; margin: number; critical_u: number; feasible: boolean; selection: Selection[] }
type Step = { lower_inclusive: number; upper_exclusive: number | null; budget_threshold: number; vpub: number; portfolio_id: string; request: RequestInput; research_check?: Proof; at_current_cap?: Proof }
export type ResearchResult = {
  analysis: Omit<Intelligence, 'recovery'> & { recovery: (Proposal & { research_check: Proof; research_delta_c0: number })[] }
  settings: { u: number; cap: number; scenario: string; cost_risk: { sigma: number; rho: number; q: number } | null }
  current: Proof
  budget_effect: { current: Step | null; next: (Step & { required_increase: number; delta_vpub: number | null }) | null; levels: Step[]; tie_break: string }
  cost_risk: { settings: { u: number; sigma: number; rho: number; q: number }; probability: number; existing_margin: number; required_reserve: number; missing_budget: number; sd: number; disclaimer: string; assumptions: string[]; negative_cost_warning: boolean; hard_constraints_and_locks_satisfied: boolean } | null
}

export function ResearchInputs({ value, onChange }: { value: ResearchControls; onChange: (value: ResearchControls) => void }) {
  return <Disclosure summary="Удорожание и эффект изменения бюджета" note="отдельное исследование; официальный расчёт сохраняется">
    <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 'var(--s1)' }}><input style={{ width: 'auto' }} type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} /> Включить исследование C0 и бюджета</label>
    {value.enabled && <>
      <label>Исследовательская надбавка u · доля
        <input aria-label="Исследовательская надбавка u" type="number" min="0" step="any" value={value.u} onChange={event => onChange({ ...value, u: event.target.value })} />
      </label>
      <p className="meta">u задан пользователем. 0,05 означает рост стартовых затрат на 5 %. OPEX, CASH, VPUB и остальные условия сохраняются. Текущие лимит и обязательные сервисы применяются ко всем вариантам.</p>
      <Disclosure summary="Риск затрат · optional RESEARCH" note="аналитическая модель, выключена по умолчанию">
        <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 'var(--s1)' }}><input style={{ width: 'auto' }} type="checkbox" checked={value.riskEnabled} onChange={event => onChange({ ...value, riskEnabled: event.target.checked })} /> Оценить условную вероятность бюджета</label>
        {value.riskEnabled && <>
          <div className="lock-grid">{(['sigma', 'rho', 'q'] as const).map(field => <label key={field}>{field === 'sigma' ? 'sigma · относительное отклонение' : field === 'rho' ? 'rho · корреляция' : 'q · целевая вероятность'}
            <input aria-label={`Риск ${field}`} type="number" step="any" value={value[field]} onChange={event => onChange({ ...value, [field]: event.target.value })} />
          </label>)}</div>
          <button type="button" className="quiet" onClick={() => onChange({ ...value, sigma: '0.05' })}>Выбрать иллюстративную sigma = 0,05</button>
          <p className="meta">sigma ≥ 0; 0 ≤ rho ≤ 1; 0 &lt; q &lt; 1. Параметры не оценены по реальным данным.</p>
        </>}
      </Disclosure>
      {!researchSettings(value).valid && <p role="alert" className="field-error">Введите конечные параметры в указанных диапазонах.</p>}
    </>}
  </Disclosure>
}

function StepPlot({ levels, cap }: { levels: Step[]; cap: number }) {
  if (!levels.length) return <Empty>Решений нет при любом бюджете с этими обязательными сервисами.</Empty>
  const left = Math.min(cap, levels[0].budget_threshold) - 10
  const right = Math.max(cap, levels.at(-1)!.budget_threshold) + 20
  const low = Math.min(...levels.map(p => p.vpub)) - 20, high = Math.max(...levels.map(p => p.vpub)) + 20
  const x = (b: number) => 70 + 620 * ((b - left) / (right - left))
  const y = (v: number) => 195 - 160 * (v - low) / (high - low)
  const path = levels.map((p, i) => `${i ? 'H' : 'M'}${x(p.budget_threshold)}${i ? ' V' : ' '}${y(p.vpub)}`).join(' ') + ` H${x(right)}`
  return <svg viewBox="0 0 740 250" role="img" aria-label="Ступенчатый максимум VPUB по бюджету" style={{ width: '100%', maxHeight: 300 }}>
    <path data-testid="vpub-step-path" d={path} fill="none" stroke="var(--accent)" strokeWidth="3" />
    <path d={`M${x(cap)} 25 V200`} stroke="var(--warn)" strokeDasharray="4 4" />
    <text x="12" y="18" fill="currentColor" fontSize="12">VPUB · синтетические млн ₽/год</text>
    <text x="70" y="220" fill="currentColor" fontSize="12">{format(levels[0].budget_threshold)} · первый допустимый бюджет</text>
    <text x="70" y="242" fill="currentColor" fontSize="12">Лимит · млн ₽ · текущий {format(cap)}; до первой ступени решений нет</text>
  </svg>
}

export function ResearchReadout({ value, onCap, onCompare }: { value: ResearchResult; onCap: (cap: number) => void; onCompare: (point: { selection: Selection[]; portfolio_id: string }) => void }) {
  const effect = value.budget_effect, risk = value.cost_risk
  return <div data-testid="research-math-result" style={{ display: 'grid', gap: 'var(--s3)', marginBlock: 'var(--s3)' }}>
    <Block title="Запас к удорожанию C0" note={`RESEARCH · u = ${format(value.settings.u, 6)} · ${value.settings.scenario}`}>
      <Facts className="facts-row">
        <Fact label="Исходный C0" value={money(value.current.canonical_c0)} />
        <Fact label="Исследовательский C0" value={money(value.current.research_c0)} />
        <Fact label="Лимит" value={money(value.current.cap)} />
        <Fact label="Запас / нарушение" value={signed(value.current.margin)} />
        <Fact label="Критическая надбавка" value={`${format(value.current.critical_u * 100, 6)} %`} />
        <Fact label="Допустимых вариантов" value={format(value.analysis.feasible_count)} />
      </Facts>
      <p className="meta">C0 × (1 + u); критическая надбавка = cap / C0 − 1. Численный допуск {value.analysis.budget.eps}. Остальные реальные запасы приведены в диагностике ниже.</p>
      {!!value.analysis.recovery.length && <Disclosure summary="Сравнение корректировок при тех же cap, u и обязательных сервисах">
        <div className="table-scroll"><table><thead><tr><th>Состав</th><th>Исходный C0</th><th>C0 с надбавкой</th><th>ΔC0 с надбавкой</th><th>Запас</th><th>Проверка</th></tr></thead>
          <tbody>{value.analysis.recovery.map(p => <tr key={p.candidate.portfolio_id}><th>{composition(p.candidate.selection)}</th><td>{money(p.research_check.canonical_c0)}</td><td>{money(p.research_check.research_c0)}</td><td>{signed(p.research_delta_c0)}</td><td>{signed(p.research_check.margin)}</td><td>{p.research_check.feasible ? 'RESEARCH PASS' : 'RESEARCH FAIL'}</td></tr>)}</tbody></table></div>
      </Disclosure>}
      <p className="meta">Повторная проверка корректировок: строгий адаптер, все условия и обязательные сервисы. Обычное сравнение и применение состава показывают канонические метрики; исследовательская проверка остаётся в этом блоке.</p>
    </Block>
    <Block title="Эффект изменения бюджета" note="максимум VPUB; отдельный взгляд рядом с существующей картой MCDA">
      <Facts className="facts-row">
        <Fact label="Максимум VPUB сейчас" value={effect.current ? format(effect.current.vpub) : 'решений нет'} />
        <Fact label="Следующий порог улучшения" value={effect.next ? money(effect.next.budget_threshold) : 'дальнейшего роста нет'} />
        <Fact label="Увеличение лимита" value={effect.next ? money(effect.next.required_increase) : '—'} />
        <Fact label="ΔVPUB" value={effect.next?.delta_vpub == null ? '—' : signed(effect.next.delta_vpub)} />
      </Facts>
      {effect.next && <><p className="object-title">{composition(effect.next.request.selection)} · VPUB {format(effect.next.vpub)}</p>
        <p className="meta">Проверка этого состава при текущем лимите: {effect.next.at_current_cap ? (effect.next.at_current_cap.feasible ? 'RESEARCH PASS' : 'RESEARCH FAIL') : 'NOT VERIFIED'}; при пороге {money(effect.next.budget_threshold)}: {effect.next.research_check ? (effect.next.research_check.feasible ? 'RESEARCH PASS' : 'RESEARCH FAIL') : 'NOT VERIFIED'}. Надбавка и обязательные сервисы те же.</p>
        <div className="actions"><button type="button" onClick={() => onCap(effect.next!.budget_threshold)}>Исследовать следующий порог</button>
          <button type="button" onClick={() => onCompare({ selection: effect.next!.request.selection, portfolio_id: effect.next!.portfolio_id })}>Сравнить состав следующего порога</button></div></>}
      {effect.current && <button type="button" className="quiet" onClick={() => onCompare({ selection: effect.current!.request.selection, portfolio_id: effect.current!.portfolio_id })}>Сравнить текущий максимум VPUB</button>}
      <StepPlot levels={effect.levels} cap={value.settings.cap} />
      <Disclosure summary="Точные ступени и правило равенства">
        <p className="meta">При равной VPUB применяется существующий ранг MCDA: score по убыванию, затем меньший исходный C0, затем ID состава. Равные уровни VPUB объединены. Между ступенями достижимая VPUB постоянна; до первой — решений нет. Это не ROI и не классическая теневая цена.</p>
        <div className="table-scroll"><table><thead><tr><th>Бюджетный порог</th><th>VPUB</th><th>Состав при достижении порога</th></tr></thead><tbody>{effect.levels.map(p => <tr key={p.lower_inclusive}><td>{format(p.budget_threshold, 6)}<small>численная граница {p.lower_inclusive}</small></td><td>{format(p.vpub)}</td><td>{composition(p.request.selection)}</td></tr>)}</tbody></table></div>
      </Disclosure>
    </Block>
    {risk && <Disclosure summary="Результат модели риска затрат · RESEARCH">
      <p>{risk.disclaimer}</p>
      <p className="meta">Применено: u={risk.settings.u}; sigma={risk.settings.sigma}; rho={risk.settings.rho}; q={risk.settings.q}.</p>
      <Facts className="facts-row"><Fact label="Условная вероятность бюджета" value={`${format(risk.probability * 100, 3)} %`} />
        <Fact label="Существующий запас cap − mu" value={money(risk.existing_margin)} />
        <Fact label="Требуемый резерв zq × sd" value={money(risk.required_reserve)} />
        <Fact label="Недостающий бюджет" value={money(risk.missing_budget)} />
      </Facts>
      {!risk.hard_constraints_and_locks_satisfied && <Callout tone="warn">Текущий состав не проходит все жёсткие условия или обязательные сервисы. Вероятность бюджета не делает его допустимым.</Callout>}
      {risk.negative_cost_warning && <Callout tone="warn">При этой широкой sigma нормальная модель допускает заметную вероятность отрицательных затрат.</Callout>}
      {risk.assumptions.map(text => <p className="meta" key={text}>{text}</p>)}
    </Disclosure>}
  </div>
}
