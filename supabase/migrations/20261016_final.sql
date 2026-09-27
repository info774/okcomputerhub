-- ════════════════════════════════════════════════════════════════════════
-- Fase Final · Trabajos, calendario, chat y modo calle — PROGRAMADO, SIN EL
-- CAMBIO (DECISIONES_FASES.md: la redirección de la app, la URL de la APK y
-- apagar sync-app esperan al OK de Fran).
--
--   · Espejo de lo que falta para la ficha del trabajo: comentarios y fotos
--     (área `trabajos`, dueño `app`).
--   · Las ESCRITURAS del día a día (fichar, material con su stock, estado del
--     trabajo, mover un bloque de agenda) viven en funciones de la base que
--     portan las reglas de la app y SOLO funcionan con el área ya cortada
--     (hub.tabla_es_del_hub): hoy fallan con un mensaje claro y el hub enseña
--     todo en solo lectura.
--   · El corte en sí está preparado en supabase/cortes/corte_final.sql y NO
--     se aplica aquí.
--   · Chat del hub (nuevo, no copia el de la app).
-- ════════════════════════════════════════════════════════════════════════

-- ── Espejo: comentarios y fotos de los trabajos ─────────────────────────
create table if not exists hub.trabajo_comentarios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  trabajo_id uuid, autor_nombre text, texto text
);
create table if not exists hub.trabajo_fotos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  trabajo_id uuid, tecnico_id text, descripcion text, drive_file_id text, drive_url text,
  archivo_path text            -- solo del hub: foto subida al almacén privado «trabajos»
);
create index if not exists trabajo_comentarios_trabajo_idx on hub.trabajo_comentarios (trabajo_id);
create index if not exists trabajo_fotos_trabajo_idx on hub.trabajo_fotos (trabajo_id);
do $$
declare t text;
begin
  foreach t in array array['trabajo_comentarios', 'trabajo_fotos'] loop
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('alter table hub.%I enable row level security', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    execute format('drop policy if exists escribir on hub.%I', t);
    execute format('create policy escribir on hub.%I for all to authenticated
                      using ((select hub.es_usuario()) and hub.tabla_es_del_hub(%L))
                      with check ((select hub.es_usuario()) and hub.tabla_es_del_hub(%L))', t, t, t);
    perform hub.auditar(t);
  end loop;
end $$;
update hub.areas set tablas = '{trabajos,agenda,sesiones,documento_lineas,trabajo_comentarios,trabajo_fotos}' where area = 'trabajos';

-- ── Reglas de escritura (solo con el área cortada) ──────────────────────
create or replace function hub.exigir_area(p_tabla text)
returns void language plpgsql stable set search_path = hub as $fn$
begin
  if not hub.tabla_es_del_hub(p_tabla) then
    raise exception 'Todavía se lleva en la app (% no se ha pasado al hub): hazlo allí', p_tabla;
  end if;
end
$fn$;

-- Fichar (portado de ui/fichaje.js de la app): traslado → inicio → fin.
--   · traslado: solo si no hay sesión abierta.
--   · inicio: cierra la sesión olvidada que tuviera inicio; reusa un traslado
--     abierto; pone la ficha «en progreso».
--   · fin: cierra la sesión con inicio (duración en minutos).
create or replace function hub.fichar(p_accion text, p_tipo text default null, p_id uuid default null, p_lat numeric default null, p_lng numeric default null)
returns jsonb language plpgsql security definer set search_path = hub as $fn$
declare
  yo hub.usuarios := hub.usuario_actual();
  s hub.sesiones;
  v_now timestamptz := now();
  v_cerrada jsonb;
  v_hay boolean;
  v_tabla text := case p_tipo when 'trabajo' then 'trabajos' when 'tarea' then 'tareas' when 'ticket' then 'tickets' end;
  v_estado text := case p_tipo when 'trabajo' then 'En progreso' when 'tarea' then 'en_progreso' when 'ticket' then 'En curso' end;
begin
  if yo.id is null then raise exception 'No estás dado de alta en el hub'; end if;
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
    update hub.sesiones set fin = v_now, duracion_min = round(extract(epoch from v_now - s.inicio) / 60) where id = s.id returning * into s;
    return jsonb_build_object('ok', true, 'sesion', to_jsonb(s));
  end if;
  raise exception 'Acción de fichaje desconocida (traslado, inicio, fin)';
end
$fn$;

-- Material de un trabajo (portado de saveWdLineas/_ajustarStockTrabajo): la
-- DIFERENCIA con lo que había mueve el stock REAL de ese momento (nunca por
-- debajo de 0) y deja su apunte en furgoneta_movimientos con el trabajo.
create or replace function hub.trabajo_guardar_lineas(p_trabajo uuid, p_lineas jsonb)
returns integer language plpgsql security definer set search_path = hub as $fn$
declare
  yo hub.usuarios := hub.usuario_actual();
  r record; v_actual numeric; v_nuevo numeric; v_aplicado numeric; n integer := 0;
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('documento_lineas');
  perform hub.exigir_area('furgoneta_inventario');
  if not exists (select 1 from hub.trabajos where id = p_trabajo) then raise exception 'No existe ese trabajo'; end if;
  for r in
    with antes as (select inventario_id as inv, sum(cantidad) as c from hub.documento_lineas where trabajo_id = p_trabajo and inventario_id is not null group by 1),
         ahora as (select (l->>'inventario_id')::uuid as inv, sum((l->>'cantidad')::numeric) as c from jsonb_array_elements(p_lineas) l
                    where nullif(l->>'inventario_id', '') is not null group by 1)
    select coalesce(a.inv, b.inv) as inv, coalesce(b.c, 0) - coalesce(a.c, 0) as delta
      from antes a full join ahora b on a.inv = b.inv
  loop
    continue when r.delta = 0;
    select cantidad into v_actual from hub.furgoneta_inventario where id = r.inv for update;
    continue when not found;
    v_actual := coalesce(v_actual, 0);
    v_nuevo := greatest(0, v_actual - r.delta);
    v_aplicado := v_actual - v_nuevo;
    continue when v_aplicado = 0;
    update hub.furgoneta_inventario set cantidad = v_nuevo where id = r.inv;
    insert into hub.furgoneta_movimientos (furgoneta_id, producto_id, trabajo_id, tipo, cantidad, tecnico_id, notas)
    select furgoneta_id, r.inv, p_trabajo, case when v_aplicado > 0 then 'salida' else 'entrada' end, abs(v_aplicado), yo.nombre,
           case when r.delta > 0 then 'Material usado en trabajo' else 'Devuelto al quitarlo del trabajo' end
      from hub.furgoneta_inventario where id = r.inv;
  end loop;
  delete from hub.documento_lineas where trabajo_id = p_trabajo;
  insert into hub.documento_lineas (trabajo_id, nombre, cantidad, precio, descuento, subtotal, orden, inventario_id, furgoneta_id, categoria)
  select p_trabajo, l->>'nombre', coalesce((l->>'cantidad')::numeric, 1), coalesce((l->>'precio')::numeric, 0), coalesce((l->>'descuento')::numeric, 0),
         round(coalesce((l->>'cantidad')::numeric, 1) * coalesce((l->>'precio')::numeric, 0) * (1 - coalesce((l->>'descuento')::numeric, 0) / 100), 2),
         o, nullif(l->>'inventario_id', '')::uuid, nullif(l->>'furgoneta_id', '')::uuid, l->>'categoria'
    from jsonb_array_elements(p_lineas) with ordinality as x(l, o)
   where coalesce(trim(l->>'nombre'), '') <> '';
  get diagnostics n = row_count;
  return n;
end
$fn$;

-- Borrar un trabajo devuelve antes su material (las líneas se irían sin apunte).
create or replace function hub.trabajo_antes_borrar()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  -- El espejo (sync-app) borra lo que la app borró: eso ya lo devolvió la app.
  if not hub.tabla_es_del_hub('trabajos') or coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb) ? 'x-hub-sync' then return old; end if;
  perform hub.trabajo_guardar_lineas(old.id, '[]'::jsonb);
  return old;
end
$fn$;
drop trigger if exists trabajo_antes_borrar on hub.trabajos;
create trigger trabajo_antes_borrar before delete on hub.trabajos for each row execute function hub.trabajo_antes_borrar();

-- Estado del trabajo: «Completado» exige un fichaje con inicio y fin (regla de la app).
create or replace function hub.trabajo_estado(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = hub as $fn$
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('trabajos');
  if p_estado not in ('Pendiente', 'En progreso', 'Completado', 'Para facturar', 'Facturado', 'No facturar', 'Cancelado') then raise exception 'Estado no válido'; end if;
  if p_estado = 'Completado' and not exists (select 1 from hub.sesiones where entidad_tipo = 'trabajo' and entidad_id = p_id and inicio is not null and fin is not null) then
    raise exception 'Para completarlo hace falta fichar el inicio y el fin';
  end if;
  update hub.trabajos set estado = p_estado where id = p_id;
  if not found then raise exception 'No existe ese trabajo'; end if;
end
$fn$;

-- Mover un bloque de la agenda (arrastrar en el calendario).
create or replace function hub.agenda_mover(p_id uuid, p_inicio timestamptz, p_fin timestamptz, p_tecnicos text[] default null)
returns void language plpgsql security definer set search_path = hub as $fn$
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('agenda');
  if p_fin <= p_inicio then raise exception 'El fin va después del inicio'; end if;
  update hub.agenda set inicio = p_inicio, fin = p_fin, tecnicos = coalesce(p_tecnicos, tecnicos) where id = p_id;
  if not found then raise exception 'No existe ese bloque'; end if;
end
$fn$;

do $$
declare f text;
begin
  foreach f in array array['hub.fichar(text, text, uuid, numeric, numeric)', 'hub.trabajo_guardar_lineas(uuid, jsonb)', 'hub.trabajo_estado(uuid, text)',
                           'hub.agenda_mover(uuid, timestamptz, timestamptz, text[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ── Chat del hub ─────────────────────────────────────────────────────────
create table if not exists hub.chat_canales (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre     text,
  tipo       text not null default 'grupo' check (tipo in ('grupo', 'directo')),
  miembros   uuid[] not null default '{}',   -- directo: las dos personas
  creado_por uuid,
  archivado  boolean not null default false,
  ultimo_at  timestamptz not null default now()
);
create unique index if not exists chat_directo_idx on hub.chat_canales ((least(miembros[1], miembros[2])), (greatest(miembros[1], miembros[2]))) where tipo = 'directo';
create table if not exists hub.chat_mensajes (
  id         uuid primary key default gen_random_uuid(),
  canal_id   uuid not null references hub.chat_canales (id) on delete cascade,
  autor_id   uuid,
  texto      text not null check (length(trim(texto)) > 0 and length(texto) <= 4000),
  created_at timestamptz not null default now(),
  editado_at timestamptz
);
create index if not exists chat_mensajes_canal_idx on hub.chat_mensajes (canal_id, created_at desc);
create table if not exists hub.chat_leidos (
  canal_id    uuid not null references hub.chat_canales (id) on delete cascade,
  usuario_id  uuid not null,
  leido_hasta timestamptz not null default now(),
  primary key (canal_id, usuario_id)
);

create or replace function hub.chat_puede(p_canal uuid)
returns boolean language sql stable security definer set search_path = hub as $fn$
  select hub.es_usuario() and exists (select 1 from hub.chat_canales c where c.id = p_canal and (c.tipo = 'grupo' or (select (hub.usuario_actual()).id) = any (c.miembros)))
$fn$;

create or replace function hub.chat_mensaje_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_op = 'INSERT' then new.autor_id := (hub.usuario_actual()).id; new.created_at := now();
  else new.editado_at := now(); new.autor_id := old.autor_id; new.canal_id := old.canal_id; new.created_at := old.created_at; end if;
  return new;
end
$fn$;
drop trigger if exists chat_mensaje_antes on hub.chat_mensajes;
create trigger chat_mensaje_antes before insert or update on hub.chat_mensajes for each row execute function hub.chat_mensaje_antes();
create or replace function hub.chat_mensaje_despues()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  update hub.chat_canales set ultimo_at = new.created_at where id = new.canal_id;
  return null;
end
$fn$;
drop trigger if exists chat_mensaje_despues on hub.chat_mensajes;
create trigger chat_mensaje_despues after insert on hub.chat_mensajes for each row execute function hub.chat_mensaje_despues();

-- El canal directo con otra persona (lo crea si no existe).
create or replace function hub.chat_directo(p_otro uuid)
returns uuid language plpgsql security definer set search_path = hub as $fn$
declare yo uuid := (hub.usuario_actual()).id; v uuid;
begin
  if yo is null or not exists (select 1 from hub.usuarios where id = p_otro and activo) or p_otro = yo then raise exception 'Persona no válida'; end if;
  select id into v from hub.chat_canales where tipo = 'directo' and miembros @> array[yo, p_otro] and cardinality(miembros) = 2;
  if v is null then insert into hub.chat_canales (tipo, miembros, creado_por) values ('directo', array[yo, p_otro], yo) returning id into v; end if;
  return v;
end
$fn$;

-- Canales con lo no leído, para la lista.
create or replace function hub.chat_resumen()
returns table (id uuid, nombre text, tipo text, miembros uuid[], ultimo_at timestamptz, sin_leer integer, ultimo_texto text)
language sql stable security definer set search_path = hub as $fn$
  select c.id, c.nombre, c.tipo, c.miembros, c.ultimo_at,
         (select count(*)::integer from hub.chat_mensajes m where m.canal_id = c.id and m.autor_id is distinct from (hub.usuario_actual()).id
            and m.created_at > coalesce((select l.leido_hasta from hub.chat_leidos l where l.canal_id = c.id and l.usuario_id = (hub.usuario_actual()).id), '-infinity')),
         (select left(m.texto, 120) from hub.chat_mensajes m where m.canal_id = c.id order by m.created_at desc limit 1)
    from hub.chat_canales c
   where hub.es_usuario() and not c.archivado and (c.tipo = 'grupo' or (hub.usuario_actual()).id = any (c.miembros))
   order by c.ultimo_at desc
$fn$;

alter table hub.chat_canales enable row level security;
alter table hub.chat_mensajes enable row level security;
alter table hub.chat_leidos enable row level security;
grant select, insert, update on hub.chat_canales to authenticated;
grant select, insert, update, delete on hub.chat_mensajes, hub.chat_leidos to authenticated;
grant all on hub.chat_canales, hub.chat_mensajes, hub.chat_leidos to service_role;
drop policy if exists leer on hub.chat_canales;
create policy leer on hub.chat_canales for select to authenticated using ((select hub.es_usuario()) and (tipo = 'grupo' or (select (hub.usuario_actual()).id) = any (miembros)));
drop policy if exists crear on hub.chat_canales;
create policy crear on hub.chat_canales for insert to authenticated with check ((select hub.es_usuario()) and tipo = 'grupo');
drop policy if exists admin on hub.chat_canales;
create policy admin on hub.chat_canales for update to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()));
drop policy if exists leer on hub.chat_mensajes;
create policy leer on hub.chat_mensajes for select to authenticated using (hub.chat_puede(canal_id));
drop policy if exists escribir on hub.chat_mensajes;
create policy escribir on hub.chat_mensajes for insert to authenticated with check (hub.chat_puede(canal_id));
drop policy if exists propio on hub.chat_mensajes;
create policy propio on hub.chat_mensajes for update to authenticated using (autor_id = (select (hub.usuario_actual()).id)) with check (autor_id = (select (hub.usuario_actual()).id));
drop policy if exists borrar on hub.chat_mensajes;
create policy borrar on hub.chat_mensajes for delete to authenticated using (autor_id = (select (hub.usuario_actual()).id) or (select hub.es_admin()));
drop policy if exists propio on hub.chat_leidos;
create policy propio on hub.chat_leidos for all to authenticated using (usuario_id = (select (hub.usuario_actual()).id)) with check (usuario_id = (select (hub.usuario_actual()).id));
revoke execute on function hub.chat_directo(uuid), hub.chat_resumen() from public, anon;
grant execute on function hub.chat_directo(uuid), hub.chat_resumen() to authenticated, service_role;
select hub.auditar('chat_canales');

insert into hub.chat_canales (nombre, tipo) select 'General', 'grupo' where not exists (select 1 from hub.chat_canales where tipo = 'grupo' and nombre = 'General');
