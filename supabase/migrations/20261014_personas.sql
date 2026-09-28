-- ════════════════════════════════════════════════════════════════════════
-- Fase 10 · Personas: registro de jornada (RD-ley 8/2019), ausencias, tickets
-- de gasto leídos por Claude, acceso de la gestoría y firma de documentos.
--
--   · Jornada: se CALCULA sobre los fichajes de la app (hub.sesiones, espejo):
--     entrada = primer traslado/inicio del día, salida = último fin, tiempo
--     trabajado = la unión de los tramos (sin contar dos veces lo solapado).
--     Las correcciones no tocan el fichaje: van a hub.jornada_ajustes con su
--     motivo y su autor (la ley pide saber qué se cambió y quién). Cada
--     persona da su conformidad al mes (hub.jornada_cierres).
--   · La GESTORÍA entra como un cliente del portal (enlace mágico, sesión
--     propia, traza de todo lo que consulta): portal_accesos.tipo = 'gestoria'.
--   · Firma: cualquier documento (markdown) con enlace público de un solo
--     firmante; la huella sha256 del texto se fija al crearlo y se comprueba
--     al firmar; lo firmado ya no se puede cambiar.
-- ════════════════════════════════════════════════════════════════════════

-- ── Gestoría: un tipo más de acceso del portal ──────────────────────────
alter table hub.portal_accesos add column if not exists tipo text not null default 'cliente';
alter table hub.portal_accesos drop constraint if exists portal_accesos_tipo_check;
alter table hub.portal_accesos add constraint portal_accesos_tipo_check check (tipo in ('cliente', 'gestoria'));
alter table hub.portal_accesos alter column cliente_id drop not null;
alter table hub.portal_accesos drop constraint if exists portal_accesos_cliente_check;
alter table hub.portal_accesos add constraint portal_accesos_cliente_check check (tipo <> 'cliente' or cliente_id is not null);

-- ── Días laborables entre dos fechas (horario + festivos de la fase 6) ──
create or replace function hub.dias_laborables(p_desde date, p_hasta date)
returns integer language sql stable set search_path = hub as $fn$
  select count(*)::integer from generate_series(p_desde, p_hasta, interval '1 day') d
   where exists (select 1 from hub.horario_laboral h where h.dia_semana = extract(isodow from d))
     and not exists (select 1 from hub.festivos f where f.fecha = d::date)
$fn$;

-- ── Jornada ──────────────────────────────────────────────────────────────
create table if not exists hub.jornada_ajustes (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null,
  fecha       date not null,
  entrada     timestamptz not null,
  salida      timestamptz not null check (salida > entrada),
  pausa_min   integer not null default 0 check (pausa_min >= 0),
  motivo      text not null check (length(trim(motivo)) >= 5),
  creado_por  uuid,
  created_at  timestamptz not null default now(),
  unique (usuario_id, fecha)
);
create table if not exists hub.jornada_cierres (
  usuario_id    uuid not null,
  mes           date not null check (extract(day from mes) = 1),
  confirmado_at timestamptz not null default now(),
  nota          text,
  primary key (usuario_id, mes)
);

create or replace function hub.jornada_ajuste_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  new.creado_por := (hub.usuario_actual()).id;
  return new;
end
$fn$;
drop trigger if exists jornada_ajuste_antes on hub.jornada_ajustes;
create trigger jornada_ajuste_antes before insert or update on hub.jornada_ajustes for each row execute function hub.jornada_ajuste_antes();

-- ── Ausencias ────────────────────────────────────────────────────────────
create table if not exists hub.ausencias (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  usuario_id   uuid not null,
  tipo         text not null check (tipo in ('vacaciones', 'asuntos_propios', 'baja', 'permiso', 'otro')),
  desde        date not null,
  hasta        date not null,
  dias         integer,            -- laborables (lo calcula la base)
  estado       text not null default 'solicitada' check (estado in ('solicitada', 'aprobada', 'rechazada', 'anulada')),
  nota         text,
  respuesta    text,
  decidida_por uuid,
  decidida_at  timestamptz,
  check (hasta >= desde)
);
create index if not exists ausencias_usuario_idx on hub.ausencias (usuario_id, desde);

-- Una fila por persona y día con fichajes, ajuste o ausencia.
create or replace function hub.jornada(p_desde date, p_hasta date, p_usuario uuid default null)
returns table (usuario_id uuid, nombre text, fecha date, entrada timestamptz, salida timestamptz,
               trabajado_min integer, pausas_min integer, sesiones integer, ajustado boolean, motivo_ajuste text, ausencia text)
language sql stable security definer set search_path = hub as $fn$
  with yo as (select hub.usuario_actual() as u, coalesce(auth.jwt()->>'role', '') = 'service_role' as servicio),
  quien as (
    select us.id, us.nombre from hub.usuarios us, yo
     where (yo.servicio or (yo.u).rol = 'admin' or us.id = (yo.u).id)
       and (p_usuario is null or us.id = p_usuario)
  ),
  tramos as (
    select coalesce(s.tecnico_id, (select us.id from hub.usuarios us where lower(us.nombre) = lower(s.tecnico_nombre) limit 1)) as uid,
           (coalesce(s.traslado, s.inicio) at time zone 'Atlantic/Canary')::date as dia,
           coalesce(s.traslado, s.inicio) as ini, s.fin
      from hub.sesiones s
     where coalesce(s.traslado, s.inicio) >= (p_desde::timestamp at time zone 'Atlantic/Canary')
       and coalesce(s.traslado, s.inicio) < ((p_hasta + 1)::timestamp at time zone 'Atlantic/Canary')
       and s.fin is not null and s.fin > coalesce(s.traslado, s.inicio)
  ),
  dias as (
    select t.uid, t.dia, min(t.ini) as entrada, max(t.fin) as salida, count(*)::integer as n,
           (select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)
              from unnest(range_agg(tstzrange(t.ini, t.fin))) r)::integer / 60 as trabajado
      from tramos t group by t.uid, t.dia
  ),
  aus as (
    select a.usuario_id as uid, d::date as dia, a.tipo
      from hub.ausencias a, generate_series(greatest(a.desde, p_desde), least(a.hasta, p_hasta), interval '1 day') d
     where a.estado = 'aprobada' and a.hasta >= p_desde and a.desde <= p_hasta
  ),
  claves as (
    select uid, dia from dias union select usuario_id, fecha from hub.jornada_ajustes where fecha between p_desde and p_hasta union select uid, dia from aus
  )
  select q.id, q.nombre, k.dia,
         coalesce(aj.entrada, d.entrada), coalesce(aj.salida, d.salida),
         case when aj.id is not null then (extract(epoch from aj.salida - aj.entrada) / 60)::integer - aj.pausa_min else d.trabajado end,
         case when aj.id is not null then aj.pausa_min else greatest((extract(epoch from d.salida - d.entrada) / 60)::integer - d.trabajado, 0) end,
         coalesce(d.n, 0), aj.id is not null, aj.motivo, au.tipo
    from claves k join quien q on q.id = k.uid
    left join dias d on d.uid = k.uid and d.dia = k.dia
    left join hub.jornada_ajustes aj on aj.usuario_id = k.uid and aj.fecha = k.dia
    left join aus au on au.uid = k.uid and au.dia = k.dia
   order by q.nombre, k.dia
$fn$;

create or replace function hub.ausencia_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  new.dias := hub.dias_laborables(new.desde, new.hasta);
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado and new.estado in ('aprobada', 'rechazada') then
    new.decidida_por := (hub.usuario_actual()).id; new.decidida_at := now();
  end if;
  -- Una baja la apunta el admin ya aprobada; las demás se piden.
  if tg_op = 'INSERT' and new.tipo = 'baja' and hub.es_admin() then new.estado := 'aprobada'; end if;
  return new;
end
$fn$;
drop trigger if exists ausencia_antes on hub.ausencias;
create trigger ausencia_antes before insert or update on hub.ausencias for each row execute function hub.ausencia_antes();

insert into hub.config (clave, valor, descripcion) values
  ('vacaciones_dias', '22'::jsonb, 'Días laborables de vacaciones al año por persona')
on conflict (clave) do nothing;

-- ── Tickets de gasto (foto o PDF → Claude) ───────────────────────────────
create table if not exists hub.tickets_gasto (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  subido_por     uuid,
  archivo_path   text,             -- en el almacén privado «gastos»
  archivo_tipo   text,
  fecha          date,
  proveedor      text,
  nif            text,
  concepto       text,
  base           numeric,
  impuesto_pct   numeric,
  impuesto       numeric,
  total          numeric,
  categoria      text,
  forma_pago     text,
  estado         text not null default 'leyendo' check (estado in ('leyendo', 'revisar', 'ok', 'error')),
  leido_por_claude boolean not null default false,
  datos_ocr      jsonb,
  error          text,
  notas          text,
  revisado_por   uuid,
  revisado_at    timestamptz
);
create index if not exists tickets_gasto_fecha_idx on hub.tickets_gasto (fecha);

create or replace function hub.ticket_gasto_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_op = 'INSERT' then new.subido_por := coalesce(new.subido_por, (hub.usuario_actual()).id); end if;
  if new.estado = 'ok' and (tg_op = 'INSERT' or old.estado <> 'ok') then
    new.revisado_por := (hub.usuario_actual()).id; new.revisado_at := now();
  end if;
  return new;
end
$fn$;
drop trigger if exists ticket_gasto_antes on hub.tickets_gasto;
create trigger ticket_gasto_antes before insert or update on hub.tickets_gasto for each row execute function hub.ticket_gasto_antes();

-- ── Cierre del mes (lo revisa la gestoría, lo cierra un admin) ──────────
create table if not exists hub.cierres_mes (
  mes            date primary key check (extract(day from mes) = 1),
  estado         text not null default 'abierto' check (estado in ('abierto', 'revisado', 'cerrado')),
  nota_gestoria  text,
  revisado_at    timestamptz,
  revisado_por   text,              -- correo de la gestoría
  cerrado_at     timestamptz,
  cerrado_por    uuid,
  nota           text
);

-- ── Firma de documentos ─────────────────────────────────────────────────
create table if not exists hub.firmas (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  creado_por      uuid,
  titulo          text not null check (length(trim(titulo)) > 0),
  contenido       text not null check (length(trim(contenido)) > 0),
  contenido_hash  text,
  cliente_id      uuid,
  firmante_nombre text,
  firmante_email  text,
  token           uuid not null default gen_random_uuid() unique,
  caduca_at       timestamptz not null default now() + interval '30 days',
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'firmado', 'anulado')),
  firmado_at      timestamptz,
  firma_img       text,             -- data:image/png;base64,…
  firmado_nombre  text,
  firmado_dni     text,
  firmado_ip      text,
  firmado_ua      text,
  enviado_at      timestamptz
);

-- Lo que ve el firmante y la firma en sí (solo la función `firma`).
create or replace function hub.firma_ver(p_token uuid)
returns table (titulo text, contenido text, contenido_hash text, estado text, firmante_nombre text, caducado boolean, firmado_at timestamptz)
language sql stable security definer set search_path = hub as $fn$
  select f.titulo, f.contenido, f.contenido_hash, f.estado, f.firmante_nombre, f.caduca_at < now(), f.firmado_at from hub.firmas f where f.token = p_token
$fn$;
create or replace function hub.firma_firmar(p_token uuid, p_hash text, p_nombre text, p_dni text, p_img text, p_ip text, p_ua text)
returns timestamptz language plpgsql security definer set search_path = hub as $fn$
declare v hub.firmas; v_at timestamptz := now();
begin
  select * into v from hub.firmas where token = p_token for update;
  if not found or v.estado <> 'pendiente' then raise exception 'Este documento ya no se puede firmar'; end if;
  if v.caduca_at < now() then raise exception 'El enlace ha caducado: pide otro'; end if;
  if v.contenido_hash <> p_hash then raise exception 'El documento ha cambiado mientras lo leías: recarga la página'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Escribe tu nombre completo'; end if;
  if p_img is null or p_img !~ '^data:image/png;base64,' or length(p_img) > 400000 then raise exception 'Falta la firma'; end if;
  -- El trigger deja pasar el estado «firmado» solo aquí (dueño de la función / service_role).
  update hub.firmas set estado = 'firmado', firmado_at = v_at, firma_img = p_img, firmado_nombre = trim(p_nombre),
         firmado_dni = nullif(trim(coalesce(p_dni, '')), ''), firmado_ip = p_ip, firmado_ua = left(p_ua, 400)
   where id = v.id;
  return v_at;
end
$fn$;
revoke execute on function hub.firma_ver(uuid) from public, anon, authenticated;
revoke execute on function hub.firma_firmar(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function hub.firma_ver(uuid), hub.firma_firmar(uuid, text, text, text, text, text, text) to service_role;

create or replace function hub.firma_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(new.creado_por, (hub.usuario_actual()).id);
    new.estado := 'pendiente'; new.firmado_at := null; new.firma_img := null;
  elsif old.estado = 'firmado' then
    raise exception 'Un documento firmado no se puede cambiar';
  elsif old.estado = 'anulado' and new.estado <> 'anulado' then
    raise exception 'Un documento anulado no se recupera: crea otro';
  elsif new.estado = 'firmado' then
    -- Solo desde hub.firma_firmar (service_role) y sin tocar el texto.
    if coalesce(auth.jwt()->>'role', '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
      raise exception 'Solo el firmante firma';
    end if;
    if new.contenido is distinct from old.contenido or new.titulo is distinct from old.titulo then raise exception 'No se cambia el texto al firmar'; end if;
  elsif (new.contenido is distinct from old.contenido or new.titulo is distinct from old.titulo) and new.estado = 'pendiente' then
    new.token := gen_random_uuid();
  end if;
  if new.estado <> 'firmado' and (new.firma_img is not null or new.firmado_at is not null) then raise exception 'Solo el firmante firma'; end if;
  new.contenido_hash := encode(sha256(convert_to(new.titulo || E'\n' || new.contenido, 'UTF8')), 'hex');
  return new;
end
$fn$;
drop trigger if exists firma_antes on hub.firmas;
create trigger firma_antes before insert or update on hub.firmas for each row execute function hub.firma_antes();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table hub.jornada_ajustes enable row level security;
alter table hub.jornada_cierres enable row level security;
alter table hub.ausencias       enable row level security;
alter table hub.tickets_gasto   enable row level security;
alter table hub.cierres_mes     enable row level security;
alter table hub.firmas          enable row level security;
grant select, insert, update, delete on hub.jornada_ajustes, hub.jornada_cierres, hub.ausencias, hub.tickets_gasto, hub.cierres_mes, hub.firmas to authenticated;
grant all on hub.jornada_ajustes, hub.jornada_cierres, hub.ausencias, hub.tickets_gasto, hub.cierres_mes, hub.firmas to service_role;

-- Ajustes de jornada: los ve el interesado y los admins; los pone un admin.
drop policy if exists leer on hub.jornada_ajustes;
create policy leer on hub.jornada_ajustes for select to authenticated using ((select hub.es_admin()) or usuario_id = (select (hub.usuario_actual()).id));
drop policy if exists admin on hub.jornada_ajustes;
create policy admin on hub.jornada_ajustes for all to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()));
-- Conformidad del mes: cada uno la suya.
drop policy if exists leer on hub.jornada_cierres;
create policy leer on hub.jornada_cierres for select to authenticated using ((select hub.es_admin()) or usuario_id = (select (hub.usuario_actual()).id));
drop policy if exists propia on hub.jornada_cierres;
create policy propia on hub.jornada_cierres for insert to authenticated with check (usuario_id = (select (hub.usuario_actual()).id));
-- Ausencias: el equipo las ve (para planificar); cada uno pide las suyas; decide un admin.
drop policy if exists leer on hub.ausencias;
create policy leer on hub.ausencias for select to authenticated using ((select hub.es_usuario()));
drop policy if exists pedir on hub.ausencias;
create policy pedir on hub.ausencias for insert to authenticated
  with check ((select hub.es_admin()) or (usuario_id = (select (hub.usuario_actual()).id) and estado = 'solicitada'));
drop policy if exists cambiar on hub.ausencias;
create policy cambiar on hub.ausencias for update to authenticated
  using ((select hub.es_admin()) or (usuario_id = (select (hub.usuario_actual()).id) and estado = 'solicitada'))
  with check ((select hub.es_admin()) or (usuario_id = (select (hub.usuario_actual()).id) and estado in ('solicitada', 'anulada')));
drop policy if exists borrar on hub.ausencias;
create policy borrar on hub.ausencias for delete to authenticated using ((select hub.es_admin()));
-- Gastos: el que lo sube y los admins.
drop policy if exists leer on hub.tickets_gasto;
create policy leer on hub.tickets_gasto for select to authenticated using ((select hub.es_admin()) or subido_por = (select (hub.usuario_actual()).id));
drop policy if exists crear on hub.tickets_gasto;
create policy crear on hub.tickets_gasto for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.tickets_gasto;
create policy cambiar on hub.tickets_gasto for update to authenticated
  using ((select hub.es_admin()) or (subido_por = (select (hub.usuario_actual()).id) and estado <> 'ok'))
  with check ((select hub.es_admin()) or (subido_por = (select (hub.usuario_actual()).id) and estado <> 'ok'));
drop policy if exists borrar on hub.tickets_gasto;
create policy borrar on hub.tickets_gasto for delete to authenticated using ((select hub.es_admin()));
-- Cierre del mes: admins (la gestoría, por la función del portal).
drop policy if exists admin on hub.cierres_mes;
create policy admin on hub.cierres_mes for all to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()));
-- Firmas: el equipo las ve y las crea; cambiar, quien la creó o un admin; borrar, admin y sin firmar.
drop policy if exists leer on hub.firmas;
create policy leer on hub.firmas for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.firmas;
create policy crear on hub.firmas for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.firmas;
create policy cambiar on hub.firmas for update to authenticated
  using ((select hub.es_admin()) or creado_por = (select (hub.usuario_actual()).id)) with check ((select hub.es_usuario()));
drop policy if exists borrar on hub.firmas;
create policy borrar on hub.firmas for delete to authenticated using ((select hub.es_admin()) and estado <> 'firmado');

select hub.auditar('jornada_ajustes');
select hub.auditar('jornada_cierres');
select hub.auditar('ausencias');
select hub.auditar('tickets_gasto');
select hub.auditar('cierres_mes');
select hub.auditar('firmas');

revoke execute on function hub.jornada(date, date, uuid) from public, anon;
grant execute on function hub.jornada(date, date, uuid) to authenticated, service_role;

-- ── Avisos de la fase ────────────────────────────────────────────────────
create or replace function hub.avisos_personas(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language sql stable security definer set search_path = hub as $fn$
  select 'ausencia:' || a.id, 'ausencia_por_decidir', 'aviso',
         'Ausencia por aprobar: ' || u.nombre, a.tipo || ' del ' || to_char(a.desde, 'DD/MM') || ' al ' || to_char(a.hasta, 'DD/MM') || ' (' || a.dias || ' días)',
         null::numeric, '#/personas/ausencias', a.created_at, u.nombre, false
    from hub.ausencias a join hub.usuarios u on u.id = a.usuario_id
   where a.estado = 'solicitada' and p_admin
  union all
  select 'firma:' || f.id, 'firma_pendiente', case when f.caduca_at < now() + interval '3 days' then 'mal' else 'aviso' end,
         'Documento sin firmar: ' || f.titulo, coalesce(f.firmante_nombre, '') || ' · enviado ' || to_char(coalesce(f.enviado_at, f.created_at) at time zone 'Atlantic/Canary', 'DD/MM')
           || ' · caduca el ' || to_char(f.caduca_at at time zone 'Atlantic/Canary', 'DD/MM'),
         null::numeric, '#/firmas/' || f.id, f.created_at, (select nombre from hub.usuarios where id = f.creado_por), false
    from hub.firmas f where f.estado = 'pendiente' and f.created_at < now() - interval '3 days'
  union all
  select 'gastos_revisar', 'gastos_por_revisar', 'aviso', count(*) || ' ticket(s) de gasto por revisar', 'Leídos por Claude: confirma los datos',
         sum(g.total), '#/personas/gastos', max(g.created_at), null::text, true
    from hub.tickets_gasto g where g.estado in ('revisar', 'error') and p_admin
  having count(*) > 0
  union all
  select 'cierre_mes:' || to_char(date_trunc('month', now() at time zone 'Atlantic/Canary') - interval '1 month', 'YYYY-MM'), 'cierre_mes_personas', 'aviso',
         'Mes sin cerrar con la gestoría: ' || to_char(date_trunc('month', now() at time zone 'Atlantic/Canary') - interval '1 month', 'MM/YYYY'),
         coalesce('la gestoría lo dejó ' || c.estado, 'la gestoría aún no lo ha revisado'), null::numeric, '#/personas/cierre', null::timestamptz, null::text, true
    from (select 1) x
    left join hub.cierres_mes c on c.mes = (date_trunc('month', now() at time zone 'Atlantic/Canary') - interval '1 month')::date
   where p_admin and extract(day from now() at time zone 'Atlantic/Canary') > 5 and coalesce(c.estado, 'abierto') <> 'cerrado'
$fn$;
revoke execute on function hub.avisos_personas(uuid, boolean) from public, anon, authenticated;
grant execute on function hub.avisos_personas(uuid, boolean) to service_role;
