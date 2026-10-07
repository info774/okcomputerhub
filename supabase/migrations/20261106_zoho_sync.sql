-- De Zoho Books al hub: clientes, presupuestos y artículos (paridad de
-- `sync-zoho`, `sync-zoho-estimates`, `sync-zoho-items` y del automático de
-- `sync-auto.js` de la app, cada 2 h). La función `zoho-sync` no habla con
-- Zoho mientras `clientes` / `presupuestos` sean de la app (contesta
-- `omitido`): hasta el corte los trae la app y el hub los copia por sync-app.
-- Cortes del incremental en hub.sync_estado (`zoho_clientes`,
-- `zoho_presupuestos`): solo avanzan si la pasada fue bien.
select cron.schedule('hub-zoho-sync', '25 */2 * * *', $$select hub.lanzar_funcion('zoho-sync', '{"accion":"todo"}')$$);
