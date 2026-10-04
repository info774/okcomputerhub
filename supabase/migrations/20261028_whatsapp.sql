-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 5, tanda 2: el webhook de WhatsApp, PREPARADO Y SIN CONECTAR
-- (decisión de Fran, 2026-10-04). Meta sigue llamando al webhook de la app
-- hasta el cambio de WhatsApp; entonces se le da la URL del hub
-- (función `whatsapp-webhook`) y el área `whatsapp` pasa al hub.
--
-- Espejos de la app (mismas columnas, sin claves foráneas; fuera de su
-- audit_log, llegan en la pasada nocturna):
--   · wa_conversaciones — una por teléfono, con el paso del menú (bot_*) y la
--     verificación por código (verificado_*, codigo_*).
--   · wa_mensajes       — entrantes y salientes; wa_message_id ÚNICO (Meta
--     reintenta: un mensaje repetido no abre otro ticket).
--   Área nueva `whatsapp` (dueño app). Nadie del equipo escribe aquí: lo hacen
--   las funciones con la service key (whatsapp, whatsapp-webhook).
-- Propia del Desk (área `tickets`, ya del hub, con importar_altas):
--   · ticket_adjuntos   — los ficheros del ticket (fotos de WhatsApp incluidas);
--     las altas que siga creando la app entran por el sync, sin pisar.
-- usuarios.telefono (como la app): un WhatsApp del EQUIPO no saca el menú de
-- clientes, va a las órdenes internas (whatsapp-webhook/equipo.ts).
-- Funciones: hub.wa_buscar_por_telefono (¿de quién es este número?) y
-- hub.wa_locales_autorizados (dueño o administración de una sede, para el
-- agente de Meta), las dos por los ÚLTIMOS 9 DÍGITOS, como la app.
-- Cubos de Storage (públicos, rutas aleatorias, solo escribe la service key,
-- como la app): whatsapp-adjuntos y trabajo-fotos.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.wa_conversaciones (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  telefono               text not null unique,
  nombre                 text,
  cliente_id             uuid,
  local_id               uuid,
  contacto_id            uuid,
  ticket_id              uuid,
  ultimo_mensaje         text,
  ultimo_mensaje_at      timestamptz,
  ultimo_entrante_at     timestamptz,
  sin_leer               integer not null default 0,
  bot_estado             text,
  bot_datos              jsonb not null default '{}'::jsonb,
  bot_estado_at          timestamptz,
  verificado_local_id    uuid,
  verificado_at          timestamptz,
  codigo_fallos          integer not null default 0,
  codigo_bloqueado_hasta timestamptz
);
create index if not exists wa_conversaciones_ultimo on hub.wa_conversaciones (ultimo_mensaje_at desc);

create table if not exists hub.wa_mensajes (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  conversacion_id   uuid not null,
  wa_message_id     text unique,
  direccion         text not null check (direccion in ('entrante', 'saliente')),
  tipo              text not null default 'text',
  texto             text,
  media_id          text,
  media_mime        text,
  media_nombre      text,
  estado            text not null default 'recibido',
  error             text,
  usuario           text,
  automatico        boolean not null default false,
  ticket_id         uuid,
  media_url         text,
  media_descripcion text
);
create index if not exists wa_mensajes_conv on hub.wa_mensajes (conversacion_id, created_at);

create table if not exists hub.ticket_adjuntos (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null,
  nombre        text not null,
  drive_file_id text,
  drive_url     text,
  mime_type     text,
  usuario       text,
  created_at    timestamptz not null default now()
);
create index if not exists ticket_adjuntos_ticket on hub.ticket_adjuntos (ticket_id);

alter table hub.usuarios add column if not exists telefono text;

insert into hub.areas (area, dueno, tablas, notas)
values ('whatsapp', 'app', array['wa_conversaciones', 'wa_mensajes'],
        'Paridad bloque 5: las conversaciones las recibe el webhook de la app hasta el cambio de WhatsApp')
on conflict (area) do nothing;
update hub.areas set tablas = tablas || array['ticket_adjuntos']
 where area = 'tickets' and not ('ticket_adjuntos' = any (tablas));

-- RLS. wa_*: las lee el equipo (como la bandeja de la app); escriben las
-- funciones. ticket_adjuntos: como los tickets (leer y añadir el equipo con el
-- área del hub; quitar, un admin).
do $$
declare t text;
begin
  foreach t in array array['wa_conversaciones', 'wa_mensajes', 'ticket_adjuntos'] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('revoke insert, update, delete on hub.%I from authenticated', t);
    execute format('grant select on hub.%I to authenticated', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    perform hub.auditar(t);
  end loop;
end $$;
grant insert, delete on hub.ticket_adjuntos to authenticated;
drop policy if exists anadir on hub.ticket_adjuntos;
create policy anadir on hub.ticket_adjuntos for insert to authenticated
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('ticket_adjuntos'));
drop policy if exists quitar on hub.ticket_adjuntos;
create policy quitar on hub.ticket_adjuntos for delete to authenticated
  using ((select hub.es_admin()) and hub.tabla_es_del_hub('ticket_adjuntos'));

-- Los últimos 9 dígitos: iguala «922 12 34 56», «+34 612-345-678», «0034…».
create or replace function hub._tel9(t text) returns text language sql immutable as $fn$
  select right(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 9)
$fn$;

-- ¿De quién es este teléfono? (wa_buscar_por_telefono de la app): contacto
-- primero (trae persona, cliente y sede), luego cliente, luego teléfono de sede.
create or replace function hub.wa_buscar_por_telefono(tel text)
returns table (cliente_id uuid, local_id uuid, contacto_id uuid, nombre text)
language sql stable security definer set search_path = hub as $fn$
  with t as (select hub._tel9(tel) as n)
  select x.cliente_id, x.local_id, x.contacto_id, x.nombre from (
    select c.cliente_id, c.local_id, c.id as contacto_id, c.nombre, 1 as orden
      from hub.contactos c, t
     where length(t.n) = 9 and coalesce(c.activo, true)
       and (hub._tel9(c.telefono) = t.n or hub._tel9(c.telefono2) = t.n)
    union all
    select cl.id, null::uuid, null::uuid, cl.nombre, 2
      from hub.clientes cl, t
     where length(t.n) = 9 and coalesce(cl.activo, true) and hub._tel9(cl.telefono) = t.n
    union all
    select l.cliente_id, l.id, null::uuid, l.nombre, 3
      from hub.local_telefonos lt join hub.locales l on l.id = lt.local_id, t
     where length(t.n) = 9 and coalesce(l.activo, true) and hub._tel9(lt.numero) = t.n
  ) x
  order by x.orden
  limit 1
$fn$;

-- Sedes del cliente en las que ese teléfono es de dueño o administración, con
-- su código de verificación (wa_locales_autorizados de la app). Solo la service key.
create or replace function hub.wa_locales_autorizados(tel text, cliente uuid)
returns table (local_id uuid, codigo_verificacion text)
language sql stable security definer set search_path = hub as $fn$
  select l.id, l.codigo_verificacion
    from hub.local_telefonos lt join hub.locales l on l.id = lt.local_id
   where l.cliente_id = cliente and coalesce(l.activo, true)
     and lt.rol in ('dueno', 'administracion')
     and length(hub._tel9(tel)) = 9 and hub._tel9(lt.numero) = hub._tel9(tel)
$fn$;

revoke all on function hub.wa_buscar_por_telefono(text) from public, anon;
grant execute on function hub.wa_buscar_por_telefono(text) to authenticated, service_role;
revoke all on function hub.wa_locales_autorizados(text, uuid) from public, anon, authenticated;
grant execute on function hub.wa_locales_autorizados(text, uuid) to service_role;

-- Los cubos de Storage (en un Postgres sin Storage, como el de las pruebas, se salta).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('whatsapp-adjuntos', 'whatsapp-adjuntos', true) on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('trabajo-fotos', 'trabajo-fotos', true) on conflict (id) do nothing;
  end if;
end $$;
