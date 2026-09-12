/** Decision state lifted out of DecisionPanel so the first screen and the analysis
 *  read one source of truth. Requests, debounce, abort and revision rules are the
 *  same as before; no client-side ranking or economics were added. */
import { useEffect, useRef, useState } from 'react'
import { api, download } from './api'
import type { Catalog, RequestInput, Scenario } from './types'
import type { Configuration, Decision, Method, Weights } from './decision'

const KEY = 'kosmos.decision.v1'
export const strings = (values: Weights) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))

export type DecisionState = ReturnType<typeof useDecision>

export function useDecision(catalog: Catalog | undefined) {
  const [method, setMethod] = useState<Method>()
  const [draft, setDraft] = useState<Record<string, string>>()
  const [scenario, setScenario] = useState<Scenario>('BASE')
  const [populationId, setPopulationId] = useState<string | null>(null)
  const [limit, setLimit] = useState(10)
  const [baseline, setBaseline] = useState<RequestInput | null>(null)
  const [response, setResponse] = useState<{ key: string; value: Decision }>()
  const [error, setError] = useState('')
  const [storage, setStorage] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [boot, setBoot] = useState(0)
  const revision = useRef(0)
  const operation = useRef<AbortController | null>(null)
  const backup = useRef<string | null>(null)
  const saveAllowed = useRef(false)
  const weights = draft ? Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() === '' ? NaN : Number(value)])) : undefined
  const valid = !!weights && Object.values(weights).every(value => Number.isFinite(value) && value >= 0) && Object.values(weights).some(value => value > 0)
  const makeConfig = (selectedWeights: Weights, selectedScenario: Scenario, expected: string | null, selectedMethod: Method, selectedLimit = limit, selectedBaseline = baseline): Configuration => ({
    format_version: 'kosmos-decision/1', expected_population_id: expected,
    request: {
      format_version: 'kosmos-search/1', case_id: catalog!.case_id, case_version: catalog!.case_version,
      source_hashes: catalog!.source_hashes, modes: 'A/B/C', method_version: selectedMethod.method_version,
      scenario: selectedScenario, weights: selectedWeights, limit: selectedLimit, baseline: selectedBaseline,
    },
  })
  const serialized = catalog && method && weights && valid ? JSON.stringify(makeConfig(weights, scenario, populationId, method)) : ''
  const result = response?.key === serialized ? response.value : undefined

  function persist(configuration: Configuration) {
    try {
      localStorage.setItem(KEY, JSON.stringify(configuration))
      backup.current = null
      setStorage('Настройки поиска сохранены. При восстановлении все рейтинги рассчитываются заново.')
    } catch { setStorage('Не удалось сохранить поиск в браузере. Скачайте JSON выбора.') }
  }

  useEffect(() => {
    if (!catalog) return
    const controller = new AbortController()
    let live = true
    async function start() {
      try {
        const currentMethod = await api<Method>('/api/decision-method', undefined, controller.signal)
        let restored: Decision | undefined
        let stored: string | null = null
        try { stored = localStorage.getItem(KEY) } catch { setStorage('Хранилище недоступно. Доступен JSON выбора.') }
        if (stored) {
          try { restored = await api<Decision>('/api/decision/recompute', stored, controller.signal) } catch (failure) {
            if (!live) return
            backup.current = stored
            setStorage(`Сохранённый поиск не восстановлен: ${(failure as Error).message} Исходную запись можно скачать. Следующая правка заменит её.`)
          }
        }
        if (!live) return
        setMethod(currentMethod)
        setDraft(strings(restored?.configuration.request.weights || currentMethod.weights))
        setScenario(restored?.configuration.request.scenario || 'BASE')
        setPopulationId(restored?.configuration.expected_population_id || null)
        setLimit(restored?.configuration.request.limit || 10)
        setBaseline(restored?.configuration.request.baseline || null)
        setError('')
        if (restored) setResponse({ key: JSON.stringify(restored.configuration), value: restored })
      } catch (failure) { if (live) setError((failure as Error).message) }
    }
    void start()
    return () => { live = false; controller.abort() }
  }, [catalog, boot])

  useEffect(() => {
    if (!serialized) return
    const controller = new AbortController()
    const ownRevision = revision.current
    let live = true
    const timer = setTimeout(async () => {
      try {
        const value = await api<Decision>('/api/decision/recompute', serialized, controller.signal)
        if (!live || ownRevision !== revision.current) return
        setResponse({ key: serialized, value })
        setError('')
        if (saveAllowed.current) persist(value.configuration)
      } catch (failure) {
        if (!live || ownRevision !== revision.current) return
        setResponse(undefined)
        setError((failure as Error).message)
      }
    }, 250)
    return () => { live = false; controller.abort(); clearTimeout(timer) }
  }, [serialized, retry])
  useEffect(() => () => operation.current?.abort(), [])

  function invalidate() {
    revision.current += 1
    operation.current?.abort()
    setBusy(false)
    setResponse(undefined)
    setError('')
    saveAllowed.current = true
    setRetry(value => value + 1)
  }
  const edit = (next: Record<string, string>) => { invalidate(); setDraft(next) }

  async function importFile(file: File) {
    if (!method || !catalog) return
    revision.current += 1
    operation.current?.abort()
    setResponse(undefined)
    setError('')
    if (file.size > 65_536) { setError('JSON выбора превышает 65 536 байт. Импортируйте настройки, без вычисленных результатов.'); return }
    const controller = new AbortController()
    operation.current = controller
    const ownRevision = revision.current
    setBusy(true)
    try {
      const value = await api<Decision>('/api/decision/recompute', file, controller.signal)
      if (revision.current !== ownRevision) return
      setDraft(strings(value.configuration.request.weights))
      setScenario(value.configuration.request.scenario)
      setPopulationId(value.configuration.expected_population_id)
      setLimit(value.configuration.request.limit)
      setBaseline(value.configuration.request.baseline)
      saveAllowed.current = true
      // Use the exact locally serialized input key, not server property order.
      setResponse({ key: JSON.stringify(makeConfig(value.configuration.request.weights, value.configuration.request.scenario, value.configuration.expected_population_id, method, value.configuration.request.limit, value.configuration.request.baseline)), value })
      persist(value.configuration)
    } catch (failure) {
      if (revision.current === ownRevision) setError(`Импорт выбора не выполнен; настройки не изменены. ${(failure as Error).message}`)
    } finally { if (revision.current === ownRevision) setBusy(false) }
  }

  async function exportFile() {
    if (!result) return
    const controller = new AbortController()
    operation.current?.abort()
    operation.current = controller
    const ownRevision = revision.current
    setBusy(true)
    try {
      const value = await api<Configuration>('/api/decision/export', serialized, controller.signal)
      if (revision.current === ownRevision) download(JSON.stringify(value, null, 2) + '\n', 'kosmos-decision.json')
    } catch (failure) { if (revision.current === ownRevision) setError((failure as Error).message) }
    finally { if (revision.current === ownRevision) setBusy(false) }
  }

  return {
    method, draft, scenario, limit, baseline, result, error, storage, busy, valid, weights,
    backup: backup.current, pendingRestore: !method || !draft,
    setScenario: (value: Scenario) => { invalidate(); setScenario(value) },
    setLimit: (value: number) => { invalidate(); setLimit(value) },
    setBaseline: (value: RequestInput | null) => { invalidate(); setBaseline(value) },
    setWeight: (key: string, value: string) => { if (draft) edit({ ...draft, [key]: value }) },
    setWeights: (values: Weights) => edit(strings(values)),
    reboot: () => setBoot(value => value + 1),
    downloadBackup: () => backup.current !== null && download(backup.current, 'kosmos-decision-backup.json'),
    invalidate, importFile, exportFile,
  }
}
