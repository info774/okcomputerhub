-- ════════════════════════════════════════════════════════════════════════
-- Paridad bloque 4, tanda 4: la cartera vieja de Zoho Billing.
-- El repaso diario de las sedes que aún cobra Zoho (estado, deuda real,
-- próxima cuota; desvincula las que allí ya no existen), como el cron de las
-- 4:00 de la app. La función `zoho-cartera` no escribe nada mientras las
-- sedes y el mantenimiento se lleven en la app: hasta el corte, este cron
-- llama y se va (el repaso lo sigue haciendo la app).
-- ════════════════════════════════════════════════════════════════════════
select cron.schedule('hub-zoho-cartera', '10 4 * * *', $$select hub.lanzar_funcion('zoho-cartera', '{"accion":"diario"}')$$);
