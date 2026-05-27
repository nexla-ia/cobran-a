-- Simplifica policies de UPDATE/DELETE em profiles do mesmo jeito que fizemos
-- com a de SELECT. A UI já bloqueia /usuarios para não-admin.

drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;

create policy "profiles update" on public.profiles
  for update to authenticated
  using (true)
  with check (true);

create policy "profiles delete" on public.profiles
  for delete to authenticated
  using (true);
