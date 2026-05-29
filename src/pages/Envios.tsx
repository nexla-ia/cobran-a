import { useEffect, useMemo, useState } from 'react'
import { Send, Check, CheckCheck, AlertCircle, Search, X } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Cliente, Cobranca, Envio, EnvioStatus } from '@/types/db'
import { Badge, EmptyState, PageHeader } from '@/components/ui'
import { useRealtime } from '@/lib/realtime'
import { formatPhoneDisplay, isoToBR } from '@/lib/lookup'

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
  return `${isoToBR(d.toISOString().slice(0, 10))} ${d
    .toTimeString()
    .slice(0, 5)}`
}

export default function Envios() {
  const [rows, setRows] = useState<Envio[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'todos' | EnvioStatus>('todos')
  const [query, setQuery] = useState('')

  async function load() {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setRows([])
      setLoading(false)
      return
    }
    try {
      const [e, c, cl] = await Promise.all([
        supabase
          .from('envios')
          .select('*')
          .order('enviado_em', { ascending: false })
          .limit(500),
        supabase.from('clientes').select('*'),
        supabase.from('cobrancas').select('*'),
      ])
      if (e.error) console.warn('[envios] select:', e.error.message)
      setRows(e.data ?? [])
      setClientes(c.data ?? [])
      setCobrancas(cl.data ?? [])
    } catch (e) {
      console.error('[envios] load falhou:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useRealtime(['envios'], load)

  const clienteMap = useMemo(() => {
    const m = new Map<string, Cliente>()
    clientes.forEach((x) => m.set(x.id, x))
    return m
  }, [clientes])

  const cobrancaMap = useMemo(() => {
    const m = new Map<string, Cobranca>()
    cobrancas.forEach((x) => m.set(x.id, x))
    return m
  }, [cobrancas])

  const q = query.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (statusFilter !== 'todos' && r.status !== statusFilter) return false
    if (!q) return true
    const cli = r.cliente_id ? clienteMap.get(r.cliente_id) : null
    const cob = r.cobranca_id ? cobrancaMap.get(r.cobranca_id) : null
    return (
      (cli?.nome?.toLowerCase().includes(q) ?? false) ||
      (cli?.documento?.toLowerCase().includes(q) ?? false) ||
      (r.telefone?.toLowerCase().includes(q) ?? false) ||
      (r.instancia?.toLowerCase().includes(q) ?? false) ||
      (cob?.nome?.toLowerCase().includes(q) ?? false) ||
      (cob?.descricao.toLowerCase().includes(q) ?? false) ||
      (r.message_id?.toLowerCase().includes(q) ?? false)
    )
  })

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status]++
      return acc
    },
    { enviado: 0, entregue: 0, lido: 0, falha: 0 } as Record<EnvioStatus, number>,
  )

  return (
    <div>
      <PageHeader
        title="Envios"
        subtitle="Histórico de mensagens disparadas pelo n8n via Evolution."
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

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="size-3.5 text-fg-4 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente, telefone, instância, message id…"
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
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Cobrança</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Telefone</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Instância</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Enviado</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Lido</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {filtered.map((r) => {
                const cli = r.cliente_id ? clienteMap.get(r.cliente_id) : null
                const cob = r.cobranca_id ? cobrancaMap.get(r.cobranca_id) : null
                return (
                  <tr
                    key={r.id}
                    className="row-hover border-b border-border-2 last:border-b-0 hover:bg-hover"
                    title={r.erro ?? r.conteudo ?? ''}
                  >
                    <td className="px-4 py-3">
                      <div className="text-fg">{cli?.nome ?? <span className="text-fg-4">—</span>}</div>
                      <div className="text-xs text-fg-4 font-mono tabular">{cli?.documento ?? ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-fg">
                        {cob?.nome ?? cob?.descricao?.slice(0, 40) ?? <span className="text-fg-4">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-fg-3 tabular text-xs">
                      {r.telefone ? formatPhoneDisplay(r.telefone) : <span className="text-fg-4">—</span>}
                    </td>
                    <td className="px-4 py-3 text-fg-3 text-xs">
                      {r.instancia ?? <span className="text-fg-4">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone[r.status]}>
                        <StatusIcon status={r.status} />
                        {statusLabel[r.status]}
                      </Badge>
                      {r.status === 'falha' && r.erro && (
                        <div className="text-[10px] text-danger mt-1 max-w-[200px] truncate" title={r.erro}>
                          {r.erro}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-3 tabular text-xs">{formatDateTime(r.enviado_em)}</td>
                    <td className="px-4 py-3 text-fg-3 tabular text-xs">{formatDateTime(r.lido_em)}</td>
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

      <div className="mt-8 p-4 rounded-lg border border-border bg-surface text-xs text-fg-3 space-y-1">
        <div className="flex items-center gap-1.5 text-fg-2 font-medium">
          <Send className="size-3.5" />
          Como o histórico é alimentado
        </div>
        <p>
          O n8n insere uma linha em <code className="font-mono">envios</code> com{' '}
          <code className="font-mono">status='enviado'</code> ao chamar a Evolution. O webhook{' '}
          <code className="font-mono">messages.update</code> da Evolution dispara um fluxo que faz
          UPDATE casando por <code className="font-mono">(instancia, message_id)</code>: ack →{' '}
          <code className="font-mono">entregue</code>, read → <code className="font-mono">lido</code>,
          erro → <code className="font-mono">falha</code> com mensagem em{' '}
          <code className="font-mono">erro</code>.
        </p>
      </div>
    </div>
  )
}
