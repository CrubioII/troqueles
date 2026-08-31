import { useCallback, useRef, useState } from 'react'

/**
 * Reordenar una cola arrastrando sus filas.
 *
 * Funciona con mouse y con dedo (pointer events + elementFromPoint), que es lo
 * que se usa en el taller: las estaciones se manejan desde tablet y el HTML5
 * drag-and-drop nativo no dispara nada ahí.
 *
 * Uso:
 *   const drag = useDragOrder(cola, nueva => guardarPrioridades(nueva))
 *   drag.items.map(op => <tr {...drag.rowProps(op)}>
 *                          <td {...drag.handleProps(op)}>⠿</td> …
 *
 * `onReorder` recibe la lista completa ya reordenada; quien la reciba
 * persiste el orden (posición = prioridad, 1 = primero).
 */
export function useDragOrder(items, onReorder, { disabled = false, getId = (it) => it.id } = {}) {
  // `preview` es la lista mientras se arrastra; null = manda `items`.
  const [preview, setPreview] = useState(null)
  const [dragId, setDragId] = useState(null)
  const dragRef = useRef(null)     // { id, list } del arrastre en curso

  const list = preview || items

  const finish = useCallback((commit) => {
    const st = dragRef.current
    dragRef.current = null
    setDragId(null)
    setPreview(null)
    if (!st) return
    const antes = items.map(getId).join(',')
    const despues = st.list.map(getId).join(',')
    if (commit && antes !== despues) onReorder(st.list)
  }, [items, onReorder, getId])

  const onPointerDown = useCallback((e, item) => {
    if (disabled || e.button === 1 || e.button === 2) return
    e.preventDefault()
    e.stopPropagation()
    const id = getId(item)
    dragRef.current = { id, list }
    setDragId(id)
    setPreview(list)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [disabled, list, getId])

  const onPointerMove = useCallback((e) => {
    const st = dragRef.current
    if (!st) return
    // La fila bajo el dedo/cursor manda: se busca por el data-attribute que
    // pone rowProps, así el hook no necesita saber nada del layout.
    const bajo = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-drag-id]')
    if (!bajo) return
    const sobreId = bajo.getAttribute('data-drag-id')
    const desde = st.list.findIndex(it => String(getId(it)) === String(st.id))
    const hasta = st.list.findIndex(it => String(getId(it)) === sobreId)
    if (desde < 0 || hasta < 0 || desde === hasta) return
    const nueva = [...st.list]
    const [movida] = nueva.splice(desde, 1)
    nueva.splice(hasta, 0, movida)
    st.list = nueva
    setPreview(nueva)
  }, [getId])

  const onPointerUp = useCallback(() => finish(true), [finish])
  const onPointerCancel = useCallback(() => finish(false), [finish])

  const rowProps = useCallback((item) => ({
    'data-drag-id': String(getId(item)),
    style: String(getId(item)) === String(dragId)
      ? { opacity: 0.45, background: 'var(--accent-soft, #eef3ff)' }
      : undefined,
  }), [dragId, getId])

  const handleProps = useCallback((item) => (disabled ? {} : {
    onPointerDown: (e) => onPointerDown(e, item),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick: (e) => e.stopPropagation(),
    // touch-action: el navegador no debe robarse el gesto para hacer scroll.
    style: { cursor: 'grab', touchAction: 'none', userSelect: 'none' },
    title: 'Arrastra para cambiar la prioridad',
  }), [disabled, onPointerDown, onPointerMove, onPointerUp, onPointerCancel])

  return { items: list, dragId, dragging: dragId != null, rowProps, handleProps }
}
