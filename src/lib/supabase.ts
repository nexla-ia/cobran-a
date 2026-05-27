import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anon) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes. Copie .env.example para .env e preencha.',
  )
}

export const supabase = createClient<Database>(
  url ?? 'http://localhost',
  anon ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

export const isSupabaseConfigured = Boolean(url && anon)

// Marca como "atrasado" toda cobrança ainda "pendente" cujo vencimento já passou.
// Executado on-demand (no load das páginas) por ser o suficiente em uma SPA single-user.
// Em produção com múltiplos usuários, mover para um cron / edge function.
export async function syncOverdueCobrancas() {
  if (!isSupabaseConfigured) return
  const today = new Date().toISOString().slice(0, 10)
  await supabase
    .from('cobrancas')
    .update({ status: 'atrasado' })
    .eq('status', 'pendente')
    .lt('vencimento', today)
}
