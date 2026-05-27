-- Simplifica leitura de profiles para evitar comportamento inesperado da função is_admin()
-- em policies SELECT da própria tabela profiles.
-- A UI já restringe quem vê a tela de Usuários (rota só renderiza para admin).
-- Update/Delete continuam restritos a admin.

drop policy if exists "profiles read" on public.profiles;

create policy "profiles read" on public.profiles
  for select to authenticated
  using (true);
