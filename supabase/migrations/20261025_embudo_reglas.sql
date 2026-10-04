-- ════════════════════════════════════════════════════════════════════════
-- Embudo de ventas a lo Bitrix24 (2026-10-04, decisión de Fran: embudo único).
--
--   · Próximo paso: `hub.oportunidades.siguiente_texto` acompaña a
--     `fecha_seguimiento` (el «cuándo»). Una oportunidad abierta sin fecha es
--     una oportunidad «sin próximo paso» y el kanban lo avisa.
--   · Reglas por etapa, dentro de cada etapa de `hub.pipelines.etapas`:
--       seguimiento_dias / seguimiento_texto → al ENTRAR en la etapa, el
--         próximo paso se pone solo (hoy + N días), salvo que el mismo cambio
--         traiga ya su fecha. Lo hace la base: vale igual desde el kanban, la
--         ficha, el MCP o el bot.
--       proponer ('presupuesto' | 'trabajo' | 'comanda') + comanda_texto → lo
--         PROPONE la pantalla al entrar; nunca se hace solo (una persona lo
--         confirma) y nada sale hacia el cliente.
--   · Cada cambio de etapa queda como actividad `tipo = 'etapa'` en la línea
--     de tiempo de la oportunidad y del cliente.
-- ════════════════════════════════════════════════════════════════════════

alter table hub.oportunidades add column if not exists siguiente_texto text;
comment on column hub.oportunidades.siguiente_texto is 'El próximo paso (qué); el cuándo es fecha_seguimiento. Solo del hub: la app no lo tiene.';

-- Actividad automática de cambio de etapa.
alter table hub.actividades drop constraint if exists actividades_tipo_check;
alter table hub.actividades add constraint actividades_tipo_check
  check (tipo in ('nota', 'llamada', 'visita', 'email', 'whatsapp', 'reunion', 'etapa'));

-- La etapa tiene que existir en su embudo; cerrar (ganada/perdida) apunta la
-- fecha; entrar en una etapa abierta con regla de seguimiento pone el próximo paso.
create or replace function hub.oportunidad_etapa()
returns trigger language plpgsql set search_path = hub as $fn$
declare v_etapa jsonb; v_tipo text; v_dias int;
begin
  select e into v_etapa from hub.pipelines p, jsonb_array_elements(p.etapas) e
   where p.id = new.pipeline_id and e->>'clave' = new.estado;
  v_tipo := v_etapa->>'tipo';
  if v_tipo is null then
    raise exception 'La etapa «%» no existe en ese embudo', new.estado;
  end if;
  if v_tipo in ('ganada', 'perdida') then new.cerrada_at := coalesce(new.cerrada_at, now());
  else new.cerrada_at := null; end if;
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado and v_tipo = 'abierta'
     and new.fecha_seguimiento is not distinct from old.fecha_seguimiento
     and coalesce(v_etapa->>'seguimiento_dias', '') ~ '^\d{1,3}$' then
    v_dias := (v_etapa->>'seguimiento_dias')::int;
    new.fecha_seguimiento := current_date + v_dias;
    new.siguiente_texto := coalesce(nullif(btrim(v_etapa->>'seguimiento_texto'), ''), new.siguiente_texto);
  end if;
  new.updated_at := now();
  return new;
end
$fn$;

-- Apunta el cambio de etapa en la línea de tiempo. Security definer: lo
-- escribe la base (también cuando el cambio llega por el MCP o el bot); el
-- autor es quien hizo el cambio, si se sabe.
create or replace function hub.oportunidad_etapa_traza()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare v_de text; v_a text;
begin
  select coalesce(e->>'nombre', old.estado) into v_de from hub.pipelines p, jsonb_array_elements(p.etapas) e
   where p.id = old.pipeline_id and e->>'clave' = old.estado;
  select coalesce(e->>'nombre', new.estado) into v_a from hub.pipelines p, jsonb_array_elements(p.etapas) e
   where p.id = new.pipeline_id and e->>'clave' = new.estado;
  insert into hub.actividades (tipo, texto, cliente_id, local_id, contacto_id, oportunidad_id, usuario_id)
  values ('etapa', coalesce(v_de, old.estado) || ' → ' || coalesce(v_a, new.estado)
            || case when new.motivo_perdida is not null and new.motivo_perdida is distinct from old.motivo_perdida
                    then ' (' || new.motivo_perdida || ')' else '' end,
          new.cliente_id, new.local_id, new.contacto_id, new.id, (hub.usuario_actual()).id);
  return null;
end
$fn$;
revoke all on function hub.oportunidad_etapa_traza() from public, anon;
drop trigger if exists etapa_traza on hub.oportunidades;
create trigger etapa_traza after update of estado on hub.oportunidades
  for each row when (old.estado is distinct from new.estado) execute function hub.oportunidad_etapa_traza();

-- Reglas de partida del embudo «Ventas» (se cambian en «Configurar embudos»).
-- Solo si el embudo aún no tiene ninguna regla: no pisa lo que ponga un admin.
update hub.pipelines p
   set etapas = (select jsonb_agg(e || coalesce(r.regla, '{}'::jsonb) order by o)
                   from jsonb_array_elements(p.etapas) with ordinality as x(e, o)
                   left join (values
                     ('Detectado',  '{"seguimiento_dias": 1, "seguimiento_texto": "Primer contacto"}'::jsonb),
                     ('Contactado', '{"seguimiento_dias": 3, "seguimiento_texto": "Volver a llamar"}'::jsonb),
                     ('Propuesta',  '{"seguimiento_dias": 7, "seguimiento_texto": "Preguntar por la propuesta", "proponer": "presupuesto"}'::jsonb),
                     ('Negociando', '{"seguimiento_dias": 3, "seguimiento_texto": "Cerrar condiciones"}'::jsonb),
                     ('Ganado',     '{"proponer": "comanda", "comanda_texto": "Preparar lo vendido a {cliente}: {titulo}"}'::jsonb)
                   ) as r(clave, regla) on r.clave = e->>'clave')
 where p.id = '00000000-0000-4000-8000-000000000001'
   and not exists (select 1 from jsonb_array_elements(p.etapas) e
                    where e ? 'seguimiento_dias' or e ? 'proponer');
