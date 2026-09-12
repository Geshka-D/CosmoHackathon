/** Comparison state shared by the search workspace and the comparison view: which
 *  declared strategies and which shortlist rows are on screen, how deep the table is
 *  and which candidate is being pointed at. Lifted out of the panels so moving between
 *  the two screens never rebuilds the comparison. */
import { useState } from 'react'
import type { Candidate, Decision } from './decision'
import type { Column } from './ComparisonMatrix'

export const MAX_COLUMNS = 5
const DEFAULT_STRATEGIES = ['max_vpub', 'min_c0']

export function useCompare() {
  const [extra, setExtra] = useState<string[]>([])
  const [strategies, setStrategies] = useState<string[]>(DEFAULT_STRATEGIES)
  const [density, setDensity] = useState<'key' | 'all'>('key')
  const [viewed, setViewed] = useState<string | null>(null)
  return {
    extra, strategies, density, viewed, setDensity, setViewed,
    add: (id: string) => setExtra(current => current.includes(id) ? current : [...current, id]),
    drop: (id: string) => setExtra(current => current.filter(item => item !== id)),
    toggleStrategy: (id: string) => setStrategies(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]),
  }
}

export type CompareState = ReturnType<typeof useCompare>

/** The columns of the comparison, in the order they are read: preferred first. */
export function buildColumns(result: Decision, compare: CompareState): Column[] {
  const leader = result.search.ranking[0]
  if (!leader) return []
  return [
    { candidate: leader, title: 'Рекомендация', note: 'лидер при текущих весах' },
    ...result.alternatives
      .filter(item => compare.strategies.includes(item.strategy_id) && item.candidate.portfolio_id !== leader.portfolio_id && !item.same_portfolio_as)
      .map(item => ({ candidate: item.candidate, title: item.title.replace(/^BASE:\s*/, ''), note: 'объявленная стратегия', alternative: item })),
    ...compare.extra.map(id => result.search.ranking.find(row => row.portfolio_id === id))
      .filter((row): row is Candidate => !!row && row.portfolio_id !== leader.portfolio_id)
      .map(row => ({ candidate: row, title: `Шортлист · место ${row.rank}`, note: 'добавлен вручную' })),
  ].slice(0, MAX_COLUMNS)
}
