-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 7 · tanda 4: control de equipos (control-equipos de la app,
-- 20261001b_control_equipos.sql). ¿Lleva cada PC de cliente lo que tiene que
-- llevar? Action1, Breeze, RustDesk y AnyDesk.
--
-- Decisión de Fran (2026-10-05): se VE ya lo que comprueba la app y la pasada
-- propia queda preparada sin encender.
--   · hub.equipos_control: ESPEJO de la de la app (mismas columnas, sin claves
--     foráneas), área `equipos` con dueño `app`. La app no la audita, así que
--     llega en la pasada nocturna… y en una pasada suelta a las 6:40 UTC, justo
--     después de la comprobación diaria de la app (6:10), para verla esa mañana.
--   · La función `control-equipos` del hub (preparada) lee Breeze por las
--     vistas hub.rmm_* y Action1 por su API; con el área de la app no hace
--     NADA (comprobar desde los dos abriría tareas repetidas).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.equipos_control (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  clave          text not null unique,     -- nombre del equipo sin dominio, en minúsculas
  hostname       text,
  local_id       uuid,
  local_manual   boolean not null default false,
  rmm_equipo_id  uuid,
  breeze_id      text,
  action1_id     text,
  action1_org    text,
  tiene_breeze   boolean,
  tiene_action1  boolean,
  tiene_rustdesk boolean,
  tiene_anydesk  boolean,
  rustdesk_id    text,
  anydesk_id     text,
  breeze_visto   timestamptz,
  action1_visto  timestamptz,
  faltan         text[] not null default '{}',
  ignorar        boolean not null default false,
  comprobado_at  timestamptz,
  visto_at       timestamptz
);
create index if not exists equipos_control_local_idx on hub.equipos_control (local_id);

drop trigger if exists tocar_updated_at on hub.equipos_control;
create trigger tocar_updated_at before update on hub.equipos_control for each row execute function hub.tocar_updated_at();

alter table hub.equipos_control enable row level security;
grant select, insert, update, delete on hub.equipos_control to authenticated;
grant all on hub.equipos_control to service_role;
drop policy if exists leer on hub.equipos_control;
create policy leer on hub.equipos_control for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.equipos_control;
create policy escribir on hub.equipos_control for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('equipos_control'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('equipos_control'));
select hub.auditar('equipos_control');

insert into hub.areas (area, dueno, tablas, notas)
values ('equipos', 'app', '{equipos_control}', 'Bloque 7 · control de equipos: se ve la comprobación de la app; la pasada del hub, preparada')
on conflict (area) do nothing;

-- La copia de la comprobación de la app, en cuanto la hace (6:10 UTC).
select cron.schedule('hub-equipos-control', '40 6 * * *',
  $$select hub.lanzar_funcion('sync-app', '{"modo":"completo","tablas":["equipos_control"]}')$$);
