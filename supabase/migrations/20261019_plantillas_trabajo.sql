-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 1, tanda 4 — Plantillas de trabajo (PREPARADO).
--
-- Espejo de `plantillas_trabajo` de la app (base_schema_snapshot, mismas
-- columnas): nombre, tipo, descripción, duración estimada y una lista de pasos
-- (`checklist`, jsonb [{texto, completado}]). Se borran con `activa = false`,
-- nunca de verdad. Va en el área `trabajos` (dueño `app` hasta el corte final):
-- se ve y se elige en el alta, y se edita al cortar. La app no la apunta en su
-- audit_log, así que el sync la trae en la pasada nocturna.
-- La firma del cliente y el parte no necesitan nada nuevo: `firma_cliente`
-- (imagen PNG en data URL, como la guarda la app) ya viaja con `trabajos`.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.plantillas_trabajo (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,
  tipo             text not null default 'Asistencia',
  descripcion      text,
  duracion_teorica integer,
  checklist        jsonb default '[]'::jsonb,
  activa           boolean not null default true,
  created_at       timestamptz not null default now()
);

grant select, insert, update, delete on hub.plantillas_trabajo to authenticated;
grant all on hub.plantillas_trabajo to service_role;
alter table hub.plantillas_trabajo enable row level security;
drop policy if exists leer on hub.plantillas_trabajo;
create policy leer on hub.plantillas_trabajo for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.plantillas_trabajo;
create policy escribir on hub.plantillas_trabajo for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('plantillas_trabajo'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('plantillas_trabajo'));
select hub.auditar('plantillas_trabajo');

update hub.areas set tablas = array_append(tablas, 'plantillas_trabajo')
 where area = 'trabajos' and not ('plantillas_trabajo' = any (tablas));
