const BASE = '/api'

function getToken() {
  return localStorage.getItem('access')
}

function authHeaders(extra = {}) {
  const token = getToken()
  const h = { ...extra }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

function handleUnauth() {
  localStorage.removeItem('access')
  localStorage.removeItem('refresh')
  window.location.href = '/login'
}

const json = (r) => {
  if (r.status === 401) { handleUnauth(); throw new Error('No autenticado') }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const ok = (r) => {
  if (r.status === 401) { handleUnauth(); throw new Error('No autenticado') }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export const getPapeles = () =>
  fetch(`${BASE}/papel/`, { headers: authHeaders() }).then(json)

export const getClientes = (q = '') =>
  fetch(`${BASE}/clientes/?search=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(json)

export const createCliente = (data) =>
  fetch(`${BASE}/clientes/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const updateCliente = (id, data) =>
  fetch(`${BASE}/clientes/${id}/`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const getCotizaciones = (params = '') =>
  fetch(`${BASE}/cotizaciones/${params}`, { headers: authHeaders() }).then(json)

export const getCotizacion = (id) =>
  fetch(`${BASE}/cotizaciones/${id}/`, { headers: authHeaders() }).then(json)

export const createCotizacion = (data) =>
  fetch(`${BASE}/cotizaciones/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const updateCotizacion = (id, data) =>
  fetch(`${BASE}/cotizaciones/${id}/`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const deleteCotizacion = (id) =>
  fetch(`${BASE}/cotizaciones/${id}/`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).then(ok)

export const cambiarEstado = (id, estado) =>
  fetch(`${BASE}/cotizaciones/${id}/estado/`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ estado }),
  }).then(json)

export const enviarCotizacion = (id, email, calc, extraEmails = []) =>
  fetch(`${BASE}/cotizaciones/${id}/enviar/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      email,
      extra_emails: extraEmails,
      proc_rows: (calc?.procRows || []).map(p => ({ nombre: p.nombre, costo: p.costo })),
      costo_papel: calc?.costoPapel ?? 0,
      total_costos_op: calc?.totalCostosOP ?? 0,
      valor_unitario: calc?.valorUnitario ?? 0,
      valor_total: calc?.valorTotal ?? 0,
    }),
  }).then(json)

export const pdfInterno = (id, calc) =>
  fetch(`${BASE}/cotizaciones/${id}/pdf_interno/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      proc_rows: (calc?.procRows || []).map(p => ({ nombre: p.nombre, costo: p.costo })),
      costo_papel: calc?.costoPapel ?? 0,
      total_costos_op: calc?.totalCostosOP ?? 0,
      valor_unitario: calc?.valorUnitario ?? 0,
      valor_total: calc?.valorTotal ?? 0,
    }),
  })

export const getDocumentos = (params = '') =>
  fetch(`${BASE}/documentos/${params}`, { headers: authHeaders() }).then(json)

export const getDocumento = (id) =>
  fetch(`${BASE}/documentos/${id}/`, { headers: authHeaders() }).then(json)

export const createDocumento = (data) =>
  fetch(`${BASE}/documentos/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const updateDocumento = (id, data) =>
  fetch(`${BASE}/documentos/${id}/`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const deleteDocumento = (id) =>
  fetch(`${BASE}/documentos/${id}/`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).then(ok)

export const pdfDocumento = (id) =>
  fetch(`${BASE}/documentos/${id}/pdf/`, {
    method: 'POST',
    headers: authHeaders(),
  })

export const enviarDocumento = (id, email, extraEmails = []) =>
  fetch(`${BASE}/documentos/${id}/enviar/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, extra_emails: extraEmails }),
  }).then(json)

// ─────────────── Órdenes de Producción ───────────────

export const getOrdenes = (params = '') =>
  fetch(`${BASE}/ordenes/${params}`, { headers: authHeaders() }).then(json)

export const getOrden = (id) =>
  fetch(`${BASE}/ordenes/${id}/`, { headers: authHeaders() }).then(json)

export const createOrden = (data) =>
  fetch(`${BASE}/ordenes/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const updateOrden = (id, data) =>
  fetch(`${BASE}/ordenes/${id}/`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const deleteOrden = (id) =>
  fetch(`${BASE}/ordenes/${id}/`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).then(ok)

export const cambiarEstadoOrden = (id, estado) =>
  fetch(`${BASE}/ordenes/${id}/estado/`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ estado }),
  }).then(json)

export const anularOrden = (id) =>
  fetch(`${BASE}/ordenes/${id}/anular/`, {
    method: 'PATCH',
    headers: authHeaders(),
  }).then(json)

export const updateProcesoProgreso = (ordenId, data) =>
  fetch(`${BASE}/ordenes/${ordenId}/procesos/progreso/`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(json)

export const getOperarios = () =>
  fetch(`${BASE}/ordenes/operarios/`, { headers: authHeaders() }).then(json)
