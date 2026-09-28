-- ════════════════════════════════════════════════════════════════════════
-- Fase 11 · Facturación propia — PROGRAMADA Y SIN ACTIVAR.
--
-- Zoho Books sigue emitiendo las facturas hasta que la gestoría valide esto y
-- Fran dé el OK (DECISIONES_FASES.md). Mientras `hub.config.facturacion_activa`
-- no sea true, SOLO se puede emitir en la serie de PRUEBA «P» (sin valor
-- fiscal), que sirve para que la gestoría lo revise.
--
--   · Numeración correlativa SIN HUECOS por serie y año (contador bloqueado
--     al emitir; el número solo existe al emitir: un borrador no gasta número).
--   · Lo emitido no se toca: se rectifica con otra factura (serie «R»).
--   · Registro encadenado: cada factura emitida guarda su huella sha256 y la
--     de la anterior del mismo emisor (el esquema del reglamento de sistemas
--     de facturación, RD 1007/2023, «Veri*factu»). El envío a la AEAT NO está:
--     se añade al activar.
--   · Datos del cliente CONGELADOS al emitir (si luego cambia la ficha, la
--     factura sigue diciendo lo que decía).
-- ════════════════════════════════════════════════════════════════════════

insert into hub.config (clave, valor, descripcion) values
  ('facturacion_activa', 'false'::jsonb, 'Facturación propia del hub: false = solo la serie de PRUEBA; la activa Fran cuando la gestoría la valide'),
  ('facturacion_emisor', '{"nombre":"Dalmon Sistemas S.L.","nombre_comercial":"Ok Computer Tenerife","nif":"","direccion":"","cp":"","municipio":"","provincia":"Santa Cruz de Tenerife","email":"info@okcomputertenerife.com","telefono":"","iban":""}'::jsonb,
   'Datos del emisor que salen en las facturas'),
  ('facturacion_vencimiento_dias', '30'::jsonb, 'Días hasta el vencimiento de una factura')
on conflict (clave) do nothing;

create table if not exists hub.series_factura (
  codigo      text primary key check (codigo ~ '^[A-Z]{1,3}$'),
  nombre      text not null,
  prueba      boolean not null default false,   -- sin valor fiscal
  rectificativa boolean not null default false,
  activa      boolean not null default true
);
insert into hub.series_factura (codigo, nombre, prueba, rectificativa) values
  ('F', 'Facturas', false, false), ('R', 'Rectificativas', false, true), ('P', 'PRUEBA (sin valor fiscal)', true, false)
on conflict (codigo) do nothing;

create table if not exists hub.series_contador (
  serie  text not null references hub.series_factura (codigo),
  anio   integer not null,
  ultimo integer not null default 0,
  primary key (serie, anio)
);

create table if not exists hub.facturas (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  creada_por          uuid,
  serie               text not null default 'P' references hub.series_factura (codigo),
  anio                integer,
  numero              integer,
  codigo              text unique,                 -- «F-2026-0001»: solo al emitir
  estado              text not null default 'borrador' check (estado in ('borrador', 'emitida', 'rectificada')),
  tipo                text not null default 'ordinaria' check (tipo in ('ordinaria', 'rectificativa')),
  rectifica_id        uuid references hub.facturas (id),
  motivo_rectificacion text,
  cliente_id          uuid,
  cliente_nombre      text, cliente_nif text, cliente_direccion text, cliente_email text,
  emisor              jsonb,                       -- congelado al emitir
  fecha_emision       date,
  fecha_operacion     date,
  vencimiento         date,
  forma_pago          text default 'Transferencia',
  notas               text,
  base_total          numeric(12,2) not null default 0,
  impuesto_total      numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,
  cobrado             numeric(12,2) not null default 0,
  huella              text,
  huella_anterior     text,
  emitida_at          timestamptz,
  emitida_por         uuid,
  trabajo_ids         uuid[] not null default '{}',
  presupuesto_id      uuid,
  unique (serie, anio, numero)
);
create index if not exists facturas_cliente_idx on hub.facturas (cliente_id);
create index if not exists facturas_estado_idx on hub.facturas (estado, fecha_emision desc);

create table if not exists hub.factura_lineas (
  id            uuid primary key default gen_random_uuid(),
  factura_id    uuid not null references hub.facturas (id) on delete cascade,
  orden         integer not null default 1,
  concepto      text not null check (length(trim(concepto)) > 0),
  detalle       text,
  cantidad      numeric(12,3) not null default 1,
  precio        numeric(12,4) not null default 0,
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  impuesto_pct  numeric(5,2) not null default 7 check (impuesto_pct in (0, 3, 5, 7, 9.5, 15, 20)),  -- IGIC
  base          numeric(12,2) generated always as (round(cantidad * precio * (1 - descuento_pct / 100), 2)) stored,
  catalogo_id   uuid
);
create index if not exists factura_lineas_factura_idx on hub.factura_lineas (factura_id, orden);

create table if not exists hub.factura_cobros (
  id          uuid primary key default gen_random_uuid(),
  factura_id  uuid not null references hub.facturas (id) on delete cascade,
  fecha       date not null default current_date,
  importe     numeric(12,2) not null check (importe <> 0),
  medio       text not null default 'Transferencia',
  nota        text,
  created_at  timestamptz not null default now(),
  creado_por  uuid
);

-- ── Totales (siempre los de las líneas) ──────────────────────────────────
create or replace function hub.factura_recalcular(p_id uuid)
returns void language sql security definer set search_path = hub as $fn$
  update hub.facturas f set
    base_total = coalesce(t.base, 0), impuesto_total = coalesce(t.cuota, 0), total = coalesce(t.base, 0) + coalesce(t.cuota, 0)
    from (select sum(base) as base, sum(round(base * impuesto_pct / 100, 2)) as cuota from hub.factura_lineas where factura_id = p_id) t
   where f.id = p_id and f.estado = 'borrador'
$fn$;

create or replace function hub.factura_linea_cambio()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare v_estado text;
begin
  select estado into v_estado from hub.facturas where id = coalesce(new.factura_id, old.factura_id);
  if v_estado is distinct from 'borrador' and current_setting('hub.emitiendo', true) is distinct from 'on' then
    raise exception 'Una factura emitida no se toca: haz una rectificativa';
  end if;
  if tg_op <> 'INSERT' and old.factura_id is distinct from coalesce(new.factura_id, old.factura_id) then raise exception 'No se mueve una línea de factura'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$fn$;
drop trigger if exists factura_linea_cambio on hub.factura_lineas;
create trigger factura_linea_cambio before insert or update or delete on hub.factura_lineas for each row execute function hub.factura_linea_cambio();

create or replace function hub.factura_linea_total()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  perform hub.factura_recalcular(coalesce(new.factura_id, old.factura_id));
  return null;
end
$fn$;
drop trigger if exists factura_linea_total on hub.factura_lineas;
create trigger factura_linea_total after insert or update or delete on hub.factura_lineas for each row execute function hub.factura_linea_total();

-- Lo emitido no se toca (salvo lo cobrado y pasar a «rectificada»).
create or replace function hub.factura_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'Una factura emitida no se borra: haz una rectificativa'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.creada_por := coalesce(new.creada_por, (hub.usuario_actual()).id);
    new.estado := 'borrador'; new.codigo := null; new.numero := null; new.huella := null; new.emitida_at := null;
    return new;
  end if;
  new.updated_at := now();
  if old.estado <> 'borrador' and current_setting('hub.emitiendo', true) is distinct from 'on' then
    if (to_jsonb(new) - array['cobrado', 'estado', 'updated_at']) is distinct from (to_jsonb(old) - array['cobrado', 'estado', 'updated_at'])
       or (new.estado <> old.estado and not (old.estado = 'emitida' and new.estado = 'rectificada')) then
      raise exception 'Una factura emitida no se toca: haz una rectificativa';
    end if;
  elsif old.estado = 'borrador' and new.estado <> 'borrador' and current_setting('hub.emitiendo', true) is distinct from 'on' then
    raise exception 'Una factura se emite con hub.emitir_factura()';
  end if;
  return new;
end
$fn$;
drop trigger if exists factura_antes on hub.facturas;
create trigger factura_antes before insert or update or delete on hub.facturas for each row execute function hub.factura_antes();

-- ── Emitir ───────────────────────────────────────────────────────────────
create or replace function hub.emitir_factura(p_id uuid)
returns hub.facturas language plpgsql security definer set search_path = hub as $fn$
declare
  f hub.facturas; s hub.series_factura; c record; v_anio integer; v_num integer; v_prev text; v_emisor jsonb; v_venc integer;
begin
  if not hub.es_admin() and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'Solo un administrador emite facturas'; end if;
  select * into f from hub.facturas where id = p_id for update;
  if not found then raise exception 'No existe esa factura'; end if;
  if f.estado <> 'borrador' then raise exception 'Ya está emitida'; end if;
  select * into s from hub.series_factura where codigo = f.serie;
  if not s.prueba and coalesce((select valor #>> '{}' from hub.config where clave = 'facturacion_activa'), 'false') <> 'true' then
    raise exception 'La facturación propia no está activada: Zoho sigue facturando. Usa la serie de PRUEBA.';
  end if;
  if not exists (select 1 from hub.factura_lineas where factura_id = p_id) then raise exception 'La factura no tiene líneas'; end if;
  if f.tipo = 'rectificativa' and (f.rectifica_id is null or coalesce(trim(f.motivo_rectificacion), '') = '') then
    raise exception 'Una rectificativa necesita la factura que rectifica y el motivo';
  end if;
  select nombre, nif, direccion, email into c from hub.clientes where id = f.cliente_id;
  if coalesce(f.cliente_nif, c.nif, '') = '' and f.total > 400 and not s.prueba then
    raise exception 'Para facturar más de 400 € hace falta el NIF del cliente (factura completa)';
  end if;
  v_emisor := (select valor from hub.config where clave = 'facturacion_emisor');
  if not s.prueba and coalesce(v_emisor->>'nif', '') = '' then raise exception 'Faltan los datos fiscales del emisor (Facturación → Ajustes)'; end if;
  v_anio := extract(year from coalesce(f.fecha_emision, (now() at time zone 'Atlantic/Canary')::date));
  insert into hub.series_contador (serie, anio, ultimo) values (f.serie, v_anio, 0) on conflict do nothing;
  update hub.series_contador set ultimo = ultimo + 1 where serie = f.serie and anio = v_anio returning ultimo into v_num;
  -- Encadenado: la huella de la última emitida del mismo tipo (reales con reales, prueba con prueba).
  select fa.huella into v_prev from hub.facturas fa join hub.series_factura sf on sf.codigo = fa.serie
   where fa.estado <> 'borrador' and sf.prueba = s.prueba order by fa.emitida_at desc, fa.id desc limit 1;
  v_venc := coalesce((select (valor #>> '{}')::integer from hub.config where clave = 'facturacion_vencimiento_dias'), 30);
  perform set_config('hub.emitiendo', 'on', true);
  update hub.facturas set
    estado = 'emitida', anio = v_anio, numero = v_num, codigo = f.serie || '-' || v_anio || '-' || lpad(v_num::text, 4, '0'),
    fecha_emision = coalesce(f.fecha_emision, (now() at time zone 'Atlantic/Canary')::date),
    fecha_operacion = coalesce(f.fecha_operacion, f.fecha_emision, (now() at time zone 'Atlantic/Canary')::date),
    vencimiento = coalesce(f.vencimiento, coalesce(f.fecha_emision, (now() at time zone 'Atlantic/Canary')::date) + v_venc),
    cliente_nombre = coalesce(nullif(f.cliente_nombre, ''), c.nombre), cliente_nif = coalesce(nullif(f.cliente_nif, ''), c.nif),
    cliente_direccion = coalesce(nullif(f.cliente_direccion, ''), c.direccion), cliente_email = coalesce(nullif(f.cliente_email, ''), c.email),
    emisor = v_emisor, huella_anterior = v_prev, emitida_at = now(), emitida_por = (hub.usuario_actual()).id
   where id = p_id;
  update hub.facturas set huella = encode(sha256(convert_to(concat_ws('|', emisor->>'nif', codigo, fecha_emision, total, coalesce(huella_anterior, '')), 'UTF8')), 'hex')
   where id = p_id;
  if f.tipo = 'rectificativa' then update hub.facturas set estado = 'rectificada' where id = f.rectifica_id and estado = 'emitida'; end if;
  perform set_config('hub.emitiendo', 'off', true);
  select * into f from hub.facturas where id = p_id;
  return f;
end
$fn$;

-- Rectificativa en borrador: copia las líneas en negativo (se pueden ajustar antes de emitir).
create or replace function hub.crear_rectificativa(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = hub as $fn$
declare f hub.facturas; v_id uuid; v_serie text;
begin
  if not hub.es_admin() then raise exception 'Solo un administrador'; end if;
  select * into f from hub.facturas where id = p_id;
  if not found or f.estado <> 'emitida' then raise exception 'Solo se rectifica una factura emitida (y no rectificada ya)'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribe el motivo de la rectificación'; end if;
  v_serie := case when (select prueba from hub.series_factura where codigo = f.serie) then 'P' else 'R' end;
  insert into hub.facturas (serie, tipo, rectifica_id, motivo_rectificacion, cliente_id, cliente_nombre, cliente_nif, cliente_direccion, cliente_email, forma_pago, notas)
  values (v_serie, 'rectificativa', f.id, trim(p_motivo), f.cliente_id, f.cliente_nombre, f.cliente_nif, f.cliente_direccion, f.cliente_email, f.forma_pago,
          'Rectifica la factura ' || f.codigo || ' del ' || to_char(f.fecha_emision, 'DD/MM/YYYY') || '. Motivo: ' || trim(p_motivo))
  returning id into v_id;
  insert into hub.factura_lineas (factura_id, orden, concepto, detalle, cantidad, precio, descuento_pct, impuesto_pct, catalogo_id)
  select v_id, orden, concepto, detalle, -cantidad, precio, descuento_pct, impuesto_pct, catalogo_id from hub.factura_lineas where factura_id = f.id;
  return v_id;
end
$fn$;

-- Lo cobrado, siempre la suma de los cobros.
create or replace function hub.factura_cobro_total()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare v uuid := coalesce(new.factura_id, old.factura_id);
begin
  update hub.facturas set cobrado = coalesce((select sum(importe) from hub.factura_cobros where factura_id = v), 0) where id = v;
  return null;
end
$fn$;
drop trigger if exists factura_cobro_total on hub.factura_cobros;
create trigger factura_cobro_total after insert or update or delete on hub.factura_cobros for each row execute function hub.factura_cobro_total();

create or replace function hub.factura_cobro_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if not exists (select 1 from hub.facturas where id = new.factura_id and estado <> 'borrador') then raise exception 'Se cobra una factura emitida'; end if;
  new.creado_por := coalesce(new.creado_por, (hub.usuario_actual()).id);
  return new;
end
$fn$;
drop trigger if exists factura_cobro_antes on hub.factura_cobros;
create trigger factura_cobro_antes before insert on hub.factura_cobros for each row execute function hub.factura_cobro_antes();

-- ── RLS: solo admins (es dinero) ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['series_factura', 'series_contador', 'facturas', 'factura_lineas', 'factura_cobros'] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('drop policy if exists admin on hub.%I', t);
    if t = 'series_contador' then
      execute format('create policy admin on hub.%I for select to authenticated using ((select hub.es_admin()))', t);
    else
      execute format('create policy admin on hub.%I for all to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()))', t);
    end if;
    perform hub.auditar(t);
  end loop;
end $$;
revoke execute on function hub.emitir_factura(uuid), hub.crear_rectificativa(uuid, text), hub.factura_recalcular(uuid) from public, anon;
grant execute on function hub.emitir_factura(uuid), hub.crear_rectificativa(uuid, text) to authenticated, service_role;

-- ── Avisos (solo admins: es dinero) ──────────────────────────────────────
create or replace function hub.avisos_facturacion(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language sql stable security definer set search_path = hub as $fn$
  select 'fhub:' || f.id, 'factura_propia_vencida', 'aviso', 'Factura vencida: ' || f.codigo || ' · ' || coalesce(f.cliente_nombre, ''),
         'venció el ' || to_char(f.vencimiento, 'DD/MM/YY') || ' · pendiente ' || (f.total - f.cobrado) || ' €', f.total - f.cobrado,
         '#/facturacion/' || f.id, f.vencimiento::timestamptz, null::text, true
    from hub.facturas f join hub.series_factura s on s.codigo = f.serie and not s.prueba
   where f.estado = 'emitida' and f.cobrado < f.total and f.vencimiento < (now() at time zone 'Atlantic/Canary')::date
  union all
  select 'fborrador:' || f.id, 'factura_borrador_vieja', 'info', 'Borrador de factura sin emitir: ' || coalesce(f.cliente_nombre, 'sin cliente'),
         'creado el ' || to_char(f.created_at at time zone 'Atlantic/Canary', 'DD/MM'), f.total, '#/facturacion/' || f.id, f.created_at, null::text, true
    from hub.facturas f join hub.series_factura s on s.codigo = f.serie and not s.prueba
   where f.estado = 'borrador' and f.created_at < now() - interval '7 days'
$fn$;
revoke execute on function hub.avisos_facturacion(uuid, boolean) from public, anon, authenticated;
grant execute on function hub.avisos_facturacion(uuid, boolean) to service_role;
