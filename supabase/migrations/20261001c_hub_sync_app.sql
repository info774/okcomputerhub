-- ════════════════════════════════════════════════════════════════════════
-- Fase 0 · Estado de la sincronización con la app actual y su cron.
--
-- sync-app (edge function) lee los cambios de `okcomputer` por su registro de
-- auditoría (`audit_log`: id creciente, tabla, registro, acción) — casi
-- ninguna tabla de la app tiene `updated_at`, y audit_log ya apunta cada
-- INSERT/UPDATE/DELETE de las tablas que copiamos. Así cada pasada pide solo
-- las filas tocadas desde el último corte, y los borrados también llegan.
-- Las tablas sin auditoría en la app (documento_lineas) se copian enteras en
-- la pasada nocturna, que además repasa todo lo demás.
--
-- Regla: UN SYNC QUE FALLA NO MUEVE EL CORTE. `corte_id` solo avanza cuando
-- todo el lote se ha escrito.
--
-- El cron llama a la función con la URL y el token del Vault
-- (hub_sync_url / hub_sync_token, se ponen a mano: docs/FASE0.md). Sin ellos,
-- la tarea no hace nada.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.sync_estado (
  clave        text primary key,          -- 'audit' (incremental) | 'completo' (nocturno)
  corte_id     bigint,                    -- último audit_log.id aplicado
  corte_ts     timestamptz,               -- si corte_id es null: empezar en el primer audit_log con ts >= esto
  ultima_ok    timestamptz,
  ultimo_error text,
  ultimo_error_at timestamptz,
  filas        integer,                   -- filas escritas en la última pasada buena
  detalle      jsonb
);

alter table hub.sync_estado enable row level security;
grant select on hub.sync_estado to authenticated;
grant all on hub.sync_estado to service_role;
drop policy if exists leer on hub.sync_estado;
create policy leer on hub.sync_estado for select to authenticated using ((select hub.es_usuario()));

insert into hub.sync_estado (clave) values ('audit'), ('completo') on conflict do nothing;

-- ── Llamada a sync-app desde pg_cron ─────────────────────────────────────
create or replace function hub.lanzar_sync(p_modo text default 'incremental')
returns bigint language plpgsql security definer set search_path = hub as $fn$
declare
  v_url   text := (select decrypted_secret from vault.decrypted_secrets where name = 'hub_sync_url');
  v_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'hub_sync_token');
begin
  if v_url is null or v_token is null then
    raise notice 'hub.lanzar_sync: faltan hub_sync_url / hub_sync_token en el Vault';
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
    body := jsonb_build_object('modo', p_modo),
    timeout_milliseconds := 120000
  );
end
$fn$;
revoke execute on function hub.lanzar_sync(text) from public, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('hub-sync-app', 'hub-sync-app-completo');
select cron.schedule('hub-sync-app',          '*/15 * * * *', $$select hub.lanzar_sync('incremental')$$);
select cron.schedule('hub-sync-app-completo', '30 3 * * *',   $$select hub.lanzar_sync('completo')$$);
