-- ════════════════════════════════════════════════════════════════════════
-- Paridad · bloque 1, tanda 5 — Tablero de notas y chat por ficha.
--
-- 1. Tablero (PREPARADO): el espejo de `tablero_notas` (área `conocimiento`,
--    dueño `app`, desde la fase 5). Notas sueltas del equipo: las ve todo el
--    mundo y cada cual edita y borra SOLO las suyas (`user_id` = id de la
--    persona en usuarios, como la RLS «notas propias» de la app). La app no
--    la apunta en su audit_log: el sync la trae en la pasada nocturna.
--
-- 2. Chat por ficha (HECHO, el chat es del hub): initGroupChatForOperation de
--    la app abre una sala por trabajo/ticket/tarea/presupuesto/oportunidad y
--    mete en ella a quien la abre. Aquí es un canal `tipo = 'ficha'` ligado a
--    la ficha (`ficha_tipo`, `ficha_id`, y `ficha_ruta` para volver a ella);
--    hub.chat_ficha lo crea la primera vez y apunta como miembro a quien entra.
--    Lo leen sus miembros (la regla de los directos: hub.chat_puede y
--    chat_resumen ya miran `miembros`). chat_resumen NO cambia de forma (la
--    20261016 la redefine al reaplicarse): la ruta se lee del canal abierto.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Tablero ──────────────────────────────────────────────────────────
-- La tabla ya existe (20261009_wiki.sql: espejo en el área `conocimiento`,
-- que el buscador indexa). Aquí se le ponen los valores por defecto para dar
-- altas tras el corte y la regla de la app: escribir, solo lo propio.
alter table hub.tablero_notas alter column id set default gen_random_uuid();
alter table hub.tablero_notas alter column created_at set default now();
alter table hub.tablero_notas alter column updated_at set default now();
create index if not exists tablero_notas_creado_idx on hub.tablero_notas (created_at desc);
drop policy if exists escribir on hub.tablero_notas;
drop policy if exists propias on hub.tablero_notas;
create policy propias on hub.tablero_notas for all to authenticated
  using ((select hub.es_usuario()) and hub.tabla_es_del_hub('tablero_notas') and user_id = (select (hub.usuario_actual()).id))
  with check ((select hub.es_usuario()) and hub.tabla_es_del_hub('tablero_notas') and user_id = (select (hub.usuario_actual()).id));

-- ── 2. Chat por ficha ───────────────────────────────────────────────────
alter table hub.chat_canales drop constraint if exists chat_canales_tipo_check;
alter table hub.chat_canales add constraint chat_canales_tipo_check check (tipo in ('grupo', 'directo', 'ficha'));
alter table hub.chat_canales add column if not exists ficha_tipo text;
alter table hub.chat_canales add column if not exists ficha_id uuid;
alter table hub.chat_canales add column if not exists ficha_ruta text;
create unique index if not exists chat_ficha_idx on hub.chat_canales (ficha_tipo, ficha_id) where tipo = 'ficha';

create or replace function hub.chat_ficha(p_tipo text, p_id uuid, p_nombre text, p_ruta text)
returns uuid language plpgsql security definer set search_path = hub as $fn$
declare yo uuid := (hub.usuario_actual()).id; v uuid;
begin
  if yo is null then raise exception 'No estás dado de alta en el hub'; end if;
  if p_tipo not in ('trabajo', 'ticket', 'tarea', 'presupuesto', 'oportunidad') or p_id is null then raise exception 'Ficha no válida'; end if;
  if p_ruta is null or p_ruta !~ '^#/[a-z-]+/[A-Za-z0-9-]+$' then raise exception 'Ruta de la ficha no válida'; end if;
  insert into hub.chat_canales (nombre, tipo, miembros, creado_por, ficha_tipo, ficha_id, ficha_ruta)
  values (left(coalesce(nullif(trim(p_nombre), ''), p_tipo), 120), 'ficha', array[yo], yo, p_tipo, p_id, p_ruta)
  on conflict (ficha_tipo, ficha_id) where tipo = 'ficha' do nothing
  returning id into v;
  if v is null then
    select id into v from hub.chat_canales where tipo = 'ficha' and ficha_tipo = p_tipo and ficha_id = p_id;
    update hub.chat_canales set miembros = array_append(miembros, yo) where id = v and not (yo = any (miembros));
  end if;
  return v;
end
$fn$;
revoke execute on function hub.chat_ficha(text, uuid, text, text) from public, anon;
grant execute on function hub.chat_ficha(text, uuid, text, text) to authenticated, service_role;
