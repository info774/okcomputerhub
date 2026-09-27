-- ════════════════════════════════════════════════════════════════════════
-- Fase 0 · Tablas de negocio de la app actual, en `hub`, con LAS MISMAS
-- columnas que en `okcomputer` (comprobadas el 2026-09-27 contra
-- information_schema de producción). Así sync-app copia columna a columna y
-- portar un módulo no cambia consultas.
--
-- Mientras el área tenga dueño 'app' (hub.areas) son un ESPEJO:
--   · Sin claves foráneas entre ellas: el espejo llega por deltas y en
--     cualquier orden; una FK rechazaría un trabajo que llega antes que su
--     cliente. Se añaden en la migración que corte el área.
--   · `numero` (trabajos, tareas, tickets) es un entero sin secuencia: lo
--     pone la app. La secuencia se crea al cortar el área.
--   · RLS: leer, cualquier usuario activo del hub; escribir, solo si el área
--     ya es del hub (hub.tabla_es_del_hub). sync-app escribe con service_role.
--
-- Una columna nueva en la app actual NO rompe el sync (copia solo las columnas
-- de supabase/functions/_shared/tablas-app.ts), pero no llega hasta que se
-- añada aquí con otra migración y a esa lista.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.clientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  tipo text default 'empresa',
  nombre text not null,
  nif text, telefono text, email text, direccion text, notas text,
  plan text default 'Sin mantenimiento',
  estado text default 'activo',
  activo boolean default true,
  zoho_id text, google_contact_id text,
  importe_mantenimiento numeric default 0,
  forma_pago text, frecuencia_pago text, fecha_activacion date, programa_tpv text,
  estado_pago text default 'Al corriente',
  notas_mantenimiento text, proxima_cuota date, stripe_customer_id text
);

create table if not exists hub.locales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  cliente_id uuid,
  nombre text not null,
  direccion text, horario text, notas text,
  activo boolean default true,
  notas_tecnicas text, maps_url text, zoho_subscription_id text,
  plan text default 'Sin mantenimiento',
  estado_pago text default 'Al corriente',
  importe_mantenimiento numeric, forma_pago text, frecuencia_pago text,
  fecha_activacion date, programa_tpv text, proxima_cuota date, notas_mantenimiento text,
  alarma_empresa text, alarma_contrato text, alarma_codigo text, alarma_telefono text, alarma_notas text,
  tipo text default 'Local',
  drive_folder_id text,
  estado text not null default 'activo',
  stripe_customer_id text, stripe_subscription_id text, stripe_estado text,
  stripe_mandato_estado text, stripe_ultimo_error text, stripe_sync_at timestamptz,
  zoho_estado text, zoho_deuda numeric, zoho_facturas_impagadas integer,
  zoho_sync_at timestamptz, zoho_sync_error text, zoho_deuda_error text,
  lat double precision, lng double precision, geocodificado_at timestamptz,
  importe_incluye_impuesto boolean not null default false,
  stripe_cobro_en_curso_at timestamptz,
  tiene_software boolean not null default true
);

create table if not exists hub.contactos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  nombre text not null,
  tipo text default 'otro',
  empresa text, cargo text, telefono text, telefono2 text, email text, direccion text, notas text,
  favorito boolean default false,
  cliente_id uuid,
  activo boolean default true,
  google_resource_name text, google_synced_at timestamptz,
  etiquetas text[] default '{}',
  local_id uuid
);

create table if not exists hub.trabajos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  cliente_id uuid, local_id uuid,
  tipo text default 'Asistencia',
  descripcion text,
  estado text default 'Pendiente',
  tecnicos text[],
  fecha_programada date, hora_llegada timestamptz, hora_salida timestamptz,
  gps_lat numeric, gps_lng numeric,
  materiales text, observaciones text, firma_cliente text,
  duracion_teorica integer, gcal_event_id text, ubicacion text,
  presupuesto_id uuid, firma_url text, parent_trabajo_id uuid,
  numero integer,
  chain_root_id uuid, titulo text, contacto_id uuid, prioridad text,
  oportunidad_id uuid, zoho_invoice_id text, zoho_invoice_number text
);

create table if not exists hub.agenda (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid, tarea_id uuid, ticket_id uuid,
  titulo text,
  inicio timestamptz not null,
  fin timestamptz not null,
  todo_el_dia boolean not null default false,
  tecnicos text[],
  estado text not null default 'planificado',
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid,
  tipo text
);

create table if not exists hub.sesiones (
  id uuid primary key default gen_random_uuid(),
  entidad_tipo text, entidad_id uuid,
  traslado timestamptz, inicio timestamptz, fin timestamptz,
  duracion_min integer,
  tecnico_id uuid, tecnico_nombre text,
  gps_lat numeric, gps_lng numeric,
  created_at timestamptz default now(),
  agenda_id uuid
);

create table if not exists hub.documento_lineas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  trabajo_id uuid, presupuesto_id uuid,
  nombre text,
  cantidad numeric default 1, precio numeric default 0, descuento numeric default 0, subtotal numeric default 0,
  orden integer default 1,
  inventario_id uuid, furgoneta_id uuid, categoria text
);

create table if not exists hub.tareas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  titulo text not null,
  estado text default 'pendiente',
  prioridad text default 'media',
  fecha_vencimiento date,
  tecnico_id text, notas text,
  trabajo_id uuid, ticket_id uuid, presupuesto_id uuid,
  duracion_teorica integer,
  hora_recordatorio time,
  numero integer,
  cliente_id uuid, local_id uuid, contacto_id uuid,
  recurrencia text not null default 'ninguna',
  recurrencia_cada integer not null default 1,
  proxima_recurrencia date, recurrencia_hasta date,
  tarea_origen_id uuid, gtask_id text,
  hora_inicio time, hora_fin time,
  tipo text default 'Generica',
  oportunidad_id uuid, descripcion text
);

create table if not exists hub.tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  cliente_id uuid, local_id uuid,
  titulo text not null,
  descripcion text,
  estado text default 'Abierto',
  prioridad text default 'media',
  tecnico_id text, resolucion text, via_contacto text,
  numero integer,
  contacto_id uuid, trabajo_id uuid, resolucion_categoria text
);

create table if not exists hub.presupuestos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  cliente_id uuid, local_id uuid,
  titulo text, exigencias text,
  estado text default 'Borrador',
  total numeric default 0,
  tecnico_id text, zoho_estimate_id text,
  fecha date,
  oportunidad_id uuid, numero_presupuesto text, contacto_id uuid
);

create table if not exists hub.gastos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  importe numeric not null,
  fecha date, categoria text,
  trabajo_id uuid, tecnico_id text, notas text, foto_url text,
  tipo text not null default 'gasto',
  descripcion text, contacto_id uuid, local_id uuid
);

-- ── Índices de las columnas por las que se filtra ────────────────────────
create index if not exists locales_cliente_idx   on hub.locales (cliente_id);
create index if not exists contactos_cliente_idx on hub.contactos (cliente_id);
create index if not exists trabajos_cliente_idx  on hub.trabajos (cliente_id);
create index if not exists trabajos_local_idx    on hub.trabajos (local_id);
create index if not exists trabajos_fecha_idx    on hub.trabajos (fecha_programada);
create index if not exists agenda_inicio_idx     on hub.agenda (inicio);
create index if not exists agenda_trabajo_idx    on hub.agenda (trabajo_id);
create index if not exists sesiones_entidad_idx  on hub.sesiones (entidad_tipo, entidad_id);
create index if not exists lineas_trabajo_idx    on hub.documento_lineas (trabajo_id);
create index if not exists lineas_presu_idx      on hub.documento_lineas (presupuesto_id);
create index if not exists tareas_estado_idx     on hub.tareas (estado);
create index if not exists tickets_estado_idx    on hub.tickets (estado);
create index if not exists presupuestos_cli_idx  on hub.presupuestos (cliente_id);
create index if not exists gastos_fecha_idx      on hub.gastos (fecha);

-- ── Grants, RLS y auditoría, tabla a tabla ───────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['clientes','locales','contactos','trabajos','agenda','sesiones',
                           'documento_lineas','tareas','tickets','presupuestos','gastos'] loop
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
  end loop;
end $$;
