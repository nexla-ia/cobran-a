-- Adiciona chave_api em envios pra ter TUDO em uma linha só.
-- Assim o n8n insere/lê tudo de envios, sem precisar consultar profiles.

alter table public.envios
  add column if not exists chave_api text;

create index if not exists envios_chave_api_idx on public.envios (chave_api);

notify pgrst, 'reload schema';
