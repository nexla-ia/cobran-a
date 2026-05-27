-- Cria usuário direto em auth.users via SECURITY DEFINER.
-- Bypassa o /auth/v1/signup público (que tem rate limit no plano free do Supabase).
-- Apenas admin pode chamar.

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_nome text default null,
  p_role text default 'user'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  new_user_id uuid;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'adm'
  ) then
    raise exception 'Não autorizado';
  end if;

  if p_role not in ('user', 'adm') then
    raise exception 'Role inválida (use user ou adm)';
  end if;

  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Senha deve ter pelo menos 6 caracteres';
  end if;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'E-mail já cadastrado';
  end if;

  new_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    p_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    case
      when p_nome is not null and length(trim(p_nome)) > 0
      then jsonb_build_object('nome', trim(p_nome))
      else '{}'::jsonb
    end,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  -- O trigger handle_new_user criou o profile. Garante nome/role:
  update public.profiles
  set
    nome = nullif(trim(coalesce(p_nome, '')), ''),
    role = p_role
  where id = new_user_id;

  return new_user_id;
end;
$$;

revoke all on function public.admin_create_user(text, text, text, text) from public;
grant execute on function public.admin_create_user(text, text, text, text) to authenticated;
