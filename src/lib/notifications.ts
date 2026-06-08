import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from './supabase'
import { useAuth } from './auth'
import { toast } from './dialogs'

/**
 * Conta quantas mensagens novas chegaram desde a última visita do user a
 * /mensagens. Persistido em localStorage.
 *
 * Também dispara um toast quando uma mensagem chega e o user NÃO está na
 * página de mensagens.
 */
export function useUnreadMessages() {
  const { session, profile } = useAuth()
  const location = useLocation()
  const userId = session?.user?.id ?? null
  const onMensagensPage = location.pathname === '/mensagens'

  const lsKey = userId ? `msgs-seen-${userId}` : null
  const tabelas = useMemo(
    () =>
      (profile?.conversa_tabela ?? '')
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [profile?.conversa_tabela],
  )
  const instancia = profile?.evolution_instancia?.trim() ?? null

  const [unread, setUnread] = useState(0)
  const onMensagensRef = useRef(onMensagensPage)
  useEffect(() => {
    onMensagensRef.current = onMensagensPage
  }, [onMensagensPage])

  function getLastSeen(): number {
    if (!lsKey) return 0
    const v = localStorage.getItem(lsKey)
    return v ? Number(v) : 0
  }

  function markAllSeen() {
    if (!lsKey) return
    localStorage.setItem(lsKey, String(Date.now()))
    setUnread(0)
  }

  // Recalcula contagem com base no localStorage + queries de novos
  async function recompute() {
    if (!userId || !isSupabaseConfigured) {
      setUnread(0)
      return
    }
    if (onMensagensRef.current) {
      // Se está vendo a tela, considera tudo como lido
      markAllSeen()
      return
    }
    const lastSeen = getLastSeen()
    if (!lastSeen) {
      // Primeira visita — marca tudo como já lido (não dá pra "novidade" sem baseline)
      markAllSeen()
      return
    }
    const sinceIso = new Date(lastSeen).toISOString()

    let total = 0
    // mensagens_atendente — direcao IN (mensagem recebida do cliente)
    if (instancia) {
      const r = await supabase
        .from('mensagens_atendente')
        .select('id', { count: 'exact', head: true })
        .ilike('instancia', instancia)
        .gte('created_at', sinceIso)
        .or('direcao.eq.in,type.ilike.cliente')
      if (!r.error && r.count) total += r.count
    }
    // tabelas LangChain — mensagens type=human são as recebidas
    for (const t of tabelas) {
      // tenta original, depois lowercase
      for (const variant of [t, t.toLowerCase(), t.toUpperCase()]) {
        const r = await supabase
          .from(variant as never)
          .select('id', { count: 'exact', head: true })
          .gte('created_at', sinceIso)
          .filter('message->>type', 'eq', 'human')
        if (!r.error) {
          total += r.count ?? 0
          break
        }
      }
    }
    setUnread(total)
  }

  // Listener Realtime: incrementa contador + dispara toast quando chega
  useEffect(() => {
    if (!isSupabaseConfigured || !userId) return

    const channel = supabase.channel(`unread-${userId}`)

    // mensagens_atendente
    channel.on(
      // @ts-ignore — postgres_changes não tem types completos
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mensagens_atendente' },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new ?? {}
        const inst = String((row as { instancia?: string }).instancia ?? '').toLowerCase()
        const targetInst = (instancia ?? '').toLowerCase()
        if (targetInst && inst !== targetInst) return
        const direcao = String((row as { direcao?: string }).direcao ?? '').toLowerCase()
        const type = String((row as { type?: string }).type ?? '').toLowerCase()
        const isIncoming = direcao === 'in' || type === 'cliente'
        if (!isIncoming) return
        handleIncoming({
          nome: (row as { nome?: string }).nome ?? null,
          texto: (row as { mensagem?: string }).mensagem ?? null,
        })
      },
    )

    // Tabelas LangChain
    for (const t of tabelas) {
      for (const variant of [t, t.toLowerCase()]) {
        channel.on(
          // @ts-ignore — postgres_changes não tem types completos
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: variant },
          (payload: { new: Record<string, unknown> }) => {
            const row = payload.new ?? {}
            const message = (row as { message?: Record<string, unknown> }).message
            const tipo = message ? String(message.type ?? '').toLowerCase() : ''
            if (tipo !== 'human') return
            const conteudo =
              message && typeof message.content === 'string'
                ? (message.content as string)
                : null
            handleIncoming({ nome: null, texto: conteudo })
          },
        )
      }
    }

    channel.subscribe()

    function handleIncoming(detail: { nome: string | null; texto: string | null }) {
      if (onMensagensRef.current) {
        // user está vendo a tela — marca como visto, sem toast
        markAllSeen()
        return
      }
      setUnread((c) => c + 1)
      const preview = (detail.texto ?? '').slice(0, 80) || '(mídia)'
      toast.info(`Nova mensagem${detail.nome ? ` de ${detail.nome}` : ''}: ${preview}`, {
        duration: 5000,
      })
    }

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, instancia, tabelas.join('|')])

  // Recompute ao carregar / mudar profile / trocar de página
  useEffect(() => {
    recompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, instancia, tabelas.join('|'), onMensagensPage])

  // Polling leve a cada 30s pra sincronizar com Realtime se algo passar batido
  useEffect(() => {
    if (!userId) return
    const h = window.setInterval(() => {
      recompute()
    }, 30_000)
    return () => window.clearInterval(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  return { unread, markAllSeen }
}
