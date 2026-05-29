import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCheck, AlertCircle, Search, X, RefreshCw, Loader2 } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Cliente, EnvioStatus, Mensagem, MensagemStatus } from '@/types/db'
import { Badge, Button, EmptyState, PageHeader } from '@/components/ui'
import { useRealtime } from '@/lib/realtime'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/dialogs'
import { formatPhoneDisplay, isoToBR } from '@/lib/lookup'

const VERIFY_WEBHOOK_URL =
  'https://n8n.nexladesenvolvimento.com.br/webhook/atualizatelamensagens'

const statusLabel: Record<EnvioStatus, string> = {
  enviado: 'Enviado',
  entregue: 'Entregue',
  lido: 'Lido',
  falha: 'Falha',
}

const statusTone: Record<EnvioStatus, 'neutral' | 'warn' | 'good' | 'danger'> = {
  enviado: 'neutral',
  entregue: 'warn',
  lido: 'good',
  falha: 'danger',
}

const StatusIcon = ({ status }: { status: EnvioStatus }) => {
  switch (status) {
    case 'enviado':
      return <Check className="size-3 mr-1" />
    case 'entregue':
      return <CheckCheck className="size-3 mr-1" />
    case 'lido':
      return <CheckCheck className="size-3 mr-1" />
    case 'falha':
      return <AlertCircle className="size-3 mr-1" />
  }
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${isoToBR(d.toISOString().slice(0, 10))} ${d.toTimeString().slice(0, 5)}`
}

type Row = Mensagem & {
  status: EnvioStatus
  erro: string | null
  entregue_em: string | null
  lido_em: string | null
  falhou_em: string | null
  atualizado_em: string | null
}

export default function Envios() {
  const { session, profile } = useAuth()
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [statusList, setStatusList] = useState<MensagemStatus[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'todos' | EnvioStatus>('todos')
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')

  function setPreset(days: number | 'today' | 'all') {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const iso = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    if (days === 'all') {
      setDateFrom('')
      setDateTo('')
    } else if (days === 'today') {
      setDateFrom(iso(now))
      setDateTo(iso(now))
    } else {
      const from = new Date(now)
      from.setDate(from.getDate() - days + 1)
      setDateFrom(iso(from))
      setDateTo(iso(now))
    }
    setTimeFrom('')
    setTimeTo('')
  }

  function clearFilters() {
    setStatusFilter('todos')
    setQuery('')
    setDateFrom('')
    setDateTo('')
    setTimeFrom('')
    setTimeTo('')
  }

  async function load() {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setMensagens([])
      setStatusList([])
      setLoading(false)
      return
    }
    try {
      const [m, s, c] = await Promise.all([
        supabase
          .from('mensagens')
          .select('*')
          .order('enviado_em', { ascending: false })
          .limit(500),
        supabase.from('mensagem_status').select('*'),
        supabase.from('clientes').select('*'),
      ])
      if (m.error) console.warn('[envios] mensagens:', m.error.message)
      if (s.error) console.warn('[envios] status:', s.error.message)
      setMensagens(m.data ?? [])
      setStatusList(s.data ?? [])
      setClientes(c.data ?? [])
    } catch (e) {
      console.error('[envios] load falhou:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useRealtime(['mensagens', 'mensagem_status'], load)

  const statusByMensagem = useMemo(() => {
    const m = new Map<string, MensagemStatus>()
    statusList.forEach((s) => m.set(s.mensagem_id, s))
    return m
  }, [statusList])

  const clienteMap = useMemo(() => {
    const m = new Map<string, Cliente>()
    clientes.forEach((x) => m.set(x.id, x))
    return m
  }, [clientes])

  // Index de clientes pelo telefone (com/sem 9 BR) pra resolver linhas sem cliente_id
  const clienteByPhone = useMemo(() => {
    const m = new Map<string, Cliente>()
    for (const c of clientes) {
      if (!c.telefone) continue
      const digits = c.telefone.replace(/\D/g, '')
      if (!digits) continue
      m.set(digits, c)
      if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
        m.set(digits.slice(0, 4) + digits.slice(5), c)
      } else if (digits.length === 12 && digits.startsWith('55')) {
        m.set('55' + digits.slice(2, 4) + '9' + digits.slice(4), c)
      }
    }
    return m
  }, [clientes])

  function resolveCliente(m: Mensagem): Cliente | null {
    if (m.cliente_id) {
      const c = clienteMap.get(m.cliente_id)
      if (c) return c
    }
    if (m.telefone) {
      return clienteByPhone.get(m.telefone.replace(/\D/g, '')) ?? null
    }
    return null
  }

  const rows: Row[] = mensagens.map((m) => {
    const s = statusByMensagem.get(m.id)
    return {
      ...m,
      status: s?.status ?? 'enviado',
      erro: s?.erro ?? null,
      entregue_em: s?.entregue_em ?? null,
      lido_em: s?.lido_em ?? null,
      falhou_em: s?.falhou_em ?? null,
      atualizado_em: s?.atualizado_em ?? null,
    }
  })

  const q = query.trim().toLowerCase()

  // Constrói limites em ms a partir de date + time
  function boundary(dateStr: string, timeStr: string, end: boolean): number | null {
    if (!dateStr) return null
    const fallback = end ? '23:59' : '00:00'
    const t = timeStr || fallback
    const iso = `${dateStr}T${t}:${end && !timeStr ? '59.999' : '00.000'}`
    const ms = new Date(iso).getTime()
    return isNaN(ms) ? null : ms
  }
  const fromMs = boundary(dateFrom, timeFrom, false)
  const toMs = boundary(dateTo, timeTo, true)

  const filtered = rows.filter((r) => {
    if (statusFilter !== 'todos' && r.status !== statusFilter) return false
    const t = new Date(r.enviado_em).getTime()
    if (fromMs !== null && t < fromMs) return false
    if (toMs !== null && t > toMs) return false
    if (!q) return true
    const cli = resolveCliente(r)
    return (
      (cli?.nome?.toLowerCase().includes(q) ?? false) ||
      (cli?.documento?.toLowerCase().includes(q) ?? false) ||
      (r.telefone?.toLowerCase().includes(q) ?? false) ||
      (r.instancia?.toLowerCase().includes(q) ?? false) ||
      (r.conteudo?.toLowerCase().includes(q) ?? false) ||
      (r.message_id?.toLowerCase().includes(q) ?? false)
    )
  })

  const hasFilters =
    statusFilter !== 'todos' || query !== '' || dateFrom || dateTo || timeFrom || timeTo

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status]++
      return acc
    },
    { enviado: 0, entregue: 0, lido: 0, falha: 0 } as Record<EnvioStatus, number>,
  )

  async function verifyNow() {
    if (!session?.user?.id) return
    setVerifying(true)
    try {
      const body = JSON.stringify({
        user_id: session.user.id,
        instancia: profile?.evolution_instancia ?? null,
        api_key: profile?.evolution_api_key ?? null,
        hours: 24,
      })
      const r = await fetch(VERIFY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!r.ok) throw new Error(`Webhook respondeu ${r.status}`)
      toast.success('Verificação enviada. Atualiza em alguns segundos.')
    } catch (e) {
      if (e instanceof TypeError) {
        try {
          await fetch(VERIFY_WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: session.user.id,
              instancia: profile?.evolution_instancia ?? null,
              api_key: profile?.evolution_api_key ?? null,
              hours: 24,
            }),
          })
          toast.success('Verificação disparada. Confirme no painel do n8n.', {
            duration: 5000,
          })
        } catch (e2) {
          toast.error(`Falha: ${(e2 as Error).message}`)
        }
      } else {
        toast.error(`Falha: ${(e as Error).message}`)
      }
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Envios"
        subtitle="Histórico de mensagens disparadas pelo n8n via Evolution."
        actions={
          <Button variant="secondary" onClick={verifyNow} disabled={verifying || !session}>
            {verifying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Verificar status
          </Button>
        }
      />

      <div className="stagger grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {(['enviado', 'entregue', 'lido', 'falha'] as const).map((s) => (
          <div
            key={s}
            className="border border-border rounded-lg bg-surface p-4 transition-all duration-200 hover:border-fg-4 hover:-translate-y-0.5"
          >
            <div className="text-xs text-fg-3 flex items-center gap-1">
              <StatusIcon status={s} />
              {statusLabel[s]}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular text-fg">{counts[s]}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 space-y-3">
        {/* Linha 1: pills de status + busca */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex p-0.5 border border-border rounded-md bg-surface">
            {(['todos', 'enviado', 'entregue', 'lido', 'falha'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={`tab-pill px-3 h-7 text-xs font-medium rounded ${
                  statusFilter === k ? 'bg-fg text-surface' : 'text-fg-3 hover:text-fg'
                }`}
              >
                {k === 'todos' ? 'Todos' : statusLabel[k]}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="size-3.5 text-fg-4 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente, telefone, mensagem…"
              className="h-8 w-72 max-w-full pl-8 pr-7 text-xs bg-surface border border-border rounded-md text-fg placeholder:text-fg-4 outline-none focus:border-fg-3 transition"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center text-fg-4 hover:text-fg rounded"
                aria-label="Limpar busca"
                type="button"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        {/* Linha 2: data/hora + presets + contador */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-fg-3">
              <span>De</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 px-2 text-xs bg-surface border border-border rounded-md text-fg outline-none focus:border-fg-3 transition tabular"
              />
              <input
                type="time"
                value={timeFrom}
                onChange={(e) => setTimeFrom(e.target.value)}
                className="h-8 px-2 text-xs bg-surface border border-border rounded-md text-fg outline-none focus:border-fg-3 transition tabular"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-fg-3">
              <span>Até</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 px-2 text-xs bg-surface border border-border rounded-md text-fg outline-none focus:border-fg-3 transition tabular"
              />
              <input
                type="time"
                value={timeTo}
                onChange={(e) => setTimeTo(e.target.value)}
                className="h-8 px-2 text-xs bg-surface border border-border rounded-md text-fg outline-none focus:border-fg-3 transition tabular"
              />
            </div>
            <div className="inline-flex p-0.5 border border-border rounded-md bg-surface">
              {(
                [
                  { k: 'today', label: 'Hoje' },
                  { k: 7, label: '7d' },
                  { k: 30, label: '30d' },
                  { k: 'all', label: 'Tudo' },
                ] as const
              ).map((p) => (
                <button
                  key={String(p.k)}
                  type="button"
                  onClick={() => setPreset(p.k as 'today' | 'all' | 7 | 30)}
                  className="tab-pill px-2.5 h-6 text-[11px] font-medium rounded text-fg-3 hover:text-fg"
                >
                  {p.label}
                </button>
              ))}
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 h-7 px-2 text-[11px] text-fg-3 hover:text-fg border border-border rounded-md bg-surface"
              >
                <X className="size-3" /> Limpar
              </button>
            )}
          </div>
          <div className="text-xs text-fg-4 tabular">{filtered.length} resultado(s)</div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            loading
              ? 'Carregando…'
              : rows.length === 0
                ? 'Nenhum envio registrado'
                : 'Nenhum resultado para este filtro'
          }
          hint={
            loading
              ? 'Buscando registros…'
              : rows.length === 0
                ? 'Quando o n8n disparar pela Evolution, os envios aparecem aqui.'
                : 'Tente outro filtro ou limpe a busca.'
          }
        />
      ) : (
        <div className="border border-border rounded-lg bg-surface overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-border bg-bg">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Cliente</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Telefone</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Mensagem</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Enviado</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Lido</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {filtered.map((r) => {
                const cli = resolveCliente(r)
                return (
                  <tr
                    key={r.id}
                    className="row-hover border-b border-border-2 last:border-b-0 hover:bg-hover"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="text-fg">
                        {cli?.nome ?? <span className="text-fg-4">—</span>}
                      </div>
                      <div className="text-xs text-fg-4 font-mono tabular">
                        {cli?.documento ?? ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-fg-3 tabular text-xs">
                      {r.telefone ? (
                        formatPhoneDisplay(r.telefone)
                      ) : (
                        <span className="text-fg-4">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-fg-2 text-xs max-w-[420px]">
                      <div
                        className="whitespace-pre-wrap break-words line-clamp-3"
                        title={r.conteudo ?? ''}
                      >
                        {r.conteudo ?? <span className="text-fg-4">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge tone={statusTone[r.status]}>
                        <StatusIcon status={r.status} />
                        {statusLabel[r.status]}
                      </Badge>
                      {r.status === 'falha' && r.erro && (
                        <div
                          className="text-[10px] text-danger mt-1 max-w-[200px] truncate"
                          title={r.erro}
                        >
                          {r.erro}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-fg-3 tabular text-xs">
                      {formatDateTime(r.enviado_em)}
                    </td>
                    <td className="px-4 py-3 align-top text-fg-3 tabular text-xs">
                      {formatDateTime(r.lido_em)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length >= 500 && (
        <p className="text-xs text-fg-4 text-center mt-4">
          Mostrando os 500 envios mais recentes.
        </p>
      )}

    </div>
  )
}
