import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, Users, Receipt, CircleDollarSign, Menu, X, LogOut, ShieldCheck } from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/supabase'
import { signOut, useAuth } from '@/lib/auth'
import { confirmDialog, toast } from '@/lib/dialogs'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true, adminOnly: false },
  { to: '/clientes', label: 'Clientes', icon: Users, end: false, adminOnly: false },
  { to: '/cobrancas', label: 'Cobranças', icon: Receipt, end: false, adminOnly: false },
  { to: '/usuarios', label: 'Usuários', icon: ShieldCheck, end: false, adminOnly: true },
] as const

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { session, isAdmin, profile } = useAuth()
  const navigate = useNavigate()
  const email = session?.user?.email ?? ''
  const visibleNav = nav.filter((n) => !n.adminOnly || isAdmin)

  async function handleLogout() {
    try {
      const ok = await confirmDialog({
        title: 'Sair da conta?',
        message: 'Você precisará entrar novamente para acessar o painel.',
        confirmLabel: 'Sair',
      })
      if (!ok) return
      const { error } = await signOut()
      if (error) {
        toast.error(`Falha ao sair: ${error.message}`)
      } else {
        toast.info('Sessão encerrada.')
      }
    } catch (e) {
      console.error('[layout] erro no logout:', e)
    } finally {
      onNavigate?.()
      navigate('/login', { replace: true })
    }
  }

  return (
    <>
      <div className="px-4 h-14 flex items-center gap-2 border-b border-border">
        <div className="size-7 rounded-md bg-fg text-surface grid place-items-center transition-transform hover:rotate-[8deg]">
          <CircleDollarSign className="size-4" />
        </div>
        <span className="text-sm font-semibold text-fg">Cobrança</span>
      </div>

      <nav className="p-2 flex-1 space-y-0.5">
        {visibleNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `nav-link relative flex items-center gap-2.5 rounded-md px-2.5 h-9 text-sm ${
                isActive
                  ? 'bg-hover text-fg font-medium'
                  : 'text-fg-3 hover:text-fg hover:bg-hover/60'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] bg-fg rounded-r" />
                )}
                <Icon className="size-4 shrink-0" />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {!isSupabaseConfigured && (
        <div className="m-2 rounded-md border border-border bg-bg p-3 text-xs text-fg-3">
          <div className="font-medium text-fg mb-0.5">Supabase não configurado</div>
          Copie <code className="font-mono">.env.example</code> → <code className="font-mono">.env</code>.
        </div>
      )}

      {email && (
        <div className="p-2 border-t border-border">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="size-7 rounded-full bg-hover text-fg-2 grid place-items-center text-xs font-semibold shrink-0">
              {((profile?.nome || email) ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-fg truncate" title={email}>
                {profile?.nome || email}
              </div>
              <div className="text-[10px] text-fg-4 flex items-center gap-1">
                {profile?.role === 'adm' ? (
                  <span className="text-[9px] font-semibold tracking-wider text-fg bg-hover px-1 py-px rounded">
                    ADM
                  </span>
                ) : (
                  <span className="truncate">{profile?.nome ? email : 'Conectado'}</span>
                )}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="size-7 grid place-items-center rounded-md text-fg-3 hover:text-danger hover:bg-hover transition shrink-0"
              title="Sair"
              aria-label="Sair"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function Layout() {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  return (
    <div className="flex flex-col lg:flex-row h-full bg-bg">
      {/* Top bar (mobile only) */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border bg-surface/90 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-fg text-surface grid place-items-center">
            <CircleDollarSign className="size-4" />
          </div>
          <span className="text-sm font-semibold text-fg">Cobrança</span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="size-9 grid place-items-center rounded-md text-fg-2 hover:bg-hover transition"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 shrink-0 border-r border-border bg-surface flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="modal-overlay absolute inset-0 bg-fg/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface border-r border-border flex flex-col shadow-2xl"
            style={{ animation: 'fade-in 220ms cubic-bezier(0.22,1,0.36,1) both' }}
          >
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 right-3 size-8 grid place-items-center rounded-md text-fg-3 hover:bg-hover transition"
              aria-label="Fechar menu"
            >
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        <div
          key={location.pathname}
          className="page-enter max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10"
        >
          <Outlet />
        </div>
      </main>
    </div>
  )
}
