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

**Estado**: fase 0 en marcha (sync cada 15 min por el `audit_log` de la app,
Auth con Google, 6 usuarios, front en `https://okhub-tenerife.web.app`).
**Fase 1 en curso**: organizador de proyectos HECHO (`20261002_proyectos.sql`,
`#/proyectos`), conector MCP HECHO (`20261003_mcp.sql`, función `mcp`,
pantalla «Conector MCP», `docs/MCP.md`) y «lanzar a Claude» HECHO en el hub
(`20261004_claude_peticiones.sql`, pestaña Claude de la ficha, herramientas
`claude_peticion_*`); trabajador EN MARCHA desde el 2026-09-27 (sesión
«Trabajador de Claude (hub)» + Routine horaria, `docs/CLAUDE_TRABAJADOR.md`). Plan de la fase en `docs/FASE1.md`.

## Cómo pedirle cosas a Fran (preferencia suya, 2026-09-27)

Cuando haga falta algo suyo (una clave, un clic en un panel, un ajuste), se
explica **paso a paso y exactamente dónde está**: la web o app, el menú, el
botón con su nombre tal cual aparece en pantalla, qué copiar y dónde pegarlo
(y en qué formato). Nada de «ponlo en los secrets» a secas. Si hay una captura
suya de la pantalla, se le señala qué pulsar en ella. Las claves nunca se
piden por el chat: van a las variables de entorno del entorno cloud (menú del
entorno en la barra de título de la sesión → Edit → variables, una por línea
`NOMBRE=valor`).

## Autonomía de Claude (acordado el 2026-09-27)

- **Sin preguntar**: fusionar en `main`, desplegar el front
  (`okhub-tenerife.web.app`, de momento sin dominio propio) y las edge
  functions, aplicar migraciones sobre `hub` y dar de alta usuarios.
- **Preguntar antes**: borrar datos, cualquier ESCRITURA en la base de la app
  actual (`okcomputer`) y cualquier cosa que toque lo de Breeze (`public`,
  sus roles, su servidor).
- Credenciales, como variables de entorno del entorno cloud (nunca en el chat
  ni en el repo, y nunca impresas en la salida de un comando):
  - `SUPABASE_ACCESS_TOKEN`: Management API, SOLO ve la organización del hub
    (la app actual está en otra: 403). Esquemas expuestos, Auth, claves del
    hub (`/api-keys?reveal=true`, sin imprimirlas), `database/query`.
  - `FIREBASE_SERVICE_ACCOUNT`: la clave privada (PEM) de
    `firebase-adminsdk-fbsvc@okcomputerclaude.iam.gserviceaccount.com`; el
    JSON de credenciales se arma al vuelo en el scratchpad con ese correo.
    Despliegue del front: `HUB_BUILD=$(git rev-parse HEAD) npm run build` y
    `GOOGLE_APPLICATION_CREDENTIALS=<json> npx firebase-tools deploy --only
    hosting:hub --project okcomputerclaude`.
  - `GOOGLE_OAUTH_CLIENT_SECRET`: ya puesto en el proveedor Google del hub.
  - `GITHUB_TOKEN`: push y PRs. El proxy de las sesiones NO deja escribir
    secrets de Actions ni ajustes del repo: por eso `deploy.yml` sin su secret
    solo comprueba y avisa, y el despliegue lo hace la sesión.
  - `APP_SERVICE_ROLE_KEY` (service key de `okcomputer`, solo para LEER): ya
    está en el Vault del hub como `app_service_role_key` (2026-09-27).
  - Desplegar funciones: `npx supabase functions deploy <nombre> --use-api
    --project-ref adomalsxsymxzuozksmt` (+ `--no-verify-jwt` si va en
    `SIN_JWT`). SQL en el hub: Management API `database/query` o el conector.
- Red: `api.supabase.com` y `*.supabase.co` permitidos; `*.web.app` no (el
  front publicado se comprueba por la API de Firebase Hosting).
- La redirect URI del cliente OAuth «Ok Computer Web» en Google Cloud ya está
  puesta (2026-09-27).

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
- `sync-app`: lectura incremental por el **`audit_log` de la app** (id
  creciente; casi ninguna tabla de la app tiene `updated_at`): desde el último
  id, junta los registros tocados y pide su estado ACTUAL (lo que existe se
  sube, lo que ya no existe se borra). `audit_log` se aplicó en producción el
  2026-09-27 (con permiso de Fran: migración `20260911_audit_log.sql` de la
  app, 17 triggers); hasta entonces el sync fue en modo «sin log» (filas nuevas
  por `created_at` y el resto en la pasada nocturna), que sigue en el código
  por si el log desaparece. Tras activar el log se hizo una pasada completa
  para cerrar el hueco entre los dos modos.
  **Un sync que falla no mueve el corte** (`hub.sync_estado`). Las columnas
  que copia están en `_shared/tablas-app.ts`, que tiene que cuadrar con la
  migración de la tabla.
- Lo que escribe el sync (cabecera `x-hub-sync`) y el importador (GUC
  `hub.sin_auditoria`) no entra en `hub.auditoria`: ya lo auditó la app.
- Las tablas espejo no llevan claves foráneas ni secuencias (el espejo llega
  por deltas y en cualquier orden; `numero` lo pone la app): se añaden en la
  migración que corte su área.
- `hub.areas` (área, dueño `app` | `hub`): con dueño `app` el hub enseña el
  área en solo lectura y el sync la refresca; al cortar, el hub manda y el
  sync la salta. **Ninguna escritura del hub sobre un área con dueño `app`**
  (lo comprueban `acciones.ts` y la RLS).

## Stack y estructura (fase 0)

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

## Comandos

- `npm run dev` — Vite en local (contra el Supabase REAL del hub: para
  probar sin datos reales, `verify`).
- `npm run build` — `dist/` (sella el service worker con `HUB_BUILD`).
- `npm run lint` — ESLint + `tsc --noEmit` + `comprobar-migraciones.mjs`.
  Ejecutar antes de cerrar cambios.
- `npm run verify` — arnés del shell (tras `npm run build`); ver
  `.claude/skills/verify/SKILL.md`.
- `npm run probar-migraciones` — aplica las migraciones dos veces en un
  Postgres local desechable y prueba RLS, áreas, auditoría, que `public` no
  cambia y el importador. Al tocar una migración o `importar-app.mjs`.

## Piezas del front

- `src/core/`: `config.ts` (URL y anon key del hub), `auth.ts` (supabase-js,
  solo Auth), `api.ts` (PostgREST sobre `hub`; `API.contar()` = HEAD con
  `count=exact` para las baldosas), `dispatcher.ts` (`registrarAcciones({...})`
  en vez del puente `window.*` de la app actual), `router.ts` (`#/<id>/…`),
  `modulo.ts` (el contrato de una pantalla).
- `src/modulos/index.ts` registra las pantallas; el orden es el del menú.
  `app-actual/` son los enlaces a la app actual con contador sacado del
  ESPEJO del hub (ni una consulta más a producción).
- `src/shell/`: shell, login, buscador (Ctrl+K), tema, tour.
- `src/core/equipo.ts`: personas del equipo (caché 5 min, una carga en
  vuelo) y `nombreDe(id)`. `src/ui/markdown.ts`: markdown SEGURO (escapa todo
  antes de dar formato); úsese para todo texto que escriba una persona o Claude.
- Proyectos (`src/modulos/proyectos/`): `datos.ts` (tipos, fases, consultas,
  `ENLAZABLES`), `lista.ts` (kanban por fase con arrastre, lista, tareas por
  persona, bandeja de ideas) y `ficha.ts` (pestañas Idea · Objetivos ·
  Investigación · Roadmap con Gantt · Tareas · Vinculado · Coste). **Regla**:
  las tablas espejo (trabajos, tareas, tickets…) tienen dueño `app` y el hub no
  les escribe; un proyecto tiene sus PROPIAS tareas (`proyecto_tareas`) y ENLAZA
  lo de la app con `proyecto_vinculos`. Borrar un proyecto entero: solo admin.
- Conector MCP: función `mcp` + catálogo ÚNICO `_shared/acciones.ts` (lo
  reutilizarán voz y bot) + `_shared/hub-db.ts` (PostgREST del hub con
  `x-hub-origen`/`x-hub-usuario` para que la auditoría ponga el autor). Tokens
  `okh_…` en `hub.mcp_tokens` (solo la huella), los crea un admin en
  `#/conector`. Herramienta nueva: ver `docs/MCP.md`. `npm run lint` incluye
  `deno check` de las funciones.
- `Modulo.soloAdmin` lo esconde del menú Y lo bloquea por URL (shell.ts).
- El dispatcher delega también arrastrar y soltar (`data-on-dragstart`,
  `data-on-dragover` + `data-prevent="1"`, `data-on-drop`).
- Al entrar se busca el correo de la sesión en `hub.usuarios` (activo): sin
  fila, se cierra la sesión y se avisa. La RLS usa la misma regla
  (`hub.es_usuario()`, `hub.es_admin()`).

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
