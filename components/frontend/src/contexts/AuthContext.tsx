import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api, { setAccessToken } from '../lib/apiClient'

interface AuthContextValue {
  accessToken: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  register: (email: string, password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Access token lives ONLY in React state — never localStorage (XSS risk)
  const [accessToken, setToken] = useState<string | null>(null)
  // isLoading stays true until the silent refresh attempt settles
  const [isLoading, setIsLoading] = useState(true)

  // Silent refresh on mount: attempt to exchange the httpOnly refresh cookie for a
  // fresh access token before any protected route renders.
  useEffect(() => {
    api
      .post<{ access_token: string }>('/auth/refresh')
      .then(({ data }) => {
        setAccessToken(data.access_token)
        setToken(data.access_token)
      })
      .catch(() => {
        setAccessToken(null)
        setToken(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ access_token: string }>('/auth/login', {
      email,
      password,
    })
    setAccessToken(data.access_token)
    setToken(data.access_token)
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    setAccessToken(null)
    setToken(null)
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ access_token: string }>('/auth/register', {
      email,
      password,
    })
    setAccessToken(data.access_token)
    setToken(data.access_token)
  }, [])

  return (
    <AuthContext.Provider value={{ accessToken, isLoading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- intentional: context file exports both provider and hook
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
