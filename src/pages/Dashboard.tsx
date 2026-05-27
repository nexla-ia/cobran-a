import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Users, Receipt, AlertTriangle, CircleDollarSign } from 'lucide-react'
import { supabase, isSupabaseConfigured, syncOverdueCobrancas } from '@/lib/supabase'
import type { Cliente, Cobranca, CobrancaStatus } from '@/types/db'
import { Badge, PageHeader } from '@/components/ui'
import { daysUntil, isoToBR } from '@/lib/lookup'
import { useRealtime } from '@/lib/realtime'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

type Stats = {
  clientes: number
  totalCobrancas: number
  aberto: number
  atrasado: number
  recebido: number
  qtdAberto: number
  qtdAtrasado: number
  proxVencimentos: Array<Cobranca & { clienteNome: string; status: CobrancaStatus }>
}

const empty: Stats = {
  clientes: 0,
  totalCobrancas: 0,
  aberto: 0,
  atrasado: 0,
  recebido: 0,
  qtdAberto: 0,
  qtdAtrasado: 0,
  proxVencimentos: [],
}

const statusTone: Record<CobrancaStatus, 'warn' | 'good' | 'danger' | 'mute'> = {
  pendente: 'warn',
  pago: 'good',
  atrasado: 'danger',
  cancelado: 'mute',
}

const statusLabel: Record<CobrancaStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>(empty)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    try {
      try {
        await syncOverdueCobrancas()
      } catch (e) {
        console.warn('[dashboard] syncOverdueCobrancas falhou:', e)
      }

      const [cli, cob, cliList] = await Promise.all([
        supabase.from('clientes').select('*', { count: 'exact', head: true }),
        supabase.from('cobrancas').select('*'),
        supabase.from('clientes').select('id, nome'),
      ])
      if (cli.error) console.warn('[dashboard] clientes count:', cli.error.message)
      if (cob.error) console.warn('[dashboard] cobrancas:', cob.error.message)
      if (cliList.error) console.warn('[dashboard] clientes list:', cliList.error.message)

      const today = new Date().toISOString().slice(0, 10)
      const rows = (cob.data ?? []) as Cobranca[]
      const nomeById = new Map<string, string>()
      ;(cliList.data ?? []).forEach((c: Pick<Cliente, 'id' | 'nome'>) =>
        nomeById.set(c.id, c.nome),
      )

      let aberto = 0
      let atrasado = 0
      let recebido = 0
      let qtdAberto = 0
      let qtdAtrasado = 0

      const enriched = rows.map((r) => {
        const overdue = r.status === 'pendente' && r.vencimento < today
        const effectiveStatus: CobrancaStatus = overdue ? 'atrasado' : r.status
        return { ...r, status: effectiveStatus }
      })

      for (const r of enriched) {
        const v = Number(r.valor)
        if (r.status === 'pago') recebido += v
        else if (r.status === 'pendente' || r.status === 'atrasado') {
          aberto += v
          qtdAberto += 1
          if (r.status === 'atrasado') {
            atrasado += v
            qtdAtrasado += 1
          }
        }
      }

      const proxVencimentos = enriched
        .filter((r) => r.status === 'pendente' || r.status === 'atrasado')
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
        .slice(0, 5)
        .map((r) => ({ ...r, clienteNome: nomeById.get(r.cliente_id) ?? '—' }))

      setStats({
        clientes: cli.count ?? 0,
        totalCobrancas: rows.length,
        aberto,
        atrasado,
        recebido,
        qtdAberto,
        qtdAtrasado,
        proxVencimentos,
      })
    } catch (e) {
      console.error('[dashboard] load falhou:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useRealtime(['cobrancas', 'clientes'], load)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Visão geral do que você tem a receber." />

      {/* Hero metric — A receber */}
      <section className="stagger grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <div className="lg:col-span-2 relative overflow-hidden border border-border rounded-xl bg-surface p-6 transition-all duration-200 hover:border-fg-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-fg-3 uppercase tracking-wide">A receber</div>
              <div className="mt-3 text-5xl font-semibold tracking-tight tabular text-fg">
                {brl.format(stats.aberto)}
              </div>
              <div className="mt-2 text-sm text-fg-3">
                {stats.qtdAberto} cobrança(s) em aberto
                {stats.qtdAtrasado > 0 && (
                  <>
                    {' · '}
                    <span className="text-danger font-medium">
                      {stats.qtdAtrasado} atrasada(s)
                    </span>
                  </>
                )}
              </div>
            </div>
            <Link
              to="/cobrancas"
              className="text-fg-3 hover:text-fg transition flex items-center gap-1 text-xs font-medium"
            >
              Ver tudo <ArrowUpRight className="size-3.5" />
            </Link>
          </div>

          {/* mini progress bar: open vs received */}
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs text-fg-3 mb-1.5">
              <span>Recebido vs. esperado</span>
              <span className="tabular">
                {stats.aberto + stats.recebido > 0
                  ? Math.round((stats.recebido / (stats.aberto + stats.recebido)) * 100)
                  : 0}
                %
              </span>
            </div>
            <div className="h-1.5 bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-fg transition-all duration-700"
                style={{
                  width:
                    stats.aberto + stats.recebido > 0
                      ? `${(stats.recebido / (stats.aberto + stats.recebido)) * 100}%`
                      : '0%',
                }}
              />
            </div>
          </div>
        </div>

        <div className="border border-border rounded-xl bg-surface p-6 transition-all duration-200 hover:border-fg-4">
          <div className="text-xs text-fg-3 uppercase tracking-wide">Recebido</div>
          <div className="mt-3 text-3xl font-semibold tabular text-fg">
            {brl.format(stats.recebido)}
          </div>
          <div className="mt-6 text-xs text-fg-3 flex items-center gap-2">
            <CircleDollarSign className="size-3.5 text-success" />
            Cobranças quitadas
          </div>
        </div>
      </section>

      {/* Sub-metrics */}
      <section className="stagger grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        <div className="border border-border rounded-xl bg-surface p-4 transition-all duration-200 hover:border-fg-4 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-fg-3">Clientes</div>
            <Users className="size-4 text-fg-4" />
          </div>
          <div className="mt-2 text-2xl font-semibold tabular text-fg">
            {stats.clientes}
          </div>
        </div>
        <div className="border border-border rounded-xl bg-surface p-4 transition-all duration-200 hover:border-fg-4 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-fg-3">Cobranças</div>
            <Receipt className="size-4 text-fg-4" />
          </div>
          <div className="mt-2 text-2xl font-semibold tabular text-fg">
            {stats.totalCobrancas}
          </div>
        </div>
        <div className="col-span-2 lg:col-span-1 border border-border rounded-xl bg-surface p-4 transition-all duration-200 hover:border-fg-4 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-fg-3">Atrasado</div>
            <AlertTriangle className={`size-4 ${stats.atrasado > 0 ? 'text-danger' : 'text-fg-4'}`} />
          </div>
          <div
            className={`mt-2 text-2xl font-semibold tabular ${
              stats.atrasado > 0 ? 'text-danger' : 'text-fg'
            }`}
          >
            {brl.format(stats.atrasado)}
          </div>
        </div>
      </section>

      {/* Próximos vencimentos */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-fg">Próximos vencimentos</h2>
          <Link
            to="/cobrancas"
            className="text-xs text-fg-3 hover:text-fg transition flex items-center gap-1"
          >
            Ver todas <ArrowUpRight className="size-3.5" />
          </Link>
        </div>

        {stats.proxVencimentos.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-8 text-center text-sm text-fg-3">
            {loading ? 'Carregando…' : 'Sem cobranças em aberto. ✨'}
          </div>
        ) : (
          <ul className="stagger border border-border rounded-xl bg-surface overflow-hidden">
            {stats.proxVencimentos.map((r) => {
              const dias = daysUntil(r.vencimento)
              return (
                <li
                  key={r.id}
                  className="row-hover flex items-center gap-4 px-4 py-3 border-b border-border-2 last:border-b-0 hover:bg-hover"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-fg truncate">{r.clienteNome}</div>
                    <div className="text-xs text-fg-4 truncate">{r.descricao}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium tabular text-fg">
                      {brl.format(Number(r.valor))}
                    </div>
                    <div className="text-xs text-fg-4 tabular">{isoToBR(r.vencimento)}</div>
                  </div>
                  <div className="shrink-0 w-28 text-right">
                    {r.status === 'atrasado' ? (
                      <Badge tone="danger">
                        {Math.abs(dias)} dia{Math.abs(dias) === 1 ? '' : 's'} atrasado
                      </Badge>
                    ) : dias === 0 ? (
                      <Badge tone="warn">Vence hoje</Badge>
                    ) : (
                      <Badge tone={statusTone[r.status]}>
                        em {dias} dia{dias === 1 ? '' : 's'}
                      </Badge>
                    )}
                    <div className="text-[10px] text-fg-4 mt-0.5">{statusLabel[r.status]}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
