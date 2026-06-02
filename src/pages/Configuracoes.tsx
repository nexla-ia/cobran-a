import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings, Loader2, Save, Plus, CheckCheck, AlertCircle, Sparkles } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button, Field, Input, PageHeader } from '@/components/ui'
import { toast } from '@/lib/dialogs'

const MARCADORES = [
  { k: '{cliente}', d: 'Nome do cliente', sample: 'Maria Silva' },
  { k: '{cobranca}', d: 'Título da cobrança', sample: 'Mensalidade Maio/2026' },
  { k: '{descricao}', d: 'Descrição completa', sample: 'Plano premium — referente a maio' },
  { k: '{valor}', d: 'Valor (ex: R$ 199,90)', sample: 'R$ 199,90' },
  { k: '{vencimento}', d: 'Data (ex: 28/05/2026)', sample: '28/05/2026' },
] as const

const PRESETS: Array<{ label: string; text: string }> = [
  {
    label: 'Lembrete amigável',
    text:
      'Olá {cliente}! 👋\n\nPassando só pra lembrar da cobrança "{cobranca}" no valor de {valor}, com vencimento em {vencimento}.\n\nQualquer dúvida estou à disposição!',
  },
  {
    label: 'Formal',
    text:
      'Prezado(a) {cliente},\n\nInformamos que a cobrança "{cobranca}" no valor de {valor} possui vencimento em {vencimento}.\n\nPedimos a gentileza de regularizar ou nos contatar caso o pagamento já tenha sido efetuado.',
  },
  {
    label: 'Última chance',
    text:
      '{cliente}, sua cobrança "{cobranca}" de {valor} venceu em {vencimento} e ainda está pendente.\n\nPor favor, regularize hoje pra evitarmos o cancelamento. Se já pagou, mande o comprovante!',
  },
]

type Form = {
  automacao_ativa: boolean
  envios_por_dia: number
  intervalo_envios_horas: number
  horario_inicio: string
  horario_fim: string
  dias_semana: number[]
  cancelar_automatico: boolean
  dias_ate_cancelar: number
  mensagem_template: string
}

const DEFAULT_TEMPLATE =
  'Olá {cliente}! Lembrete da cobrança "{cobranca}" no valor de {valor}, com vencimento em {vencimento}. Por favor, regularize ou nos avise se já efetuou o pagamento.'

const empty: Form = {
  automacao_ativa: false,
  envios_por_dia: 2,
  intervalo_envios_horas: 4,
  horario_inicio: '09:00',
  horario_fim: '18:00',
  dias_semana: [1, 2, 3, 4, 5],
  cancelar_automatico: false,
  dias_ate_cancelar: 30,
  mensagem_template: DEFAULT_TEMPLATE,
}

const diasOptions = [
  { v: 1, l: 'Seg' },
  { v: 2, l: 'Ter' },
  { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' },
  { v: 5, l: 'Sex' },
  { v: 6, l: 'Sáb' },
  { v: 0, l: 'Dom' },
]

// Intervalo = média da janela ÷ envios por dia.
function calcIntervalo(inicio: string, fim: string, envios: number): number {
  if (envios <= 1) return 1
  try {
    const [h1, m1] = inicio.split(':').map(Number)
    const [h2, m2] = fim.split(':').map(Number)
    const min = h2 * 60 + m2 - (h1 * 60 + m1)
    if (min <= 0) return 1
    return Math.max(1, Math.floor(min / 60 / envios))
  } catch {
    return 1
  }
}

function janelaHorasNum(inicio: string, fim: string): number {
  try {
    const [h1, m1] = inicio.split(':').map(Number)
    const [h2, m2] = fim.split(':').map(Number)
    const min = h2 * 60 + m2 - (h1 * 60 + m1)
    return Math.max(0, min / 60)
  } catch {
    return 0
  }
}

export default function Configuracoes() {
  const { session, profile, loading: authLoading } = useAuth()
  const [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function insertMarcador(marker: string) {
    const ta = textareaRef.current
    const current = form.mensagem_template
    if (!ta) {
      update('mensagem_template', current + (current.endsWith(' ') || !current ? '' : ' ') + marker)
      return
    }
    const start = ta.selectionStart ?? current.length
    const end = ta.selectionEnd ?? current.length
    const before = current.slice(0, start)
    const after = current.slice(end)
    const needsSpaceBefore = before && !/\s$/.test(before)
    const insertion = (needsSpaceBefore ? ' ' : '') + marker
    const newValue = before + insertion + after
    update('mensagem_template', newValue)
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      const pos = (before + insertion).length
      textareaRef.current.setSelectionRange(pos, pos)
    })
  }

  const previewText = useMemo(() => {
    const base = form.mensagem_template || DEFAULT_TEMPLATE
    return MARCADORES.reduce(
      (txt, m) => txt.replaceAll(m.k, m.sample),
      base,
    )
  }, [form.mensagem_template])

  const previewTime = useMemo(() => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }, [])

  const semMarcadores = !MARCADORES.some((m) =>
    form.mensagem_template.includes(m.k),
  )

  useEffect(() => {
    if (!profile) return
    setForm({
      automacao_ativa: profile.automacao_ativa ?? false,
      envios_por_dia: profile.envios_por_dia ?? 2,
      intervalo_envios_horas: profile.intervalo_envios_horas ?? 4,
      horario_inicio: (profile.horario_inicio ?? '09:00').slice(0, 5),
      horario_fim: (profile.horario_fim ?? '18:00').slice(0, 5),
      dias_semana: profile.dias_semana ?? [1, 2, 3, 4, 5],
      cancelar_automatico: profile.cancelar_automatico ?? false,
      dias_ate_cancelar: profile.dias_ate_cancelar ?? 30,
      mensagem_template: profile.mensagem_template ?? DEFAULT_TEMPLATE,
    })
    setDirty(false)
  }, [profile])

  // Mantém intervalo sempre = janela/envios (média)
  useEffect(() => {
    const auto = calcIntervalo(form.horario_inicio, form.horario_fim, form.envios_por_dia)
    if (auto !== form.intervalo_envios_horas) {
      setForm((f) => ({ ...f, intervalo_envios_horas: auto }))
      setDirty(true)
    }
  }, [form.horario_inicio, form.horario_fim, form.envios_por_dia, form.intervalo_envios_horas])

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!isSupabaseConfigured || !session?.user?.id) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          automacao_ativa: form.automacao_ativa,
          envios_por_dia: form.envios_por_dia,
          intervalo_envios_horas: form.intervalo_envios_horas,
          horario_inicio: form.horario_inicio,
          horario_fim: form.horario_fim,
          dias_semana: form.dias_semana,
          cancelar_automatico: form.cancelar_automatico,
          dias_ate_cancelar: form.dias_ate_cancelar,
          mensagem_template: form.mensagem_template.trim() || null,
        })
        .eq('id', session.user.id)
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success('Configurações salvas.')
      setDirty(false)
    } catch (e) {
      console.error('[configuracoes] save falhou:', e)
      toast.error('Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div className="h-64 grid place-items-center">
        <Loader2 className="size-5 animate-spin text-fg-3" />
      </div>
    )
  }

  const janelaH = janelaHorasNum(form.horario_inicio, form.horario_fim)

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Configurações de cobrança"
        subtitle="Regras de automação aplicadas a todas as suas cobranças."
      />

      <form
        onSubmit={handleSave}
        className="border border-border rounded-lg bg-surface p-6 space-y-6"
      >
        {/* Master switch */}
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-border">
          <div>
            <div className="text-sm font-medium text-fg">Automação ativa</div>
            <div className="text-xs text-fg-3 mt-0.5">
              Quando ligada, o sistema dispara as cobranças seguindo as regras abaixo.
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={form.automacao_ativa}
              onChange={(e) => update('automacao_ativa', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-hover rounded-full peer peer-checked:bg-fg transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-surface after:rounded-full after:size-5 after:transition-all peer-checked:after:translate-x-5"></div>
          </label>
        </div>

        {/* Mensagem de cobrança */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div>
            <div className="text-xs font-medium text-fg-2 uppercase tracking-wide">
              Mensagem de cobrança
            </div>
            <div className="text-xs text-fg-3 mt-1">
              Escreva o texto que o cliente vai receber no WhatsApp. Os marcadores entre chaves
              (ex.: <code className="font-mono bg-hover px-1 rounded">{'{cliente}'}</code>) são
              trocados automaticamente pelos dados de cada cobrança.
            </div>
          </div>

          {/* Modelos prontos */}
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] text-fg-4 mr-1">
              <Sparkles className="size-3" />
              Modelos prontos:
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => update('mensagem_template', p.text)}
                className="text-[11px] px-2 h-6 rounded-full border border-border bg-surface hover:border-fg hover:bg-hover text-fg-2 transition"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Editor (esquerda) + Preview WhatsApp (direita) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* EDITOR */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-fg-2">Texto da mensagem</label>
                <span className="text-[10px] text-fg-4 tabular">
                  {form.mensagem_template.length} caractere(s)
                </span>
              </div>

              {/* Chips de marcadores logo acima do textarea */}
              <div className="flex items-center flex-wrap gap-1 mb-1.5 px-2 py-1.5 rounded-md border border-dashed border-border bg-bg/60">
                <span className="text-[10px] text-fg-4 mr-1">Inserir:</span>
                {MARCADORES.map((m) => (
                  <button
                    key={m.k}
                    type="button"
                    onClick={() => insertMarcador(m.k)}
                    title={m.d}
                    className="inline-flex items-center gap-1 px-1.5 h-6 rounded bg-surface border border-border hover:border-fg-3 hover:bg-hover transition text-[11px]"
                  >
                    <Plus className="size-2.5 text-fg-4" />
                    <span className="font-mono text-fg-2">
                      {m.k.replace(/[{}]/g, '')}
                    </span>
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                rows={8}
                value={form.mensagem_template}
                onChange={(e) => update('mensagem_template', e.target.value)}
                placeholder={DEFAULT_TEMPLATE}
                spellCheck={false}
                className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-fg placeholder:text-fg-4 resize-y min-h-[160px] leading-relaxed flex-1"
              />

              {semMarcadores && form.mensagem_template.trim().length > 0 && (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] text-warn">
                  <AlertCircle className="size-3.5 mt-px shrink-0" />
                  <span>
                    Sem marcadores, todos os clientes vão receber o mesmo texto. Use{' '}
                    <code className="font-mono">{'{cliente}'}</code> e outros pra personalizar.
                  </span>
                </div>
              )}
            </div>

            {/* PREVIEW estilo WhatsApp */}
            <div>
              <div className="text-xs text-fg-2 mb-1.5">Pré-visualização no WhatsApp</div>
              <div className="rounded-2xl border border-border overflow-hidden shadow-sm">
                {/* Header */}
                <div className="bg-emerald-700 text-white px-3 h-12 flex items-center gap-2.5">
                  <div className="size-8 rounded-full bg-white/15 grid place-items-center text-xs font-semibold">
                    M
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium leading-tight">Maria Silva</div>
                    <div className="text-[10px] opacity-80 leading-tight">online</div>
                  </div>
                </div>

                {/* Área de chat */}
                <div
                  className="px-3 pt-6 pb-3 min-h-[220px] flex flex-col justify-end"
                  style={{
                    backgroundColor: '#efeae2',
                    backgroundImage:
                      'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)',
                    backgroundSize: '18px 18px',
                  }}
                >
                  <div className="ml-auto max-w-[85%]">
                    <div
                      className="bg-[#d9fdd3] text-fg rounded-lg rounded-tr-sm px-3 py-1.5 shadow-sm relative"
                      style={{
                        boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
                      }}
                    >
                      <div className="text-[13px] leading-relaxed whitespace-pre-wrap">
                        {previewText}
                      </div>
                      <div className="text-[10px] text-fg-3 mt-1 flex items-center justify-end gap-0.5 tabular">
                        <span>{previewTime}</span>
                        <CheckCheck className="size-3 text-sky-500" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-fg-4 mt-1.5">
                Exemplo · Maria Silva · {MARCADORES.find((m) => m.k === '{valor}')?.sample} ·{' '}
                {MARCADORES.find((m) => m.k === '{vencimento}')?.sample}
              </div>
            </div>
          </div>
        </div>

        {/* Frequência */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="text-xs font-medium text-fg-2 uppercase tracking-wide">Frequência</div>
          <Field label="Envios por dia" hint="Máximo de disparos diários por cobrança.">
            <Input
              type="number"
              min={1}
              max={20}
              value={form.envios_por_dia}
              onChange={(e) => update('envios_por_dia', parseInt(e.target.value || '0', 10))}
            />
          </Field>
          <div className="text-xs text-fg-3">
            Intervalo entre envios:{' '}
            <span className="font-medium text-fg tabular">
              {form.intervalo_envios_horas} {form.intervalo_envios_horas === 1 ? 'hora' : 'horas'}
            </span>{' '}
            <span className="text-fg-4">
              (janela de {janelaH.toFixed(0)}h ÷ {form.envios_por_dia} envios)
            </span>
          </div>
        </div>

        {/* Janela */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="text-xs font-medium text-fg-2 uppercase tracking-wide">Janela de envio</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Horário inicial">
              <Input
                type="time"
                value={form.horario_inicio}
                onChange={(e) => update('horario_inicio', e.target.value)}
              />
            </Field>
            <Field label="Horário final">
              <Input
                type="time"
                value={form.horario_fim}
                onChange={(e) => update('horario_fim', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Dias da semana" hint="Marque os dias em que o sistema pode disparar.">
            <div className="flex gap-1.5 flex-wrap">
              {diasOptions.map((d) => {
                const active = form.dias_semana.includes(d.v)
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() =>
                      update(
                        'dias_semana',
                        active
                          ? form.dias_semana.filter((x) => x !== d.v)
                          : [...form.dias_semana, d.v].sort(),
                      )
                    }
                    className={`px-3 h-8 text-xs font-medium rounded-md border transition ${
                      active
                        ? 'bg-fg text-surface border-fg'
                        : 'bg-surface text-fg-3 border-border hover:text-fg hover:border-fg-4'
                    }`}
                  >
                    {d.l}
                  </button>
                )
              })}
            </div>
          </Field>
        </div>

        {/* Cancelamento automático */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-fg">Cancelamento automático</div>
              <div className="text-xs text-fg-3 mt-0.5">
                Cobranças vencidas há muito tempo viram <code>cancelado</code> sozinhas.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={form.cancelar_automatico}
                onChange={(e) => update('cancelar_automatico', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-hover rounded-full peer peer-checked:bg-fg transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-surface after:rounded-full after:size-5 after:transition-all peer-checked:after:translate-x-5"></div>
            </label>
          </div>
          <Field
            label="Cancelar após (dias)"
            hint="Dias depois do vencimento pra cobrança ser cancelada."
          >
            <Input
              type="number"
              min={1}
              max={365}
              value={form.dias_ate_cancelar}
              onChange={(e) => update('dias_ate_cancelar', parseInt(e.target.value || '0', 10))}
              disabled={!form.cancelar_automatico}
            />
          </Field>
        </div>

        {/* Save */}
        <div className="pt-4 border-t border-border flex items-center justify-between">
          <div className="text-xs text-fg-4">
            {dirty ? 'Alterações não salvas.' : 'Tudo salvo.'}
          </div>
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar
          </Button>
        </div>
      </form>

      <div className="mt-6 p-4 rounded-lg border border-border bg-surface text-xs text-fg-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-fg-2 font-medium">
          <Settings className="size-3.5" />
          Como funciona
        </div>
        <p>
          O sistema verifica suas cobranças a cada poucos minutos. Quando uma cobrança está
          pendente ou atrasada e cai dentro da janela (horário e dias configurados acima), ela é
          enviada automaticamente pra o WhatsApp do cliente usando a mensagem definida aqui.
        </p>
        <p>
          Cada cobrança respeita o limite de envios por dia e o intervalo mínimo entre tentativas
          — então um cliente nunca recebe duas mensagens muito próximas.
        </p>
      </div>
    </div>
  )
}
