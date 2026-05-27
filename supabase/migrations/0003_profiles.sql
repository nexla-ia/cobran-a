-- Profiles + roles (user / adm). Rode no SQL Editor APÓS o 0002_auth.sql.

-- 1. Tabela de perfis (1:1 com auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'adm')),
  created_at timestamptz not null default now()
);

-- 2. Trigger: ao criar um auth.user, gera profile automaticamente com role='user'
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: cria profiles para usuários já existentes
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- 3. Helper: is_admin() — verifica role do usuário logado
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'adm'
  );
$$;

-- 4. RLS de profiles
alter table public.profiles enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;

-- Qualquer autenticado lê seu próprio perfil; admin lê todos
create policy "profiles read" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Só admin atualiza perfis
create policy "profiles update" on public.profiles
  for update to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

-- Só admin deleta perfis
create policy "profiles delete" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- 5. Atualiza policies de clientes/cobrancas para admin ver tudo
drop policy if exists "clientes own all"  on public.clientes;
drop policy if exists "cobrancas own all" on public.cobrancas;

create policy "clientes own or admin" on public.clientes
  for all to authenticated
  using  (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "cobrancas own or admin" on public.cobrancas
  for all to authenticated
  using  (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
