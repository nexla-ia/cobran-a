-- Permite admin remover usuário inteiro (auth.users + profiles + cobranças via cascade).
-- Usa SECURITY DEFINER pra rodar como o dono do schema (postgres) e ter acesso a auth.users.

create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Verifica se quem chamou é admin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'adm'
  ) then
    raise exception 'Não autorizado';
  end if;

  -- Impede admin de deletar a si mesmo (sem isso ficaria sem ninguém)
  if target_id = auth.uid() then
    raise exception 'Você não pode remover a si mesmo';
  end if;

  -- Deleta do auth.users — cascateia para profiles, clientes, cobrancas
  -- (todos os FKs foram criados com ON DELETE CASCADE)
  delete from auth.users where id = target_id;
end;
$$;

-- Apenas usuários autenticados podem chamar (a função internamente valida se é admin)
revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;
