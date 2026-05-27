import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, FileDown, CheckCircle2, RotateCcw, Send, Loader2, X, Clock, AlertCircle, Ban } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, isSupabaseConfigured, syncOverdueCobrancas } from '@/lib/supabase'
import type { Cliente, Cobranca, CobrancaStatus } from '@/types/db'
import { Badge, Button, Checkbox, Combo, ContextMenu, EmptyState, Field, Input, Modal, PageHeader, Textarea } from '@/components/ui'
import type { ContextMenuItem } from '@/components/ui'
import {
  formatBRLFromNumber,
  parseBRLInput,
  nextDateForDay,
  dayFromISO,
  isoToBR,
  daysUntil,
  phoneBRWithout9,
} from '@/lib/lookup'
import { confirmDialog, toast } from '@/lib/dialogs'
import { useRealtime } from '@/lib/realtime'
import { useAuth } from '@/lib/auth'

const WEBHOOK_URL = 'https://n8n.nexladesenvolvimento.com.br/webhook/cobrancanexla'

type Form = {
  cliente_id: string
  descricao: string
  valor: string
  vencimento: string
  status: CobrancaStatus
}

const empty: Form = {
  cliente_id: '',
  descricao: '',
  valor: '',
  vencimento: '',
  status: 'pendente',
}

const statusLabel: Record<CobrancaStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
}

const statusTone: Record<CobrancaStatus, 'warn' | 'good' | 'danger' | 'mute'> = {
  pendente: 'warn',
  pago: 'good',
  atrasado: 'danger',
  cancelado: 'mute',
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function isOverdue(c: Cobranca) {
  if (c.status !== 'pendente') return false
  const today = new Date().toISOString().slice(0, 10)
  return c.vencimento < today
}

function cobrancaToForm(c: Cobranca): Form {
  return {
    cliente_id: c.cliente_id,
    descricao: c.descricao,
    valor: formatBRLFromNumber(Number(c.valor)),
    vencimento: c.vencimento,
    status: c.status,
  }
}

export default function Cobrancas() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Cobranca[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Cobranca | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'todos' | CobrancaStatus>('todos')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  async function load() {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setRows([])
      setClientes([])
      setLoading(false)
      return
    }
    try {
      try {
        await syncOverdueCobrancas()
      } catch (e) {
        console.warn('[cobrancas] syncOverdueCobrancas falhou:', e)
      }
      const [c, cl] = await Promise.all([
        supabase.from('cobrancas').select('*').order('vencimento', { ascending: true }),
        supabase.from('clientes').select('*').order('nome'),
      ])
      if (c.error) console.warn('[cobrancas] select cobrancas:', c.error.message)
      if (cl.error) console.warn('[cobrancas] select clientes:', cl.error.message)
      setRows(c.data ?? [])
      setClientes(cl.data ?? [])
    } catch (e) {
      console.error('[cobrancas] load falhou:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useRealtime(['cobrancas', 'clientes'], load)

  const clienteMap = useMemo(() => {
    const m = new Map<string, Cliente>()
    clientes.forEach((x) => m.set(x.id, x))
    return m
  }, [clientes])

  function openNew() {
    setEditing(null)
    setForm(empty)
    setOpen(true)
  }

  function openEdit(c: Cobranca) {
    setEditing(c)
    setForm(cobrancaToForm(c))
    setOpen(true)
  }

  function closeModal() {
    setOpen(false)
    setEditing(null)
    setForm(empty)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const cents = parseBRLInput(form.valor).cents
    const payload = {
      cliente_id: form.cliente_id,
      descricao: form.descricao,
      valor: cents / 100,
      vencimento: form.vencimento,
      status: form.status,
      pago_em:
        form.status === 'pago'
          ? editing?.pago_em ?? new Date().toISOString().slice(0, 10)
          : null,
    }
    const { error } = editing
      ? await supabase.from('cobrancas').update(payload).eq('id', editing.id)
      : await supabase.from('cobrancas').insert(payload)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(editing ? 'Cobrança atualizada.' : 'Cobrança lançada.')
    closeModal()
    load()
  }

  async function changeStatus(id: string, status: CobrancaStatus) {
    const today = new Date().toISOString().slice(0, 10)
    const payload: { status: CobrancaStatus; pago_em: string | null } = {
      status,
      pago_em: status === 'pago' ? today : null,
    }
    const { error } = await supabase.from('cobrancas').update(payload).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(`Status alterado para ${statusLabel[status]}.`)
    load()
  }

  async function marcarPago(id: string) {
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase
      .from('cobrancas')
      .update({ status: 'pago', pago_em: today })
      .eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Cobrança quitada.')
    load()
  }

  async function reabrir(id: string) {
    const { error } = await supabase
      .from('cobrancas')
      .update({ status: 'pendente', pago_em: null })
      .eq('id', id)
    if (error) return toast.error(error.message)
    toast.info('Cobrança reaberta.')
    load()
  }

  async function remove(id: string) {
    const ok = await confirmDialog({
      title: 'Excluir cobrança?',
      message: 'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('cobrancas').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Cobrança excluída.')
    load()
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function dispatchItems(ids: string[]) {
    if (ids.length === 0) return
    const ok = await confirmDialog({
      title: `Enviar ${ids.length} cobrança(s)?`,
      message: 'As informações do cliente e do título serão enviadas ao disparador (n8n).',
      confirmLabel: 'Enviar',
    })
    if (!ok) return
    setSending(true)

    // Agrupar por cliente
    const groups = new Map<
      string,
      { cliente: Cliente; cobrancas: Cobranca[] }
    >()
    for (const id of ids) {
      const c = rows.find((r) => r.id === id)
      if (!c) continue
      const cli = clienteMap.get(c.cliente_id)
      if (!cli) continue
      if (!groups.has(cli.id)) groups.set(cli.id, { cliente: cli, cobrancas: [] })
      groups.get(cli.id)!.cobrancas.push(c)
    }

    const itens = Array.from(groups.values()).map(({ cliente, cobrancas }) => ({
      cliente: {
        nome: cliente.nome,
        telefone: phoneBRWithout9(cliente.telefone),
        [cliente.tipo === 'pj' ? 'cnpj' : 'cpf']: cliente.documento,
        email: cliente.email,
      },
      cobrancas: cobrancas.map((c) => {
        const dias = daysUntil(c.vencimento)
        const overdue = c.status !== 'pago' && c.status !== 'cancelado' && dias < 0
        return {
          cliente: cliente.nome,
          descricao: c.descricao,
          valor: brl.format(Number(c.valor)),
          status: overdue ? 'atrasado' : c.status,
          vencimento: isoToBR(c.vencimento),
        }
      }),
    }))

    const totalCobrancas = itens.reduce((s, i) => s + i.cobrancas.length, 0)

    const payload = JSON.stringify({
      meta: {
        total_clientes: itens.length,
        total_cobrancas: totalCobrancas,
        enviado_em: new Date().toISOString(),
        origem: 'cobranca-saas',
        evolution_instancia: profile?.evolution_instancia ?? null,
        evolution_api_key: profile?.evolution_api_key ?? null,
      },
      itens,
    })

    try {
      // Primeiro tenta CORS normal — se o n8n estiver com "Allowed Origins" configurado,
      // conseguimos ler a resposta e confirmar status HTTP.
      const r = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
      if (!r.ok) throw new Error(`Webhook respondeu ${r.status}`)
      toast.success(`${totalCobrancas} cobrança(s) enviada(s) ao disparador.`)
      clearSelection()
    } catch (e) {
      // Fallback: CORS bloqueado pelo navegador. Reenvio em modo no-cors (sem leitura
      // da resposta). A requisição CHEGA no n8n, mas não temos confirmação aqui.
      if (e instanceof TypeError) {
        try {
          await fetch(WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          })
          toast.success(
            `${totalCobrancas} cobrança(s) enviada(s). Confirme a execução no painel do n8n.`,
            { duration: 6000 },
          )
          clearSelection()
        } catch (e2) {
          toast.error(`Falha ao enviar: ${(e2 as Error).message}`)
        }
      } else {
        toast.error(`Falha ao enviar: ${(e as Error).message}`)
      }
    } finally {
      setSending(false)
    }
  }

  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        cliente: clienteMap.get(r.cliente_id)?.nome ?? r.cliente_id,
        documento: clienteMap.get(r.cliente_id)?.documento ?? '',
        descricao: r.descricao,
        valor: r.valor,
        vencimento: r.vencimento,
        status: r.status,
        pago_em: r.pago_em ?? '',
      })),
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cobranças')
    XLSX.writeFile(wb, 'cobrancas.xlsx')
  }

  const enriched = rows.map((r) => ({
    ...r,
    status: (isOverdue(r) ? 'atrasado' : r.status) as CobrancaStatus,
  }))

  const filtered =
    statusFilter === 'todos' ? enriched : enriched.filter((r) => r.status === statusFilter)

  const totalAberto = enriched
    .filter((r) => r.status === 'pendente' || r.status === 'atrasado')
    .reduce((s, r) => s + Number(r.valor), 0)

  const totalRecebido = enriched
    .filter((r) => r.status === 'pago')
    .reduce((s, r) => s + Number(r.valor), 0)

  return (
    <div>
      <PageHeader
        title="Cobranças"
        subtitle="Faturas a receber dos seus clientes."
        actions={
          <>
            <Button variant="secondary" onClick={exportXlsx} disabled={filtered.length === 0}>
              <FileDown className="size-4" />
              Exportar
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                dispatchItems(
                  enriched
                    .filter((r) => r.status === 'pendente' || r.status === 'atrasado')
                    .map((r) => r.id),
                )
              }
              disabled={
                enriched.filter(
                  (r) => r.status === 'pendente' || r.status === 'atrasado',
                ).length === 0 || sending
              }
              title="Envia somente cobranças pendentes e atrasadas"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Enviar todos
            </Button>
            <Button onClick={openNew} disabled={clientes.length === 0}>
              <Plus className="size-4" />
              Nova cobrança
            </Button>
          </>
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 mb-6">
        <div className="border border-border rounded-lg bg-surface p-4 transition-all duration-200 hover:border-fg-4 hover:-translate-y-0.5">
          <div className="text-xs text-fg-3">Em aberto</div>
          <div className="mt-2 text-2xl font-semibold tabular text-fg">{brl.format(totalAberto)}</div>
        </div>
        <div className="border border-border rounded-lg bg-surface p-4 transition-all duration-200 hover:border-fg-4 hover:-translate-y-0.5">
          <div className="text-xs text-fg-3">Recebido</div>
          <div className="mt-2 text-2xl font-semibold tabular text-fg">{brl.format(totalRecebido)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="inline-flex p-0.5 border border-border rounded-md bg-surface">
          {(['todos', 'pendente', 'atrasado', 'pago', 'cancelado'] as const).map((k) => (
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
        <div className="text-xs text-fg-4 tabular">{filtered.length} resultado(s)</div>
      </div>

      {selected.size > 0 && (
        <div
          className="mb-4 flex items-center justify-between gap-3 flex-wrap border border-fg bg-fg text-surface rounded-lg px-4 py-2"
          style={{ animation: 'fade-in-down 200ms cubic-bezier(0.22,1,0.36,1) both' }}
        >
          <div className="text-sm font-medium tabular">
            {selected.size} cobrança(s) selecionada(s)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1 text-xs text-surface/70 hover:text-surface transition"
            >
              <X className="size-3" />
              Limpar
            </button>
            <Button
              variant="secondary"
              onClick={() => dispatchItems([...selected])}
              disabled={sending}
              className="bg-surface text-fg border-surface hover:bg-hover"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Enviar selecionados
            </Button>
          </div>
        </div>
      )}

      {clientes.length === 0 && isSupabaseConfigured && (
        <div className="mb-4 border border-border rounded-lg bg-surface p-3 text-sm text-fg-3">
          Cadastre ao menos um cliente antes de criar uma cobrança.
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={
            loading
              ? 'Carregando…'
              : enriched.length === 0
                ? 'Nenhuma cobrança'
                : 'Nenhum resultado para este filtro'
          }
          hint={
            loading
              ? 'Buscando registros…'
              : enriched.length === 0
                ? isSupabaseConfigured
                  ? 'Clique em "Nova cobrança" para registrar uma fatura.'
                  : 'Configure o Supabase para gravar dados.'
                : 'Tente alterar o filtro de status acima.'
          }
        />
      ) : (
        <div className="border border-border rounded-lg bg-surface overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-border bg-bg">
                <th className="pl-4 pr-2 py-2.5 w-10">
                  <Checkbox
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    indeterminate={selected.size > 0 && selected.size < filtered.length}
                    onChange={(v) =>
                      setSelected(v ? new Set(filtered.map((r) => r.id)) : new Set())
                    }
                    aria-label="Selecionar todas"
                  />
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Cliente</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Descrição</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-fg-3">Valor</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Vencimento</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Status</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="stagger">
              {filtered.map((r) => {
                const cli = clienteMap.get(r.cliente_id)
                const isSelected = selected.has(r.id)
                return (
                  <tr
                    key={r.id}
                    onClick={() => openEdit(r)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setCtxMenu({ id: r.id, x: e.clientX, y: e.clientY })
                    }}
                    className={`row-hover border-b border-border-2 last:border-b-0 cursor-pointer ${
                      isSelected ? 'bg-hover' : 'hover:bg-hover'
                    }`}
                  >
                    <td className="pl-4 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleOne(r.id)}
                        aria-label="Selecionar"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-fg">{cli?.nome ?? '—'}</div>
                      <div className="text-xs text-fg-4 font-mono tabular">{cli?.documento ?? ''}</div>
                    </td>
                    <td className="px-4 py-3 text-fg-2">{r.descricao}</td>
                    <td className="px-4 py-3 text-right font-medium tabular text-fg">
                      {brl.format(Number(r.valor))}
                    </td>
                    <td className="px-4 py-3 text-fg-3 tabular">{formatDate(r.vencimento)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone[r.status]}>{statusLabel[r.status]}</Badge>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2 justify-end">
                        {r.status === 'pago' ? (
                          <button
                            onClick={() => reabrir(r.id)}
                            className="text-fg-4 hover:text-warn transition"
                            title="Reabrir"
                          >
                            <RotateCcw className="size-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => marcarPago(r.id)}
                            className="text-fg-4 hover:text-success transition"
                            title="Marcar como pago"
                          >
                            <CheckCircle2 className="size-4" />
                          </button>
                        )}
                        <button
                          onClick={() => remove(r.id)}
                          className="text-fg-4 hover:text-danger transition"
                          title="Excluir"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Editar cobrança' : 'Nova cobrança'}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" form="form-cobranca" disabled={saving}>
              {saving ? 'Salvando…' : editing ? 'Atualizar' : 'Salvar'}
            </Button>
          </>
        }
      >
        <form id="form-cobranca" onSubmit={save} className="space-y-3">
          <Field label="Cliente">
            <Combo
              required
              value={form.cliente_id}
              onChange={(v) => setForm({ ...form, cliente_id: v })}
              placeholder="Selecione um cliente…"
              options={clientes.map((c) => ({
                value: c.id,
                label: (
                  <span className="flex flex-col leading-tight">
                    <span className="text-fg">{c.nome}</span>
                    <span className="text-xs text-fg-4 font-mono tabular">{c.documento}</span>
                  </span>
                ),
              }))}
            />
          </Field>

          <Field label="Descrição">
            <Textarea
              required
              rows={4}
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: Mensalidade Maio/2026 — referente ao plano premium…"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (R$)" hint="Digite só os números, os centavos entram automático.">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 text-sm pointer-events-none">
                  R$
                </span>
                <Input
                  required
                  inputMode="numeric"
                  value={form.valor}
                  onChange={(e) =>
                    setForm({ ...form, valor: parseBRLInput(e.target.value).formatted })
                  }
                  placeholder="0,00"
                  className="font-mono tabular pl-9 text-right"
                />
              </div>
            </Field>
            <Field
              label="Vencimento"
              hint={
                form.vencimento
                  ? `Vence em ${(() => {
                      const [y, m, d] = form.vencimento.split('-')
                      return `${d}/${m}/${y}`
                    })()}`
                  : 'Selecione o dia.'
              }
            >
              <Combo
                required
                value={form.vencimento ? String(dayFromISO(form.vencimento)) : ''}
                onChange={(v) => setForm({ ...form, vencimento: nextDateForDay(parseInt(v, 10)) })}
                placeholder="Dia…"
                className="font-mono"
                options={Array.from({ length: 31 }, (_, i) => i + 1).map((d) => ({
                  value: String(d),
                  label: <span className="tabular">Dia {String(d).padStart(2, '0')}</span>,
                }))}
              />
            </Field>
          </div>

          {editing && (
            <Field label="Status">
              <Combo
                value={form.status}
                onChange={(v) => setForm({ ...form, status: v as CobrancaStatus })}
                options={[
                  { value: 'pendente', label: 'Pendente' },
                  { value: 'pago', label: 'Pago' },
                  { value: 'atrasado', label: 'Atrasado' },
                  { value: 'cancelado', label: 'Cancelado' },
                ]}
              />
            </Field>
          )}
        </form>
      </Modal>

      <ContextMenu
        open={ctxMenu !== null}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        onClose={() => setCtxMenu(null)}
        title="Alterar status"
        items={
          ctxMenu
            ? (() => {
                const current = enriched.find((r) => r.id === ctxMenu.id)?.status
                const opts: ContextMenuItem[] = [
                  {
                    label: 'Pendente',
                    icon: Clock,
                    disabled: current === 'pendente',
                    onClick: () => changeStatus(ctxMenu.id, 'pendente'),
                  },
                  {
                    label: 'Pago',
                    icon: CheckCircle2,
                    disabled: current === 'pago',
                    onClick: () => changeStatus(ctxMenu.id, 'pago'),
                  },
                  {
                    label: 'Atrasado',
                    icon: AlertCircle,
                    disabled: current === 'atrasado',
                    onClick: () => changeStatus(ctxMenu.id, 'atrasado'),
                  },
                  {
                    label: 'Cancelado',
                    icon: Ban,
                    disabled: current === 'cancelado',
                    onClick: () => changeStatus(ctxMenu.id, 'cancelado'),
                  },
                  { divider: true, label: '', onClick: () => {} },
                  {
                    label: 'Editar cobrança',
                    icon: undefined,
                    onClick: () => {
                      const c = rows.find((r) => r.id === ctxMenu.id)
                      if (c) openEdit(c)
                    },
                  },
                  {
                    label: 'Excluir cobrança',
                    icon: Trash2,
                    danger: true,
                    onClick: () => remove(ctxMenu.id),
                  },
                ]
                return opts
              })()
            : []
        }
      />
    </div>
  )
}
