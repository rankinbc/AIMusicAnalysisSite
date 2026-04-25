import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'

// Module-level token store — never persisted to localStorage (XSS risk)
let accessToken: string | null = null
let isRefreshing = false
let refreshQueue: Array<(token: string | null) => void> = []

export const setAccessToken = (token: string | null): void => {
  accessToken = token
}

export const getAccessToken = (): string | null => accessToken

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // sends httpOnly refresh-token cookie on every request
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach Bearer token when present
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// Response interceptor: silent token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && !originalRequest._retry) {
      // If a refresh is already in flight, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push((token) => {
            if (token) {
              originalRequest.headers = {
                ...originalRequest.headers,
                Authorization: `Bearer ${token}`,
              }
              resolve(api(originalRequest))
            } else {
              reject(error)
            }
          })
        })
      }

      // Mark retry so we don't loop if refresh itself returns 401
      originalRequest._retry = true
      isRefreshing = true

      try {
        const { data } = await api.post<{ access_token: string }>('/auth/refresh')
        const newToken = data.access_token
        setAccessToken(newToken)
        // Replay queued requests with the fresh token
        refreshQueue.forEach((cb) => cb(newToken))
        refreshQueue = []
        originalRequest.headers = {
          ...originalRequest.headers,
          Authorization: `Bearer ${newToken}`,
        }
        return api(originalRequest)
      } catch {
        // Refresh failed — clear token and redirect to login
        setAccessToken(null)
        refreshQueue.forEach((cb) => cb(null))
        refreshQueue = []
        window.location.href = '/login'
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)

export default api
