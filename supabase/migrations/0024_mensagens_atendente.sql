-- ============================================================================
-- mensagens_atendente
-- ============================================================================
-- Quando a flag 'block' do fluxo n8n redireciona pro atendente humano,
-- o n8n grava nesta tabela em vez do n8n_chat_histories. A página /mensagens
-- mescla as duas fontes na mesma thread, ordenadas por hora.
-- ============================================================================

create table if not exists public.mensagens_atendente (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  instancia           text,
  numero              text,                 -- destinatário (só dígitos)
  mensagem            text,                 -- conteúdo de texto
  base64              text,                 -- mídia em base64 (opcional)
  id_mensagem         text,                 -- id retornado pela Evolution
  hora_last_message   timestamptz not null default now(),
  type                text default 'text',  -- text | image | audio | video | document
  nome                text,                 -- nome do atendente que enviou
  created_at          timestamptz not null default now()
);

create index if not exists mens_atend_user_idx       on public.mensagens_atendente (user_id);
create index if not exists mens_atend_numero_idx     on public.mensagens_atendente (numero);
create index if not exists mens_atend_instancia_idx  on public.mensagens_atendente (instancia);
create index if not exists mens_atend_hora_idx       on public.mensagens_atendente (hora_last_message desc);
create unique index if not exists mens_atend_msg_unique
  on public.mensagens_atendente (instancia, id_mensagem)
  where id_mensagem is not null;

-- ----------------------------------------------------------------------------
-- Trigger: se user_id vier nulo, descobre pela instancia (igual mensagens)
-- ----------------------------------------------------------------------------
create or replace function public.mens_atend_fill_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  guess_user uuid;
begin
  if new.user_id is null and new.instancia is not null then
    select id into guess_user
    from public.profiles
    where evolution_instancia = new.instancia
    limit 1;
    if guess_user is not null then
      new.user_id := guess_user;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mens_atend_fill_user on public.mensagens_atendente;
create trigger trg_mens_atend_fill_user
  before insert on public.mensagens_atendente
  for each row execute function public.mens_atend_fill_user();

-- ----------------------------------------------------------------------------
-- RLS isolada por user_id
-- ----------------------------------------------------------------------------
alter table public.mensagens_atendente enable row level security;

drop policy if exists "mensagens_atendente own only" on public.mensagens_atendente;
create policy "mensagens_atendente own only" on public.mensagens_atendente
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='mensagens_atendente'
  ) then alter publication supabase_realtime add table public.mensagens_atendente; end if;
end$$;

notify pgrst, 'reload schema';
