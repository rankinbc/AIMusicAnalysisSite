import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
    </div>
  )
}

/**
 * Wraps all protected routes. Shows a spinner while the silent refresh is in
 * flight (isLoading=true) so valid sessions don't flash a redirect to /login.
 */
export default function ProtectedLayout() {
  const { accessToken, isLoading } = useAuth()
  const location = useLocation()

  // While the AuthContext is still resolving the silent refresh, show a loader
  // rather than redirecting — otherwise a page reload always kicks the user out.
  if (isLoading) return <Spinner />

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
