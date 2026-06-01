-- ============================================================================
-- AUTOMAÇÃO DE COBRANÇAS
-- ============================================================================
-- O app é o cérebro: define regras (dias até cancelar, envios por dia,
-- intervalo, horário) por usuário, com override por cobrança.
-- O n8n é o braço: roda Schedule a cada N min, SELECT na view
-- `cobrancas_para_disparar` e dispara webhook pra cada linha.
-- Depois do dispatch, chama RPC `marcar_cobranca_enviada(id)`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Regras DEFAULT por usuário (em profiles)
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists automacao_ativa          boolean   not null default false,
  add column if not exists dias_ate_cancelar        integer   not null default 30,
  add column if not exists envios_por_dia           integer   not null default 2,
  add column if not exists intervalo_envios_horas   integer   not null default 4,
  add column if not exists horario_inicio           time      not null default '09:00',
  add column if not exists horario_fim              time      not null default '18:00',
  -- Dias da semana liberados (0=dom, 1=seg ... 6=sab). Default: seg-sex.
  add column if not exists dias_semana              int[]     not null default '{1,2,3,4,5}',
  add column if not exists cancelar_automatico      boolean   not null default false;

-- ----------------------------------------------------------------------------
-- 2) Overrides opcionais + estado por cobrança
-- ----------------------------------------------------------------------------
alter table public.cobrancas
  -- overrides: NULL = usa o do profile
  add column if not exists dias_ate_cancelar_ovr        integer,
  add column if not exists envios_por_dia_ovr           integer,
  add column if not exists intervalo_envios_horas_ovr   integer,
  add column if not exists automacao_ativa_ovr          boolean,
  -- estado/contadores
  add column if not exists total_envios                 integer not null default 0,
  add column if not exists envios_hoje                  integer not null default 0,
  add column if not exists ultimo_envio_em              timestamptz;

create index if not exists cobrancas_ultimo_envio_idx
  on public.cobrancas (ultimo_envio_em);

-- ----------------------------------------------------------------------------
-- 3) Função pra cancelar automaticamente cobranças vencidas além do prazo
-- ----------------------------------------------------------------------------
create or replace function public.processar_cancelamentos_vencidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  afetadas integer;
begin
  update public.cobrancas c
  set status = 'cancelado'
  from public.profiles p
  where c.user_id = p.id
    and c.status in ('pendente', 'atrasado')
    and coalesce(c.dias_ate_cancelar_ovr, p.dias_ate_cancelar) > 0
    and p.cancelar_automatico = true
    and c.vencimento + (coalesce(c.dias_ate_cancelar_ovr, p.dias_ate_cancelar) || ' days')::interval < now();
  get diagnostics afetadas = row_count;
  return afetadas;
end;
$$;

grant execute on function public.processar_cancelamentos_vencidos() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) View pro cron — cobranças que devem ser disparadas AGORA
-- ----------------------------------------------------------------------------
create or replace view public.cobrancas_para_disparar as
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
    c.ultimo_envio_em,
    c.envios_hoje,
    -- envios_hoje só vale se ultimo_envio_em é hoje; senão é 0
    case when c.ultimo_envio_em::date = current_date
         then c.envios_hoje else 0 end                                  as envios_hoje_efetivo,
    cli.nome     as cliente_nome,
    cli.telefone as cliente_telefone,
    cli.email    as cliente_email,
    cli.documento as cliente_documento
  from public.cobrancas c
  join public.profiles  p on p.id = c.user_id
  left join public.clientes cli on cli.id = c.cliente_id
)
select *
from regras
where automacao_ativa = true
  and status in ('pendente', 'atrasado')
  and current_time between horario_inicio and horario_fim
  and extract(dow from now())::int = any(dias_semana)
  and envios_hoje_efetivo < envios_por_dia
  and (ultimo_envio_em is null
       or ultimo_envio_em + (intervalo_horas || ' hours')::interval <= now());

grant select on public.cobrancas_para_disparar to authenticated;

-- ----------------------------------------------------------------------------
-- 5) RPC pro n8n marcar a cobrança como enviada (após chamar a Evolution)
-- ----------------------------------------------------------------------------
create or replace function public.marcar_cobranca_enviada(p_cobranca_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cobrancas
  set
    total_envios    = total_envios + 1,
    envios_hoje     = case when ultimo_envio_em::date = current_date
                           then envios_hoje + 1 else 1 end,
    ultimo_envio_em = now()
  where id = p_cobranca_id;
end;
$$;

grant execute on function public.marcar_cobranca_enviada(uuid) to authenticated;

notify pgrst, 'reload schema';
