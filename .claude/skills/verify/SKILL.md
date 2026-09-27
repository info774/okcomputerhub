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

`npm run verify` pasa los cinco.

## Pantalla nueva

Un `verify-<modulo>.mjs` propio sobre `comun.mjs` (`servidor`, `navegador`,
`baseMemoria`, `preparar`), añadido a `npm run verify`, y una línea aquí con
qué cubre.
