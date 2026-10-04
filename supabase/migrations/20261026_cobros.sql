-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 4, tanda 3: el motor de cobro del mantenimiento (Stripe +
-- factura en Zoho Books), PREPARADO Y SIN CONECTAR (decisión de Fran,
-- 2026-10-04): mientras el área `mantenimiento` sea de la app, el que cobra
-- y factura es la app (su webhook de Stripe); aquí se ve y nada más.
-- Espejos de la app (mismas columnas; ninguna está en su audit_log, llegan en
-- la pasada nocturna):
--   · mant_config     — la fila única de ajustes (serie, impuesto, cuenta…).
--   · mant_serie, mant_serie_abonos — los CONTADORES de las series MANT- y
--     ABONO-: con el corte, el hub sigue la numeración donde la dejó la app.
--   · mant_facturas   — el libro de cuotas cobradas (y su factura de Zoho).
--   · mant_abonos     — las facturas rectificativas.
-- Propia del hub: stripe_eventos (el candado de idempotencia del webhook;
-- fuera de hub.auditoria, que la duplicaría: ya es un registro).
-- Nadie del equipo escribe en el libro ni en los abonos: lo hacen las
-- funciones con la service key (stripe-webhook, stripe-suscripcion). Los
-- números de serie solo salen de hub.siguiente_numero_*(), que exige el área.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.mant_config (
  id                      boolean primary key default true check (id),
  updated_at              timestamptz not null default now(),
  serie_prefijo           text not null default 'MANT',
  serie_digitos           int not null default 4,
  precio_incluye_impuesto boolean not null default false,
  zoho_tax_id             text,
  zoho_tax_percent        numeric,
  zoho_cuenta_cobro_id    text,
  zoho_notas              text,
  facturar_automatico     boolean not null default true,
  moneda                  text not null default 'eur',
  enviar_factura_email    boolean not null default true,
  pago_metodos            text[] not null default '{card,sepa}',
  serie_prefijo_abono     text not null default 'ABONO'
);
insert into hub.mant_config (id) values (true) on conflict do nothing;

create table if not exists hub.mant_serie (anio int primary key, contador int not null default 0);
create table if not exists hub.mant_serie_abonos (anio int primary key, contador int not null default 0);

create table if not exists hub.mant_facturas (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  local_id                 uuid,
  cliente_id               uuid,
  plan                     text,
  stripe_invoice_id        text unique,
  stripe_subscription_id   text,
  stripe_customer_id       text,
  stripe_payment_intent_id text,
  stripe_hosted_url        text,
  stripe_pdf_url           text,
  periodo_inicio           date,
  periodo_fin              date,
  fecha_emision            date,
  importe                  numeric(10,2),
  base_imponible           numeric(10,2),
  impuesto                 numeric(10,2),
  moneda                   text default 'eur',
  estado                   text not null default 'pagada',
  intento                  int,
  error_pago               text,
  numero_serie             text unique,
  zoho_invoice_id          text,
  zoho_invoice_number      text,
  zoho_estado              text,
  zoho_error               text,
  zoho_at                  timestamptz,
  email_enviado_at         timestamptz,
  email_destinatarios      text[],
  tipo                     text not null default 'cuota',
  saldo_aplicado           numeric(12,2) not null default 0
);
create index if not exists mant_facturas_local on hub.mant_facturas (local_id);
create index if not exists mant_facturas_creada on hub.mant_facturas (created_at desc);

create table if not exists hub.mant_abonos (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  factura_id             uuid not null,
  local_id               uuid,
  cliente_id             uuid,
  numero_serie           text unique,
  motivo                 text not null,
  fecha_emision          date not null default (now() at time zone 'Atlantic/Canary')::date,
  importe                numeric(12,2) not null check (importe > 0),
  base_imponible         numeric(12,2),
  impuesto               numeric(12,2),
  moneda                 text not null default 'eur',
  zoho_creditnote_id     text,
  zoho_creditnote_number text,
  zoho_estado            text not null default 'pendiente',
  zoho_error             text,
  zoho_at                timestamptz,
  stripe_balance_txn_id  text,
  stripe_error           text,
  creado_por             text
);
create index if not exists mant_abonos_factura on hub.mant_abonos (factura_id);

create table if not exists hub.stripe_eventos (
  id           text primary key,
  tipo         text not null,
  recibido_at  timestamptz not null default now(),
  procesado_at timestamptz,
  ok           boolean,
  error        text,
  payload      jsonb
);

update hub.areas set tablas = tablas || array(select unnest(array['mant_config', 'mant_serie', 'mant_serie_abonos', 'mant_facturas', 'mant_abonos']) except select unnest(tablas))
 where area = 'mantenimiento';

-- RLS. Leer: el libro y los abonos, cualquiera del equipo (como la app); los
-- contadores y los eventos de Stripe, solo un admin. Escribir: solo los
-- ajustes, un admin con el área del hub. El resto, la service key.
do $$
declare t text;
begin
  foreach t in array array['mant_config', 'mant_serie', 'mant_serie_abonos', 'mant_facturas', 'mant_abonos', 'stripe_eventos'] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('revoke insert, update, delete on hub.%I from authenticated', t);
    execute format('grant select on hub.%I to authenticated', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.%s()))', t,
      case when t in ('mant_serie', 'mant_serie_abonos', 'stripe_eventos') then 'es_admin' else 'es_usuario' end);
    if t <> 'stripe_eventos' then perform hub.auditar(t); end if;
  end loop;
end $$;
grant update on hub.mant_config to authenticated;
drop policy if exists escribir on hub.mant_config;
create policy escribir on hub.mant_config for update to authenticated
  using ((select hub.es_admin()) and hub.tabla_es_del_hub('mant_config'))
  with check ((select hub.es_admin()) and hub.tabla_es_del_hub('mant_config'));

drop trigger if exists tocar on hub.mant_facturas;
create trigger tocar before update on hub.mant_facturas for each row execute function hub.tocar_updated_at();
drop trigger if exists tocar on hub.mant_abonos;
create trigger tocar before update on hub.mant_abonos for each row execute function hub.tocar_updated_at();

-- siguiente_numero_mant / _abono de la app: la serie propia sin huecos, por año.
-- Solo la service key (las funciones), y solo con el área del hub: mientras la
-- app numere, el hub no puede gastar un número de su serie.
create or replace function hub.siguiente_numero_mant(p_anio int default null)
returns text language plpgsql security definer set search_path = hub as $fn$
declare v_anio int := coalesce(p_anio, extract(year from now() at time zone 'Atlantic/Canary')::int);
        v_pref text; v_dig int; v_n int;
begin
  perform hub.exigir_area('mant_serie');
  select coalesce(serie_prefijo, 'MANT'), coalesce(serie_digitos, 4) into v_pref, v_dig from hub.mant_config where id;
  insert into hub.mant_serie (anio, contador) values (v_anio, 1)
    on conflict (anio) do update set contador = hub.mant_serie.contador + 1 returning contador into v_n;
  return coalesce(v_pref, 'MANT') || '-' || v_anio || '-' || lpad(v_n::text, coalesce(v_dig, 4), '0');
end
$fn$;

create or replace function hub.siguiente_numero_abono(p_anio int default null)
returns text language plpgsql security definer set search_path = hub as $fn$
declare v_anio int := coalesce(p_anio, extract(year from now() at time zone 'Atlantic/Canary')::int);
        v_pref text; v_dig int; v_n int;
begin
  perform hub.exigir_area('mant_serie_abonos');
  select coalesce(serie_prefijo_abono, 'ABONO'), coalesce(serie_digitos, 4) into v_pref, v_dig from hub.mant_config where id;
  insert into hub.mant_serie_abonos (anio, contador) values (v_anio, 1)
    on conflict (anio) do update set contador = hub.mant_serie_abonos.contador + 1 returning contador into v_n;
  return coalesce(v_pref, 'ABONO') || '-' || v_anio || '-' || lpad(v_n::text, coalesce(v_dig, 4), '0');
end
$fn$;
revoke all on function hub.siguiente_numero_mant(int) from public, anon, authenticated;
revoke all on function hub.siguiente_numero_abono(int) from public, anon, authenticated;
grant execute on function hub.siguiente_numero_mant(int) to service_role;
grant execute on function hub.siguiente_numero_abono(int) to service_role;

-- Cuánto queda por abonar de cada cuota (mant_facturas_abonadas de la app).
create or replace view hub.mant_facturas_abonadas with (security_invoker = true) as
select f.id as factura_id, f.importe as importe_factura,
       coalesce(sum(a.importe), 0)::numeric(12,2) as abonado,
       (f.importe - coalesce(sum(a.importe), 0))::numeric(12,2) as abonable,
       count(a.id) as abonos
  from hub.mant_facturas f left join hub.mant_abonos a on a.factura_id = f.id
 group by f.id, f.importe;
grant select on hub.mant_facturas_abonadas to authenticated, service_role;

-- El cuadro de cobros por sede (mant_cobros_estado de la app): la sede, su
-- cliente y su última cuota. Columnas nombradas (nunca mf.*).
create or replace view hub.mant_cobros_estado with (security_invoker = true) as
select l.id as local_id, l.nombre as local_nombre, l.cliente_id, c.nombre as cliente_nombre, c.email as cliente_email, c.telefono as cliente_telefono,
       l.plan, l.importe_mantenimiento, l.importe_incluye_impuesto, l.frecuencia_pago, l.estado_pago, l.forma_pago, l.proxima_cuota,
       l.stripe_subscription_id, coalesce(l.stripe_customer_id, c.stripe_customer_id) as stripe_customer_id, l.stripe_estado,
       l.stripe_mandato_estado, l.stripe_ultimo_error, l.stripe_cobro_en_curso_at, l.stripe_sync_at,
       l.zoho_subscription_id, l.zoho_estado, l.zoho_deuda, l.zoho_facturas_impagadas, l.zoho_sync_at, l.zoho_sync_error, l.zoho_deuda_error,
       f.id as ultima_factura_id, f.numero_serie as ultima_factura_numero, f.created_at as ultima_factura_at,
       f.estado as ultima_factura_estado, f.zoho_invoice_number as ultima_factura_zoho, f.zoho_estado as ultima_factura_zoho_estado
  from hub.locales l
  left join hub.clientes c on c.id = l.cliente_id
  left join lateral (select mf.id, mf.numero_serie, mf.created_at, mf.estado, mf.zoho_invoice_number, mf.zoho_estado
                       from hub.mant_facturas mf where mf.local_id = l.id order by mf.created_at desc limit 1) f on true
 where l.activo is not false;
grant select on hub.mant_cobros_estado to authenticated, service_role;
