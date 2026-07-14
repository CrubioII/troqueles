import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtNum, fmtCOP } from '../components/core'
import { Icon } from '../components/Icons'
import { RegistroMaquinaForm, RegistroMaquinaHistory } from '../components/RegistroMaquina'
import { getRegistrosMaquina } from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'

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

export default function Guillotina() {
  const navigate = useNavigate()

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
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mod">Guillotina</div>
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/produccion'))}>
            <Icon.ArrowLeft /> Volver
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', width: '100%' }}>

        <RegistroMaquinaForm maquina="guillotina" onCreated={() => loadRegistros(true)} />

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
    </div>
  )
}
