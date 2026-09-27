-- ════════════════════════════════════════════════════════════════════════
-- Fase 2 · Monitorización: consola RMM sobre Breeze.
--
-- Breeze (el motor RMM) vive en el esquema public de ESTE proyecto. El hub lo
-- LEE con vistas hub.rmm_* y no le escribe nunca (regla 3 de CLAUDE.md): las
-- acciones sobre un equipo van por la API REST de Breeze desde la función
-- breeze-api, que deja su rastro en hub.rmm_acciones.
--
-- Las vistas son propiedad de postgres (que salta la FORCE RLS de Breeze) y
-- filtran ellas mismas quién ve: un usuario del hub o el service_role de las
-- funciones (hub.ve_rmm()). Son de SOLO lectura: se les quita todo menos
-- SELECT, porque una vista simple sobre una tabla es actualizable y escribiría
-- en Breeze con los permisos de postgres.
--
-- Breeze guarda las horas en `timestamp` sin zona, en UTC: aquí salen como
-- timestamptz. Las vistas pesadas (métricas, comandos, sesiones) van con
-- ventana de tiempo.
--
-- REVISAR EN CADA SALTO DE VERSIÓN DE BREEZE (okcomputer-rmm/VERSIONES.md):
-- esta migración es la única dependencia del esquema de Breeze. Si Breeze
-- renombra una columna, la vista deja de compilar en la siguiente migración
-- que la reescriba, no antes: comprobar con `select * from hub.rmm_equipos
-- limit 1` tras cada actualización.
-- ════════════════════════════════════════════════════════════════════════

-- ── Quién ve lo de Breeze ────────────────────────────────────────────────
create or replace function hub.ve_rmm()
returns boolean language sql stable security definer set search_path = hub as $fn$
  select coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario()
$fn$;

-- «Casa d'Amelia» / «CASA D AMELIA» son el mismo sitio: sin tildes, sin
-- mayúsculas y sin signos (misma regla que breeze-sync de la app actual).
create or replace function hub.normalizar(p text)
returns text language sql immutable set search_path = hub as $fn$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'áéíóúüñàèìòùâêîôûçÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÇ', 'aeiouunaeiouaeioucAEIOUUNAEIOUAEIOUC')), '[^a-z0-9]+', ' ', 'g'))
$fn$;

-- ── Site de Breeze ⇆ sede del hub ────────────────────────────────────────
-- Portado de rmm_breeze_sitios de la app. hub.rmm_emparejar() da de alta cada
-- Site y lo empareja por nombre con hub.locales si casa con EXACTAMENTE uno;
-- `manual` = una persona puso (o quitó) la sede a mano, y eso no se pisa.
create table if not exists hub.rmm_sitios (
  site_id     uuid primary key,
  local_id    uuid,
  manual      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rmm_sitios_local_idx on hub.rmm_sitios (local_id);

drop trigger if exists tocar_updated_at on hub.rmm_sitios;
create trigger tocar_updated_at before update on hub.rmm_sitios
  for each row execute function hub.tocar_updated_at();

alter table hub.rmm_sitios enable row level security;
grant select, insert, update on hub.rmm_sitios to authenticated;
revoke delete on hub.rmm_sitios from authenticated;
grant all on hub.rmm_sitios to service_role;
drop policy if exists leer on hub.rmm_sitios;
create policy leer on hub.rmm_sitios for select to authenticated using ((select hub.es_usuario()));
drop policy if exists emparejar on hub.rmm_sitios;
create policy emparejar on hub.rmm_sitios for insert to authenticated with check ((select hub.es_usuario()) and manual);
drop policy if exists cambiar on hub.rmm_sitios;
create policy cambiar on hub.rmm_sitios for update to authenticated
  using ((select hub.es_usuario())) with check ((select hub.es_usuario()) and manual);
select hub.auditar('rmm_sitios');

-- Una pasada que no cambia nada no escribe nada: solo altas de Sites nuevos y
-- cambios de verdad en los no manuales. Devuelve cuántas filas tocó.
create or replace function hub.rmm_emparejar()
returns integer language plpgsql security definer set search_path = hub as $fn$
declare n integer;
begin
  with s as (
    select id, hub.normalizar(name) as n from public.sites
  ), l as (
    select id, hub.normalizar(nombre) as n from hub.locales where activo is not false
  ), m as (
    select s.id as site_id,
           case when count(l.id) = 1 then (array_agg(l.id))[1] end as local_id
      from s left join l on l.n = s.n and s.n <> ''
     group by s.id
  )
  insert into hub.rmm_sitios as r (site_id, local_id)
  select site_id, local_id from m
  on conflict (site_id) do update set local_id = excluded.local_id
   where not r.manual and r.local_id is distinct from excluded.local_id;
  get diagnostics n = row_count;
  return n;
end
$fn$;
revoke execute on function hub.rmm_emparejar() from public, authenticated;
grant execute on function hub.rmm_emparejar() to service_role;

-- Cada hora (los Sites se dan de alta a mano en Breeze: no corre prisa).
select cron.schedule('hub-rmm-emparejar', '7 * * * *', $$select hub.rmm_emparejar()$$);

-- ── Vistas de lectura ───────────────────────────────────────────────────

-- Software de un equipo: Breeze lo guarda en dos tablas según la versión del
-- agente (inventario gestionado y el listado clásico).
create or replace view hub.rmm_software with (security_barrier = true) as
  select si.device_id, si.name as nombre, si.version, si.vendor as fabricante, si.install_date as instalado
    from public.software_inventory si
   where (select hub.ve_rmm())
  union all
  select ds.device_id, ds.name, ds.version, ds.publisher, ds.install_date
    from public.device_software ds
   where (select hub.ve_rmm());

create or replace view hub.rmm_equipos with (security_barrier = true) as
select d.id,
       d.hostname,
       coalesce(nullif(d.display_name, ''), d.hostname) as nombre,
       d.site_id,
       s.name as sitio,
       o.name as organizacion,
       rs.local_id,
       d.os_type::text as so,
       d.os_version as so_version,
       d.os_build as so_build,
       d.architecture as arquitectura,
       d.agent_version as version_agente,
       d.status::text as estado,
       d.last_seen_at at time zone 'UTC' as visto_ultimo,
       coalesce(d.last_seen_at > (now() at time zone 'UTC') - interval '15 minutes', false) as conectado,
       d.last_user as ultimo_usuario,
       d.uptime_seconds as encendido_seg,
       d.pending_reboot as reinicio_pendiente,
       d.last_seen_ip as ip_publica,
       d.is_virtual as virtual,
       d.enrolled_at at time zone 'UTC' as alta,
       h.cpu_model as cpu,
       h.cpu_cores as nucleos,
       h.ram_total_mb as ram_mb,
       h.disk_total_gb as disco_gb,
       h.manufacturer as fabricante,
       h.model as modelo,
       h.serial_number as serie,
       sec.antivirus,
       sec.av_tiempo_real,
       sec.firewall,
       sec.cifrado,
       sec.amenazas,
       (select count(*) from public.device_patches p
         where p.device_id = d.id and p.status in ('pending', 'missing'))::int as parches_pendientes,
       (select count(*) from public.alerts a
         where a.device_id = d.id and a.status in ('active', 'acknowledged'))::int as alertas_abiertas,
       (select jsonb_agg(jsonb_build_object('unidad', k.mount_point, 'total_gb', round(k.total_gb::numeric, 1),
                 'libre_gb', round(k.free_gb::numeric, 1), 'uso', round(k.used_percent::numeric)) order by k.mount_point)
          from public.device_disks k where k.device_id = d.id) as discos,
       (select n.ip_address from public.device_network n
         where n.device_id = d.id order by n.is_primary desc nulls last limit 1) as ip_local,
       d.custom_fields->>'rustdesk_id' as rustdesk_id,
       l.programa_tpv,
       tpv.version as tpv_version
  from public.devices d
  left join public.sites s on s.id = d.site_id
  left join public.organizations o on o.id = d.org_id
  left join public.device_hardware h on h.device_id = d.id
  left join hub.rmm_sitios rs on rs.site_id = d.site_id
  left join hub.locales l on l.id = rs.local_id
  left join lateral (
    select ss.provider::text as antivirus, ss.real_time_protection as av_tiempo_real,
           ss.firewall_enabled as firewall, ss.encryption_status as cifrado, ss.threat_count as amenazas
      from public.security_status ss where ss.device_id = d.id
     order by ss.updated_at desc nulls last limit 1
  ) sec on true
  -- Versión del TPV: el programa que dice la sede, buscado en el software
  -- (sin espacios: «Agora TPV» es «ÁgoraTPV Cliente»).
  left join lateral (
    select sw.version from hub.rmm_software sw
     where sw.device_id = d.id and coalesce(hub.normalizar(l.programa_tpv), '') <> ''
       and replace(hub.normalizar(sw.nombre), ' ', '') like '%' || replace(hub.normalizar(l.programa_tpv), ' ', '') || '%'
     order by sw.version desc nulls last limit 1
  ) tpv on true
 where (select hub.ve_rmm());

create or replace view hub.rmm_sites with (security_barrier = true) as
select s.id as site_id,
       s.name as sitio,
       o.name as organizacion,
       rs.local_id,
       coalesce(rs.manual, false) as manual,
       l.nombre as local_nombre,
       count(d.id)::int as equipos,
       count(d.id) filter (where d.last_seen_at > (now() at time zone 'UTC') - interval '15 minutes')::int as conectados
  from public.sites s
  left join public.organizations o on o.id = s.org_id
  left join hub.rmm_sitios rs on rs.site_id = s.id
  left join hub.locales l on l.id = rs.local_id
  left join public.devices d on d.site_id = s.id
 where (select hub.ve_rmm())
 group by s.id, s.name, o.name, rs.local_id, rs.manual, l.nombre;

-- Semáforo por sede (misma regla que la app: conectado = checkin en el último
-- cuarto de hora). ok · alerta (hay alertas abiertas) · parcial (alguno sin
-- conexión) · caido (ninguno conectado).
create or replace view hub.rmm_estado_local with (security_barrier = true) as
select e.local_id,
       count(*)::int as equipos,
       count(*) filter (where e.conectado)::int as conectados,
       sum(e.alertas_abiertas)::int as alertas,
       max(e.visto_ultimo) as visto_ultimo,
       case when count(*) filter (where e.conectado) = 0 then 'caido'
            when sum(e.alertas_abiertas) > 0 then 'alerta'
            when count(*) filter (where not e.conectado) > 0 then 'parcial'
            else 'ok' end as estado
  from hub.rmm_equipos e
 where e.local_id is not null
 group by e.local_id;

-- Alertas abiertas y las de los últimos 90 días.
create or replace view hub.rmm_alertas with (security_barrier = true) as
select a.id,
       a.device_id,
       d.hostname,
       rs.local_id,
       s.name as sitio,
       a.status::text as estado,
       a.severity::text as severidad,
       a.title as titulo,
       a.message as mensaje,
       a.triggered_at at time zone 'UTC' as disparada,
       a.acknowledged_at at time zone 'UTC' as acusada,
       ua.name as acusada_por,
       a.resolved_at at time zone 'UTC' as resuelta,
       a.resolution_note as nota_resolucion
  from public.alerts a
  left join public.devices d on d.id = a.device_id
  left join public.sites s on s.id = d.site_id
  left join hub.rmm_sitios rs on rs.site_id = d.site_id
  left join public.users ua on ua.id = a.acknowledged_by
 where (select hub.ve_rmm())
   and (a.status in ('active', 'acknowledged') or a.triggered_at > (now() at time zone 'UTC') - interval '90 days');

-- Métricas: solo las últimas 48 h (Breeze escribe cada minuto por equipo).
-- Pedirlas SIEMPRE con device_id=eq.… (va por su índice device_id+timestamp).
create or replace view hub.rmm_metricas with (security_barrier = true) as
select m.device_id,
       m.timestamp at time zone 'UTC' as momento,
       m.cpu_percent as cpu,
       m.ram_percent as ram,
       m.disk_percent as disco,
       m.bandwidth_in_bps as entrada_bps,
       m.bandwidth_out_bps as salida_bps
  from public.device_metrics m
 where (select hub.ve_rmm())
   and m.timestamp > (now() at time zone 'UTC') - interval '48 hours';

create or replace view hub.rmm_parches with (security_barrier = true) as
select dp.id,
       dp.device_id,
       dp.status::text as estado,
       p.title as titulo,
       p.severity::text as severidad,
       p.category as categoria,
       p.external_id as referencia,
       p.release_date as publicado,
       p.requires_reboot as pide_reinicio,
       dp.installed_at at time zone 'UTC' as instalado,
       dp.last_error as ultimo_error
  from public.device_patches dp
  join public.patches p on p.id = dp.patch_id
 where (select hub.ve_rmm());

create or replace view hub.rmm_sesiones_remotas with (security_barrier = true) as
select r.id,
       r.device_id,
       d.hostname,
       rs.local_id,
       r.type::text as tipo,
       r.status::text as estado,
       r.started_at at time zone 'UTC' as inicio,
       r.ended_at at time zone 'UTC' as fin,
       r.duration_seconds as duracion_seg,
       u.name as usuario
  from public.remote_sessions r
  left join public.devices d on d.id = r.device_id
  left join hub.rmm_sitios rs on rs.site_id = d.site_id
  left join public.users u on u.id = r.user_id
 where (select hub.ve_rmm())
   and r.created_at > (now() at time zone 'UTC') - interval '90 days';

create or replace view hub.rmm_comandos with (security_barrier = true) as
select c.id,
       c.device_id,
       d.hostname,
       c.type as tipo,
       c.status as estado,
       c.created_at at time zone 'UTC' as pedido,
       c.completed_at at time zone 'UTC' as terminado,
       u.name as usuario,
       left(c.result::text, 2000) as resultado
  from public.device_commands c
  left join public.devices d on d.id = c.device_id
  left join public.users u on u.id = c.created_by
 where (select hub.ve_rmm())
   and c.created_at > (now() at time zone 'UTC') - interval '30 days';

-- Catálogo de scripts (sin el código: puede llevar claves).
create or replace view hub.rmm_scripts with (security_barrier = true) as
select sc.id,
       sc.name as nombre,
       sc.description as descripcion,
       sc.category as categoria,
       sc.os_types as sistemas,
       sc.language::text as lenguaje,
       sc.parameters as parametros,
       sc.is_system as de_sistema
  from public.scripts sc
 where (select hub.ve_rmm()) and sc.deleted_at is null;

create or replace view hub.rmm_scripts_ejecuciones with (security_barrier = true) as
select x.id,
       x.script_id,
       sc.name as script,
       x.device_id,
       d.hostname,
       x.status::text as estado,
       x.created_at at time zone 'UTC' as pedido,
       x.started_at at time zone 'UTC' as inicio,
       x.completed_at at time zone 'UTC' as fin,
       x.exit_code as codigo_salida,
       left(x.stdout, 4000) as salida,
       left(x.stderr, 2000) as errores,
       x.error_message as error
  from public.script_executions x
  left join public.scripts sc on sc.id = x.script_id
  left join public.devices d on d.id = x.device_id
 where (select hub.ve_rmm())
   and x.created_at > (now() at time zone 'UTC') - interval '30 days';

-- Solo SELECT en las vistas (los privilegios por defecto de hub dan también
-- insert/update/delete, que en una vista simple escribirían en Breeze).
do $$
declare v text;
begin
  foreach v in array array['rmm_software','rmm_equipos','rmm_sites','rmm_estado_local','rmm_alertas','rmm_metricas',
                           'rmm_parches','rmm_sesiones_remotas','rmm_comandos','rmm_scripts','rmm_scripts_ejecuciones'] loop
    execute format('revoke all on hub.%I from anon, authenticated, service_role', v);
    execute format('grant select on hub.%I to authenticated, service_role', v);
  end loop;
end $$;

-- ── Lo que el hub le pide a Breeze ──────────────────────────────────────
-- Una fila por acción de breeze-api (acusar alerta, comando, script): quién,
-- sobre qué equipo, qué contestó Breeze. La escribe solo la función.
create table if not exists hub.rmm_acciones (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  usuario_id    uuid,
  usuario_email text,
  accion        text not null check (accion in ('acusar_alerta', 'comando', 'script')),
  device_ids    uuid[] not null default '{}',
  alerta_id     uuid,
  detalle       jsonb not null default '{}',
  estado        text not null default 'ok' check (estado in ('ok', 'error')),
  respuesta     jsonb,
  error         text
);
create index if not exists rmm_acciones_fecha_idx on hub.rmm_acciones (created_at desc);

alter table hub.rmm_acciones enable row level security;
revoke insert, update, delete on hub.rmm_acciones from authenticated;
grant select on hub.rmm_acciones to authenticated;
grant all on hub.rmm_acciones to service_role;
drop policy if exists leer on hub.rmm_acciones;
create policy leer on hub.rmm_acciones for select to authenticated using ((select hub.es_usuario()));
select hub.auditar('rmm_acciones');
