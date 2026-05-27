-- Multi-tenant: cada usuário só vê os próprios dados.
-- Rode no SQL Editor do Supabase APÓS o 0001_init.sql.

-- 1. Colunas user_id em ambas as tabelas, com default auth.uid()
alter table public.clientes
  add column if not exists user_id uuid references auth.users(id) on delete cascade
  default auth.uid();

alter table public.cobrancas
  add column if not exists user_id uuid references auth.users(id) on delete cascade
  default auth.uid();

-- 2. Índices para filtros
create index if not exists clientes_user_idx  on public.clientes  (user_id);
create index if not exists cobrancas_user_idx on public.cobrancas (user_id);

-- 3. Remove policies abertas antigas
drop policy if exists "clientes anon all"  on public.clientes;
drop policy if exists "cobrancas anon all" on public.cobrancas;

-- 4. Garantir RLS ativo
alter table public.clientes  enable row level security;
alter table public.cobrancas enable row level security;

-- 5. Policies: usuário autenticado vê/edita/insere/deleta apenas seus próprios registros
create policy "clientes own all" on public.clientes
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "cobrancas own all" on public.cobrancas
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
