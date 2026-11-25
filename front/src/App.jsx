import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { UnsavedChangesProvider } from './context/UnsavedChangesContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CotizacionList from './pages/CotizacionList'
import CotizacionEdit from './pages/CotizacionEdit'
import DocumentoClienteEdit from './pages/DocumentoClienteEdit'
import OrdenList from './pages/OrdenList'
import OrdenEdit from './pages/OrdenEdit'
import Remisiones from './pages/Remisiones'
import RemisionEdit from './pages/RemisionEdit'
import ClienteList from './pages/ClienteList'
import ClienteDetail from './pages/ClienteDetail'
import ProduccionHub from './pages/ProduccionHub'
import Troqueles from './pages/Troqueles'
import TroquelGestion from './pages/TroquelGestion'
import Guillotina from './pages/Guillotina'
import RemisionesCentral from './pages/RemisionesCentral'
import EstacionMaquina from './pages/EstacionMaquina'
import Login from './pages/Login'
import Facturacion from './pages/Facturacion'
import FacturaDetalle from './pages/FacturaDetalle'
import { puedeEstacion, puedeTroqueles, puedeRemisionesGenerales, puedeAlgunaRemision, puedeFacturacion, soloFacturacion } from './lib/accesoProduccion'

function ProtectedRoute({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Solo Admin. El Operador queda confinado a /produccion/*.
function AdminRoute({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to={soloFacturacion(user) ? '/facturacion' : '/produccion'} replace />
  return children
}

// Estación/módulo del rol de producción del Operador (ver
// back/cotizaciones/roles.py) — el backend igual lo exige, esto solo evita
// que el Operador aterrice en una pantalla vacía por 403.
function RolRoute({ children, check }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace />
  if (!check(user)) return <Navigate to={soloFacturacion(user) ? '/facturacion' : '/produccion'} replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<AdminRoute><Dashboard /></AdminRoute>} />
        <Route path="/cotizaciones" element={<AdminRoute><CotizacionList /></AdminRoute>} />
        <Route path="/cotizaciones/:id" element={<AdminRoute><CotizacionEdit /></AdminRoute>} />
        <Route path="/documentos/:id" element={<AdminRoute><DocumentoClienteEdit /></AdminRoute>} />
        {/* Solo General (o Admin): crea y edita OPs directas. La pantalla le
            oculta lo monetario al Operador y el backend le cierra las OPs
            que vienen de una COT. Guillotina/Estaciones/Troquelador no entran. */}
        <Route path="/ordenes" element={<RolRoute check={puedeRemisionesGenerales}><OrdenList /></RolRoute>} />
        <Route path="/ordenes/:id" element={<RolRoute check={puedeRemisionesGenerales}><OrdenEdit /></RolRoute>} />
        <Route path="/remisiones" element={<AdminRoute><Remisiones /></AdminRoute>} />
        <Route path="/remisiones/:id" element={<AdminRoute><RemisionEdit /></AdminRoute>} />
        <Route path="/clientes" element={<AdminRoute><ClienteList /></AdminRoute>} />
        <Route path="/clientes/:id" element={<AdminRoute><ClienteDetail /></AdminRoute>} />
        <Route path="/facturacion" element={<RolRoute check={puedeFacturacion}><Facturacion /></RolRoute>} />
        <Route path="/facturacion/:id" element={<RolRoute check={puedeFacturacion}><FacturaDetalle /></RolRoute>} />
        <Route path="/produccion" element={<RolRoute check={u => !soloFacturacion(u)}><ProduccionHub /></RolRoute>} />
        {/* Cadena de producción: una sola pantalla, cuatro estaciones */}
        <Route path="/produccion/impresora" element={<RolRoute check={u => puedeEstacion(u, 'impresora')}><EstacionMaquina estacion="impresora" /></RolRoute>} />
        <Route path="/produccion/laminadora" element={<RolRoute check={u => puedeEstacion(u, 'laminadora')}><EstacionMaquina estacion="laminadora" /></RolRoute>} />
        <Route path="/produccion/barnizadora" element={<RolRoute check={u => puedeEstacion(u, 'barnizadora')}><EstacionMaquina estacion="barnizadora" /></RolRoute>} />
        <Route path="/produccion/troqueladora" element={<RolRoute check={u => puedeEstacion(u, 'troqueladora')}><EstacionMaquina estacion="troqueladora" /></RolRoute>} />
        <Route path="/produccion/troqueles" element={<RolRoute check={puedeTroqueles}><Troqueles /></RolRoute>} />
        <Route path="/produccion/troqueles/:id" element={<AdminRoute><TroquelGestion /></AdminRoute>} />
        {/* Guillotina: página centralizada — cadena (corte inicial + corte final de
            las OPs) y registro libre (cortes sueltos sin OP), en un solo lugar. */}
        <Route path="/produccion/guillotina" element={<RolRoute check={u => puedeEstacion(u, 'guillotina')}><Guillotina /></RolRoute>} />
        <Route path="/produccion/remisiones" element={<RolRoute check={puedeAlgunaRemision}><RemisionesCentral /></RolRoute>} />
        {/* Producción General was replaced by the central Remisiones page. */}
        <Route path="/produccion/general" element={<Navigate to="/produccion/remisiones" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <UnsavedChangesProvider>
        <AppRoutes />
      </UnsavedChangesProvider>
    </AuthProvider>
  )
}
