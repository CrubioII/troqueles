export const BASE = import.meta.env.VITE_API_URL || '/api'

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

// Listado de clientes con señales de re-engagement y finanzas
export const getClientesResumen = () =>
  apiFetch(`${BASE}/clientes/resumen/`).then(json)

// Perfil completo de un cliente: datos, finanzas e historial
export const getClientePerfil = (id) =>
  apiFetch(`${BASE}/clientes/${id}/perfil/`).then(json)

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

export const toggleProcesoCompletado = (opId, procesoId, completado) =>
  apiFetch(`${BASE}/ordenes/${opId}/procesos/${procesoId}/completado/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completado }),
  }).then(json)

// ─────────────── Remisiones ───────────────

export const getRemisiones = (params = '') =>
  apiFetch(`${BASE}/remisiones/${params}`).then(json)

export const getRemision = (id) =>
  apiFetch(`${BASE}/remisiones/${id}/`).then(json)

export const updateRemision = (id, data) =>
  apiFetch(`${BASE}/remisiones/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const liquidarRemision = (id, email, extraEmails = []) =>
  apiFetch(`${BASE}/remisiones/${id}/liquidar/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, extra_emails: extraEmails }),
  }).then(json)

export const pdfRemision = (id) =>
  apiFetch(`${BASE}/remisiones/${id}/pdf/`, {
    method: 'POST',
  })

// Remisiones pendientes del mismo cliente que pueden fusionarse en esta
export const getRemisionesImportables = (id) =>
  apiFetch(`${BASE}/remisiones/${id}/importables/`).then(json)

// Fusiona los ítems de las remisiones origen (mismo cliente, pendientes) en esta
export const importarRemisiones = (id, remisionIds) =>
  apiFetch(`${BASE}/remisiones/${id}/importar/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remision_ids: remisionIds }),
  }).then(json)

// ─────────────── Registros de máquina (Troqueles / Guillotina) ───────────────

export const getRegistrosMaquina = (params = '') =>
  apiFetch(`${BASE}/registros-maquina/${params}`).then(json)

export const createRegistroMaquina = (data) =>
  apiFetch(`${BASE}/registros-maquina/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

// ─────────────── Troqueles: modelo, formato de cuchillas, precios, costos ───────────────

// OP sanitizada para el Operador (sin cliente ni dinero)
export const getOrdenProduccion = (id) =>
  apiFetch(`${BASE}/ordenes/${id}/produccion/`).then(json)

export const buscarOrdenPorNumero = (numero) =>
  apiFetch(`${BASE}/ordenes/buscar/?numero=${encodeURIComponent(numero)}`).then(json)

// Lista de OPs con proceso pendiente, ordenadas por fecha de entrega asc (Operador)
export const getOrdenesPendientes = (proceso = 'troquel') =>
  apiFetch(`${BASE}/ordenes/produccion_pendientes/?proceso=${encodeURIComponent(proceso)}`).then(json)

// Costos de troquel (solo Admin)
export const getTroquelCostos = (id) =>
  apiFetch(`${BASE}/ordenes/${id}/troquel_costos/`).then(json)

// Modelo del troquel (Admin)
export const getTroquelModelo = (ordenId) =>
  apiFetch(`${BASE}/troquel-modelos/?orden=${ordenId}`).then(json)

// formData: FormData con archivo + campos. Sin Content-Type manual (boundary automático).
export const saveTroquelModelo = (id, formData) =>
  apiFetch(`${BASE}/troquel-modelos/${id ? id + '/' : ''}`, {
    method: id ? 'PATCH' : 'POST',
    body: formData,
  }).then(json)

// Lee un PDF de modelo de troquel y devuelve los campos detectados (no guarda nada)
export const extraerPdfTroquel = (file) => {
  const fd = new FormData()
  fd.append('archivo', file)
  return apiFetch(`${BASE}/troquel-modelos/extraer_pdf/`, { method: 'POST', body: fd }).then(json)
}

// Formato de cuchillas
export const getFormatosCuchillas = (ordenId) =>
  apiFetch(`${BASE}/formatos-cuchillas/?orden=${ordenId}`).then(json)

export const createFormatoCuchillas = (data) =>
  apiFetch(`${BASE}/formatos-cuchillas/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

// Editar formato existente — Admin, o el Operador reenviando uno devuelto
export const updateFormatoCuchillas = (id, data) =>
  apiFetch(`${BASE}/formatos-cuchillas/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

// Cola de aprobación de troqueles (Admin)
export const getFormatosPendientes = () =>
  apiFetch(`${BASE}/formatos-cuchillas/?estado=pendiente`).then(json)

export const aprobarFormatoCuchillas = (id) =>
  apiFetch(`${BASE}/formatos-cuchillas/${id}/aprobar/`, { method: 'POST' }).then(json)

export const devolverFormatoCuchillas = (id, motivo = '') =>
  apiFetch(`${BASE}/formatos-cuchillas/${id}/devolver/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo }),
  }).then(json)

// Precios unitarios (Admin)
export const getPreciosTroquel = () =>
  apiFetch(`${BASE}/precios-troquel/`).then(json)

export const updatePrecioTroquel = (id, precio_unitario) =>
  apiFetch(`${BASE}/precios-troquel/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ precio_unitario }),
  }).then(json)

// ─────────────── Dashboard ───────────────

export const getDashboardStats = () =>
  apiFetch(`${BASE}/dashboard/stats/`).then(json)
