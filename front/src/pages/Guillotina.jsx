import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtNum, fmtCOP } from '../components/core'
import { Icon } from '../components/Icons'
import { RegistroMaquinaHistory } from '../components/RegistroMaquina'
import { getRegistrosMaquina } from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'
import EstacionMaquina from './EstacionMaquina'
import { useAuth } from '../context/AuthContext'

const BLOQUE_HORAS = 4

// Agrupa registros en bloques de 4 horas (00-04, 04-08, ... 20-24) por día.
function agruparPorBloque(registros) {
  const grupos = new Map()
  for (const r of registros) {
    const fecha = new Date(r.fecha_hora)
    const dia = fecha.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const bloqueIdx = Math.floor(fecha.getHours() / BLOQUE_HORAS)
    const inicio = bloqueIdx * BLOQUE_HORAS
    const fin = inicio + BLOQUE_HORAS
    const key = `${dia} ${inicio}-${fin}`
    if (!grupos.has(key)) {
      grupos.set(key, {
        key,
        dia,
        rango: `${String(inicio).padStart(2, '0')}:00 - ${String(fin).padStart(2, '0')}:00`,
        registros: [],
        total: 0,
        timestamp: fecha.getTime(),
      })
    }
    const grupo = grupos.get(key)
    grupo.registros.push(r)
    grupo.total += Number(r.costo) || 0
    if (fecha.getTime() > grupo.timestamp) grupo.timestamp = fecha.getTime()
  }
  return Array.from(grupos.values()).sort((a, b) => b.timestamp - a.timestamp)
}

// Legacy loose cuts (RegistroMaquina): description + cost typed by hand.
// Replaced by the station free record (the "+ Registro libre" button of the
// chain, which creates an OP and never touches money); kept read-only and
// Admin-only so the old cuts and their costs aren't lost.
function CortesAntiguos() {
  const [registros, setRegistros] = useState([])
  const [loadingRegistros, setLoadingRegistros] = useState(true)

  const loadRegistros = (silent = false) => {
    if (!silent) setLoadingRegistros(true)
    getRegistrosMaquina('?maquina=guillotina')
      .then(data => setRegistros(Array.isArray(data) ? data : (data.results || [])))
      .catch(() => {})
      .finally(() => setLoadingRegistros(false))
  }

  useEffect(() => { loadRegistros() }, [])

  useSyncPolling({ registros: () => loadRegistros(true) })

  const grupos = agruparPorBloque(registros)

  return (
    <div style={{ marginTop: 4 }}>
      {loadingRegistros ? (
        <div className="section" style={{ marginTop: 16, padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
          Cargando…
        </div>
      ) : grupos.length === 0 ? (
        <div className="section" style={{ marginTop: 16, padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
          Sin registros todavía
        </div>
      ) : (
        grupos.map(grupo => (
          <div className="section" key={grupo.key} style={{ marginTop: 16 }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--line)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
            }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {grupo.dia} · {grupo.rango}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                {fmtNum(grupo.registros.length)} corte{grupo.registros.length !== 1 ? 's' : ''} · Total: <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmtCOP(grupo.total)}</strong>
              </div>
            </div>
            <RegistroMaquinaHistory registros={grupo.registros} loading={false} showOrden={false} />
          </div>
        ))
      )}
    </div>
  )
}

// Página centralizada de Guillotina: corte inicial + corte final de las OPs en
// una sola cola, con su "+ Registro libre" para cortes sin OP. El Admin ve
// además la pestaña de cortes sueltos antiguos (con costo).
export default function Guillotina() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState('cadena')

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mod">Guillotina</div>
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={() => navigate('/produccion')}>
            <Icon.ArrowLeft /> Volver
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)', width: '100%' }}>
        {isAdmin && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {[['cadena', 'Cadena (OPs)'], ['antiguos', 'Cortes sueltos (antiguos)']].map(([id, label]) => (
            <button
              key={id}
              className={'btn' + (tab === id ? ' primary' : '')}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        )}

        {tab === 'cadena' || !isAdmin ? (
          <EstacionMaquina estaciones={['guillotina', 'guillotina_final']} embedded />
        ) : (
          <CortesAntiguos />
        )}
      </div>
    </div>
  )
}
