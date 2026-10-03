-- ════════════════════════════════════════════════════════════════════════
-- Dock del modo escritorio: qué pantallas lleva fijas cada persona.
--
-- Decisión de Fran (2026-10-03): el dock va como el de macOS y cada uno elige
-- sus fijas con tres gestos (clic derecho → Mantener/Quitar, arrastrar desde
-- «Todas» o dentro del dock para ordenar, sacarlo hacia arriba para quitarlo),
-- guardado EN LA BASE para que sea el mismo dock en cualquier ordenador.
--
-- Una fila por persona; `modulos` = ids de pantalla en el orden del dock.
-- Sin fila, el front pone las de siempre (las primeras del menú). Panel, Oki,
-- Claude y «Todas» no se guardan: van siempre.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.dock_fijas (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null unique,              -- hub.usuarios
  modulos     text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

alter table hub.dock_fijas enable row level security;
grant select, insert, update, delete on hub.dock_fijas to authenticated;
grant all on hub.dock_fijas to service_role;

-- Cada persona ve y escribe SOLO la suya.
drop policy if exists propia on hub.dock_fijas;
create policy propia on hub.dock_fijas for all to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id))
  with check (usuario_id = (select (hub.usuario_actual()).id));

select hub.auditar('dock_fijas');
