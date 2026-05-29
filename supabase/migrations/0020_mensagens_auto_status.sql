-- AFTER INSERT em mensagens → cria automaticamente mensagem_status('enviado').
-- Assim o n8n faz só 1 INSERT (em mensagens) e a linha de status sai sozinha.

create or replace function public.mensagens_create_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.mensagem_status (mensagem_id, user_id, status)
  values (new.id, new.user_id, 'enviado')
  on conflict (mensagem_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_mensagens_create_status on public.mensagens;
create trigger trg_mensagens_create_status
  after insert on public.mensagens
  for each row execute function public.mensagens_create_status();
