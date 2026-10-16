import { createCliente, getCliente } from '../api'

export const sameClientName = (left, right) => {
  const normalize = value => (value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
  return !!normalize(left) && normalize(left) === normalize(right)
}

export const exactClientMatch = (name, clients) =>
  clients.find(client => sameClientName(name, client.nombre))

// El backend frena el alta de un cliente cuyo nombre se parece a uno que ya
// existe (409 cliente_similar, ver ClienteViewSet.create): un typo como
// "Prepensa Inalmega" junto a "Preprensa Inalmega" parte en dos la cola de
// remisiones, que agrupa por cliente_id y solo deja remisionar un cliente a la
// vez. Crear igual sigue siendo válido —hay nombres legítimamente parecidos—
// pero tiene que ser una decisión, no el efecto de no haber elegido la
// sugerencia.
//
// Si el nombre coincide con uno existente, usar ese cliente directamente.
// Para nombres solo parecidos, las pantallas de Admin piden una decisión; el
// modal de troquel resuelve ese caso con su propia interfaz.
export async function crearClienteConGuard(data) {
  try {
    return await createCliente(data)
  } catch (e) {
    if (e?.code !== 'cliente_similar') throw e
    const candidatos = e.body?.candidatos || []
    const exact = exactClientMatch(data.nombre, candidatos)
    if (exact) return getCliente(exact.id)
    const lista = candidatos.map(c => `  • ${c.nombre}`).join('\n')
    const seguir = window.confirm(
      `Ya existe un cliente con un nombre casi igual:\n\n${lista}\n\n` +
      'Si es el mismo, cancela y elígelo de la lista de sugerencias del campo Cliente.\n\n' +
      `¿Crear «${data.nombre}» como un cliente aparte de todos modos?`
    )
    if (!seguir) {
      throw new Error('Elige el cliente existente en la lista de sugerencias del campo Cliente.')
    }
    return createCliente({ ...data, confirmar_nuevo: true })
  }
}
