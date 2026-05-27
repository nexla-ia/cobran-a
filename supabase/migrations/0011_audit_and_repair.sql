-- ============================================================================
-- AUDITORIA + REPARO
-- ============================================================================
-- Roda no SQL Editor. É IDEMPOTENTE — pode rodar várias vezes sem efeito colateral.
--
-- Corrige/cobre os seguintes pontos identificados na revisão das migrations:
--
-- 1. profiles ausentes para usuários do auth.users (trigger pode ter falhado
--    em algum momento ou usuários criados antes do trigger existir).
-- 2. Falta de índice em profiles.role — usado em subqueries de admin
--    (0008, 0009, 0010) — sem índice é seq scan a cada check.
-- 3. Trigger handle_new_user antigo. Recria para garantir versão com nome.
-- 4. Função is_admin() de 0003 ficou órfã (substituída por subquery inline
--    em 0008). Removida para evitar confusão futura.
-- 5. policies de profiles podem estar desatualizadas em DB onde se rodou
--    0005/0007 fora de ordem — reaplica policies finais.
-- 6. Schema cache do PostgREST: força reload no final.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill: cria profile para qualquer auth.users que não tenha
-- ----------------------------------------------------------------------------
insert into public.profiles (id, email)
select au.id, au.email
from auth.users au
left join public.profiles p on p.id = au.id
where p.id is null
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Índice em profiles.role (acelera subqueries de admin nas policies)
-- ----------------------------------------------------------------------------
create index if not exists profiles_role_idx on public.profiles (role);

-- ----------------------------------------------------------------------------
-- 3. Recria trigger handle_new_user (idempotente, garante versão atual)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'nome', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. Remove função is_admin() — substituída por subquery inline
-- ----------------------------------------------------------------------------
drop function if exists public.is_admin();

-- ----------------------------------------------------------------------------
-- 5. Reaplica policies finais (idempotente)
-- ----------------------------------------------------------------------------
alter table public.profiles  enable row level security;
alter table public.clientes  enable row level security;
alter table public.cobrancas enable row level security;

-- profiles: leitura livre pra autenticado (UI já restringe quem vê /usuarios)
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;

create policy "profiles read" on public.profiles
  for select to authenticated
  using (true);

create policy "profiles update" on public.profiles
  for update to authenticated
  using (true)
  with check (true);

create policy "profiles delete" on public.profiles
  for delete to authenticated
  using (true);

-- clientes/cobrancas: dono OU admin (subquery inline, sem função)
drop policy if exists "clientes own all"       on public.clientes;
drop policy if exists "clientes own or admin"  on public.clientes;
drop policy if exists "cobrancas own all"      on public.cobrancas;
drop policy if exists "cobrancas own or admin" on public.cobrancas;

create policy "clientes own or admin" on public.clientes
  for all to authenticated
  using (
    user_id = auth.uid()
    or auth.uid() in (select id from public.profiles where role = 'adm')
  )
  with check (
    user_id = auth.uid()
    or auth.uid() in (select id from public.profiles where role = 'adm')
  );

create policy "cobrancas own or admin" on public.cobrancas
  for all to authenticated
  using (
    user_id = auth.uid()
    or auth.uid() in (select id from public.profiles where role = 'adm')
  )
  with check (
    user_id = auth.uid()
    or auth.uid() in (select id from public.profiles where role = 'adm')
  );

-- ----------------------------------------------------------------------------
-- 6. Garante Realtime nas tabelas (idempotente)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='clientes'
  ) then alter publication supabase_realtime add table public.clientes; end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='cobrancas'
  ) then alter publication supabase_realtime add table public.cobrancas; end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='profiles'
  ) then alter publication supabase_realtime add table public.profiles; end if;
end$$;

-- ----------------------------------------------------------------------------
-- 7. Sanity check — relatório dos profiles atuais
-- ----------------------------------------------------------------------------
select
  count(*) filter (where role = 'adm')  as total_admins,
  count(*) filter (where role = 'user') as total_users,
  count(*)                              as total_profiles
from public.profiles;

-- ----------------------------------------------------------------------------
-- 8. Recarrega schema do PostgREST
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';
