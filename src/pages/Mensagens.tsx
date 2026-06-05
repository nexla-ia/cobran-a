import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, MessageSquare, Loader2, ExternalLink, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Cliente, ConversaMsg } from '@/types/db'

// Normaliza uma linha vinda de qualquer schema (n8n LangChain ou normalizado)
// pra ConversaMsg.
function normalizeRow(row: Record<string, unknown>, idx: number): ConversaMsg {
  const get = (key: string) =>
    row[key] !== undefined && row[key] !== null ? row[key] : undefined

  // id pode ser int (n8n) ou uuid
  const rawId = get('id')
  const id = rawId !== undefined ? String(rawId) : `idx-${idx}`

  // telefone: direto ou extraído de session_id
  let telefone = get('telefone') as string | undefined
  if (!telefone) {
    const session = get('session_id') as string | undefined
    if (session) telefone = session.split('@')[0]
  }

  // conteudo: direto ou de message.content (JSONB do LangChain)
  let conteudo = get('conteudo') as string | undefined
  if (!conteudo) {
    const message = get('message') as Record<string, unknown> | undefined
    if (message && typeof message.content === 'string') {
      conteudo = message.content
    }
  }

  // direcao: direta ou inferida do tipo LangChain (human=in, ai=out)
  let direcao = get('direcao') as string | undefined
  if (!direcao) {
    const message = get('message') as Record<string, unknown> | undefined
    const t = message?.type as string | undefined
    if (t === 'human') direcao = 'in'
    else if (t === 'ai') direcao = 'out'
    else direcao = 'out'
  }

  // timestamp: criada_em > created_at > timestamp > fallback
  const criada_em =
    (get('criada_em') as string | undefined) ??
    (get('created_at') as string | undefined) ??
    (get('timestamp') as string | undefined) ??
    new Date().toISOString()

  return {
    id,
    telefone: telefone ?? null,
    conteudo: conteudo ?? null,
    direcao,
    criada_em,
  }
}
import { EmptyState, PageHeader } from '@/components/ui'
import { formatPhoneDisplay } from '@/lib/lookup'

function onlyDigits(s: string | null | undefined) {
  return (s ?? '').replace(/\D/g, '')
}

// Gera variantes BR (com e sem o 9 extra) pra matching tolerante.
function phoneKeys(stored: string | null | undefined): string[] {
  const d = onlyDigits(stored)
  if (!d) return []
  const keys = new Set<string>([d])
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    keys.add(d.slice(0, 4) + d.slice(5))
  } else if (d.length === 12 && d.startsWith('55')) {
    keys.add('55' + d.slice(2, 4) + '9' + d.slice(4))
  }
  return [...keys]
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toTimeString().slice(0, 5)
  } catch {
    return ''
  }
}

function formatRelativeDay(iso: string) {
  try {
    const d = new Date(iso)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const msgDay = new Date(d)
    msgDay.setHours(0, 0, 0, 0)
    const diff = (today.getTime() - msgDay.getTime()) / 86400_000
    if (diff === 0) return 'Hoje'
    if (diff === 1) return 'Ontem'
    return d.toLocaleDateString('pt-BR')
  } catch {
    return ''
  }
}

type Conversa = {
  key: string                  // pra React (telefone normalizado ou id)
  telefone: string | null
  cliente: Cliente | null      // null = órfão (sem cadastro)
  displayNome: string          // nome do cliente ou telefone formatado
  displayDoc: string | null
  lastMsg: ConversaMsg | null
}

export default function Mensagens() {
  const { profile } = useAuth()
  const tabela = profile?.conversa_tabela?.trim() || null
  const instancia = profile?.evolution_instancia?.trim() || null
  // Nome real da tabela que foi aceito pelo PostgREST (case-insensitive resolve)
  const [resolvedTabela, setResolvedTabela] = useState<string | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [msgs, setMsgs] = useState<ConversaMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTelefone, setSelectedTelefone] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  async function load() {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Tenta a tabela com o nome digitado; se PostgREST não achar,
      // tenta lowercase, depois uppercase. Resolve o "NEXLA" vs "nexla".
      async function loadConversasTable() {
        if (!tabela) return { data: [] as Record<string, unknown>[], error: null, name: null }
        const tentativas: string[] = []
        const seen = new Set<string>()
        const push = (s: string) => {
          if (!seen.has(s)) {
            seen.add(s)
            tentativas.push(s)
          }
        }
        push(tabela)
        push(tabela.toLowerCase())
        push(tabela.toUpperCase())
        for (const t of tentativas) {
          const r = await supabase.from(t as never).select('*').limit(2000)
          if (!r.error) {
            return { data: r.data as Record<string, unknown>[], error: null, name: t }
          }
          // só faz fallback quando é "tabela não encontrada"
          const msg = r.error.message ?? ''
          if (!/not find the table|schema cache|does not exist/i.test(msg)) {
            return { data: [] as Record<string, unknown>[], error: r.error, name: null }
          }
        }
        return {
          data: [] as Record<string, unknown>[],
          error: { message: `tabela "${tabela}" não encontrada (tentei: ${tentativas.join(', ')})` },
          name: null,
        }
      }

      // mensagens_atendente — filtra pela instância do user (case-insensitive)
      // pra não mostrar testes/lixo de outras instâncias que ficaram na tabela.
      const atdQuery = supabase
        .from('mensagens_atendente')
        .select('*')
        .order('hora_last_message', { ascending: true })
        .limit(2000)
      if (instancia) atdQuery.ilike('instancia', instancia)

      const [c, m, atd] = await Promise.all([
        supabase.from('clientes').select('*').order('nome'),
        loadConversasTable(),
        atdQuery,
      ])
      if (c.error) console.warn('[mensagens] clientes:', c.error.message)
      if (m.error) {
        console.warn('[mensagens] conversas:', m.error.message)
        setError(
          `Não consegui ler a tabela "${tabela}": ${m.error.message}`,
        )
      }
      setResolvedTabela(m.name)
      if (atd.error) console.warn('[mensagens] atendente:', atd.error.message)

      setClientes(c.data ?? [])

      const aiRows = m.data ?? []
      const aiNormalized = aiRows.map((r, i) => ({
        ...normalizeRow(r, i),
        source: 'ai' as const,
      }))

      const atdRows = (atd.data as Record<string, unknown>[]) ?? []
      // Filtra fora grupos do WhatsApp (@g.us). Só mantém 1-on-1 (@s.whatsapp.net
      // ou número puro).
      const atdRowsSemGrupos = atdRows.filter((r) => {
        const num = String((r as { numero?: string }).numero ?? '')
        return !num.includes('@g.us')
      })
      const atdNormalized: ConversaMsg[] = atdRowsSemGrupos.map((r, i) => {
        const rawNumero = (r.numero as string | null) ?? null
        // Estripa @s.whatsapp.net caso o n8n tenha gravado com sufixo
        const telefone = rawNumero ? rawNumero.split('@')[0] : null

        // Determina direção (regra: só vira 'out' quando algum sinal explícito
        // disser que é envio do atendente/bot; tudo o mais cai em 'in'):
        const typeLower = (r.type as string | undefined)?.toLowerCase().trim() ?? ''
        const nomeLower = (r.nome as string | undefined)?.toLowerCase().trim() ?? ''
        const rawDirecao = (r.direcao as string | undefined)?.toLowerCase()
        const outgoing = new Set([
          'atendente',
          'sistema',
          'bot',
          'ia',
          'ai',
          'nexla',
          'out',
          'enviada',
        ])
        const incoming = new Set(['cliente', 'in', 'recebida'])

        let direcao: string
        if (incoming.has(typeLower) || incoming.has(nomeLower)) {
          direcao = 'in'
        } else if (outgoing.has(typeLower) || outgoing.has(nomeLower)) {
          direcao = 'out'
        } else if (rawDirecao === 'in') {
          direcao = 'in'
        } else if (rawDirecao === 'out' && !nomeLower && !typeLower) {
          // só confia em direcao='out' quando não há type/nome opinando.
          // se houver nome/type que não bateu com outgoing, é cliente.
          direcao = 'out'
        } else {
          direcao = 'in'
        }

        // Escolha do timestamp:
        // Se hora_last_message está mais de 1 dia distante de created_at,
        // assume que o n8n bugou (mês/dia trocados, fuso errado etc.) e usa
        // created_at — que é o relógio do banco no momento do INSERT.
        const createdAt = (r.created_at as string | undefined) ?? null
        const hora = (r.hora_last_message as string | undefined) ?? null
        let criada_em = createdAt ?? hora ?? new Date().toISOString()
        if (createdAt && hora) {
          const dCreated = new Date(createdAt).getTime()
          const dHora = new Date(hora).getTime()
          if (Number.isFinite(dCreated) && Number.isFinite(dHora) && Math.abs(dCreated - dHora) < 86_400_000) {
            // diferença < 24h: confia no que o n8n mandou
            criada_em = hora
          } else {
            criada_em = createdAt
          }
        }

        return {
          id: r.id ? String(r.id) : `atd-${i}`,
          telefone,
          conteudo: (r.mensagem as string | null) ?? null,
          direcao,
          criada_em,
          source: 'atendente',
          atendente_nome: (r.nome as string | null) ?? null,
          base64: (r.base64 as string | null) ?? null,
          midia_type: (r.type as string | null) ?? null,
        }
      })

      // Ordena cronologicamente. Quando timestamps batem (ex.: rows AI antigas
      // que receberam o mesmo created_at na migration), desempata pelo id
      // serial — que cresce na ordem real das mensagens.
      const merged = [...aiNormalized, ...atdNormalized].sort((a, b) => {
        const ta = new Date(a.criada_em).getTime()
        const tb = new Date(b.criada_em).getTime()
        if (ta !== tb) return ta - tb
        const ia = Number(a.id)
        const ib = Number(b.id)
        if (Number.isFinite(ia) && Number.isFinite(ib)) return ia - ib
        return String(a.id).localeCompare(String(b.id))
      })
      setMsgs(merged)
    } catch (e) {
      console.error('[mensagens] load:', e)
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabela])

  // Realtime na tabela apontada pelo profile + mensagens_atendente.
  // Obs.: Realtime do Supabase só funciona em TABELAS base — views ficam mudas.
  // Por isso também rodamos um polling leve como fallback.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const channel = supabase.channel(`conv-${resolvedTabela ?? 'none'}`)
    if (resolvedTabela) {
      channel.on(
        // @ts-ignore — postgres_changes não tem types completos
        'postgres_changes',
        { event: '*', schema: 'public', table: resolvedTabela },
        () => load(),
      )
    }
    channel.on(
      // @ts-ignore — postgres_changes não tem types completos
      'postgres_changes',
      { event: '*', schema: 'public', table: 'mensagens_atendente' },
      () => load(),
    )
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTabela])

  // Polling de 8s como fallback (essencial quando conversa_tabela é uma view)
  useEffect(() => {
    if (!isSupabaseConfigured || !tabela) return
    const handle = window.setInterval(() => {
      load()
    }, 8000)
    return () => window.clearInterval(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabela])

  // Indexa última mensagem por telefone normalizado
  const lastByPhone = useMemo(() => {
    const m = new Map<string, ConversaMsg>()
    for (const x of msgs) {
      const keys = phoneKeys(x.telefone)
      for (const k of keys) {
        const cur = m.get(k)
        if (!cur || new Date(x.criada_em) > new Date(cur.criada_em)) m.set(k, x)
      }
    }
    return m
  }, [msgs])

  // Lista unificada de conversas: clientes cadastrados + telefones órfãos das mensagens
  const conversas: Conversa[] = useMemo(() => {
    const list: Conversa[] = []
    const phonesUsados = new Set<string>()

    // 1) Clientes cadastrados (com ou sem mensagem)
    for (const c of clientes) {
      let last: ConversaMsg | null = null
      const keys = phoneKeys(c.telefone)
      for (const k of keys) {
        const found = lastByPhone.get(k)
        if (found && (!last || new Date(found.criada_em) > new Date(last.criada_em))) {
          last = found
        }
        phonesUsados.add(k)
      }
      list.push({
        key: c.id,
        telefone: c.telefone,
        cliente: c,
        displayNome: c.nome,
        displayDoc: c.documento,
        lastMsg: last,
      })
    }

    // 2) Telefones que apareceram em mensagens mas NÃO casam com nenhum cliente
    const phonesOrfaos = new Map<string, ConversaMsg>()
    for (const m of msgs) {
      const keys = phoneKeys(m.telefone)
      if (keys.length === 0) continue
      const known = keys.some((k) => phonesUsados.has(k))
      if (known) continue
      // pega a chave canônica = a primeira (dígitos do telefone)
      const canonical = keys[0]
      const cur = phonesOrfaos.get(canonical)
      if (!cur || new Date(m.criada_em) > new Date(cur.criada_em)) {
        phonesOrfaos.set(canonical, m)
      }
    }
    for (const [phone, last] of phonesOrfaos) {
      list.push({
        key: `orfao-${phone}`,
        telefone: phone,
        cliente: null,
        displayNome: formatPhoneDisplay(phone) || phone,
        displayDoc: null,
        lastMsg: last,
      })
    }

    // 3) Ordena por última mensagem desc
    list.sort((a, b) => {
      const ta = a.lastMsg ? new Date(a.lastMsg.criada_em).getTime() : 0
      const tb = b.lastMsg ? new Date(b.lastMsg.criada_em).getTime() : 0
      return tb - ta
    })

    return list
  }, [clientes, msgs, lastByPhone])

  const q = query.trim().toLowerCase()
  const filteredConversas = conversas.filter((c) => {
    if (!q) return true
    return (
      c.displayNome.toLowerCase().includes(q) ||
      (c.displayDoc?.toLowerCase().includes(q) ?? false) ||
      (c.telefone?.toLowerCase().includes(q) ?? false)
    )
  })

  // Conversa selecionada
  const selectedConversa =
    conversas.find((c) => phoneKeys(c.telefone).some((k) => k === selectedTelefone)) ?? null
  const selectedMsgs = useMemo(() => {
    if (!selectedTelefone) return []
    const set = new Set(phoneKeys(selectedTelefone))
    return msgs
      .filter((m) => phoneKeys(m.telefone).some((k) => set.has(k)))
      .sort((a, b) => new Date(a.criada_em).getTime() - new Date(b.criada_em).getTime())
  }, [msgs, selectedTelefone])

  const selectedDisplayNome = selectedConversa?.displayNome ?? ''
  const selectedTelefoneShow = selectedConversa?.telefone ?? null
  const selectedOrfao = !!selectedConversa && !selectedConversa.cliente

  // Scroll automático ao fim ao trocar de conversa ou chegar msg nova
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedMsgs.length, selectedTelefone])

  return (
    <div>
      <PageHeader
        title="Mensagens"
        subtitle={
          resolvedTabela
            ? `Lendo de "${resolvedTabela}"${
                instancia ? ` · instância ${instancia}` : ''
              }`
            : 'Conversas em tempo real por cliente.'
        }
      />

      {!tabela ? (
        <EmptyState
          title="Tabela de conversas não configurada"
          hint="Peça ao admin pra preencher o campo 'Tabela de conversas' no seu perfil (/usuarios)."
        />
      ) : error ? (
        <div className="border border-danger/30 bg-red-50 text-danger rounded-lg p-4 text-sm">
          {error}
        </div>
      ) : (
        <div className="border border-border rounded-lg bg-surface overflow-hidden grid grid-cols-1 md:grid-cols-[280px_1fr] h-[calc(100vh-220px)] min-h-[480px]">
          {/* Lista de clientes */}
          <div className="border-r border-border flex flex-col bg-bg">
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="size-3.5 text-fg-4 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar cliente…"
                  className="h-8 w-full pl-8 pr-7 text-xs bg-surface border border-border rounded-md text-fg placeholder:text-fg-4 outline-none focus:border-fg-3 transition"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center text-fg-4 hover:text-fg rounded"
                    aria-label="Limpar"
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && clientes.length === 0 ? (
                <div className="p-6 flex items-center justify-center text-fg-4 text-xs">
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Carregando…
                </div>
              ) : filteredConversas.length === 0 ? (
                <div className="p-6 text-center text-xs text-fg-4">
                  {conversas.length === 0
                    ? 'Nenhuma conversa por enquanto.'
                    : 'Nenhum resultado pra esta busca.'}
                </div>
              ) : (
                filteredConversas.map((c) => {
                  const phoneKey = phoneKeys(c.telefone)[0] ?? null
                  const isSelected = phoneKey && selectedTelefone === phoneKey
                  const isOrfao = c.cliente === null
                  return (
                    <button
                      key={c.key}
                      onClick={() => setSelectedTelefone(phoneKey)}
                      className={`w-full text-left px-3 py-2.5 border-b border-border-2 last:border-b-0 flex gap-3 items-start transition ${
                        isSelected ? 'bg-hover' : 'hover:bg-hover/60'
                      }`}
                    >
                      <div
                        className={`size-9 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${
                          isOrfao
                            ? 'bg-warn/10 text-warn border border-warn/30'
                            : 'bg-hover text-fg-2'
                        }`}
                      >
                        {isOrfao ? '?' : c.displayNome.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm text-fg truncate flex items-center gap-1.5">
                            {c.displayNome}
                            {isOrfao && (
                              <span
                                className="text-[9px] uppercase tracking-wide font-medium text-warn bg-warn/10 px-1 py-0.5 rounded"
                                title="Sem cadastro"
                              >
                                novo
                              </span>
                            )}
                          </div>
                          {c.lastMsg && (
                            <div className="text-[10px] text-fg-4 tabular shrink-0">
                              {formatRelativeDay(c.lastMsg.criada_em) === 'Hoje'
                                ? formatTime(c.lastMsg.criada_em)
                                : formatRelativeDay(c.lastMsg.criada_em)}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-fg-4 truncate">
                          {c.lastMsg?.conteudo ?? (
                            <span className="italic">sem mensagens</span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Chat */}
          <div className="flex flex-col bg-surface min-h-0">
            {!selectedConversa ? (
              <div className="flex-1 grid place-items-center text-fg-4 text-sm p-6">
                <div className="text-center">
                  <MessageSquare className="size-8 mx-auto mb-3 text-fg-4/60" />
                  Selecione uma conversa à esquerda.
                </div>
              </div>
            ) : (
              <>
                <div className="px-4 h-14 border-b border-border flex items-center gap-3">
                  <div
                    className={`size-8 rounded-full grid place-items-center text-xs font-semibold ${
                      selectedOrfao
                        ? 'bg-warn/10 text-warn border border-warn/30'
                        : 'bg-hover text-fg-2'
                    }`}
                  >
                    {selectedOrfao ? '?' : selectedDisplayNome.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-fg truncate flex items-center gap-1.5">
                      {selectedDisplayNome}
                      {selectedOrfao && (
                        <span
                          className="text-[9px] uppercase tracking-wide font-medium text-warn bg-warn/10 px-1 py-0.5 rounded"
                          title="Sem cadastro"
                        >
                          novo
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-4 tabular">
                      {selectedTelefoneShow
                        ? formatPhoneDisplay(selectedTelefoneShow)
                        : '—'}
                    </div>
                  </div>
                  {selectedOrfao && selectedTelefoneShow && (
                    <Link
                      to={`/clientes?novo=1&telefone=${encodeURIComponent(selectedTelefoneShow)}`}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-fg text-surface hover:bg-fg-2 transition shrink-0"
                      title="Adicionar este contato como cliente"
                    >
                      <UserPlus className="size-3.5" />
                      Cadastrar
                    </Link>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 bg-bg space-y-2">
                  {selectedMsgs.length === 0 ? (
                    <div className="text-center text-xs text-fg-4 py-10">
                      Sem mensagens nessa conversa ainda.
                    </div>
                  ) : (
                    selectedMsgs.map((m, i) => {
                      const isOut = m.direcao === 'out' || m.direcao === 'enviada'
                      const prev = selectedMsgs[i - 1]
                      const showDate =
                        !prev ||
                        new Date(prev.criada_em).toDateString() !==
                          new Date(m.criada_em).toDateString()
                      return (
                        <div key={m.id ?? `${i}-${m.criada_em}`}>
                          {showDate && (
                            <div className="text-center my-3">
                              <span className="text-[10px] text-fg-4 px-2 py-0.5 rounded bg-surface border border-border">
                                {formatRelativeDay(m.criada_em)}
                              </span>
                            </div>
                          )}
                          <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                                isOut
                                  ? m.source === 'atendente'
                                    ? 'bg-emerald-600 text-white rounded-br-sm'
                                    : 'bg-fg text-surface rounded-br-sm'
                                  : 'bg-surface border border-border text-fg rounded-bl-sm'
                              }`}
                            >
                              {isOut && m.source === 'atendente' && m.atendente_nome && (
                                <div className="text-[10px] font-semibold opacity-80 mb-0.5">
                                  {m.atendente_nome}
                                </div>
                              )}
                              {m.base64 &&
                              (m.midia_type === 'image' || m.midia_type === 'imagem') ? (
                                <img
                                  src={
                                    m.base64.startsWith('data:')
                                      ? m.base64
                                      : `data:image/jpeg;base64,${m.base64}`
                                  }
                                  alt="anexo"
                                  className="rounded-md max-w-full mb-1"
                                />
                              ) : m.base64 ? (
                                <div className="text-[11px] opacity-80 italic mb-1">
                                  [anexo {m.midia_type ?? 'mídia'}]
                                </div>
                              ) : null}
                              <div className="whitespace-pre-wrap break-words">
                                {m.conteudo ?? <span className="italic opacity-60">[sem texto]</span>}
                              </div>
                              <div
                                className={`text-[10px] mt-1 tabular ${
                                  isOut ? 'text-white/70 text-right' : 'text-fg-4'
                                }`}
                              >
                                {formatTime(m.criada_em)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>
                {selectedTelefoneShow && (
                  <div className="px-4 py-3 border-t border-border bg-surface flex items-center justify-end">
                    <a
                      href={`https://wa.me/${selectedTelefoneShow.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition"
                      title="Abrir conversa no WhatsApp"
                    >
                      <MessageSquare className="size-4" />
                      Abrir no WhatsApp
                      <ExternalLink className="size-3.5" />
                    </a>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
