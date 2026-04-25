import { useState, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFileUpload } from './useFileUpload'

const ACCEPTED_EXTENSIONS = ['.mp3', '.flac', '.wav']
const MAX_SIZE_BYTES = 200 * 1024 * 1024 // 200 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function validateFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return 'Unsupported format. Please upload an MP3, FLAC, or WAV file.'
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File is too large (${formatBytes(file.size)}). Maximum is 200 MB.`
  }
  return null
}

export default function UploadPage() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { progress, status, error: uploadError, upload, cancel } = useFileUpload()

  const [mainFile, setMainFile] = useState<File | null>(null)
  const [refFile, setRefFile] = useState<File | null>(null)
  const [alsFile, setAlsFile] = useState<File | null>(null)
  const [trackName, setTrackName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [fileError, setFileError] = useState('')
  const [alsFileError, setAlsFileError] = useState('')

  const mainInputRef = useRef<HTMLInputElement>(null)
  const refInputRef = useRef<HTMLInputElement>(null)
  const alsInputRef = useRef<HTMLInputElement>(null)

  function validateAlsFile(file: File): string | null {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'als') return 'Must be an Ableton Live Set (.als) file'
    if (file.size > 50 * 1024 * 1024) return 'ALS file is too large (max 50 MB)'
    return null
  }

  function handleAlsChange(file: File | null) {
    if (!file) { setAlsFile(null); setAlsFileError(''); return }
    const err = validateAlsFile(file)
    if (err) { setAlsFileError(err); setAlsFile(null) } else { setAlsFile(file); setAlsFileError('') }
  }

  const handleFileSelect = useCallback((file: File) => {
    const err = validateFile(file)
    if (err) {
      setFileError(err)
      return
    }
    setFileError('')
    setMainFile(file)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    // handleFileSelect is defined in the same render scope and stable across renders
    // because it only closes over setState (which React guarantees to be stable).
    [handleFileSelect],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mainFile) return
    try {
      const jobId = await upload(mainFile, refFile ?? undefined, trackName || undefined, alsFile ?? undefined)
      navigate(`/jobs/${jobId}`)
    } catch {
      // error state already set in useFileUpload
    }
  }

  const isUploading = status === 'uploading'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between border-b border-gray-800 px-8 py-4">
        <span className="font-bold text-purple-400">AI Music Analyzer</span>
        <div className="flex items-center gap-4">
          <Link to="/upload" className="text-sm text-white">Upload</Link>
          <Link to="/history" className="text-sm text-gray-400 hover:text-white">History</Link>
          <Link to="/tracks" className="text-sm text-gray-400 hover:text-white">Track History</Link>
          <button
            onClick={logout}
            className="text-sm text-gray-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-2 text-3xl font-bold">Analyze Your Track</h1>
        <p className="mb-8 text-gray-400">
          Upload an audio file for a comprehensive 7-phase mix analysis.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Main file drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => mainInputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition ${
              dragOver
                ? 'border-purple-400 bg-purple-900/20'
                : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <input
              ref={mainInputRef}
              type="file"
              accept=".mp3,.flac,.wav"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileSelect(f)
              }}
            />
            {mainFile ? (
              <div>
                <p className="text-lg font-semibold text-green-400">{mainFile.name}</p>
                <p className="mt-1 text-sm text-gray-400">{formatBytes(mainFile.size)}</p>
                <p className="mt-2 text-xs text-gray-500">Click or drop to replace</p>
              </div>
            ) : (
              <div>
                <p className="mb-4 text-5xl">🎵</p>
                <p className="font-medium text-gray-300">
                  Drop your track here, or click to browse
                </p>
                <p className="mt-2 text-sm text-gray-500">MP3, FLAC, WAV — up to 200 MB</p>
              </div>
            )}
          </div>

          {fileError && <p className="text-sm text-red-400">{fileError}</p>}

          {/* Track name (optional — for version tracking) */}
          <div className="rounded-xl bg-gray-900 p-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Track Name{' '}
              <span className="font-normal text-gray-500">(optional — used to track versions)</span>
            </label>
            <input
              type="text"
              value={trackName}
              onChange={(e) => setTrackName(e.target.value)}
              placeholder="e.g. Deadlock, Summer Demo..."
              maxLength={200}
              className="w-full rounded-lg bg-gray-800 border border-gray-600 px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>

          {/* Optional reference track */}
          <div className="rounded-xl bg-gray-900 p-4">
            <p className="mb-2 text-sm font-medium text-gray-300">
              Reference track{' '}
              <span className="text-gray-500 font-normal">(optional)</span>
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => refInputRef.current?.click()}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm transition hover:bg-gray-700"
              >
                {refFile ? refFile.name : 'Choose reference file'}
              </button>
              {refFile && (
                <button
                  type="button"
                  onClick={() => setRefFile(null)}
                  className="text-gray-500 hover:text-white"
                  aria-label="Remove reference file"
                >
                  ✕
                </button>
              )}
              <input
                ref={refInputRef}
                type="file"
                accept=".mp3,.flac,.wav"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setRefFile(f)
                }}
              />
            </div>
          </div>

          {/* Optional Ableton project file */}
          <div className="rounded-xl bg-gray-900 p-4">
            <p className="mb-1 text-sm font-medium text-gray-300">
              Ableton Project File{' '}
              <span className="text-gray-500 font-normal">(optional)</span>
            </p>
            <p className="mb-2 text-xs text-gray-500">
              Upload your .als file for project health scoring, MIDI analysis, and arrangement review
            </p>
            {alsFile ? (
              <div className="flex items-center gap-2 text-sm text-zinc-300 bg-zinc-800 rounded px-3 py-2">
                <span className="flex-1 truncate">{alsFile.name}</span>
                <button
                  type="button"
                  onClick={() => handleAlsChange(null)}
                  className="text-zinc-500 hover:text-zinc-300 text-xs"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => alsInputRef.current?.click()}
                className="text-sm text-gray-400 hover:text-white underline"
              >
                + Add .als file
              </button>
            )}
            <input
              ref={alsInputRef}
              type="file"
              accept=".als"
              className="hidden"
              onChange={(e) => handleAlsChange(e.target.files?.[0] ?? null)}
            />
            {alsFileError && <p className="text-red-400 text-xs mt-1">{alsFileError}</p>}
          </div>

          {/* Upload progress bar */}
          {isUploading && (
            <div>
              <div className="mb-1 flex justify-between text-sm text-gray-400">
                <span>Uploading…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-800">
                <div
                  className="h-2 rounded-full bg-purple-500 transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={!mainFile || isUploading}
              className="flex-1 rounded-xl bg-purple-600 py-4 text-lg font-bold text-white transition hover:bg-purple-700 disabled:opacity-40"
            >
              {isUploading ? `Uploading ${progress}%…` : 'Analyze Track'}
            </button>
            {isUploading && (
              <button
                type="button"
                onClick={cancel}
                className="rounded-xl border border-gray-700 px-6 py-4 text-sm text-gray-400 transition hover:border-gray-500 hover:text-white"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}
