-- ============================================================================
-- ISOLAMENTO TOTAL POR USUÁRIO
-- ============================================================================
-- Remove o bypass de admin nas tabelas clientes/cobrancas.
-- Cada conta passa a ver/editar EXCLUSIVAMENTE os próprios registros.
--
-- Role 'adm' continua existindo e tem poder apenas sobre profiles
-- (criar/remover usuários via UI /usuarios). Não vaza dados de cobrança.
-- ============================================================================

alter table public.clientes  enable row level security;
alter table public.cobrancas enable row level security;

drop policy if exists "clientes own all"       on public.clientes;
drop policy if exists "clientes own or admin"  on public.clientes;
drop policy if exists "cobrancas own all"      on public.cobrancas;
drop policy if exists "cobrancas own or admin" on public.cobrancas;

create policy "clientes own only" on public.clientes
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "cobrancas own only" on public.cobrancas
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Unique de documento passa a ser POR USUÁRIO, não global.
-- Antes: duas contas não podiam cadastrar o mesmo CPF/CNPJ.
-- Agora: cada conta tem seu próprio espaço de documentos.
-- ----------------------------------------------------------------------------
drop index if exists public.clientes_documento_key;
create unique index if not exists clientes_user_documento_key
  on public.clientes (user_id, documento);

notify pgrst, 'reload schema';
