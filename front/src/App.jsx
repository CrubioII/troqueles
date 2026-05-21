import React from 'react'
import { Routes, Route } from 'react-router-dom'
import CotizacionList from './pages/CotizacionList'
import CotizacionEdit from './pages/CotizacionEdit'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CotizacionList />} />
      <Route path="/cotizaciones/:id" element={<CotizacionEdit />} />
    </Routes>
  )
}
