import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import api from '../lib/apiClient'
import type { TrackGroup } from '../types/api'
import { useAuth } from '../contexts/AuthContext'

export default function TrackHistoryPage() {
  const { logout } = useAuth()
  const [tracks, setTracks] = useState<TrackGroup[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<TrackGroup[]>('/tracks')
      .then(({ data }) => {
        setTracks(data)
        if (data.length > 0) setSelected(data[0].track_name)
      })
      .catch(() => setError('Failed to load track history.'))
      .finally(() => setLoading(false))
  }, [])

  const selectedTrack = tracks.find((t) => t.track_name === selected) ?? tracks[0]

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between border-b border-gray-800 px-8 py-4">
        <span className="font-bold text-purple-400">AI Music Analyzer</span>
        <div className="flex items-center gap-4">
          <Link to="/upload" className="text-sm text-gray-400 hover:text-white">Upload</Link>
          <Link to="/history" className="text-sm text-gray-400 hover:text-white">History</Link>
          <Link to="/tracks" className="text-sm text-white">Track History</Link>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-white">Sign out</button>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl p-8">
        <h1 className="mb-6 text-3xl font-bold">Track History</h1>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
          </div>
        )}

        {error && <p className="text-red-400">{error}</p>}

        {!loading && !error && tracks.length === 0 && (
          <div className="rounded-2xl bg-gray-900 p-12 text-center">
            <p className="text-xl text-gray-400">No named tracks yet.</p>
            <p className="mt-2 text-gray-500">
              Add a track name when uploading to start tracking versions.
            </p>
            <Link
              to="/upload"
              className="mt-4 inline-block rounded-xl bg-purple-600 px-8 py-3 font-bold text-white transition hover:bg-purple-700"
            >
              Upload a Track
            </Link>
          </div>
        )}

        {!loading && tracks.length > 0 && selectedTrack && (
          <div className="grid grid-cols-3 gap-6">
            {/* Track list */}
            <div className="col-span-1 space-y-2">
              {tracks.map((t) => (
                <button
                  key={t.track_name}
                  onClick={() => setSelected(t.track_name)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    selectedTrack.track_name === t.track_name
                      ? 'border-purple-500 bg-purple-950'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-600'
                  }`}
                >
                  <div className="font-semibold text-white">{t.track_name}</div>
                  <div className="text-sm text-gray-400">
                    {t.version_count} version{t.version_count !== 1 ? 's' : ''}
                    {t.latest_score != null && (
                      <span className="ml-2 font-medium text-gray-300">
                        Latest: {Math.round(t.latest_score)}
                        {t.latest_grade && ` (${t.latest_grade})`}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Chart + version table */}
            <div className="col-span-2">
              <h2 className="mb-4 text-xl font-bold">{selectedTrack.track_name}</h2>

              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={selectedTrack.versions}>
                  <XAxis
                    dataKey="filename"
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151' }}
                    labelStyle={{ color: '#e5e7eb' }}
                    itemStyle={{ color: '#a78bfa' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={{ fill: '#a78bfa', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>

              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-gray-400">
                    <th className="pb-2">File</th>
                    <th className="pb-2">Score</th>
                    <th className="pb-2">Grade</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {selectedTrack.versions.map((v) => (
                    <tr key={v.job_id}>
                      <td className="max-w-xs truncate py-2 text-gray-200">{v.filename}</td>
                      <td className="py-2 text-white">
                        {v.score != null ? Math.round(v.score) : '—'}
                      </td>
                      <td className="py-2 text-gray-300">{v.grade ?? '—'}</td>
                      <td className="py-2 text-gray-400">
                        {new Date(v.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        <Link
                          to={`/jobs/${v.job_id}/report`}
                          className="text-purple-400 hover:text-purple-300"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
