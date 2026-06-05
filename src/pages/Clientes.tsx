import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2, FileDown, FileUp, Download, Search, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Cliente, ClienteTipo } from '@/types/db'
import { Badge, Button, Combo, EmptyState, Field, Input, Modal, PageHeader, Select } from '@/components/ui'
import { confirmDialog, toast } from '@/lib/dialogs'
import { useRealtime } from '@/lib/realtime'
import {
  fetchCep,
  fetchCnpj,
  formatCep,
  formatCnpj,
  formatCpf,
  formatPhoneByCountry,
  composePhone,
  parsePhone,
  formatPhoneDisplay,
  COUNTRIES,
} from '@/lib/lookup'

type Form = {
  tipo: ClienteTipo
  documento: string
  nome: string
  nome_fantasia: string
  email: string
  dial: string
  telefone: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

const empty: Form = {
  tipo: 'pf',
  documento: '',
  nome: '',
  nome_fantasia: '',
  email: '',
  dial: '55',
  telefone: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
}

function clienteToForm(c: Cliente): Form {
  const phone = parsePhone(c.telefone)
  return {
    tipo: c.tipo,
    documento: c.documento,
    nome: c.nome,
    nome_fantasia: c.nome_fantasia ?? '',
    email: c.email ?? '',
    dial: phone.dial,
    telefone: phone.numero,
    cep: c.cep ?? '',
    logradouro: c.logradouro ?? '',
    numero: c.numero ?? '',
    complemento: c.complemento ?? '',
    bairro: c.bairro ?? '',
    cidade: c.cidade ?? '',
    uf: c.uf ?? '',
  }
}

export default function Clientes() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Cliente | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false)
  const [lookingDoc, setLookingDoc] = useState(false)
  const [lookingCep, setLookingCep] = useState(false)
  const [filter, setFilter] = useState<'todos' | ClienteTipo>('todos')
  const [importOpen, setImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<
    | {
        rows: Array<{
          row: number
          tipo: ClienteTipo
          documento: string
          nome: string
          nome_fantasia: string | null
          email: string | null
          telefone: string | null
          cep: string | null
          logradouro: string | null
          numero: string | null
          complemento: string | null
          bairro: string | null
          cidade: string | null
          uf: string | null
          error?: string
        }>
        ok: number
        falha: number
      }
    | null
  >(null)
  const [importing, setImporting] = useState(false)

  async function load() {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setRows([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) console.error(error)
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useRealtime(['clientes'], load)

  function openNew() {
    setEditing(null)
    setForm(empty)
    setOpen(true)
  }

  // Abre modal pré-preenchido quando vem de /mensagens com ?novo=1&telefone=...
  useEffect(() => {
    if (searchParams.get('novo') !== '1') return
    const telParam = searchParams.get('telefone') ?? ''
    const parsed = parsePhone(telParam)
    setEditing(null)
    setForm({
      ...empty,
      dial: parsed.dial || '55',
      telefone: parsed.numero || '',
    })
    setOpen(true)
    // Limpa params da URL pra não reabrir em refresh
    const next = new URLSearchParams(searchParams)
    next.delete('novo')
    next.delete('telefone')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function openEdit(c: Cliente) {
    setEditing(c)
    setForm(clienteToForm(c))
    setOpen(true)
  }

  function closeModal() {
    setOpen(false)
    setEditing(null)
    setForm(empty)
  }

  async function lookupDocumento() {
    if (form.tipo !== 'pj' || !form.documento) return
    setLookingDoc(true)
    try {
      const data = await fetchCnpj(form.documento)
      const phone = parsePhone(data.telefone)
      setForm((f) => ({
        ...f,
        documento: data.cnpj,
        nome: data.razao_social || f.nome,
        nome_fantasia: data.nome_fantasia ?? f.nome_fantasia,
        email: data.email ?? f.email,
        dial: phone.dial || f.dial,
        telefone: phone.numero || f.telefone,
      }))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLookingDoc(false)
    }
  }

  async function lookupCep() {
    if (!form.cep) return
    setLookingCep(true)
    try {
      const data = await fetchCep(form.cep)
      setForm((f) => ({
        ...f,
        cep: data.cep,
        logradouro: data.logradouro ?? f.logradouro,
        bairro: data.bairro ?? f.bairro,
        cidade: data.cidade ?? f.cidade,
        uf: data.uf ?? f.uf,
      }))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLookingCep(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        tipo: form.tipo,
        documento: form.documento,
        nome: form.nome,
        nome_fantasia: form.tipo === 'pj' ? form.nome_fantasia || null : null,
        email: form.email || null,
        telefone: composePhone(form.dial, form.telefone) || null,
        cep: form.cep || null,
        logradouro: form.logradouro || null,
        numero: form.numero || null,
        complemento: form.complemento || null,
        bairro: form.bairro || null,
        cidade: form.cidade || null,
        uf: form.uf || null,
      }
      const { error } = editing
        ? await supabase.from('clientes').update(payload).eq('id', editing.id)
        : await supabase.from('clientes').insert(payload)
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(editing ? 'Cliente atualizado.' : 'Cliente cadastrado.')
      closeModal()
      load()
    } catch (e) {
      console.error('[clientes] save falhou:', e)
      toast.error('Falha inesperada ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    const ok = await confirmDialog({
      title: 'Excluir cliente?',
      message: 'As cobranças vinculadas também serão removidas. Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Cliente excluído.')
    load()
  }

  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(filtered)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
    XLSX.writeFile(wb, 'clientes.xlsx')
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      {
        tipo: 'pf',
        documento: '111.222.333-44',
        nome: 'Maria Silva',
        nome_fantasia: '',
        email: 'maria@example.com',
        telefone: '+55 11 99999-9999',
        cep: '01310-100',
        logradouro: 'Av. Paulista',
        numero: '1578',
        complemento: 'Ap 12',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        uf: 'SP',
      },
      {
        tipo: 'pj',
        documento: '11.222.333/0001-44',
        nome: 'Empresa Exemplo Ltda',
        nome_fantasia: 'Exemplo',
        email: 'contato@exemplo.com',
        telefone: '+55 11 3000-0000',
        cep: '04543-000',
        logradouro: 'Av. Brigadeiro Faria Lima',
        numero: '3477',
        complemento: '14º andar',
        bairro: 'Itaim Bibi',
        cidade: 'São Paulo',
        uf: 'SP',
      },
    ])
    ;(ws as XLSX.WorkSheet)['!cols'] = [
      { wch: 8 },   // tipo
      { wch: 22 },  // documento
      { wch: 28 },  // nome
      { wch: 22 },  // nome_fantasia
      { wch: 26 },  // email
      { wch: 20 },  // telefone
      { wch: 12 },  // cep
      { wch: 30 },  // logradouro
      { wch: 8 },   // numero
      { wch: 18 },  // complemento
      { wch: 18 },  // bairro
      { wch: 18 },  // cidade
      { wch: 6 },   // uf
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')

    const aux = XLSX.utils.aoa_to_sheet([
      ['Como preencher'],
      [''],
      ['tipo', 'Obrigatório. "pf" (pessoa física) ou "pj" (pessoa jurídica).'],
      ['documento', 'Obrigatório. CPF (11 dígitos) pra PF, CNPJ (14 dígitos) pra PJ. Com ou sem formatação.'],
      ['nome', 'Obrigatório. Nome completo (PF) ou razão social (PJ).'],
      ['nome_fantasia', 'Opcional, só PJ. Apelido comercial.'],
      ['email', 'Opcional.'],
      ['telefone', 'Opcional. Com DDI ou só com DDD. Ex.: +55 11 99999-9999.'],
      ['cep', 'Opcional. Com ou sem hífen.'],
      ['logradouro', 'Opcional. Rua/Avenida.'],
      ['numero', 'Opcional.'],
      ['complemento', 'Opcional.'],
      ['bairro', 'Opcional.'],
      ['cidade', 'Opcional.'],
      ['uf', 'Opcional. 2 letras (SP, RJ, etc.).'],
      [''],
      ['Apague estas linhas de exemplo antes de importar.'],
    ])
    ;(aux as XLSX.WorkSheet)['!cols'] = [{ wch: 16 }, { wch: 80 }]
    XLSX.utils.book_append_sheet(wb, aux, 'Instruções')
    XLSX.writeFile(wb, 'modelo-clientes.xlsx')
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

      const docsExistentes = new Set(rows.map((r) => onlyDigits(r.documento)))
      const docsLinha = new Set<string>()
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

      const out = raw.map((r, idx) => {
        const tipoRaw = String((r as { tipo?: string }).tipo ?? '').toLowerCase().trim()
        const tipo = (tipoRaw === 'pj' ? 'pj' : 'pf') as ClienteTipo
        const tipoExplicit = tipoRaw === 'pj' || tipoRaw === 'pf'
        const documento = String((r as { documento?: string }).documento ?? '').trim()
        const nome = String((r as { nome?: string }).nome ?? '').trim()
        const nome_fantasia =
          String((r as { nome_fantasia?: string }).nome_fantasia ?? '').trim() || null
        const email = String((r as { email?: string }).email ?? '').trim() || null
        const telefoneRaw = String((r as { telefone?: string }).telefone ?? '').trim()
        const telefone = telefoneRaw
          ? (() => {
              const parsed = parsePhone(telefoneRaw)
              return composePhone(parsed.dial, parsed.numero) || onlyDigits(telefoneRaw) || null
            })()
          : null
        const cep = String((r as { cep?: string }).cep ?? '').trim() || null
        const logradouro = String((r as { logradouro?: string }).logradouro ?? '').trim() || null
        const numero = String((r as { numero?: string }).numero ?? '').trim() || null
        const complemento = String((r as { complemento?: string }).complemento ?? '').trim() || null
        const bairro = String((r as { bairro?: string }).bairro ?? '').trim() || null
        const cidade = String((r as { cidade?: string }).cidade ?? '').trim() || null
        const uf = String((r as { uf?: string }).uf ?? '').trim().toUpperCase().slice(0, 2) || null

        const docDigits = onlyDigits(documento)
        let error: string | undefined

        if (!tipoExplicit) error = 'tipo inválido (use pf ou pj)'
        else if (!documento) error = 'documento vazio'
        else if (tipo === 'pf' && docDigits.length !== 11) error = 'CPF deve ter 11 dígitos'
        else if (tipo === 'pj' && docDigits.length !== 14) error = 'CNPJ deve ter 14 dígitos'
        else if (!nome) error = 'nome vazio'
        else if (email && !emailRegex.test(email)) error = 'email inválido'
        else if (docsExistentes.has(docDigits)) error = 'documento já cadastrado'
        else if (docsLinha.has(docDigits)) error = 'documento duplicado na planilha'

        if (!error && docDigits) docsLinha.add(docDigits)

        const documentoFmt =
          tipo === 'pj' ? formatCnpj(docDigits || documento) : formatCpf(docDigits || documento)

        return {
          row: idx + 2,
          tipo,
          documento: documentoFmt,
          nome,
          nome_fantasia: tipo === 'pj' ? nome_fantasia : null,
          email,
          telefone,
          cep,
          logradouro,
          numero,
          complemento,
          bairro,
          cidade,
          uf,
          error,
        }
      })

      const ok = out.filter((r) => !r.error).length
      setImportPreview({ rows: out, ok, falha: out.length - ok })
    } catch (err) {
      console.error('[import clientes] parse falhou:', err)
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
        tipo: r.tipo,
        documento: r.documento,
        nome: r.nome,
        nome_fantasia: r.nome_fantasia,
        email: r.email,
        telefone: r.telefone,
        cep: r.cep,
        logradouro: r.logradouro,
        numero: r.numero,
        complemento: r.complemento,
        bairro: r.bairro,
        cidade: r.cidade,
        uf: r.uf,
      }))
      const { error } = await supabase.from('clientes').insert(payloads)
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(`${validRows.length} cliente(s) importado(s).`)
      setImportOpen(false)
      setImportPreview(null)
      load()
    } catch (e) {
      console.error('[import clientes] insert falhou:', e)
      toast.error('Falha ao importar.')
    } finally {
      setImporting(false)
    }
  }

  const filtered = filter === 'todos' ? rows : rows.filter((r) => r.tipo === filter)

  function setDocumento(v: string) {
    setForm({ ...form, documento: form.tipo === 'pj' ? formatCnpj(v) : formatCpf(v) })
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Pessoas físicas e jurídicas que você cobra."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setImportPreview(null)
                setImportOpen(true)
              }}
            >
              <FileUp className="size-4" />
              Importar
            </Button>
            <Button variant="secondary" onClick={exportXlsx} disabled={filtered.length === 0}>
              <FileDown className="size-4" />
              Exportar
            </Button>
            <Button onClick={openNew}>
              <Plus className="size-4" />
              Novo cliente
            </Button>
          </>
        }
      />

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="inline-flex p-0.5 border border-border rounded-md bg-surface">
          {(['todos', 'pf', 'pj'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`tab-pill px-3 h-7 text-xs font-medium rounded ${
                filter === k ? 'bg-fg text-surface' : 'text-fg-3 hover:text-fg'
              }`}
            >
              {k === 'todos' ? 'Todos' : k === 'pf' ? 'PF' : 'PJ'}
            </button>
          ))}
        </div>
        <div className="text-xs text-fg-4 tabular">{filtered.length} resultado(s)</div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            loading
              ? 'Carregando…'
              : rows.length === 0
                ? 'Nenhum cliente cadastrado'
                : 'Nenhum resultado para este filtro'
          }
          hint={
            loading
              ? 'Buscando registros…'
              : rows.length === 0
                ? isSupabaseConfigured
                  ? 'Clique em "Novo cliente" para começar.'
                  : 'Configure o Supabase para gravar dados.'
                : 'Tente alterar o filtro acima.'
          }
        />
      ) : (
        <div className="border border-border rounded-lg bg-surface overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-bg">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Tipo</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Documento</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Nome</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Cidade</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Contato</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="stagger">
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className="row-hover border-b border-border-2 last:border-b-0 hover:bg-hover cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <Badge>{r.tipo.toUpperCase()}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-2 tabular">{r.documento}</td>
                  <td className="px-4 py-3">
                    <div className="text-fg">{r.nome}</div>
                    {r.nome_fantasia && (
                      <div className="text-xs text-fg-4">{r.nome_fantasia}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-fg-3">
                    {r.cidade ? (
                      <>
                        {r.cidade}
                        {r.uf && <span className="text-fg-4">/{r.uf}</span>}
                      </>
                    ) : (
                      <span className="text-fg-4">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-fg-3 text-xs">
                    <div>{r.email ?? <span className="text-fg-4">—</span>}</div>
                    {r.telefone && <div className="text-fg-4">{formatPhoneDisplay(r.telefone)}</div>}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => remove(r.id)}
                      className="text-fg-4 hover:text-danger transition"
                      title="Excluir"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Editar cliente' : 'Novo cliente'}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" form="form-cliente" disabled={saving}>
              {saving ? 'Salvando…' : editing ? 'Atualizar' : 'Salvar'}
            </Button>
          </>
        }
      >
        <form id="form-cliente" onSubmit={save} className="space-y-3">
          <Field label="Tipo">
            <Select
              value={form.tipo}
              onChange={(e) =>
                setForm({
                  ...form,
                  tipo: e.target.value as ClienteTipo,
                  documento: editing ? form.documento : '',
                })
              }
            >
              <option value="pf">Pessoa Física (CPF)</option>
              <option value="pj">Pessoa Jurídica (CNPJ)</option>
            </Select>
          </Field>

          <Field
            label={form.tipo === 'pj' ? 'CNPJ' : 'CPF'}
            hint={form.tipo === 'pj' ? 'Buscar preenche razão social, fantasia, contato.' : undefined}
          >
            <div className="flex gap-2">
              <Input
                required
                value={form.documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder={form.tipo === 'pj' ? '00.000.000/0000-00' : '000.000.000-00'}
                className="font-mono"
              />
              {form.tipo === 'pj' && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={lookupDocumento}
                  disabled={lookingDoc || !form.documento}
                >
                  {lookingDoc ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  Buscar
                </Button>
              )}
            </div>
          </Field>

          <Field label={form.tipo === 'pj' ? 'Razão social' : 'Nome'}>
            <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </Field>

          {form.tipo === 'pj' && (
            <Field label="Nome fantasia">
              <Input
                value={form.nome_fantasia}
                onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
              />
            </Field>
          )}

          <Field label="E-mail">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>

          <Field label="Telefone" hint="País + número completo (com DDD).">
            <div className="flex gap-2">
              <div className="w-32 shrink-0">
                <Combo
                  value={form.dial}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      dial: v,
                      telefone: formatPhoneByCountry(v, form.telefone),
                    })
                  }
                  options={COUNTRIES.map((c) => ({
                    value: c.dial,
                    label: (
                      <span className="flex items-center gap-2">
                        <span className="text-base leading-none">{c.flag}</span>
                        <span className="tabular text-fg-2">+{c.dial}</span>
                        <span className="text-xs text-fg-4 truncate">{c.name}</span>
                      </span>
                    ),
                  }))}
                />
              </div>
              <Input
                value={form.telefone}
                onChange={(e) =>
                  setForm({
                    ...form,
                    telefone: formatPhoneByCountry(form.dial, e.target.value),
                  })
                }
                placeholder={form.dial === '55' ? '(11) 99999-9999' : 'Número local'}
                inputMode="tel"
                maxLength={form.dial === '55' ? 16 : 15}
                className="font-mono min-w-0 flex-1"
              />
            </div>
          </Field>

          <div className="pt-4 mt-2 border-t border-border">
            <div className="text-xs font-medium text-fg-2 mb-3">Endereço (opcional)</div>

            <Field label="CEP" hint="Auto-preenche logradouro, bairro, cidade e UF (ViaCEP).">
              <div className="flex gap-2">
                <Input
                  value={form.cep}
                  onChange={(e) => setForm({ ...form, cep: formatCep(e.target.value) })}
                  onBlur={() => form.cep && !form.logradouro && lookupCep()}
                  placeholder="00000-000"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={lookupCep}
                  disabled={lookingCep || !form.cep}
                >
                  {lookingCep ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  Buscar
                </Button>
              </div>
            </Field>

            <div className="mt-3">
              <Field label="Logradouro">
                <Input value={form.logradouro} onChange={(e) => setForm({ ...form, logradouro: e.target.value })} />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
              <Field label="Número">
                <Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Complemento">
                  <Input value={form.complemento} onChange={(e) => setForm({ ...form, complemento: e.target.value })} />
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
              <Field label="Bairro">
                <Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
              </Field>
              <Field label="Cidade">
                <Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
              </Field>
              <Field label="UF">
                <Input
                  maxLength={2}
                  value={form.uf}
                  onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })}
                />
              </Field>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false)
          setImportPreview(null)
        }}
        title="Importar clientes"
        footer={
          importPreview ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setImportPreview(null)}>
                Voltar
              </Button>
              <Button
                type="button"
                onClick={confirmImport}
                disabled={importing || importPreview.ok === 0}
              >
                {importing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                Importar {importPreview.ok} cliente(s)
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setImportOpen(false)}>
              Cancelar
            </Button>
          )
        }
      >
        {!importPreview ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-3 leading-relaxed">
              Cadastre vários clientes de uma vez a partir de uma planilha. Os campos obrigatórios
              são <code className="font-mono text-fg-2 bg-hover px-1 py-0.5 rounded">tipo</code>,{' '}
              <code className="font-mono text-fg-2 bg-hover px-1 py-0.5 rounded">documento</code> e{' '}
              <code className="font-mono text-fg-2 bg-hover px-1 py-0.5 rounded">nome</code>.
            </p>

            <div className="rounded-lg border border-border bg-bg p-4">
              <div className="text-xs font-medium text-fg-2 mb-2">1. Baixe o modelo</div>
              <Button type="button" variant="secondary" onClick={downloadTemplate}>
                <Download className="size-4" />
                Baixar modelo .xlsx
              </Button>
              <div className="mt-2 text-[11px] text-fg-4">
                A planilha vem com a aba <b>Clientes</b> + uma aba <b>Instruções</b>.
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
              Documentos já cadastrados ou duplicados na própria planilha são ignorados.
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
                    <th className="px-2 py-2 text-left text-fg-3 font-medium w-12">Tipo</th>
                    <th className="px-2 py-2 text-left text-fg-3 font-medium">Documento</th>
                    <th className="px-2 py-2 text-left text-fg-3 font-medium">Nome</th>
                    <th className="px-2 py-2 text-left text-fg-3 font-medium">Cidade</th>
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
                      <td className="px-2 py-1.5 text-fg-2 uppercase">{r.tipo}</td>
                      <td className="px-2 py-1.5 font-mono text-fg-2 tabular">
                        {r.documento || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-fg">
                        {r.nome || '—'}
                        {r.error && (
                          <div className="text-[10px] text-danger mt-0.5">{r.error}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-fg-3">
                        {r.cidade ? `${r.cidade}${r.uf ? '/' + r.uf : ''}` : '—'}
                      </td>
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
