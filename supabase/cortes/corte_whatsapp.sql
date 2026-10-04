-- ════════════════════════════════════════════════════════════════════════
-- CORTE DE WHATSAPP — NO SE APLICA SOLO (paridad bloque 5). Pasa al hub las
-- conversaciones de WhatsApp: a partir de aquí las guarda y las contesta el
-- webhook del hub (`whatsapp-webhook`) y la ventana fija lee y escribe en
-- hub.wa_* (la función `whatsapp` lo decide sola por el área).
--
-- Se aplica UNA vez, con el OK de Fran, siguiendo docs/PENDIENTE_FRAN.md
-- §1 quinquies y EN ESTE ORDEN: (1) los secrets del webhook puestos en el hub;
-- (2) una pasada de sync-app de wa_conversaciones y wa_mensajes; (3) ESTE SQL;
-- (4) en Meta, la URL del webhook del hub. Al revés, el webhook del hub
-- recibiría mensajes con el área aún en la app y no los guardaría.
-- Lo que llegue a la app entre (3) y (4) no se pierde: lo ve su bandeja.
-- ════════════════════════════════════════════════════════════════════════

update hub.areas set dueno = 'hub', importar_altas = false, cortada_at = coalesce(cortada_at, now()),
       notas = coalesce(notas, '') || ' · corte de WhatsApp'
 where area = 'whatsapp';
