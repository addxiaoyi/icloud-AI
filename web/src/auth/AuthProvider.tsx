import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { request, registerUnauthorizedHandler, setCSRFToken } from '../api/client'
import type { LoginResult } from '../api/types'

type AuthStatus = 'checking' | 'anonymous' | 'authenticated'

interface AuthContextValue {
  status: AuthStatus
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  /** 会话过期时间(ms 时间戳), 未知为 null */
  expiresAt: number | null
  /** 续期当前会话, 返回新过期时间戳 */
  renew: () => Promise<number>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const checkRef = useRef(false)

  useEffect(() => {
    if (checkRef.current) return
    checkRef.current = true
    let cancelled = false
    request<LoginResult>('/api/auth/session', undefined, () => {
      // session 探测本身 401 不算"会话过期",交给状态判断
    })
      .then((data) => {
        if (cancelled) return
        setCSRFToken(data.csrf_token)
        if (data.expires_at) {
          const ts = new Date(data.expires_at).getTime()
          if (!Number.isNaN(ts)) setExpiresAt(ts)
        }
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const renew = useCallback(async (): Promise<number> => {
    const data = await request<LoginResult>('/api/auth/renew', {
      method: 'POST',
    })
    setCSRFToken(data.csrf_token)
    const ts = data.expires_at ? new Date(data.expires_at).getTime() : NaN
    if (!Number.isNaN(ts)) setExpiresAt(ts)
    return ts
  }, [])
  const logout = useCallback(async () => {
    setExpiresAt(null)
    try {
      await request('/api/auth/logout', { method: 'POST' })
    } catch {
      // 无论请求结果如何都清空本地状态
    }
    setCSRFToken(null)
    setExpiresAt(null)
    setStatus('anonymous')
  }, [])

  const handleUnauthorized = useCallback(() => {
    setCSRFToken(null)
    setExpiresAt(null)
    setStatus('anonymous')
  }, [])

  useEffect(() => {
    registerUnauthorizedHandler(handleUnauthorized)
    return () => registerUnauthorizedHandler(null)
  }, [handleUnauthorized])
  const login = useCallback(async (password: string) => {
    const data = await request<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    setCSRFToken(data.csrf_token)
    if (data.expires_at) {
          const ts = new Date(data.expires_at).getTime()
          if (!Number.isNaN(ts)) setExpiresAt(ts)
        }
    setStatus('authenticated')
  }, [])

  const value = useMemo(
    () => ({ status, login, logout, expiresAt, renew }),
    [status, login, logout, expiresAt, renew],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
