/** Presentation evidence from existing APIs. Request keys prevent stale claims. */
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Configuration } from './decision'
import type { Intelligence, Passport } from './intelligence'
import type { RequestInput } from './types'

export function useReadout<T>(path: string, input: string) {
  const [reply, setReply] = useState<{ key: string; data: T }>()
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const [attempt, setAttempt] = useState(0)
  const key = input ? `${input}:${attempt}` : ''
  useEffect(() => {
    if (!input) return
    const controller = new AbortController()
    let live = true
    api<T>(path, input, controller.signal).then(data => {
      if (live) setReply({ key, data })
    }).catch(error => {
      if (live) setFailure({ key, message: (error as Error).message })
    })
    return () => { live = false; controller.abort() }
  }, [path, input, key])
  return {
    data: key && reply?.key === key ? reply.data : undefined,
    error: key && failure?.key === key ? failure.message : '',
    retry: () => setAttempt(n => n + 1),
  }
}

export function useOfficialEvidence(search?: Configuration['request'], current?: RequestInput) {
  const input = search && current ? JSON.stringify({
    format_version: 'kosmos-intelligence/1', search, current,
    context: 'OFFICIAL', budget_cap: null, locks: [],
  }) : ''
  return useReadout<Intelligence>('/api/intelligence', input)
}

export function usePassport(current?: RequestInput) {
  return useReadout<Passport>('/api/passport', current ? JSON.stringify(current) : '')
}

export type LabSnapshot = {
  active: boolean
  context: 'OFFICIAL' | 'RESEARCH'; subjectKey: string; searchKey: string
  result?: Intelligence
}
