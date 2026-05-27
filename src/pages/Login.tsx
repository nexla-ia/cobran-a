import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { CircleDollarSign, Loader2, LogIn } from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/supabase'
import { signIn, useAuth } from '@/lib/auth'
import { Button, Field, Input, PasswordInput } from '@/components/ui'
import { toast } from '@/lib/dialogs'

export default function Login() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) return null
  if (session) {
    const next = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={next} replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isSupabaseConfigured) {
      toast.error('Supabase não configurado. Preencha .env primeiro.')
      return
    }
    setSubmitting(true)
    try {
      const { error } = await signIn(email, password)
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success('Bem-vindo de volta.')
    } catch (e) {
      console.error('[login] erro inesperado:', e)
      toast.error('Falha inesperada no login.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center px-4 py-10 bg-bg">
      <div
        className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-sm p-8"
        style={{ animation: 'scale-in 280ms cubic-bezier(0.22,1,0.36,1) both' }}
      >
        <div className="flex flex-col items-center mb-6">
          <div className="size-11 rounded-xl bg-fg text-surface grid place-items-center mb-3">
            <CircleDollarSign className="size-6" />
          </div>
          <h1 className="text-xl font-semibold text-fg">Cobrança</h1>
          <p className="text-sm text-fg-3 mt-1">Entre para acessar o painel.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="E-mail">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
              autoFocus
            />
          </Field>
          <Field label="Senha">
            <PasswordInput
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <Button type="submit" disabled={submitting} className="w-full justify-center mt-2 h-10">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            Entrar
          </Button>

          {!isSupabaseConfigured && (
            <p className="mt-3 text-xs text-fg-3 text-center leading-relaxed">
              Supabase não está configurado. Preencha <code className="font-mono">.env</code> com as
              chaves do projeto.
            </p>
          )}
        </form>

        <p className="text-[11px] text-fg-4 text-center mt-6 leading-relaxed">
          Acesso restrito. Contas são criadas pelo administrador no painel do Supabase.
        </p>
      </div>
    </div>
  )
}
