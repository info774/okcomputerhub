-- Aviso del linter de Supabase (function_search_path_mutable) sobre las dos
-- funciones de 20261001_hub_cimientos.sql que no fijaban search_path.
alter function hub.auditoria_titulo(jsonb) set search_path = hub;
alter function hub.auditar(text) set search_path = hub;
