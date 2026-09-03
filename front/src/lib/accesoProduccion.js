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
