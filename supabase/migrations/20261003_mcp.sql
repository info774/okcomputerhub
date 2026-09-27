-- ════════════════════════════════════════════════════════════════════════
-- Fase 1 · Conector MCP: tokens con alcance y autoría en la auditoría.
--
-- · hub.mcp_tokens guarda la HUELLA (sha256) del token, nunca el token: se
--   enseña una sola vez al crearlo. Alcance lectura | escritura | admin,
--   dueño (hub.usuarios), caducidad opcional, último uso, revocado.
-- · Los crea y revoca un admin (RPC hub.mcp_crear_token / mcp_revocar_token);
--   la edge function `mcp` los valida con hub.mcp_validar (solo service_role).
-- · La edge function escribe con service_role, así que la auditoría no ve un
--   JWT de persona: manda la cabecera x-hub-usuario con el correo del dueño
--   del token y x-hub-origen = 'mcp'. El trigger genérico la usa SOLO si la
--   petición viene con service_role (un navegador no puede suplantar a nadie:
--   su JWT es de rol authenticated y ahí manda el correo del JWT).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  creado_por   uuid,                        -- hub.usuarios (admin que lo creó)
  nombre       text not null check (length(trim(nombre)) > 0),
  prefijo      text not null,               -- primeros caracteres, para reconocerlo
  huella       text not null unique,        -- sha256 hex del token
  alcance      text not null check (alcance in ('lectura','escritura','admin')),
  usuario_id   uuid not null,               -- en nombre de quién actúa (hub.usuarios)
  expira       timestamptz,
  ultimo_uso   timestamptz,
  revocado_at  timestamptz
);

alter table hub.mcp_tokens enable row level security;
grant select on hub.mcp_tokens to authenticated;
grant all on hub.mcp_tokens to service_role;
drop policy if exists leer on hub.mcp_tokens;
create policy leer on hub.mcp_tokens for select to authenticated
  using ((select hub.es_admin()) or usuario_id = (select (hub.usuario_actual()).id));
-- Sin políticas de escritura: solo por las funciones de abajo.
select hub.auditar('mcp_tokens');

-- Crea un token y lo devuelve EN CLARO una única vez.
create or replace function hub.mcp_crear_token(p_nombre text, p_alcance text, p_usuario_id uuid default null, p_dias integer default null)
returns text language plpgsql security definer set search_path = hub, extensions as $fn$
declare
  v_yo hub.usuarios := hub.usuario_actual();
  v_token text;
  v_dueno uuid := coalesce(p_usuario_id, v_yo.id);
begin
  if v_yo.id is null or v_yo.rol <> 'admin' then
    raise exception 'Solo un administrador puede crear tokens del conector';
  end if;
  if p_alcance not in ('lectura','escritura','admin') then raise exception 'Alcance no válido'; end if;
  if not exists (select 1 from hub.usuarios where id = v_dueno and activo is not false) then
    raise exception 'La persona del token no existe o no está activa';
  end if;
  v_token := 'okh_' || encode(gen_random_bytes(24), 'hex');
  insert into hub.mcp_tokens (creado_por, nombre, prefijo, huella, alcance, usuario_id, expira)
  values (v_yo.id, trim(p_nombre), left(v_token, 10), encode(digest(v_token, 'sha256'), 'hex'), p_alcance, v_dueno,
          case when p_dias is not null and p_dias > 0 then now() + make_interval(days => p_dias) end);
  return v_token;
end
$fn$;

create or replace function hub.mcp_revocar_token(p_id uuid)
returns void language plpgsql security definer set search_path = hub as $fn$
begin
  if not hub.es_admin() then raise exception 'Solo un administrador puede revocar tokens'; end if;
  update hub.mcp_tokens set revocado_at = now() where id = p_id and revocado_at is null;
end
$fn$;

-- Valida un token (lo llama la edge function con service_role) y apunta el uso.
create or replace function hub.mcp_validar(p_token text)
returns table (token_id uuid, alcance text, usuario_id uuid, email text, nombre text, rol text)
language plpgsql security definer set search_path = hub, extensions as $fn$
declare
  v_t hub.mcp_tokens;
begin
  select * into v_t from hub.mcp_tokens
   where huella = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and revocado_at is null and (expira is null or expira > now());
  if v_t.id is null then return; end if;
  -- Último uso sin llenar la auditoría: una vez por minuto como mucho.
  if v_t.ultimo_uso is null or v_t.ultimo_uso < now() - interval '1 minute' then
    perform set_config('hub.sin_auditoria', 'on', true);
    update hub.mcp_tokens set ultimo_uso = now() where id = v_t.id;
    perform set_config('hub.sin_auditoria', 'off', true);
  end if;
  return query select v_t.id, v_t.alcance, u.id, u.email, u.nombre, u.rol
    from hub.usuarios u where u.id = v_t.usuario_id and u.activo is not false;
end
$fn$;

revoke execute on function hub.mcp_crear_token(text, text, uuid, integer) from public, anon;
revoke execute on function hub.mcp_revocar_token(uuid) from public, anon;
revoke execute on function hub.mcp_validar(text) from public, anon, authenticated;
grant execute on function hub.mcp_crear_token(text, text, uuid, integer) to authenticated;
grant execute on function hub.mcp_revocar_token(uuid) to authenticated;
grant execute on function hub.mcp_validar(text) to service_role;

-- ── Auditoría: autor por cabecera cuando escribe una función de servidor ──
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
  -- Solo una función de servidor (service_role) puede decir en nombre de quién escribe.
  if v_email is null and v_rol = 'service_role' and v_headers ? 'x-hub-usuario' then
    v_email := lower(v_headers->>'x-hub-usuario');
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
