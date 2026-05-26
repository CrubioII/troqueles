import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

function decodePayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]))
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
    const token = localStorage.getItem('access')
    if (token && !isExpired(token)) {
      const p = decodePayload(token)
      setUser({ username: p.username, role: p.role })
    }
    setReady(true)
  }, [])

  const login = useCallback(async (username, password) => {
    const res = await fetch('/api/auth/login/', {
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
