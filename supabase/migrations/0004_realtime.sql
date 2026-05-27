-- Habilita Realtime nas tabelas principais.
-- Rode no SQL Editor (idempotente — pode rodar várias vezes).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clientes'
  ) then
    alter publication supabase_realtime add table public.clientes;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cobrancas'
  ) then
    alter publication supabase_realtime add table public.cobrancas;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end$$;
