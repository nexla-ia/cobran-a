-- ============================================================================
-- MENSAGENS + STATUS (esquema simples, duas tabelas ligadas)
-- ============================================================================
-- mensagens        → dados pra disparar/identificar (insert no momento do envio)
-- mensagem_status  → 1 linha por mensagem com o status atual (update via cron/botão)
-- ============================================================================

create table if not exists public.mensagens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  cliente_id  uuid references public.clientes(id) on delete set null,
  instancia   text,
  chave_api   text,
  message_id  text,
  telefone    text,
  conteudo    text,
  enviado_em  timestamptz not null default now()
);

create index if not exists mensagens_user_idx       on public.mensagens (user_id);
create index if not exists mensagens_cliente_idx    on public.mensagens (cliente_id);
create index if not exists mensagens_enviado_em_idx on public.mensagens (enviado_em desc);
create unique index if not exists mensagens_msg_unique
  on public.mensagens (instancia, message_id)
  where message_id is not null;

create table if not exists public.mensagem_status (
  id             uuid primary key default gen_random_uuid(),
  mensagem_id    uuid not null unique references public.mensagens(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  status         text not null default 'enviado'
                 check (status in ('enviado','entregue','lido','falha')),
  erro           text,
  entregue_em    timestamptz,
  lido_em        timestamptz,
  falhou_em      timestamptz,
  atualizado_em  timestamptz not null default now()
);

create index if not exists mensagem_status_user_idx   on public.mensagem_status (user_id);
create index if not exists mensagem_status_status_idx on public.mensagem_status (status);

-- ----------------------------------------------------------------------------
-- RLS — isolamento por usuário
-- ----------------------------------------------------------------------------
alter table public.mensagens       enable row level security;
alter table public.mensagem_status enable row level security;

drop policy if exists "mensagens own only" on public.mensagens;
create policy "mensagens own only" on public.mensagens
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "mensagem_status own only" on public.mensagem_status;
create policy "mensagem_status own only" on public.mensagem_status
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime — UI atualiza ao vivo quando o status muda
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='mensagens'
  ) then alter publication supabase_realtime add table public.mensagens; end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='mensagem_status'
  ) then alter publication supabase_realtime add table public.mensagem_status; end if;
end$$;

notify pgrst, 'reload schema';
