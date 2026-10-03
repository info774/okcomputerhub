-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 3, tanda 1 — Presupuestos con escritura (PREPARADO).
--
-- · presupuesto_plantillas: espejo de la app (mismas columnas; `lineas` jsonb
--   [{nombre, cantidad, precio, descuento}]). Área `presupuestos`. La app no la
--   apunta en su audit_log: llega en la pasada nocturna.
-- · Las líneas de un presupuesto viven en documento_lineas, que es del área
--   `trabajos` (la comparten con los trabajos). Para que el corte de
--   presupuestos no dependa del de trabajos, las líneas de un presupuesto se
--   escriben SOLO con hub.presupuesto_guardar_lineas (security definer, exige
--   el área `presupuestos`), que además deja el total al día (sin impuestos).
-- · hub.trabajo_desde_presupuesto: «Convertir en trabajo» de la app
--   (confirmarTrabajoDesdePresupuesto): crea el trabajo con el cliente, la sede,
--   el contacto y el presupuesto, y le copia las líneas. Exige el área `trabajos`.
-- · Borrar un presupuesto se lleva sus líneas (en la app, por cascada).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.presupuesto_plantillas (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  nombre      text not null,
  descripcion text,
  icono       text default '📄',
  activa      boolean default true,
  lineas      jsonb default '[]'::jsonb
);

grant select, insert, update, delete on hub.presupuesto_plantillas to authenticated;
grant all on hub.presupuesto_plantillas to service_role;
alter table hub.presupuesto_plantillas enable row level security;
drop policy if exists leer on hub.presupuesto_plantillas;
create policy leer on hub.presupuesto_plantillas for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.presupuesto_plantillas;
create policy escribir on hub.presupuesto_plantillas for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('presupuesto_plantillas'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('presupuesto_plantillas'));
select hub.auditar('presupuesto_plantillas');

update hub.areas set tablas = array_append(tablas, 'presupuesto_plantillas')
 where area = 'presupuestos' and not ('presupuesto_plantillas' = any (tablas));

-- Las líneas de un presupuesto: se sustituyen enteras y el total se recalcula.
create or replace function hub.presupuesto_guardar_lineas(p_presupuesto uuid, p_lineas jsonb)
returns numeric language plpgsql security definer set search_path = hub as $fn$
declare v_total numeric;
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('presupuestos');
  if not exists (select 1 from hub.presupuestos where id = p_presupuesto) then raise exception 'No existe ese presupuesto'; end if;
  delete from hub.documento_lineas where presupuesto_id = p_presupuesto;
  insert into hub.documento_lineas (presupuesto_id, nombre, cantidad, precio, descuento, subtotal, orden)
  select p_presupuesto, trim(l->>'nombre'), coalesce((l->>'cantidad')::numeric, 1), coalesce((l->>'precio')::numeric, 0),
         coalesce((l->>'descuento')::numeric, 0),
         round(coalesce((l->>'cantidad')::numeric, 1) * coalesce((l->>'precio')::numeric, 0) * (1 - coalesce((l->>'descuento')::numeric, 0) / 100), 2),
         o
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) with ordinality as x(l, o)
   where coalesce(trim(l->>'nombre'), '') <> '';
  select coalesce(sum(subtotal), 0) into v_total from hub.documento_lineas where presupuesto_id = p_presupuesto;
  update hub.presupuestos set total = v_total where id = p_presupuesto;
  return v_total;
end
$fn$;
revoke execute on function hub.presupuesto_guardar_lineas(uuid, jsonb) from public, anon;
grant execute on function hub.presupuesto_guardar_lineas(uuid, jsonb) to authenticated;

-- Presupuesto → trabajo. p_datos: {descripcion, tipo, fecha, hora_llegada, tecnicos[]}.
create or replace function hub.trabajo_desde_presupuesto(p_presupuesto uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = hub as $fn$
declare p hub.presupuestos; v_id uuid; v_numero integer;
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('trabajos');
  select * into p from hub.presupuestos where id = p_presupuesto;
  if not found then raise exception 'No existe ese presupuesto'; end if;
  if coalesce(trim(p_datos->>'descripcion'), '') = '' then raise exception 'La descripción es obligatoria'; end if;
  insert into hub.trabajos (tipo, cliente_id, local_id, contacto_id, titulo, descripcion, fecha_programada, hora_llegada, tecnicos, estado, presupuesto_id)
  values (coalesce(nullif(p_datos->>'tipo', ''), 'Instalación'), p.cliente_id, p.local_id, p.contacto_id, p.titulo, trim(p_datos->>'descripcion'),
          nullif(p_datos->>'fecha', '')::date, nullif(p_datos->>'hora_llegada', '')::timestamptz,
          nullif(array(select jsonb_array_elements_text(coalesce(p_datos->'tecnicos', '[]'::jsonb))), '{}'::text[]),
          'Pendiente', p.id)
  returning id, numero into v_id, v_numero;
  insert into hub.documento_lineas (trabajo_id, nombre, cantidad, precio, descuento, subtotal, orden)
  select v_id, nombre, cantidad, precio, descuento, subtotal, orden from hub.documento_lineas where presupuesto_id = p.id;
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end
$fn$;
revoke execute on function hub.trabajo_desde_presupuesto(uuid, jsonb) from public, anon;
grant execute on function hub.trabajo_desde_presupuesto(uuid, jsonb) to authenticated;

-- Borrar un presupuesto (solo con el área del hub) se lleva sus líneas.
create or replace function hub.presupuesto_antes_borrar()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  if not hub.tabla_es_del_hub('presupuestos') or coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb) ? 'x-hub-sync' then return old; end if;
  delete from hub.documento_lineas where presupuesto_id = old.id;
  return old;
end
$fn$;
drop trigger if exists presupuesto_antes_borrar on hub.presupuestos;
create trigger presupuesto_antes_borrar before delete on hub.presupuestos for each row execute function hub.presupuesto_antes_borrar();

-- Eliminar un presupuesto, solo un admin (como la RLS de la app).
drop policy if exists borrar_solo_admin on hub.presupuestos;
create policy borrar_solo_admin on hub.presupuestos as restrictive for delete to authenticated using ((select hub.es_admin()));
