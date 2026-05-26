import { PROCESOS_OP, MAQUINAS_OP } from './core'

function Semaforo({ estado }) {
  return <div className={`semaforo ${estado || 'pendiente'}`} style={{ marginTop: 1 }} />
}

export default function MaquinaBoard({ procesos, currentUserId }) {
  // Group active processes by machine
  const byMaquina = {}
  PROCESOS_OP.forEach(([pid, label, mid]) => {
    const p = procesos[pid]
    if (!p?.active) return
    if (!byMaquina[mid]) byMaquina[mid] = []
    byMaquina[mid].push({ pid, label, ...p })
  })

  const activeMaquinas = MAQUINAS_OP.filter(m => byMaquina[m.id])
  if (activeMaquinas.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--ink-3)', fontSize: 12, textAlign: 'center' }}>
        Ningún proceso activo aún. Activa procesos en la sección correspondiente.
      </div>
    )
  }

  return (
    <div className="maquina-board">
      {activeMaquinas.map(maq => (
        <div
          key={maq.id}
          className="maquina-card"
          style={byMaquina[maq.id].some(p => p.operario === currentUserId)
            ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-soft)' }
            : {}}
        >
          <div className="maquina-card-header">{maq.label}</div>
          {byMaquina[maq.id].map(p => (
            <div key={p.pid} className="maquina-proc-row">
              <Semaforo estado={p.estado} />
              <span className="maquina-proc-label">{p.label}</span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="maquina-proc-op">{p.operarioNombre || '—'}</span>
                {p.unidadesCompletadas > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {p.unidadesCompletadas} u
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
