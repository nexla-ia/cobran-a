import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, FileDown, FileUp, CheckCircle2, RotateCcw, Send, Loader2, X, Clock, AlertCircle, Ban, Search, Download, Repeat, Receipt } from 'lucide-react'
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
  nome: string
  descricao: string
  valor: string
  vencimento: string
  status: CobrancaStatus
  mensalidade: boolean
}

const empty: Form = {
  cliente_id: '',
  nome: '',
  descricao: '',
  valor: '',
  vencimento: '',
  status: 'pendente',
  mensalidade: false,
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
    nome: c.nome ?? '',
    descricao: c.descricao,
    valor: formatBRLFromNumber(Number(c.valor)),
    vencimento: c.vencimento,
    status: c.status,
    mensalidade: c.mensalidade ?? false,
  }
}

export default function Cobrancas() {
  const { session, profile } = useAuth()
  const [rows, setRows] = useState<Cobranca[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Cobranca | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'todos' | CobrancaStatus>('todos')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importOpen, setImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<
    | {
        rows: Array<{
          row: number
          documento: string
          nome: string
          descricao: string
          valor: number
          vencimento: string
          status: CobrancaStatus
          cliente_id: string | null
          error?: string
        }>
        ok: number
        falha: number
      }
    | null
  >(null)
  const [importing, setImporting] = useState(false)
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
      nome: form.nome.trim() || null,
      descricao: form.descricao,
      valor: cents / 100,
      vencimento: form.vencimento,
      status: form.status,
      pago_em:
        form.status === 'pago'
          ? editing?.pago_em ?? new Date().toISOString().slice(0, 10)
          : null,
      mensalidade: form.mensalidade,
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

    // Bloqueia cobranças pagas / canceladas
    const sendable: string[] = []
    let bloqueadas = 0
    for (const id of ids) {
      const c = rows.find((r) => r.id === id)
      if (!c) continue
      if (c.status === 'pago' || c.status === 'cancelado') {
        bloqueadas++
        continue
      }
      sendable.push(id)
    }

    if (sendable.length === 0) {
      toast.error(
        bloqueadas > 0
          ? 'Nenhuma cobrança pode ser enviada: todas estão pagas ou canceladas.'
          : 'Nenhuma cobrança disponível pra envio.',
      )
      return
    }

    const ok = await confirmDialog({
      title: `Enviar ${sendable.length} cobrança(s)?`,
      message:
        bloqueadas > 0
          ? `O sistema vai enviar ${sendable.length} cobrança(s) pelo WhatsApp. ${bloqueadas} foram ignoradas (pagas ou canceladas).`
          : 'O sistema vai enviar a cobrança para o WhatsApp do cliente.',
      confirmLabel: 'Enviar',
    })
    if (!ok) return
    setSending(true)

    // Agrupar por cliente
    const groups = new Map<
      string,
      { cliente: Cliente; cobrancas: Cobranca[] }
    >()
    for (const id of sendable) {
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
          nome: c.nome,
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
        user_id: session?.user?.id ?? null,
        evolution_instancia: profile?.evolution_instancia ?? null,
        evolution_api_key: profile?.evolution_api_key ?? null,
        mensagem_template: profile?.mensagem_template ?? null,
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
            `${totalCobrancas} cobrança(s) enviada(s). Acompanhe o status em "Envios".`,
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

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      {
        documento: '000.000.000-00',
        nome: 'Mensalidade Maio/2026',
        descricao: 'Plano premium — referente a maio',
        valor: 199.9,
        vencimento: '2026-05-28',
        status: 'pendente',
      },
      {
        documento: '00.000.000/0000-00',
        nome: 'Serviço de consultoria',
        descricao: 'Pagamento referente ao contrato 1234',
        valor: 1500,
        vencimento: '2026-06-10',
        status: 'pendente',
      },
    ])
    // Largura das colunas
    ;(ws as XLSX.WorkSheet)['!cols'] = [
      { wch: 22 }, // documento
      { wch: 28 }, // nome
      { wch: 36 }, // descricao
      { wch: 12 }, // valor
      { wch: 14 }, // vencimento
      { wch: 12 }, // status
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cobranças')
    // Aba de instruções
    const aux = XLSX.utils.aoa_to_sheet([
      ['Como preencher'],
      [''],
      ['documento', 'CPF (PF) ou CNPJ (PJ) do cliente já cadastrado. Com ou sem formatação.'],
      ['nome', 'Título curto da cobrança.'],
      ['descricao', 'Detalhes da cobrança.'],
      ['valor', 'Valor em reais com ponto decimal (ex.: 199.90).'],
      ['vencimento', 'Data ISO YYYY-MM-DD (ex.: 2026-05-28).'],
      ['status', 'Opcional. pendente / pago / atrasado / cancelado. Default: pendente.'],
      [''],
      ['Apague estas linhas de exemplo antes de importar.'],
    ])
    ;(aux as XLSX.WorkSheet)['!cols'] = [{ wch: 16 }, { wch: 80 }]
    XLSX.utils.book_append_sheet(wb, aux, 'Instruções')
    XLSX.writeFile(wb, 'modelo-cobrancas.xlsx')
  }

  function onlyDigits(s: string | number | null | undefined) {
    return String(s ?? '').replace(/\D/g, '')
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (raw.length === 0) {
        toast.error('Planilha vazia.')
        return
      }
      const validStatus: CobrancaStatus[] = ['pendente', 'pago', 'atrasado', 'cancelado']
      const byDoc = new Map<string, Cliente>()
      clientes.forEach((c) => byDoc.set(onlyDigits(c.documento), c))

      const rows = raw.map((r, idx) => {
        const documento = String((r as { documento?: string }).documento ?? '').trim()
        const nome = String((r as { nome?: string }).nome ?? '').trim()
        const descricao = String((r as { descricao?: string }).descricao ?? '').trim()
        const valorRaw = (r as { valor?: number | string }).valor ?? 0
        const valor =
          typeof valorRaw === 'number'
            ? valorRaw
            : Number(String(valorRaw).replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.'))
        const vencimentoRaw = String((r as { vencimento?: string }).vencimento ?? '').trim()
        let vencimento = vencimentoRaw
        // aceita também DD/MM/YYYY
        const m = vencimentoRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        if (m) vencimento = `${m[3]}-${m[2]}-${m[1]}`
        const statusRaw =
          String((r as { status?: string }).status ?? 'pendente').toLowerCase().trim() ||
          'pendente'
        const status = (validStatus.includes(statusRaw as CobrancaStatus)
          ? (statusRaw as CobrancaStatus)
          : 'pendente') as CobrancaStatus

        const docDigits = onlyDigits(documento)
        const cliente = docDigits ? byDoc.get(docDigits) ?? null : null

        let error: string | undefined
        if (!documento) error = 'documento vazio'
        else if (!cliente) error = 'cliente não encontrado'
        else if (!nome) error = 'nome vazio'
        else if (!descricao) error = 'descrição vazia'
        else if (!Number.isFinite(valor) || valor <= 0) error = 'valor inválido'
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) error = 'vencimento inválido'

        return {
          row: idx + 2, // +2 pra contar header como linha 1
          documento,
          nome,
          descricao,
          valor: Number.isFinite(valor) ? valor : 0,
          vencimento,
          status,
          cliente_id: cliente?.id ?? null,
          error,
        }
      })

      const ok = rows.filter((r) => !r.error).length
      setImportPreview({ rows, ok, falha: rows.length - ok })
    } catch (err) {
      console.error('[import] parse falhou:', err)
      toast.error('Falha ao ler arquivo. Use o modelo .xlsx.')
    }
  }

  async function confirmImport() {
    if (!importPreview) return
    const validRows = importPreview.rows.filter((r) => !r.error)
    if (validRows.length === 0) {
      toast.error('Nenhuma linha válida pra importar.')
      return
    }
    setImporting(true)
    try {
      const payloads = validRows.map((r) => ({
        cliente_id: r.cliente_id!,
        nome: r.nome,
        descricao: r.descricao,
        valor: r.valor,
        vencimento: r.vencimento,
        status: r.status,
        pago_em: r.status === 'pago' ? new Date().toISOString().slice(0, 10) : null,
      }))
      const { error } = await supabase.from('cobrancas').insert(payloads)
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(`${validRows.length} cobrança(s) importada(s).`)
      setImportOpen(false)
      setImportPreview(null)
      load()
    } catch (e) {
      console.error('[import] insert falhou:', e)
      toast.error('Falha ao importar.')
    } finally {
      setImporting(false)
    }
  }

  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        cliente: clienteMap.get(r.cliente_id)?.nome ?? r.cliente_id,
        documento: clienteMap.get(r.cliente_id)?.documento ?? '',
        nome: r.nome ?? '',
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

  const q = query.trim().toLowerCase()
  const filtered = enriched.filter((r) => {
    if (statusFilter !== 'todos' && r.status !== statusFilter) return false
    if (!q) return true
    const cli = clienteMap.get(r.cliente_id)
    return (
      (r.nome?.toLowerCase().includes(q) ?? false) ||
      r.descricao.toLowerCase().includes(q) ||
      (cli?.nome?.toLowerCase().includes(q) ?? false) ||
      (cli?.documento?.toLowerCase().includes(q) ?? false)
    )
  })

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
            <Button
              variant="secondary"
              onClick={() => {
                setImportPreview(null)
                setImportOpen(true)
              }}
              disabled={clientes.length === 0}
              title={clientes.length === 0 ? 'Cadastre clientes antes de importar' : ''}
            >
              <FileUp className="size-4" />
              Importar
            </Button>
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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="size-3.5 text-fg-4 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar descrição, cliente ou documento"
              className="h-8 w-64 max-w-full pl-8 pr-7 text-xs bg-surface border border-border rounded-md text-fg placeholder:text-fg-4 outline-none focus:border-fg-3 transition"
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
                  {(() => {
                    const selectable = filtered.filter(
                      (r) => r.status !== 'pago' && r.status !== 'cancelado',
                    )
                    return (
                      <Checkbox
                        checked={selectable.length > 0 && selected.size === selectable.length}
                        indeterminate={
                          selected.size > 0 && selected.size < selectable.length
                        }
                        onChange={(v) =>
                          setSelected(v ? new Set(selectable.map((r) => r.id)) : new Set())
                        }
                        aria-label="Selecionar todas (exceto pagas/canceladas)"
                      />
                    )
                  })()}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Cliente</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Nome</th>
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
                const naoEnviavel = r.status === 'pago' || r.status === 'cancelado'
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
                        checked={!naoEnviavel && isSelected}
                        onChange={() => !naoEnviavel && toggleOne(r.id)}
                        disabled={naoEnviavel}
                        aria-label={naoEnviavel ? 'Não enviável' : 'Selecionar'}
                        title={
                          r.status === 'pago'
                            ? 'Cobrança paga não pode ser enviada'
                            : r.status === 'cancelado'
                              ? 'Cobrança cancelada não pode ser enviada'
                              : ''
                        }
                        className={naoEnviavel ? 'opacity-40 cursor-not-allowed' : ''}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-fg">{cli?.nome ?? '—'}</div>
                      <div className="text-xs text-fg-4 font-mono tabular">{cli?.documento ?? ''}</div>
                    </td>
                    <td className="px-4 py-3 text-fg">
                      <div className="flex items-center gap-1.5">
                        {r.mensalidade && (
                          <span
                            className="inline-flex items-center text-fg-3"
                            title="Mensalidade — renova automaticamente a cada mês"
                          >
                            <Repeat className="size-3" />
                          </span>
                        )}
                        <span>{r.nome ?? <span className="text-fg-4">—</span>}</span>
                      </div>
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
        <form id="form-cobranca" onSubmit={save} className="space-y-5">
          {/* Cliente */}
          <div>
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
            {(() => {
              const c = form.cliente_id ? clienteMap.get(form.cliente_id) : null
              if (!c) return null
              return (
                <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border-2 bg-bg">
                  <div className="size-6 rounded-full bg-fg text-surface grid place-items-center text-[10px] font-semibold shrink-0">
                    {c.nome.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex items-baseline gap-2 text-xs">
                    <span className="font-medium text-fg truncate">{c.nome}</span>
                    <span className="font-mono tabular text-fg-4 shrink-0">{c.documento}</span>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Detalhes */}
          <div className="space-y-3">
            <Field label="Título" hint="Nome curto pra identificar e buscar depois.">
              <Input
                required
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex: Mensalidade Maio/2026"
              />
            </Field>

            <Field label="Descrição">
              <Textarea
                required
                rows={3}
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Detalhes da cobrança, plano, observações…"
              />
            </Field>
          </div>

          {/* Tipo de cobrança */}
          <div>
            <div className="text-xs font-medium text-fg-2 mb-2">Tipo de cobrança</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, mensalidade: false })}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  !form.mensalidade
                    ? 'border-fg bg-fg/[0.03]'
                    : 'border-border bg-surface hover:border-fg-4'
                }`}
              >
                <div
                  className={`flex items-center gap-2 ${
                    !form.mensalidade ? 'text-fg' : 'text-fg-2'
                  }`}
                >
                  <Receipt className="size-4" />
                  <span className="text-sm font-medium">Única</span>
                </div>
                <div className="text-[11px] text-fg-3 mt-1">
                  Cobrança avulsa, não repete.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, mensalidade: true })}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  form.mensalidade
                    ? 'border-fg bg-fg/[0.03]'
                    : 'border-border bg-surface hover:border-fg-4'
                }`}
              >
                <div
                  className={`flex items-center gap-2 ${
                    form.mensalidade ? 'text-fg' : 'text-fg-2'
                  }`}
                >
                  <Repeat className="size-4" />
                  <span className="text-sm font-medium">Mensal</span>
                </div>
                <div className="text-[11px] text-fg-3 mt-1">
                  Renova todo mês automaticamente.
                </div>
              </button>
            </div>
          </div>

          {/* Valor + Vencimento */}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Valor (R$)"
              hint="Digite só os números, os centavos entram automático."
            >
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
              label={form.mensalidade ? 'Dia do mês' : 'Vencimento'}
              hint={
                form.vencimento
                  ? form.mensalidade
                    ? `Renova todo dia ${dayFromISO(form.vencimento)
                        .toString()
                        .padStart(2, '0')} · próximo: ${(() => {
                        const [y, m, d] = form.vencimento.split('-')
                        return `${d}/${m}/${y}`
                      })()}`
                    : `Vence em ${(() => {
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

          {editing && editing.total_envios > 0 && (
            <div className="pt-4 mt-2 border-t border-border text-[11px] text-fg-4">
              Esta cobrança já foi enviada{' '}
              <span className="font-medium text-fg-3">{editing.total_envios}</span>{' '}
              {editing.total_envios === 1 ? 'vez' : 'vezes'}
              {editing.ultimo_envio_em &&
                ` · último envio ${new Date(editing.ultimo_envio_em).toLocaleString('pt-BR')}`}
              . As regras de envio são as configuradas em /usuarios.
            </div>
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

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false)
          setImportPreview(null)
        }}
        title="Importar cobranças"
        footer={
          importPreview ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setImportPreview(null)}
              >
                Voltar
              </Button>
              <Button
                type="button"
                onClick={confirmImport}
                disabled={importing || importPreview.ok === 0}
              >
                {importing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                Importar {importPreview.ok} cobrança(s)
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setImportOpen(false)}
            >
              Cancelar
            </Button>
          )
        }
      >
        {!importPreview ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-3 leading-relaxed">
              Importe cobranças em lote a partir de uma planilha. A coluna{' '}
              <code className="font-mono text-fg-2 bg-hover px-1 py-0.5 rounded">documento</code>{' '}
              (CPF/CNPJ) é usada pra encontrar o cliente já cadastrado.
            </p>

            <div className="rounded-lg border border-border bg-bg p-4">
              <div className="text-xs font-medium text-fg-2 mb-2">1. Baixe o modelo</div>
              <Button type="button" variant="secondary" onClick={downloadTemplate}>
                <Download className="size-4" />
                Baixar modelo .xlsx
              </Button>
              <div className="mt-2 text-[11px] text-fg-4">
                A planilha vem com a aba <b>Cobranças</b> + uma aba <b>Instruções</b>.
              </div>
            </div>

            <div className="rounded-lg border border-border bg-bg p-4">
              <div className="text-xs font-medium text-fg-2 mb-2">2. Envie o arquivo preenchido</div>
              <label className="inline-flex items-center gap-2 h-9 px-3 text-sm rounded-md bg-fg text-surface hover:bg-fg-2 transition cursor-pointer">
                <FileUp className="size-4" />
                Selecionar arquivo .xlsx
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  onChange={handleImportFile}
                />
              </label>
            </div>

            <div className="text-[11px] text-fg-4 leading-relaxed">
              Campos esperados: <code className="font-mono">documento, nome, descricao, valor,
              vencimento, status</code>. Status é opcional (default: pendente).
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="px-2 py-0.5 rounded bg-green-50 text-success border border-green-200 text-xs font-medium">
                {importPreview.ok} ok
              </span>
              {importPreview.falha > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-50 text-danger border border-red-200 text-xs font-medium">
                  {importPreview.falha} com erro
                </span>
              )}
              <span className="text-fg-4 text-xs">
                de {importPreview.rows.length} linha(s) totais
              </span>
            </div>

            <div className="border border-border rounded-md overflow-hidden max-h-[360px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-bg sticky top-0">
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 text-left text-fg-3 font-medium w-10">#</th>
                    <th className="px-2 py-2 text-left text-fg-3 font-medium">Documento</th>
                    <th className="px-2 py-2 text-left text-fg-3 font-medium">Nome</th>
                    <th className="px-2 py-2 text-right text-fg-3 font-medium">Valor</th>
                    <th className="px-2 py-2 text-left text-fg-3 font-medium">Vencimento</th>
                    <th className="px-2 py-2 text-left text-fg-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.rows.map((r) => (
                    <tr
                      key={r.row}
                      className={`border-b border-border-2 last:border-b-0 ${
                        r.error ? 'bg-red-50/50' : ''
                      }`}
                    >
                      <td className="px-2 py-1.5 text-fg-4 tabular">{r.row}</td>
                      <td className="px-2 py-1.5 font-mono text-fg-2 tabular">
                        {r.documento || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-fg">
                        {r.nome || '—'}
                        {r.error && (
                          <div className="text-[10px] text-danger mt-0.5">{r.error}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular font-medium text-fg">
                        {brl.format(r.valor)}
                      </td>
                      <td className="px-2 py-1.5 text-fg-3 tabular">{r.vencimento || '—'}</td>
                      <td className="px-2 py-1.5 text-fg-3">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {importPreview.falha > 0 && (
              <p className="text-[11px] text-fg-4">
                Linhas com erro serão ignoradas. Corrija na planilha e re-envie se quiser
                importar todas.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
