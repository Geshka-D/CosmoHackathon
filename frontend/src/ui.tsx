/** Shared presentation primitives.
 *
 *  These components never compute anything: they receive server values already
 *  formatted by presentation.ts and only decide how a number, a status or a
 *  technical code is shown.
 *
 *  They also enforce the five levels of text used across the product, so a screen
 *  cannot grow a sixth one by accident:
 *    1 view title   — one per screen (ViewHead)
 *    2 block title  — a functional zone (Block)
 *    3 object title — a portfolio, a scenario, a service
 *    4 label+value  — Kpi, Fact
 *    5 meta         — units, codes, provenance (.meta)
 */
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

/** Small info affordance: the long explanation lives here instead of under every control.
 *  Hover, focus and click all open it; only click pins it, so a click after a hover never
 *  closes what the pointer just opened. */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const id = useId()
  const open = hovered || focused || pinned
  return <span className="tip" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <button type="button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPinned(false) }}
      onKeyDown={event => { if (event.key === 'Escape') setPinned(false) }}
      onClick={event => { event.preventDefault(); setPinned(value => !value) }}>i</button>
    {open && <span className="tip-bubble" id={id} role="tooltip">{children}</span>}
  </span>
}

/** Level 1. One per screen: title, the state it applies to, its actions and its tabs. */
export function ViewHead({ title, state, actions, children }: {
  title: string; state?: ReactNode; actions?: ReactNode; children?: ReactNode
}) {
  return <header className="view-head">
    <div className="view-head-row">
      <h1 className="view-title">{title}</h1>
      {state && <p className="view-state">{state}</p>}
      {actions && <div className="view-head-actions">{actions}</div>}
    </div>
    {children}
  </header>
}

/** Level 2. A functional zone: spacing and one title, not a box around a paragraph. */
export function Block({ title, note, actions, children, id, className }: {
  title?: string; note?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; className?: string
}) {
  return <section id={id} className={className ? `block ${className}` : 'block'}>
    {(title || actions) && <div className="block-head">
      {title && <h2 className="block-title">{title}</h2>}
      {note && <p className="block-note">{note}</p>}
      {actions && <div className="block-actions">{actions}</div>}
    </div>}
    {children}
  </section>
}

export type KpiTone = 'plain' | 'accent' | 'pass' | 'stress' | 'fail'

/** Level 4. Human name → value with its unit → technical code. The code never replaces the name. */
export function Kpi({ label, code, value, unit, tone = 'plain', hint, small }: {
  label: string; code?: string; value: ReactNode; unit?: string; tone?: KpiTone; hint?: ReactNode; small?: boolean
}) {
  return <div className={small ? 'kpi kpi-sm' : 'kpi'} data-tone={tone}>
    <span className="kpi-label"><span>{label}</span>{hint && <Tip label={`Что такое ${label}`}>{hint}</Tip>}</span>
    <span className="kpi-value">{value}{unit && <i className="kpi-unit">{unit}</i>}</span>
    {code && <span className="kpi-code">{code}</span>}
  </div>
}

export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `kpi-row ${className}` : 'kpi-row'}>{children}</div>
}

/** Level 4, dense form: key → value rows that belong to one object. */
export function Facts({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <dl className={className ? `facts ${className}` : 'facts'} data-testid={testId}>{children}</dl>
}

export function Fact({ label, code, value, tone, hint }: {
  label: ReactNode; code?: string; value: ReactNode; tone?: KpiTone; hint?: ReactNode
}) {
  return <div className="fact">
    <dt>{label}{code && <i className="fact-code">{code}</i>}
      {hint && <Tip label={typeof label === 'string' ? `Что такое ${label}` : 'Пояснение'}>{hint}</Tip>}</dt>
    <dd data-tone={tone}>{value}</dd>
  </div>
}

/** The answer of a screen: one verdict, its two numbers, one line of consequence. */
export function Verdict({ tone, badge, headline, figures, children }: {
  tone: 'pass' | 'fail' | 'neutral'; badge?: ReactNode; headline: ReactNode
  figures?: ReactNode; children?: ReactNode
}) {
  return <div className="verdict" data-tone={tone}>
    <div className="verdict-claim">
      {badge && <span className="verdict-badge">{badge}</span>}
      <strong>{headline}</strong>
      {children}
    </div>
    {figures && <div className="verdict-figures">{figures}</div>}
  </div>
}

/** Text that must stay visible but does not belong to a metric or a table. */
export function Callout({ tone = 'note', children, role }: {
  tone?: 'note' | 'warn' | 'error' | 'quiet'; children: ReactNode; role?: 'status' | 'alert'
}) {
  return <p className="callout" data-tone={tone} role={role}>{children}</p>
}

export function Status({ value }: { value: string }) {
  const label = value === 'PASS' ? 'PASS' : value === 'FAIL' ? 'FAIL' : 'не завершён'
  return <span className={`status ${value.toLowerCase()}`}>{label}</span>
}

/** Signed difference with a declared direction, so colour is never the only signal. */
export function MetricDelta({ text, verdict }: { text: string; verdict?: '' | 'win' | 'lose' | 'same' }) {
  return <small className={verdict === 'win' || verdict === 'lose' ? `delta ${verdict}` : 'delta'}>
    {verdict === 'win' ? '▲ ' : verdict === 'lose' ? '▼ ' : ''}{text}
  </small>
}

/** Segmented control. Used for the scenario and for in-view switches. */
export function Tabs<T extends string>({ label, value, items, onChange, className }: {
  label: string; value: T; items: { id: T; title: ReactNode; disabled?: boolean }[]
  onChange: (id: T) => void; className?: string
}) {
  return <div className={className ? `tabs ${className}` : 'tabs'} role="group" aria-label={label}>
    {items.map(item => <button key={item.id} type="button" aria-pressed={value === item.id} disabled={item.disabled}
      onClick={() => onChange(item.id)}>{item.title}</button>)}
  </div>
}

/** Second level of the interface: evidence stays available, but not all at once. */
export function Disclosure({ summary, note, children, open, className }: {
  summary: string; note?: string; children: ReactNode; open?: boolean; className?: string
}) {
  return <details className={className ? `disclosure ${className}` : 'disclosure'} open={open}>
    <summary>{summary}{note && <small>{note}</small>}</summary>
    {children}
  </details>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
