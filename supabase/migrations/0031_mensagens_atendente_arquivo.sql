-- ============================================================================
-- nome_arquivo + mime_type em mensagens_atendente
-- ============================================================================
-- Quando o WhatsApp envia um arquivo (pdf/docx/xlsx/etc), o nome original
-- está no payload da Evolution. Sem armazenar, no download a gente só sabe
-- detectar zip (porque docx/xlsx começam com mesmos bytes PK\x03\x04).
-- ============================================================================

alter table public.mensagens_atendente
  add column if not exists nome_arquivo text,
  add column if not exists mime_type    text;

notify pgrst, 'reload schema';
