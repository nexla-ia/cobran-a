-- ============================================================================
-- COBRANÇAS RECORRENTES (MENSALIDADE)
-- ============================================================================
-- Cobrança marcada como mensalidade = quando o vencimento passa, ela volta
-- pra 'pendente' e o vencimento avança 1 mês. Útil pra contratos/planos
-- que cobram todo mês.
-- ============================================================================

alter table public.cobrancas
  add column if not exists mensalidade boolean not null default false;

create index if not exists cobrancas_mensalidade_idx
  on public.cobrancas (mensalidade) where mensalidade = true;

-- ----------------------------------------------------------------------------
-- Função: roda toda vez que o motor é chamado.
-- Para cada cobrança mensalidade cujo vencimento já passou:
--   - Avança vencimento em 1 mês (com clamp do Postgres pra fim de mês)
--   - Reseta status pra 'pendente'
--   - Limpa pago_em e contadores de envio (novo ciclo, nova contagem)
-- ----------------------------------------------------------------------------
create or replace function public.resetar_mensalidades()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  afetadas integer;
begin
  -- Loop até não haver mais cobranças com vencimento passado.
  -- Isso cobre o caso de uma mensalidade que ficou parada por vários meses:
  -- avança mês a mês até o vencimento ser hoje ou futuro.
  loop
    update public.cobrancas
    set
      vencimento      = vencimento + interval '1 month',
      status          = 'pendente',
      pago_em         = null,
      total_envios    = 0,
      envios_hoje     = 0,
      ultimo_envio_em = null
    where mensalidade = true
      and vencimento < (now() at time zone 'America/Sao_Paulo')::date
      and status <> 'cancelado';  -- canceladas ficam fora do ciclo
    get diagnostics afetadas = row_count;
    exit when afetadas = 0;
  end loop;

  return 1;
end;
$$;

grant execute on function public.resetar_mensalidades() to authenticated;

-- ----------------------------------------------------------------------------
-- Plugar no motor: antes de listar cobranças prontas, processa mensalidades.
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
  perform public.resetar_mensalidades();
  perform public.processar_cancelamentos_vencidos();

  for rec in select * from public.cobrancas_para_disparar loop
    payload := jsonb_build_object(
      'meta', jsonb_build_object(
        'total_clientes',      1,
        'total_cobrancas',     1,
        'enviado_em',          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'origem',              'cobranca-saas-cron',
        'user_id',             rec.user_id,
        'evolution_instancia', rec.evolution_instancia,
        'evolution_api_key',   rec.evolution_api_key,
        'mensagem_template',   rec.mensagem_template
      ),
      'itens', jsonb_build_array(jsonb_build_object(
        'cliente', jsonb_build_object(
          'nome',     rec.cliente_nome,
          'telefone', regexp_replace(coalesce(rec.cliente_telefone, ''), '\D', '', 'g'),
          (case when rec.cliente_tipo = 'pj' then 'cnpj' else 'cpf' end), rec.cliente_documento,
          'email',    rec.cliente_email
        ),
        'cobrancas', jsonb_build_array(jsonb_build_object(
          'cliente',    rec.cliente_nome,
          'nome',       rec.cobranca_nome,
          'descricao',  rec.descricao,
          'valor',      'R$ ' || replace(to_char(rec.valor, 'FM999G999G990D00'), '.', ','),
          'status',     rec.status,
          'vencimento', to_char(rec.vencimento, 'DD/MM/YYYY')
        ))
      ))
    );

    perform net.http_post(
      url     := webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := payload
    );

    perform public.marcar_cobranca_enviada(rec.cobranca_id);
    enviadas := enviadas + 1;
  end loop;

  return enviadas;
end;
$$;

grant execute on function public.processar_disparos_automaticos() to authenticated;

notify pgrst, 'reload schema';
