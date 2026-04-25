import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedLayout from './components/ui/ProtectedLayout'
import Login from './features/auth/Login'
import Register from './features/auth/Register'
import UploadPage from './features/upload/UploadPage'
import JobProgressPage from './features/analysis/JobProgressPage'
import ReportPage from './features/report/ReportPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected routes — require a valid access token */}
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Navigate to="/upload" replace />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/jobs/:id" element={<JobProgressPage />} />
            <Route path="/jobs/:id/report" element={<ReportPage />} />
          </Route>

          {/* Catch-all: redirect unknown paths to upload (will bounce to login if unauthed) */}
          <Route path="*" element={<Navigate to="/upload" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
