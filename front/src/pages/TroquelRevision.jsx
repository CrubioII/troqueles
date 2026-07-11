import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import {
  ModeloViewer, FormatosCuchillasHistory, TroquelCostos,
} from '../components/Troquel'
import {
  getFormatosPendientes, aprobarFormatoCuchillas, devolverFormatoCuchillas,
  getOrden, getTroquelModelo,
} from '../api'
import { usePolling } from '../lib/usePolling'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

// Fecha de entrega formateada + color según urgencia (vencido / próximo)
function fmtEntrega(s) {
  if (!s) return { txt: 'Sin fecha', color: 'var(--ink-3)' }
  const d = new Date(s + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  const txt = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  let color = 'var(--ink-2)'
  if (diff < 0) color = 'var(--danger, #c0392b)'
  else if (diff <= 2) color = 'var(--warn, #e0a800)'
  return { txt: diff < 0 ? `${txt} · vencido` : txt, color }
}

const fmtFechaHora = (s) => {
  try { return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

function Section({ title, children, style, actions }) {
  return (
    <div className="section" style={{ marginTop: 16, ...style }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  )
}

// ─────────────── Cola de troqueles pendientes ───────────────

function ColaPendientes({ pendientes, loading, onRevisar }) {
  return (
    <Section title={`Troqueles por aprobar${pendientes.length ? ` (${pendientes.length})` : ''}`}>
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
      ) : pendientes.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>No hay troqueles esperando aprobación 🎉</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)' }}>
              {['OP #', 'Cliente', 'Operador', 'Registrado', 'Entrega', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pendientes.map((f, idx) => {
              const ent = fmtEntrega(f.fecha_entrega)
              return (
                <tr key={f.id}
                  style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                  onClick={() => onRevisar(f)}>
                  <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>{f.orden_numero}</td>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{f.cliente_nombre || '—'}</td>
                  <td style={{ padding: '12px' }}>{f.operador_username || '—'}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'var(--ink-2)' }}>{fmtFechaHora(f.fecha_hora)}</td>
                  <td style={{ padding: '12px', fontSize: 12, fontWeight: 600, color: ent.color }}>{ent.txt}</td>
                  <td style={{ padding: '12px' }}>
                    <button className="btn sm primary" onClick={e => { e.stopPropagation(); onRevisar(f) }}>Revisar</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Section>
  )
}

// ─────────────── Revisión de un troquel ───────────────

function RevisionDetalle({ formato, onVolver, onResuelto }) {
  const [orden, setOrden] = useState(null)
  const [modelo, setModelo] = useState(null)
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [confirmando, setConfirmando] = useState(false)   // modal Aprobar
  const [devolviendo, setDevolviendo] = useState(false)   // modal Devolver
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [costosDirty, setCostosDirty] = useState(false)   // costos escritos sin guardar
  const [avisoCostos, setAvisoCostos] = useState(false)   // popup "guarda antes de aprobar"

  useEffect(() => {
    setLoadingInfo(true)
    Promise.all([
      getOrden(formato.orden).catch(() => null),
      getTroquelModelo(formato.orden).then(d => asList(d)[0] || null).catch(() => null),
    ])
      .then(([ord, mod]) => { setOrden(ord); setModelo(mod) })
      .finally(() => setLoadingInfo(false))
  }, [formato.orden])

  // El 409 llega si el operador canceló el envío mientras se revisaba:
  // se muestra el mensaje del servidor en lugar de uno genérico.
  const aprobar = () => {
    setBusy(true); setError(null)
    aprobarFormatoCuchillas(formato.id)
      .then(() => { setConfirmando(false); onResuelto() })
      .catch((e) => { setConfirmando(false); setError(e?.message || 'No se pudo aprobar el formato') })
      .finally(() => setBusy(false))
  }

  const devolver = () => {
    setBusy(true); setError(null)
    devolverFormatoCuchillas(formato.id, motivo)
      .then(() => { setDevolviendo(false); onResuelto() })
      .catch((e) => { setDevolviendo(false); setError(e?.message || 'No se pudo devolver el formato') })
      .finally(() => setBusy(false))
  }

  const ent = fmtEntrega(formato.fecha_entrega)

  return (
    <>
      <button className="btn" style={{ marginBottom: 4 }} onClick={onVolver}><Icon.ArrowLeft /> Volver a la lista</button>

      {/* Encabezado de la OP */}
      <Section title={`Revisión de troquel · ${formato.orden_numero}`}>
        <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          {[
            ['OP', formato.orden_numero, true],
            ['Cliente', formato.cliente_nombre || orden?.cliente_nombre || '—'],
            ['Referencia', orden?.referencia || '—'],
            ['Cantidad', orden?.cantidad ?? '—', true],
            ['Registrado por', formato.operador_username || '—'],
            ['Fecha registro', fmtFechaHora(formato.fecha_hora)],
          ].map(([label, value, mono]) => (
            <div key={label}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'JetBrains Mono, monospace' : undefined }}>{value}</div>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Entrega</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: ent.color }}>{ent.txt}</div>
          </div>
        </div>
      </Section>

      <Section title="Modelo del troquel">
        {loadingInfo
          ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
          : <ModeloViewer modelo={modelo} />}
      </Section>

      <Section title="Formato de cuchillas registrado">
        <FormatosCuchillasHistory formatos={[formato]} loading={false} />
      </Section>

      <Section title="Costos (del formato de cuchillas)">
        <TroquelCostos ordenId={formato.orden} refreshKey={0} onDirtyChange={setCostosDirty} />
      </Section>

      {error && <div style={{ marginTop: 12, color: 'var(--danger, #c0392b)', fontSize: 13 }}>{error}</div>}

      {/* Barra de acciones */}
      <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onVolver} disabled={busy}><Icon.ArrowLeft /> Volver a la lista</button>
        <button className="btn" style={{ color: 'var(--danger, #c0392b)' }} onClick={() => { setMotivo(''); setDevolviendo(true) }} disabled={busy}>
          Devolver al operador
        </button>
        <button className="btn primary" onClick={() => (costosDirty ? setAvisoCostos(true) : setConfirmando(true))} disabled={busy}>
          Aprobar → remisión
        </button>
      </div>

      {avisoCostos && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Costos sin guardar</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
              Escribiste precios o cantidades en la tabla de costos que aún no se han guardado.
              Presiona <strong>Guardar costos</strong> antes de aprobar, para que la remisión
              se genere con el total correcto.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn primary" onClick={() => setAvisoCostos(false)}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {confirmando && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Aprobar formato de cuchillas</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
              El troquel de <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formato.orden_numero}</strong> quedará
              <strong> completado</strong> y, si la OP llega al 100%, pasará automáticamente a remisión.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmando(false)} disabled={busy}>Cancelar</button>
              <button className="btn primary" onClick={aprobar} disabled={busy}>
                {busy ? 'Aprobando…' : 'Sí, aprobar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {devolviendo && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Devolver formato al operador</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>
              El troquel de <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formato.orden_numero}</strong> volverá
              a la lista de pendientes del operador para que corrija y reenvíe el formato.
            </div>
            <textarea
              className="input"
              style={{ width: '100%', minHeight: 70, resize: 'vertical', marginBottom: 16 }}
              placeholder="Motivo de la devolución (opcional)"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={300}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setDevolviendo(false)} disabled={busy}>Cancelar</button>
              <button className="btn primary" onClick={devolver} disabled={busy}>
                {busy ? 'Devolviendo…' : 'Devolver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────── Página ───────────────

export default function TroquelRevision() {
  const navigate = useNavigate()
  const [pendientes, setPendientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)   // formato en revisión

  const loadPendientes = (silent = false) => {
    if (!silent) setLoading(true)
    return getFormatosPendientes()
      .then(d => setPendientes(asList(d)))
      .catch(() => setPendientes([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadPendientes() }, [])

  // Tiempo real: refrescar la cola solo cuando se está viendo la lista
  usePolling(() => loadPendientes(true), { enabled: !sel })

  const volver = () => { setSel(null); loadPendientes() }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="mod">Revisión de troqueles</div></div>
        <div className="topbar-right">
          <button className="btn" onClick={() => navigate('/produccion/troqueles')}><Icon.ArrowLeft /> Volver</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', width: '100%' }}>
        {sel ? (
          <RevisionDetalle formato={sel} onVolver={volver} onResuelto={volver} />
        ) : (
          <ColaPendientes pendientes={pendientes} loading={loading} onRevisar={setSel} />
        )}
      </div>
    </div>
  )
}
