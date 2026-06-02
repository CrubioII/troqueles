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
import Login from './pages/Login'

function ProtectedRoute({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cotizaciones" element={<CotizacionList />} />
        <Route path="/cotizaciones/:id" element={<CotizacionEdit />} />
        <Route path="/documentos/:id" element={<DocumentoClienteEdit />} />
        <Route path="/ordenes" element={<OrdenList />} />
        <Route path="/ordenes/:id" element={<OrdenEdit />} />
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
