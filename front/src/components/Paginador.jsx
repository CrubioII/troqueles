// Pager for server-paginated lists (DRF PAGE_SIZE = 50). Always visible when
// there is something to show, so the user knows whether the list is complete:
// "Mostrando 1–50 de 213 · ← Anterior · 1 2 3 4 5 · Siguiente →".
export const PAGE_SIZE = 50

// Page numbers to draw: first, last, current ±1, with gaps as '…'.
function paginasVisibles(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages))
  const lista = [...set].sort((a, b) => a - b)
  const out = []
  lista.forEach((p, i) => {
    const prev = lista[i - 1]
    if (i > 0 && p - prev === 2) out.push(prev + 1) // a one-page gap: show the number
    else if (i > 0 && p - prev > 2) out.push(`gap-${p}`)
    out.push(p)
  })
  return out
}

export default function Paginador({ page, count, loading = false, onPage, pageSize = PAGE_SIZE, noun = 'registros' }) {
  if (!count) return null
  const pages = Math.max(1, Math.ceil(count / pageSize))
  const desde = (page - 1) * pageSize + 1
  const hasta = Math.min(page * pageSize, count)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      padding: '10px 16px', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)',
    }}>
      <span>
        Mostrando <strong style={{ color: 'var(--ink-2)' }}>{desde}–{hasta}</strong> de <strong style={{ color: 'var(--ink-2)' }}>{count}</strong> {noun}
        {pages > 1 ? ` · página ${page} de ${pages}` : ' · todo cargado'}
      </span>
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>← Anterior</button>
          {paginasVisibles(page, pages).map(p => typeof p === 'string'
            ? <span key={p} style={{ padding: '0 4px' }}>…</span>
            : (
              <button key={p} className={`btn sm${p === page ? ' primary' : ''}`} disabled={loading} onClick={() => p !== page && onPage(p)}
                style={{ minWidth: 32 }} aria-current={p === page ? 'page' : undefined}>
                {p}
              </button>
            ))}
          <button className="btn sm" disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>Siguiente →</button>
        </div>
      )}
    </div>
  )
}
