-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 7 · tanda 3: el tablero VeriFactu (RD 1007/2023) de la app
-- (verifactu.js, 20260929_verifactu_sedes.sql), en ESPEJO.
--
-- Una fila = una SEDE en el proceso de adaptación de su TPV (local_id único):
-- seis fases (censo → auditoria → taller → despliegue → formacion → cierre) y
-- tres carriles (urgente = sociedades, 1/1/2027; estandar = autónomos,
-- 1/7/2027; compleja = TPV que no es Glop/BDP/Sysme/ETPOS). Las reglas
-- (carril por el NIF, criterio de salida que AVISA y no bloquea) viven en
-- src/modulos/verifactu/reglas.ts, copiadas de la app.
--
-- Decisión de Fran (2026-10-05): listo para el cambio. Área `verifactu` con
-- dueño `app`: el hub lo enseña y el sync lo copia (la app lo audita, así que
-- va por el incremental); se edita en la app hasta su OK. Mismas columnas que
-- la app, sin claves foráneas (espejo).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.verifactu_sedes (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null unique,
  cliente_id uuid,
  fase text not null default 'censo',
  carril text not null default 'estandar',
  tipo_contribuyente text,
  camino text,
  software_origen text,
  software_destino text,
  fecha_objetivo date,
  tecnico text,
  hw_tipo_tpv text,
  hw_sistema text,
  hw_almacenamiento text,
  hw_ram text,
  hw_estado text,
  impresora_modelo text,
  impresora_interfaz text,
  impresora_qr_ok boolean,
  checklist jsonb not null default '{}'::jsonb,
  presupuesto_aceptado boolean not null default false,
  fecha_go_live date,
  trabajo_id uuid,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verifactu_sedes_fase_idx on hub.verifactu_sedes (fase);

drop trigger if exists tocar_updated_at on hub.verifactu_sedes;
create trigger tocar_updated_at before update on hub.verifactu_sedes for each row execute function hub.tocar_updated_at();

alter table hub.verifactu_sedes enable row level security;
grant select, insert, update, delete on hub.verifactu_sedes to authenticated;
grant all on hub.verifactu_sedes to service_role;
drop policy if exists leer on hub.verifactu_sedes;
create policy leer on hub.verifactu_sedes for select to authenticated using ((select hub.es_usuario()));
drop policy if exists escribir on hub.verifactu_sedes;
create policy escribir on hub.verifactu_sedes for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('verifactu_sedes'))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('verifactu_sedes'));
-- Quitar una sede del tablero: solo admin (como en la app).
drop policy if exists borrar_admin on hub.verifactu_sedes;
create policy borrar_admin on hub.verifactu_sedes as restrictive for delete to authenticated using ((select hub.es_admin()));
select hub.auditar('verifactu_sedes');

insert into hub.areas (area, dueno, tablas, notas)
values ('verifactu', 'app', '{verifactu_sedes}', 'Bloque 7 · tablero VeriFactu (listo para el cambio)')
on conflict (area) do nothing;
