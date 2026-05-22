import React from 'react'
import { Routes, Route } from 'react-router-dom'
import CotizacionList from './pages/CotizacionList'
import CotizacionEdit from './pages/CotizacionEdit'
import DocumentoClienteEdit from './pages/DocumentoClienteEdit'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CotizacionList />} />
      <Route path="/cotizaciones/:id" element={<CotizacionEdit />} />
      <Route path="/documentos/nuevo" element={<DocumentoClienteEdit />} />
      <Route path="/documentos/:id" element={<DocumentoClienteEdit />} />
    </Routes>
  )
}
