# CLAUDE.md

Guía para Claude Code en este repositorio.

## Qué es esto

**Ok Computer Hub**: la app nueva de Ok Computer Tenerife (empresa de
servicios informáticos) que va a reunir gestión, proyectos, dirección,
monitorización (RMM), comunicación con clientes y equipo, y a sustituir con
el tiempo a la PWA actual (`okcomputerclaude`), a Notion, a Zoho One y a la
web de Breeze. El plan completo, con las decisiones tomadas y las fases, está
en `docs/PLAN_SISTEMA_UNIFICADO.md`; la referencia de producto (la demo de
OKHUB, de otra empresa) en `docs/referencias/OKHUB_INVENTARIO.md`.

**Estado**: solo documentación. No hay código todavía; la fase 0 del plan es
el scaffold.

## Los tres vecinos — LO MÁS IMPORTANTE

1. **`okcomputerclaude` (la app actual) no se toca desde aquí.** Ni PRs, ni
   despliegues de sus funciones, ni cambios en su Supabase (`okcomputer`,
   `gaksrtxgnuuuvhvgwxue`), que ya va justo de carga. Sigue en producción tal
   cual mientras el hub crece. Para entender sus áreas (calendario por
   bloques, inventario con movimientos, mantenimiento con Stripe y Zoho,
   WhatsApp…) léase su `CLAUDE.md`; sus migraciones están en
   `okcomputerclaude/supabase/migrations/`.
2. **El hub tiene Supabase PROPIO: `okcomputer-hub`** (antes `breeze-rmm`, ref
   `adomalsxsymxzuozksmt`, eu-west-1). Lo comparte con **Breeze**, el motor
   RMM (lanternops/breeze, Docker en el VPS; repo `okcomputer-rmm`), que usa
   el esquema `public` por Postgres directo con los roles `breeze`,
   `breeze_app` y `breeze_search` (`okcomputer-rmm/scripts/db-supabase.sql`).
3. **Los datos de negocio llegan de la app actual por copia inicial +
   sincronización de solo lectura**, área a área, hasta que cada área se
   corta y pasa a mandar el hub (§1.4 del plan).

### Las seis reglas del proyecto Supabase compartido con Breeze

1. **`public` es de Breeze.** No se crea, altera ni concede nada en `public`;
   no se expone `public` en la API REST (hoy está cerrada: `anon` y
   `authenticated` sin USAGE, y así se queda); no se tocan los roles de
   Breeze ni su script. Hay 16 tablas de Breeze sin RLS: por eso `public`
   no se expone nunca.
2. **Todo lo del hub vive en el esquema `hub`** (`hub.proyectos`,
   `hub.clientes`…). `hub` es el esquema expuesto en PostgREST; grants a
   `authenticated` y `service_role` solo ahí; RLS en todas sus tablas;
   auditoría propia en `hub.auditoria` (trigger genérico). El cliente de
   datos manda `Accept-Profile: hub` / `Content-Profile: hub`.
3. **Leer Breeze, no escribirle.** Vistas `hub.rmm_*` (propiedad de
   `postgres`, que salta la FORCE RLS de Breeze) sobre sus tablas. Toda
   acción sobre un equipo (comando, script, sesión remota, acuse) va por la
   **API REST de Breeze** desde una edge function con usuario de servicio,
   nunca por UPDATE en `public`. Las vistas se revisan en cada salto de
   versión de Breeze (`okcomputer-rmm/VERSIONES.md`).
4. **Migraciones con fecha** (`supabase/migrations/20261001_proyectos.sql`),
   aplicadas A MANO con el workflow «Aplicar migración» (secret
   `HUB_DB_PASSWORD`, transacción con `ON_ERROR_STOP`). No se editan las ya
   aplicadas. Ninguna contiene `public.` ni `alter role breeze`; el arnés lo
   comprueba y falla.
5. **Edge functions** en `supabase/functions/<nombre>/index.ts` (Deno) con
   `_shared/` propio: `http.ts` (CORS con lista blanca + JWT de sesión real),
   `mensajeria.ts` (Telegram / WhatsApp / push), `acciones.ts` (catálogo
   único de escrituras permitidas, compartido por voz, bot y MCP, que respeta
   `hub.areas`). Una función va en la lista `SIN_JWT` del workflow solo si la
   autoriza otra cosa (firma, secret, código de un solo uso). Se despliegan a
   mano, en el mismo rato que el front que las llama.
6. **`pg_cron` habilitado** en el proyecto: sincronización (`sync-app`, cada
   15 min), informes programados, recordatorios.

### Sincronización con la app actual (`sync-app`)

- Las tablas de negocio de `hub` llevan **los mismos nombres de columnas**
  que las de `okcomputer`; así el sync es columna a columna y portar un
  módulo no cambia consultas.
- Carga inicial: `scripts/importar-app.mjs` desde el dump nocturno de la app
  (`pg_dump -Fc --schema=public`) pasando por el esquema temporal
  `app_import`. Repetible; no toca la base viva.
- `sync-app`: lectura incremental del PostgREST de `okcomputer` (service key
  en el Vault; `updated_at > último corte`; las tablas sin `updated_at`, una
  pasada nocturna). Solo deltas. **Un sync que falla no mueve el corte.**
- `hub.areas` (área, dueño `app` | `hub`): con dueño `app` el hub enseña el
  área en solo lectura y el sync la refresca; al cortar, el hub manda y el
  sync la salta. **Ninguna escritura del hub sobre un área con dueño `app`**
  (lo comprueban `acciones.ts` y la RLS).

## Stack y estructura prevista (fase 0)

- **Frontend**: Vite + TypeScript **sin framework**. Módulos ES, una carpeta
  por pantalla en `src/modulos/<nombre>/`, hash-routing `#/ruta`, PWA
  (manifest + service worker). Sin `on*=` inline: `data-action` /
  `data-on-<evento>` con un dispatcher central (patrón de
  `public/js/dispatcher.js` de la app actual).
- **Datos**: cliente PostgREST propio (`src/core/api.ts`, portado de
  `public/js/api.js`) con timeout (10 s lectura, 30 s escritura), reintento
  al caducar el JWT y paginación más allá de 1000 filas, sobre el esquema
  `hub`. Auth con `@supabase/supabase-js` (solo Auth). La anon key del
  proyecto va en el código (no es secreta).
- **Shell**: menú por grupos, inicio con baldosas (cada módulo expone
  `contador()` → valor, subtítulo, tono), buscador de módulos, párrafo
  explicativo por pantalla, tema claro/oscuro, tour; enlaces a la app actual
  para lo que el hub aún no tiene.
- **Despliegue** (`.github/workflows/`): push a la rama por defecto → build →
  Firebase Hosting (sitio nuevo del mismo proyecto de Firebase; el id
  `okcomputerhub` ya lo usa el redirect legado, así que otro id); «Deploy
  funciones» y «Aplicar migración» a mano. Secrets propios del proyecto
  `okcomputer-hub` (`HUB_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`…).
- **Claude Code**: `.claude/settings.json` (permisos para sesiones
  desatendidas; deniega `rm -rf`, `sudo`, force-push, `reset --hard`),
  `.mcp.json` apuntando a la función `mcp` del hub, skill `verify` (Playwright
  + Chromium con la red de Supabase interceptada y fixtures; nunca contra
  datos reales) y la comprobación de migraciones.

## Comandos (cuando exista el scaffold)

- `npm run dev` — Vite en local.
- `npm run build` — `dist/`.
- `npm run lint` — ESLint + `tsc --noEmit`.
- `npm run verify` — arnés de verificación sin tocar datos reales.

## Convenciones

- Español en código de dominio, comentarios, commits y docs.
- Un prefijo de ids por modal, sin repetir en el documento.
- Cada pantalla nueva: registro en el router, entrada en el menú,
  `contador()`, párrafo explicativo, arnés `verify-<modulo>.mjs`, y una nota
  aquí si introduce una regla que el siguiente tenga que saber.
- Cada tabla nueva: en `hub`, con RLS, en `hub.auditoria`, y si viene de la
  app actual, con sus mismas columnas y su área en `hub.areas`.
- Portar, no reescribir a ciegas: los módulos de `okcomputerclaude`
  (`public/js/modules/*.js`) y su `_shared/*.ts` se copian aquí cuando les
  toque, pasándolos a TypeScript y conservando sus reglas de negocio.
