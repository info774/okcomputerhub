-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 2, tanda 3 — Equipamiento de la sede y seguimiento
-- (PREPARADO).
--
-- Espejos de la app, con sus mismas columnas:
--   · local_software, local_hardware, local_camaras: las pestañas Software,
--     Hardware y Cámaras de la ficha del sitio. De ahí salen también los
--     AnyDesk del sitio (hardware + software).
--   · rmm_despliegues: la contraseña de acceso remoto (RustDesk) de cada sede,
--     que se copia al portapapeles al abrir RustDesk (decisión de Fran,
--     2026-10-03: igual que la app). Su clave es `local_id`, no `id`: el sync
--     lo sabe por `clave` en _shared/tablas-app.ts. Es SOLO LECTURA también
--     tras el corte (las contraseñas las crea el instalador del agente de la
--     app) y no pasa por hub.auditoria, que guardaría la contraseña en claro.
--   · plan_tareas y sitio_tarea_seguimiento: las tareas de cada plan de
--     mantenimiento y lo marcado por periodo en cada sede. El catálogo de
--     tareas se edita con el bloque 4 (mantenimiento); aquí solo se marca.
-- Todas en el área `clientes` (dueño `app` hasta el corte): se ven y se
-- escriben al cortar. Ninguna está en el audit_log de la app: llegan en la
-- pasada nocturna del sync.
-- El disparador de la app que sube la caducidad del certificado del software a
-- locales.cert_caducidad NO se porta aún: esa columna es de la ficha de
-- mantenimiento (bloque 4).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.local_software (
  id                          uuid primary key default gen_random_uuid(),
  created_at                  timestamptz default now(),
  local_id                    uuid,
  nombre                      text,
  version                     text,
  num_licencia                text,
  anydesk_id                  text,
  fecha_caducidad_certificado date,
  notas                       text
);
create index if not exists local_software_local on hub.local_software (local_id);

create table if not exists hub.local_hardware (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz default now(),
  local_id          uuid,
  tipo              text,
  nombre            text,
  num_serie         text,
  ip                text,
  garantia          date,
  anydesk_id        text,
  fecha_instalacion date,
  notas             text
);
create index if not exists local_hardware_local on hub.local_hardware (local_id);

create table if not exists hub.local_camaras (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  local_id    uuid,
  marca       text,
  modelo      text,
  num_serie   text,
  ip          text,
  usuario     text,
  contrasena  text,
  notas       text
);
create index if not exists local_camaras_local on hub.local_camaras (local_id);

create table if not exists hub.rmm_despliegues (
  local_id          uuid primary key,
  rustdesk_password text not null,
  creado_at         timestamptz not null default now(),
  creado_por        uuid,
  notas             text
);

create table if not exists hub.plan_tareas (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  plan          text not null,
  nombre        text not null,
  periodicidad  text not null default 'mensual',
  es_backup     boolean not null default false,
  orden         int not null default 0,
  activa        boolean not null default true,
  notas         text
);
create index if not exists plan_tareas_plan on hub.plan_tareas (plan, orden);

create table if not exists hub.sitio_tarea_seguimiento (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  local_id        uuid not null,
  tarea_id        uuid not null,
  periodo         text not null,
  completado      boolean not null default true,
  completado_at   timestamptz not null default now(),
  completado_por  uuid,
  notas           text
);
create unique index if not exists sitio_tarea_seguimiento_unico on hub.sitio_tarea_seguimiento (local_id, tarea_id, periodo);

do $$
declare t text;
begin
  foreach t in array array['local_software', 'local_hardware', 'local_camaras', 'plan_tareas', 'sitio_tarea_seguimiento'] loop
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('alter table hub.%I enable row level security', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    execute format('drop policy if exists escribir on hub.%I', t);
    execute format('create policy escribir on hub.%I for all to authenticated
      using ((select hub.es_usuario()) and hub.tabla_es_del_hub(%L))
      with check ((select hub.es_usuario()) and hub.tabla_es_del_hub(%L))', t, t, t);
    perform hub.auditar(t);
    update hub.areas set tablas = array_append(tablas, t) where area = 'clientes' and not (t = any (tablas));
  end loop;
end $$;

-- rmm_despliegues: se lee y nada más (ver arriba).
grant select on hub.rmm_despliegues to authenticated;
grant all on hub.rmm_despliegues to service_role;
alter table hub.rmm_despliegues enable row level security;
drop policy if exists leer on hub.rmm_despliegues;
create policy leer on hub.rmm_despliegues for select to authenticated using ((select hub.es_usuario()));
update hub.areas set tablas = array_append(tablas, 'rmm_despliegues')
 where area = 'clientes' and not ('rmm_despliegues' = any (tablas));
