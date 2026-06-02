-- ============================================================================
-- TEMPLATE DE MENSAGEM POR USUÁRIO
-- ============================================================================
-- O usuário define um exemplo/template de cobrança em /configuracoes que é
-- enviado junto no payload do webhook (tanto no envio manual quanto no
-- cron automático). O n8n usa esse texto pra montar a mensagem da Evolution.
--
-- Placeholders sugeridos (o n8n substitui):
--   {cliente}    → nome do cliente
--   {cobranca}   → nome (título) da cobrança
--   {descricao}  → descrição da cobrança
--   {valor}      → valor formatado (R$ 199,90)
--   {vencimento} → data BR (28/05/2026)
-- ============================================================================

alter table public.profiles
  add column if not exists mensagem_template text;

-- Default amigável pros profiles novos (mantém NULL nos já existentes
-- pra eles editarem na UI sem sobrescrever escolha do usuário).
alter table public.profiles
  alter column mensagem_template
  set default 'Olá {cliente}! Lembrete da cobrança "{cobranca}" no valor de {valor}, com vencimento em {vencimento}. Por favor, regularize ou nos avise se já efetuou o pagamento.';

notify pgrst, 'reload schema';
