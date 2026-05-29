-- ============================================================================
-- TRIGGERS pra auto-preencher user_id / cliente_id em mensagens
-- ============================================================================
-- Permite o n8n inserir só com (instancia, message_id, telefone, conteudo).
-- O trigger resolve:
--   - user_id pela instancia (lookup em profiles)
--   - cliente_id pelo telefone (lookup em clientes do mesmo user, com/sem 9)
-- ============================================================================

create or replace function public.mensagens_fill_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  guess_user uuid;
  digits_in text;
begin
  if new.user_id is null and new.instancia is not null then
    select id into guess_user
    from public.profiles
    where evolution_instancia = new.instancia
    limit 1;
    if guess_user is not null then
      new.user_id := guess_user;
    end if;
  end if;

  if new.cliente_id is null and new.telefone is not null and new.user_id is not null then
    digits_in := regexp_replace(new.telefone, '\D', '', 'g');
    select id into new.cliente_id
    from public.clientes
    where user_id = new.user_id
      and telefone is not null
      and (
        regexp_replace(telefone, '\D', '', 'g') = digits_in
        or (length(digits_in) = 13 and substring(digits_in, 1, 4) || substring(digits_in, 6) = regexp_replace(telefone, '\D', '', 'g'))
        or (length(digits_in) = 12 and digits_in = regexp_replace(telefone, '\D', '', 'g'))
      )
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mensagens_fill_refs on public.mensagens;
create trigger trg_mensagens_fill_refs
  before insert on public.mensagens
  for each row execute function public.mensagens_fill_refs();

create or replace function public.mensagem_status_fill_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null and new.mensagem_id is not null then
    select user_id into new.user_id
    from public.mensagens
    where id = new.mensagem_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mensagem_status_fill_user on public.mensagem_status;
create trigger trg_mensagem_status_fill_user
  before insert on public.mensagem_status
  for each row execute function public.mensagem_status_fill_user();

notify pgrst, 'reload schema';
