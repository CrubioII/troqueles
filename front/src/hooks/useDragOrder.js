import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
export function useDragOrder(items, onReorder, { disabled = false, getId = (it) => it.id, onDragStateChange = () => {}, onDragPending = () => {}, activationDelay = 0, livePreview = false } = {}) {
  // `preview` congela el orden visible al iniciar el arrastre; null = manda
  // `items`. Mover las tarjetas bajo el cursor durante el gesto hace que una
  // tarjeta arrastrada hacia abajo se convierta en su propio objetivo.
  const [preview, setPreview] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [pointer, setPointer] = useState(null)
  const [overId, setOverId] = useState(null)
  const [dropPosition, setDropPosition] = useState(null)
  const dragRef = useRef(null)     // { id, list } del arrastre en curso
  const pointerRef = useRef(null)
  const autoScrollFrameRef = useRef(null)
  const rectsRef = useRef(new Map())
  const pendingRef = useRef(null)
  const pendingTimerRef = useRef(null)
  const onDragPendingRef = useRef(onDragPending)

  const list = preview || items

  useEffect(() => { onDragPendingRef.current = onDragPending }, [onDragPending])

  // FLIP animation: React cambia el orden del DOM para abrir espacio mientras
  // se arrastra; este pequeño paso anima cada tarjeta desde su rectángulo
  // anterior al nuevo, como una lista de música al reorganizarse.
  useLayoutEffect(() => {
    if (!livePreview) return undefined
    const zona = document.querySelector('[data-drag-list]')
    const elementos = [...(zona?.querySelectorAll?.('[data-drag-id]') || [])]
    const siguientes = new Map(elementos.map(el => [el.getAttribute('data-drag-id'), el.getBoundingClientRect()]))
    const frameIds = []
    for (const el of elementos) {
      const antes = rectsRef.current.get(el.getAttribute('data-drag-id'))
      const ahora = siguientes.get(el.getAttribute('data-drag-id'))
      if (!antes || !ahora) continue
      const dx = antes.left - ahora.left
      const dy = antes.top - ahora.top
      if (!dx && !dy) continue
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      frameIds.push(requestAnimationFrame(() => {
        el.style.transition = ''
        el.style.transform = ''
      }))
    }
    rectsRef.current = siguientes
    return () => frameIds.forEach(cancelAnimationFrame)
  }, [list, livePreview])

  const ordenar = useCallback((base, id, targetId, position) => {
    const desde = base.findIndex(it => String(getId(it)) === String(id))
    const hasta = base.findIndex(it => String(getId(it)) === String(targetId))
    if (desde < 0 || hasta < 0 || desde === hasta) return base
    const resultado = [...base]
    const [movida] = resultado.splice(desde, 1)
    let destino = hasta + (position === 'after' ? 1 : 0)
    if (desde < destino) destino -= 1
    resultado.splice(destino, 0, movida)
    return resultado
  }, [getId])

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current != null) cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollFrameRef.current = null
  }, [])

  // Se usa tanto al mover el cursor como al auto-scroll: el destino sigue al
  // puntero incluso si la página continúa desplazándose bajo él.
  const moverSobrePuntero = useCallback((x, y) => {
    const st = dragRef.current
    if (!st) return

    // La vista de Troqueles reordena las tarjetas en vivo. En ese caso la
    // tarjeta original (transparente) puede quedar debajo del dedo y
    // `elementFromPoint` la devolvería como su propio destino. Eso bloquea el
    // arrastre justo cuando la lista se compacta. Calculamos la inserción por
    // el centro visual de las otras tarjetas y excluimos siempre la activa.
    if (livePreview) {
      const zona = document.querySelector('[data-drag-list]')
      const rectZona = zona?.getBoundingClientRect?.()
      if (!rectZona || x < rectZona.left || x > rectZona.right) return
      const tarjetas = [...(zona.querySelectorAll?.('[data-drag-id]') || [])]
        .filter(el => String(el.getAttribute('data-drag-id')) !== String(st.id))
      if (!tarjetas.length) return
      const siguiente = tarjetas.find(el => {
        const rect = el.getBoundingClientRect()
        return y < rect.top + rect.height / 2
      })
      const bajo = siguiente || tarjetas[tarjetas.length - 1]
      const sobreId = bajo.getAttribute('data-drag-id')
      const posicion = siguiente ? 'before' : 'after'
      if (st.targetId === sobreId && st.targetPosition === posicion) return
      st.targetId = sobreId
      st.targetPosition = posicion
      setOverId(sobreId)
      setDropPosition(posicion)
      setPreview(ordenar(st.list, st.id, sobreId, posicion))
      return
    }

    let bajo = document.elementFromPoint(x, y)?.closest?.('[data-drag-id]')
    let posicionForzada = null
    // Fuera de una tarjeta, el espacio inmediatamente antes/después de la
    // lista sigue siendo un destino válido. Evita que una fila quede "pegada"
    // al intentar dejarla primera o última.
    if (!bajo) {
      const zona = document.querySelector('[data-drag-list]')
      const tarjetas = zona?.querySelectorAll?.('[data-drag-id]')
      const rectZona = zona?.getBoundingClientRect?.()
      if (tarjetas?.length && rectZona && x >= rectZona.left && x <= rectZona.right) {
        const primera = tarjetas[0].getBoundingClientRect()
        const ultima = tarjetas[tarjetas.length - 1].getBoundingClientRect()
        if (y <= primera.top) {
          bajo = tarjetas[0]
          posicionForzada = 'before'
        } else if (y >= ultima.bottom) {
          bajo = tarjetas[tarjetas.length - 1]
          posicionForzada = 'after'
        }
      }
    }
    if (!bajo) return
    const sobreId = bajo.getAttribute('data-drag-id')
    const hasta = st.list.findIndex(it => String(getId(it)) === sobreId)
    if (hasta < 0) return
    const rect = bajo.getBoundingClientRect()
    const despues = posicionForzada ? posicionForzada === 'after' : y > rect.top + rect.height / 2
    const posicion = despues ? 'after' : 'before'
    // Solo cambia el marcador. El reordenamiento ocurre una sola vez al soltar
    // para que el objetivo no salte debajo del puntero.
    if (st.targetId === sobreId && st.targetPosition === posicion) return
    st.targetId = sobreId
    st.targetPosition = posicion
    setOverId(sobreId)
    setDropPosition(posicion)
  }, [getId, livePreview, ordenar])

  const iniciarAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current != null) return
    const tick = () => {
      const point = pointerRef.current
      if (!dragRef.current || !point) { autoScrollFrameRef.current = null; return }
      const borde = 100
      const arriba = Math.max(0, borde - point.y)
      const abajo = Math.max(0, point.y - (window.innerHeight - borde))
      const delta = arriba ? -Math.ceil(4 + arriba * 0.28) : abajo ? Math.ceil(4 + abajo * 0.28) : 0
      if (!delta) { autoScrollFrameRef.current = null; return }
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      const siguiente = Math.min(maxScroll, Math.max(0, window.scrollY + delta))
      const avance = siguiente - window.scrollY
      // Al llegar al inicio/final no se deja un animation frame girando para
      // siempre: es lo que hacía que el arrastre pareciera congelado.
      if (!avance) { autoScrollFrameRef.current = null; return }
      window.scrollBy(0, avance)
      moverSobrePuntero(point.x, point.y)
      autoScrollFrameRef.current = requestAnimationFrame(tick)
    }
    autoScrollFrameRef.current = requestAnimationFrame(tick)
  }, [moverSobrePuntero])

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll])

  const cancelarPendiente = useCallback(() => {
    if (pendingTimerRef.current != null) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = null
    if (!pendingRef.current) return
    pendingRef.current = null
    onDragPendingRef.current(false)
  }, [])

  useEffect(() => () => cancelarPendiente(), [cancelarPendiente])

  const finish = useCallback((commit) => {
    const st = dragRef.current
    dragRef.current = null
    pointerRef.current = null
    stopAutoScroll()
    setDragId(null)
    setPreview(null)
    setPointer(null)
    setOverId(null)
    setDropPosition(null)
    onDragStateChange(false)
    if (!st) return
    const antes = items.map(getId).join(',')
    let ordenFinal = st.list
    if (st.targetId != null && String(st.targetId) !== String(st.id)) {
      const desde = ordenFinal.findIndex(it => String(getId(it)) === String(st.id))
      const hasta = ordenFinal.findIndex(it => String(getId(it)) === String(st.targetId))
      if (desde >= 0 && hasta >= 0) {
        ordenFinal = ordenar(ordenFinal, st.id, st.targetId, st.targetPosition)
      }
    }
    const despues = ordenFinal.map(getId).join(',')
    if (commit && antes !== despues) {
      onReorder(ordenFinal, {
        movedId: st.id,
        fromIndex: st.list.findIndex(it => String(getId(it)) === String(st.id)),
        toIndex: ordenFinal.findIndex(it => String(getId(it)) === String(st.id)),
      })
    }
  }, [items, onReorder, getId, onDragStateChange, stopAutoScroll, ordenar])

  const comenzarArrastre = useCallback((st) => {
    dragRef.current = { id: st.id, list: st.list, targetId: null, targetPosition: null }
    setDragId(st.id)
    setPreview(st.list)
    setPointer(st.point)
    pointerRef.current = st.point
    onDragStateChange(true)
  }, [onDragStateChange])

  const onPointerDown = useCallback((e, item) => {
    if (disabled || e.button === 1 || e.button === 2) return
    e.preventDefault()
    e.stopPropagation()
    const st = { id: getId(item), list, point: { x: e.clientX, y: e.clientY } }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (!activationDelay) {
      comenzarArrastre(st)
      return
    }
    pendingRef.current = st
    onDragPendingRef.current(true)
    pendingTimerRef.current = setTimeout(() => {
      const pendiente = pendingRef.current
      pendingTimerRef.current = null
      if (!pendiente) return
      pendingRef.current = null
      comenzarArrastre(pendiente)
    }, activationDelay)
  }, [disabled, list, getId, activationDelay, comenzarArrastre])

  const onPointerMove = useCallback((e) => {
    if (pendingRef.current) {
      pendingRef.current.point = { x: e.clientX, y: e.clientY }
      return
    }
    if (!dragRef.current) return
    setPointer({ x: e.clientX, y: e.clientY })
    pointerRef.current = { x: e.clientX, y: e.clientY }
    moverSobrePuntero(e.clientX, e.clientY)
    iniciarAutoScroll()
  }, [moverSobrePuntero, iniciarAutoScroll])

  const onPointerUp = useCallback(() => {
    if (pendingRef.current) cancelarPendiente()
    else finish(true)
  }, [finish, cancelarPendiente])
  const onPointerCancel = useCallback(() => {
    if (pendingRef.current) cancelarPendiente()
    else finish(false)
  }, [finish, cancelarPendiente])

  // Pointer capture normalmente entrega el release a la manija, pero este
  // respaldo evita dejar la interfaz bloqueada si el navegador lo pierde al
  // cruzar el borde de la ventana durante un auto-scroll.
  useEffect(() => {
    const soltar = () => {
      if (pendingRef.current) cancelarPendiente()
      else if (dragRef.current) finish(true)
    }
    const cancelar = () => {
      if (pendingRef.current) cancelarPendiente()
      else if (dragRef.current) finish(false)
    }
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', cancelar)
    return () => {
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', cancelar)
    }
  }, [finish, cancelarPendiente])

  const rowProps = useCallback((item) => ({
    'data-drag-id': String(getId(item)),
    'data-drag-over': String(getId(item)) === String(overId) ? dropPosition : undefined,
    style: String(getId(item)) === String(dragId)
      ? { opacity: 0.35, background: 'var(--accent-soft, #eef3ff)' }
      : undefined,
  }), [dragId, overId, dropPosition, getId])

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

  return { items: list, dragId, dragging: dragId != null, pointer, overId, dropPosition, rowProps, handleProps }
}
