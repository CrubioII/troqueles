import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { fmtCOP } from '../core'

// Hex fijos espejando styles.css — Recharts necesita valores resolvibles en SVG, no var(--x)
const ESTADO_COLORS = {
  borrador: '#807A6E',
  enviada: '#3A5B8C',
  aprobada: '#2E7D5B',
  convertida: '#B8541C',
  rechazada: '#9C2A2A',
}

export function ChartCard({ title, children, empty }) {
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #E8E1D2',
      borderRadius: 10,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minHeight: 220,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1B1816' }}>{title}</div>
      {empty ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#807A6E', fontSize: 12 }}>
          Sin datos todavía
        </div>
      ) : children}
    </div>
  )
}

export function EmbudoChart({ data }) {
  const hasData = data?.some(d => d.count > 0)
  return (
    <ChartCard title="Embudo de cotizaciones" empty={!hasData}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D2" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data?.map((d) => (
              <Cell key={d.estado} fill={ESTADO_COLORS[d.estado] || '#807A6E'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function UtilizacionChart({ data }) {
  const tiempos = data?.troquel_tiempos_prom_min
  const tiempoData = tiempos ? [
    { fase: 'Encalado', min: tiempos.encalado, fill: '#B8541C' },
    { fase: 'Encuchillado', min: tiempos.encuchillado, fill: '#2E7D5B' },
    { fase: 'Encauchado', min: tiempos.encauchado, fill: '#3A5B8C' },
  ] : []
  const hasTiempos = tiempoData.some(d => d.min > 0)
  const counts = data?.registros_count

  return (
    <ChartCard title="Utilización troquel / guillotina">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flex: 1 }}>
        <div style={{ flex: 1.4, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#807A6E', marginBottom: 4 }}>Troquel — minutos promedio por fase</div>
          {hasTiempos ? (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={tiempoData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D2" vertical={false} />
                <XAxis dataKey="fase" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${v} min`} />
                <Bar dataKey="min" radius={[4, 4, 0, 0]}>
                  {tiempoData.map((d) => <Cell key={d.fase} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#807A6E', fontSize: 12 }}>
              Sin datos todavía
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 90 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1B1816' }}>{counts?.troquel ?? 0}</div>
            <div style={{ fontSize: 11, color: '#807A6E' }}>Registros troquel</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1B1816' }}>{counts?.guillotina ?? 0}</div>
            <div style={{ fontSize: 11, color: '#807A6E' }}>Registros guillotina</div>
          </div>
        </div>
      </div>
    </ChartCard>
  )
}

export function IngresosChart({ data }) {
  const hasData = data?.length > 0
  return (
    <ChartCard title="Ingresos por período (últimos 12 meses)" empty={!hasData}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D2" />
          <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmtCOP} tick={{ fontSize: 11 }} width={80} />
          <Tooltip formatter={(v) => fmtCOP(v)} />
          <Line type="monotone" dataKey="valor" stroke="#B8541C" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function TopClientesChart({ data }) {
  const hasData = data?.length > 0
  return (
    <ChartCard title="Top clientes por valor" empty={!hasData}>
      <ResponsiveContainer width="100%" height={Math.max(180, (data?.length || 0) * 28)}>
        <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D2" horizontal={false} />
          <XAxis type="number" tickFormatter={fmtCOP} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="cliente" width={110} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => fmtCOP(v)} />
          <Bar dataKey="valor" fill="#3A5B8C" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function OpsAtrasadasChart({ data }) {
  const top = (data || []).slice(0, 8)
  const hasData = top.length > 0
  return (
    <ChartCard title="OPs atrasadas — saldo pendiente" empty={!hasData}>
      <ResponsiveContainer width="100%" height={Math.max(180, top.length * 28)}>
        <BarChart data={top} layout="vertical" margin={{ left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D2" horizontal={false} />
          <XAxis type="number" tickFormatter={fmtCOP} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="numero" width={70} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => fmtCOP(v)} labelFormatter={(_, p) => p?.[0]?.payload?.cliente || ''} />
          <Bar dataKey="saldo" fill="#9C2A2A" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
