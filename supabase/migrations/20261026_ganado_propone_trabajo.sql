-- ════════════════════════════════════════════════════════════════════════
-- Embudo «Ventas»: al GANAR se propone crear el TRABAJO, no una comanda
-- (decisión de Fran, 2026-10-04). Solo si la regla sigue siendo la de
-- partida de 20261025_embudo_reglas.sql: no pisa lo que cambie un admin.
-- Mientras el área `trabajos` sea de la app, la pantalla solo avisa.
-- ════════════════════════════════════════════════════════════════════════
update hub.pipelines p
   set etapas = (select jsonb_agg(case when e->>'clave' = 'Ganado' and e->>'proponer' = 'comanda'
                                       then (e - 'comanda_texto') || '{"proponer": "trabajo"}'::jsonb else e end
                                  order by o)
                   from jsonb_array_elements(p.etapas) with ordinality as x(e, o))
 where p.id = '00000000-0000-4000-8000-000000000001'
   and exists (select 1 from jsonb_array_elements(p.etapas) e where e->>'clave' = 'Ganado' and e->>'proponer' = 'comanda');
