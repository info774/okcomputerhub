---
name: verify
description: Verifica cambios del frontend del hub (src/) arrancando el build real en Chromium headless con la red de Supabase interceptada y fixtures, sin tocar datos reales. Úsala antes de cerrar cualquier cambio de pantalla, shell o capa de datos.
---

# Verificación del hub

El hub va contra el proyecto `okcomputer-hub` (`adomalsxsymxzuozksmt`), que
comparte base con Breeze (RMM en producción). NUNCA se verifica escribiendo
contra él: se intercepta la red.

## Receta

1. `npm run build` (el arnés sirve `dist/` con `vite preview`).
2. `npm run verify` → `.claude/skills/verify/verify-shell.mjs`.
   - Chromium en `/opt/pw-browsers/chromium` (en CI, el que instala Playwright).
   - `newContext({ serviceWorkers: 'block' })`: con el SW activo las peticiones
     se saltan la intercepción.
   - Sesión: `localStorage['sb-adomalsxsymxzuozksmt-auth-token']` con una sesión
     de supabase-js v2 y un JWT falso con `exp` futuro; luego se responde
     `usuarios` con la persona (vacío = no dada de alta).
   - `https://adomalsxsymxzuozksmt.supabase.co/rest/v1/<tabla>` → fixtures. Los
     `HEAD` (contadores de las baldosas) contestan con `Content-Range: 0-0/N`
     **y** `Access-Control-Expose-Headers: Content-Range`: sin esa cabecera el
     navegador no deja leer el total y la baldosa se queda en «—».
   - `functions/v1/*` → se captura el cuerpo y la cabecera Authorization.
3. Capturas en `verify-capturas/` (ignorado por git): mirarlas.

Lo que siempre se comprueba: todas las peticiones REST llevan
`Accept-Profile: hub` (nunca `public`, que es de Breeze) y no queda ningún
`on*=` inline en el DOM.

## Migraciones

`npm run probar-migraciones` las aplica DOS veces en un Postgres local
desechable (imitando lo mínimo de Supabase, con pg_cron y pg_net simulados) y
prueba RLS, áreas, auditoría, que `public` no cambia y el importador con un
dump falso. `node scripts/comprobar-migraciones.mjs` (dentro de `npm run lint`)
rechaza cualquier migración que nombre `public.` o un rol de Breeze.

## Arneses

- `verify-shell.mjs`: login, usuario sin alta, shell, baldosas, Datos y
  sincronización, buscador, tema, tour, móvil.
- `verify-proyectos.mjs` (usa `comun.mjs`, un PostgREST EN MEMORIA que acepta
  escrituras): idea → kanban y arrastre entre fases, ficha entera (idea,
  objetivos, páginas con fuentes y markdown seguro, hitos y Gantt, tareas y
  arrastre, vínculo a un trabajo, coste), tareas por persona, que no se escribe
  en tablas espejo, técnico sin «Borrar proyecto», móvil.

- `verify-monitorizacion.mjs`: sedes con semáforo, equipos y buscador, alertas
  y «Acusar» por `breeze-api`, emparejado manual (upsert en `rmm_sitios`),
  ficha del equipo (TPV, gráfica con hover, comando y script por `breeze-api`,
  enlaces a Breeze), botones apagados sin usuario de servicio, móvil a 390 px
  SIN `isMobile` (con él, el navegador ensancha el viewport y esconde el
  desborde).

- `verify-mando.mjs`: Puesto de mando (cifras, avisos agrupados y «Los
  míos», gráfica de ventas con hover y tabla), Informes (vincular Telegram,
  programar, vista previa saneada, enviar ahora, pausar, configurar el bot),
  conexión de Zoho en Datos; un técnico no ve dinero; móvil.

- `verify-ventas.mjs`: Clientes 360 (lista y clase, «lo siguiente», clase a
  mano, apuntar, línea de tiempo, sedes, contactos), Oportunidades (arrastre,
  nueva con cliente, ganar, perder con motivo, actividad, previsión, embudos),
  Cobros (WhatsApp con el texto, editar, marcar enviado) y Mapa (puntos y
  capas; mosaicos de OSM interceptados). Nada escribe en el espejo; un técnico
  no ve dinero ni Cobros. OJO: el PostgREST en memoria no entiende
  `not.is.null` (lo trata como «todo»).

- `verify-wiki.mjs`: wiki (crear con vista previa segura, subpágina, mover,
  editar, historial y restaurar, archivar, reindexado al guardar) y Buscar
  (respuesta en markdown seguro con citas, fuentes, estado del índice,
  carpeta de Drive solo admin). Funciones simuladas en el propio arnés.

- `verify-tickets.mjs`: Desk (vistas y SLA, nuevo con cliente/sede/contacto,
  responder por correo y por WhatsApp, nota interna, plantillas, técnico,
  vincular trabajo, cerrar con valoración, bandeja de correo, ajustes, técnico
  sin borrar ni cambiar el SLA) y la página pública `valorar.html`.
  `window.open` se sustituye en la página para ver la URL de WhatsApp.

- `verify-portal.mjs`: `portal.html` con la función `portal` simulada (enlace,
  entrar y quitar el código de la URL, tickets, aviso, mensaje, aceptar,
  PDF, mantenimiento, equipos, sesión caducada, salir; comprueba que no toca
  PostgREST) y `#/portal` del equipo (invitar, enlace, revocar, aceptaciones).

- `verify-comandas.mjs`: escribir y GRABAR una comanda (Chromium con
  `--use-fake-device-for-media-stream`: `navegador(args)` de `comun.mjs`),
  tablero (botones y arrastre; ventana alta para que arrastrar no desplace la
  página), repartir, tarea suelta, filtro por persona, borrar solo lo propio.

- `verify-almacen.mjs`: stock y filtros (MRP simulado por RPC), «Qué pedir» →
  pedido en borrador, ficha (línea del catálogo, cantidad, enviar pide
  proveedor, recibido, entrada dada), proveedor y sus materiales (preferido),
  envíos (seguimiento, estado); nada escribe en el espejo del inventario.

- `verify-personas.mjs`: jornada (RPC simulado; corrección con motivo en hora
  de Canarias, CSV), ausencias (pedir, aprobar), gastos (subir → gastos-ocr
  simulada → confirmar), cierre, firmas (vista previa segura, enviar) y las
  páginas `firmar.html` (firma dibujada en el lienzo) y `gestoria.html`.
  OJO al simular funciones: un cuerpo puede traer su propio `nombre`
  (`{ ...b, nombre }`, no al revés).

- `verify-facturacion.mjs`: sin activar (aviso, serie real deshabilitada),
  borrador de prueba (cliente, línea, IGIC), emitir por RPC, emitida (marca
  PRUEBA, huella, no editable, cobro, rectificar), desde trabajos, emisor.

`npm run verify` pasa los trece.

## Pantalla nueva

Un `verify-<modulo>.mjs` propio sobre `comun.mjs` (`servidor`, `navegador`,
`baseMemoria`, `preparar`), añadido a `npm run verify`, y una línea aquí con
qué cubre.
