import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
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
      <Route path="/" element={<ProtectedRoute><CotizacionList /></ProtectedRoute>} />
      <Route path="/cotizaciones/:id" element={<ProtectedRoute><CotizacionEdit /></ProtectedRoute>} />
      <Route path="/documentos/:id" element={<ProtectedRoute><DocumentoClienteEdit /></ProtectedRoute>} />
      <Route path="/ordenes" element={<ProtectedRoute><OrdenList /></ProtectedRoute>} />
      <Route path="/ordenes/:id" element={<ProtectedRoute><OrdenEdit /></ProtectedRoute>} />
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
