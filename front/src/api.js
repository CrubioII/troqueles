const BASE = '/api'

const json = (r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export const getPapeles = () =>
  fetch(`${BASE}/papel/`).then(json)

export const getClientes = (q = '') =>
  fetch(`${BASE}/clientes/?search=${encodeURIComponent(q)}`).then(json)

export const createCliente = (data) =>
  fetch(`${BASE}/clientes/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateCliente = (id, data) =>
  fetch(`${BASE}/clientes/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const getCotizaciones = (params = '') =>
  fetch(`${BASE}/cotizaciones/${params}`).then(json)

export const getCotizacion = (id) =>
  fetch(`${BASE}/cotizaciones/${id}/`).then(json)

export const createCotizacion = (data) =>
  fetch(`${BASE}/cotizaciones/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateCotizacion = (id, data) =>
  fetch(`${BASE}/cotizaciones/${id}/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteCotizacion = (id) =>
  fetch(`${BASE}/cotizaciones/${id}/`, { method: 'DELETE' })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`) })

export const cambiarEstado = (id, estado) =>
  fetch(`${BASE}/cotizaciones/${id}/estado/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado }),
  }).then(json)

export const enviarCotizacion = (id, email, calc, extraEmails = []) =>
  fetch(`${BASE}/cotizaciones/${id}/enviar/`, {
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
  fetch(`${BASE}/cotizaciones/${id}/pdf_interno/`, {
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
  fetch(`${BASE}/documentos/${params}`).then(json)

export const getDocumento = (id) =>
  fetch(`${BASE}/documentos/${id}/`).then(json)

export const createDocumento = (data) =>
  fetch(`${BASE}/documentos/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateDocumento = (id, data) =>
  fetch(`${BASE}/documentos/${id}/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteDocumento = (id) =>
  fetch(`${BASE}/documentos/${id}/`, { method: 'DELETE' })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`) })

export const pdfDocumento = (id) =>
  fetch(`${BASE}/documentos/${id}/pdf/`, { method: 'POST' })

export const enviarDocumento = (id, email, extraEmails = []) =>
  fetch(`${BASE}/documentos/${id}/enviar/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, extra_emails: extraEmails }),
  }).then(json)
