import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Icon } from './Icons'

const PRODUCCION_SUBLINKS = [
  { label: 'Hub de producción', path: '/produccion', exact: true, icon: <Icon.Progress width="15" height="15" /> },
  { label: 'Troqueles', path: '/produccion/troqueles', icon: <Icon.Stamp width="15" height="15" /> },
  { label: 'Guillotina', path: '/produccion/guillotina', icon: <Icon.Blade width="15" height="15" /> },
  { label: 'Producción general', path: '/produccion/general', icon: <Icon.Progress width="15" height="15" /> },
  { label: 'Órdenes (CRUD)', path: '/ordenes', adminOnly: true, icon: <Icon.Duplicate width="15" height="15" /> },
]

const NAV_LINKS = [
  {
    label: 'Inicio',
    path: '/',
    exact: true,
    adminOnly: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d="M3 12L12 3l9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    label: 'Cotizaciones',
    path: '/cotizaciones',
    adminOnly: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 8h8M7 12h6M7 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Producción',
    path: '/produccion',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="7" width="20" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 7V5a2 2 0 014 0v2M13 7V5a2 2 0 014 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <path d="M6 13h4M6 17h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Remisiones',
    path: '/remisiones',
    adminOnly: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d="M3 6h18M3 12h12M3 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="18" cy="18" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M16.5 18l1 1 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
]

function NavButton({ link, currentPath }) {
  const navigate = useNavigate()
  const active = link.exact ? currentPath === link.path : currentPath.startsWith(link.path)

  return (
    <button
      onClick={() => navigate(link.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 10px',
        borderRadius: 6, border: 'none', cursor: 'pointer',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink-2)',
        fontWeight: active ? 600 : 400,
        fontSize: 13, textAlign: 'left',
        marginBottom: 1,
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ flexShrink: 0, opacity: active ? 1 : 0.55 }}>{link.icon}</span>
      {link.label}
    </button>
  )
}

function MobileNavButton({ link, currentPath }) {
  const navigate = useNavigate()
  const active = link.exact ? currentPath === link.path : currentPath.startsWith(link.path)

  return (
    <button
      className={`app-bottom-nav-btn${active ? ' active' : ''}`}
      onClick={() => navigate(link.path)}
    >
      <span className="ico">{link.icon}</span>
      {link.label}
    </button>
  )
}

function DrawerLink({ link, currentPath, onNavigate, sub }) {
  const navigate = useNavigate()
  const active = link.exact ? currentPath === link.path : currentPath.startsWith(link.path)

  return (
    <button
      className={`app-drawer-link${active ? ' active' : ''}${sub ? ' sub' : ''}`}
      onClick={() => { navigate(link.path); onNavigate() }}
    >
      <span className="ico">{link.icon}</span>
      {link.label}
    </button>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const isAdmin = user?.role === 'admin'
  const navLinks = NAV_LINKS.filter(l => isAdmin || !l.adminOnly)
  const subLinks = PRODUCCION_SUBLINKS.filter(l => isAdmin || !l.adminOnly)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = e => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Sidebar (desktop) */}
      <aside className="app-sidebar" style={{
        width: 210,
        background: 'var(--surface)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}>
        {/* Brand */}
        <div style={{ padding: '18px 16px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 6,
              background: 'var(--ink)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, letterSpacing: '-0.02em', flexShrink: 0,
            }}>TI</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.2 }}>Troqueles INK</div>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>Sistema de gestión</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px' }}>
          {navLinks.map(link => (
            <NavButton key={link.path} link={link} currentPath={location.pathname} />
          ))}
        </nav>

        {/* User + logout */}
        <div style={{ padding: '12px', borderTop: '1px solid var(--line)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px',
            background: 'var(--surface-2)', borderRadius: 8,
            marginBottom: 8,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--accent)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, flexShrink: 0,
            }}>
              {user?.username?.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.username}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                {user?.role === 'admin' ? 'Administrador' : 'Operador'}
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            style={{
              width: '100%', padding: '6px 10px',
              background: 'transparent', border: '1px solid var(--line)',
              borderRadius: 6, cursor: 'pointer',
              fontSize: 12, color: 'var(--ink-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Page content */}
      <div className="app-content" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Mobile topbar */}
        <div className="app-mobile-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="app-burger-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menú"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
            <div style={{
              width: 26, height: 26, borderRadius: 6,
              background: 'var(--ink)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em', flexShrink: 0,
            }}>TI</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Troqueles INK</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--accent)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, flexShrink: 0,
            }}>
              {user?.username?.slice(0, 2).toUpperCase()}
            </div>
            <button
              onClick={logout}
              style={{
                padding: 6, background: 'transparent', border: 'none',
                color: 'var(--ink-3)', cursor: 'pointer',
                display: 'flex', alignItems: 'center',
              }}
              aria-label="Cerrar sesión"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <Outlet />
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="app-bottom-nav">
        {navLinks.map(link => (
          <MobileNavButton key={link.path} link={link} currentPath={location.pathname} />
        ))}
      </nav>

      {/* Guided nav drawer (mobile) */}
      <div
        className={`app-drawer-backdrop${drawerOpen ? ' open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside className={`app-drawer-panel${drawerOpen ? ' open' : ''}`}>
        <div className="app-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'var(--ink)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, letterSpacing: '-0.02em', flexShrink: 0,
            }}>TI</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.2 }}>Troqueles INK</div>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>Guía de navegación</div>
            </div>
          </div>
          <button className="app-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Cerrar menú">
            <Icon.X width="13" height="13" />
          </button>
        </div>

        <nav className="app-drawer-nav">
          {navLinks.map(link => (
            <div key={link.path}>
              <DrawerLink link={link} currentPath={location.pathname} onNavigate={() => setDrawerOpen(false)} />
              {link.path === '/produccion' && (
                <div className="app-drawer-sublist">
                  {subLinks.map(sub => (
                    <DrawerLink key={sub.path} link={sub} currentPath={location.pathname} onNavigate={() => setDrawerOpen(false)} sub />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="app-drawer-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--accent)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, flexShrink: 0,
            }}>
              {user?.username?.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.username}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                {user?.role === 'admin' ? 'Administrador' : 'Operador'}
              </div>
            </div>
          </div>
          <button className="app-drawer-logout" onClick={logout}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Cerrar sesión
          </button>
        </div>
      </aside>
    </div>
  )
}
