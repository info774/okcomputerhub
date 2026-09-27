-- ════════════════════════════════════════════════════════════════════════
-- Fase 3 · Puesto de mando y canal.
--
-- · Espejo de SOLO LECTURA de Zoho Books (cabeceras de facturas y cobros),
--   que rellena la función zoho-lectura cada 30 min (y entero cada noche).
--   Solo lo ven los admins: es dinero.
-- · hub.panorama_direccion(): el motor de avisos accionables. La MISMA lista
--   para el panel, el bot de Telegram y los informes. Los avisos de dinero
--   solo salen a un admin.
-- · hub.direccion_resumen(): tarjetas, ventas por mes y cuentas grandes.
-- · Telegram: hub.telegram_vinculos (persona ⇆ chat, por código de un uso).
-- · Informes programados: hub.informes_programados + hub.informes_envios;
--   los manda informes-enviar, que lanza pg_cron cada 15 min.
-- ════════════════════════════════════════════════════════════════════════

-- ── Zoho Books (espejo) ────────────────────────────────────────────────
create table if not exists hub.zoho_facturas (
  invoice_id      text primary key,
  numero          text,
  cliente_zoho_id text,
  cliente_nombre  text,
  fecha           date,
  vence           date,
  estado          text,          -- draft · sent · viewed · overdue · partially_paid · paid · void · unpaid
  total           numeric(12,2), -- con impuestos, como lo da Zoho
  saldo           numeric(12,2),
  modificada_at   timestamptz,
  sync_at         timestamptz not null default now()
);
create index if not exists zoho_facturas_fecha_idx on hub.zoho_facturas (fecha);
create index if not exists zoho_facturas_estado_idx on hub.zoho_facturas (estado) where saldo > 0;
create index if not exists zoho_facturas_cliente_idx on hub.zoho_facturas (cliente_zoho_id);

create table if not exists hub.zoho_cobros (
  payment_id      text primary key,
  numero          text,
  cliente_zoho_id text,
  cliente_nombre  text,
  fecha           date,
  importe         numeric(12,2),
  forma           text,
  facturas        text,          -- números de factura, como los da Zoho
  modificada_at   timestamptz,
  sync_at         timestamptz not null default now()
);
create index if not exists zoho_cobros_fecha_idx on hub.zoho_cobros (fecha);

do $$
declare t text;
begin
  foreach t in array array['zoho_facturas', 'zoho_cobros'] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('revoke insert, update, delete on hub.%I from authenticated', t);
    execute format('grant select on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_admin()))', t);
    perform hub.auditar(t);
  end loop;
end $$;

-- ── Secretos: el refresh token de Zoho lo guarda la propia función ──────
create or replace function hub.secreto(p_nombre text)
returns text language sql stable security definer set search_path = hub as $fn$
  select decrypted_secret from vault.decrypted_secrets
   where name = p_nombre
     and p_nombre = any(array['app_supabase_url', 'app_service_role_key', 'hub_sync_token',
                              'zoho_hub_refresh_token', 'telegram_webhook_secret'])
   limit 1
$fn$;
revoke execute on function hub.secreto(text) from public, anon, authenticated;
grant execute on function hub.secreto(text) to service_role;

-- Solo para lo que se obtiene en un canje (el refresh token de Zoho): así no
-- pasa por el chat ni por las variables de entorno.
create or replace function hub.guardar_secreto(p_nombre text, p_valor text)
returns void language plpgsql security definer set search_path = hub as $fn$
declare v_id uuid;
begin
  if p_nombre <> all(array['zoho_hub_refresh_token']) then
    raise exception 'secreto no permitido: %', p_nombre;
  end if;
  if coalesce(p_valor, '') = '' then raise exception 'valor vacío'; end if;
  select id into v_id from vault.decrypted_secrets where name = p_nombre limit 1;
  if v_id is null then perform vault.create_secret(p_valor, p_nombre);
  else perform vault.update_secret(v_id, p_valor); end if;
end
$fn$;
revoke execute on function hub.guardar_secreto(text, text) from public, anon, authenticated;
grant execute on function hub.guardar_secreto(text, text) to service_role;

-- ── Llamar a una edge function del hub desde pg_cron ───────────────────
-- Misma URL base y token que el sync (hub_sync_url / hub_sync_token): la
-- función se autoriza con la cabecera x-sync-token.
create or replace function hub.lanzar_funcion(p_funcion text, p_cuerpo jsonb default '{}')
returns bigint language plpgsql security definer set search_path = hub, extensions as $fn$
declare
  v_url   text := (select decrypted_secret from vault.decrypted_secrets where name = 'hub_sync_url');
  v_token text := (select decrypted_secret from vault.decrypted_secrets where name = 'hub_sync_token');
begin
  if p_funcion !~ '^[a-z0-9-]+$' then raise exception 'función no válida'; end if;
  if v_url is null or v_token is null then
    raise notice 'hub.lanzar_funcion: faltan hub_sync_url / hub_sync_token en el Vault';
    return null;
  end if;
  return net.http_post(
    url := regexp_replace(v_url, '/[a-z0-9-]+/?$', '/' || p_funcion),
    body := p_cuerpo,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', v_token),
    timeout_milliseconds := 120000);
end
$fn$;
revoke execute on function hub.lanzar_funcion(text, jsonb) from public, authenticated;

select cron.schedule('hub-zoho',          '*/30 * * * *', $$select hub.lanzar_funcion('zoho-lectura', '{"accion":"sincronizar"}')$$);
select cron.schedule('hub-zoho-completo', '45 3 * * *',   $$select hub.lanzar_funcion('zoho-lectura', '{"accion":"sincronizar","modo":"completo"}')$$);
select cron.schedule('hub-informes',      '*/15 * * * *', $$select hub.lanzar_funcion('informes-enviar', '{"accion":"programados"}')$$);

-- ── ¿Es admin quien pregunta? ──────────────────────────────────────────
-- Un usuario: su rol. El service_role (bot, informes) pregunta en nombre de
-- alguien (p_para): el rol de esa persona; sin persona, como admin.
create or replace function hub.admin_para(p_para uuid default null)
returns boolean language sql stable security definer set search_path = hub as $fn$
  select case when coalesce(auth.jwt()->>'role', '') = 'service_role'
              then coalesce((select u.rol = 'admin' and u.activo is not false from hub.usuarios u where u.id = p_para), p_para is null)
              else hub.es_admin() end
$fn$;

-- ── Motor de avisos ─────────────────────────────────────────────────────
-- Una fila por cosa que pide que alguien haga algo. `dinero` = solo admins.
-- `persona` = a quién le toca (nombre, como tickets.tecnico_id), si se sabe.
-- `enlace`: ruta del hub (#/…) o URL externa (Zoho, app actual).
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

-- ── Resumen de dinero para el panel (solo admins) ──────────────────────
create or replace function hub.direccion_resumen(p_para uuid default null)
returns jsonb language plpgsql stable security definer set search_path = hub as $fn$
declare
  v_hoy date := (now() at time zone 'Atlantic/Canary')::date;
  v_mes date := date_trunc('month', (now() at time zone 'Atlantic/Canary'))::date;
  v_valida text[] := array['void', 'draft'];
begin
  if not hub.admin_para(p_para) then return null; end if;
  return jsonb_build_object(
    'hoy', v_hoy,
    'facturado_mes', (select coalesce(sum(total), 0) from hub.zoho_facturas where fecha >= v_mes and fecha <= v_hoy and estado <> all(v_valida)),
    'facturado_mes_anterior_ano', (select coalesce(sum(total), 0) from hub.zoho_facturas
        where fecha >= (v_mes - interval '1 year')::date and fecha <= (v_hoy - interval '1 year')::date and estado <> all(v_valida)),
    'cobrado_mes', (select coalesce(sum(importe), 0) from hub.zoho_cobros where fecha >= v_mes and fecha <= v_hoy),
    'pendiente', (select coalesce(sum(saldo), 0) from hub.zoho_facturas where saldo > 0 and estado <> all(v_valida)),
    'vencido', (select coalesce(sum(saldo), 0) from hub.zoho_facturas where saldo > 0 and vence < v_hoy and estado <> all(v_valida)),
    'facturas_vencidas', (select count(*) from hub.zoho_facturas where saldo > 0 and vence < v_hoy and estado <> all(v_valida)),
    'presupuestos_enviados', (select coalesce(sum(total), 0) from hub.presupuestos where estado = 'Enviado'),
    'presupuestos_aceptados', (select coalesce(sum(total), 0) from hub.presupuestos where estado = 'Aceptado'),
    'para_facturar', (select count(*) from hub.trabajos where estado in ('Para facturar', 'Completado')),
    'ventas_mensuales', (
      select coalesce(jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'total', coalesce(t.total, 0)) order by m), '[]')
        from generate_series(date_trunc('month', v_hoy - interval '23 months'), date_trunc('month', v_hoy::timestamp), interval '1 month') m
        left join (select date_trunc('month', fecha) as mes, sum(total) as total from hub.zoho_facturas
                    where estado <> all(v_valida) and fecha >= date_trunc('month', v_hoy - interval '23 months') group by 1) t on t.mes = m),
    'cuentas_grandes', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select cliente_zoho_id, max(cliente_nombre) as nombre, sum(total) as total,
               sum(saldo) filter (where saldo > 0) as pendiente, count(*) as facturas, max(fecha) as ultima
          from hub.zoho_facturas where estado <> all(v_valida) and fecha > v_hoy - 365
         group by cliente_zoho_id order by sum(total) desc limit 10) x),
    'zoho', (select jsonb_build_object('ultima_ok', ultima_ok, 'ultimo_error', ultimo_error, 'filas', filas)
               from hub.sync_estado where clave = 'zoho')
  );
end
$fn$;
revoke execute on function hub.direccion_resumen(uuid) from public, anon;
grant execute on function hub.direccion_resumen(uuid) to authenticated, service_role;

-- ── Telegram ────────────────────────────────────────────────────────────
-- Una persona ⇆ un chat. Se vincula con un código de un solo uso (15 min):
-- el hub da el enlace t.me/<bot>?start=<código> y el bot lo canjea.
create table if not exists hub.telegram_vinculos (
  usuario_id     uuid primary key references hub.usuarios(id) on delete cascade,
  chat_id        bigint unique,
  nombre_tg      text,
  codigo         text unique,
  codigo_caduca  timestamptz,
  vinculado_at   timestamptz,
  activo         boolean not null default true,
  updated_at     timestamptz not null default now()
);
drop trigger if exists tocar_updated_at on hub.telegram_vinculos;
create trigger tocar_updated_at before update on hub.telegram_vinculos
  for each row execute function hub.tocar_updated_at();
alter table hub.telegram_vinculos enable row level security;
revoke insert, update, delete on hub.telegram_vinculos from authenticated;
grant select on hub.telegram_vinculos to authenticated;
grant all on hub.telegram_vinculos to service_role;
drop policy if exists leer on hub.telegram_vinculos;
create policy leer on hub.telegram_vinculos for select to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()));
select hub.auditar('telegram_vinculos');

create or replace function hub.telegram_codigo()
returns text language plpgsql volatile security definer set search_path = hub, extensions as $fn$
declare v_yo uuid := (hub.usuario_actual()).id; v_cod text;
begin
  if v_yo is null then raise exception 'No estás dado de alta en el hub'; end if;
  v_cod := encode(extensions.gen_random_bytes(6), 'hex');
  insert into hub.telegram_vinculos (usuario_id, codigo, codigo_caduca)
  values (v_yo, v_cod, now() + interval '15 minutes')
  on conflict (usuario_id) do update set codigo = excluded.codigo, codigo_caduca = excluded.codigo_caduca;
  return v_cod;
end
$fn$;
create or replace function hub.telegram_desvincular()
returns void language sql volatile security definer set search_path = hub as $fn$
  update hub.telegram_vinculos set chat_id = null, nombre_tg = null, vinculado_at = null, codigo = null
   where usuario_id = (hub.usuario_actual()).id
$fn$;
revoke execute on function hub.telegram_codigo(), hub.telegram_desvincular() from public, anon;
grant execute on function hub.telegram_codigo(), hub.telegram_desvincular() to authenticated;

-- ── Informes programados ────────────────────────────────────────────────
create table if not exists hub.informes_programados (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  tipo             text not null check (tipo in ('avisos', 'repaso_matinal', 'cierre_dia', 'resumen_rmm',
                                                  'estado_proyectos', 'cobros_vencidos', 'ventas_ayer')),
  usuario_id       uuid not null references hub.usuarios(id) on delete cascade,  -- a quién le llega
  hora             time not null default '08:00',                                -- hora de Canarias
  dias             int[] not null default '{1,2,3,4,5}' check (dias <@ '{1,2,3,4,5,6,7}'),  -- 1 = lunes
  canal            text not null default 'telegram' check (canal in ('telegram')),
  activo           boolean not null default true,
  ultimo_envio_at  timestamptz,
  creado_por       uuid default (hub.usuario_actual()).id
);
create index if not exists informes_prog_idx on hub.informes_programados (activo, hora);
drop trigger if exists tocar_updated_at on hub.informes_programados;
create trigger tocar_updated_at before update on hub.informes_programados
  for each row execute function hub.tocar_updated_at();

-- Informes de dinero: solo para admins.
create or replace function hub.informe_de_dinero(p_tipo text)
returns boolean language sql immutable set search_path = hub as $fn$
  select p_tipo in ('cobros_vencidos', 'ventas_ayer')
$fn$;

alter table hub.informes_programados enable row level security;
grant select, insert, update, delete on hub.informes_programados to authenticated;
grant all on hub.informes_programados to service_role;
drop policy if exists leer on hub.informes_programados;
create policy leer on hub.informes_programados for select to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()));
drop policy if exists crear on hub.informes_programados;
create policy crear on hub.informes_programados for insert to authenticated
  with check ((select hub.es_admin()) or (usuario_id = (select (hub.usuario_actual()).id) and not hub.informe_de_dinero(tipo)));
drop policy if exists cambiar on hub.informes_programados;
create policy cambiar on hub.informes_programados for update to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()))
  with check ((select hub.es_admin()) or (usuario_id = (select (hub.usuario_actual()).id) and not hub.informe_de_dinero(tipo)));
drop policy if exists borrar on hub.informes_programados;
create policy borrar on hub.informes_programados for delete to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()));
select hub.auditar('informes_programados');

-- Registro de envíos. Es ya un registro: no pasa además por hub.auditoria
-- (sería apuntar dos veces cada mensaje).
create table if not exists hub.informes_envios (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  informe_id  uuid references hub.informes_programados(id) on delete set null,
  tipo        text not null,
  usuario_id  uuid references hub.usuarios(id) on delete cascade,
  canal       text not null default 'telegram',
  origen      text not null default 'programado' check (origen in ('programado', 'manual', 'bot')),
  ok          boolean not null,
  error       text,
  texto       text
);
create index if not exists informes_envios_idx on hub.informes_envios (usuario_id, created_at desc);
alter table hub.informes_envios enable row level security;
revoke insert, update, delete on hub.informes_envios from authenticated;
grant select on hub.informes_envios to authenticated;
grant all on hub.informes_envios to service_role;
drop policy if exists leer on hub.informes_envios;
create policy leer on hub.informes_envios for select to authenticated
  using (usuario_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()));
