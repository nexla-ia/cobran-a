-- View que entrega ao n8n tudo que ele precisa pra chamar /chat/findMessages:
-- instancia, chave_api, message_id, telefone — já filtrada pras mensagens
-- que ainda podem mudar de status nas últimas 24h.

create or replace view public.mensagens_para_verificar as
select
  m.id           as mensagem_id,
  m.user_id,
  m.instancia,
  m.chave_api,
  m.message_id,
  m.telefone,
  m.conteudo,
  ms.status      as status_atual,
  m.enviado_em
from public.mensagens m
join public.mensagem_status ms on ms.mensagem_id = m.id
where
  m.message_id is not null
  and ms.status in ('enviado', 'entregue')
  and m.enviado_em >= now() - interval '24 hours'
;

grant select on public.mensagens_para_verificar to authenticated;
