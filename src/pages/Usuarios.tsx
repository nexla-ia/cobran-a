import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, ShieldCheck, User as UserIcon, MoreVertical, Pencil } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import {
  Badge,
  Button,
  ContextMenu,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  PasswordInput,
  Combo,
} from '@/components/ui'
import type { ContextMenuItem } from '@/components/ui'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth, type Profile, type Role } from '@/lib/auth'
import { confirmDialog, toast } from '@/lib/dialogs'
import { useRealtime } from '@/lib/realtime'
import { isoToBR } from '@/lib/lookup'

type Form = {
  nome: string
  email: string
  password: string
  role: Role
  evolution_instancia: string
  evolution_api_key: string
  evolution_webhook_url: string
}

const empty: Form = {
  nome: '',
  email: '',
  password: '',
  role: 'user',
  evolution_instancia: '',
  evolution_api_key: '',
  evolution_webhook_url: '',
}

export default function Usuarios() {
  const { isAdmin, loading: authLoading, session } = useAuth()
  const [rows, setRows] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  async function load() {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setRows([])
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) console.warn('[usuarios] load:', error.message)
      setRows((data as Profile[]) ?? [])
    } catch (e) {
      console.error('[usuarios] load falhou:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) load()
    else setLoading(false)
  }, [isAdmin])

  useRealtime(isAdmin ? ['profiles'] : [], load)

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  function openNew() {
    setEditing(null)
    setForm(empty)
    setOpen(true)
  }

  function openEdit(p: Profile) {
    setEditing(p)
    setForm({
      nome: p.nome ?? '',
      email: p.email ?? '',
      password: '',
      role: p.role,
      evolution_instancia: p.evolution_instancia ?? '',
      evolution_api_key: p.evolution_api_key ?? '',
      evolution_webhook_url: p.evolution_webhook_url ?? '',
    })
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

    try {
      if (editing) {
        console.log('[usuarios] enviando update:', {
          id: editing.id,
          nome: form.nome.trim() || null,
          role: form.role,
        })
        const updatePromise = supabase
          .from('profiles')
          .update({
            nome: form.nome.trim() || null,
            role: form.role,
            evolution_instancia: form.evolution_instancia.trim() || null,
            evolution_api_key: form.evolution_api_key.trim() || null,
            evolution_webhook_url: form.evolution_webhook_url.trim() || null,
          })
          .eq('id', editing.id)
        const timeout = new Promise<{ error: { message: string } }>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de 15s na atualização')), 15000),
        )
        const { error } = (await Promise.race([updatePromise, timeout])) as Awaited<
          typeof updatePromise
        >
        console.log('[usuarios] update terminou', { error })
        if (error) {
          toast.error(error.message)
          return
        }
        toast.success('Perfil atualizado.')
        closeModal()
        load()
        return
      }

      // Criação via RPC SECURITY DEFINER — bypassa o rate limit do /signup público
      const { error } = await supabase.rpc('admin_create_user', {
        p_email: form.email,
        p_password: form.password,
        p_nome: form.nome.trim() || null,
        p_role: form.role,
        p_evolution_instancia: form.evolution_instancia.trim() || null,
        p_evolution_api_key: form.evolution_api_key.trim() || null,
        p_evolution_webhook_url: form.evolution_webhook_url.trim() || null,
      })
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(`Usuário ${form.nome.trim() || form.email} criado.`)
      closeModal()
      load()
    } catch (e) {
      console.error('[usuarios] save falhou:', e)
      toast.error('Falha inesperada ao salvar. Veja o console.')
    } finally {
      setSaving(false)
    }
  }

  async function changeRole(id: string, role: Role) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(`Role alterada para ${role.toUpperCase()}.`)
    load()
  }

  async function removeProfile(id: string, email: string | null) {
    const ok = await confirmDialog({
      title: 'Remover este usuário?',
      message: `${email ?? id} será apagado permanentemente: login, perfil, clientes e cobranças.`,
      confirmLabel: 'Remover',
      tone: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.rpc('admin_delete_user', { target_id: id })
    if (error) return toast.error(error.message)
    toast.success('Usuário removido completamente.')
    load()
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle="Gerencie quem tem acesso e qual papel cada um possui."
        actions={
          <Button onClick={openNew}>
            <Plus className="size-4" />
            Novo usuário
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={loading ? 'Carregando…' : 'Nenhum usuário'}
          hint={loading ? 'Buscando registros…' : "Clique em 'Novo usuário' para começar."}
        />
      ) : (
        <div className="border border-border rounded-lg bg-surface overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border bg-bg">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Usuário</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Role</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-3">Criado em</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((p) => {
                const isMe = p.id === session?.user?.id
                return (
                  <tr
                    key={p.id}
                    onClick={() => openEdit(p)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setCtxMenu({ id: p.id, x: e.clientX, y: e.clientY })
                    }}
                    className="row-hover border-b border-border-2 last:border-b-0 hover:bg-hover cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`size-8 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${
                            p.role === 'adm' ? 'bg-fg text-surface' : 'bg-hover text-fg-2'
                          }`}
                        >
                          {((p.nome || p.email) ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-fg truncate">{p.nome ?? p.email ?? '—'}</div>
                          <div className="text-xs text-fg-4 truncate">
                            {p.nome ? p.email : null}
                            {isMe && (
                              <span className="ml-1 text-[10px] text-fg-3">(você)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {p.role === 'adm' ? (
                        <Badge tone="neutral">
                          <ShieldCheck className="size-3 mr-1" />
                          ADM
                        </Badge>
                      ) : (
                        <Badge tone="mute">
                          <UserIcon className="size-3 mr-1" />
                          USER
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-3 tabular text-xs">
                      {isoToBR(p.created_at.slice(0, 10))}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setCtxMenu({ id: p.id, x: e.clientX, y: e.clientY + 10 })
                        }}
                        className="text-fg-4 hover:text-fg transition"
                        title="Ações"
                      >
                        <MoreVertical className="size-4" />
                      </button>
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
        title={editing ? 'Editar perfil' : 'Novo usuário'}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" form="form-novo-user" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving
                ? editing
                  ? 'Salvando…'
                  : 'Criando…'
                : editing
                  ? 'Salvar'
                  : 'Criar usuário'}
            </Button>
          </>
        }
      >
        <form id="form-novo-user" onSubmit={save} className="space-y-3">
          <Field label="Nome">
            <Input
              required
              autoComplete="off"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome completo"
            />
          </Field>
          <Field label="E-mail" hint={editing ? 'O e-mail não pode ser alterado por aqui.' : undefined}>
            <Input
              type="email"
              required
              autoComplete="off"
              readOnly={!!editing}
              disabled={!!editing}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="usuario@exemplo.com"
              className={editing ? 'opacity-60 cursor-not-allowed' : ''}
            />
          </Field>
          {!editing && (
            <Field label="Senha" hint="Mínimo 6 caracteres.">
              <PasswordInput
                required
                minLength={6}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
              />
            </Field>
          )}
          <Field
            label="Papel"
            hint={
              editing
                ? 'Você não pode rebaixar a si mesmo.'
                : 'O usuário normal vê apenas os próprios dados.'
            }
          >
            <Combo
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v as Role })}
              options={[
                {
                  value: 'user',
                  label: 'Usuário',
                  hint: editing?.id === session?.user?.id ? 'Você (não pode mudar)' : undefined,
                },
                { value: 'adm', label: 'Administrador' },
              ].filter(
                (o) => !(editing?.id === session?.user?.id && o.value === 'user'),
              )}
            />
          </Field>

          <div className="pt-4 mt-2 border-t border-border space-y-3">
            <div className="text-xs font-medium text-fg-2">Evolution / Webhook</div>
            <Field label="Instância" hint="Nome da instância na Evolution.">
              <Input
                autoComplete="off"
                value={form.evolution_instancia}
                onChange={(e) => setForm({ ...form, evolution_instancia: e.target.value })}
                placeholder="ex.: akira-prod"
              />
            </Field>
            <Field label="API key" hint="Token da instância. Fica oculto até clicar no olho.">
              <PasswordInput
                autoComplete="off"
                value={form.evolution_api_key}
                onChange={(e) => setForm({ ...form, evolution_api_key: e.target.value })}
                placeholder="UUID da instância"
              />
            </Field>
            <Field label="Webhook URL" hint="Endpoint do n8n que recebe as cobranças deste usuário.">
              <Input
                type="url"
                autoComplete="off"
                value={form.evolution_webhook_url}
                onChange={(e) => setForm({ ...form, evolution_webhook_url: e.target.value })}
                placeholder="https://n8n.exemplo.com/webhook/..."
              />
            </Field>
          </div>

          {editing && (
            <p className="text-xs text-fg-3 pt-2 border-t border-border">
              Para redefinir senha do usuário, use o painel do Supabase em{' '}
              <span className="font-mono">Authentication → Users</span>.
            </p>
          )}
        </form>
      </Modal>

      <ContextMenu
        open={ctxMenu !== null}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        onClose={() => setCtxMenu(null)}
        title="Ações do usuário"
        items={
          ctxMenu
            ? (() => {
                const p = rows.find((r) => r.id === ctxMenu.id)
                if (!p) return []
                const isMe = p.id === session?.user?.id
                const opts: ContextMenuItem[] = [
                  {
                    label: 'Editar perfil',
                    icon: Pencil,
                    onClick: () => openEdit(p),
                  },
                  { divider: true, label: '', onClick: () => {} },
                  {
                    label: 'Tornar Administrador',
                    icon: ShieldCheck,
                    disabled: p.role === 'adm',
                    onClick: () => changeRole(p.id, 'adm'),
                  },
                  {
                    label: 'Tornar Usuário',
                    icon: UserIcon,
                    disabled: p.role === 'user' || isMe,
                    onClick: () => changeRole(p.id, 'user'),
                  },
                  { divider: true, label: '', onClick: () => {} },
                  {
                    label: 'Remover perfil',
                    icon: Trash2,
                    danger: true,
                    disabled: isMe,
                    onClick: () => removeProfile(p.id, p.email),
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
