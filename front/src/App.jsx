import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
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
import TroquelRevision from './pages/TroquelRevision'
import Guillotina from './pages/Guillotina'
import ProduccionGeneral from './pages/ProduccionGeneral'
import Login from './pages/Login'

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
  if (user.role !== 'admin') return <Navigate to="/produccion" replace />
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
        <Route path="/ordenes" element={<AdminRoute><OrdenList /></AdminRoute>} />
        <Route path="/ordenes/:id" element={<AdminRoute><OrdenEdit /></AdminRoute>} />
        <Route path="/remisiones" element={<AdminRoute><Remisiones /></AdminRoute>} />
        <Route path="/remisiones/:id" element={<AdminRoute><RemisionEdit /></AdminRoute>} />
        <Route path="/clientes" element={<AdminRoute><ClienteList /></AdminRoute>} />
        <Route path="/clientes/:id" element={<AdminRoute><ClienteDetail /></AdminRoute>} />
        <Route path="/produccion" element={<ProduccionHub />} />
        <Route path="/produccion/troqueles" element={<Troqueles />} />
        <Route path="/produccion/troqueles/revision" element={<AdminRoute><TroquelRevision /></AdminRoute>} />
        <Route path="/produccion/troqueles/:id" element={<AdminRoute><TroquelGestion /></AdminRoute>} />
        <Route path="/produccion/guillotina" element={<Guillotina />} />
        <Route path="/produccion/general" element={<ProduccionGeneral />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
