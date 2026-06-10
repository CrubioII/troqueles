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

let refreshPromise = null

export function refreshAccessToken() {
  const refresh = localStorage.getItem('refresh')
  if (!refresh) return Promise.resolve(false)
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.access) {
          localStorage.setItem('access', data.access)
          return true
        }
        return false
      })
      .catch(() => false)
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function apiFetch(url, opts = {}) {
  const run = () => fetch(url, { ...opts, headers: authHeaders(opts.headers) })
  let res = await run()
  if (res.status === 401) {
    const refreshed = await refreshAccessToken()
    if (refreshed) res = await run()
    if (res.status === 401) {
      handleUnauth()
      throw new Error('No autenticado')
    }
  }
  return res
}

const json = (r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const ok = (r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export const getPapeles = () =>
  apiFetch(`${BASE}/papel/`).then(json)

export const getClientes = (q = '') =>
  apiFetch(`${BASE}/clientes/?search=${encodeURIComponent(q)}`).then(json)

export const createCliente = (data) =>
  apiFetch(`${BASE}/clientes/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateCliente = (id, data) =>
  apiFetch(`${BASE}/clientes/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const getCotizaciones = (params = '') =>
  apiFetch(`${BASE}/cotizaciones/${params}`).then(json)

export const getCotizacion = (id) =>
  apiFetch(`${BASE}/cotizaciones/${id}/`).then(json)

export const createCotizacion = (data) =>
  apiFetch(`${BASE}/cotizaciones/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateCotizacion = (id, data) =>
  apiFetch(`${BASE}/cotizaciones/${id}/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteCotizacion = (id) =>
  apiFetch(`${BASE}/cotizaciones/${id}/`, {
    method: 'DELETE',
  }).then(ok)

export const cambiarEstado = (id, estado) =>
  apiFetch(`${BASE}/cotizaciones/${id}/estado/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado }),
  }).then(json)

export const enviarCotizacion = (id, email, calc, extraEmails = []) =>
  apiFetch(`${BASE}/cotizaciones/${id}/enviar/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  apiFetch(`${BASE}/cotizaciones/${id}/pdf_interno/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proc_rows: (calc?.procRows || []).map(p => ({ nombre: p.nombre, costo: p.costo })),
      costo_papel: calc?.costoPapel ?? 0,
      total_costos_op: calc?.totalCostosOP ?? 0,
      valor_unitario: calc?.valorUnitario ?? 0,
      valor_total: calc?.valorTotal ?? 0,
    }),
  })

export const getDocumentos = (params = '') =>
  apiFetch(`${BASE}/documentos/${params}`).then(json)

export const getDocumento = (id) =>
  apiFetch(`${BASE}/documentos/${id}/`).then(json)

export const createDocumento = (data) =>
  apiFetch(`${BASE}/documentos/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateDocumento = (id, data) =>
  apiFetch(`${BASE}/documentos/${id}/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteDocumento = (id) =>
  apiFetch(`${BASE}/documentos/${id}/`, {
    method: 'DELETE',
  }).then(ok)

export const pdfDocumento = (id) =>
  apiFetch(`${BASE}/documentos/${id}/pdf/`, {
    method: 'POST',
  })

export const enviarDocumento = (id, email, extraEmails = []) =>
  apiFetch(`${BASE}/documentos/${id}/enviar/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, extra_emails: extraEmails }),
  }).then(json)

// ─────────────── Órdenes de Producción ───────────────

export const getOrdenes = (params = '') =>
  apiFetch(`${BASE}/ordenes/${params}`).then(json)

export const getOrden = (id) =>
  apiFetch(`${BASE}/ordenes/${id}/`).then(json)

export const createOrden = (data) =>
  apiFetch(`${BASE}/ordenes/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateOrden = (id, data) =>
  apiFetch(`${BASE}/ordenes/${id}/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteOrden = (id) =>
  apiFetch(`${BASE}/ordenes/${id}/`, {
    method: 'DELETE',
  }).then(ok)

export const getNextNumeroOrden = () =>
  apiFetch(`${BASE}/ordenes/next_numero/`).then(json)

export const crearOpDesdeCotizacion = (cotId, body) =>
  apiFetch(`${BASE}/cotizaciones/${cotId}/crear_op/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(json)

export const pdfOpAdmin = (id, calc, d) =>
  apiFetch(`${BASE}/ordenes/${id}/pdf_admin/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proc_rows: (calc?.procRows || []).map(p => ({ nombre: p.nombre, costo: p.costo })),
      costo_papel: calc?.costoPapel ?? 0,
      total_costos_op: calc?.totalCostosOP ?? 0,
      valor_unitario: calc?.valorUnitario ?? 0,
      valor_total: calc?.valorTotal ?? 0,
    }),
  })

export const pdfOpProduccion = (id, calc, papelReferencia = '') =>
  apiFetch(`${BASE}/ordenes/${id}/pdf_produccion/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proc_rows: (calc?.procRows || []).map(p => ({ nombre: p.nombre })),
      unidades_por_pliego: calc?.unidadesPorPliego ?? '',
      pliegos_necesarios: calc?.pliegosNecesarios ?? '',
      papel_referencia: papelReferencia,
    }),
  })
