import { useEffect, useState } from 'react'
import { api } from './api'
import { format } from './presentation'
import type { TeamSettings } from './types'

type Point = { budget_mrub: number; max_vpub_mrub_per_year: number | null; feasible?: number; cut_share?: number }
type Shadow = { id: string; label: string; delta_vpub_mrub_per_year: number | null; best_vpub_mrub_per_year: number | null }
type Advanced = {
  optimism_ladder: { uplift: number; BASE: { feasible: number; max_vpub_mrub_per_year: number | null }; STRESS: { feasible: number; max_vpub_mrub_per_year: number | null } }[]
  frontier: { efficiency_curve: Point[]; survival_curve: Point[]; marginal_public_value: Record<string, number> }
  regional_equity: { stress_feasible: number; regions: { lot_id: string; territory: string; count: number; share: number }[]; regional_services_per_portfolio: Record<string, number>; interpretation: string }
  stress_response_population: { base_feasible: number; counts: Record<string, number>; labels: Record<string, string> }
  reliability_population: { BASE: { reliable: number }; STRESS: { reliable: number }; price_of_reliability_mrub_per_year: number }
  shadow_prices: Record<'BASE' | 'STRESS', { experiments: Shadow[] }>
}

function LineChart({ points, x, y, label }: { points: Point[]; x: (p: Point) => number; y: (p: Point) => number; label: string }) {
  const valid = points.filter(p => Number.isFinite(x(p)) && Number.isFinite(y(p)))
  const xs = valid.map(x), ys = valid.map(y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const sx = (v: number) => 42 + (v - minX) / Math.max(maxX - minX, 1) * 536
  const sy = (v: number) => 216 - (v - minY) / Math.max(maxY - minY, 1) * 184
  const d = valid.map((p, i) => `${i ? 'L' : 'M'}${sx(x(p)).toFixed(1)},${sy(y(p)).toFixed(1)}`).join(' ')
  return <svg className="analysis-chart" role="img" aria-label={label} viewBox="0 0 600 245">
    <line x1="42" y1="216" x2="585" y2="216"/><line x1="42" y1="22" x2="42" y2="216"/>
    <path d={d}/>{valid.map((p, i) => <circle key={i} cx={sx(x(p))} cy={sy(y(p))} r="3"><title>{format(x(p))} → {format(y(p))}</title></circle>)}
    <text x="42" y="238">{format(minX)}</text><text x="548" y="238">{format(maxX)}</text><text x="4" y="216">{format(minY)}</text><text x="4" y="28">{format(maxY)}</text>
  </svg>
}

export function AnalysisPanel({ settings }: { settings: TeamSettings }) {
  const [data, setData] = useState<Advanced>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); let live = true
    const query = new URLSearchParams(Object.entries(settings).filter(([,v]) => typeof v === 'number').map(([k,v]) => [k, String(v)]))
    setData(undefined); setError('')
    api<Advanced>(`/api/frontier?${query}`, undefined, controller.signal).then(v => { if (live) setData(v) }).catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false; controller.abort() }
  }, [settings.optimism_uplift, settings.sigma, settings.rho, settings.confidence, settings.alpha, settings.phi])
  return <section id="analysis" className="panel analysis-panel" aria-busy={!data && !error}>
    <p className="eyebrow">Показатели команды · полный перебор</p><h2>Границы решения и ценность ограничений</h2>
    {error ? <div className="error">{error}</div> : !data ? <p role="status">Считаем кривые по 5 670 вариантам…</p> : <>
      <h3>Лестница надбавки на оптимизм</h3><div className="table-scroll"><table><thead><tr><th>Надбавка</th><th>BASE: допустимо / max VPUB</th><th>STRESS: допустимо / max VPUB</th></tr></thead><tbody>{data.optimism_ladder.map(r => <tr key={r.uplift}><th>{format(r.uplift * 100)} %</th><td>{r.BASE.feasible} / {format(r.BASE.max_vpub_mrub_per_year)}</td><td>{r.STRESS.feasible} / {format(r.STRESS.max_vpub_mrub_per_year)}</td></tr>)}</tbody></table></div>
      <div className="chart-grid"><article><h3>Бюджетная эффективность</h3><LineChart points={data.frontier.efficiency_curve} x={p => p.budget_mrub} y={p => p.max_vpub_mrub_per_year || 0} label="Максимальная общественная ценность по лимиту C0"/><p>1180→1300: {format(data.frontier.marginal_public_value.stress_to_base, 2)} единицы VPUB на 1 млн бюджета.</p></article><article><h3>Выживаемость пространства</h3><LineChart points={data.frontier.survival_curve} x={p => (p.cut_share || 0) * 100} y={p => p.feasible || 0} label="Число допустимых портфелей по глубине сокращения бюджета"/><p>Показатель команды; ось X — сокращение, %, ось Y — число вариантов.</p></article></div>
      <h3>Теневые цены девяти условий</h3><div className="table-scroll"><table><thead><tr><th>Эксперимент</th><th>BASE ΔVPUB</th><th>STRESS ΔVPUB</th></tr></thead><tbody>{data.shadow_prices.BASE.experiments.map((r,i) => <tr key={r.id}><th>{r.label}</th><td>{format(r.delta_vpub_mrub_per_year)}</td><td>{format(data.shadow_prices.STRESS.experiments[i].delta_vpub_mrub_per_year)}</td></tr>)}</tbody></table></div>
      <div className="chart-grid"><article><h3>Типы стресс-ответа</h3>{Object.entries(data.stress_response_population.counts).map(([k,v]) => <p key={k}><b>{v}</b> · {data.stress_response_population.labels[k]}</p>)}<p>Без потери капитала: {data.stress_response_population.counts['0'] + data.stress_response_population.counts['1']} из {data.stress_response_population.base_feasible}.</p></article><article><h3>Региональная представленность</h3>{data.regional_equity.regions.map(r => <p key={r.lot_id}>{r.lot_id} · {r.territory}: <b>{r.count}</b> ({format(r.share * 100, 1)} %)</p>)}<p>{data.regional_equity.interpretation}</p></article></div>
      <p className="notice">При σ=5 % и надёжности 90 % число надёжных вариантов: BASE {data.reliability_population.BASE.reliable}, STRESS {data.reliability_population.STRESS.reliable}; цена надёжности {format(data.reliability_population.price_of_reliability_mrub_per_year)} единицы VPUB/год.</p>
    </>}
  </section>
}
