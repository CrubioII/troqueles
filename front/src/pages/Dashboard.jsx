import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ModuleCard } from '../components/core'
import { getDashboardStats } from '../api'
import {
  IngresosChart, TopClientesChart, OpsAtrasadasChart,
} from '../components/charts/DashboardCharts'

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
    key: 'produccion',
    label: 'Producción',
    desc: 'Hub de producción: Troqueles, Guillotina y progreso general de las órdenes.',
    action: 'Ver producción',
    path: '/produccion',
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
    desc: 'Liquida las OP completadas, envíalas a contaduría y consulta el historial.',
    action: 'Ver remisiones',
    path: '/remisiones',
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
    action: 'Ver clientes',
    path: '/clientes',
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
  const [stats, setStats] = useState(null)

  useEffect(() => {
    getDashboardStats().then(setStats).catch(() => setStats(null))
  }, [])

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
        padding: 'clamp(24px, 4vw, 40px) clamp(20px, 4vw, 40px) 0',
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

      {/* Gráficos financieros */}
      {stats?.financiero && (
        <div style={{
          padding: 'clamp(24px, 4vw, 40px) clamp(20px, 4vw, 40px)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}>
          <IngresosChart data={stats.financiero.ingresos_por_periodo} />
          <TopClientesChart data={stats.financiero.top_clientes} />
          <OpsAtrasadasChart data={stats.financiero.ops_atrasadas} />
        </div>
      )}
    </div>
  )
}
