-- Copia instancia/chave_api/message_id pra dentro de mensagem_status pra
-- simplificar o flow do n8n (não precisa joinar com mensagens nem usar view).
-- O trigger preenche automaticamente no INSERT.

alter table public.mensagem_status
  add column if not exists instancia  text,
  add column if not exists chave_api  text,
  add column if not exists message_id text;

create or replace function public.mensagens_create_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.mensagem_status (
    mensagem_id, user_id, status, instancia, chave_api, message_id
  )
  values (
    new.id, new.user_id, 'enviado', new.instancia, new.chave_api, new.message_id
  )
  on conflict (mensagem_id) do nothing;
  return new;
end;
$$;

-- Backfill das linhas já existentes
update public.mensagem_status ms
set
  instancia  = m.instancia,
  chave_api  = m.chave_api,
  message_id = m.message_id
from public.mensagens m
where ms.mensagem_id = m.id
  and (ms.instancia is null or ms.chave_api is null or ms.message_id is null);

notify pgrst, 'reload schema';
