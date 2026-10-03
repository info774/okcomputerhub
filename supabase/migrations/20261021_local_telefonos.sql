-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 2, tanda 2 — Teléfonos de la sede (PREPARADO).
--
-- Espejo de `local_telefonos` de la app (mismas columnas): los teléfonos de
-- una sede con su ROL (dueño, administración, encargado, empleado, otro). El
-- rol importa: el WhatsApp de la app solo manda documentos a dueño y
-- administración. Va en el área `clientes` (con locales y contactos): se ve
-- en la ficha del sitio y se escribe al cortar. Sin CHECK en `rol`: es
-- espejo y no puede rechazar lo que traiga la app (el front solo ofrece los cinco). La app no la apunta en su
-- audit_log, así que el sync la trae en la pasada nocturna.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.local_telefonos (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  local_id    uuid,
  nombre      text,
  numero      text not null,
  rol         text default 'otro',
  contacto_id uuid
);
create index if not exists local_telefonos_local on hub.local_telefonos (local_id);


grant select, insert, update, delete on hub.local_telefonos to authenticated;
grant all on hub.local_telefonos to service_role;
alter table hub.local_telefonos enable row level security;
drop policy if exists leer on hub.local_telefonos;
create policy leer on hub.local_telefonos for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.local_telefonos;
create policy escribir on hub.local_telefonos for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('local_telefonos'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('local_telefonos'));
select hub.auditar('local_telefonos');

update hub.areas set tablas = array_append(tablas, 'local_telefonos')
 where area = 'clientes' and not ('local_telefonos' = any (tablas));
