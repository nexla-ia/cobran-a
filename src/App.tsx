import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Layout from './components/Layout'
import DialogRoot from './components/DialogRoot'
import Dashboard from './pages/Dashboard'
import Clientes from './pages/Clientes'
import Cobrancas from './pages/Cobrancas'
import Envios from './pages/Envios'
import Mensagens from './pages/Mensagens'
import Configuracoes from './pages/Configuracoes'
import Login from './pages/Login'
import Usuarios from './pages/Usuarios'
import { useAuth } from './lib/auth'

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="h-full grid place-items-center bg-bg">
        <Loader2 className="size-5 animate-spin text-fg-3" />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <AuthGate>
              <Layout />
            </AuthGate>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/cobrancas" element={<Cobrancas />} />
          <Route path="/envios" element={<Envios />} />
          <Route path="/mensagens" element={<Mensagens />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <DialogRoot />
    </>
  )
}
