-- ════════════════════════════════════════════════════════════════════════
-- Fase 9 · Almacén: stock (espejo), MRP, proveedores, compras y envíos.
--
--   · Inventario y catálogo SIGUEN EN LA APP hasta la fase Final (los
--     técnicos gastan material desde los trabajos): aquí son ESPEJO de solo
--     lectura (área `inventario`, dueño `app`), mismas columnas que la app.
--   · Proveedores y pedidos de compra son DEL HUB (en la app nunca llegaron a
--     producción: no hay nada que importar).
--   · MRP (hub.mrp()): con el stock y el consumo de los últimos 90 días del
--     espejo, lo pedido y no recibido y el plazo del proveedor, cuánto pedir.
--   · Envíos: registro manual con agencia y nº de seguimiento.
-- ════════════════════════════════════════════════════════════════════════

-- ── Espejo del inventario de la app ──────────────────────────────────────
create table if not exists hub.catalogo (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  nombre text not null, categoria text default 'Servicio', precio numeric default 0, unidad text default 'ud',
  referencia text, descripcion text, activo boolean default true, zoho_item_id text
);
create table if not exists hub.furgonetas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  nombre text not null, tecnico_responsable text
);
create table if not exists hub.furgoneta_inventario (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  furgoneta_id uuid, nombre text not null, categoria text default 'Material', cantidad numeric default 0,
  stock_minimo numeric default 1, notas text, codigo_principal text, codigo_barra text, precio numeric, catalogo_id uuid
);
create table if not exists hub.furgoneta_movimientos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  furgoneta_id uuid, producto_id uuid, tipo text, cantidad numeric, destino_id uuid, tecnico_id text, notas text, trabajo_id uuid
);
create index if not exists furgoneta_inventario_catalogo_idx on hub.furgoneta_inventario (catalogo_id);
create index if not exists furgoneta_movimientos_producto_idx on hub.furgoneta_movimientos (producto_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['catalogo', 'furgonetas', 'furgoneta_inventario', 'furgoneta_movimientos'] loop
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

insert into hub.areas (area, dueno, tablas, notas)
values ('inventario', 'app', '{catalogo,furgonetas,furgoneta_inventario,furgoneta_movimientos}',
        'Fase 9: espejo de solo lectura para el MRP; se corta en la fase Final (lo gastan los trabajos)')
on conflict (area) do update set tablas = excluded.tablas, notas = excluded.notas;

-- ── Proveedores y lo que cada uno sirve ─────────────────────────────────
create table if not exists hub.proveedores (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  nombre           text not null check (length(trim(nombre)) > 0),
  nif              text, direccion text, telefono text, email text, web text,
  condiciones_pago text,
  plazo_dias       integer not null default 3 check (plazo_dias >= 0),  -- lo que tarda en llegar
  pedido_minimo    numeric,
  notas            text,
  activo           boolean not null default true
);
create table if not exists hub.material_proveedor (
  id             uuid primary key default gen_random_uuid(),
  catalogo_id    uuid not null,                 -- hub.catalogo (espejo)
  proveedor_id   uuid not null references hub.proveedores (id) on delete cascade,
  ref_proveedor  text,
  precio_compra  numeric,
  plazo_dias     integer check (plazo_dias >= 0), -- si no, el del proveedor
  preferido      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (catalogo_id, proveedor_id)
);
create unique index if not exists material_proveedor_preferido_idx on hub.material_proveedor (catalogo_id) where preferido;

-- ── Pedidos de compra ────────────────────────────────────────────────────
create sequence if not exists hub.pedidos_compra_numero_seq;
create table if not exists hub.pedidos_compra (
  id              uuid primary key default gen_random_uuid(),
  numero          integer not null default nextval('hub.pedidos_compra_numero_seq') unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  proveedor_id    uuid references hub.proveedores (id),
  fecha           date not null default current_date,
  estado          text not null default 'Borrador' check (estado in ('Borrador', 'Enviado', 'Confirmado', 'Recibido', 'Cancelado')),
  esperado_para   date,
  enviado_at      timestamptz,
  recibido_at     timestamptz,
  entrada_app_at  timestamptz,   -- alguien dio la entrada del material en el Inventario de la app
  notas           text,
  total           numeric not null default 0,
  creado_por      uuid
);
create table if not exists hub.pedido_compra_lineas (
  id                uuid primary key default gen_random_uuid(),
  pedido_compra_id  uuid not null references hub.pedidos_compra (id) on delete cascade,
  catalogo_id       uuid,
  nombre            text not null,
  cantidad          numeric not null default 1 check (cantidad > 0),
  precio            numeric not null default 0,
  subtotal          numeric generated always as (cantidad * precio) stored,
  cantidad_recibida numeric not null default 0,
  orden             integer not null default 1
);
create index if not exists pedido_lineas_pedido_idx on hub.pedido_compra_lineas (pedido_compra_id);
create index if not exists pedido_lineas_catalogo_idx on hub.pedido_compra_lineas (catalogo_id);

create or replace function hub.pedido_compra_antes()
returns trigger language plpgsql set search_path = hub as $fn$
declare v_plazo integer;
begin
  if tg_op = 'INSERT' then new.creado_por := coalesce(new.creado_por, (hub.usuario_actual()).id);
  else new.updated_at := now(); end if;
  if new.estado = 'Enviado' and (tg_op = 'INSERT' or old.estado <> 'Enviado') then
    new.enviado_at := coalesce(new.enviado_at, now());
    if new.esperado_para is null then
      select plazo_dias into v_plazo from hub.proveedores where id = new.proveedor_id;
      new.esperado_para := current_date + coalesce(v_plazo, 3);
    end if;
  end if;
  if new.estado = 'Recibido' and (tg_op = 'INSERT' or old.estado <> 'Recibido') then new.recibido_at := coalesce(new.recibido_at, now()); end if;
  return new;
end
$fn$;
drop trigger if exists pedido_compra_antes on hub.pedidos_compra;
create trigger pedido_compra_antes before insert or update on hub.pedidos_compra for each row execute function hub.pedido_compra_antes();

-- El total del pedido, siempre la suma de sus líneas.
create or replace function hub.pedido_compra_total()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare v_id uuid := coalesce(new.pedido_compra_id, old.pedido_compra_id);
begin
  update hub.pedidos_compra set total = coalesce((select sum(subtotal) from hub.pedido_compra_lineas where pedido_compra_id = v_id), 0) where id = v_id;
  return null;
end
$fn$;
drop trigger if exists pedido_compra_total on hub.pedido_compra_lineas;
create trigger pedido_compra_total after insert or update or delete on hub.pedido_compra_lineas for each row execute function hub.pedido_compra_total();

drop trigger if exists tocar_updated_at on hub.proveedores;
create trigger tocar_updated_at before update on hub.proveedores for each row execute function hub.tocar_updated_at();

-- ── Envíos ───────────────────────────────────────────────────────────────
create table if not exists hub.envios (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sentido          text not null default 'salida' check (sentido in ('salida', 'entrada')),
  agencia          text not null default 'Correos',
  seguimiento      text,
  estado           text not null default 'preparado' check (estado in ('preparado', 'enviado', 'en_transito', 'entregado', 'incidencia', 'devuelto')),
  cliente_id       uuid, local_id uuid, proveedor_id uuid references hub.proveedores (id),
  pedido_compra_id uuid references hub.pedidos_compra (id) on delete set null,
  ticket_id        uuid, trabajo_id uuid,
  destinatario     text, direccion text, telefono text,
  contenido        text,
  bultos           integer not null default 1 check (bultos > 0),
  peso_kg          numeric,
  coste            numeric,
  enviado_at       timestamptz,
  entregado_at     timestamptz,
  notas            text,
  creado_por       uuid
);
create index if not exists envios_estado_idx on hub.envios (estado, created_at desc);

create or replace function hub.envio_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_op = 'INSERT' then new.creado_por := coalesce(new.creado_por, (hub.usuario_actual()).id);
  else new.updated_at := now(); end if;
  if new.estado in ('enviado', 'en_transito') and new.enviado_at is null then new.enviado_at := now(); end if;
  if new.estado = 'entregado' and (tg_op = 'INSERT' or old.estado <> 'entregado') then new.entregado_at := now(); end if;
  return new;
end
$fn$;
drop trigger if exists envio_antes on hub.envios;
create trigger envio_antes before insert or update on hub.envios for each row execute function hub.envio_antes();

-- ── RLS y auditoría de lo nuevo ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['proveedores', 'material_proveedor', 'pedidos_compra', 'pedido_compra_lineas', 'envios'] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    execute format('drop policy if exists crear on hub.%I', t);
    execute format('create policy crear on hub.%I for insert to authenticated with check ((select hub.es_usuario()))', t);
    execute format('drop policy if exists cambiar on hub.%I', t);
    execute format('create policy cambiar on hub.%I for update to authenticated using ((select hub.es_usuario())) with check ((select hub.es_usuario()))', t);
    execute format('drop policy if exists borrar on hub.%I', t);
    -- Las líneas de un pedido se quitan al editarlo; lo demás, solo admins.
    if t = 'pedido_compra_lineas' or t = 'material_proveedor' then
      execute format('create policy borrar on hub.%I for delete to authenticated using ((select hub.es_usuario()))', t);
    else
      execute format('create policy borrar on hub.%I for delete to authenticated using ((select hub.es_admin()))', t);
    end if;
    perform hub.auditar(t);
  end loop;
end $$;
grant usage on sequence hub.pedidos_compra_numero_seq to authenticated, service_role;

insert into hub.config (clave, valor, descripcion) values
  ('mrp_cobertura_dias', '30'::jsonb, 'MRP: para cuántos días de consumo se pide (además del plazo del proveedor)')
on conflict (clave) do nothing;

-- ── MRP ──────────────────────────────────────────────────────────────────
-- Una fila por material (el del catálogo, o el nombre si el producto del
-- inventario no está enlazado): stock en todas las ubicaciones, mínimo,
-- consumo de 90 días (salidas), lo pedido y aún no recibido, proveedor
-- preferido y plazo, días de cobertura y cuánto pedir.
create or replace function hub.mrp()
returns table (clave text, catalogo_id uuid, nombre text, categoria text, stock numeric, minimo numeric,
               consumo_90 numeric, consumo_dia numeric, cobertura_dias numeric, en_camino numeric,
               proveedor_id uuid, proveedor text, plazo_dias integer, precio_compra numeric,
               sugerido numeric, urgente boolean, ubicaciones jsonb)
language sql stable security definer set search_path = hub as $fn$
  with yo as (select coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario() as ve),
  cfg as (select coalesce((select (valor #>> '{}')::integer from hub.config where clave = 'mrp_cobertura_dias'), 30) as cobertura),
  prod as (
    select coalesce(fi.catalogo_id::text, 'n:' || lower(trim(fi.nombre))) as clave, fi.*
      from hub.furgoneta_inventario fi, yo where yo.ve
  ),
  agr as (
    select p.clave, max(p.catalogo_id::text)::uuid as catalogo_id,
           coalesce(max(c.nombre), max(p.nombre)) as nombre, coalesce(max(c.categoria), max(p.categoria)) as categoria,
           sum(coalesce(p.cantidad, 0)) as stock, sum(coalesce(p.stock_minimo, 0)) as minimo,
           jsonb_agg(jsonb_build_object('ubicacion', f.nombre, 'cantidad', p.cantidad, 'minimo', p.stock_minimo) order by f.nombre) as ubicaciones,
           array_agg(p.id) as ids
      from prod p left join hub.catalogo c on c.id = p.catalogo_id left join hub.furgonetas f on f.id = p.furgoneta_id
     group by p.clave
  ),
  cons as (
    select a.clave, coalesce(sum(m.cantidad) filter (where m.tipo = 'salida' and m.created_at > now() - interval '90 days'), 0) as c90
      from agr a left join hub.furgoneta_movimientos m on m.producto_id = any (a.ids)
     group by a.clave
  ),
  camino as (
    select l.catalogo_id, sum(greatest(l.cantidad - l.cantidad_recibida, 0)) as pendiente
      from hub.pedido_compra_lineas l join hub.pedidos_compra pc on pc.id = l.pedido_compra_id
     where pc.estado in ('Borrador', 'Enviado', 'Confirmado') and l.catalogo_id is not null
     group by l.catalogo_id
  ),
  prov as (
    select distinct on (mp.catalogo_id) mp.catalogo_id, mp.proveedor_id, pr.nombre, coalesce(mp.plazo_dias, pr.plazo_dias) as plazo, mp.precio_compra
      from hub.material_proveedor mp join hub.proveedores pr on pr.id = mp.proveedor_id and pr.activo
     order by mp.catalogo_id, mp.preferido desc, mp.precio_compra nulls last
  )
  select a.clave, a.catalogo_id, a.nombre, a.categoria, a.stock, a.minimo, cs.c90,
         round(cs.c90 / 90.0, 3),
         case when cs.c90 > 0 then round(a.stock / (cs.c90 / 90.0), 1) end,
         coalesce(ca.pendiente, 0), pv.proveedor_id, pv.nombre, pv.plazo, pv.precio_compra,
         greatest(ceil(cs.c90 / 90.0 * (coalesce(pv.plazo, 3) + (select cobertura from cfg)) + a.minimo - a.stock - coalesce(ca.pendiente, 0)), 0),
         (a.stock + coalesce(ca.pendiente, 0) < a.minimo)
           or (cs.c90 > 0 and (a.stock + coalesce(ca.pendiente, 0)) / (cs.c90 / 90.0) < coalesce(pv.plazo, 3)),
         a.ubicaciones
    from agr a join cons cs on cs.clave = a.clave
    left join camino ca on ca.catalogo_id = a.catalogo_id
    left join prov pv on pv.catalogo_id = a.catalogo_id
$fn$;
revoke execute on function hub.mrp() from public, anon;
grant execute on function hub.mrp() to authenticated, service_role;

-- ── Avisos: un gancho por fase ───────────────────────────────────────────
-- hub.avisos_extra() junta los de cada fase; cada fase redefine SOLO el suyo.
create or replace function hub.avisos_portal(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language sql stable security definer set search_path = hub as $fn$
  select 'aceptado:' || a.id, 'presupuesto_aceptado_portal', 'mal',
         'Presupuesto aceptado en el portal: ' || coalesce(p.numero_presupuesto, p.titulo, 's/n'),
         coalesce(c.nombre, '') || ' · lo aceptó ' || a.nombre || ' · pásalo a aceptado en la app',
         p.total, '#/portal', a.created_at, p.tecnico_id, false
    from hub.portal_aceptaciones a
    left join hub.presupuestos p on p.id = a.presupuesto_id
    left join hub.clientes c on c.id = p.cliente_id
   where a.revisada_at is null
$fn$;

create or replace function hub.avisos_comandas(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language sql stable security definer set search_path = hub as $fn$
  select 'comanda:' || t.id, 'comanda_parada', case when t.fecha_limite < (now() at time zone 'Atlantic/Canary')::date then 'mal' else 'aviso' end,
         'Comanda ' || case when t.fecha_limite < (now() at time zone 'Atlantic/Canary')::date then 'vencida' else 'prioritaria sin empezar' end || ': ' || left(t.texto, 80),
         coalesce(u.nombre, 'sin repartir') || ' · desde ' || to_char(t.created_at at time zone 'Atlantic/Canary', 'DD/MM HH24:MI'),
         null::numeric, '#/comandas', t.created_at, u.nombre, false
    from hub.comanda_tareas t left join hub.usuarios u on u.id = t.persona_id
   where t.estado <> 'hecha'
     and ((t.prioridad and t.estado = 'pendiente' and t.created_at < now() - interval '4 hours')
          or t.fecha_limite < (now() at time zone 'Atlantic/Canary')::date)
$fn$;

create or replace function hub.avisos_almacen(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language sql stable security definer set search_path = hub as $fn$
  -- Material que hay que pedir ya (bajo mínimo o sin cobertura para el plazo).
  select 'comprar:' || m.clave, 'hay_que_comprar', case when m.stock <= 0 then 'mal' else 'aviso' end,
         'Hay que pedir: ' || m.nombre,
         'quedan ' || m.stock || coalesce(' (mínimo ' || m.minimo || ')', '') || coalesce(' · pedir ' || nullif(m.sugerido, 0) || coalesce(' a ' || m.proveedor, ''), ''),
         null::numeric, '#/almacen/compras', null::timestamptz, null::text, false
    from hub.mrp() m where m.urgente
  union all
  select 'pedido_tarde:' || pc.id, 'pedido_retrasado', 'aviso',
         'Pedido de compra retrasado: PC-' || pc.numero || coalesce(' · ' || pr.nombre, ''),
         'se esperaba el ' || to_char(pc.esperado_para, 'DD/MM'), pc.total, '#/almacen/pedidos/' || pc.numero, pc.esperado_para::timestamptz, null::text, false
    from hub.pedidos_compra pc left join hub.proveedores pr on pr.id = pc.proveedor_id
   where pc.estado in ('Enviado', 'Confirmado') and pc.esperado_para < (now() at time zone 'Atlantic/Canary')::date
  union all
  select 'pedido_entrada:' || pc.id, 'pedido_sin_entrada', 'aviso',
         'Recibido sin dar entrada en el inventario: PC-' || pc.numero,
         coalesce(pr.nombre, '') || ' · da la entrada en el Inventario de la app y márcalo', pc.total, '#/almacen/pedidos/' || pc.numero, pc.recibido_at, null::text, false
    from hub.pedidos_compra pc left join hub.proveedores pr on pr.id = pc.proveedor_id
   where pc.estado = 'Recibido' and pc.entrada_app_at is null
  union all
  select 'envio:' || e.id, 'envio_atascado', 'aviso',
         'Envío sin entregar: ' || e.agencia || coalesce(' ' || e.seguimiento, ''),
         coalesce(e.destinatario, '') || ' · salió el ' || to_char(e.enviado_at at time zone 'Atlantic/Canary', 'DD/MM'),
         null::numeric, '#/almacen/envios', e.enviado_at, null::text, false
    from hub.envios e where e.estado in ('enviado', 'en_transito') and e.enviado_at < now() - interval '5 days'
  union all
  select 'envio_inc:' || e.id, 'envio_incidencia', 'mal',
         'Incidencia en un envío: ' || e.agencia || coalesce(' ' || e.seguimiento, ''), coalesce(e.destinatario, ''),
         null::numeric, '#/almacen/envios', e.updated_at, null::text, false
    from hub.envios e where e.estado = 'incidencia'
$fn$;

-- Ganchos de las fases que vienen (se redefinen allí).
create or replace function hub.avisos_personas(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language sql stable security definer set search_path = hub as $fn$ select null::text, null::text, null::text, null::text, null::text, null::numeric, null::text, null::timestamptz, null::text, null::boolean where false $fn$;
create or replace function hub.avisos_facturacion(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language sql stable security definer set search_path = hub as $fn$ select null::text, null::text, null::text, null::text, null::text, null::numeric, null::text, null::timestamptz, null::text, null::boolean where false $fn$;

create or replace function hub.avisos_extra(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language plpgsql stable security definer set search_path = hub as $fn$
begin
  if not (coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario()) then return; end if;
  return query select * from hub.avisos_portal(p_para, p_admin);
  return query select * from hub.avisos_comandas(p_para, p_admin);
  return query select * from hub.avisos_almacen(p_para, p_admin);
  return query select * from hub.avisos_personas(p_para, p_admin);
  -- Lo de dinero, solo admins.
  if p_admin then return query select * from hub.avisos_facturacion(p_para, p_admin); end if;
end
$fn$;
do $$
declare f text;
begin
  foreach f in array array['avisos_portal', 'avisos_comandas', 'avisos_almacen', 'avisos_personas', 'avisos_facturacion'] loop
    execute format('revoke execute on function hub.%I(uuid, boolean) from public, anon, authenticated', f);
    execute format('grant execute on function hub.%I(uuid, boolean) to service_role', f);
  end loop;
end $$;
