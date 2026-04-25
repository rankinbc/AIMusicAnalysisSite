import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/apiClient'
import type { JobSummary } from '../types/api'
import { useAuth } from '../contexts/AuthContext'

const gradeColor: Record<string, string> = {
  A: 'bg-green-900 text-green-300',
  B: 'bg-lime-900 text-lime-300',
  C: 'bg-yellow-900 text-yellow-300',
  D: 'bg-orange-900 text-orange-300',
  F: 'bg-red-900 text-red-300',
}

const statusColor: Record<string, string> = {
  COMPLETE: 'text-green-400',
  PROCESSING: 'text-yellow-400',
  PENDING: 'text-gray-400',
  FAILED: 'text-red-400',
}

export default function HistoryPage() {
  const { logout } = useAuth()
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<JobSummary[]>('/jobs')
      .then(({ data }) => setJobs(data))
      .catch(() => setError('Failed to load history.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between border-b border-gray-800 px-8 py-4">
        <span className="font-bold text-purple-400">AI Music Analyzer</span>
        <div className="flex items-center gap-4">
          <Link to="/upload" className="text-sm text-gray-400 hover:text-white">Upload</Link>
          <Link to="/history" className="text-sm text-white">History</Link>
          <Link to="/tracks" className="text-sm text-gray-400 hover:text-white">Track History</Link>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-white">Sign out</button>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl p-8">
        <h1 className="mb-6 text-3xl font-bold">Analysis History</h1>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
          </div>
        )}

        {error && <p className="text-red-400">{error}</p>}

        {!loading && !error && jobs.length === 0 && (
          <div className="rounded-2xl bg-gray-900 p-12 text-center">
            <p className="text-xl text-gray-400">No analyses yet.</p>
            <Link
              to="/upload"
              className="mt-4 inline-block rounded-xl bg-purple-600 px-8 py-3 font-bold text-white transition hover:bg-purple-700"
            >
              Upload Your First Track
            </Link>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <div className="overflow-hidden rounded-2xl bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-400">
                  <th className="px-6 py-4">File</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Score</th>
                  <th className="px-6 py-4">Grade</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {jobs.map((job) => (
                  <tr key={job.job_id} className="hover:bg-gray-800/50 transition">
                    <td className="max-w-xs truncate px-6 py-4 font-medium text-gray-200">
                      {job.filename}
                    </td>
                    <td className={`px-6 py-4 font-medium ${statusColor[job.status] ?? 'text-gray-400'}`}>
                      {job.status}
                    </td>
                    <td className="px-6 py-4 text-white">
                      {job.score != null ? Math.round(job.score) : '—'}
                    </td>
                    <td className="px-6 py-4">
                      {job.grade ? (
                        <span className={`rounded px-2 py-0.5 text-xs font-bold ${gradeColor[job.grade] ?? 'bg-gray-800 text-gray-300'}`}>
                          {job.grade}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      {new Date(job.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      {job.status === 'COMPLETE' && (
                        <Link
                          to={`/jobs/${job.job_id}/report`}
                          className="text-purple-400 hover:text-purple-300"
                        >
                          View report →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
