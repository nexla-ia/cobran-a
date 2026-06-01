-- Adiciona direcao em mensagens_atendente.
-- 'in'  = mensagem recebida do cliente (bolha esquerda branca)
-- 'out' = mensagem enviada pelo atendente/sistema (bolha direita verde)
--
-- Default 'out' pra manter compatibilidade com linhas já gravadas.

alter table public.mensagens_atendente
  add column if not exists direcao text not null default 'out'
    check (direcao in ('in', 'out'));

create index if not exists mens_atend_direcao_idx on public.mensagens_atendente (direcao);

notify pgrst, 'reload schema';
