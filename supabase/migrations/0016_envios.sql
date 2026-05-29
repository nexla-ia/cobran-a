-- ============================================================================
-- HISTÓRICO DE ENVIOS (1 linha por mensagem)
-- ============================================================================
-- Fluxo:
--   1. n8n recebe pedido de disparo, chama Evolution, captura message_id e
--      INSERT em envios com status='enviado'.
--   2. Webhook 'messages.update' da Evolution dispara um fluxo no n8n que faz
--      UPDATE em envios casando pelo message_id (e instancia, pra evitar
--      colisão entre tenants).
--
-- Isolamento total: cada user_id só vê os próprios envios (sem bypass admin).
-- ============================================================================

create table if not exists public.envios (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  cobranca_id   uuid references public.cobrancas(id) on delete set null,
  cliente_id    uuid references public.clientes(id)  on delete set null,
  message_id    text,                       -- ID retornado pela Evolution (chave de update)
  instancia     text,                       -- nome da instância usada
  telefone      text,                       -- destino (só dígitos)
  conteudo      text,                       -- texto enviado (opcional)
  status        text not null default 'enviado'
                check (status in ('enviado','entregue','lido','falha')),
  erro          text,                       -- mensagem de erro quando status='falha'
  enviado_em    timestamptz not null default now(),
  entregue_em   timestamptz,
  lido_em       timestamptz,
  falhou_em     timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists envios_user_idx       on public.envios (user_id);
create index if not exists envios_cobranca_idx   on public.envios (cobranca_id);
create index if not exists envios_cliente_idx    on public.envios (cliente_id);
create index if not exists envios_status_idx     on public.envios (status);
create index if not exists envios_enviado_em_idx on public.envios (enviado_em desc);

-- Composto: usado no UPDATE do webhook (match por message_id + instancia).
create unique index if not exists envios_msg_unique
  on public.envios (instancia, message_id)
  where message_id is not null;

-- ----------------------------------------------------------------------------
-- RLS — isolamento por usuário (mesma política de clientes/cobrancas)
-- ----------------------------------------------------------------------------
alter table public.envios enable row level security;

drop policy if exists "envios own only" on public.envios;
create policy "envios own only" on public.envios
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime (UI atualiza sem refresh quando o webhook gravar o ack/read)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='envios'
  ) then alter publication supabase_realtime add table public.envios; end if;
end$$;

notify pgrst, 'reload schema';
