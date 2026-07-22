import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { ProgressBar } from '../components/core'
import {
  ModeloTroquelGestion, TroquelCostos,
  FormatosCuchillasHistory, FormatoCuchillasForm, OrdenCambiosHistory,
} from '../components/Troquel'
import { getOrden, getFormatosCuchillas, getOrdenCambios } from '../api'

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

// ─────────────── Página ───────────────

export default function TroquelGestion() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orden, setOrden] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [formatos, setFormatos] = useState([])
  const [loadingFormatos, setLoadingFormatos] = useState(false)
  const [costRefresh, setCostRefresh] = useState(0)
  const [editFormato, setEditFormato] = useState(null)   // formato en edición (Admin)
  const [cambios, setCambios] = useState([])
  const [loadingCambios, setLoadingCambios] = useState(false)

  const loadOrden = () =>
    getOrden(id)
      .then(d => { setOrden(d); setNotFound(false); return d })
      .catch(() => { setNotFound(true); return null })
      .finally(() => setLoading(false))

  const loadFormatos = () => {
    setLoadingFormatos(true)
    getFormatosCuchillas(id)
      .then(d => setFormatos(asList(d)))
      .catch(() => setFormatos([]))
      .finally(() => setLoadingFormatos(false))
  }

  const loadCambios = () => {
    setLoadingCambios(true)
    getOrdenCambios(id)
      .then(d => setCambios(asList(d)))
      .catch(() => setCambios([]))
      .finally(() => setLoadingCambios(false))
  }

  useEffect(() => {
    setLoading(true)
    loadOrden()
    loadFormatos()
    loadCambios()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const volver = () => navigate('/produccion/troqueles')

  const ent = orden ? fmtEntrega(orden.fecha_entrega) : null

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="mod">Gestión de troquel</div></div>
        <div className="topbar-right">
          <button className="btn" onClick={volver}><Icon.ArrowLeft /> Volver</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', width: '100%' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
        ) : notFound || !orden ? (
          <Section title="OP no encontrada">
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
              No se pudo cargar esta OP.
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={volver}><Icon.ArrowLeft /> Volver a la lista</button>
              </div>
            </div>
          </Section>
        ) : (
          <>
            {/* Encabezado de la OP */}
            <Section
              title={<>Troquel · <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{orden.numero}</span></>}
              actions={
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn sm" onClick={() => navigate(`/ordenes/${id}`)}>Abrir OP completa</button>
                  <button className="btn sm" onClick={volver}><Icon.ArrowLeft /> Volver</button>
                </div>
              }
            >
              <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
                {[
                  ['Cliente', orden.cliente_nombre || '—'],
                  ['Referencia', orden.referencia || '—'],
                  ['Cantidad', orden.cantidad ?? '—', true],
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
                {orden.progreso && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Progreso</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ProgressBar pct={orden.progreso.porcentaje} />
                      <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'JetBrains Mono, monospace' }}>{orden.progreso.completados}/{orden.progreso.total}</span>
                    </div>
                  </div>
                )}
              </div>
            </Section>

            <Section title="Modelo del troquel">
              <ModeloTroquelGestion
                ordenId={orden.id}
                orden={orden}
                onSaved={() => setCostRefresh(k => k + 1)}
                onOrdenSaved={loadOrden}
              />
            </Section>

            <Section title="Costos (del formato de cuchillas)">
              <TroquelCostos ordenId={orden.id} refreshKey={costRefresh} />
            </Section>

            <Section title="Auditoría — Formato de cuchillas registrado">
              {editFormato ? (
                <FormatoCuchillasForm
                  formato={editFormato}
                  onUpdated={() => { setEditFormato(null); loadFormatos(); setCostRefresh(k => k + 1) }}
                  onCancel={() => setEditFormato(null)}
                />
              ) : (
                <FormatosCuchillasHistory formatos={formatos} loading={loadingFormatos} onEdit={setEditFormato} />
              )}
            </Section>

            <Section title="Historial de cambios (referencia, entrega, cliente)">
              <OrdenCambiosHistory cambios={cambios} loading={loadingCambios} />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
