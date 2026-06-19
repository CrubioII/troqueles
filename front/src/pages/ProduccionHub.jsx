import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ModuleCard } from '../components/core'
import { Icon } from '../components/Icons'
import { getDashboardStats } from '../api'
import { UtilizacionChart } from '../components/charts/DashboardCharts'

const MODULES = [
  {
    key: 'troqueles',
    label: 'Troqueles',
    desc: 'OPs con fabricación de troquel: modelo, anotaciones técnicas y formato de cuchillas. El troquelado se gestiona en Producción General.',
    action: 'Entrar',
    path: '/produccion/troqueles',
    color: '#B8541C',
    soft: '#FBE9DA',
    icon: <Icon.Stamp />,
  },
  {
    key: 'guillotina',
    label: 'Guillotina',
    desc: 'Registra lo cortado en guillotina: descripción y costo cobrado. La fecha y hora se registran automáticamente.',
    action: 'Entrar',
    path: '/produccion/guillotina',
    color: '#3A5B8C',
    soft: '#DEE6F3',
    icon: <Icon.Blade />,
  },
  {
    key: 'general',
    label: 'Producción General',
    desc: 'Progreso de todas las órdenes de producción según sus procesos activos completados.',
    action: 'Entrar',
    path: '/produccion/general',
    color: '#2E7D5B',
    soft: '#DCEFE3',
    icon: <Icon.Progress />,
  },
]

export default function ProduccionHub() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [utilizacion, setUtilizacion] = useState(null)

  useEffect(() => {
    getDashboardStats().then(s => setUtilizacion(s.utilizacion_maquinas)).catch(() => {})
  }, [])

  const modules = isAdmin
    ? [...MODULES, {
        key: 'ordenes',
        label: 'Órdenes (CRUD)',
        desc: 'Crea, edita y elimina órdenes de producción.',
        action: 'Ver órdenes',
        path: '/ordenes',
        color: '#A67012',
        soft: '#FAEAC7',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M7 8h8M7 12h8M7 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ),
      }]
    : MODULES

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mod">Producción</div>
        </div>
      </div>

      <div style={{
        padding: 'clamp(24px, 4vw, 40px) clamp(20px, 4vw, 40px)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 16,
        alignContent: 'start',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
      }}>
        {modules.map(mod => (
          <ModuleCard key={mod.key} mod={mod} onNavigate={() => navigate(mod.path)} />
        ))}
      </div>

      {utilizacion && (
        <div style={{ padding: '0 clamp(20px, 4vw, 40px) clamp(24px, 4vw, 40px)', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <UtilizacionChart data={utilizacion} />
        </div>
      )}
    </div>
  )
}
