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

// Detecta o MIME type a partir dos primeiros caracteres do base64.
// WhatsApp envia stickers (webp), imagens (jpeg/png), áudios (ogg/opus
// pra voice note, mp3), vídeos (mp4) e PDFs/arquivos.
function detectMime(base64: string): string {
  // Aceita data URIs já com mime declarado
  const m = base64.match(/^data:([^;]+);base64,/)
  if (m) return m[1]

  const p = base64.slice(0, 24)
  // Imagens
  if (p.startsWith('/9j/')) return 'image/jpeg'
  if (p.startsWith('iVBORw0KGgo')) return 'image/png'
  if (p.startsWith('R0lGODlh') || p.startsWith('R0lGODdh')) return 'image/gif'
  // WhatsApp sticker é webp (header RIFF...WEBP)
  if (p.startsWith('UklGR')) return 'image/webp'
  // Documentos
  if (p.startsWith('JVBERi')) return 'application/pdf'
  if (p.startsWith('UEsDB')) return 'application/zip' // ou docx/xlsx (zip-based)
  // Áudio
  if (p.startsWith('T2dn') || p.startsWith('Ck9n')) return 'audio/ogg' // OggS
  if (p.startsWith('SUQz')) return 'audio/mpeg' // ID3 (mp3)
  if (p.startsWith('//uQ') || p.startsWith('//tQ') || p.startsWith('/+M')) return 'audio/mpeg'
  // Vídeo MP4 (ftyp aparece depois dos 4 primeiros bytes; base64 marca "ftyp")
  if (p.includes('ftyp') || p.includes('ZnR5c')) return 'video/mp4'
  return 'application/octet-stream'
}

function mimeToKind(mime: string): 'image' | 'sticker' | 'audio' | 'video' | 'pdf' | 'file' {
  if (mime === 'image/webp') return 'sticker'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'pdf'
  return 'file'
}

function dataUriFromBase64(base64: string, mime: string): string {
  if (base64.startsWith('data:')) return base64
  return `data:${mime};base64,${base64}`
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
  // Aceita uma OU várias tabelas separadas por vírgula (ex.:
  // "n8n_chat_histories_cobranca, n8n_chat_histories_cobranca_nexla").
  // O front lê de todas, normaliza e mescla por tempo.
  const tabelas = (profile?.conversa_tabela ?? '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const instancia = profile?.evolution_instancia?.trim() || null
  // Nomes reais que foram aceitos pelo PostgREST (case-insensitive resolve)
  const [resolvedTabelas, setResolvedTabelas] = useState<string[]>([])
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
      // Lê UMA tabela tentando variações de case (NEXLA → nexla → NEXLA).
      async function loadOneTable(nome: string) {
        const tentativas: string[] = []
        const seen = new Set<string>()
        const push = (s: string) => {
          if (!seen.has(s)) {
            seen.add(s)
            tentativas.push(s)
          }
        }
        push(nome)
        push(nome.toLowerCase())
        push(nome.toUpperCase())
        for (const t of tentativas) {
          const r = await supabase.from(t as never).select('*').limit(2000)
          if (!r.error) {
            return { data: r.data as Record<string, unknown>[], name: t, error: null }
          }
          const msg = r.error.message ?? ''
          if (!/not find the table|schema cache|does not exist/i.test(msg)) {
            return { data: [] as Record<string, unknown>[], name: null, error: r.error }
          }
        }
        return {
          data: [] as Record<string, unknown>[],
          name: null,
          error: { message: `tabela "${nome}" não encontrada` },
        }
      }

      // mensagens_atendente — filtra pela instância do user
      const atdQuery = supabase
        .from('mensagens_atendente')
        .select('*')
        .order('hora_last_message', { ascending: true })
        .limit(2000)
      if (instancia) atdQuery.ilike('instancia', instancia)

      const [c, tabelasResults, atd] = await Promise.all([
        supabase.from('clientes').select('*').order('nome'),
        Promise.all(tabelas.map(loadOneTable)),
        atdQuery,
      ])
      if (c.error) console.warn('[mensagens] clientes:', c.error.message)
      if (atd.error) console.warn('[mensagens] atendente:', atd.error.message)

      // Acumula erros e nomes resolvidos
      const erros: string[] = []
      const nomesResolvidos: string[] = []
      const linhasAI: Record<string, unknown>[] = []
      for (const r of tabelasResults) {
        if (r.error) {
          console.warn('[mensagens] tabela:', r.error.message)
          erros.push(r.error.message)
        }
        if (r.name) nomesResolvidos.push(r.name)
        linhasAI.push(...r.data)
      }
      setResolvedTabelas(nomesResolvidos)
      if (tabelas.length > 0 && nomesResolvidos.length === 0) {
        setError(`Nenhuma das tabelas foi encontrada: ${erros.join(' · ')}`)
      }

      const clientesList = c.data ?? []
      setClientes(clientesList)

      // Conjunto de telefones que pertencem a ESTA instância:
      //   - telefones dos clientes do user (RLS já filtrou)
      //   - números que apareceram em mensagens_atendente da instância
      // Tabelas LangChain não têm coluna 'instancia', então usamos esse conjunto
      // pra filtrar — evita misturar conversas de outros tenants que dividem
      // a mesma tabela genérica de cobrança.
      const allowedPhones = new Set<string>()
      for (const cli of clientesList) {
        for (const k of phoneKeys(cli.telefone)) allowedPhones.add(k)
      }
      for (const row of (atd.data as Array<Record<string, unknown>> | null) ?? []) {
        const num = String((row as { numero?: string }).numero ?? '').split('@')[0]
        for (const k of phoneKeys(num)) allowedPhones.add(k)
      }

      const aiRows = linhasAI
      const aiNormalized = aiRows
        .map((r, i) => ({ ...normalizeRow(r, i), source: 'ai' as const }))
        .filter((m) => {
          // Sem telefone reconhecível = descarta
          if (!m.telefone) return false
          // Mantém se o telefone está no conjunto da instância
          return phoneKeys(m.telefone).some((k) => allowedPhones.has(k))
        })

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
          // midia_type fica null aqui — o renderer detecta pelo base64 direto
          midia_type: null,
          nome_arquivo: (r.nome_arquivo as string | null) ?? null,
          mime_type: (r.mime_type as string | null) ?? null,
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
  }, [tabelas.join('|')])

  // Realtime na tabela apontada pelo profile + mensagens_atendente.
  // Obs.: Realtime do Supabase só funciona em TABELAS base — views ficam mudas.
  // Por isso também rodamos um polling leve como fallback.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const channelKey = resolvedTabelas.length ? resolvedTabelas.join('-') : 'none'
    const channel = supabase.channel(`conv-${channelKey}`)
    for (const t of resolvedTabelas) {
      channel.on(
        // @ts-ignore — postgres_changes não tem types completos
        'postgres_changes',
        { event: '*', schema: 'public', table: t },
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
  }, [resolvedTabelas.join('|')])

  // Polling de fallback (essencial quando a tabela não está na publication
  // do Supabase Realtime, ou quando é uma view).
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const handle = window.setInterval(() => {
      load()
    }, 3000)
    return () => window.clearInterval(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabelas.join('|')])

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
          resolvedTabelas.length
            ? `Lendo de ${resolvedTabelas.map((t) => `"${t}"`).join(' + ')} + mensagens_atendente${
                instancia ? ` · instância ${instancia}` : ''
              }`
            : `Lendo de mensagens_atendente${instancia ? ` · instância ${instancia}` : ''}`
        }
      />

      {tabelas.length === 0 ? (
        <EmptyState
          title="Tabela de conversas não configurada"
          hint="Peça ao admin pra preencher o campo 'Tabela de conversas' no seu perfil (/usuarios). Pode colocar mais de uma separada por vírgula."
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
                              {m.base64 && (() => {
                                // Prefere o mime do banco (n8n pode ter salvo o original);
                                // senão detecta pelos magic bytes do base64.
                                const mime = m.mime_type || detectMime(m.base64)
                                const kind = mimeToKind(mime)
                                const src = dataUriFromBase64(m.base64, mime)
                                // Nome de download: usa nome_arquivo do banco se houver,
                                // senão monta com extensão derivada do mime.
                                const extMap: Record<string, string> = {
                                  'application/pdf': 'pdf',
                                  'application/zip': 'zip',
                                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
                                  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
                                  'application/msword': 'doc',
                                  'application/vnd.ms-excel': 'xls',
                                  'audio/ogg': 'ogg',
                                  'audio/mpeg': 'mp3',
                                  'audio/webm': 'webm',
                                  'video/mp4': 'mp4',
                                  'image/jpeg': 'jpg',
                                  'image/png': 'png',
                                  'image/gif': 'gif',
                                  'image/webp': 'webp',
                                }
                                const ext = extMap[mime] ?? mime.split('/')[1] ?? 'bin'
                                const downloadName = m.nome_arquivo || `arquivo.${ext}`
                                if (kind === 'image' || kind === 'sticker') {
                                  return (
                                    <img
                                      src={src}
                                      alt={kind === 'sticker' ? 'figurinha' : 'imagem'}
                                      className={`mb-1 ${
                                        kind === 'sticker'
                                          ? 'max-w-[140px] max-h-[140px]'
                                          : 'rounded-md max-w-full max-h-[320px]'
                                      }`}
                                    />
                                  )
                                }
                                if (kind === 'audio') {
                                  // WhatsApp voice = ogg/opus → tenta opus, depois mp3, depois webm
                                  return (
                                    <div className="mb-1 space-y-1">
                                      <div className="flex items-center gap-2">
                                        <audio
                                          controls
                                          preload="metadata"
                                          className="max-w-full"
                                          style={{ height: 36 }}
                                        >
                                          <source src={src} type="audio/ogg; codecs=opus" />
                                          <source src={src} type="audio/webm; codecs=opus" />
                                          <source src={src} type="audio/mpeg" />
                                          <source src={src} type="audio/wav" />
                                        </audio>
                                        <a
                                          href={src}
                                          download={downloadName}
                                          title="Baixar áudio"
                                          className={`size-7 grid place-items-center rounded text-[11px] shrink-0 ${
                                            isOut
                                              ? 'bg-white/10 text-white hover:bg-white/20'
                                              : 'bg-bg text-fg-3 hover:text-fg hover:bg-hover border border-border'
                                          } transition`}
                                        >
                                          ⬇
                                        </a>
                                      </div>
                                      <div
                                        className={`text-[10px] ${
                                          isOut ? 'text-white/60' : 'text-fg-4'
                                        }`}
                                      >
                                        Não tocou? Tente baixar com ⬇ — talvez o áudio precise
                                        ser decriptado no n8n primeiro.
                                      </div>
                                    </div>
                                  )
                                }
                                if (kind === 'video') {
                                  return (
                                    <video
                                      controls
                                      src={src}
                                      className="mb-1 rounded-md max-w-full max-h-[320px]"
                                    />
                                  )
                                }
                                // PDF ou outro arquivo: link de download
                                return (
                                  <a
                                    href={src}
                                    download={downloadName}
                                    className={`mb-1 inline-flex items-center gap-2 px-2 py-1.5 rounded border text-xs ${
                                      isOut
                                        ? 'border-white/30 bg-white/10 text-white hover:bg-white/20'
                                        : 'border-border bg-bg text-fg-2 hover:bg-hover'
                                    } transition`}
                                  >
                                    📎 {m.nome_arquivo ?? (kind === 'pdf' ? 'Documento PDF' : `Arquivo .${ext}`)}
                                  </a>
                                )
                              })()}
                              {m.conteudo && m.conteudo.trim() && (
                                <div className="whitespace-pre-wrap break-words">
                                  {m.conteudo}
                                </div>
                              )}
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
