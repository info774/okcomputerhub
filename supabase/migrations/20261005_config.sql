-- ════════════════════════════════════════════════════════════════════════
-- Ajustes del hub (clave → valor). El primero: `tarifa_hora`, una sola tarifa
-- por hora (€/h, sin impuestos) para pasar a euros las horas fichadas en el
-- Coste de un proyecto. La lee todo el equipo; la cambia un admin.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.config (
  clave       text primary key check (clave ~ '^[a-z_]+$'),
  valor       jsonb not null,
  descripcion text,
  updated_at  timestamptz not null default now()
);

drop trigger if exists tocar_updated_at on hub.config;
create trigger tocar_updated_at before update on hub.config
  for each row execute function hub.tocar_updated_at();

alter table hub.config enable row level security;
grant select, insert, update on hub.config to authenticated;
grant all on hub.config to service_role;
drop policy if exists leer on hub.config;
create policy leer on hub.config for select to authenticated using ((select hub.es_usuario()));
drop policy if exists admin_crea on hub.config;
create policy admin_crea on hub.config for insert to authenticated with check ((select hub.es_admin()));
drop policy if exists admin_cambia on hub.config;
create policy admin_cambia on hub.config for update to authenticated
  using ((select hub.es_admin())) with check ((select hub.es_admin()));

select hub.auditar('config');
