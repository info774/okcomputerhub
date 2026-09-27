-- ════════════════════════════════════════════════════════════════════════
-- Fase 1 · «Lanzar a Claude»: peticiones de trabajo sobre un proyecto.
--
-- Desde la ficha se pide «Investigar» o «Desarrollar esta fase» (con
-- instrucciones opcionales). La petición queda aquí en `pendiente`; el
-- trabajador de Claude (una sesión de Claude Code con una Routine horaria,
-- docs/CLAUDE_TRABAJADOR.md) la toma por el conector MCP (`en_curso`), hace el
-- trabajo con las herramientas del conector (páginas con fuentes, objetivos,
-- hitos, tareas) y la cierra (`hecha` o `error`) con un resumen.
--
-- No hay issue de GitHub de por medio: el trabajador lee directamente de aquí.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.claude_peticiones (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  proyecto_id   uuid not null references hub.proyectos(id) on delete cascade,
  tipo          text not null check (tipo in ('investigar','desarrollar','revisar')),
  fase          text,                                -- fase del proyecto al pedirlo
  instrucciones text,                                -- lo que añade quien lo pide
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','en_curso','hecha','error','cancelada')),
  pedido_por    uuid,                                -- hub.usuarios
  tomada_at     timestamptz,
  terminada_at  timestamptz,
  resultado     text,                                -- resumen en markdown
  error         text
);
create index if not exists peticiones_estado_idx on hub.claude_peticiones (estado, created_at);
create index if not exists peticiones_proyecto_idx on hub.claude_peticiones (proyecto_id, created_at desc);

drop trigger if exists tocar_updated_at on hub.claude_peticiones;
create trigger tocar_updated_at before update on hub.claude_peticiones
  for each row execute function hub.tocar_updated_at();

alter table hub.claude_peticiones enable row level security;
grant select, insert, update on hub.claude_peticiones to authenticated;
grant all on hub.claude_peticiones to service_role;

drop policy if exists leer on hub.claude_peticiones;
create policy leer on hub.claude_peticiones for select to authenticated using ((select hub.es_usuario()));

-- Pedir: cualquiera del equipo, en su nombre y siempre en `pendiente`.
drop policy if exists pedir on hub.claude_peticiones;
create policy pedir on hub.claude_peticiones for insert to authenticated
  with check ((select hub.es_usuario()) and estado = 'pendiente'
              and pedido_por = (select (hub.usuario_actual()).id));

-- Desde el navegador solo se CANCELA una petición que aún no se ha tomado
-- (quien la pidió o un admin). Tomarla y cerrarla es cosa del trabajador
-- (conector MCP, service_role).
drop policy if exists cancelar on hub.claude_peticiones;
create policy cancelar on hub.claude_peticiones for update to authenticated
  using (estado = 'pendiente' and (pedido_por = (select (hub.usuario_actual()).id) or (select hub.es_admin())))
  with check (estado = 'cancelada');

select hub.auditar('claude_peticiones');
