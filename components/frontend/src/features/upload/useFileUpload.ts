import { useState, useRef, useCallback } from 'react'
import { getAccessToken } from '../../lib/apiClient'

interface UploadState {
  progress: number           // 0–100
  status: 'idle' | 'uploading' | 'success' | 'error'
  jobId: string | null
  error: string | null
}

interface UseFileUploadReturn extends UploadState {
  upload: (file: File, referenceFile?: File, trackName?: string, alsFile?: File, genreHint?: string) => Promise<string>
  cancel: () => void
}

export function useFileUpload(): UseFileUploadReturn {
  const [state, setState] = useState<UploadState>({
    progress: 0,
    status: 'idle',
    jobId: null,
    error: null,
  })
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const upload = useCallback((file: File, referenceFile?: File, trackName?: string, alsFile?: File, genreHint?: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhrRef.current = xhr

      const fd = new FormData()
      fd.append('file', file)
      if (referenceFile) {
        fd.append('reference', referenceFile)
      }
      if (trackName?.trim()) {
        fd.append('track_name', trackName.trim())
      }
      if (alsFile) {
        fd.append('als', alsFile)
      }
      if (genreHint?.trim()) {
        fd.append('genre_hint', genreHint.trim())
      }

      // CRITICAL: register progress listener BEFORE xhr.open() —
      // attaching it after open() silently fails in some browsers.
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setState((prev) => ({
            ...prev,
            progress: Math.round((e.loaded / e.total) * 100),
          }))
        }
      })

      // Bypass Vite proxy for uploads — proxy buffers the body and stalls XHR progress.
      // Bearer token handles auth; CORS is configured for all localhost dev ports.
      // upload goes through Vite proxy
      xhr.open('POST', '/api/uploads/')

      // Attach Bearer token
      const token = getAccessToken()
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }

      xhr.withCredentials = true
      

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try {
            const data = JSON.parse(xhr.responseText) as { job_id: string }
            setState({ progress: 100, status: 'success', jobId: data.job_id, error: null })
            resolve(data.job_id)
          } catch {
            const msg = 'Invalid server response'
            setState((prev) => ({ ...prev, status: 'error', error: msg }))
            reject(new Error(msg))
          }
        } else {
          const msg = `Upload failed (${xhr.status})`
          setState((prev) => ({ ...prev, status: 'error', error: msg }))
          reject(new Error(msg))
        }
      }

      xhr.onerror = () => {
        const msg = 'Network error during upload'
        setState((prev) => ({ ...prev, status: 'error', error: msg }))
        reject(new Error(msg))
      }

      xhr.onabort = () => {
        setState({ progress: 0, status: 'idle', jobId: null, error: null })
        reject(new Error('Upload cancelled'))
      }

      setState({ progress: 0, status: 'uploading', jobId: null, error: null })
      xhr.send(fd)
    })
  }, [])

  const cancel = useCallback(() => {
    xhrRef.current?.abort()
    setState({ progress: 0, status: 'idle', jobId: null, error: null })
  }, [])

  return { ...state, upload, cancel }
}
