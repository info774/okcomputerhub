-- ════════════════════════════════════════════════════════════════════════
-- Reloj (Galaxy Watch, Wear OS): dashboard del hub en la muñeca.
--
-- · Vinculación como la de una tele («código en la pantalla»): el reloj pide
--   a la función `reloj` un código corto (K7M-4QP) y un token `okr_…` que aún
--   no vale; la persona abre el hub (#/reloj), teclea el código y el token
--   queda atado a ella. El reloj no teclea contraseñas ni pasa por Google.
-- · hub.reloj_dispositivos guarda la HUELLA del token, nunca el token.
--   Pendiente = usuario_id nulo; caduca a los 10 minutos si nadie lo aprueba.
-- · La función `reloj` (SIN_JWT, la autoriza el token) lee con service_role
--   y escribe a nombre de la persona (x-hub-usuario, como el MCP).
-- · Fichar: hub.fichar mira el JWT (hub.usuario_actual), así que
--   hub.reloj_fichar (solo service_role) pone las claims de la persona en la
--   transacción y llama a la MISMA hub.fichar: las reglas no se duplican y
--   hub.exigir_area sigue mandando (hasta el corte, el fichaje es de la app).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.reloj_dispositivos (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  huella        text not null unique,          -- sha256 hex del token okr_…
  codigo        text unique,                   -- el que se teclea en el hub (null al aprobar)
  codigo_caduca timestamptz,
  usuario_id    uuid,                          -- hub.usuarios; null = pendiente
  nombre        text,                          -- «Galaxy Watch de Fran»
  aprobado_at   timestamptz,
  ultimo_uso    timestamptz,
  revocado_at   timestamptz
);

alter table hub.reloj_dispositivos enable row level security;
grant select on hub.reloj_dispositivos to authenticated;
grant all on hub.reloj_dispositivos to service_role;
drop policy if exists leer on hub.reloj_dispositivos;
create policy leer on hub.reloj_dispositivos for select to authenticated
  using (usuario_id is not null and ((select hub.es_admin()) or usuario_id = (select (hub.usuario_actual()).id)));
-- Sin políticas de escritura: solo por las funciones de abajo.
select hub.auditar('reloj_dispositivos');

-- El reloj pide vincularse (lo llama la función `reloj`, sin persona todavía).
-- Devuelve el token EN CLARO (solo lo guarda el reloj) y el código.
create or replace function hub.reloj_iniciar()
returns table (token text, codigo text, caduca timestamptz)
language plpgsql security definer set search_path = hub, extensions as $fn$
declare
  v_token text := 'okr_' || encode(gen_random_bytes(24), 'hex');
  v_abc   text := 'ACDEFGHJKMNPQRTUVWXY3469';   -- sin 0/O, 1/I/L, 2/Z, 5/S, 8/B
  v_cod   text;
  v_i     int;
begin
  perform set_config('hub.sin_auditoria', 'on', true);
  delete from hub.reloj_dispositivos where usuario_id is null and codigo_caduca < now();
  if (select count(*) from hub.reloj_dispositivos where usuario_id is null) >= 30 then
    raise exception 'Demasiadas vinculaciones a medias: espera unos minutos';
  end if;
  loop
    v_cod := '';
    for v_i in 1..6 loop
      v_cod := v_cod || substr(v_abc, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_abc)), 1);
    end loop;
    v_cod := left(v_cod, 3) || '-' || right(v_cod, 3);
    exit when not exists (select 1 from hub.reloj_dispositivos d where d.codigo = v_cod);
  end loop;
  insert into hub.reloj_dispositivos (huella, codigo, codigo_caduca)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_cod, now() + interval '10 minutes');
  perform set_config('hub.sin_auditoria', 'off', true);
  return query select v_token, v_cod, now() + interval '10 minutes';
end
$fn$;

-- La persona, desde el hub, teclea el código que enseña el reloj.
create or replace function hub.reloj_aprobar(p_codigo text, p_nombre text default null)
returns uuid language plpgsql security definer set search_path = hub as $fn$
declare
  v_yo hub.usuarios := hub.usuario_actual();
  v_id uuid;
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v_yo.id is null then raise exception 'No estás dado de alta en el hub'; end if;
  if length(v_cod) <> 6 then raise exception 'El código son 6 caracteres (p. ej. K7M-4QP)'; end if;
  v_cod := left(v_cod, 3) || '-' || right(v_cod, 3);
  update hub.reloj_dispositivos
     set usuario_id = v_yo.id, aprobado_at = now(), codigo = null, codigo_caduca = null,
         nombre = coalesce(nullif(trim(p_nombre), ''), 'Reloj de ' || split_part(v_yo.nombre, ' ', 1))
   where codigo = v_cod and usuario_id is null and codigo_caduca > now()
  returning id into v_id;
  if v_id is null then raise exception 'Ese código no existe o ha caducado: pide otro en el reloj'; end if;
  return v_id;
end
$fn$;

create or replace function hub.reloj_revocar(p_id uuid)
returns void language plpgsql security definer set search_path = hub as $fn$
begin
  update hub.reloj_dispositivos set revocado_at = now()
   where id = p_id and revocado_at is null
     and (hub.es_admin() or usuario_id = (hub.usuario_actual()).id);
  if not found then raise exception 'Ese reloj no existe, ya estaba desvinculado o no es tuyo'; end if;
end
$fn$;

-- Valida un token (lo llama la función `reloj`). Pendiente → estado 'pendiente'
-- sin persona; aprobado → 'ok' con la persona (activa). Apunta el uso.
create or replace function hub.reloj_validar(p_token text)
returns table (dispositivo_id uuid, estado text, usuario_id uuid, email text, nombre text, rol text, dispositivo text)
language plpgsql security definer set search_path = hub, extensions as $fn$
declare
  v_d hub.reloj_dispositivos;
begin
  select * into v_d from hub.reloj_dispositivos
   where huella = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and revocado_at is null;
  if v_d.id is null then return; end if;
  if v_d.usuario_id is null then
    if v_d.codigo_caduca < now() then return; end if;
    return query select v_d.id, 'pendiente'::text, null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;
  if v_d.ultimo_uso is null or v_d.ultimo_uso < now() - interval '1 minute' then
    perform set_config('hub.sin_auditoria', 'on', true);
    update hub.reloj_dispositivos set ultimo_uso = now() where id = v_d.id;
    perform set_config('hub.sin_auditoria', 'off', true);
  end if;
  return query select v_d.id, 'ok'::text, u.id, u.email, u.nombre, u.rol, v_d.nombre
    from hub.usuarios u where u.id = v_d.usuario_id and u.activo is not false;
end
$fn$;

-- Fichar desde el reloj con las MISMAS reglas que la pantalla Hoy.
create or replace function hub.reloj_fichar(p_usuario_id uuid, p_accion text, p_tipo text default null, p_id uuid default null)
returns jsonb language plpgsql security definer set search_path = hub as $fn$
declare
  v_email text;
begin
  select email into v_email from hub.usuarios where id = p_usuario_id and activo is not false;
  if v_email is null then raise exception 'La persona del reloj ya no está en el hub'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('email', v_email, 'role', 'authenticated')::text, true);
  return hub.fichar(p_accion, p_tipo, p_id, null, null);
end
$fn$;

revoke execute on function hub.reloj_iniciar() from public, anon, authenticated;
revoke execute on function hub.reloj_validar(text) from public, anon, authenticated;
revoke execute on function hub.reloj_fichar(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function hub.reloj_aprobar(text, text) from public, anon;
revoke execute on function hub.reloj_revocar(uuid) from public, anon;
grant execute on function hub.reloj_iniciar() to service_role;
grant execute on function hub.reloj_validar(text) to service_role;
grant execute on function hub.reloj_fichar(uuid, text, text, uuid) to service_role;
grant execute on function hub.reloj_aprobar(text, text) to authenticated;
grant execute on function hub.reloj_revocar(uuid) to authenticated;

-- Las comandas dictadas al reloj llevan su origen.
alter table hub.comandas drop constraint if exists comandas_origen_check;
alter table hub.comandas add constraint comandas_origen_check check (origen in ('app', 'telegram', 'mcp', 'reloj'));
