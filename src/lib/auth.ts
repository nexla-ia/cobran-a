import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'

export type Role = 'user' | 'adm'

export type Profile = {
  id: string
  email: string | null
  nome: string | null
  role: Role
  evolution_instancia: string | null
  evolution_api_key: string | null
  conversa_tabela: string | null
  // Regras de automação
  automacao_ativa: boolean
  dias_ate_cancelar: number
  envios_por_dia: number
  intervalo_envios_horas: number
  horario_inicio: string
  horario_fim: string
  dias_semana: number[]
  cancelar_automatico: boolean
  mensagem_template: string | null
  created_at: string
}

export type AuthState = {
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
}

const defaultState: AuthState = {
  session: null,
  profile: null,
  isAdmin: false,
  loading: true,
}

const AuthContext = createContext<AuthState>(defaultState)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    let mounted = true
    // Guarda do user_id atualmente sendo carregado — evita race onde uma
    // carga lenta sobrescreve profile mais recente
    let currentUserId: string | null = null

    const failsafe = window.setTimeout(() => {
      if (mounted) {
        console.warn('[auth] timeout — liberando UI sem sessão')
        setLoading(false)
      }
    }, 5000)

    async function loadProfile(s: Session | null) {
      if (!s) {
        currentUserId = null
        if (mounted) setProfile(null)
        return
      }
      const userId = s.user.id
      currentUserId = userId
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle()
        // Se outra carga começou entre o início e o fim desta, descarta resultado
        if (currentUserId !== userId) return
        if (error) {
          console.warn('[auth] falha ao carregar profile:', error.message)
          if (mounted) setProfile(null)
          return
        }
        // Sessão válida mas profile inexistente = conta foi removida
        // (admin deletou) ou trigger não rodou. Força logout para
        // garantir que o usuário vá pra tela de login.
        if (data === null) {
          console.warn('[auth] conta sem profile — encerrando sessão')
          await supabase.auth.signOut()
          return
        }
        if (mounted) setProfile(data as Profile)
      } catch (e) {
        if (currentUserId !== userId) return
        console.warn('[auth] excecao ao carregar profile:', e)
        if (mounted) setProfile(null)
      }
    }

    // Usa APENAS onAuthStateChange — ele dispara INITIAL_SESSION ao se inscrever,
    // o que entrega a sessão atual sem precisar de getSession() em paralelo
    // (evita race condition em reloads).
    //
    // IMPORTANTE: o callback NÃO pode chamar supabase.* com await diretamente,
    // pois roda segurando o lock interno do GoTrue — isso causa deadlock
    // (profile nunca carrega em INITIAL_SESSION / TOKEN_REFRESHED). Por isso
    // deferimos o loadProfile com setTimeout(0) e liberamos o loading antes.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return
      setSession(s)
      if (mounted) setLoading(false)
      setTimeout(() => {
        if (!mounted) return
        loadProfile(s)
      }, 0)
    })

    return () => {
      mounted = false
      window.clearTimeout(failsafe)
      sub.subscription.unsubscribe()
    }
  }, [])

  // Listener Realtime: observa mudanças no próprio profile.
  // - UPDATE: atualiza state local (mantém role/instancia/api_key/etc em dia
  //   sem precisar de F5 depois que o admin edita o próprio usuário)
  // - DELETE: encerra a sessão imediatamente
  useEffect(() => {
    if (!isSupabaseConfigured || !session) return
    const userId = session.user.id
    const channel = supabase
      .channel(`own-profile-${userId}`)
      .on(
        // @ts-ignore — postgres_changes não tem types completos
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload: { new: Profile }) => {
          setProfile(payload.new)
        },
      )
      .on(
        // @ts-ignore — postgres_changes não tem types completos
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        async () => {
          console.warn('[auth] conta foi removida — saindo')
          await supabase.auth.signOut()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.user?.id])

  const value: AuthState = {
    session,
    profile,
    isAdmin: profile?.role === 'adm',
    loading,
  }

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function requestPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
}

export async function updatePassword(newPassword: string) {
  return supabase.auth.updateUser({ password: newPassword })
}
