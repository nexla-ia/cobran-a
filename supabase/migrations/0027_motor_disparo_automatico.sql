-- ============================================================================
-- MOTOR DE DISPARO AUTOMÁTICO
-- ============================================================================
-- Usa pg_cron (agendamento) + pg_net (HTTP) pra disparar o webhook do n8n
-- a cada 5 minutos. Lê cobrancas_para_disparar (já filtrada por hora/dia/
-- frequência), monta o mesmo payload que o front envia em "Enviar todos",
-- chama o webhook e marca como enviada.
--
-- ⚠️  Pré-requisito (uma vez): habilitar as extensões no Supabase Dashboard
--    em Database → Extensions:  pg_cron  e  pg_net
--    (esta migration tenta criar mas pode precisar de superuser).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- 1) Ajusta a view pra usar fuso horário do Brasil (America/Sao_Paulo).
--    Antes ela usava current_time/now() em UTC, fazendo horario 09:00 BR
--    virar 12:00 UTC no banco.
--    DROP + CREATE porque mudamos a lista/ordem de colunas
--    (CREATE OR REPLACE VIEW não aceita mudança de colunas).
-- ----------------------------------------------------------------------------
drop view if exists public.cobrancas_para_disparar;

create view public.cobrancas_para_disparar as
with regras as (
  select
    c.id                                                                as cobranca_id,
    c.user_id,
    c.cliente_id,
    c.nome                                                              as cobranca_nome,
    c.descricao,
    c.valor,
    c.vencimento,
    c.status,
    coalesce(c.envios_por_dia_ovr,         p.envios_por_dia)            as envios_por_dia,
    coalesce(c.intervalo_envios_horas_ovr, p.intervalo_envios_horas)    as intervalo_horas,
    coalesce(c.automacao_ativa_ovr,        p.automacao_ativa)           as automacao_ativa,
    p.horario_inicio,
    p.horario_fim,
    p.dias_semana,
    p.evolution_instancia,
    p.evolution_api_key,
    c.ultimo_envio_em,
    c.envios_hoje,
    case when (c.ultimo_envio_em at time zone 'America/Sao_Paulo')::date
              = (now() at time zone 'America/Sao_Paulo')::date
         then c.envios_hoje else 0 end                                  as envios_hoje_efetivo,
    cli.nome     as cliente_nome,
    cli.telefone as cliente_telefone,
    cli.email    as cliente_email,
    cli.documento as cliente_documento,
    cli.tipo      as cliente_tipo
  from public.cobrancas c
  join public.profiles  p on p.id = c.user_id
  left join public.clientes cli on cli.id = c.cliente_id
)
select *
from regras
where automacao_ativa = true
  and status in ('pendente', 'atrasado')
  and (now() at time zone 'America/Sao_Paulo')::time between horario_inicio and horario_fim
  and extract(dow from (now() at time zone 'America/Sao_Paulo'))::int = any(dias_semana)
  and envios_hoje_efetivo < envios_por_dia
  and (ultimo_envio_em is null
       or ultimo_envio_em + (intervalo_horas || ' hours')::interval <= now());

grant select on public.cobrancas_para_disparar to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Função MOTOR: lê a view, chama webhook pra cada cobrança e marca enviada.
-- ----------------------------------------------------------------------------
create or replace function public.processar_disparos_automaticos()
returns integer
language plpgsql
security definer
set search_path = public, net
as $$
declare
  rec record;
  payload jsonb;
  webhook_url text := 'https://n8n.nexladesenvolvimento.com.br/webhook/cobrancanexla';
  enviadas integer := 0;
begin
  -- A) cancelamentos automáticos (cobranças muito antigas)
  perform public.processar_cancelamentos_vencidos();

  -- B) itera as cobranças prontas pra disparar AGORA
  for rec in
    select * from public.cobrancas_para_disparar
  loop
    -- Monta o mesmo payload que o front envia em "Enviar todos"
    payload := jsonb_build_object(
      'meta', jsonb_build_object(
        'total_clientes',      1,
        'total_cobrancas',     1,
        'enviado_em',          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'origem',              'cobranca-saas-cron',
        'user_id',             rec.user_id,
        'evolution_instancia', rec.evolution_instancia,
        'evolution_api_key',   rec.evolution_api_key
      ),
      'itens', jsonb_build_array(
        jsonb_build_object(
          'cliente', jsonb_build_object(
            'nome',     rec.cliente_nome,
            'telefone', regexp_replace(coalesce(rec.cliente_telefone, ''), '\D', '', 'g'),
            (case when rec.cliente_tipo = 'pj' then 'cnpj' else 'cpf' end),
                        rec.cliente_documento,
            'email',    rec.cliente_email
          ),
          'cobrancas', jsonb_build_array(
            jsonb_build_object(
              'cliente',    rec.cliente_nome,
              'nome',       rec.cobranca_nome,
              'descricao',  rec.descricao,
              'valor',      'R$ ' || replace(to_char(rec.valor, 'FM999G999G990D00'), '.', ','),
              'status',     rec.status,
              'vencimento', to_char(rec.vencimento, 'DD/MM/YYYY')
            )
          )
        )
      )
    );

    -- C) dispara HTTP POST assíncrono (não bloqueia)
    perform net.http_post(
      url     := webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := payload
    );

    -- D) marca como enviada (incrementa contadores)
    perform public.marcar_cobranca_enviada(rec.cobranca_id);

    enviadas := enviadas + 1;
  end loop;

  return enviadas;
end;
$$;

grant execute on function public.processar_disparos_automaticos() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Agendamento: roda a cada 5 minutos.
--    Remove agendamento anterior antes (caso já exista) pra ser idempotente.
-- ----------------------------------------------------------------------------
do $$
begin
  -- Tenta desagendar (silencioso se não existir)
  perform cron.unschedule('cobrancas-disparar');
exception
  when others then null;
end$$;

select cron.schedule(
  'cobrancas-disparar',
  '*/5 * * * *',
  $$select public.processar_disparos_automaticos()$$
);

-- ----------------------------------------------------------------------------
-- 4) Função auxiliar pra disparar UMA cobrança agora (botão "Forçar envio")
-- ----------------------------------------------------------------------------
create or replace function public.disparar_cobranca_agora(p_cobranca_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, net
as $$
declare
  rec record;
  payload jsonb;
  webhook_url text := 'https://n8n.nexladesenvolvimento.com.br/webhook/cobrancanexla';
begin
  select
    c.id as cobranca_id, c.nome as cobranca_nome, c.descricao, c.valor,
    c.vencimento, c.status, c.user_id,
    p.evolution_instancia, p.evolution_api_key,
    cli.nome as cliente_nome, cli.telefone as cliente_telefone,
    cli.email as cliente_email, cli.documento as cliente_documento, cli.tipo as cliente_tipo
  into rec
  from public.cobrancas c
  join public.profiles  p on p.id = c.user_id
  left join public.clientes cli on cli.id = c.cliente_id
  where c.id = p_cobranca_id
    and c.user_id = auth.uid();      -- só pode disparar cobrança própria

  if not found then
    return false;
  end if;

  payload := jsonb_build_object(
    'meta', jsonb_build_object(
      'total_clientes',      1,
      'total_cobrancas',     1,
      'enviado_em',          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'origem',              'cobranca-saas-manual',
      'user_id',             rec.user_id,
      'evolution_instancia', rec.evolution_instancia,
      'evolution_api_key',   rec.evolution_api_key
    ),
    'itens', jsonb_build_array(
      jsonb_build_object(
        'cliente', jsonb_build_object(
          'nome',     rec.cliente_nome,
          'telefone', regexp_replace(coalesce(rec.cliente_telefone, ''), '\D', '', 'g'),
          (case when rec.cliente_tipo = 'pj' then 'cnpj' else 'cpf' end),
                      rec.cliente_documento,
          'email',    rec.cliente_email
        ),
        'cobrancas', jsonb_build_array(
          jsonb_build_object(
            'cliente',    rec.cliente_nome,
            'nome',       rec.cobranca_nome,
            'descricao',  rec.descricao,
            'valor',      'R$ ' || replace(to_char(rec.valor, 'FM999G999G990D00'), '.', ','),
            'status',     rec.status,
            'vencimento', to_char(rec.vencimento, 'DD/MM/YYYY')
          )
        )
      )
    )
  );

  perform net.http_post(
    url     := webhook_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := payload
  );

  perform public.marcar_cobranca_enviada(rec.cobranca_id);
  return true;
end;
$$;

grant execute on function public.disparar_cobranca_agora(uuid) to authenticated;

notify pgrst, 'reload schema';
