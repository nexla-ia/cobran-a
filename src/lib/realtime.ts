import { useEffect, useRef } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

/**
 * Assina mudanças em uma ou mais tabelas e chama `onChange` a cada evento.
 * O callback pode mudar a cada render — usamos ref pra sempre executar a versão mais recente
 * sem precisar derrubar e recriar o channel.
 */
export function useRealtime(tables: string[], onChange: () => void) {
  const cbRef = useRef(onChange)
  useEffect(() => {
    cbRef.current = onChange
  }, [onChange])

  const key = tables.slice().sort().join(',')

  useEffect(() => {
    if (!isSupabaseConfigured || tables.length === 0) return
    const channel = supabase.channel(`watch:${key}`)
    for (const table of tables) {
      channel.on(
        // @ts-ignore — postgres_changes não tem types completos
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          cbRef.current()
        },
      )
    }
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
