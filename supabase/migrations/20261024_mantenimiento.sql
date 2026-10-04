-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 4, tanda 1 — Mantenimiento sin dinero (PREPARADO).
--
-- Área nueva `mantenimiento` (dueño `app` hasta el corte), con los espejos de
-- la app (mismas columnas):
--   · planes_mantenimiento: el catálogo de planes (precio NETO €/mes,
--     frecuencia, revisiones, descuentos, tarifas de visita, características,
--     servicios del contrato, horario de soporte…). Solo un admin lo cambia.
--   · mant_seguimiento: el kanban comercial de mantenimientos.
--   · checklist_plantillas (solo admin) y mantenimientos_programados (el alta
--     «legado» que aún lee la app).
--   · checklist_respuestas va con `trabajos` (se rellena en la ficha del trabajo).
-- La ficha de mantenimiento de cada sede son columnas de `locales` (área
-- `clientes`): certificado digital, copia de seguridad, control horario de sus
-- empleados y el código de verificación para WhatsApp.
-- Los disparadores de la app (código de verificación al crear la sede;
-- caducidad del certificado subida desde el software) se portan, pero solo
-- actúan con el área `clientes` del hub: mientras manda la app, el valor llega
-- por el sync.
-- `festivos` NO se copia: el hub ya tiene los suyos (20261010_desk.sql).
-- ════════════════════════════════════════════════════════════════════════

insert into hub.areas (area, dueno, tablas, notas)
values ('mantenimiento', 'app', '{planes_mantenimiento,mant_seguimiento,checklist_plantillas,mantenimientos_programados}', 'Paridad bloque 4')
on conflict (area) do nothing;

create table if not exists hub.planes_mantenimiento (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  nombre                    text not null,
  orden                     int not null default 0,
  precio_mensual            numeric,
  frecuencia_pago           text default 'Mensual',
  revisiones_anuales        int not null default 0,
  descuento_mano_obra       int not null default 0,
  descuento_material        int not null default 0,
  coste_presencial_estandar numeric,
  coste_presencial_urgente  numeric,
  color                     text default '#2563eb',
  resumen                   text,
  caracteristicas           jsonb not null default '[]'::jsonb,
  activo                    boolean not null default true,
  notas                     text,
  contrato_servicios        jsonb not null default '{}'::jsonb,
  contrato_plantilla        text,
  stripe_product_id         text,
  stripe_precios            jsonb not null default '{}'::jsonb,
  zoho_item_id              text,
  horario_soporte           jsonb
);

create table if not exists hub.mant_seguimiento (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid,
  local_id           uuid,
  contacto_id        uuid,
  estado             text not null default 'por_contactar',
  tipo_respuesta     text,
  notas              text,
  recordatorio_fecha date,
  dias_recordatorio  int not null default 30,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists hub.checklist_plantillas (
  id         uuid primary key default gen_random_uuid(),
  plan       text,
  nombre     text not null,
  items      jsonb not null default '[]'::jsonb,
  activa     boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists hub.checklist_respuestas (
  id               uuid primary key default gen_random_uuid(),
  trabajo_id       uuid,
  plantilla_id     uuid,
  plantilla_nombre text,
  respuestas       jsonb not null default '{}'::jsonb,
  completado       boolean not null default false,
  tecnico_id       uuid,
  created_at       timestamptz default now()
);

create table if not exists hub.mantenimientos_programados (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  cliente_id      uuid,
  local_id        uuid,
  plan            text,
  proxima_fecha   date,
  ultimo_generado date,
  activo          boolean default true,
  contacto_id     uuid
);

-- La ficha de mantenimiento de la sede (20261001_ficha_mantenimiento.sql de la app).
alter table hub.locales
  add column if not exists cert_caducidad          date,
  add column if not exists backup_tipo             text,
  add column if not exists backup_destino          text,
  add column if not exists backup_comprobado       date,
  add column if not exists control_horario         boolean,
  add column if not exists control_horario_sistema text,
  add column if not exists control_horario_nuestro boolean not null default false,
  add column if not exists codigo_verificacion     text;

-- RLS: leer, cualquiera del hub; escribir, con el área del hub (y en el
-- catálogo y las plantillas de checklist, solo un admin, como la app).
do $$
declare t text; v_admin boolean;
begin
  foreach t in array array['planes_mantenimiento', 'mant_seguimiento', 'checklist_plantillas', 'checklist_respuestas', 'mantenimientos_programados'] loop
    v_admin := t in ('planes_mantenimiento', 'checklist_plantillas');
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('alter table hub.%I enable row level security', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    execute format('drop policy if exists escribir on hub.%I', t);
    execute format('create policy escribir on hub.%I for all to authenticated
      using ((select hub.%s()) and hub.tabla_es_del_hub(%L))
      with check ((select hub.%s()) and hub.tabla_es_del_hub(%L))', t, case when v_admin then 'es_admin' else 'es_usuario' end, t,
      case when v_admin then 'es_admin' else 'es_usuario' end, t);
    perform hub.auditar(t);
  end loop;
end $$;
drop policy if exists borrar_solo_admin on hub.mantenimientos_programados;
create policy borrar_solo_admin on hub.mantenimientos_programados as restrictive for delete to authenticated using ((select hub.es_admin()));

update hub.areas set tablas = array_append(tablas, 'checklist_respuestas')
 where area = 'trabajos' and not ('checklist_respuestas' = any (tablas));

-- updated_at al día (como los touch de la app).
create or replace function hub.tocar_updated_at()
returns trigger language plpgsql as $fn$ begin new.updated_at := now(); return new; end $fn$;
drop trigger if exists tocar on hub.planes_mantenimiento;
create trigger tocar before update on hub.planes_mantenimiento for each row execute function hub.tocar_updated_at();
drop trigger if exists tocar on hub.mant_seguimiento;
create trigger tocar before update on hub.mant_seguimiento for each row execute function hub.tocar_updated_at();

-- Código de verificación de 6 cifras al dar de alta una sede en el hub.
create or replace function hub.locales_codigo_verificacion()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if hub.tabla_es_del_hub('locales') and (new.codigo_verificacion is null or new.codigo_verificacion !~ '^\d{6}$') then
    new.codigo_verificacion := lpad((floor(random() * 1000000))::int::text, 6, '0');
  end if;
  return new;
end
$fn$;
drop trigger if exists codigo_verificacion on hub.locales;
create trigger codigo_verificacion before insert on hub.locales for each row execute function hub.locales_codigo_verificacion();

-- La caducidad del certificado apuntada en el software sube a la sede (si es posterior).
create or replace function hub.local_software_cert_a_local()
returns trigger language plpgsql security definer set search_path = hub as $fn$
begin
  if hub.tabla_es_del_hub('locales') and new.local_id is not null and new.fecha_caducidad_certificado is not null then
    update hub.locales set cert_caducidad = new.fecha_caducidad_certificado
     where id = new.local_id and (cert_caducidad is null or cert_caducidad < new.fecha_caducidad_certificado);
  end if;
  return new;
end
$fn$;
drop trigger if exists cert_a_local on hub.local_software;
create trigger cert_a_local after insert or update of fecha_caducidad_certificado on hub.local_software
  for each row execute function hub.local_software_cert_a_local();
