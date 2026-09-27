-- ════════════════════════════════════════════════════════════════════════
-- Fase 0 · Cimientos del hub en el proyecto compartido con Breeze.
--
-- Reglas (CLAUDE.md): `public` es de Breeze y aquí no se nombra; todo lo del
-- hub vive en el esquema `hub`, con grants solo a authenticated/service_role,
-- RLS en todas sus tablas y auditoría propia.
--
-- Crea: esquema `hub` y sus grants, extensiones pg_cron/pg_net, `hub.usuarios`
-- (espejo de `usuarios` de la app actual, mismas columnas), `hub.areas`
-- (quién manda en cada área: app | hub), `hub.auditoria` + trigger genérico
-- (portado de audit_log de la app actual) y las funciones de rol.
--
-- DESPUÉS de aplicarla, en el panel: Settings → API → Exposed schemas → añadir
-- `hub` (sin quitar nada ni añadir `public`). Ver docs/FASE0.md.
-- ════════════════════════════════════════════════════════════════════════

create schema if not exists hub;
comment on schema hub is 'Ok Computer Hub: todo lo del hub vive aqui.';

-- Extensiones fuera de public (pg_cron vive en `cron`, pg_net en `net`).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ── Grants: solo sobre hub ──────────────────────────────────────────────
revoke all on schema hub from anon, public;
grant usage on schema hub to authenticated, service_role;
alter default privileges in schema hub grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema hub grant all on tables to service_role;
alter default privileges in schema hub grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema hub grant execute on functions to authenticated, service_role;
alter default privileges in schema hub revoke execute on functions from public;

-- ── Usuarios (espejo de `usuarios` de la app actual, mismas columnas) ─────
create table if not exists hub.usuarios (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  nombre      text not null,
  email       text not null,
  rol         text default 'tecnico',
  activo      boolean default true
);
create unique index if not exists usuarios_email_uk on hub.usuarios (lower(email));

-- ── Funciones de rol (email del JWT → hub.usuarios) ──────────────────────
create or replace function hub.usuario_actual()
returns hub.usuarios language sql stable security definer set search_path = hub as $fn$
  select u.* from hub.usuarios u
   where lower(u.email) = lower(auth.jwt()->>'email') and u.activo is not false
   limit 1
$fn$;

create or replace function hub.es_usuario()
returns boolean language sql stable security definer set search_path = hub as $fn$
  select exists (select 1 from hub.usuarios u
                  where lower(u.email) = lower(auth.jwt()->>'email') and u.activo is not false)
$fn$;

create or replace function hub.es_admin()
returns boolean language sql stable security definer set search_path = hub as $fn$
  select exists (select 1 from hub.usuarios u
                  where lower(u.email) = lower(auth.jwt()->>'email')
                    and u.activo is not false and u.rol = 'admin')
$fn$;

-- ── Áreas: quién manda en cada una ───────────────────────────────────────
-- dueno = 'app': el hub la enseña en solo lectura y sync-app la refresca.
-- dueno = 'hub': cortada; el hub escribe y el sync la salta.
create table if not exists hub.areas (
  area        text primary key,
  dueno       text not null default 'app' check (dueno in ('app','hub')),
  tablas      text[] not null default '{}',
  cortada_at  timestamptz,
  notas       text
);

create or replace function hub.area_de(p_tabla text)
returns text language sql stable security definer set search_path = hub as $fn$
  select area from hub.areas where p_tabla = any(tablas) limit 1
$fn$;

-- ¿Puede el hub escribir en esta tabla? Solo si su área está cortada (o si la
-- tabla es propia del hub y no está en ningún área).
create or replace function hub.tabla_es_del_hub(p_tabla text)
returns boolean language sql stable security definer set search_path = hub as $fn$
  select coalesce((select dueno = 'hub' from hub.areas where p_tabla = any(tablas) limit 1), true)
$fn$;

insert into hub.areas (area, tablas, notas) values
  ('usuarios',     '{usuarios}',                                   'Alta de personas: sigue en la app hasta la fase 10'),
  ('clientes',     '{clientes,locales,contactos}',                 'Fase 4'),
  ('trabajos',     '{trabajos,agenda,sesiones,documento_lineas}',  'Final'),
  ('tareas',       '{tareas}',                                     'Fase 8'),
  ('tickets',      '{tickets}',                                    'Fase 6'),
  ('presupuestos', '{presupuestos}',                               'Fase 11'),
  ('gastos',       '{gastos}',                                     'Fase 10')
on conflict (area) do nothing;

-- ── Auditoría ────────────────────────────────────────────────────────────
create table if not exists hub.auditoria (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null default now(),
  tabla          text not null,
  registro_id    text not null,
  accion         text not null check (accion in ('INSERT','UPDATE','DELETE')),
  usuario_id     uuid,
  usuario_email  text,
  usuario_nombre text,
  rol_jwt        text,
  origen         text,                   -- app hub | mcp | bot | … (cabecera x-hub-origen)
  cambios        jsonb,
  antes          jsonb,
  despues        jsonb,
  titulo         text
);
create index if not exists auditoria_registro_idx on hub.auditoria (tabla, registro_id, ts desc);
create index if not exists auditoria_ts_idx       on hub.auditoria (ts desc);

create or replace function hub.auditoria_titulo(fila jsonb)
returns text language sql immutable as $fn$
  select left(coalesce(
    nullif(fila->>'titulo',''), nullif(fila->>'nombre',''), nullif(fila->>'asunto',''),
    nullif(fila->>'descripcion',''), nullif(fila->>'concepto',''),
    case when fila ? 'numero' then '#' || (fila->>'numero') end
  ), 120)
$fn$;

-- Lo que escriben sync-app (cabecera x-hub-sync) y el importador (GUC
-- hub.sin_auditoria) NO se audita: es copia de lo que ya auditó la app actual.
create or replace function hub.auditoria_registrar()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare
  v_antes   jsonb;
  v_despues jsonb;
  v_cambios jsonb := '{}'::jsonb;
  v_ruido   text[] := array['updated_at','sync_at','ultimo_uso'];
  k text;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_email   text := lower(auth.jwt()->>'email');
  v_rol     text := auth.jwt()->>'role';
  v_uid     uuid;
  v_nombre  text;
begin
  if current_setting('hub.sin_auditoria', true) = 'on' or v_headers ? 'x-hub-sync' then
    return null;
  end if;
  if tg_op = 'DELETE' then v_antes := to_jsonb(old); else v_despues := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    v_antes := to_jsonb(old);
    for k in select jsonb_object_keys(v_despues) loop
      if k = any(v_ruido) then continue; end if;
      if (v_antes -> k) is distinct from (v_despues -> k) then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_array(v_antes -> k, v_despues -> k));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return null; end if;
  end if;
  if v_email is not null then
    select id, nombre into v_uid, v_nombre from hub.usuarios where lower(email) = v_email limit 1;
  end if;
  insert into hub.auditoria (tabla, registro_id, accion, usuario_id, usuario_email, usuario_nombre,
                             rol_jwt, origen, cambios, antes, despues, titulo)
  -- Clave del registro: `id`, o la clave natural de las tablas sin id (areas).
  values (tg_table_name,
          coalesce(v_despues->>'id', v_antes->>'id', v_despues->>'area', v_antes->>'area', '?'),
          tg_op, v_uid, v_email,
          coalesce(v_nombre, case when v_email is null then 'sistema' end), v_rol,
          coalesce(v_headers->>'x-hub-origen', 'hub'),
          case when tg_op = 'UPDATE' then v_cambios end,
          case when tg_op = 'DELETE' then v_antes end,
          case when tg_op = 'INSERT' then v_despues end,
          hub.auditoria_titulo(coalesce(v_despues, v_antes)));
  return null;
exception when others then
  raise warning 'hub.auditoria_registrar(%): %', tg_table_name, sqlerrm;
  return null;
end
$fn$;

-- Engancha la auditoría a una tabla de hub (se llama desde cada migración).
create or replace function hub.auditar(p_tabla text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists auditoria on hub.%I', p_tabla);
  execute format('create trigger auditoria after insert or update or delete on hub.%I
                  for each row execute function hub.auditoria_registrar()', p_tabla);
end
$fn$;

select hub.auditar('usuarios');
select hub.auditar('areas');

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table hub.usuarios  enable row level security;
alter table hub.areas     enable row level security;
alter table hub.auditoria enable row level security;

grant select, insert, update, delete on hub.usuarios, hub.areas to authenticated;
grant select on hub.auditoria to authenticated;
grant all on hub.usuarios, hub.areas, hub.auditoria to service_role;

drop policy if exists usuarios_leer on hub.usuarios;
create policy usuarios_leer on hub.usuarios for select to authenticated using ((select hub.es_usuario()));
drop policy if exists usuarios_escribir on hub.usuarios;
create policy usuarios_escribir on hub.usuarios for all to authenticated
  using ((select hub.es_admin()) and hub.tabla_es_del_hub('usuarios'))
  with check ((select hub.es_admin()) and hub.tabla_es_del_hub('usuarios'));

drop policy if exists areas_leer on hub.areas;
create policy areas_leer on hub.areas for select to authenticated using ((select hub.es_usuario()));
drop policy if exists areas_admin on hub.areas;
create policy areas_admin on hub.areas for update to authenticated
  using ((select hub.es_admin())) with check ((select hub.es_admin()));

drop policy if exists auditoria_leer on hub.auditoria;
create policy auditoria_leer on hub.auditoria for select to authenticated using ((select hub.es_admin()));

revoke execute on function hub.auditoria_registrar() from public, authenticated;
revoke execute on function hub.auditar(text) from public, authenticated;
