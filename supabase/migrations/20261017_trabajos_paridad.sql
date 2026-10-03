-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 1 (trabajos y calendario), tanda 1 — PREPARADO.
--
-- Lo que la app hace en la base al crear o mover un trabajo y que el hub no
-- tenía. Igual que el resto de la fase Final, NO hace nada mientras las áreas
-- `trabajos`/`agenda` sean de la app: el espejo ya trae la agenda que la app
-- calcula, y estos disparadores se apartan. Se encienden solos con el corte.
--
--   · Espejo trabajo/tarea ⇄ agenda (portado de okcomputerclaude
--     20260727_agenda_bloques.sql): el PRIMER bloque manda sobre
--     fecha_programada/hora_llegada/duracion_teorica (y en tareas sobre
--     fecha_vencimiento/hora_inicio/hora_fin); quien escribe una fecha en el
--     trabajo crea o mueve su bloque; con 2+ bloques manda la agenda y cambiar
--     la fecha desplaza todos los días a la vez.
--   · Completar un trabajo cierra sus tickets abiertos (saveTrabajo de la app).
-- ════════════════════════════════════════════════════════════════════════

-- ¿Le toca a estos disparadores? Solo con la agenda ya en el hub, y nunca con
-- lo que escribe el sync (x-hub-sync) o el importador (hub.sin_auditoria):
-- eso es copia de lo que la app ya calculó.
create or replace function hub.espejo_agenda_activo()
returns boolean language sql stable set search_path = hub as $fn$
  select hub.tabla_es_del_hub('agenda')
     and not (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ? 'x-hub-sync')
     and coalesce(nullif(current_setting('hub.sin_auditoria', true), ''), 'off') <> 'on'
$fn$;

create or replace function hub.agenda_refrescar_trabajo(p_trabajo uuid)
returns void language plpgsql security definer set search_path = hub as $fn$
declare v_ini timestamptz; v_fin timestamptz; v_fecha date; v_dur int;
begin
  if p_trabajo is null then return; end if;
  select a.inicio, a.fin into v_ini, v_fin from hub.agenda a where a.trabajo_id = p_trabajo order by a.inicio limit 1;
  if v_ini is null then
    update hub.trabajos set fecha_programada = null, hora_llegada = null
     where id = p_trabajo and (fecha_programada is not null or hora_llegada is not null);
    return;
  end if;
  v_fecha := (v_ini at time zone 'Atlantic/Canary')::date;
  v_dur := greatest(15, (extract(epoch from (v_fin - v_ini)) / 60)::int);
  update hub.trabajos set fecha_programada = v_fecha, hora_llegada = v_ini, duracion_teorica = v_dur
   where id = p_trabajo
     and (fecha_programada is distinct from v_fecha or hora_llegada is distinct from v_ini or duracion_teorica is distinct from v_dur);
end
$fn$;

create or replace function hub.agenda_refrescar_tarea(p_tarea uuid)
returns void language plpgsql security definer set search_path = hub as $fn$
declare v_ini timestamptz; v_fin timestamptz; v_allday boolean; v_fecha date; v_hi time; v_hf time;
begin
  if p_tarea is null then return; end if;
  select a.inicio, a.fin, a.todo_el_dia into v_ini, v_fin, v_allday from hub.agenda a where a.tarea_id = p_tarea order by a.inicio limit 1;
  if v_ini is null then
    update hub.tareas set fecha_vencimiento = null, hora_inicio = null, hora_fin = null
     where id = p_tarea and fecha_vencimiento is not null;
    return;
  end if;
  v_fecha := (v_ini at time zone 'Atlantic/Canary')::date;
  v_hi := case when v_allday then null else (v_ini at time zone 'Atlantic/Canary')::time end;
  v_hf := case when v_allday then null else (v_fin at time zone 'Atlantic/Canary')::time end;
  update hub.tareas set fecha_vencimiento = v_fecha, hora_inicio = v_hi, hora_fin = v_hf
   where id = p_tarea
     and (fecha_vencimiento is distinct from v_fecha or hora_inicio is distinct from v_hi or hora_fin is distinct from v_hf);
end
$fn$;

-- agenda → entidad. pg_trigger_depth() > 1 corta el rebote entidad→agenda→entidad.
create or replace function hub.agenda_espejo()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  if pg_trigger_depth() > 1 or not hub.espejo_agenda_activo() then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform hub.agenda_refrescar_trabajo(old.trabajo_id);
    perform hub.agenda_refrescar_tarea(old.tarea_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform hub.agenda_refrescar_trabajo(new.trabajo_id);
    perform hub.agenda_refrescar_tarea(new.tarea_id);
  end if;
  return null;
end
$fn$;
drop trigger if exists agenda_espejo on hub.agenda;
create trigger agenda_espejo after insert or update or delete on hub.agenda
  for each row execute function hub.agenda_espejo();

-- trabajo → agenda: escribir la fecha del trabajo crea o mueve su bloque.
create or replace function hub.trabajo_espejo_agenda()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare v_n int; v_ini timestamptz; v_fin timestamptz; v_primero timestamptz; v_delta int;
begin
  if pg_trigger_depth() > 1 or not hub.espejo_agenda_activo() then return null; end if;
  if tg_op = 'UPDATE' then
    if new.fecha_programada is not distinct from old.fecha_programada and new.hora_llegada is not distinct from old.hora_llegada
       and new.duracion_teorica is not distinct from old.duracion_teorica and new.tecnicos is not distinct from old.tecnicos then
      return null;
    end if;
  end if;
  select count(*) into v_n from hub.agenda where trabajo_id = new.id;
  if new.fecha_programada is null then
    if v_n = 1 then delete from hub.agenda where trabajo_id = new.id; end if;
    return null;
  end if;
  if v_n > 1 then
    select min(inicio) into v_primero from hub.agenda where trabajo_id = new.id;
    v_delta := new.fecha_programada - (v_primero at time zone 'Atlantic/Canary')::date;
    if v_delta <> 0 then
      update hub.agenda set inicio = inicio + make_interval(days => v_delta), fin = fin + make_interval(days => v_delta) where trabajo_id = new.id;
    end if;
    perform hub.agenda_refrescar_trabajo(new.id);
    return null;
  end if;
  v_ini := coalesce(new.hora_llegada, (new.fecha_programada + time '09:00') at time zone 'Atlantic/Canary');
  v_fin := v_ini + make_interval(mins => greatest(15, coalesce(new.duracion_teorica, 60)));
  if v_n = 0 then
    insert into hub.agenda (trabajo_id, inicio, fin, tecnicos) values (new.id, v_ini, v_fin, new.tecnicos);
  else
    update hub.agenda set inicio = v_ini, fin = v_fin, tecnicos = new.tecnicos
     where trabajo_id = new.id and (inicio is distinct from v_ini or fin is distinct from v_fin or tecnicos is distinct from new.tecnicos);
  end if;
  return null;
end
$fn$;
drop trigger if exists trabajo_espejo_agenda on hub.trabajos;
create trigger trabajo_espejo_agenda after insert or update on hub.trabajos
  for each row execute function hub.trabajo_espejo_agenda();

create or replace function hub.tarea_espejo_agenda()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare v_n int; v_ini timestamptz; v_fin timestamptz; v_allday boolean; v_tecs text[]; v_primero timestamptz; v_delta int;
begin
  if pg_trigger_depth() > 1 or not hub.espejo_agenda_activo() then return null; end if;
  if tg_op = 'UPDATE' then
    if new.fecha_vencimiento is not distinct from old.fecha_vencimiento and new.hora_inicio is not distinct from old.hora_inicio
       and new.hora_fin is not distinct from old.hora_fin and new.duracion_teorica is not distinct from old.duracion_teorica
       and new.tecnico_id is not distinct from old.tecnico_id then
      return null;
    end if;
  end if;
  select count(*) into v_n from hub.agenda where tarea_id = new.id;
  if new.fecha_vencimiento is null then
    if v_n = 1 then delete from hub.agenda where tarea_id = new.id; end if;
    return null;
  end if;
  if v_n > 1 then
    select min(inicio) into v_primero from hub.agenda where tarea_id = new.id;
    v_delta := new.fecha_vencimiento - (v_primero at time zone 'Atlantic/Canary')::date;
    if v_delta <> 0 then
      update hub.agenda set inicio = inicio + make_interval(days => v_delta), fin = fin + make_interval(days => v_delta) where tarea_id = new.id;
    end if;
    perform hub.agenda_refrescar_tarea(new.id);
    return null;
  end if;
  v_allday := new.hora_inicio is null;
  v_tecs := case when new.tecnico_id is null or new.tecnico_id = '' then null else array[new.tecnico_id] end;
  if v_allday then
    v_ini := (new.fecha_vencimiento + time '00:00') at time zone 'Atlantic/Canary';
    v_fin := (new.fecha_vencimiento + 1 + time '00:00') at time zone 'Atlantic/Canary';
  else
    v_ini := (new.fecha_vencimiento + new.hora_inicio) at time zone 'Atlantic/Canary';
    v_fin := case when new.hora_fin is not null and new.hora_fin > new.hora_inicio
                  then (new.fecha_vencimiento + new.hora_fin) at time zone 'Atlantic/Canary'
                  else v_ini + make_interval(mins => greatest(15, coalesce(new.duracion_teorica, 60))) end;
  end if;
  if v_n = 0 then
    insert into hub.agenda (tarea_id, inicio, fin, todo_el_dia, tecnicos) values (new.id, v_ini, v_fin, v_allday, v_tecs);
  else
    update hub.agenda set inicio = v_ini, fin = v_fin, todo_el_dia = v_allday, tecnicos = v_tecs
     where tarea_id = new.id and (inicio is distinct from v_ini or fin is distinct from v_fin
       or todo_el_dia is distinct from v_allday or tecnicos is distinct from v_tecs);
  end if;
  return null;
end
$fn$;
drop trigger if exists tarea_espejo_agenda on hub.tareas;
create trigger tarea_espejo_agenda after insert or update on hub.tareas
  for each row execute function hub.tarea_espejo_agenda();

-- Completar un trabajo cierra sus tickets abiertos (como saveTrabajo de la app).
-- Mismo contrato que en 20261016_final.sql; solo se añade el cierre.
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
  if p_estado = 'Completado' then
    update hub.tickets set estado = 'Cerrado' where trabajo_id = p_id and estado <> 'Cerrado';
  end if;
end
$fn$;

do $$
declare f text;
begin
  foreach f in array array['hub.espejo_agenda_activo()', 'hub.agenda_refrescar_trabajo(uuid)', 'hub.agenda_refrescar_tarea(uuid)',
                           'hub.trabajo_estado(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
