-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 4, tanda 2: contratos de mantenimiento con firma.
-- Espejo de `contratos` de la app (mismas columnas; en su audit_log), en el
-- área `mantenimiento`: mientras mande la app, aquí se ven; al cortar, se
-- generan, se firman (página pública contrato.html + función firma-contrato)
-- y se renuevan aquí.
--   · La fecha de inicio la pone la base al firmar (Atlantic/Canary), como el
--     disparador de la app: de ella sale la renovación, que NO se guarda.
--   · Borrar, solo un admin (como la app). La firma pública no pasa por la
--     RLS: la hace la función con la service key y el token del enlace.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.contratos (
  id                         uuid primary key default gen_random_uuid(),
  created_at                 timestamptz not null default now(),
  token                      text not null unique,
  plan_nombre                text not null,
  cliente_id                 uuid,
  local_id                   uuid,
  contacto_id                uuid,
  cliente_nombre             text,
  cliente_nif                text,
  direccion                  text,
  municipio                  text,
  precio_mensual             numeric,
  cuerpo_html                text not null,
  estado                     text not null default 'pendiente',
  firmante_nombre            text,
  firma_img                  text,
  firmante_ip                text,
  firmante_user_agent        text,
  firmado_at                 timestamptz,
  created_by                 uuid,
  notas                      text,
  frecuencia_pago            text,
  stripe_customer_id         text,
  stripe_checkout_session_id text,
  mandato_estado             text not null default 'pendiente',
  mandato_at                 timestamptz,
  servicios                  jsonb,
  tarifa_estandar            numeric,
  tarifa_urgente             numeric,
  fecha_inicio               date,
  vigencia_meses             int not null default 12,
  renovacion_automatica      boolean not null default true,
  renovacion_avisada_at      timestamptz
);
create index if not exists contratos_estado on hub.contratos (estado);
create index if not exists contratos_cliente on hub.contratos (cliente_id);
create index if not exists contratos_local on hub.contratos (local_id);
create index if not exists contratos_creado on hub.contratos (created_at desc);

update hub.areas set tablas = array_append(tablas, 'contratos')
 where area = 'mantenimiento' and not ('contratos' = any (tablas));

grant select, insert, update, delete on hub.contratos to authenticated;
grant all on hub.contratos to service_role;
alter table hub.contratos enable row level security;
drop policy if exists leer on hub.contratos;
create policy leer on hub.contratos for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.contratos;
create policy escribir on hub.contratos for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('contratos'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('contratos'));
drop policy if exists borrar_solo_admin on hub.contratos;
create policy borrar_solo_admin on hub.contratos as restrictive for delete to authenticated using ((select hub.es_admin()));
select hub.auditar('contratos');

-- contratos_set_fecha_inicio de la app (20260917_contrato_renovacion.sql).
create or replace function hub.contratos_fecha_inicio()
returns trigger language plpgsql as $fn$
begin
  if new.estado = 'firmado' and new.fecha_inicio is null then
    new.fecha_inicio := (coalesce(new.firmado_at, now()) at time zone 'Atlantic/Canary')::date;
  end if;
  return new;
end
$fn$;
drop trigger if exists fecha_inicio on hub.contratos;
create trigger fecha_inicio before insert or update on hub.contratos for each row execute function hub.contratos_fecha_inicio();
