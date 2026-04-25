import { useState, useEffect } from 'react'

interface StreamState {
  phase: number
  phaseName: string
  pct: number      // 0.0–1.0 within the current phase
  status: string   // 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED'
  done: boolean
  error: string | null
}

const INITIAL_STATE: StreamState = {
  phase: 0,
  phaseName: '',
  pct: 0,
  status: 'PENDING',
  done: false,
  error: null,
}

export function useJobStream(jobId: string | undefined): StreamState {
  const [state, setState] = useState<StreamState>(INITIAL_STATE)

  useEffect(() => {
    if (!jobId) return

    // EventSource with withCredentials sends the httpOnly refresh cookie.
    // The API must respond with an explicit origin (not *) for credentialed requests.
    const es = new EventSource(`/api/jobs/${jobId}/stream`, { withCredentials: true })

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as {
          phase?: number
          phase_name?: string
          pct?: number
          status?: string
        }
        setState((prev) => ({
          ...prev,
          phase: data.phase ?? prev.phase,
          phaseName: data.phase_name ?? prev.phaseName,
          pct: data.pct ?? prev.pct,
          status: data.status ?? prev.status,
        }))
      } catch {
        // Ignore malformed events
      }
    }

    es.addEventListener('complete', () => {
      setState((prev) => ({ ...prev, done: true, status: 'COMPLETE' }))
      es.close()
    })

    // Named 'error' SSE events (distinct from the onerror network handler below)
    es.addEventListener('error', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data ?? '{}') as {
          error?: string
        }
        setState((prev) => ({
          ...prev,
          error: data.error ?? 'Analysis failed',
          status: 'FAILED',
        }))
      } catch {
        setState((prev) => ({ ...prev, error: 'Analysis failed', status: 'FAILED' }))
      }
      es.close()
    })

    // Network / connection errors
    es.onerror = () => {
      // Only treat as error if we haven't already completed
      setState((prev) => {
        if (prev.done) return prev
        return { ...prev, error: 'Connection lost', status: 'FAILED' }
      })
      es.close()
    }

    // CRITICAL: close the EventSource on unmount to prevent dangling connections
    return () => {
      es.close()
    }
  }, [jobId])

  return state
}
