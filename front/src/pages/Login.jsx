import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 380,
        background: 'var(--surface)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        border: '1px solid var(--line)',
        padding: '36px 32px',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: 'var(--ink)', color: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>TI</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Troqueles INK</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Sistema de gestión</div>
          </div>
        </div>

        <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
          Iniciar sesión
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 12, color: 'var(--ink-3)' }}>
          Ingresa tus credenciales para continuar
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label className="field-label" style={{ display: 'block', marginBottom: 5 }}>
              Usuario
            </label>
            <input
              className="input"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="nombre de usuario"
              required
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label" style={{ display: 'block', marginBottom: 5 }}>
              Contraseña
            </label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{ width: '100%' }}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: 16, padding: '9px 12px',
              background: 'var(--danger-soft)', border: '1px solid var(--danger)',
              borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--danger)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn accent"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: '9px 16px', fontSize: 13 }}
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--ink-3)' }}>
        Troqueles INK · Sistema interno
      </div>
    </div>
  )
}
