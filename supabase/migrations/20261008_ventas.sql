-- ════════════════════════════════════════════════════════════════════════
-- Fase 4 · Ventas: cliente 360, oportunidades, actividades y cobros.
--
-- Decidido con Fran (2026-09-27):
--   · Clientes, contactos y sitios siguen mandando en la app (espejo): el hub
--     pone ENCIMA su capa de CRM (hub.clientes_crm, hub.actividades, clase
--     A/B/C, línea de tiempo), sin escribir en el espejo.
--   · Las oportunidades pasan al hub (área 'oportunidades', dueño 'hub'):
--     copia inicial y, como la app las sigue creando sola (formulario web,
--     WhatsApp), sync-app importa sus ALTAS (hub.areas.importar_altas) sin
--     pisar nunca lo editado en el hub.
--   · Recordatorios de cobro: se PREPARAN (hub.cobros_recordatorios) y se
--     mandan a mano con un clic; nada sale solo hacia el cliente.
-- ════════════════════════════════════════════════════════════════════════

-- ── Áreas: importar altas de un área ya cortada ─────────────────────────
alter table hub.areas add column if not exists importar_altas boolean not null default false;
comment on column hub.areas.importar_altas is
  'Con dueño hub: sync-app sigue trayendo las filas NUEVAS de la app (insert sin pisar) porque la app aún las crea sola.';

-- ── Embudos (pipelines) ─────────────────────────────────────────────────
-- etapas: [{clave, nombre, probabilidad (0-100), tipo: abierta|ganada|perdida}]
create table if not exists hub.pipelines (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  nombre      text not null,
  etapas      jsonb not null,
  por_defecto boolean not null default false,
  orden       integer not null default 0,
  activo      boolean not null default true
);
create unique index if not exists pipelines_defecto_uk on hub.pipelines (por_defecto) where por_defecto;
drop trigger if exists tocar_updated_at on hub.pipelines;
create trigger tocar_updated_at before update on hub.pipelines for each row execute function hub.tocar_updated_at();
alter table hub.pipelines enable row level security;
grant select, insert, update, delete on hub.pipelines to authenticated;
grant all on hub.pipelines to service_role;
drop policy if exists leer on hub.pipelines;
create policy leer on hub.pipelines for select to authenticated using ((select hub.es_usuario()));
drop policy if exists admin on hub.pipelines;
create policy admin on hub.pipelines for all to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()));
select hub.auditar('pipelines');

-- Las etapas de la app, tal cual (así las oportunidades copiadas valen sin tocarlas).
insert into hub.pipelines (id, nombre, por_defecto, etapas) values
  ('00000000-0000-4000-8000-000000000001', 'Ventas', true, '[
    {"clave":"Detectado","nombre":"Detectado","probabilidad":10,"tipo":"abierta"},
    {"clave":"Contactado","nombre":"Contactado","probabilidad":25,"tipo":"abierta"},
    {"clave":"Propuesta","nombre":"Propuesta","probabilidad":50,"tipo":"abierta"},
    {"clave":"Negociando","nombre":"Negociando","probabilidad":75,"tipo":"abierta"},
    {"clave":"Ganado","nombre":"Ganado","probabilidad":100,"tipo":"ganada"},
    {"clave":"Perdido","nombre":"Perdido","probabilidad":0,"tipo":"perdida"}]')
on conflict (id) do nothing;

-- ── Oportunidades (mismas columnas que la app + las del hub) ────────────
create table if not exists hub.oportunidades (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  titulo           text not null,
  cliente_id       uuid,
  descripcion      text,
  estado           text default 'Detectado',       -- la clave de la etapa en su embudo
  valor_estimado   numeric default 0,
  tecnico_id       text,                            -- nombre, como en la app
  fecha_seguimiento date,
  motivo_perdida   text,
  origen           text,
  local_id         uuid,
  contacto_id      uuid,
  -- del hub
  pipeline_id      uuid not null default '00000000-0000-4000-8000-000000000001' references hub.pipelines(id),
  orden            integer not null default 0,
  updated_at       timestamptz not null default now(),
  cerrada_at       timestamptz
);
create index if not exists oport_pipeline_idx on hub.oportunidades (pipeline_id, estado, orden);
create index if not exists oport_cliente_idx on hub.oportunidades (cliente_id);

-- La etapa tiene que existir en su embudo; cerrar (ganada/perdida) apunta la fecha.
create or replace function hub.oportunidad_etapa()
returns trigger language plpgsql set search_path = hub as $fn$
declare v_tipo text;
begin
  select e->>'tipo' into v_tipo from hub.pipelines p, jsonb_array_elements(p.etapas) e
   where p.id = new.pipeline_id and e->>'clave' = new.estado;
  if v_tipo is null then
    raise exception 'La etapa «%» no existe en ese embudo', new.estado;
  end if;
  if v_tipo in ('ganada', 'perdida') then new.cerrada_at := coalesce(new.cerrada_at, now());
  else new.cerrada_at := null; end if;
  new.updated_at := now();
  return new;
end
$fn$;
drop trigger if exists etapa on hub.oportunidades;
create trigger etapa before insert or update on hub.oportunidades for each row execute function hub.oportunidad_etapa();

alter table hub.oportunidades enable row level security;
grant select, insert, update, delete on hub.oportunidades to authenticated;
grant all on hub.oportunidades to service_role;
drop policy if exists leer on hub.oportunidades;
create policy leer on hub.oportunidades for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.oportunidades;
create policy crear on hub.oportunidades for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.oportunidades;
create policy cambiar on hub.oportunidades for update to authenticated using ((select hub.es_usuario())) with check ((select hub.es_usuario()));
drop policy if exists borrar on hub.oportunidades;
create policy borrar on hub.oportunidades for delete to authenticated using ((select hub.es_admin()));
select hub.auditar('oportunidades');

insert into hub.areas (area, dueno, tablas, cortada_at, notas, importar_altas)
values ('oportunidades', 'hub', '{oportunidades}', now(), 'Fase 4: se llevan en el hub; las altas que crea la app (web, WhatsApp) se siguen importando', true)
on conflict (area) do update set dueno = 'hub', tablas = excluded.tablas, importar_altas = true,
  cortada_at = coalesce(hub.areas.cortada_at, excluded.cortada_at), notas = excluded.notas;

-- ── Actividades: la línea de tiempo de lo que se hace con cada cliente ──
create table if not exists hub.actividades (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  fecha           timestamptz not null default now(),
  tipo            text not null default 'nota' check (tipo in ('nota', 'llamada', 'visita', 'email', 'whatsapp', 'reunion')),
  texto           text not null check (length(btrim(texto)) > 0),
  cliente_id      uuid,
  local_id        uuid,
  contacto_id     uuid,
  oportunidad_id  uuid references hub.oportunidades(id) on delete cascade,
  usuario_id      uuid default (hub.usuario_actual()).id references hub.usuarios(id) on delete set null
);
create index if not exists actividades_cliente_idx on hub.actividades (cliente_id, fecha desc);
create index if not exists actividades_oport_idx on hub.actividades (oportunidad_id, fecha desc);
alter table hub.actividades enable row level security;
grant select, insert, update, delete on hub.actividades to authenticated;
grant all on hub.actividades to service_role;
drop policy if exists leer on hub.actividades;
create policy leer on hub.actividades for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.actividades;
create policy crear on hub.actividades for insert to authenticated
  with check ((select hub.es_usuario()) and usuario_id = (select (hub.usuario_actual()).id));
drop policy if exists cambiar on hub.actividades;
create policy cambiar on hub.actividades for update to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()))
  with check (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()));
drop policy if exists borrar on hub.actividades;
create policy borrar on hub.actividades for delete to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()));
select hub.auditar('actividades');

-- ── CRM del cliente: lo que el hub añade a la ficha de la app ───────────
create table if not exists hub.clientes_crm (
  cliente_id       uuid primary key,
  clase_manual     text check (clase_manual in ('A', 'B', 'C')),
  siguiente_fecha  date,
  siguiente_texto  text,
  responsable_id   uuid references hub.usuarios(id) on delete set null,
  etiquetas        text[] not null default '{}',
  updated_at       timestamptz not null default now()
);
create index if not exists clientes_crm_siguiente_idx on hub.clientes_crm (siguiente_fecha) where siguiente_fecha is not null;
drop trigger if exists tocar_updated_at on hub.clientes_crm;
create trigger tocar_updated_at before update on hub.clientes_crm for each row execute function hub.tocar_updated_at();
alter table hub.clientes_crm enable row level security;
grant select, insert, update on hub.clientes_crm to authenticated;
grant all on hub.clientes_crm to service_role;
drop policy if exists leer on hub.clientes_crm;
create policy leer on hub.clientes_crm for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.clientes_crm;
create policy crear on hub.clientes_crm for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.clientes_crm;
create policy cambiar on hub.clientes_crm for update to authenticated using ((select hub.es_usuario())) with check ((select hub.es_usuario()));
select hub.auditar('clientes_crm');

-- ── Clase A/B/C (Pareto) ─────────────────────────────────────────────────
-- Con Zoho: por lo facturado en 12 meses (A = los que suman el 80 %, B = el
-- 15 % siguiente, C = el resto). Sin Zoho todavía: por trabajos del año. La
-- clase puesta a mano manda. No devuelve importes: la ve todo el equipo.
create or replace function hub.clases_clientes()
returns table (cliente_id uuid, clase text, clase_auto text)
language sql stable security definer set search_path = hub as $fn$
  with hay_zoho as (select exists (select 1 from hub.zoho_facturas limit 1) as si),
  puntos as (
    select c.id,
           case when (select si from hay_zoho)
                then coalesce((select sum(f.total) from hub.zoho_facturas f
                                where f.cliente_zoho_id = c.zoho_id and f.estado not in ('void', 'draft')
                                  and f.fecha > current_date - 365), 0)
                else (select count(*) from hub.trabajos t where t.cliente_id = c.id and t.created_at > now() - interval '365 days')
           end::numeric as p
      from hub.clientes c
     where c.activo is not false and (coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario())
  ),
  acum as (
    -- fr = lo acumulado ANTES de este cliente: el primero siempre es A aunque él solo pase del 80 %
    select id, p, (sum(p) over (order by p desc, id rows unbounded preceding) - p) / nullif(sum(p) over (), 0) as fr from puntos
  )
  select a.id,
         coalesce(m.clase_manual, case when a.p <= 0 then 'C' when a.fr < 0.80 then 'A' when a.fr < 0.95 then 'B' else 'C' end),
         case when a.p <= 0 then 'C' when a.fr < 0.80 then 'A' when a.fr < 0.95 then 'B' else 'C' end
    from acum a left join hub.clientes_crm m on m.cliente_id = a.id
$fn$;
revoke execute on function hub.clases_clientes() from public, anon;
grant execute on function hub.clases_clientes() to authenticated, service_role;

-- ── Línea de tiempo de un cliente ───────────────────────────────────────
-- Actividades del hub + lo que ya existe en la copia de la app (trabajos,
-- tickets, presupuestos) + oportunidades + (solo admins) facturas y cobros.
create or replace function hub.linea_tiempo(p_cliente uuid, p_limite integer default 100)
returns table (fecha timestamptz, tipo text, titulo text, detalle text, importe numeric, enlace text, autor text, ref_id text)
language plpgsql stable security definer set search_path = hub as $fn$
declare
  v_admin boolean := hub.admin_para(null);
  v_zoho_id text := (select zoho_id from hub.clientes where id = p_cliente);
begin
  if not (coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario()) then return; end if;
  return query
  select * from (
    select a.fecha, 'actividad_' || a.tipo, initcap(a.tipo), a.texto, null::numeric, null::text, u.nombre, a.id::text
      from hub.actividades a left join hub.usuarios u on u.id = a.usuario_id where a.cliente_id = p_cliente
    union all
    select t.created_at, 'trabajo', '#' || t.numero || ' ' || coalesce(t.titulo, left(t.descripcion, 80), ''), t.estado,
           null::numeric, null::text, array_to_string(t.tecnicos, ', '), t.id::text
      from hub.trabajos t where t.cliente_id = p_cliente
    union all
    select k.created_at, 'ticket', '#' || k.numero || ' ' || coalesce(k.titulo, ''), k.estado, null::numeric, null::text, k.tecnico_id, k.id::text
      from hub.tickets k where k.cliente_id = p_cliente
    union all
    select coalesce(p.fecha::timestamptz, p.created_at), 'presupuesto', coalesce(p.numero_presupuesto, '') || ' ' || coalesce(p.titulo, ''), p.estado,
           p.total, null::text, p.tecnico_id, p.id::text
      from hub.presupuestos p where p.cliente_id = p_cliente
    union all
    select o.created_at, 'oportunidad', o.titulo, o.estado, o.valor_estimado, '#/oportunidades/' || o.id, o.tecnico_id, o.id::text
      from hub.oportunidades o where o.cliente_id = p_cliente
    union all
    select f.fecha::timestamptz, 'factura', f.numero, f.estado || case when f.saldo > 0 then ' · pendiente ' || f.saldo || ' €' else '' end,
           f.total, 'https://books.zoho.eu/app/20107733530#/invoices/' || f.invoice_id, null::text, f.invoice_id
      from hub.zoho_facturas f where v_admin and v_zoho_id is not null and f.cliente_zoho_id = v_zoho_id
    union all
    select c.fecha::timestamptz, 'cobro', 'Cobro ' || coalesce(c.numero, ''), coalesce(c.forma, '') || coalesce(' · ' || c.facturas, ''),
           c.importe, null::text, null::text, c.payment_id
      from hub.zoho_cobros c where v_admin and v_zoho_id is not null and c.cliente_zoho_id = v_zoho_id
  ) x
  order by 1 desc nulls last
  limit greatest(1, least(p_limite, 500));
end
$fn$;
revoke execute on function hub.linea_tiempo(uuid, integer) from public, anon;
grant execute on function hub.linea_tiempo(uuid, integer) to authenticated, service_role;

-- ── Recordatorios de cobro (preparados, nunca enviados solos) ───────────
create table if not exists hub.cobros_recordatorios (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  invoice_id       text not null,
  numero           text,
  cliente_zoho_id  text,
  cliente_nombre   text,
  saldo            numeric(12,2),
  vence            date,
  nivel            integer not null check (nivel between 1 and 3),
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'descartado')),
  texto            text not null,
  canal            text check (canal in ('whatsapp', 'email', 'telefono', 'otro')),
  enviado_at       timestamptz,
  enviado_por      uuid references hub.usuarios(id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (invoice_id, nivel)
);
create index if not exists cobros_rec_estado_idx on hub.cobros_recordatorios (estado, created_at desc);
drop trigger if exists tocar_updated_at on hub.cobros_recordatorios;
create trigger tocar_updated_at before update on hub.cobros_recordatorios for each row execute function hub.tocar_updated_at();
alter table hub.cobros_recordatorios enable row level security;
revoke insert, delete on hub.cobros_recordatorios from authenticated;
grant select, update on hub.cobros_recordatorios to authenticated;
grant all on hub.cobros_recordatorios to service_role;
drop policy if exists leer on hub.cobros_recordatorios;
create policy leer on hub.cobros_recordatorios for select to authenticated using ((select hub.es_admin()));
drop policy if exists cambiar on hub.cobros_recordatorios;
create policy cambiar on hub.cobros_recordatorios for update to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()));
select hub.auditar('cobros_recordatorios');

-- Plantillas (editables en hub.config): {cliente} {numero} {saldo} {vence} {dias}
insert into hub.config (clave, valor, descripcion) values
  ('recordatorio_dias', '[7, 21, 45]', 'Días de retraso a los que se prepara el 1.º, 2.º y 3.er recordatorio de cobro'),
  ('recordatorio_primero', to_jsonb('Hola {cliente}, le escribimos de Ok Computer Tenerife. Nos consta pendiente la factura {numero} de {saldo}, con vencimiento el {vence}. Si ya la ha abonado, ignore este mensaje. ¡Gracias!'::text), 'Texto del primer recordatorio de cobro'),
  ('recordatorio_segundo', to_jsonb('Hola {cliente}, le recordamos que la factura {numero} ({saldo}) lleva {dias} días vencida. ¿Nos confirma cuándo podrá abonarla? Quedamos a su disposición. Ok Computer Tenerife.'::text), 'Texto del segundo recordatorio de cobro'),
  ('recordatorio_tercero', to_jsonb('Hola {cliente}. La factura {numero} de {saldo} sigue pendiente ({dias} días desde el vencimiento). Necesitamos regularizarla esta semana; llámenos si hay cualquier problema. Ok Computer Tenerife.'::text), 'Texto del tercer recordatorio de cobro')
on conflict (clave) do nothing;

create or replace function hub.preparar_recordatorios()
returns integer language plpgsql security definer set search_path = hub as $fn$
declare
  v_hoy  date := (now() at time zone 'Atlantic/Canary')::date;
  v_dias jsonb := coalesce((select valor from hub.config where clave = 'recordatorio_dias'), '[7,21,45]');
  v_n    integer := 0;
  v_k    integer;
  r      record;
begin
  -- Pagada, anulada o ya sin saldo: lo pendiente deja de tener sentido.
  update hub.cobros_recordatorios c set estado = 'descartado'
   where c.estado = 'pendiente'
     and not exists (select 1 from hub.zoho_facturas f where f.invoice_id = c.invoice_id and f.saldo > 0 and f.estado not in ('void', 'paid', 'draft'));

  for r in
    select f.*, v_hoy - f.vence as dias,
           coalesce(nullif(split_part(cl.nombre, ' ', 1), ''), f.cliente_nombre) as saludo
      from hub.zoho_facturas f left join hub.clientes cl on cl.zoho_id = f.cliente_zoho_id
     where f.saldo > 0 and f.vence < v_hoy and f.estado not in ('void', 'paid', 'draft')
  loop
    -- el nivel más alto que ya toca
    v_k := case when r.dias >= (v_dias->>2)::int then 3 when r.dias >= (v_dias->>1)::int then 2 when r.dias >= (v_dias->>0)::int then 1 else 0 end;
    continue when v_k = 0;
    continue when exists (select 1 from hub.cobros_recordatorios c where c.invoice_id = r.invoice_id and c.nivel >= v_k);
    -- uno nuevo sustituye al pendiente de nivel inferior
    update hub.cobros_recordatorios set estado = 'descartado' where invoice_id = r.invoice_id and estado = 'pendiente';
    insert into hub.cobros_recordatorios (invoice_id, numero, cliente_zoho_id, cliente_nombre, saldo, vence, nivel, texto)
    values (r.invoice_id, r.numero, r.cliente_zoho_id, r.cliente_nombre, r.saldo, r.vence, v_k,
      replace(replace(replace(replace(replace(
        coalesce((select valor #>> '{}' from hub.config where clave = 'recordatorio_' || (array['primero','segundo','tercero'])[v_k]), 'Factura {numero} pendiente: {saldo}'),
        '{cliente}', coalesce(r.saludo, '')), '{numero}', coalesce(r.numero, '')),
        '{saldo}', replace(to_char(r.saldo, 'FM999999990.00'), '.', ',') || ' €'), '{vence}', to_char(r.vence, 'DD/MM/YYYY')), '{dias}', r.dias::text))
    on conflict (invoice_id, nivel) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$fn$;
revoke execute on function hub.preparar_recordatorios() from public, anon, authenticated;
grant execute on function hub.preparar_recordatorios() to service_role;
select cron.schedule('hub-recordatorios', '20 7 * * *', $$select hub.preparar_recordatorios()$$);

-- ── Motor de avisos: los de ventas y cobros ─────────────────────────────
-- (misma función de 20261007_mando.sql con cuatro tipos más: lead sin
-- contestar, seguimiento vencido, «lo siguiente» vencido y recordatorio de
-- cobro listo)
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

  -- Ticket abierto sin nadie asignado.
  return query
  select 'ticket:' || t.id, 'ticket_sin_asignar', case when t.prioridad in ('alta', 'urgente') then 'mal' else 'aviso' end,
         'Ticket sin asignar: #' || t.numero || ' ' || coalesce(t.titulo, ''),
         coalesce(c.nombre, '') || coalesce(' · prioridad ' || t.prioridad, ''), null::numeric, v_app, t.created_at, null::text, false
    from hub.tickets t left join hub.clientes c on c.id = t.cliente_id
   where t.estado in ('Abierto', 'En curso') and coalesce(t.tecnico_id, '') = '';

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
revoke execute on function hub.panorama_direccion(uuid) from public, anon;
grant execute on function hub.panorama_direccion(uuid) to authenticated, service_role;
