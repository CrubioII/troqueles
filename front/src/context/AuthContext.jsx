import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { refreshAccessToken, BASE } from '../api'

const AuthContext = createContext(null)

function decodePayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function isExpired(token) {
  const p = decodePayload(token)
  if (!p?.exp) return true
  return Date.now() / 1000 > p.exp
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let token = localStorage.getItem('access')
      if (!token || isExpired(token)) {
        await refreshAccessToken()
        token = localStorage.getItem('access')
      }
      if (token && !isExpired(token)) {
        // El token trae username/role como claims: restaurar la sesión sin red.
        const claims = decodePayload(token)
        if (claims?.username && claims?.role) {
          setUser({ username: claims.username, role: claims.role })
          setReady(true)
          return
        }
        // Tokens emitidos antes del deploy de claims: caer a /auth/me/.
        try {
          const res = await fetch(`${BASE}/auth/me/`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const data = await res.json()
            if (!cancelled) setUser({ username: data.username, role: data.role })
          } else {
            localStorage.removeItem('access')
            localStorage.removeItem('refresh')
          }
        } catch {
          // network error: leave tokens as-is, treat as logged out for this load
        }
      } else {
        localStorage.removeItem('access')
        localStorage.removeItem('refresh')
      }
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${BASE}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.detail || 'Credenciales incorrectas')
    }
    const data = await res.json()
    localStorage.setItem('access', data.access)
    localStorage.setItem('refresh', data.refresh)
    setUser({ username: data.username, role: data.role })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('access')
    localStorage.removeItem('refresh')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
