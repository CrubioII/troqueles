import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const MODULES = [
  {
    key: 'cotizaciones',
    label: 'Cotizaciones',
    desc: 'Crea, edita y envía cotizaciones a clientes. Gestiona el ciclo de aprobación.',
    action: 'Ver cotizaciones',
    path: '/cotizaciones',
    color: '#B8541C',
    soft: '#FBE9DA',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 8h8M7 12h8M7 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M17 14l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'ordenes',
    label: 'Órdenes de Producción',
    desc: 'Administra el flujo de producción. Visualiza avances, máquinas y operaciones activas.',
    action: 'Ver producción',
    path: '/ordenes',
    color: '#2E7D5B',
    soft: '#DCEFE3',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="7" width="20" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 7V5a2 2 0 014 0v2M13 7V5a2 2 0 014 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M6 13h4M6 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="17" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M17 13.5v1l.8.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'remisiones',
    label: 'Remisiones',
    desc: 'Registra y consulta entregas parciales de producción. Próximamente disponible.',
    action: 'Próximamente',
    path: null,
    color: '#3A5B8C',
    soft: '#DEE6F3',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M3 6h18M3 12h12M3 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="18" cy="18" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M16.5 18l1 1 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'clientes',
    label: 'Clientes',
    desc: 'Gestiona el directorio de clientes: contactos, historial y datos de facturación.',
    action: 'Próximamente',
    path: null,
    color: '#A67012',
    soft: '#FAEAC7',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 20c0-4 3.13-7 7-7s7 3 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M16 11c1.66 0 3 1.34 3 3M19 14c1.1 0 2 .9 2 2s-.9 2-2 2h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

      {/* Greeting banner */}
      <div style={{
        background: 'linear-gradient(135deg, #1B1816 0%, #2D2520 60%, #3A2A1F 100%)',
        padding: 'clamp(28px, 5vw, 44px) clamp(24px, 5vw, 48px)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -40, top: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(184,84,28,0.12)' }} />
        <div style={{ position: 'absolute', right: 80, bottom: -60, width: 140, height: 140, borderRadius: '50%', background: 'rgba(184,84,28,0.08)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 700, color: '#FAF7F1', lineHeight: 1.2 }}>
            ¡Hola, <span style={{ color: '#E8845A', fontStyle: 'italic' }}>{user?.username}</span>!
          </div>
          <div style={{ fontSize: 14, color: 'rgba(250,247,241,0.55)', marginTop: 6 }}>
            Troqueles INK — ¿qué deseas gestionar hoy?
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div style={{
        padding: 'clamp(24px, 4vw, 40px) clamp(20px, 4vw, 40px)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 16,
        alignContent: 'start',
      }}>
        {MODULES.map(mod => (
          <ModuleCard
            key={mod.key}
            mod={mod}
            onNavigate={() => mod.path && navigate(mod.path)}
          />
        ))}
      </div>
    </div>
  )
}

function ModuleCard({ mod, onNavigate }) {
  const disabled = !mod.path

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderRadius: 10,
        border: '1px solid var(--line)',
        borderTop: `3px solid ${mod.color}`,
        padding: '20px 20px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
        opacity: disabled ? 0.72 : 1,
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow 0.15s, transform 0.15s',
        cursor: disabled ? 'default' : 'pointer',
      }}
      onClick={disabled ? undefined : onNavigate}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.boxShadow = 'var(--shadow-md)'
          e.currentTarget.style.transform = 'translateY(-1px)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: mod.color, marginBottom: 3 }}>
          {mod.label}
        </div>
        <div style={{
          width: 38, height: 38, borderRadius: 8,
          background: mod.soft, color: mod.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {mod.icon}
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, flex: 1 }}>
        {mod.desc}
      </div>

      <div>
        <button
          onClick={e => { e.stopPropagation(); if (!disabled) onNavigate() }}
          disabled={disabled}
          style={{
            padding: '6px 14px',
            background: 'transparent',
            border: `1px solid ${disabled ? 'var(--line)' : mod.color}`,
            borderRadius: 6,
            color: disabled ? 'var(--ink-3)' : mod.color,
            fontSize: 12, fontWeight: 500,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'background 0.12s',
          }}
          onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = mod.soft }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {mod.action} →
        </button>
      </div>
    </div>
  )
}
