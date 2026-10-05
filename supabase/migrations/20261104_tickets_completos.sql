-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 8 · tanda 1: tickets completos (tickets.js y rmm.js de la
-- app). Los tickets son ya del hub; esto les añade los dos enlaces que la app
-- guarda en otros sitios:
--   · hub.tickets.rmm_alerta_id: el ticket que se abrió desde una alerta de
--     Breeze (en la app es rmm_alertas.ticket_id, pero a Breeze no se le
--     escribe: el enlace vive en el ticket). Uno por alerta.
--   · hub.paginas.ticket_id: la página de la wiki con la resolución de un
--     ticket (decisión de Fran, 2026-10-05: «Guardar en Conocimiento» va a la
--     wiki del hub). Una por ticket: guardarla otra vez la actualiza.
-- Las tareas del ticket son las de la app (hub.tareas.ticket_id, área
-- `tareas`): se ven ya y se crean con el corte, como todo lo de esa área.
-- ════════════════════════════════════════════════════════════════════════

alter table hub.tickets add column if not exists rmm_alerta_id uuid;
create unique index if not exists tickets_rmm_alerta_uidx on hub.tickets (rmm_alerta_id) where rmm_alerta_id is not null;

alter table hub.paginas add column if not exists ticket_id uuid;
create unique index if not exists paginas_ticket_uidx on hub.paginas (ticket_id) where ticket_id is not null;
create index if not exists tareas_ticket_idx on hub.tareas (ticket_id) where ticket_id is not null;
