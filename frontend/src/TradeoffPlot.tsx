/** C0 × VPUB projection of the shortlist. Two of eight criteria only: the plot never
 *  draws a frontier and never claims dominance. Positions come from server metrics;
 *  the budget rules are the real BASE/STRESS caps.
 *  Colour semantics: accent = preferred, ring = comparison column, amber = within 5 % of
 *  the active cap, red = not admissible in the active scenario, grey = the rest. */
import { useState } from 'react'
import { format } from './presentation'
import { composition } from './decision'
import { Tip } from './ui'
import type { Candidate } from './decision'
import type { Scenario } from './types'

type Bounds = Record<string, { min: number; max: number }>
const PAD = { left: 58, right: 16, top: 16, bottom: 40 }
const W = 520, H = 300
const NEAR_CAP = 0.05

export function TradeoffPlot({ shortlist, extras, bounds, referenceSize, leaderId, viewedId, comparedIds, appliedId, scenario, caps, onView }: {
  shortlist: Candidate[]; extras: Candidate[]; bounds: Bounds; referenceSize: number; leaderId: string; viewedId: string | null
  comparedIds: string[]; appliedId: string | null; scenario: Scenario; caps: Record<Scenario, number>; onView: (id: string | null) => void
}) {
  const [zoom, setZoom] = useState(false)
  const c0 = bounds.c0, vpub = bounds.vpub
  const points = [...shortlist, ...extras]
  const listC0 = points.map(row => row.metrics.c0_mrub)
  const listVpub = points.map(row => row.metrics.vpub_mrub_per_year)
  const frame = zoom && points.length > 1
    ? { c0: { min: Math.min(...listC0), max: Math.max(...listC0) }, vpub: { min: Math.min(...listVpub), max: Math.max(...listVpub) } }
    : { c0, vpub }
  const padX = (frame.c0.max - frame.c0.min) * 0.12 || 1
  const padY = (frame.vpub.max - frame.vpub.min) * 0.12 || 1
  const xMin = frame.c0.min - padX, xMax = frame.c0.max + padX, yMin = frame.vpub.min - padY, yMax = frame.vpub.max + padY
  const x = (value: number) => PAD.left + ((value - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right)
  const y = (value: number) => H - PAD.bottom - ((value - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom)
  const ticksX = axisTicks(frame.c0.min, frame.c0.max, 4)
  const ticksY = axisTicks(frame.vpub.min, frame.vpub.max, 4)
  const leader = points.find(row => row.portfolio_id === leaderId)
  const better = leader ? points.filter(row => row.portfolio_id !== leaderId
    && row.metrics.c0_mrub <= leader.metrics.c0_mrub && row.metrics.vpub_mrub_per_year >= leader.metrics.vpub_mrub_per_year) : []
  const hovered = points.find(row => row.portfolio_id === viewedId)

  /** Budget state of one candidate under the scenario the user is looking at. */
  const budget = (row: Candidate) => {
    const margin = row.scenarios[scenario].c0_margin
    if (margin < 0) return 'invalid'
    return margin <= caps[scenario] * NEAR_CAP ? 'near-cap' : ''
  }

  return <figure className="plot">
    <div className="plot-controls" role="group" aria-label="Масштаб проекции">
      <button type="button" aria-pressed={!zoom} onClick={() => setZoom(false)}>Весь диапазон допустимых</button>
      <button type="button" aria-pressed={zoom} onClick={() => setZoom(true)}>Приблизить шортлист</button>
    </div>
    <div className="plot-frame">
    <svg viewBox={`0 0 ${W} ${H}`} className="plot-svg" role="img"
      aria-label={`Проекция шортлиста: ось X — C0 от ${format(c0.min)} до ${format(c0.max)} млн руб., ось Y — VPUB от ${format(vpub.min)} до ${format(vpub.max)} синтетических млн руб./год. Показаны ${points.length} вариантов. Полные значения — в таблице ниже.`}>
      <rect className="plot-envelope" x={Math.max(x(c0.min), 0)} y={Math.max(y(vpub.max), 0)}
        width={Math.max(Math.min(x(c0.max), W) - Math.max(x(c0.min), 0), 0)} height={Math.max(Math.min(y(vpub.min), H) - Math.max(y(vpub.max), 0), 0)} />
      {ticksX.map(value => <g key={`x${value}`}>
        <line className="plot-grid" x1={x(value)} y1={PAD.top} x2={x(value)} y2={H - PAD.bottom} />
        <text className="plot-tick" x={x(value)} y={H - PAD.bottom + 15} textAnchor="middle">{format(value, 0)}</text>
      </g>)}
      {ticksY.map(value => <g key={`y${value}`}>
        <line className="plot-grid" x1={PAD.left} y1={y(value)} x2={W - PAD.right} y2={y(value)} />
        <text className="plot-tick" x={PAD.left - 8} y={y(value) + 4} textAnchor="end">{format(value, 0)}</text>
      </g>)}
      <line className="plot-axis" x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} />
      <line className="plot-axis" x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} />
      {(['BASE', 'STRESS'] as const).map(name => caps[name] <= xMax && <g key={name} className={`plot-cap ${scenario === name ? 'active' : ''}`}
        style={{ transform: `translateX(${x(caps[name])}px)` }}>
        <line x1={0} y1={PAD.top} x2={0} y2={H - PAD.bottom} />
        <text x={-5} y={PAD.top + 11} textAnchor="end">лимит {name}</text>
      </g>)}
      {points.map(row => {
        const compared = comparedIds.includes(row.portfolio_id)
        const state = row.portfolio_id === leaderId ? 'leader' : compared ? 'compared' : 'plain'
        return <g key={row.portfolio_id} className={`plot-point ${state} ${budget(row)} ${viewedId === row.portfolio_id ? 'viewed' : ''}`}
          onMouseEnter={() => onView(row.portfolio_id)} onMouseLeave={() => onView(null)}>
          <circle cx={x(row.metrics.c0_mrub)} cy={y(row.metrics.vpub_mrub_per_year)} r={state === 'leader' ? 7 : compared ? 6 : 4.5}>
            <title>{`${composition(row.selection)} · место ${row.rank} · C0 ${format(row.metrics.c0_mrub)} · VPUB ${format(row.metrics.vpub_mrub_per_year)}`}</title>
          </circle>
          {state === 'leader' && <circle className="plot-halo" cx={x(row.metrics.c0_mrub)} cy={y(row.metrics.vpub_mrub_per_year)} r={13} />}
        </g>
      })}
      {appliedId && points.some(row => row.portfolio_id === appliedId) && (() => {
        const row = points.find(item => item.portfolio_id === appliedId)!
        const cx = x(row.metrics.c0_mrub), cy = y(row.metrics.vpub_mrub_per_year)
        return <g className="plot-applied"><line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} /><line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} /></g>
      })()}
      <text className="plot-axis-title" x={PAD.left + (W - PAD.left - PAD.right) / 2} y={H - 6} textAnchor="middle">C0 · млн руб. при запуске →</text>
      <text className="plot-axis-title" x={-(PAD.top + (H - PAD.top - PAD.bottom) / 2)} y={14} transform="rotate(-90)" textAnchor="middle">VPUB · синтет. млн руб./год →</text>
    </svg>
    {hovered && <div className="plot-tooltip" aria-hidden="true"
      style={{ left: `${(x(hovered.metrics.c0_mrub) / W) * 100}%`, top: `${(y(hovered.metrics.vpub_mrub_per_year) / H) * 100}%` }}>
      <b>{composition(hovered.selection)}</b>
      <dl>
        <dt>Место</dt><dd>{hovered.rank}</dd>
        <dt>Score</dt><dd>{format(hovered.score, 4)}</dd>
        <dt>C0</dt><dd>{format(hovered.metrics.c0_mrub)}</dd>
        <dt>VPUB</dt><dd>{format(hovered.metrics.vpub_mrub_per_year)}</dd>
        <dt>STRESS</dt><dd className={hovered.scenarios.STRESS.status === 'PASS' ? 'tone-pass' : 'tone-fail'}>{hovered.scenarios.STRESS.status}</dd>
      </dl>
    </div>}
    </div>
    <figcaption>
      <p className="meta">Две оси из восьми критериев. Линия Парето не строится.
        <Tip label="О графике">
          {zoom ? `Оси приближены к ${points.length} показанным вариантам.`
            : `Прямоугольник — диапазон значений всех ${format(referenceSize)} допустимых BASE-составов.`}
          {' '}Положение слева-сверху не означает превосходство по остальным шести критериям.
          {leader && ` Из ${shortlist.length} вариантов шортлиста${extras.length > 0 ? ` и ${extras.length} из сравнения` : ''} ${better.length === 0 ? 'ни один не дешевле и ценнее одновременно' : `${better.length} дешевле и ценнее одновременно`}.`}
        </Tip>
      </p>
      <ul className="plot-legend">
        <li><i className="key-leader" />рекомендация</li>
        <li><i className="key-compared" />в сравнении</li>
        <li><i className="key-plain" />шортлист</li>
        <li><i className="key-near" />запас до лимита меньше 5 %</li>
        <li><i className="key-applied" />в конструкторе</li>
        <li><i className="key-cap" />лимит C0 {scenario}</li>
      </ul>
    </figcaption>
  </figure>
}

function axisTicks(min: number, max: number, count: number) {
  if (!(max > min)) return [min]
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, index) => min + step * index)
}
