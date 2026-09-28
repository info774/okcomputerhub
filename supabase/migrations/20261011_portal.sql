-- ════════════════════════════════════════════════════════════════════════
-- Fase 7 · Portal de clientes.
--
-- Los clientes NO son usuarios de Supabase Auth ni tocan PostgREST: todo pasa
-- por la función `portal` (SIN_JWT) con sesiones propias:
--   · hub.portal_accesos: correos INVITADOS por un admin, cada uno de un
--     cliente; revocables (revocar corta también sus sesiones).
--   · hub.portal_enlaces: enlaces mágicos de un solo uso (30 min). Se guarda
--     solo la huella sha256 del código.
--   · hub.portal_sesiones: sesiones de 30 días (huella del token).
--   · hub.portal_traza: qué hace cada acceso (entrar, ver factura, abrir
--     ticket, aceptar presupuesto…).
--   · hub.portal_aceptaciones: «acepto este presupuesto» desde el portal. El
--     presupuesto es de la app (área app): el hub lo APUNTA y avisa; una
--     persona lo pasa a aceptado en la app / Zoho.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.portal_accesos (
  id               uuid primary key default gen_random_uuid(),
  email            text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nombre           text,
  cliente_id       uuid not null,
  activo           boolean not null default true,
  creado_por       uuid,
  created_at       timestamptz not null default now(),
  revocado_at      timestamptz,
  revocado_por     uuid,
  ultima_entrada_at timestamptz
);
create unique index if not exists portal_accesos_email_idx on hub.portal_accesos (email) where activo;
create index if not exists portal_accesos_cliente_idx on hub.portal_accesos (cliente_id);

create table if not exists hub.portal_enlaces (
  id         uuid primary key default gen_random_uuid(),
  acceso_id  uuid not null references hub.portal_accesos (id) on delete cascade,
  huella     text not null unique,
  caduca_at  timestamptz not null,
  usado_at   timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists portal_enlaces_acceso_idx on hub.portal_enlaces (acceso_id, created_at);

create table if not exists hub.portal_sesiones (
  id            uuid primary key default gen_random_uuid(),
  acceso_id     uuid not null references hub.portal_accesos (id) on delete cascade,
  huella        text not null unique,
  caduca_at     timestamptz not null,
  created_at    timestamptz not null default now(),
  ultimo_uso_at timestamptz,
  cerrada_at    timestamptz
);
create index if not exists portal_sesiones_acceso_idx on hub.portal_sesiones (acceso_id);

create table if not exists hub.portal_traza (
  id         bigint generated always as identity primary key,
  acceso_id  uuid references hub.portal_accesos (id) on delete set null,
  email      text,
  accion     text not null,
  detalle    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists portal_traza_acceso_idx on hub.portal_traza (acceso_id, created_at desc);

create table if not exists hub.portal_aceptaciones (
  id             uuid primary key default gen_random_uuid(),
  presupuesto_id uuid not null,
  acceso_id      uuid references hub.portal_accesos (id) on delete set null,
  nombre         text not null,       -- quién acepta (lo escribe el cliente)
  comentario     text,
  created_at     timestamptz not null default now(),
  revisada_at    timestamptz,
  revisada_por   uuid
);
create unique index if not exists portal_aceptaciones_presu_idx on hub.portal_aceptaciones (presupuesto_id);

-- Revocar un acceso cierra sus sesiones y anula sus enlaces.
create or replace function hub.portal_acceso_despues()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  if not new.activo and old.activo then
    update hub.portal_sesiones set cerrada_at = now() where acceso_id = new.id and cerrada_at is null;
    update hub.portal_enlaces set usado_at = now() where acceso_id = new.id and usado_at is null;
    insert into hub.portal_traza (acceso_id, email, accion) values (new.id, new.email, 'revocado');
  end if;
  return null;
end
$fn$;
drop trigger if exists portal_acceso_despues on hub.portal_accesos;
create trigger portal_acceso_despues after update on hub.portal_accesos
  for each row execute function hub.portal_acceso_despues();

create or replace function hub.portal_acceso_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' then new.creado_por := coalesce(new.creado_por, (hub.usuario_actual()).id); end if;
  if tg_op = 'UPDATE' and not new.activo and old.activo then
    new.revocado_at := now(); new.revocado_por := (hub.usuario_actual()).id;
  elsif new.activo then
    new.revocado_at := null; new.revocado_por := null;
  end if;
  return new;
end
$fn$;
drop trigger if exists portal_acceso_antes on hub.portal_accesos;
create trigger portal_acceso_antes before insert or update on hub.portal_accesos
  for each row execute function hub.portal_acceso_antes();

alter table hub.portal_accesos      enable row level security;
alter table hub.portal_enlaces      enable row level security;
alter table hub.portal_sesiones     enable row level security;
alter table hub.portal_traza        enable row level security;
alter table hub.portal_aceptaciones enable row level security;
grant select, insert, update on hub.portal_accesos to authenticated;
grant select on hub.portal_traza, hub.portal_sesiones to authenticated;
grant select, update on hub.portal_aceptaciones to authenticated;
grant all on hub.portal_accesos, hub.portal_enlaces, hub.portal_sesiones, hub.portal_traza, hub.portal_aceptaciones to service_role;

-- Invitar y revocar: admins. Enlaces: solo la función (sin política).
drop policy if exists admin on hub.portal_accesos;
create policy admin on hub.portal_accesos for all to authenticated
  using ((select hub.es_admin())) with check ((select hub.es_admin()));
drop policy if exists leer on hub.portal_accesos;
create policy leer on hub.portal_accesos for select to authenticated using ((select hub.es_usuario()));
drop policy if exists admin on hub.portal_traza;
create policy admin on hub.portal_traza for select to authenticated using ((select hub.es_admin()));
drop policy if exists admin on hub.portal_sesiones;
create policy admin on hub.portal_sesiones for select to authenticated using ((select hub.es_admin()));
drop policy if exists leer on hub.portal_aceptaciones;
create policy leer on hub.portal_aceptaciones for select to authenticated using ((select hub.es_usuario()));
drop policy if exists revisar on hub.portal_aceptaciones;
create policy revisar on hub.portal_aceptaciones for update to authenticated
  using ((select hub.es_usuario())) with check ((select hub.es_usuario()));

select hub.auditar('portal_accesos');
select hub.auditar('portal_aceptaciones');

-- ── Avisos de las fases siguientes (gancho del motor único) ─────────────
create or replace function hub.avisos_extra(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language plpgsql stable security definer set search_path = hub as $fn$
begin
  if not (coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario()) then return; end if;
  -- Presupuesto aceptado por el cliente en el portal, sin pasar aún a la app.
  return query
  select 'aceptado:' || a.id, 'presupuesto_aceptado_portal', 'mal',
         'Presupuesto aceptado en el portal: ' || coalesce(p.numero_presupuesto, p.titulo, 's/n'),
         coalesce(c.nombre, '') || ' · lo aceptó ' || a.nombre || ' · pásalo a aceptado en la app',
         p.total, '#/portal', a.created_at, p.tecnico_id, false
    from hub.portal_aceptaciones a
    left join hub.presupuestos p on p.id = a.presupuesto_id
    left join hub.clientes c on c.id = p.cliente_id
   where a.revisada_at is null;
end
$fn$;
revoke execute on function hub.avisos_extra(uuid, boolean) from public, anon;
grant execute on function hub.avisos_extra(uuid, boolean) to authenticated, service_role;

-- ── Motor de avisos: ahora llama al gancho ───────────────────────────────
create or replace function hub.panorama_direccion(p_para uuid default null)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language plpgsql stable security definer set search_path = hub as $fn$
declare
  v_admin boolean := hub.admin_para(p_para);
  v_ve    boolean := coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario();
  v_hoy   date := (now() at time zone 'Atlantic/Canary')::date;
  v_app   text := 'https://okcomputertenerife.web.app';
  v_zoho  text := 'https://books.zoho.eu/app/20107733530#/invoices/';
begin
  if not v_ve then return; end if;

  -- Presupuesto enviado hace más de una semana sin respuesta.
  return query
  select 'presupuesto:' || p.id, 'presupuesto_sin_respuesta', 'aviso',
         'Presupuesto sin respuesta: ' || coalesce(p.numero_presupuesto, p.titulo, 's/n'),
         coalesce(c.nombre, '') || ' · enviado el ' || to_char(p.fecha, 'DD/MM'),
         p.total, v_app, p.fecha::timestamptz, p.tecnico_id, false
    from hub.presupuestos p left join hub.clientes c on c.id = p.cliente_id
   where p.estado = 'Enviado' and p.fecha < v_hoy - 7;

  -- Trabajo terminado sin facturar.
  return query
  select 'trabajo:' || t.id, 'trabajo_sin_facturar', 'aviso',
         'Para facturar: #' || t.numero || ' ' || coalesce(t.titulo, left(t.descripcion, 60), ''),
         coalesce(c.nombre, ''), null::numeric, v_app, coalesce(t.fecha_programada::timestamptz, t.created_at), null::text, false
    from hub.trabajos t left join hub.clientes c on c.id = t.cliente_id
   where t.estado in ('Para facturar', 'Completado');

  -- Tickets (fase 6): SLA vencido o a punto, y sin asignar.
  return query
  select 'sla:' || t.id, 'sla_vencido', 'mal',
         'SLA vencido: #' || t.numero || ' ' || coalesce(t.titulo, ''),
         coalesce(c.nombre, '') || ' · ' || case when t.primera_respuesta_at is null and t.sla_respuesta_at < now()
           then 'sin primera respuesta (tocaba ' || to_char(t.sla_respuesta_at at time zone 'Atlantic/Canary', 'DD/MM HH24:MI') || ')'
           else 'sin resolver (tocaba ' || to_char(t.sla_resolucion_at at time zone 'Atlantic/Canary', 'DD/MM HH24:MI') || ')' end,
         null::numeric, '#/tickets/' || t.numero, coalesce(t.sla_respuesta_at, t.created_at), t.tecnico_id, false
    from hub.tickets t left join hub.clientes c on c.id = t.cliente_id
   where t.estado in ('Abierto', 'En curso')
     and ((t.primera_respuesta_at is null and t.sla_respuesta_at < now()) or t.sla_resolucion_at < now());

  return query
  select 'sla_pronto:' || t.id, 'sla_por_vencer', 'aviso',
         'SLA a punto de vencer: #' || t.numero || ' ' || coalesce(t.titulo, ''),
         coalesce(c.nombre, '') || ' · vence a las ' || to_char(least(case when t.primera_respuesta_at is null then t.sla_respuesta_at end, t.sla_resolucion_at) at time zone 'Atlantic/Canary', 'HH24:MI'),
         null::numeric, '#/tickets/' || t.numero, t.created_at, t.tecnico_id, false
    from hub.tickets t left join hub.clientes c on c.id = t.cliente_id
   where t.estado in ('Abierto', 'En curso')
     and not ((t.primera_respuesta_at is null and t.sla_respuesta_at < now()) or t.sla_resolucion_at < now())
     and least(case when t.primera_respuesta_at is null then t.sla_respuesta_at end, t.sla_resolucion_at) < now() + interval '1 hour';

  return query
  select 'ticket:' || t.id, 'ticket_sin_asignar', case when lower(t.prioridad) in ('alta', 'urgente') then 'mal' else 'aviso' end,
         'Ticket sin asignar: #' || t.numero || ' ' || coalesce(t.titulo, ''),
         coalesce(c.nombre, '') || coalesce(' · prioridad ' || lower(t.prioridad), ''), null::numeric, '#/tickets/' || t.numero, t.created_at, null::text, false
    from hub.tickets t left join hub.clientes c on c.id = t.cliente_id
   where t.estado in ('Abierto', 'En curso') and coalesce(t.tecnico_id, '') = '';

  -- Correos de remitentes desconocidos esperando a que alguien los mire.
  return query
  select 'correos', 'correo_sin_revisar', 'aviso',
         count(*) || ' correo(s) por revisar en la bandeja del Desk', 'De remitentes que no son clientes conocidos',
         null::numeric, '#/tickets/bandeja', max(e.recibido_at), null::text, false
    from hub.correos_entrantes e where e.estado = 'nuevo'
  having count(*) > 0;

  -- Alerta RMM activa crítica o alta.
  return query
  select 'rmm:' || a.id, 'alerta_rmm', case when a.severidad = 'critical' then 'mal' else 'aviso' end,
         'Alerta ' || case when a.severidad = 'critical' then 'crítica' else 'alta' end || ': ' || a.titulo,
         coalesce(a.hostname, '') || coalesce(' · ' || l.nombre, ''), null::numeric,
         '#/monitorizacion/equipo/' || a.device_id, a.disparada, null::text, false
    from hub.rmm_alertas a left join hub.locales l on l.id = a.local_id
   where a.estado = 'active' and a.severidad in ('critical', 'high');

  -- Sede con todos sus equipos sin conexión.
  return query
  select 'sede_caida:' || e.local_id, 'sede_sin_conexion', 'mal',
         'Sede sin conexión: ' || coalesce(l.nombre, 'sede'), e.equipos || ' equipo(s), ninguno conectado', null::numeric,
         '#/monitorizacion/sede/' || e.local_id, e.visto_ultimo, null::text, false
    from hub.rmm_estado_local e left join hub.locales l on l.id = e.local_id
   where e.estado = 'caido' and e.visto_ultimo > now() - interval '7 days';

  -- Hito de proyecto vencido.
  return query
  select 'hito:' || h.id, 'hito_vencido', 'aviso',
         'Hito vencido: ' || h.nombre, '#' || p.numero || ' ' || p.titulo || ' · era el ' || to_char(h.fecha_objetivo, 'DD/MM'),
         null::numeric, '#/proyectos/' || p.numero || '/roadmap', h.fecha_objetivo::timestamptz, u.nombre, false
    from hub.proyecto_hitos h join hub.proyectos p on p.id = h.proyecto_id
    left join hub.usuarios u on u.id = p.responsable_id
   where h.estado <> 'hecho' and h.fecha_objetivo < v_hoy and p.estado <> 'cerrado';

  -- Lead (web, WhatsApp…) sin contestar: sigue en Detectado, más de 24 h y sin actividad.
  return query
  select 'lead:' || o.id, 'lead_sin_contestar', 'mal',
         'Lead sin contestar: ' || o.titulo, coalesce(c.nombre, '') || ' · entró por ' || o.origen || ' ' || to_char(o.created_at at time zone 'Atlantic/Canary', 'DD/MM HH24:MI'),
         o.valor_estimado, '#/oportunidades/' || o.id, o.created_at, o.tecnico_id, false
    from hub.oportunidades o left join hub.clientes c on c.id = o.cliente_id
   where o.estado = 'Detectado' and coalesce(o.origen, '') <> '' and o.created_at < now() - interval '24 hours'
     and not exists (select 1 from hub.actividades a where a.oportunidad_id = o.id);

  -- Oportunidad abierta con el seguimiento vencido.
  return query
  select 'seguimiento:' || o.id, 'seguimiento_vencido', 'aviso',
         'Seguimiento vencido: ' || o.titulo, coalesce(c.nombre, '') || ' · tocaba el ' || to_char(o.fecha_seguimiento, 'DD/MM'),
         o.valor_estimado, '#/oportunidades/' || o.id, o.fecha_seguimiento::timestamptz, o.tecnico_id, false
    from hub.oportunidades o left join hub.clientes c on c.id = o.cliente_id
   where o.cerrada_at is null and o.fecha_seguimiento < v_hoy;

  -- «Lo siguiente» de un cliente, vencido.
  return query
  select 'siguiente:' || m.cliente_id, 'siguiente_vencido', 'aviso',
         'Pendiente con ' || coalesce(c.nombre, 'un cliente') || ': ' || coalesce(m.siguiente_texto, 'lo siguiente'),
         'era para el ' || to_char(m.siguiente_fecha, 'DD/MM'), null::numeric, '#/clientes/' || m.cliente_id,
         m.siguiente_fecha::timestamptz, u.nombre, false
    from hub.clientes_crm m left join hub.clientes c on c.id = m.cliente_id left join hub.usuarios u on u.id = m.responsable_id
   where m.siguiente_fecha < v_hoy;

  -- Avisos de las fases siguientes (portal, comandas, almacén, personas…):
  -- cada una redefine hub.avisos_extra() sin tener que copiar esta función.
  return query select * from hub.avisos_extra(p_para, v_admin);

  if not v_admin then return; end if;

  -- ── Solo admins: dinero ───────────────────────────────────────────────
  -- Factura vencida (Zoho).
  return query
  select 'factura:' || f.invoice_id, 'factura_vencida', case when f.vence < v_hoy - 30 then 'mal' else 'aviso' end,
         'Factura vencida: ' || f.numero || ' · ' || coalesce(f.cliente_nombre, ''),
         'venció el ' || to_char(f.vence, 'DD/MM/YY') || ' (' || (v_hoy - f.vence) || ' días)',
         f.saldo, v_zoho || f.invoice_id, f.vence::timestamptz, null::text, true
    from hub.zoho_facturas f
   where f.saldo > 0 and f.vence < v_hoy and f.estado not in ('void', 'draft', 'paid');

  -- Cobro de mantenimiento torcido.
  return query
  select 'mant:' || l.id, 'cobro_mantenimiento', case when l.estado_pago = 'No paga' then 'mal' else 'aviso' end,
         'Mantenimiento: ' || l.nombre, coalesce(l.estado_pago, '') || coalesce(' · ' || l.stripe_ultimo_error, ''),
         l.importe_mantenimiento, v_app, null::timestamptz, null::text, true
    from hub.locales l
   where l.activo is not false
     and (l.estado_pago in ('Pendiente de pago', 'Último aviso', 'No paga') or l.stripe_ultimo_error is not null);

  -- Recordatorio de cobro preparado, pendiente de mandar.
  return query
  select 'recordatorio:' || r.id, 'recordatorio_cobro', 'aviso',
         'Recordatorio de cobro listo: ' || r.numero || ' · ' || coalesce(r.cliente_nombre, ''),
         r.nivel || '.º aviso · venció el ' || to_char(r.vence, 'DD/MM/YY'), r.saldo, '#/cobros', r.created_at, null::text, true
    from hub.cobros_recordatorios r where r.estado = 'pendiente';

  -- Cliente grande (≥ 1.000 € en los 12 meses anteriores) que lleva 90 días sin comprar.
  return query
  with por_cliente as (
    select f.cliente_zoho_id, max(f.cliente_nombre) as nombre,
           sum(f.total) filter (where f.fecha >= v_hoy - 455 and f.fecha < v_hoy - 90) as antes,
           max(f.fecha) as ultima
      from hub.zoho_facturas f
     where f.estado not in ('void', 'draft') and f.fecha >= v_hoy - 455
     group by f.cliente_zoho_id
  )
  select 'sin_comprar:' || pc.cliente_zoho_id, 'cliente_sin_comprar', 'info',
         'Cliente importante sin comprar: ' || pc.nombre,
         'última factura el ' || to_char(pc.ultima, 'DD/MM/YY') || '; antes, ' || round(pc.antes) || ' € en un año',
         pc.antes, 'https://books.zoho.eu/app/20107733530#/contacts/' || pc.cliente_zoho_id, pc.ultima::timestamptz, null::text, true
    from por_cliente pc
   where pc.antes >= 1000 and pc.ultima < v_hoy - 90;

  -- Cierre del mes: los 3 últimos días y los 5 primeros, facturas en borrador.
  if extract(day from v_hoy + 3) <= 3 or extract(day from v_hoy) <= 5 then
    return query
    select 'cierre:' || to_char(v_hoy, 'YYYY-MM'), 'cierre_mes', 'aviso',
           'Cierre del mes: ' || count(*) || ' factura(s) en borrador',
           'Revisar y emitir antes de cerrar el mes', sum(f.total), 'https://books.zoho.eu/app/20107733530#/invoices?filter_by=Status.Draft',
           now(), null::text, true
      from hub.zoho_facturas f where f.estado = 'draft'
    having count(*) > 0;
  end if;
end
$fn$;
