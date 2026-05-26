import { fmtCOP, fmtNum, OP_STATUS_DEFS, OP_PROCESO_ESTADOS, PROCESOS_OP } from './core'

function OpBadge({ estado }) {
  const def = OP_STATUS_DEFS.find(s => s.id === estado)
  if (!def) return null
  return (
    <span className={'badge ' + def.cls} style={{ fontSize: 11 }}>
      <span className="dot"></span>
      {def.label}
    </span>
  )
}

function ProgressBar({ value, label }) {
  const color = value >= 100 ? 'var(--ok)' : value > 0 ? 'var(--warn)' : 'var(--ink-3)'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color }}>{value}%</span>
      </div>
      <div className="op-progress-track">
        <div className="op-progress-fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

export default function OpProgressPanel({ d, procesos, onSave, saving, isAdmin, isNew }) {
  const activeProcs = PROCESOS_OP.filter(([id]) => procesos[id]?.active)
  const completedProcs = activeProcs.filter(([id]) => procesos[id]?.estado === 'completado')
  const inProgressProcs = activeProcs.filter(([id]) => procesos[id]?.estado === 'en_proceso')

  const progresoProcesos = activeProcs.length
    ? Math.round(completedProcs.length / activeProcs.length * 100)
    : 0

  const maxUnidades = activeProcs.length
    ? Math.max(...activeProcs.map(([id]) => procesos[id]?.unidadesCompletadas || 0))
    : 0

  const progresoUnidades = d.cantidad
    ? Math.round(Math.min(maxUnidades / d.cantidad * 100, 100))
    : 0

  const saldo = (d.valorTotal || 0) - (d.abono || 0)

  // Elapsed time from first started process
  const started = activeProcs
    .map(([id]) => procesos[id]?.iniciadoEn)
    .filter(Boolean)
    .sort()[0]

  const elapsedLabel = started ? (() => {
    const ms = Date.now() - new Date(started).getTime()
    const h = Math.floor(ms / 3600000)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h`
    return `${h}h ${Math.floor((ms % 3600000) / 60000)}m`
  })() : null

  return (
    <div className="op-liq">
      <div className="op-liq-header">
        <div>
          <div className="ttl" style={{ fontWeight: 700, fontSize: 14 }}>Estado OP</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{d.numero || 'Nueva OP'}</div>
        </div>
        <OpBadge estado={d.estado} />
      </div>

      <div className="op-liq-body">
        {/* Progress bars */}
        <ProgressBar value={progresoProcesos} label="Procesos completados" />
        <ProgressBar value={progresoUnidades} label={`Unidades (${fmtNum(maxUnidades)} / ${fmtNum(d.cantidad)})`} />

        {elapsedLabel && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>
            ⏱ Tiempo transcurrido: <strong>{elapsedLabel}</strong>
          </div>
        )}

        {/* Financial summary */}
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="op-stat-row">
            <span className="lbl">Total costos</span>
            <span className="val">{fmtCOP(d.totalCostos)}</span>
          </div>
          <div className="op-stat-row total" style={{ marginTop: 4 }}>
            <span className="lbl">Valor total</span>
            <span className="val">{fmtCOP(d.valorTotal)}</span>
          </div>
          <div className="op-stat-row" style={{ marginTop: 4 }}>
            <span className="lbl">Abono</span>
            <span className="val" style={{ color: 'var(--ok)' }}>{fmtCOP(d.abono)}</span>
          </div>
          <div className="op-stat-row saldo" style={{ marginTop: 4 }}>
            <span className="lbl" style={{ fontWeight: 700 }}>Saldo pendiente</span>
            <span className="val" style={{ color: saldo > 0 ? 'var(--warn)' : 'var(--ok)', fontWeight: 700, fontSize: 14 }}>
              {fmtCOP(saldo)}
            </span>
          </div>
        </div>

        {/* Active processes list */}
        {activeProcs.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', marginBottom: 6 }}>
              Procesos activos
            </div>
            <div className="op-proc-list">
              {activeProcs.map(([id, label]) => {
                const p = procesos[id]
                const estado = p?.estado || 'pendiente'
                return (
                  <div key={id} className="op-proc-item">
                    <div className={`semaforo ${estado}`} />
                    <span className="op-proc-name">{label}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      {p?.operarioNombre || '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="op-liq-footer">
          <button
            className="btn accent"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Guardando…' : isNew ? 'Crear OP' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  )
}
