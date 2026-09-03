import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ModuleCard, ESTACIONES_CONFIG, ESTACIONES_ORDEN } from '../components/core'
import { Icon } from '../components/Icons'
import { getDashboardStats } from '../api'
import { UtilizacionChart } from '../components/charts/DashboardCharts'
import { puedeEstacion, puedeTroqueles, puedeRemisionesGenerales } from '../lib/accesoProduccion'

// Módulos cuyo acceso depende del rol de producción del Operador (ver
// back/cotizaciones/roles.py). Lo que no aparece acá (p. ej. 'ordenes') queda
// visible para cualquier autenticado.
function puedeModulo(key, user) {
  if (key === 'troqueles') return puedeTroqueles(user)
  if (key === 'general') return puedeRemisionesGenerales(user)
  return puedeEstacion(user, key)
}

// Las cuatro estaciones van primero y en orden de cadena: el hub debe leerse
// como el recorrido real de una OP por el taller.
const ESTACION_ICONS = {
  impresora: <Icon.Printer />,
  laminadora: <Icon.Layers />,
  barnizadora: <Icon.Drop />,
  troqueladora: <Icon.Blade />,
}

const ESTACION_MODULES = ESTACIONES_ORDEN.map((id, i) => {
  const cfg = ESTACIONES_CONFIG[id]
  return {
    key: id,
    label: `${i + 1}. ${cfg.label}`,
    desc: cfg.desc,
    action: 'Entrar',
    path: cfg.ruta,
    color: cfg.color,
    soft: cfg.soft,
    icon: ESTACION_ICONS[id],
  }
})

const MODULES = [
  ...ESTACION_MODULES,
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
    desc: 'Corte inicial, cadena y corte final de las OPs, más el registro libre de cortes sueltos — todo en un solo lugar.',
    action: 'Entrar',
    path: '/produccion/guillotina',
    color: '#6B5B95',
    soft: '#EAE6F2',
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

  // Órdenes (CRUD): solo General (o Admin) — Guillotina/Estaciones/Troquelador
  // no la ven ni pueden entrar (ver back/cotizaciones/roles.py).
  const modules = MODULES.filter(mod => puedeModulo(mod.key, user))
  if (puedeRemisionesGenerales(user)) {
    modules.push({
      key: 'ordenes',
      label: 'Órdenes de producción',
      desc: isAdmin
        ? 'Crea, edita y elimina órdenes de producción.'
        : 'Crea una orden de producción con los datos del trabajo. Los precios los pone el administrador.',
      action: isAdmin ? 'Ver órdenes' : 'Crear OP',
      path: '/ordenes',
      color: '#A67012',
      soft: '#FAEAC7',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 8h8M7 12h8M7 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    })
  }

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
