-- ════════════════════════════════════════════════════════════════════════
-- CORTE FINAL — NO SE APLICA SOLO. Pasa al hub todo lo que aún manda la app.
--
-- Se aplica UNA vez, a mano (workflow «Aplicar migración» o el SQL del
-- proyecto), cuando Fran dé el OK y DESPUÉS de los pasos de
-- docs/FASE_FINAL.md: la app en solo lectura (o apagada), una última pasada
-- completa de sync-app y comprobar que el hub tiene lo mismo.
--
-- Qué hace: marca todas las áreas como del hub (a partir de aquí escribe el
-- hub y sync-app las salta), da numeración propia a trabajos y tareas
-- (sigue la de la app), y quita las tareas de pg_cron del sync.
-- Qué NO hace: redirigir la app ni cambiar la URL de la APK (van aparte).
-- ════════════════════════════════════════════════════════════════════════

update hub.areas set dueno = 'hub', importar_altas = false, cortada_at = coalesce(cortada_at, now()),
       notas = coalesce(notas, '') || ' · corte final'
 where dueno = 'app';

-- Numeración: sigue donde la dejó la app.
create sequence if not exists hub.trabajos_numero_seq;
select setval('hub.trabajos_numero_seq', greatest(coalesce((select max(numero) from hub.trabajos), 0), 1));
alter table hub.trabajos alter column numero set default nextval('hub.trabajos_numero_seq');
create sequence if not exists hub.tareas_numero_seq;
select setval('hub.tareas_numero_seq', greatest(coalesce((select max(numero) from hub.tareas), 0), 1));
alter table hub.tareas alter column numero set default nextval('hub.tareas_numero_seq');
grant usage on sequence hub.trabajos_numero_seq, hub.tareas_numero_seq to authenticated, service_role;

-- El sync con la app, fuera (los tickets siguen entrando por su sync de altas
-- mientras exista la app: también se apaga, porque la app ya no crea nada).
select cron.unschedule(jobid) from cron.job where jobname in ('hub-sync-app', 'hub-sync-app-completo');
