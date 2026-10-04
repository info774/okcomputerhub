-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 6, tanda 3: fichar sin cobertura. La cola del móvil
-- (src/core/cola.ts) guarda el fichaje con la hora de la PULSACIÓN y lo manda
-- al volver la red: hub.fichar acepta `p_cuando` (por defecto, ahora). Las
-- reglas no cambian (las de ui/fichaje.js de la app); la hora no puede ser del
-- futuro ni de hace más de 72 h (eso se corrige en Personas, con motivo), y un
-- fin no puede ser anterior a su inicio. hub.reloj_fichar sigue igual (llama
-- sin p_cuando).
-- ════════════════════════════════════════════════════════════════════════

drop function if exists hub.fichar(text, text, uuid, numeric, numeric);

create or replace function hub.fichar(p_accion text, p_tipo text default null, p_id uuid default null, p_lat numeric default null, p_lng numeric default null, p_cuando timestamptz default null)
returns jsonb language plpgsql security definer set search_path = hub as $fn$
declare
  yo hub.usuarios := hub.usuario_actual();
  s hub.sesiones;
  v_now timestamptz := coalesce(p_cuando, now());
  v_cerrada jsonb;
  v_hay boolean;
  v_tabla text := case p_tipo when 'trabajo' then 'trabajos' when 'tarea' then 'tareas' when 'ticket' then 'tickets' end;
  v_estado text := case p_tipo when 'trabajo' then 'En progreso' when 'tarea' then 'en_progreso' when 'ticket' then 'En curso' end;
begin
  if yo.id is null then raise exception 'No estás dado de alta en el hub'; end if;
  -- La hora de la pulsación (fichaje guardado sin red): ni del futuro ni de hace más de 72 h.
  if p_cuando is not null and (p_cuando > now() + interval '5 minutes' or p_cuando < now() - interval '72 hours') then
    raise exception 'La hora del fichaje no vale (más de 72 h o en el futuro): corrígelo en Personas';
  end if;
  perform hub.exigir_area('sesiones');
  select * into s from hub.sesiones where tecnico_id = yo.id and fin is null order by coalesce(inicio, traslado) desc limit 1 for update;
  v_hay := found;  -- (PERFORM cambia FOUND: se guarda aquí)
  if p_accion = 'traslado' then
    if v_hay then raise exception 'Ya tienes una sesión abierta'; end if;
    insert into hub.sesiones (traslado, tecnico_id, tecnico_nombre, gps_lat, gps_lng) values (v_now, yo.id, yo.nombre, p_lat, p_lng) returning * into s;
    return jsonb_build_object('ok', true, 'sesion', to_jsonb(s));
  elsif p_accion = 'inicio' then
    if v_tabla is null or p_id is null then raise exception 'No sé en qué quieres empezar a trabajar'; end if;
    perform hub.exigir_area(v_tabla);
    if v_hay and s.inicio is not null then
      update hub.sesiones set fin = v_now, duracion_min = round(extract(epoch from v_now - s.inicio) / 60) where id = s.id;
      v_cerrada := jsonb_build_object('id', s.id, 'entidad_tipo', s.entidad_tipo, 'entidad_id', s.entidad_id);
      s := null;
    end if;
    if s.id is not null and s.inicio is null then
      update hub.sesiones set entidad_tipo = p_tipo, entidad_id = p_id, inicio = v_now, gps_lat = coalesce(p_lat, gps_lat), gps_lng = coalesce(p_lng, gps_lng)
       where id = s.id returning * into s;
    else
      insert into hub.sesiones (entidad_tipo, entidad_id, inicio, tecnico_id, tecnico_nombre, gps_lat, gps_lng)
      values (p_tipo, p_id, v_now, yo.id, yo.nombre, p_lat, p_lng) returning * into s;
    end if;
    execute format('update hub.%I set estado = $1 where id = $2', v_tabla) using v_estado, p_id;
    return jsonb_build_object('ok', true, 'sesion', to_jsonb(s), 'cerrada', v_cerrada);
  elsif p_accion = 'fin' then
    if not v_hay or s.inicio is null then raise exception 'No tienes ninguna sesión en curso'; end if;
    if v_now < s.inicio then raise exception 'La hora del fin es anterior al inicio'; end if;
    update hub.sesiones set fin = v_now, duracion_min = round(extract(epoch from v_now - s.inicio) / 60) where id = s.id returning * into s;
    return jsonb_build_object('ok', true, 'sesion', to_jsonb(s));
  end if;
  raise exception 'Acción de fichaje desconocida (traslado, inicio, fin)';
end
$fn$;

revoke all on function hub.fichar(text, text, uuid, numeric, numeric, timestamptz) from public, anon;
grant execute on function hub.fichar(text, text, uuid, numeric, numeric, timestamptz) to authenticated, service_role;
