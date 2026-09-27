-- ════════════════════════════════════════════════════════════════════════
-- Secretos de las edge functions del hub, en el Vault.
--
-- Las funciones leen primero su variable de entorno y, si no está, el Vault
-- por esta función (así un secreto se pone con una línea de SQL y no hace
-- falta el panel ni redesplegar). Solo service_role puede llamarla y solo
-- devuelve nombres de la lista: nada de leer el Vault entero por RPC.
--
-- Nombres: app_supabase_url, app_service_role_key (de `okcomputer`, solo
-- lectura), hub_sync_token (lo usa también el cron: hub.lanzar_sync).
-- ════════════════════════════════════════════════════════════════════════

create or replace function hub.secreto(p_nombre text)
returns text language sql stable security definer set search_path = hub as $fn$
  select decrypted_secret from vault.decrypted_secrets
   where name = p_nombre
     and p_nombre = any(array['app_supabase_url', 'app_service_role_key', 'hub_sync_token'])
   limit 1
$fn$;

revoke execute on function hub.secreto(text) from public, anon, authenticated;
grant execute on function hub.secreto(text) to service_role;
