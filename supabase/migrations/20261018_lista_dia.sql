-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 1, tanda 3 — Lista del día (PREPARADO).
--
-- Espejo de `lista_dia` de la app (20260827_lista_dia.sql, mismas columnas) en
-- su propia área, dueño `app`: sync-app la copia (está en el audit_log de la
-- app; y entera cada noche) y el hub la enseña en solo lectura hasta el corte.
-- Una fila = una cosa en la lista de UNA persona para UN día; `usuario` va por
-- NOMBRE, como trabajos.tecnicos o tareas.tecnico_id.
--
-- hub.lista_dia_marcar porta toggleListaDiaItem de la app: marcar cierra el
-- origen (Completado / completada / Cerrado) guardando su estado en
-- `estado_previo`; un trabajo o una tarea sin fichaje (inicio y fin) se marca
-- en la lista pero NO se cierra, y se avisa; desmarcar lo devuelve, y solo si
-- sigue en el estado de cierre.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.lista_dia (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  fecha         date not null default current_date,
  usuario       text not null,
  tipo          text not null check (tipo in ('trabajo', 'tarea', 'ticket', 'nota')),
  ref_id        uuid,
  titulo        text,
  orden         int not null default 0,
  completado    boolean not null default false,
  completado_at timestamptz,
  estado_previo text,
  creado_por    text
);
create unique index if not exists lista_dia_unica_idx on hub.lista_dia (fecha, usuario, tipo, ref_id) where ref_id is not null;
create index if not exists lista_dia_usuario_fecha_idx on hub.lista_dia (usuario, fecha);
create index if not exists lista_dia_fecha_idx on hub.lista_dia (fecha);

grant select, insert, update, delete on hub.lista_dia to authenticated;
grant all on hub.lista_dia to service_role;
alter table hub.lista_dia enable row level security;
drop policy if exists leer on hub.lista_dia;
create policy leer on hub.lista_dia for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.lista_dia;
create policy escribir on hub.lista_dia for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('lista_dia'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('lista_dia'));
select hub.auditar('lista_dia');

insert into hub.areas (area, dueno, tablas, notas)
values ('lista_dia', 'app', '{lista_dia}', 'Paridad bloque 1: lista del día; espejo hasta el corte final')
on conflict (area) do update set tablas = excluded.tablas, notas = excluded.notas;

-- Borrar el origen se lleva sus filas de la lista (lista_dia_limpiar_origen de
-- la app: ref_id no tiene clave ajena porque apunta a tres tablas).
create or replace function hub.lista_dia_limpiar_origen()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  delete from hub.lista_dia where tipo = tg_argv[0] and ref_id = old.id;
  return old;
end
$fn$;
drop trigger if exists lista_dia_limpiar_trabajo on hub.trabajos;
create trigger lista_dia_limpiar_trabajo after delete on hub.trabajos for each row execute function hub.lista_dia_limpiar_origen('trabajo');
drop trigger if exists lista_dia_limpiar_tarea on hub.tareas;
create trigger lista_dia_limpiar_tarea after delete on hub.tareas for each row execute function hub.lista_dia_limpiar_origen('tarea');
drop trigger if exists lista_dia_limpiar_ticket on hub.tickets;
create trigger lista_dia_limpiar_ticket after delete on hub.tickets for each row execute function hub.lista_dia_limpiar_origen('ticket');

create or replace function hub.lista_dia_marcar(p_id uuid, p_marcar boolean)
returns jsonb language plpgsql security definer set search_path = hub as $fn$
declare
  it hub.lista_dia;
  v_tabla text; v_hecho text; v_actual text; v_aviso text;
  v_previo text;
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('lista_dia');
  select * into it from hub.lista_dia where id = p_id for update;
  if not found then raise exception 'No está en la lista'; end if;
  v_previo := it.estado_previo;
  if it.tipo <> 'nota' and it.ref_id is not null then
    v_tabla := case it.tipo when 'trabajo' then 'trabajos' when 'tarea' then 'tareas' else 'tickets' end;
    v_hecho := case it.tipo when 'trabajo' then 'Completado' when 'tarea' then 'completada' else 'Cerrado' end;
    execute format('select estado from hub.%I where id = $1', v_tabla) into v_actual using it.ref_id;
    if v_actual is not null then
      if p_marcar and v_actual <> v_hecho then
        if it.tipo in ('trabajo', 'tarea') and not exists (
             select 1 from hub.sesiones where entidad_tipo = it.tipo and entidad_id = it.ref_id and inicio is not null and fin is not null) then
          v_aviso := format('Marcado en la lista. El %s sigue en «%s»: hace falta fichar el inicio y el fin para completarlo.', it.tipo, v_actual);
        else
          perform hub.exigir_area(v_tabla);
          v_previo := v_actual;
          execute format('update hub.%I set estado = $1 where id = $2', v_tabla) using v_hecho, it.ref_id;
        end if;
      elsif not p_marcar and v_actual = v_hecho and it.estado_previo is not null then
        perform hub.exigir_area(v_tabla);
        execute format('update hub.%I set estado = $1 where id = $2', v_tabla) using it.estado_previo, it.ref_id;
        v_previo := null;
      end if;
    end if;
  end if;
  update hub.lista_dia set completado = p_marcar, completado_at = case when p_marcar then now() end, estado_previo = v_previo where id = p_id;
  return jsonb_build_object('ok', true, 'aviso', v_aviso);
end
$fn$;
revoke execute on function hub.lista_dia_marcar(uuid, boolean) from public, anon;
grant execute on function hub.lista_dia_marcar(uuid, boolean) to authenticated, service_role;
