// Espejo en el front del rol de producción del Operador — ver
// back/cotizaciones/roles.py. El Admin siempre pasa (bypass por role).

export function puedeEstacion(user, estacionId) {
  if (!user) return false
  if (user.role === 'admin') return true
  return (user.estaciones || []).includes(estacionId)
}

export function puedeTroqueles(user) {
  if (!user) return false
  return user.role === 'admin' || !!user.troqueles
}

export function puedeRemisionesGenerales(user) {
  if (!user) return false
  return user.role === 'admin' || !!user.remisionesGenerales
}

// Producción › Remisiones (página central): quien remisiona troqueles o
// producción. Lo que ve cada uno lo filtra el backend.
export function puedeAlgunaRemision(user) {
  return puedeTroqueles(user) || puedeRemisionesGenerales(user)
}

// Corregir (editar/anular) lo que otro usuario ya envió — registros de
// estación, formatos de cuchillas enviados: solo el jefe de producción
// (PerfilOperador.es_jefe_produccion) y el Admin. El Operador normal no puede
// tocar un envío una vez hecho, ni siquiera el suyo.
export function puedeCorregirRegistros(user) {
  if (!user) return false
  return user.role === 'admin' || !!user.corregirRegistros
}

// Módulo Facturación: la contadora (PerfilOperador.es_contadora) y el Admin.
export function puedeFacturacion(user) {
  if (!user) return false
  return user.role === 'admin' || !!user.facturacion
}

// Contadora "pura": solo Facturación, ningún rol de producción. Aterriza en
// /facturacion y no ve el menú de Producción.
export function soloFacturacion(user) {
  if (!user || user.role === 'admin' || !user.facturacion) return false
  return !(user.estaciones || []).length && !user.troqueles && !user.remisionesGenerales
}
