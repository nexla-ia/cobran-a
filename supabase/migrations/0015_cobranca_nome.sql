-- Adiciona campo "nome" na cobrança (título curto, separado da descrição).
-- Linhas existentes ficam com nome NULL — o front mostra "—" e a busca
-- continua funcionando pela descrição/cliente.

alter table public.cobrancas
  add column if not exists nome text;

create index if not exists cobrancas_nome_idx on public.cobrancas (nome);

notify pgrst, 'reload schema';
