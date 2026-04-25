import { useState, useCallback, useRef } from 'react'
import apiClient, { getAccessToken } from '../../lib/apiClient'
import type { TriageResult, SpecialistName } from '../../types/api'

export interface ExpertAnalysisState {
  triage: TriageResult | null
  triageLoading: boolean
  triageError: string | null
  specialistOutputs: Partial<Record<SpecialistName, string>>
  specialistLoading: Partial<Record<SpecialistName, boolean>>
  specialistErrors: Partial<Record<SpecialistName, string>>
  runTriage: () => Promise<void>
  runSpecialist: (name: SpecialistName) => void
  cancelSpecialist: (name: SpecialistName) => void
}

export function useExpertAnalysis(jobId: string): ExpertAnalysisState {
  const [triage, setTriage] = useState<TriageResult | null>(null)
  const [triageLoading, setTriageLoading] = useState(false)
  const [triageError, setTriageError] = useState<string | null>(null)
  const [specialistOutputs, setSpecialistOutputs] = useState<Partial<Record<SpecialistName, string>>>({})
  const [specialistLoading, setSpecialistLoading] = useState<Partial<Record<SpecialistName, boolean>>>({})
  const [specialistErrors, setSpecialistErrors] = useState<Partial<Record<SpecialistName, string>>>({})

  // Abort controllers keyed by specialist name for cancellation
  const abortRefs = useRef<Partial<Record<SpecialistName, AbortController>>>({})

  const runTriage = useCallback(async () => {
    setTriageLoading(true)
    setTriageError(null)
    try {
      const { data } = await apiClient.post<TriageResult>(`/experts/${jobId}/triage`)
      setTriage(data)
    } catch (e: any) {
      setTriageError(e.response?.data?.detail ?? e.message ?? 'Triage failed')
    } finally {
      setTriageLoading(false)
    }
  }, [jobId])

  const runSpecialist = useCallback((name: SpecialistName) => {
    // Cancel any existing stream for this specialist
    abortRefs.current[name]?.abort()
    const controller = new AbortController()
    abortRefs.current[name] = controller

    setSpecialistLoading(prev => ({ ...prev, [name]: true }))
    setSpecialistErrors(prev => ({ ...prev, [name]: undefined }))
    setSpecialistOutputs(prev => ({ ...prev, [name]: '' }))

    // Use fetch (not axios) for streaming — axios doesn't support ReadableStream.
    // Read the token from the module-level store in apiClient (set via setAccessToken).
    const token = getAccessToken()

    fetch(`/api/experts/${jobId}/specialist/${name}`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}))
          throw new Error(body?.detail ?? `HTTP ${resp.status}`)
        }

        if (!resp.body) throw new Error('Streaming not supported in this browser')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // SSE lines: "event: chunk\ndata: {...}\n\n"
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''

          for (const part of parts) {
            const dataLine = part.split('\n').find(l => l.startsWith('data: '))
            if (!dataLine) continue
            try {
              const payload = JSON.parse(dataLine.slice(6))
              if ('text' in payload) {
                setSpecialistOutputs(prev => ({
                  ...prev,
                  [name]: (prev[name] ?? '') + payload.text,
                }))
              }
            } catch {
              // ignore malformed SSE data lines
            }
          }
        }
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setSpecialistErrors(prev => ({ ...prev, [name]: err.message }))
        }
      })
      .finally(() => {
        setSpecialistLoading(prev => ({ ...prev, [name]: false }))
        delete abortRefs.current[name]
      })
  }, [jobId])

  const cancelSpecialist = useCallback((name: SpecialistName) => {
    abortRefs.current[name]?.abort()
    setSpecialistLoading(prev => ({ ...prev, [name]: false }))
  }, [])

  return {
    triage, triageLoading, triageError,
    specialistOutputs, specialistLoading, specialistErrors,
    runTriage, runSpecialist, cancelSpecialist,
  }
}
