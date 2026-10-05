-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 8 · tanda 4: la guía de instalación del trabajo (TPV,
-- cámaras, alarma Ajax, red, comanderos: GUIA_TIPOS de trabajos.js de la app)
-- y el catálogo y la base de conocimiento con escritura (preparados).
--   · hub.instalaciones: ESPEJO de la de la app (mismas columnas, sin claves
--     foráneas), en el área `trabajos` (dueño `app`): se ve ya en la ficha del
--     trabajo y se rellena con el corte. La app no la audita: llega en la
--     pasada nocturna.
--   · Al terminar la guía, como la app, se apunta el resumen en las
--     observaciones del trabajo y el equipo va a la ficha de la sede
--     (local_hardware, local_software, local_camaras: área `clientes`).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.instalaciones (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  trabajo_id  uuid,
  local_id    uuid,
  tipo        text not null,
  datos       jsonb default '{}'::jsonb,
  completada  boolean default false,
  tecnico_id  text
);
create index if not exists instalaciones_trabajo_idx on hub.instalaciones (trabajo_id);

alter table hub.instalaciones enable row level security;
grant select, insert, update, delete on hub.instalaciones to authenticated;
grant all on hub.instalaciones to service_role;
drop policy if exists leer on hub.instalaciones;
create policy leer on hub.instalaciones for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.instalaciones;
create policy escribir on hub.instalaciones for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('instalaciones'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('instalaciones'));
select hub.auditar('instalaciones');

update hub.areas set tablas = array_append(tablas, 'instalaciones')
 where area = 'trabajos' and not ('instalaciones' = any (tablas));

-- ── Catálogo y conocimiento (espejos; se escriben con el corte de su área) ──
-- Como en la app, el catálogo lo edita SOLO un admin (las altas que nacen del
-- inventario van por hub.inventario_catalogo, security definer, y no pasan por
-- aquí). Borrar un artículo de la base de conocimiento, también solo admin.
drop policy if exists alta_admin on hub.catalogo;
create policy alta_admin on hub.catalogo as restrictive for insert to authenticated with check ((select hub.es_admin()));
drop policy if exists cambiar_admin on hub.catalogo;
create policy cambiar_admin on hub.catalogo as restrictive for update to authenticated using ((select hub.es_admin()));
drop policy if exists borrar_admin on hub.catalogo;
create policy borrar_admin on hub.catalogo as restrictive for delete to authenticated using ((select hub.es_admin()));
drop policy if exists borrar_admin on hub.conocimiento;
create policy borrar_admin on hub.conocimiento as restrictive for delete to authenticated using ((select hub.es_admin()));
