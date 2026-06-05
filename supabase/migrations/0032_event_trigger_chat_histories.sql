-- ============================================================================
-- AUTO-SETUP de novas tabelas LangChain criadas pelo n8n
-- ============================================================================
-- Quando o n8n cria uma tabela `n8n_chat_histories_<algo>`, esse event
-- trigger faz dois ajustes automáticos:
--   1. Adiciona coluna `created_at timestamptz default now()` — sem isso
--      o app /mensagens não consegue ordenar mensagens por hora
--   2. Adiciona à publication do Realtime — pra atualizações em tempo real
--      sem depender só do polling
--
-- ⚠️ Event triggers exigem superuser. No Supabase cloud o SQL Editor já
--    roda como postgres, então funciona.
-- ============================================================================

create or replace function public.setup_chat_history_table()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() loop
    if obj.object_type = 'table'
       and obj.schema_name = 'public'
       and obj.object_identity like 'public.n8n_chat_histories_%' then

      execute format(
        'alter table %s add column if not exists created_at timestamptz not null default now()',
        obj.object_identity
      );

      begin
        execute format('alter publication supabase_realtime add table %s', obj.object_identity);
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;

drop event trigger if exists trg_setup_chat_history;

create event trigger trg_setup_chat_history
on ddl_command_end
when tag in ('CREATE TABLE')
execute function public.setup_chat_history_table();
