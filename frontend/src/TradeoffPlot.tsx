/** C0 × VPUB projection of the shortlist. Two of eight criteria only: the plot never
 *  draws a frontier and never claims dominance. Positions come from server metrics;
 *  the budget rules are the real BASE/STRESS caps. */
import { useState } from 'react'
import { format } from './presentation'
import type { Candidate } from './decision'
import type { Scenario } from './types'

type Bounds = Record<string, { min: number; max: number }>
const PAD = { left: 62, right: 18, top: 18, bottom: 44 }
const W = 520, H = 360

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

  return <figure className="plot">
    <div className="plot-controls" role="group" aria-label="Масштаб проекции">
      <button type="button" aria-pressed={!zoom} onClick={() => setZoom(false)}>Весь диапазон допустимых</button>
      <button type="button" aria-pressed={zoom} onClick={() => setZoom(true)}>Приблизить шортлист</button>
    </div>
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
        return <g key={row.portfolio_id} className={`plot-point ${state} ${viewedId === row.portfolio_id ? 'viewed' : ''}`}
          onMouseEnter={() => onView(row.portfolio_id)} onMouseLeave={() => onView(null)}>
          <circle cx={x(row.metrics.c0_mrub)} cy={y(row.metrics.vpub_mrub_per_year)} r={state === 'leader' ? 7 : compared ? 6 : 4.5} />
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
    <figcaption>
      <p><b>Эта проекция показывает два критерия из восьми.</b> {zoom
        ? `Оси приближены к значениям ${points.length} показанных вариантов; серый прямоугольник — та часть диапазона всех ${format(referenceSize)} допустимых BASE-составов, которая попала в кадр.`
        : `Прямоугольник — диапазон значений всех ${format(referenceSize)} допустимых BASE-составов по этим двум осям, а не граница множества.`} Линия Парето не строится: положение слева-сверху не означает превосходство по остальным шести критериям.</p>
      {leader && <p className="muted">Показаны {shortlist.length} вариантов шортлиста{extras.length > 0 ? ` и ${extras.length} из матрицы сравнения` : ''}. Среди них {better.length === 0 ? 'ни один не имеет одновременно меньший C0 и большую VPUB' : `${better.length} имеют и меньший C0, и большую VPUB`}. Проверьте остальные критерии в таблице — ранг считается по всем восьми.</p>}
      <ul className="plot-legend">
        <li><i className="key-leader" />предпочтительный при текущих весах</li>
        <li><i className="key-compared" />столбец матрицы сравнения</li>
        <li><i className="key-plain" />шортлист</li>
        <li><i className="key-applied" />открыт в конструкторе</li>
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
