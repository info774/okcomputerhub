-- ════════════════════════════════════════════════════════════════════════
-- Fase 1 · Organizador de proyectos.
--
-- Ciclo de un proyecto: idea → definicion → investigacion → roadmap →
-- desarrollo → cerrado. Internos o de cliente (cliente_id/local_id del
-- espejo, sin FK: el espejo llega por deltas).
--
-- Decisión respecto al plan: el plan ponía `proyecto_id` en hub.tareas,
-- hub.trabajos… pero esas tablas son ESPEJO de la app (dueño 'app') y el hub
-- no puede escribir en ellas. Así que:
--   · las tareas de un proyecto son suyas: hub.proyecto_tareas (tablero
--     Pendiente / En curso / Hecho por persona);
--   · lo que ya existe en la app (trabajos, tickets, presupuestos, gastos,
--     agenda, tareas) se ENLAZA con hub.proyecto_vinculos, sin tocarlo.
-- Cuando un área se corte (fase 8, 11…) se podrá mover el vínculo a una
-- columna si conviene.
--
-- Todo con RLS (usuario activo del hub lee y escribe; borrar un proyecto,
-- solo admin) y auditoría.
-- ════════════════════════════════════════════════════════════════════════

-- updated_at genérico para las tablas propias del hub.
create or replace function hub.tocar_updated_at()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

create sequence if not exists hub.proyectos_numero_seq;

create table if not exists hub.proyectos (
  id              uuid primary key default gen_random_uuid(),
  numero          integer not null default nextval('hub.proyectos_numero_seq'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  creado_por      uuid,                       -- hub.usuarios.id
  titulo          text not null check (length(trim(titulo)) > 0),
  tipo            text not null default 'interno' check (tipo in ('interno','cliente')),
  estado          text not null default 'idea'
                  check (estado in ('idea','definicion','investigacion','roadmap','desarrollo','cerrado')),
  prioridad       text not null default 'media' check (prioridad in ('baja','media','alta','urgente')),
  cliente_id      uuid,                       -- hub.clientes (espejo)
  local_id        uuid,                       -- hub.locales (espejo)
  responsable_id  uuid,                       -- hub.usuarios
  descripcion     text,                       -- la idea, en markdown
  fecha_inicio    date,
  fecha_objetivo  date,
  presupuesto     numeric(12,2),              -- dinero previsto
  presupuesto_id  uuid,                       -- hub.presupuestos (espejo), si hay uno
  orden           double precision not null default 0,   -- posición en la columna del kanban
  cerrado_at      timestamptz,
  resultado       text                        -- al cerrar: qué salió
);
alter sequence hub.proyectos_numero_seq owned by hub.proyectos.numero;
create unique index if not exists proyectos_numero_uk on hub.proyectos (numero);
create index if not exists proyectos_estado_idx on hub.proyectos (estado, orden);
create index if not exists proyectos_cliente_idx on hub.proyectos (cliente_id);

create table if not exists hub.proyecto_objetivos (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references hub.proyectos(id) on delete cascade,
  created_at  timestamptz not null default now(),
  texto       text not null check (length(trim(texto)) > 0),
  metrica     text,                           -- cómo se sabe que se ha cumplido
  hecho       boolean not null default false,
  orden       double precision not null default 0
);
create index if not exists objetivos_proyecto_idx on hub.proyecto_objetivos (proyecto_id, orden);

create table if not exists hub.proyecto_hitos (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references hub.proyectos(id) on delete cascade,
  created_at     timestamptz not null default now(),
  nombre         text not null check (length(trim(nombre)) > 0),
  descripcion    text,
  fecha_inicio   date,
  fecha_objetivo date,
  estado         text not null default 'pendiente' check (estado in ('pendiente','en_curso','hecho')),
  orden          double precision not null default 0
);
create index if not exists hitos_proyecto_idx on hub.proyecto_hitos (proyecto_id, orden);

-- Páginas: investigación y notas. Las escribe una persona o Claude (con sus
-- fuentes). En la fase 5 se funden con la wiki.
create table if not exists hub.proyecto_paginas (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references hub.proyectos(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  tipo         text not null default 'investigacion' check (tipo in ('investigacion','nota','decision')),
  titulo       text not null check (length(trim(titulo)) > 0),
  contenido    text not null default '',     -- markdown
  fuentes      jsonb not null default '[]',  -- [{titulo, url}]
  autor        text not null default 'persona' check (autor in ('persona','claude')),
  autor_id     uuid,                          -- hub.usuarios, si es persona
  orden        double precision not null default 0
);
create index if not exists paginas_proyecto_idx on hub.proyecto_paginas (proyecto_id, orden);

create table if not exists hub.proyecto_tareas (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references hub.proyectos(id) on delete cascade,
  hito_id        uuid references hub.proyecto_hitos(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  titulo         text not null check (length(trim(titulo)) > 0),
  descripcion    text,
  estado         text not null default 'pendiente' check (estado in ('pendiente','en_curso','hecho')),
  responsable_id uuid,                        -- hub.usuarios
  fecha_limite   date,
  horas_previstas numeric(6,2),
  hecha_at       timestamptz,
  orden          double precision not null default 0
);
create index if not exists ptareas_proyecto_idx on hub.proyecto_tareas (proyecto_id, estado, orden);
create index if not exists ptareas_responsable_idx on hub.proyecto_tareas (responsable_id, estado);

-- Lo que ya existe en la app, enlazado sin tocarlo.
create table if not exists hub.proyecto_vinculos (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references hub.proyectos(id) on delete cascade,
  created_at  timestamptz not null default now(),
  tabla       text not null check (tabla in ('trabajos','tareas','tickets','presupuestos','gastos','agenda')),
  registro_id uuid not null,
  nota        text,
  unique (proyecto_id, tabla, registro_id)
);
create index if not exists vinculos_registro_idx on hub.proyecto_vinculos (tabla, registro_id);

-- hecha_at / cerrado_at se ponen solos.
create or replace function hub.marcar_fechas_cierre()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_table_name = 'proyecto_tareas' then
    if new.estado = 'hecho' and (tg_op = 'INSERT' or old.estado is distinct from 'hecho') then new.hecha_at := now();
    elsif new.estado <> 'hecho' then new.hecha_at := null; end if;
  elsif tg_table_name = 'proyectos' then
    if new.estado = 'cerrado' and (tg_op = 'INSERT' or old.estado is distinct from 'cerrado') then new.cerrado_at := now();
    elsif new.estado <> 'cerrado' then new.cerrado_at := null; end if;
  end if;
  return new;
end
$fn$;

do $$
declare t text;
begin
  foreach t in array array['proyectos','proyecto_paginas','proyecto_tareas'] loop
    execute format('drop trigger if exists tocar_updated_at on hub.%I', t);
    execute format('create trigger tocar_updated_at before update on hub.%I
                    for each row execute function hub.tocar_updated_at()', t);
  end loop;
  foreach t in array array['proyectos','proyecto_tareas'] loop
    execute format('drop trigger if exists fechas_cierre on hub.%I', t);
    execute format('create trigger fechas_cierre before insert or update on hub.%I
                    for each row execute function hub.marcar_fechas_cierre()', t);
  end loop;

  -- Grants, RLS y auditoría.
  foreach t in array array['proyectos','proyecto_objetivos','proyecto_hitos','proyecto_paginas',
                           'proyecto_tareas','proyecto_vinculos'] loop
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('alter table hub.%I enable row level security', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    execute format('drop policy if exists crear on hub.%I', t);
    execute format('create policy crear on hub.%I for insert to authenticated with check ((select hub.es_usuario()))', t);
    execute format('drop policy if exists editar on hub.%I', t);
    execute format('create policy editar on hub.%I for update to authenticated
                      using ((select hub.es_usuario())) with check ((select hub.es_usuario()))', t);
    execute format('drop policy if exists borrar on hub.%I', t);
    -- Borrar un proyecto entero, solo admin; sus piezas, cualquiera del equipo.
    if t = 'proyectos' then
      execute format('create policy borrar on hub.%I for delete to authenticated using ((select hub.es_admin()))', t);
    else
      execute format('create policy borrar on hub.%I for delete to authenticated using ((select hub.es_usuario()))', t);
    end if;
    perform hub.auditar(t);
  end loop;
end $$;

grant usage, select on sequence hub.proyectos_numero_seq to authenticated, service_role;
