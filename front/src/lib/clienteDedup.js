import { createCliente } from '../api'

// El backend frena el alta de un cliente cuyo nombre se parece a uno que ya
// existe (409 cliente_similar, ver ClienteViewSet.create): un typo como
// "Prepensa Inalmega" junto a "Preprensa Inalmega" parte en dos la cola de
// remisiones, que agrupa por cliente_id y solo deja remisionar un cliente a la
// vez. Crear igual sigue siendo válido —hay nombres legítimamente parecidos—
// pero tiene que ser una decisión, no el efecto de no haber elegido la
// sugerencia.
//
// Este helper es el camino rápido para las pantallas de Admin (cotización,
// documento, OP), que crean el cliente dentro de un "Guardar" ya en curso. La
// pantalla del Operador (NuevaTareaTroquelModal) resuelve el 409 con UI propia:
// ahí es donde nacieron los duplicados de producción y un confirm() se acepta
// sin leer.
export async function crearClienteConGuard(data) {
  try {
    return await createCliente(data)
  } catch (e) {
    if (e?.code !== 'cliente_similar') throw e
    const candidatos = e.body?.candidatos || []
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
