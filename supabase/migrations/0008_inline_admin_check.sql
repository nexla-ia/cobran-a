-- Remove a função is_admin() das policies de clientes/cobrancas e inline o check.
-- A função SECURITY DEFINER + Realtime publication + Postgres internal locks estava
-- causando UPDATEs/SELECTs travarem em ambientes Supabase.

drop policy if exists "clientes own or admin"  on public.clientes;
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
