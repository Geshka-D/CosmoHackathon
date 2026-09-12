/** Navigation contract of the product: six user tasks, each with its own secondary tabs.
 *  The route is the only place that decides what is on screen; no section is hidden with
 *  CSS and no panel decides its own visibility. */
import { useEffect, useState } from 'react'

export type ViewId = 'overview' | 'search' | 'stress' | 'builder' | 'compare' | 'delivery'

export type View = { id: ViewId; title: string; tabs: { id: string; title: string }[] }

export const VIEWS: View[] = [
  { id: 'overview', title: 'Обзор', tabs: [] },
  {
    id: 'search', title: 'Поиск', tabs: [
      { id: 'shortlist', title: 'Шортлист' },
      { id: 'why', title: 'Почему выбран' },
      { id: 'method', title: 'Расчёт' },
    ],
  },
  {
    id: 'stress', title: 'Стресс', tabs: [
      { id: 'recommendation', title: 'Рекомендация' },
      { id: 'own', title: 'Мой состав' },
      { id: 'budget', title: 'Корректировка бюджета' },
    ],
  },
  { id: 'builder', title: 'Конструктор', tabs: [] },
  {
    id: 'compare', title: 'Сравнение', tabs: [
      { id: 'search', title: 'Варианты поиска' },
      { id: 'saved', title: 'Сохранённые составы' },
    ],
  },
  {
    id: 'delivery', title: 'Реализация', tabs: [
      { id: 'rationale', title: 'Обоснование' },
      { id: 'finance', title: 'Финансирование' },
      { id: 'services', title: 'Сервисы' },
      { id: 'materials', title: 'Материалы' },
    ],
  },
]

export type Route = { view: ViewId; tab: string }

const defaultTab = (view: ViewId) => VIEWS.find(item => item.id === view)?.tabs[0]?.id || ''

function parse(hash: string): Route {
  const [rawView, rawTab] = hash.replace(/^#\/?/, '').split('/')
  const view = VIEWS.find(item => item.id === rawView)
  if (!view) return { view: 'overview', tab: '' }
  const tab = view.tabs.some(item => item.id === rawTab) ? rawTab : defaultTab(view.id)
  return { view: view.id, tab }
}

/** Hash routing so a screen can be linked to, reloaded and returned to. */
export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parse(typeof location === 'undefined' ? '' : location.hash))
  useEffect(() => {
    const read = () => setRoute(parse(location.hash))
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  function go(view: ViewId, tab?: string) {
    const next = { view, tab: tab && VIEWS.find(item => item.id === view)?.tabs.some(item => item.id === tab) ? tab : defaultTab(view) }
    const target = next.tab ? `#/${next.view}/${next.tab}` : `#/${next.view}`
    if (location.hash !== target) location.hash = target
    setRoute(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  return { route, go }
}
