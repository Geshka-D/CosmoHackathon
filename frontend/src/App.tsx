import { useEffect, useRef, useState } from 'react'
import { api, download } from './api'
import { Overview } from './Overview'
import { Search } from './Search'
import { Stress } from './Stress'
import { Builder } from './Builder'
import { Compare } from './Compare'
import { Delivery } from './Delivery'
import { useBudget } from './Budget'
import { useCompare } from './comparison'
import { useOfficialEvidence, usePassport } from './useEvidence'
import { useDecision } from './useDecision'
import { useRoute, VIEWS } from './routes'
import type { ViewId } from './routes'
import { portfolioId } from './decision'
import { money } from './presentation'
import { Callout, Tabs } from './ui'
import type { Catalog, Envelope, ModeId, Scenario, Selection, Workspace } from './types'

const STORAGE_KEY = 'kosmos.workspace.v1'
const FORMAT = 'kosmos-workspace/1' as const
const MAX_BYTES = 65_536
const makeEnvelope = (catalog: Catalog, workspace: Workspace): Envelope => ({ format_version: FORMAT, source_hashes: catalog.source_hashes, workspace })
const blank = (catalog: Catalog): Workspace => ({
  current: { name: 'Мой портфель', request: { schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: [] } },
  alternatives: [], scenario: 'BASE',
})
const signature = (rows: Selection[]) => rows.map(row => `${row.lot_id}:${row.mode_id}`).sort().join('|')

/** Guided walk-through of the product: one line per screen, driving the real navigation. */
const TOUR: { view: ViewId; tab: string; text: string }[] = [
  { view: 'overview', tab: '', text: 'Что рекомендовано и выдерживает ли это снижение бюджета.' },
  { view: 'search', tab: 'shortlist', text: 'Все допустимые составы, ранжированные по восьми взвешенным критериям.' },
  { view: 'search', tab: 'why', text: 'Чем рекомендация выигрывает у второго места и чем за это платит.' },
  { view: 'compare', tab: 'search', text: 'Цена компромисса рядом с максимумом ценности и минимумом затрат.' },
  { view: 'stress', tab: 'recommendation', text: 'Официальное снижение лимита C0: стоимость состава не меняется, двигается граница.' },
  { view: 'stress', tab: 'budget', text: 'Где решение меняется и какой минимальной корректировкой возвращается в допустимую область.' },
  { view: 'delivery', tab: 'finance', text: 'Кто платит, за что, и какой дефицит остаётся адресным.' },
  { view: 'delivery', tab: 'materials', text: 'Карточка решения и материалы выпуска собираются из текущего расчёта.' },
]

export default function App() {
  const [catalog, setCatalog] = useState<Catalog>()
  const [workspace, setWorkspace] = useState<Workspace>()
  const [response, setResponse] = useState<{ key: string; value: Envelope }>()
  const [error, setError] = useState('')
  const [storageMessage, setStorageMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [boot, setBoot] = useState(0)
  const [retry, setRetry] = useState(0)
  const [history, setHistory] = useState<Workspace[]>([])
  const [tour, setTour] = useState<number | null>(null)
  const revision = useRef(0)
  const autoSave = useRef(false)
  const rejectedStorage = useRef<string | undefined>(undefined)
  const operation = useRef<AbortController | null>(null)

  const { route, go } = useRoute()
  const serialized = catalog && workspace ? JSON.stringify(makeEnvelope(catalog, workspace)) : ''
  const computed = response?.key === serialized ? response.value.computed : undefined
  const decision = useDecision(catalog)
  const compare = useCompare()
  const appliedId = workspace && workspace.current.request.selection.length === 4 ? portfolioId(workspace.current.request.selection) : null
  const leader = decision.result?.search.ranking[0]
  const leaderRequest = leader && catalog
    ? { schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: leader.selection }
    : undefined
  const researchSubject = workspace?.current.request.selection.length === 4 ? workspace.current.request : leaderRequest
  const evidence = useOfficialEvidence(decision.result?.configuration.request, leaderRequest)

  function change(next: Workspace, remember = true) {
    if (!workspace) return
    revision.current += 1
    operation.current?.abort()
    setBusy(false)
    autoSave.current = true
    setStorageMessage('Есть несохранённые изменения. Сохраним их после успешного пересчёта.')
    if (remember) setHistory(previous => [...previous.slice(-19), structuredClone(workspace)])
    setWorkspace(next)
    // Explicit actions such as reset still need a fresh request even if their
    // serialized input happens to match.
    setRetry(value => value + 1)
    setResponse(undefined)
    setError('')
    setNotice('')
  }

  function load(name: string, request: Workspace['current']['request']) {
    if (!workspace) return
    change({ ...workspace, current: { name, request: structuredClone(request) } })
    setTour(null)
    go('builder')
  }

  function addAlternatives(entries: { name: string; request: Workspace['current']['request'] }[]) {
    if (!workspace) return
    const alternatives = [...workspace.alternatives]
    for (const item of entries) {
      if (alternatives.some(other => signature(other.request.selection) === signature(item.request.selection))) continue
      if (alternatives.length >= 3) {
        setNotice('Сравнение заполнено: удалите один из трёх составов и повторите добавление.')
        setTour(null)
        go('compare', 'saved')
        return
      }
      const original = item.name.trim() || 'Портфель'
      let unique = original.slice(0, 76)
      let suffix = 1
      while (alternatives.some(other => other.name.toLocaleLowerCase() === unique.toLocaleLowerCase())) unique = `${original.slice(0, 76)} ${suffix++}`
      alternatives.push({ name: unique, request: structuredClone(item.request), alternative_id: `alt-${crypto.randomUUID()}` })
    }
    change({ ...workspace, alternatives })
    setTour(null)
    go('compare', 'saved')
  }

  const budget = useBudget({
    catalog, search: decision.result?.configuration.request, scenario: decision.scenario,
    subject: researchSubject,
    subjectLabel: appliedId ? 'Состав из конструктора' : 'Рекомендация поиска',
    officialBreakpoint: appliedId
      ? (typeof computed?.current.metrics.c0_mrub === 'number' ? computed.current.metrics.c0_mrub : undefined)
      : leader?.metrics.c0_mrub,
    onApply: load,
    onCompare: (name, request) => addAlternatives([
      { name: appliedId && workspace ? workspace.current.name : 'Исходная рекомендация', request: researchSubject || request },
      { name, request },
    ]),
  })

  const labActive = budget.attempt > 0 || budget.custom
  const briefEvidence = labActive ? budget.result : evidence.data
  const finance = usePassport(briefEvidence?.recommendation?.request)

  function persist(value: Envelope) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ format_version: value.format_version, source_hashes: value.source_hashes, workspace: value.workspace }))
      setStorageMessage('Сохранено в этом браузере. При открытии расчёт будет выполнен заново.')
      rejectedStorage.current = undefined
    } catch {
      setStorageMessage('Браузер не разрешил сохранение. Скачайте JSON, чтобы не потерять настройки.')
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setError('')
    setCatalog(undefined)
    setWorkspace(undefined)
    setResponse(undefined)
    async function start() {
      try {
        const data = await api<Catalog>('/api/case', undefined, controller.signal)
        if (!live) return
        let restored: Envelope | undefined
        let stored: string | null = null
        try { stored = localStorage.getItem(STORAGE_KEY) } catch {
          setStorageMessage('Хранилище браузера недоступно. Можно работать и сохранять JSON в файл.')
        }
        if (stored !== null) {
          try {
            // Preserve raw JSON: the Python decoder detects duplicate keys.
            restored = await api<Envelope>('/api/workspace/recompute', stored, controller.signal)
          } catch (failure) {
            if (!live) return
            rejectedStorage.current = stored
            setStorageMessage(`Сохранённые настройки не восстановлены: ${(failure as Error).message} Исходная запись сохранена; следующее изменение заменит её.`)
          }
        }
        if (!live) return
        const current = restored?.workspace || blank(data)
        setCatalog(data)
        setWorkspace(current)
        if (restored) {
          setResponse({ key: JSON.stringify(makeEnvelope(data, current)), value: restored })
          setStorageMessage('Настройки восстановлены; все результаты заново рассчитаны сервером.')
        }
      } catch (failure) {
        if (live) setError((failure as Error).message)
      }
    }
    void start()
    return () => { live = false; controller.abort() }
  }, [boot])

  useEffect(() => {
    if (!serialized) return
    const controller = new AbortController()
    const ownRevision = revision.current
    let live = true
    const timer = setTimeout(async () => {
      try {
        const value = await api<Envelope>('/api/workspace/recompute', serialized, controller.signal)
        if (!live || revision.current !== ownRevision) return
        setResponse({ key: serialized, value })
        setError('')
        if (autoSave.current) persist(value)
      } catch (failure) {
        if (!live || revision.current !== ownRevision) return
        setResponse(undefined)
        setError((failure as Error).message)
      }
    }, 120)
    return () => { live = false; clearTimeout(timer); controller.abort() }
  }, [serialized, retry])

  useEffect(() => () => operation.current?.abort(), [])

  useEffect(() => {
    if (tour === null) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setTour(null) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [tour])

  function changeSelection(index: number, lotId: string, modeId?: ModeId) {
    if (!workspace) return
    const rows = [...workspace.current.request.selection]
    if (!lotId) rows.splice(index, 1)
    else rows[index] = { lot_id: lotId, mode_id: modeId || rows[index]?.mode_id || 'A' }
    change({ ...workspace, current: { ...workspace.current, request: { ...workspace.current.request, selection: rows } } })
  }

  function setScenario(next: Scenario) {
    decision.setScenario(next)
    if (workspace && workspace.scenario !== next) change({ ...workspace, scenario: next })
  }

  async function importFile(file: File) {
    if (!catalog || !workspace) return
    if (file.size > MAX_BYTES) {
      setError('Файл больше 65 536 байт. Импортируйте JSON настроек, выгруженный приложением, без результатов расчёта.')
      setResponse(undefined)
      return
    }
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    const ownRevision = ++revision.current
    setBusy(true)
    setError('')
    setResponse(undefined)
    try {
      // Send the original bytes, not JSON.parse/File.text output (UTF-8 and
      // duplicate keys must reach the strict server decoder unchanged).
      const value = await api<Envelope>('/api/workspace/recompute', file, controller.signal)
      if (revision.current !== ownRevision) return
      setHistory(previous => [...previous.slice(-19), structuredClone(workspace)])
      setWorkspace(value.workspace)
      setResponse({ key: JSON.stringify(makeEnvelope(catalog, value.workspace)), value })
      autoSave.current = true
      persist(value)
      setNotice('JSON импортирован. Все числа пересчитаны сервером; отмена доступна.')
    } catch (failure) {
      if (revision.current === ownRevision) setError(`Импорт не выполнен. Настройки не изменены. ${(failure as Error).message}`)
    } finally {
      if (revision.current === ownRevision) setBusy(false)
    }
  }

  async function exportFile() {
    if (!serialized) return
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    const ownRevision = revision.current
    setBusy(true)
    try {
      const value = await api<Envelope>('/api/export', serialized, controller.signal)
      if (revision.current !== ownRevision) return
      download(JSON.stringify(value, null, 2) + '\n', 'kosmos-workspace.json')
      setNotice('JSON настроек выгружен. При импорте приложение заново рассчитает каждый вариант.')
    } catch (failure) {
      if (revision.current === ownRevision) {
        setError((failure as Error).message)
        setResponse(undefined)
      }
    } finally { if (revision.current === ownRevision) setBusy(false) }
  }

  const addReason = !workspace ? '' : workspace.current.request.selection.length !== 4 ? 'Для сравнения нужны четыре лота.'
    : workspace.alternatives.length >= 3 ? 'Уже сохранены три состава. Удалите один, чтобы добавить новый.'
      : workspace.alternatives.some(item => signature(item.request.selection) === signature(workspace.current.request.selection)) ? 'Такой состав и режимы уже сохранены.'
        : workspace.alternatives.some(item => item.name.trim().toLocaleLowerCase() === workspace.current.name.trim().toLocaleLowerCase()) ? 'Задайте другое название состава.'
          : !workspace.current.name.trim() ? 'Введите название состава.' : ''

  const step = tour === null ? undefined : TOUR[tour]

  return <div className="product">
    <a className="skip-link" href="#view">Перейти к решению</a>
    <header className="topbar">
      <p className="brand"><b>KOSMOS</b><span>портфель космических сервисов</span></p>
      <nav aria-label="Разделы">
        {VIEWS.map(item => <button key={item.id} type="button" aria-current={route.view === item.id ? 'true' : undefined}
          onClick={() => go(item.id)}>{item.title}</button>)}
      </nav>
      <div className="topbar-state">
        {catalog && <Tabs label="Сценарий" className="scenario-tabs" value={decision.scenario} onChange={setScenario}
          items={(['BASE', 'STRESS'] as const).map(value => ({ id: value, title: value }))} />}
        {catalog && <span className="topbar-limit">лимит C0 {money(catalog.scenarios[decision.scenario].c0_max_mrub)}</span>}
        <button type="button" id="tour" className="quiet" disabled={!decision.result}
          onClick={() => setTour(tour === null ? 0 : null)}>{tour === null ? 'Обзор решения' : 'Закрыть обзор'}</button>
      </div>
    </header>

    {step && <div className="tour" role="region" aria-label="Обзор решения">
      <p className="tour-step">Шаг {tour! + 1} из {TOUR.length}</p>
      <p className="tour-text">{step.text}</p>
      <div className="actions">
        <button type="button" className="quiet" disabled={tour === 0} onClick={() => { const next = tour! - 1; setTour(next); go(TOUR[next].view, TOUR[next].tab) }}>Назад</button>
        <button type="button" className="primary" disabled={tour === TOUR.length - 1}
          onClick={() => { const next = tour! + 1; setTour(next); go(TOUR[next].view, TOUR[next].tab) }}>Далее</button>
        <button type="button" className="quiet" onClick={() => setTour(null)}>Закрыть</button>
      </div>
    </div>}

    <main id="view">
      {!workspace || !catalog ? <section className="view">
        {error ? <div role="alert" className="error"><p>{error}</p><button type="button" onClick={() => setBoot(value => value + 1)}>Повторить загрузку</button></div>
          : <Callout tone="note" role="status">Проверяем локальные источники и сохранённые настройки…</Callout>}
      </section> : <section className="view">
        {notice && <Callout tone="note" role="status">{notice}</Callout>}
        {busy && <Callout tone="note" role="status">Проверяем файл и пересчитываем настройки…</Callout>}
        {error && <div className="error" role="alert">
          <b>Расчёт не подтверждён</b><p>{error}</p>
          <button type="button" onClick={() => { revision.current += 1; setError(''); setResponse(undefined); setRetry(value => value + 1) }}>Пересчитать текущие настройки</button>
        </div>}

        {route.view === 'overview' && <Overview decision={decision} catalog={catalog} appliedId={appliedId} go={go} />}

        {route.view === 'search' && <Search catalog={catalog} currentRequest={workspace.current.request} appliedId={appliedId}
          decision={decision} compare={compare} evidence={evidence} tab={route.tab} onLoad={load} go={go} />}

        {route.view === 'stress' && <Stress tab={route.tab} catalog={catalog} decision={decision}
          result={computed?.current} pending={!computed && !error} busy={busy}
          workspace={workspace.current} budget={budget} onLoad={load} go={go} />}

        {route.view === 'builder' && <Builder catalog={catalog} workspace={workspace} computed={computed} busy={busy} error={error}
          scenario={decision.scenario} addReason={addReason} storage={storageMessage} rejected={rejectedStorage.current !== undefined}
          onChangeName={value => change({ ...workspace, current: { ...workspace.current, name: value } })}
          onChangeSelection={changeSelection}
          onAdd={() => change({ ...workspace, alternatives: [...workspace.alternatives, { ...structuredClone(workspace.current), alternative_id: `alt-${crypto.randomUUID()}` }] })}
          onExport={() => void exportFile()} onImport={file => void importFile(file)}
          onUndo={() => { const prior = history[history.length - 1]; setHistory(previous => previous.slice(0, -1)); change(prior, false) }}
          onReset={() => change(blank(catalog))} undoable={history.length > 0}
          onDownloadRejected={() => download(rejectedStorage.current!, 'kosmos-storage-backup.json')} go={go} />}

        {route.view === 'compare' && <Compare tab={route.tab} catalog={catalog} decision={decision} compare={compare}
          workspace={workspace} computed={computed} appliedId={appliedId} onLoad={load}
          onRemove={index => change({ ...workspace, alternatives: workspace.alternatives.filter((_, position) => position !== index) })} go={go} />}

        {route.view === 'delivery' && <Delivery tab={route.tab} catalog={catalog} currentRequest={workspace.current.request}
          evidence={briefEvidence} passport={finance} pendingContext={labActive && !briefEvidence ? budget.context : undefined}
          onLoad={load} go={go} />}
      </section>}
    </main>
  </div>
}
