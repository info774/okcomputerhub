-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 7 · tanda 2: facturas de compra y gastos/cobros de la app.
--
-- 1. hub.facturas_compra — PROPIA del hub desde ya (no es espejo): en la app
--    la pantalla existe (facturas_compra.js) pero su migración
--    (20260824_ventas_compras.sql) nunca se aplicó en producción, así que allí
--    no hay ni una factura que copiar y no hay riesgo de llevarlas en dos
--    sitios. Va con los proveedores y los pedidos de compra de Almacén (que
--    ya son del hub). El adjunto (foto o PDF) se guarda en el almacén privado
--    «gastos» (carpeta compras/) por la función `gastos-ocr`, que además lo
--    puede leer con Claude para rellenar el formulario.
-- 2. hub.gastos (ESPEJO de la app, área `gastos`): sus gastos y cobros en
--    efectivo se ven y, tras el corte, se apuntan en Personas → Gastos, junto
--    a los tickets leídos por Claude (decisión de Fran: unificados). Como en
--    la app, borrar un movimiento es cosa de un admin.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.facturas_compra (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  proveedor_id      uuid references hub.proveedores (id),
  pedido_compra_id  uuid references hub.pedidos_compra (id) on delete set null,
  numero            text,
  fecha             date not null default current_date,
  vence             date,
  base              numeric,
  impuesto          numeric,
  importe           numeric not null default 0 check (importe >= 0),
  estado            text not null default 'Pendiente' check (estado in ('Pendiente', 'Pagada')),
  pagada_at         date,
  archivo_path      text,              -- en el almacén privado «gastos» (compras/…)
  archivo_tipo      text,
  notas             text,
  creado_por        uuid
);
create index if not exists facturas_compra_proveedor_idx on hub.facturas_compra (proveedor_id);
create index if not exists facturas_compra_estado_idx on hub.facturas_compra (estado, fecha);

create or replace function hub.factura_compra_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_op = 'INSERT' then new.creado_por := coalesce(new.creado_por, (hub.usuario_actual()).id); end if;
  if new.estado = 'Pagada' and (tg_op = 'INSERT' or old.estado <> 'Pagada') then new.pagada_at := coalesce(new.pagada_at, current_date); end if;
  if new.estado = 'Pendiente' then new.pagada_at := null; end if;
  return new;
end
$fn$;
drop trigger if exists factura_compra_antes on hub.facturas_compra;
create trigger factura_compra_antes before insert or update on hub.facturas_compra for each row execute function hub.factura_compra_antes();
drop trigger if exists tocar_updated_at on hub.facturas_compra;
create trigger tocar_updated_at before update on hub.facturas_compra for each row execute function hub.tocar_updated_at();

alter table hub.facturas_compra enable row level security;
grant select, insert, update, delete on hub.facturas_compra to authenticated;
grant all on hub.facturas_compra to service_role;
drop policy if exists leer on hub.facturas_compra;
create policy leer on hub.facturas_compra for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.facturas_compra;
create policy crear on hub.facturas_compra for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.facturas_compra;
create policy cambiar on hub.facturas_compra for update to authenticated using ((select hub.es_usuario())) with check ((select hub.es_usuario()));
-- Eliminar, como en la app: solo un admin.
drop policy if exists borrar on hub.facturas_compra;
create policy borrar on hub.facturas_compra for delete to authenticated using ((select hub.es_admin()));
select hub.auditar('facturas_compra');

-- Gastos (espejo): borrar, solo admin (la regla de la app). Restrictiva: se
-- suma a la de escribir del espejo (que ya exige el área del hub).
drop policy if exists borrar_admin on hub.gastos;
create policy borrar_admin on hub.gastos as restrictive for delete to authenticated using ((select hub.es_admin()));
