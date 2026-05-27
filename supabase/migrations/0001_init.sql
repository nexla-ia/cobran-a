-- Schema inicial do SaaS de cobrança
-- Rode no SQL Editor do Supabase, ou via `supabase db push`.

create extension if not exists "pgcrypto";

-- Clientes unificados: PF ou PJ, com endereço embutido.
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pf', 'pj')),
  documento text not null,           -- CPF (PF) ou CNPJ (PJ)
  nome text not null,                -- nome (PF) ou razão social (PJ)
  nome_fantasia text,                -- apenas PJ
  email text,
  telefone text,
  -- endereço
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  created_at timestamptz not null default now()
);
create unique index if not exists clientes_documento_key on public.clientes (documento);
create index if not exists clientes_tipo_idx on public.clientes (tipo);

-- Cobranças vinculadas a clientes.
create table if not exists public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  descricao text not null,
  valor numeric(12, 2) not null check (valor >= 0),
  vencimento date not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'pago', 'atrasado', 'cancelado')),
  pago_em date,
  created_at timestamptz not null default now()
);
create index if not exists cobrancas_cliente_idx on public.cobrancas (cliente_id);
create index if not exists cobrancas_status_idx on public.cobrancas (status);
create index if not exists cobrancas_vencimento_idx on public.cobrancas (vencimento);

-- RLS: por enquanto liberado para anon (sem auth nesta fase).
alter table public.clientes  enable row level security;
alter table public.cobrancas enable row level security;

drop policy if exists "clientes anon all"  on public.clientes;
drop policy if exists "cobrancas anon all" on public.cobrancas;

create policy "clientes anon all"  on public.clientes  for all to anon using (true) with check (true);
create policy "cobrancas anon all" on public.cobrancas for all to anon using (true) with check (true);
