-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 7 · tanda 1: el inventario completo (furgonetas.js de la app).
--
-- Regla de la app: el stock de un producto NUNCA se cambia a secas; cada
-- ajuste deja su apunte en furgoneta_movimientos (entrada / salida /
-- trasvase, quién y por qué), y todo artículo del inventario tiene su ficha
-- en el catálogo (syncInventarioACatalogo). Aquí esas reglas viven en la BASE,
-- en funciones que exigen el área `inventario` (hub.exigir_area): mientras el
-- inventario sea de la app no escriben nada y el front lo enseña en solo
-- lectura; el corte las enciende sin tocar la pantalla.
--   · hub.inventario_catalogo  — busca o crea la ficha del catálogo y la enlaza.
--   · hub.inventario_guardar   — alta o edición de un producto (la diferencia
--                                de cantidad queda como movimiento).
--   · hub.inventario_mover     — entrada, salida o trasvase (parte del stock
--                                REAL de ese momento; nunca por debajo de 0).
--   · hub.inventario_entradas  — varias líneas de golpe: albarán (suma a lo
--                                que ya hay por nombre) o Excel (filas nuevas,
--                                como la app).
-- El vehículo nuevo es un INSERT en furgonetas (la RLS del área lo permite tras
-- el corte).
-- ════════════════════════════════════════════════════════════════════════

create or replace function hub.inventario_catalogo(p_inv uuid, p_nombre text, p_codigo text default null,
  p_precio numeric default null, p_elegido uuid default null)
returns uuid language plpgsql security definer set search_path = hub as $fn$
declare v_cat uuid; v_nombre text := nullif(trim(p_nombre), ''); v_cod text := nullif(trim(p_codigo), '');
begin
  if not hub.es_usuario() and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('catalogo');
  if v_nombre is null then return null; end if;
  -- El elegido en el buscador manda, pero solo mientras el nombre siga siendo el suyo.
  if p_elegido is not null then
    select id into v_cat from hub.catalogo where id = p_elegido and lower(trim(nombre)) = lower(v_nombre);
  end if;
  if v_cat is null then
    select id into v_cat from hub.catalogo
     where lower(trim(nombre)) = lower(v_nombre) or (v_cod is not null and lower(trim(referencia)) = lower(v_cod))
     order by activo desc nulls last, created_at limit 1;
  end if;
  if v_cat is null then
    insert into hub.catalogo (nombre, categoria, precio, unidad, referencia, activo)
    values (v_nombre, 'Hardware', coalesce(p_precio, 0), 'ud', v_cod, true) returning id into v_cat;
  end if;
  if p_inv is not null then
    update hub.furgoneta_inventario set catalogo_id = v_cat where id = p_inv and catalogo_id is distinct from v_cat;
  end if;
  return v_cat;
end
$fn$;

-- Apunte de un movimiento (uso interno).
create or replace function hub._inventario_apunte(p_furgoneta uuid, p_producto uuid, p_tipo text, p_cantidad numeric,
  p_notas text, p_destino uuid default null)
returns void language sql security definer set search_path = hub as $fn$
  insert into hub.furgoneta_movimientos (furgoneta_id, producto_id, tipo, cantidad, destino_id, tecnico_id, notas)
  select p_furgoneta, p_producto, p_tipo, abs(p_cantidad), p_destino, (hub.usuario_actual()).nombre, p_notas
   where coalesce(p_cantidad, 0) <> 0
$fn$;
revoke execute on function hub._inventario_apunte(uuid, uuid, text, numeric, text, uuid) from public, authenticated;

-- Alta o edición. p_datos: nombre, categoria, cantidad, stock_minimo, precio,
-- notas, codigo_principal, codigo_barra. Devuelve el id.
create or replace function hub.inventario_guardar(p_id uuid, p_furgoneta uuid, p_datos jsonb, p_catalogo uuid default null)
returns uuid language plpgsql security definer set search_path = hub as $fn$
declare
  v_id uuid := p_id; v_antes numeric; v_furg uuid; v_cant numeric := coalesce((p_datos->>'cantidad')::numeric, 0);
  v_nombre text := nullif(trim(p_datos->>'nombre'), '');
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('furgoneta_inventario');
  if v_nombre is null then raise exception 'El nombre es obligatorio'; end if;
  if v_cant < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  if v_id is null then
    if p_furgoneta is null or not exists (select 1 from hub.furgonetas where id = p_furgoneta) then raise exception 'Elige una ubicación'; end if;
    insert into hub.furgoneta_inventario (furgoneta_id, nombre, categoria, cantidad, stock_minimo, precio, notas, codigo_principal, codigo_barra)
    values (p_furgoneta, v_nombre, coalesce(nullif(p_datos->>'categoria', ''), 'Material'), v_cant,
            coalesce((p_datos->>'stock_minimo')::numeric, 1), coalesce((p_datos->>'precio')::numeric, 0), nullif(p_datos->>'notas', ''),
            nullif(trim(p_datos->>'codigo_principal'), ''), nullif(trim(p_datos->>'codigo_barra'), ''))
    returning id into v_id;
    perform hub._inventario_apunte(p_furgoneta, v_id, 'entrada', v_cant, 'Alta de producto');
  else
    select cantidad, furgoneta_id into v_antes, v_furg from hub.furgoneta_inventario where id = v_id for update;
    if not found then raise exception 'No existe ese producto'; end if;
    update hub.furgoneta_inventario set nombre = v_nombre, categoria = coalesce(nullif(p_datos->>'categoria', ''), categoria), cantidad = v_cant,
      stock_minimo = coalesce((p_datos->>'stock_minimo')::numeric, stock_minimo), precio = coalesce((p_datos->>'precio')::numeric, precio),
      notas = nullif(p_datos->>'notas', ''), codigo_principal = nullif(trim(p_datos->>'codigo_principal'), ''), codigo_barra = nullif(trim(p_datos->>'codigo_barra'), '')
     where id = v_id;
    perform hub._inventario_apunte(v_furg, v_id, case when v_cant >= coalesce(v_antes, 0) then 'entrada' else 'salida' end,
      v_cant - coalesce(v_antes, 0), 'Ajuste manual desde la ficha del producto');
  end if;
  perform hub.inventario_catalogo(v_id, v_nombre, p_datos->>'codigo_principal', (p_datos->>'precio')::numeric, p_catalogo);
  return v_id;
end
$fn$;

-- Entrada, salida o trasvase. Devuelve la cantidad que queda en el origen.
create or replace function hub.inventario_mover(p_producto uuid, p_tipo text, p_cantidad numeric, p_destino uuid default null, p_notas text default null)
returns numeric language plpgsql security definer set search_path = hub as $fn$
declare
  p hub.furgoneta_inventario; v_nuevo numeric; v_dest uuid; v_nota text := nullif(trim(p_notas), '');
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('furgoneta_inventario');
  if p_tipo not in ('entrada', 'salida', 'trasvase') then raise exception 'Tipo de movimiento no válido'; end if;
  if coalesce(p_cantidad, 0) <= 0 then raise exception 'La cantidad tiene que ser mayor que cero'; end if;
  select * into p from hub.furgoneta_inventario where id = p_producto for update;
  if not found then raise exception 'No existe ese producto'; end if;
  if p_tipo = 'trasvase' then
    if p_destino is null or p_destino = p.furgoneta_id then raise exception 'Elige otra ubicación de destino'; end if;
    if not exists (select 1 from hub.furgonetas where id = p_destino) then raise exception 'No existe esa ubicación'; end if;
  end if;
  v_nuevo := case when p_tipo = 'entrada' then coalesce(p.cantidad, 0) + p_cantidad else greatest(0, coalesce(p.cantidad, 0) - p_cantidad) end;
  update hub.furgoneta_inventario set cantidad = v_nuevo where id = p.id;
  perform hub._inventario_apunte(p.furgoneta_id, p.id, p_tipo, p_cantidad, v_nota, case when p_tipo = 'trasvase' then p_destino end);
  if p_tipo = 'trasvase' then
    -- En el destino: el mismo producto (por nombre) suma; si no está, se da de alta con sus datos.
    select id into v_dest from hub.furgoneta_inventario where furgoneta_id = p_destino and lower(trim(nombre)) = lower(trim(p.nombre)) limit 1 for update;
    if v_dest is null then
      insert into hub.furgoneta_inventario (furgoneta_id, nombre, categoria, cantidad, stock_minimo, precio, codigo_principal, codigo_barra, catalogo_id)
      values (p_destino, p.nombre, p.categoria, p_cantidad, p.stock_minimo, coalesce(p.precio, 0), p.codigo_principal, p.codigo_barra, p.catalogo_id)
      returning id into v_dest;
    else
      update hub.furgoneta_inventario set cantidad = coalesce(cantidad, 0) + p_cantidad where id = v_dest;
    end if;
    perform hub._inventario_apunte(p_destino, v_dest, 'entrada', p_cantidad, format('Trasvase recibido (%s)', coalesce(v_nota, 'sin nota')));
  end if;
  return v_nuevo;
end
$fn$;

-- Varias líneas de golpe en una ubicación. p_lineas: [{nombre, cantidad,
-- precio?, referencia?, categoria?, stock_minimo?, notas?}]. p_modo:
-- 'albaran' (lo que ya está por nombre SUMA; lo nuevo, alta) o 'excel' (cada
-- fila es un alta, como «Importar» de la app). Devuelve {altas, sumadas}.
create or replace function hub.inventario_entradas(p_furgoneta uuid, p_lineas jsonb, p_modo text default 'albaran')
returns jsonb language plpgsql security definer set search_path = hub as $fn$
declare
  l jsonb; v_id uuid; v_nombre text; v_cant numeric; n_altas integer := 0; n_suma integer := 0;
  v_nota text := case when p_modo = 'excel' then 'Importado desde Excel' else 'Entrada por albarán' end;
begin
  if not hub.es_usuario() then raise exception 'No estás dado de alta en el hub'; end if;
  perform hub.exigir_area('furgoneta_inventario');
  if p_modo not in ('albaran', 'excel') then raise exception 'Modo no válido'; end if;
  if p_furgoneta is null or not exists (select 1 from hub.furgonetas where id = p_furgoneta) then raise exception 'Elige una ubicación'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'No hay líneas'; end if;
  if jsonb_array_length(p_lineas) > 500 then raise exception 'Como mucho 500 líneas de una vez'; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_nombre := nullif(trim(l->>'nombre'), '');
    continue when v_nombre is null;
    v_cant := greatest(0, coalesce((l->>'cantidad')::numeric, 0));
    v_id := null;
    if p_modo = 'albaran' then
      continue when v_cant <= 0;
      select id into v_id from hub.furgoneta_inventario where furgoneta_id = p_furgoneta and lower(trim(nombre)) = lower(v_nombre) limit 1 for update;
    end if;
    if v_id is not null then
      update hub.furgoneta_inventario set cantidad = coalesce(cantidad, 0) + v_cant where id = v_id;
      perform hub._inventario_apunte(p_furgoneta, v_id, 'entrada', v_cant, v_nota);
      n_suma := n_suma + 1;
    else
      insert into hub.furgoneta_inventario (furgoneta_id, nombre, categoria, cantidad, stock_minimo, precio, codigo_principal, notas)
      values (p_furgoneta, v_nombre,
              coalesce((select c from unnest(array['Material', 'Herramienta', 'Consumible', 'Equipo']) c where lower(c) = lower(l->>'categoria')), 'Material'),
              v_cant, coalesce((l->>'stock_minimo')::numeric, case when p_modo = 'excel' then 0 else 1 end), coalesce((l->>'precio')::numeric, 0),
              nullif(trim(l->>'referencia'), ''), nullif(trim(l->>'notas'), ''))
      returning id into v_id;
      perform hub._inventario_apunte(p_furgoneta, v_id, 'entrada', v_cant, case when p_modo = 'excel' then v_nota else 'Alta por albarán' end);
      n_altas := n_altas + 1;
    end if;
    perform hub.inventario_catalogo(v_id, v_nombre, l->>'referencia', (l->>'precio')::numeric, null);
  end loop;
  return jsonb_build_object('altas', n_altas, 'sumadas', n_suma);
end
$fn$;

grant execute on function hub.inventario_catalogo(uuid, text, text, numeric, uuid) to authenticated, service_role;
grant execute on function hub.inventario_guardar(uuid, uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function hub.inventario_mover(uuid, text, numeric, uuid, text) to authenticated, service_role;
grant execute on function hub.inventario_entradas(uuid, jsonb, text) to authenticated, service_role;
