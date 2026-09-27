-- ════════════════════════════════════════════════════════════════════════
-- Fase 6 · Desk: los TICKETS pasan al hub.
--
--   · Área `tickets` cortada con importar_altas: lo que la app sigue creando
--     sola (WhatsApp, voz, RMM) entra al hub; lo editado aquí no se pisa.
--     También sus COMENTARIOS (los mensajes de WhatsApp del cliente llegan
--     como comentario en la app): un comentario del cliente sobre un ticket
--     cerrado EN EL HUB lo reabre.
--   · Numeración propia del hub desde el 5000 (la app sigue con la suya).
--   · SLA en horario laboral de Canarias (hub.horario_laboral + festivos):
--     primera respuesta y resolución por prioridad (hub.sla_politicas).
--   · Plantillas de respuesta, bandeja de correo (desk-correo lee Gmail) y
--     valoración 1-5 por enlace (ticket-valorar).
-- ════════════════════════════════════════════════════════════════════════

-- ── Horario laboral y festivos ───────────────────────────────────────────
create table if not exists hub.horario_laboral (
  dia_semana smallint not null check (dia_semana between 1 and 7), -- 1 = lunes (isodow)
  desde time not null,
  hasta time not null check (hasta > desde),
  primary key (dia_semana, desde)
);
insert into hub.horario_laboral (dia_semana, desde, hasta)
select d, h.desde, h.hasta from generate_series(1, 5) d,
  (values (time '09:00', time '14:00'), (time '16:00', time '19:00')) h(desde, hasta)
on conflict do nothing;

create table if not exists hub.festivos (
  fecha date primary key,
  nombre text not null
);
insert into hub.festivos (fecha, nombre) values
  ('2026-10-12', 'Fiesta Nacional de España'), ('2026-12-08', 'Inmaculada Concepción'), ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'), ('2027-01-06', 'Reyes'), ('2027-02-02', 'Candelaria (Tenerife)'),
  ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'), ('2027-10-12', 'Fiesta Nacional de España'),
  ('2027-11-01', 'Todos los Santos'), ('2027-12-06', 'Día de la Constitución'), ('2027-12-08', 'Inmaculada Concepción'),
  ('2027-12-25', 'Navidad')
on conflict do nothing;

-- Suma minutos LABORABLES a un instante (horario de Canarias, sin festivos).
create or replace function hub.sumar_laborables(p_desde timestamptz, p_min integer)
returns timestamptz language plpgsql stable set search_path = hub as $fn$
declare
  v_t    timestamp := p_desde at time zone 'Atlantic/Canary';
  v_rest numeric := p_min;
  v_dia  date;
  v_ini  timestamp;
  v_fin  timestamp;
  v_hay  numeric;
  r      record;
begin
  if p_desde is null or p_min is null then return null; end if;
  for i in 1..800 loop
    v_dia := v_t::date;
    if not exists (select 1 from hub.festivos f where f.fecha = v_dia) then
      for r in select h.desde, h.hasta from hub.horario_laboral h where h.dia_semana = extract(isodow from v_dia) order by h.desde loop
        v_ini := greatest(v_t, v_dia + r.desde);
        v_fin := v_dia + r.hasta;
        if v_ini < v_fin then
          v_hay := extract(epoch from v_fin - v_ini) / 60;
          if v_hay >= v_rest then
            return (v_ini + make_interval(secs => v_rest * 60)) at time zone 'Atlantic/Canary';
          end if;
          v_rest := v_rest - v_hay;
        end if;
      end loop;
    end if;
    v_t := (v_dia + 1)::timestamp;
  end loop;
  return null; -- sin horario definido
end
$fn$;

-- ── SLA por prioridad (minutos laborables) ───────────────────────────────
create table if not exists hub.sla_politicas (
  prioridad      text primary key check (prioridad in ('urgente', 'alta', 'media', 'baja')),
  respuesta_min  integer not null check (respuesta_min > 0),
  resolucion_min integer not null check (resolucion_min > 0),
  updated_at     timestamptz not null default now()
);
-- Un día laborable = 8 h (9-14 y 16-19). Resolución = el doble.
insert into hub.sla_politicas (prioridad, respuesta_min, resolucion_min) values
  ('urgente', 120, 240), ('alta', 240, 480), ('media', 480, 960), ('baja', 1440, 2880)
on conflict do nothing;
drop trigger if exists tocar_updated_at on hub.sla_politicas;
create trigger tocar_updated_at before update on hub.sla_politicas for each row execute function hub.tocar_updated_at();

-- ── Tickets: columnas del hub ────────────────────────────────────────────
create sequence if not exists hub.tickets_numero_seq start 5000;
alter table hub.tickets alter column numero set default nextval('hub.tickets_numero_seq');
alter table hub.tickets
  add column if not exists updated_at timestamptz default now(),
  add column if not exists canal text,
  add column if not exists email_hilo text,
  add column if not exists email_de text,
  add column if not exists sla_respuesta_at timestamptz,
  add column if not exists sla_resolucion_at timestamptz,
  add column if not exists primera_respuesta_at timestamptz,
  add column if not exists cerrado_at timestamptz,
  add column if not exists valoracion smallint check (valoracion between 1 and 5),
  add column if not exists valoracion_comentario text,
  add column if not exists valoracion_at timestamptz,
  add column if not exists valoracion_token uuid not null default gen_random_uuid(),
  add column if not exists etiquetas text[] not null default '{}';
create unique index if not exists tickets_valoracion_token_idx on hub.tickets (valoracion_token);
create index if not exists tickets_email_hilo_idx on hub.tickets (email_hilo) where email_hilo is not null;
create index if not exists tickets_numero_idx on hub.tickets (numero);

create or replace function hub.ticket_antes()
returns trigger language plpgsql set search_path = hub as $fn$
declare v_p hub.sla_politicas;
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if tg_op = 'INSERT' then
    new.canal := coalesce(new.canal, lower(nullif(new.via_contacto, '')), 'app');
  end if;
  if tg_op = 'INSERT' or new.prioridad is distinct from old.prioridad or new.sla_respuesta_at is null then
    select * into v_p from hub.sla_politicas where prioridad = lower(coalesce(new.prioridad, 'media'));
    if found then
      new.sla_respuesta_at  := hub.sumar_laborables(coalesce(new.created_at, now()), v_p.respuesta_min);
      new.sla_resolucion_at := hub.sumar_laborables(coalesce(new.created_at, now()), v_p.resolucion_min);
    end if;
  end if;
  if new.estado = 'Cerrado' and (tg_op = 'INSERT' or old.estado is distinct from 'Cerrado') then
    new.cerrado_at := coalesce(new.cerrado_at, now());
  elsif new.estado <> 'Cerrado' then
    new.cerrado_at := null;
  end if;
  return new;
end
$fn$;
drop trigger if exists ticket_antes on hub.tickets;
create trigger ticket_antes before insert or update on hub.tickets for each row execute function hub.ticket_antes();

-- SLA de los que ya estaban (el trigger lo calcula al tocar la fila). Sin
-- auditoría: es un recálculo, no un cambio de nadie.
select set_config('hub.sin_auditoria', 'on', true);
update hub.tickets set sla_respuesta_at = null where sla_respuesta_at is null;
-- Los cerrados de antes no tienen fecha de cierre ni necesitan SLA.
update hub.tickets set primera_respuesta_at = coalesce(primera_respuesta_at, created_at) where estado = 'Cerrado';
select set_config('hub.sin_auditoria', 'off', true);

-- Borrar un ticket: solo admins (la política general del espejo dejaba a todos).
drop policy if exists escribir on hub.tickets;
drop policy if exists crear on hub.tickets;
create policy crear on hub.tickets for insert to authenticated
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('tickets'));
drop policy if exists cambiar on hub.tickets;
create policy cambiar on hub.tickets for update to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('tickets'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('tickets'));
drop policy if exists borrar on hub.tickets;
create policy borrar on hub.tickets for delete to authenticated
  using ((select hub.es_admin()) and hub.tabla_es_del_hub('tickets'));
grant usage on sequence hub.tickets_numero_seq to authenticated, service_role;

-- ── Comentarios (mismas columnas que la app + las del hub) ───────────────
create table if not exists hub.ticket_comentarios (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null,
  autor_id     uuid,
  autor_nombre text,
  texto        text not null,
  created_at   timestamptz not null default now(),
  -- nota (interna) | respuesta (al cliente) | cliente (lo que escribe el cliente)
  tipo         text not null default 'nota' check (tipo in ('nota', 'respuesta', 'cliente')),
  canal        text,               -- email | whatsapp | telefono | portal | app
  email_id     text,               -- id del mensaje en Gmail (enviado o recibido)
  enviado_at   timestamptz,
  envio_error  text
);
create index if not exists ticket_comentarios_ticket_idx on hub.ticket_comentarios (ticket_id, created_at);
create unique index if not exists ticket_comentarios_email_idx on hub.ticket_comentarios (email_id) where email_id is not null;

-- Lo que llega de la app no trae tipo: se deduce del autor que pone su WhatsApp.
create or replace function hub.ticket_comentario_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if new.autor_nombre like 'WhatsApp · %' then new.tipo := 'cliente'; new.canal := coalesce(new.canal, 'whatsapp');
  elsif new.autor_nombre like '% (WhatsApp)' then new.tipo := 'respuesta'; new.canal := coalesce(new.canal, 'whatsapp');
  end if;
  if new.autor_id is null and new.tipo <> 'cliente' then
    new.autor_id := (hub.usuario_actual()).id;
  end if;
  return new;
end
$fn$;
drop trigger if exists ticket_comentario_antes on hub.ticket_comentarios;
create trigger ticket_comentario_antes before insert on hub.ticket_comentarios
  for each row execute function hub.ticket_comentario_antes();

-- Primera respuesta (SLA) y reapertura cuando el cliente vuelve a escribir.
create or replace function hub.ticket_comentario_despues()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  if new.tipo = 'respuesta' then
    update hub.tickets set primera_respuesta_at = new.created_at
     where id = new.ticket_id and primera_respuesta_at is null;
  elsif new.tipo = 'cliente' then
    update hub.tickets set estado = 'Abierto'
     where id = new.ticket_id
       and ((estado = 'Cerrado' and cerrado_at is not null and new.created_at > cerrado_at) or estado = 'Pendiente');
  end if;
  return null;
end
$fn$;
drop trigger if exists ticket_comentario_despues on hub.ticket_comentarios;
create trigger ticket_comentario_despues after insert on hub.ticket_comentarios
  for each row execute function hub.ticket_comentario_despues();

alter table hub.ticket_comentarios enable row level security;
grant select, insert, update, delete on hub.ticket_comentarios to authenticated;
grant all on hub.ticket_comentarios to service_role;
drop policy if exists leer on hub.ticket_comentarios;
create policy leer on hub.ticket_comentarios for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.ticket_comentarios;
create policy crear on hub.ticket_comentarios for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.ticket_comentarios;
create policy cambiar on hub.ticket_comentarios for update to authenticated
  using ((select hub.es_admin()) or autor_id = (select (hub.usuario_actual()).id))
  with check ((select hub.es_usuario()));
drop policy if exists borrar on hub.ticket_comentarios;
create policy borrar on hub.ticket_comentarios for delete to authenticated using ((select hub.es_admin()));
select hub.auditar('ticket_comentarios');

-- ── Corte del área ───────────────────────────────────────────────────────
update hub.areas set dueno = 'hub', tablas = '{tickets,ticket_comentarios}', importar_altas = true,
       cortada_at = coalesce(cortada_at, now()),
       notas = 'Fase 6: se llevan en el hub; las altas que crea la app (WhatsApp, voz, RMM) y sus comentarios se siguen importando'
 where area = 'tickets';

-- ── Plantillas de respuesta ──────────────────────────────────────────────
create table if not exists hub.plantillas_respuesta (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null,
  texto      text not null,
  cierre     boolean not null default false, -- se ofrece al cerrar
  orden      integer not null default 0,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists tocar_updated_at on hub.plantillas_respuesta;
create trigger tocar_updated_at before update on hub.plantillas_respuesta for each row execute function hub.tocar_updated_at();
insert into hub.plantillas_respuesta (titulo, texto, cierre, orden)
select * from (values
  ('Recibido', 'Hola {{contacto}}, hemos recibido tu aviso (ticket #{{numero}}). {{tecnico}} se pone con ello y te decimos algo en cuanto lo tengamos.', false, 1),
  ('Necesitamos acceso remoto', 'Hola {{contacto}}, para mirarlo necesitamos conectarnos al equipo. ¿Nos dices cuándo te viene bien?', false, 2),
  ('Esperando respuesta', 'Hola {{contacto}}, seguimos pendientes de tu respuesta para continuar con el ticket #{{numero}}.', false, 3),
  ('Cierre con valoración', 'Hola {{contacto}}, damos por resuelto el ticket #{{numero}}. Si algo sigue sin ir bien, responde a este mensaje y lo reabrimos.' || chr(10) || chr(10) || '¿Nos dices qué tal lo hemos hecho? Un clic: {{valoracion}}', true, 4)
) v(titulo, texto, cierre, orden)
where not exists (select 1 from hub.plantillas_respuesta);

-- ── Bandeja de correo (lo que lee desk-correo de Gmail) ─────────────────
create table if not exists hub.correos_entrantes (
  id          uuid primary key default gen_random_uuid(),
  gmail_id    text not null unique,
  hilo        text,
  message_id  text,             -- cabecera Message-ID (para contestar en el hilo)
  de          text not null,
  de_nombre   text,
  asunto      text,
  texto       text,
  recibido_at timestamptz not null,
  -- nuevo (por revisar) | ticket (abrió uno) | comentario (siguió uno) | descartado
  estado      text not null default 'nuevo' check (estado in ('nuevo', 'ticket', 'comentario', 'descartado')),
  motivo      text,             -- por qué se descartó solo (boletín, respuesta automática…)
  ticket_id   uuid,
  created_at  timestamptz not null default now()
);
create index if not exists correos_entrantes_estado_idx on hub.correos_entrantes (estado, recibido_at desc);
create index if not exists correos_entrantes_ticket_idx on hub.correos_entrantes (ticket_id);

-- ── RLS y auditoría de lo nuevo ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['horario_laboral', 'festivos', 'sla_politicas', 'plantillas_respuesta', 'correos_entrantes'] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    perform hub.auditar(t);
  end loop;
  -- Ajustes: solo admins.
  foreach t in array array['horario_laboral', 'festivos', 'sla_politicas'] loop
    execute format('drop policy if exists admin on hub.%I', t);
    execute format('create policy admin on hub.%I for all to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()))', t);
  end loop;
end $$;
drop policy if exists escribir on hub.plantillas_respuesta;
create policy escribir on hub.plantillas_respuesta for all to authenticated
  using ((select hub.es_usuario())) with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.correos_entrantes;
create policy cambiar on hub.correos_entrantes for update to authenticated
  using ((select hub.es_usuario())) with check ((select hub.es_usuario()));

-- ── Valoración (la guarda ticket-valorar, con el token del enlace) ──────
create or replace function hub.valorar_ticket(p_token uuid, p_nota integer, p_comentario text)
returns table (numero integer, titulo text) language plpgsql security definer set search_path = hub as $fn$
begin
  if p_nota is not null and (p_nota < 1 or p_nota > 5) then raise exception 'La nota va de 1 a 5'; end if;
  if p_nota is not null then
    update hub.tickets t set valoracion = p_nota, valoracion_comentario = left(nullif(trim(p_comentario), ''), 2000), valoracion_at = now()
     where t.valoracion_token = p_token and (t.valoracion_at is null or t.valoracion_at > now() - interval '30 days');
  end if;
  return query select t.numero, t.titulo from hub.tickets t where t.valoracion_token = p_token;
end
$fn$;
revoke execute on function hub.valorar_ticket(uuid, integer, text) from public, anon, authenticated;
grant execute on function hub.valorar_ticket(uuid, integer, text) to service_role;

-- ── Correo cada 5 minutos ────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'hub-correo';
select cron.schedule('hub-correo', '*/5 * * * *', $$select hub.lanzar_funcion('desk-correo', '{"accion":"leer"}')$$);

-- ── Motor de avisos: SLA, sin asignar y bandeja de correo ───────────────
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
