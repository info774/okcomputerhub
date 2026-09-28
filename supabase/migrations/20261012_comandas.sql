-- ════════════════════════════════════════════════════════════════════════
-- Fase 8 · Comandas: «audio del jefe → tareas para el equipo».
--
-- Una nota de voz (grabada en el hub o mandada al bot de Telegram) o un texto
-- se transcribe (Groq Whisper) y Claude la trocea en tareas repartidas por
-- persona. Son tareas DEL HUB (hub.comanda_tareas), con su tablero por
-- persona: las tareas y la lista del día de la app NO se cortan (las usa su
-- calendario) — decisión de Fran, DECISIONES_FASES.md.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists hub.comandas (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  creada_por    uuid,
  origen        text not null default 'app' check (origen in ('app', 'telegram', 'mcp')),
  transcripcion text not null,
  con_claude    boolean not null default false,  -- troceada por Claude (o a mano, por líneas)
  n_tareas      integer not null default 0
);
create index if not exists comandas_fecha_idx on hub.comandas (created_at desc);

create table if not exists hub.comanda_tareas (
  id           uuid primary key default gen_random_uuid(),
  comanda_id   uuid references hub.comandas (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  texto        text not null check (length(trim(texto)) > 0),
  persona_id   uuid,                            -- hub.usuarios (null = sin repartir)
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'en_curso', 'hecha')),
  prioridad    boolean not null default false,
  fecha_limite date,
  cliente_id   uuid,                            -- si la comanda habla de un cliente conocido
  origen       text not null default 'manual' check (origen in ('manual', 'voz', 'telegram', 'mcp')),
  creada_por   uuid,
  empezada_at  timestamptz,
  hecha_at     timestamptz
);
create index if not exists comanda_tareas_persona_idx on hub.comanda_tareas (persona_id, estado);
create index if not exists comanda_tareas_estado_idx on hub.comanda_tareas (estado, created_at desc);

create or replace function hub.comanda_tarea_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  if tg_op = 'INSERT' then
    new.creada_por := coalesce(new.creada_por, (hub.usuario_actual()).id);
  else
    new.updated_at := now();
  end if;
  if new.estado = 'en_curso' and (tg_op = 'INSERT' or old.estado <> 'en_curso') then new.empezada_at := coalesce(new.empezada_at, now()); end if;
  if new.estado = 'hecha' and (tg_op = 'INSERT' or old.estado <> 'hecha') then new.hecha_at := now(); end if;
  if new.estado <> 'hecha' then new.hecha_at := null; end if;
  if new.estado = 'pendiente' then new.empezada_at := null; end if;
  return new;
end
$fn$;
drop trigger if exists comanda_tarea_antes on hub.comanda_tareas;
create trigger comanda_tarea_antes before insert or update on hub.comanda_tareas
  for each row execute function hub.comanda_tarea_antes();

create or replace function hub.comanda_antes()
returns trigger language plpgsql set search_path = hub as $fn$
begin
  new.creada_por := coalesce(new.creada_por, (hub.usuario_actual()).id);
  return new;
end
$fn$;
drop trigger if exists comanda_antes on hub.comandas;
create trigger comanda_antes before insert on hub.comandas for each row execute function hub.comanda_antes();

alter table hub.comandas enable row level security;
alter table hub.comanda_tareas enable row level security;
grant select, insert, update, delete on hub.comandas, hub.comanda_tareas to authenticated;
grant all on hub.comandas, hub.comanda_tareas to service_role;
drop policy if exists leer on hub.comandas;
create policy leer on hub.comandas for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.comandas;
create policy crear on hub.comandas for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists borrar on hub.comandas;
create policy borrar on hub.comandas for delete to authenticated
  using ((select hub.es_admin()) or creada_por = (select (hub.usuario_actual()).id));
drop policy if exists leer on hub.comanda_tareas;
create policy leer on hub.comanda_tareas for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.comanda_tareas;
create policy crear on hub.comanda_tareas for insert to authenticated with check ((select hub.es_usuario()));
-- El tablero es del equipo: cualquiera mueve una tarjeta (empezar, hecha, pasarla a otro).
drop policy if exists cambiar on hub.comanda_tareas;
create policy cambiar on hub.comanda_tareas for update to authenticated
  using ((select hub.es_usuario())) with check ((select hub.es_usuario()));
drop policy if exists borrar on hub.comanda_tareas;
create policy borrar on hub.comanda_tareas for delete to authenticated
  using ((select hub.es_admin()) or creada_por = (select (hub.usuario_actual()).id));

select hub.auditar('comandas');
select hub.auditar('comanda_tareas');

-- ── Avisos: el gancho de la fase 7 + comandas prioritarias paradas ─────
create or replace function hub.avisos_extra(p_para uuid, p_admin boolean)
returns table (clave text, tipo text, gravedad text, titulo text, detalle text, importe numeric,
               enlace text, fecha timestamptz, persona text, dinero boolean)
language plpgsql stable security definer set search_path = hub as $fn$
begin
  if not (coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario()) then return; end if;
  -- Presupuesto aceptado por el cliente en el portal, sin pasar aún a la app.
  return query
  select 'aceptado:' || a.id, 'presupuesto_aceptado_portal', 'mal',
         'Presupuesto aceptado en el portal: ' || coalesce(p.numero_presupuesto, p.titulo, 's/n'),
         coalesce(c.nombre, '') || ' · lo aceptó ' || a.nombre || ' · pásalo a aceptado en la app',
         p.total, '#/portal', a.created_at, p.tecnico_id, false
    from hub.portal_aceptaciones a
    left join hub.presupuestos p on p.id = a.presupuesto_id
    left join hub.clientes c on c.id = p.cliente_id
   where a.revisada_at is null;

  -- Comanda con PRIORIDAD sin empezar después de 4 horas, o vencida.
  return query
  select 'comanda:' || t.id, 'comanda_parada', case when t.fecha_limite < (now() at time zone 'Atlantic/Canary')::date then 'mal' else 'aviso' end,
         'Comanda ' || case when t.fecha_limite < (now() at time zone 'Atlantic/Canary')::date then 'vencida' else 'prioritaria sin empezar' end || ': ' || left(t.texto, 80),
         coalesce(u.nombre, 'sin repartir') || ' · desde ' || to_char(t.created_at at time zone 'Atlantic/Canary', 'DD/MM HH24:MI'),
         null::numeric, '#/comandas', t.created_at, u.nombre, false
    from hub.comanda_tareas t left join hub.usuarios u on u.id = t.persona_id
   where t.estado <> 'hecha'
     and ((t.prioridad and t.estado = 'pendiente' and t.created_at < now() - interval '4 hours')
          or t.fecha_limite < (now() at time zone 'Atlantic/Canary')::date);
end
$fn$;
