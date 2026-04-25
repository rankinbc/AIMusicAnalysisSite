import ReactMarkdown from 'react-markdown'

interface Props {
  text: string
  loading: boolean
  error?: string
}

export default function ExpertOutput({ text, loading, error }: Props) {
  if (error) {
    return <p className="mt-3 text-sm text-red-400">{error}</p>
  }

  if (!text && !loading) return null

  return (
    <div className="mt-3">
      {loading && !text && (
        <p className="animate-pulse text-sm text-gray-400">Generating analysis…</p>
      )}
      {text && (
        <div className="prose prose-sm prose-invert max-w-none rounded-md bg-gray-800 p-4 text-xs leading-relaxed">
          <ReactMarkdown>{text}</ReactMarkdown>
          {loading && (
            <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-gray-200" />
          )}
        </div>
      )}
    </div>
  )
}
