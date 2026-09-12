import { useEffect, useRef, useState } from 'react'
import { api, download } from './api'
import { Comparison } from './Comparison'
import { ResultPanel } from './ResultPanel'
import { DecisionPanel } from './DecisionPanel'
import { DecisionAtlas } from './DecisionAtlas'
import { ImplementationPanel } from './ImplementationPanel'
import { IntelligencePanel } from './IntelligencePanel'
import { StressPanel } from './StressPanel'
import { Mission, PitchControls, OfficialShock, FinanceFlow, ImplementationConditions, DecisionBrief } from './Experience'
import { useOfficialEvidence, usePassport } from './useEvidence'
import type { LabSnapshot } from './useEvidence'
import { useDecision } from './useDecision'
import { portfolioId } from './decision'
import { format, lotNames, metricNames } from './presentation'
import type { Catalog, Envelope, ModeId, Selection, Workspace } from './types'

const STORAGE_KEY = 'kosmos.workspace.v1'
const FORMAT = 'kosmos-workspace/1' as const
const MAX_BYTES = 65_536
const makeEnvelope = (catalog: Catalog, workspace: Workspace): Envelope => ({ format_version: FORMAT, source_hashes: catalog.source_hashes, workspace })
const blank = (catalog: Catalog): Workspace => ({
  current: { name: 'Мой портфель', request: { schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: [] } },
  alternatives: [], scenario: 'BASE',
})
const signature = (rows: Selection[]) => rows.map(row => `${row.lot_id}:${row.mode_id}`).sort().join('|')

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
  const [pitch, setPitch] = useState<number | null>(null)
  const [lab, setLab] = useState<LabSnapshot>()
  const returnScroll = useRef(0)
  const revision = useRef(0)
  const autoSave = useRef(false)
  const rejectedStorage = useRef<string | undefined>(undefined)
  const operation = useRef<AbortController | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const serialized = catalog && workspace ? JSON.stringify(makeEnvelope(catalog, workspace)) : ''
  const computed = response?.key === serialized ? response.value.computed : undefined
  const decision = useDecision(catalog)
  const appliedId = workspace && workspace.current.request.selection.length === 4 ? portfolioId(workspace.current.request.selection) : null
  const leader = decision.result?.search.ranking[0]
  const leaderRequest = leader && catalog ? { schema_version: catalog.schema_version, case_id: catalog.case_id, case_version: catalog.case_version, selection: leader.selection } : undefined
  const researchSubject = workspace?.current.request.selection.length === 4 ? workspace.current.request : leaderRequest
  const evidence = useOfficialEvidence(decision.result?.configuration.request, leaderRequest)
  const validLab = lab?.subjectKey === JSON.stringify(researchSubject) && lab?.searchKey === JSON.stringify(decision.result?.configuration.request)
  const labActive = !!lab?.active || lab?.context === 'RESEARCH'
  const briefEvidence = labActive ? (validLab ? lab?.result : undefined) : evidence.data
  const finance = usePassport(briefEvidence?.recommendation?.request)
  function exitPitch() {
    setPitch(null)
    requestAnimationFrame(() => { window.scrollTo({ top: returnScroll.current, behavior: 'instant' }); document.getElementById('enter-pitch')?.focus({ preventScroll: true }) })
  }

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

  function change(next: Workspace, remember = true) {
    if (!workspace) return
    revision.current += 1
    operation.current?.abort()
    setBusy(false)
    autoSave.current = true
    setStorageMessage('Есть изменения. Сохраним их после успешного пересчёта.')
    if (remember) setHistory(previous => [...previous.slice(-19), structuredClone(workspace)])
    setWorkspace(next)
    // Explicit actions such as reset or clicking the active scenario still
    // need a fresh request even if their serialized input happens to match.
    setRetry(value => value + 1)
    setResponse(undefined)
    setError('')
    setNotice('')
  }

  function changeSelection(index: number, lotId: string, modeId?: ModeId) {
    if (!workspace) return
    const rows = [...workspace.current.request.selection]
    if (!lotId) rows.splice(index, 1)
    else rows[index] = { lot_id: lotId, mode_id: modeId || rows[index]?.mode_id || 'A' }
    change({ ...workspace, current: { ...workspace.current, request: { ...workspace.current.request, selection: rows } } })
  }

  function load(name: string, request: Workspace['current']['request']) {
    if (!workspace) return
    change({ ...workspace, current: { name, request: structuredClone(request) } })
    if (pitch !== null) setPitch(null)
    requestAnimationFrame(() => document.getElementById('builder')?.scrollIntoView({ block: 'start' }))
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

  const addReason = !workspace ? '' : workspace.current.request.selection.length !== 4 ? 'Нужны четыре лота.'
    : workspace.alternatives.length >= 3 ? 'Уже сохранены три варианта. Удалите один, чтобы добавить новый.'
      : workspace.alternatives.some(item => signature(item.request.selection) === signature(workspace.current.request.selection)) ? 'Такой состав и режимы уже сохранены.'
        : workspace.alternatives.some(item => item.name.trim().toLocaleLowerCase() === workspace.current.name.trim().toLocaleLowerCase()) ? 'Задайте другое название варианта.'
          : !workspace.current.name.trim() ? 'Введите название варианта.' : ''

  return <div className={pitch === null ? 'product' : 'product pitch-active'} data-pitch-step={pitch ?? undefined}>
    <a className="skip-link" href="#overview">Перейти к решению</a>
    <header className="masthead">
      <div className="masthead-block">
        <p>Космос как инфраструктура</p>
        <h1>Портфель космических сервисов</h1>
      </div>
      <p className="masthead-story">потребность → пользователь → сервис → действие → плановый эффект → общественная ценность → кто платит → почему этот портфель → STRESS</p>
      <button id="enter-pitch" className="pitch-launch quiet" disabled={!decision.result} onClick={() => { returnScroll.current = window.scrollY; setPitch(0) }}>Обзор решения</button>
    </header>
    <nav aria-label="Разделы">
      <a href="#overview">Обзор</a><a href="#decision">Поиск и выбор</a><a href="#official-shock">BASE → STRESS</a><a href="#intelligence">Budget Lab / Recovery</a><a href="#financing">Финансирование</a><a href="#decision-brief">Brief</a>
      <a href="#builder">Конструктор</a><a href="#stress">STRESS своего состава</a><a href="#comparison">Сравнение</a><a href="#implementation">Реализация и материалы</a>
    </nav>
    {pitch !== null && <PitchControls step={pitch} onStep={setPitch} onExit={exitPitch} />}
    <main>
      {!workspace || !catalog ? <section className="panel"><h2>Загрузка кейса</h2>{error ? <div role="alert" className="error"><p>{error}</p><button onClick={() => setBoot(value => value + 1)}>Повторить загрузку</button></div> : <p role="status">Проверяем локальные источники и сохранённые настройки…</p>}</section> : <>
        <DecisionAtlas decision={decision} catalog={catalog} appliedId={appliedId} />
        <Mission total={decision.result?.search.population.total} />

        <section className="toolbar panel" aria-label="Сохранение и восстановление">
          <div><b>Настройки портфеля</b><p className="muted" role="status">{storageMessage || 'Изменения сохраняются в этом браузере после успешного пересчёта.'}</p>{rejectedStorage.current !== undefined && <button className="quiet" onClick={() => download(rejectedStorage.current!, 'kosmos-storage-backup.json')}>Скачать прежнюю запись</button>}</div>
          <div className="actions"><button disabled={busy || !computed} onClick={() => void exportFile()}>Скачать JSON</button><button disabled={busy} onClick={() => upload.current?.click()}>Импорт JSON</button>
            <input ref={upload} type="file" accept=".json,application/json" aria-label="Файл JSON для импорта" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
            <button className="quiet" disabled={history.length === 0 || busy} onClick={() => { const prior = history[history.length - 1]; setHistory(previous => previous.slice(0, -1)); change(prior, false) }}>Отменить изменение</button>
            <button className="quiet" disabled={busy} onClick={() => change(blank(catalog))}>Сбросить всё</button></div>
        </section>
        {notice && <p id="workspace-notice" className="notice" role="status">{notice} <a href="#comparison">Открыть сохранённые варианты</a></p>}
        {busy && <p className="notice" role="status">Проверяем файл и пересчитываем настройки…</p>}
        {error && <div className="error" role="alert"><b>Расчёт не подтверждён</b><p>{error}</p><button onClick={() => { revision.current += 1; setError(''); setResponse(undefined); setRetry(value => value + 1) }}>Пересчитать текущие настройки</button></div>}

        <DecisionPanel catalog={catalog} currentRequest={workspace.current.request} appliedId={appliedId} decision={decision} onLoad={load} evidence={evidence.data} />
        {evidence.error && <p className="error" role="alert">{evidence.error} <button onClick={evidence.retry}>Повторить объяснение</button></p>}
        <OfficialShock decision={decision.result} />

        <IntelligencePanel catalog={catalog} current={researchSubject || workspace.current.request} search={decision.result?.configuration.request}
          subjectLabel={appliedId ? 'Текущий состав конструктора' : 'Рекомендация · конструктор не изменён'}
          initialBreakpoint={appliedId ? (typeof computed?.current.metrics.c0_mrub === 'number' ? computed.current.metrics.c0_mrub : undefined) : leader?.metrics.c0_mrub}
          onSnapshot={setLab} onApply={load} onCompare={(name, request) => {
          const alternatives = [...workspace.alternatives]
          for (const item of [{ name: appliedId ? workspace.current.name : 'Исходная рекомендация', request: researchSubject || workspace.current.request }, { name, request }]) {
            if (!alternatives.some(a => signature(a.request.selection) === signature(item.request.selection))) {
              if (alternatives.length >= 3) {
                setNotice('Сравнение заполнено: удалите один из трёх вариантов и повторите добавление.')
                if (pitch !== null) setPitch(null)
                requestAnimationFrame(() => document.getElementById('workspace-notice')?.scrollIntoView({ block: 'start' }))
                return
              }
              const originalName = item.name.trim() || 'Портфель'
              let uniqueName = originalName.slice(0, 76)
              let suffix = 1
              while (alternatives.some(a => a.name.toLocaleLowerCase() === uniqueName.toLocaleLowerCase())) uniqueName = `${originalName.slice(0, 76)} ${suffix++}`
              alternatives.push({ ...structuredClone(item), name: uniqueName, alternative_id: `alt-${crypto.randomUUID()}` })
            }
          }
          change({ ...workspace, alternatives })
          if (pitch !== null) setPitch(null)
          requestAnimationFrame(() => document.getElementById('comparison')?.scrollIntoView({ block: 'start' }))
        }} />
        <section id="financing" className="panel">
          <p className="eyebrow">Financing & responsibility / рекомендация текущего контекста</p><h2>Кто платит — и что получает общество?</h2>
          <p>{briefEvidence ? `${briefEvidence.context} / ${briefEvidence.active_scenario}` : 'Ожидаем актуальный расчёт'} · {briefEvidence?.recommendation?.candidate.selection.map(r => `${r.lot_id} ${r.mode_id}`).join(' · ')}</p>
          {finance.data ? <FinanceFlow value={finance.data} /> : finance.error ? <p role="alert">{finance.error} <button onClick={finance.retry}>Повторить финансовую цепочку</button></p> : briefEvidence?.status === 'NO_SOLUTION' ? <p className="notice">Нет допустимой рекомендации для финансирования. Измените условия или выполните Reset DSS.</p> : <p role="status">Проверяем расчёт и активный паспорт рекомендации…</p>}
        </section>
        <ImplementationConditions candidate={briefEvidence?.recommendation?.candidate} />
        <DecisionBrief value={briefEvidence} catalog={catalog} pendingContext={labActive && !briefEvidence ? lab?.context : undefined} />
        <StressPanel result={computed?.current} pending={!computed && !error} onApply={() => change({ ...workspace, scenario: 'STRESS' })}
          disabled={busy || !computed} decision={decision} currentRequest={workspace.current.request}
          currentName={workspace.current.name} onLoad={load} />

        <section id="builder" className="panel">
          <div className="section-heading"><div><p className="eyebrow">Четыре позиции · восемь лотов</p><h2>Конструктор портфеля</h2></div><span>{workspace.current.request.selection.length} / 4</span></div>
          <p className="muted">Ручная сборка любого состава: применённый здесь портфель считается отдельно от рекомендации и отмечается в сравнении.</p>
          <label className="name-field">Название текущего варианта<input maxLength={80} value={workspace.current.name} disabled={busy} onChange={event => change({ ...workspace, current: { ...workspace.current, name: event.target.value } })} aria-invalid={!workspace.current.name.trim()} /></label>
          {!workspace.current.name.trim() && <p className="field-error">Введите название, чтобы сохранить и сравнить вариант.</p>}
          <div className="slots">{[0, 1, 2, 3].map(index => {
            const row = workspace.current.request.selection[index]
            const lot = catalog.lots.find(item => item.lot_id === row?.lot_id)
            const mode = catalog.modes.find(item => item.mode_id === row?.mode_id)
            return <fieldset className="slot" key={index} disabled={busy}><legend>Позиция {index + 1}</legend>
              <label>Лот {index + 1}<select aria-label={`Лот ${index + 1}`} value={row?.lot_id || ''} disabled={!row && index > workspace.current.request.selection.length} onChange={event => changeSelection(index, event.target.value)}>
                <option value="">Выберите лот</option>{catalog.lots.map(item => <option key={item.lot_id} value={item.lot_id} disabled={workspace.current.request.selection.some((other, otherIndex) => otherIndex !== index && other.lot_id === item.lot_id)}>{item.lot_id} · {lotNames[item.lot_id]}</option>)}
              </select></label>
              <label>Режим {index + 1}<select aria-label={`Режим ${index + 1}`} disabled={!row} value={row?.mode_id || 'A'} onChange={event => changeSelection(index, row.lot_id, event.target.value as ModeId)}>{catalog.modes.map(item => <option key={item.mode_id} value={item.mode_id}>{item.mode_id} · {item.public_core ? 'общественное ядро' : 'вне общественного ядра'}</option>)}</select></label>
              {lot ? <div className="lot-context"><span className="lot-code">{lot.lot_id}</span><p>{lot.service}</p><p>{lot.territorial_archetype} · {lot.capability_groups}</p><p className={mode?.public_core ? 'core-label' : 'muted'}>{mode?.public_core ? '● Засчитывается в общественное ядро' : '○ Не засчитывается в общественное ядро'}</p>{lot.federal && <p>Федеральный лот: не добавляет территориальный архетип.</p>}</div> : <p className="muted">Добавьте сервис из каталога. Каждый лот можно выбрать один раз.</p>}
            </fieldset>
          })}</div>
          <div className="access-note"><b>Общественный слой</b><p>По исходным данным только режим A имеет public_core=true. Этот признак не означает, что весь сервис бесплатен. Предложенные условия принятого сохранённого портфеля доступны в разделе «Реализация»; ручные варианты требуют отдельной договорной проработки.</p><p>SSA исключается только из территориального счёта. PNT, InSAR и PNT/InSAR считаются одной группой возможностей.</p></div>
          <div className="builder-footer"><div className="scenario-switch" role="group" aria-label="Бюджетный сценарий">{(['BASE', 'STRESS'] as const).map(scenario => <button key={scenario} disabled={busy} aria-pressed={workspace.scenario === scenario} onClick={() => change({ ...workspace, scenario })}>{scenario}<small>лимит C0 {format(catalog.scenarios[scenario].c0_max_mrub)} млн руб.</small></button>)}</div>
            <div><button className="primary" disabled={busy || !computed || !!addReason} onClick={() => {
              change({ ...workspace, alternatives: [...workspace.alternatives, { ...structuredClone(workspace.current), alternative_id: `alt-${crypto.randomUUID()}` }] })
            }}>Добавить в сравнение</button><p className="muted">{addReason || 'Сохраняется отдельный снимок полного состава, включая FAIL.'}</p></div>
          </div>
        </section>
        <section className="panel results" aria-label="Результаты расчёта" aria-busy={!computed && !error}>
          {computed ? <ResultPanel result={computed.current} scenario={workspace.scenario} /> : <><h2>Цена и ограничения</h2><p role="status">{error ? 'Результаты скрыты до успешного пересчёта текущих настроек.' : busy ? 'Ожидаем завершения операции с JSON…' : 'Пересчитываем текущий ввод на сервере…'}</p></>}
        </section>
        <Comparison workspace={workspace} computed={computed} onLoad={index => { const item = workspace.alternatives[index]; load(item.name, item.request) }} onRemove={index => change({ ...workspace, alternatives: workspace.alternatives.filter((_, i) => i !== index) })} />
        <ImplementationPanel currentRequest={workspace.current.request} onLoad={load} />
        <section id="catalog" className="panel">
          <p className="eyebrow">Сохранённая версия источника</p><h2>Каталог и коэффициенты</h2><p>Восемь реальных лотов из lots.csv. Исходные значения и официальные пороги доступны только для чтения. Русские краткие подписи — перевод названий для интерфейса.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Каталог восьми лотов"><table><thead><tr><th>Лот / сервис</th><th>Архетип / группы</th><th>C0<small>млн руб.</small></th><th>OPEX<small>млн руб./год</small></th><th>VPUB<small>синтет. млн руб./год</small></th><th>Якорный / коммерческий CASH<small>млн руб./год</small></th><th>Индексы</th></tr></thead>
            <tbody>{catalog.lots.map(lot => <tr key={lot.lot_id}><th scope="row">{lot.lot_id} · {lotNames[lot.lot_id]}<small>{lot.service}</small></th><td>{lot.territorial_archetype}<small>{lot.capability_groups}</small><small>federal: {String(lot.federal)}</small></td><td>{format(lot.c0_mrub)}</td><td>{format(lot.opex_mrub_per_year)}</td><td>{format(lot.vpub_mrub_per_year)}</td><td>{format(lot.anchor_cash_mrub_per_year)} / {format(lot.commercial_cash_mrub_per_year)}</td><td>{['t_rep', 'readiness_1_5', 'resilience_1_5', 'scale_1_5'].map(key => <small key={key}>{metricNames[key]}: {format(lot[key])}</small>)}</td></tr>)}</tbody>
          </table></div>
          <h3>Режимы A / B / C</h3><p>Множители исходных показателей. Договорные названия в CSV не заданы.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Коэффициенты режимов"><table><thead><tr><th>Режим</th><th>k_C0</th><th>k_OPEX</th><th>k_VPUB</th><th>k_anchor</th><th>k_commercial</th><th>public_core</th></tr></thead><tbody>{catalog.modes.map(mode => <tr key={mode.mode_id}><th scope="row">{mode.mode_id}</th><td>{format(mode.k_c0)}</td><td>{format(mode.k_opex)}</td><td>{format(mode.k_vpub)}</td><td>{format(mode.k_anchor)}</td><td>{format(mode.k_commercial)}</td><td>{String(mode.public_core)}</td></tr>)}</tbody></table></div>
          <p className="source">Источник: case_source/data/lots.csv · case_source/data/access_modes.csv · case_source/config/case_config.json</p>
          <details className="disclosure"><summary>Версия, официальные пороги и SHA-256</summary><p>{catalog.case_id} · v{catalog.case_version}</p><pre>{JSON.stringify({ constraints_common: catalog.constraints_common, scenarios: catalog.scenarios, source_hashes: catalog.source_hashes }, null, 2)}</pre></details>
        </section>
      </>}
    </main>
    <footer>Синтетические данные кейса · C0 при запуске + один год эксплуатации · ручной аналитический инструмент</footer>
  </div>
}
