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
**Fase 2 HECHA** (2026-09-27): monitorización sobre Breeze (`20261006_rmm.sql`,
`#/monitorizacion`, función `breeze-api`, herramientas `rmm_*`); falta que Fran
dé de alta el usuario de servicio en Breeze. Detalle en `docs/FASE2.md`.
**Fase 3 HECHA** (2026-09-27): puesto de mando (`20261007_mando.sql`,
`#/direccion`, `#/informes`, funciones `zoho-lectura`, `informes-enviar`,
`telegram-bot`); faltan las credenciales de Zoho (Self Client) y el token del
bot de Telegram, que pone Fran. Detalle en `docs/FASE3.md`.
**Fase 4 HECHA** (2026-09-27): ventas (`20261008_ventas.sql`, `#/clientes`
ficha 360, `#/oportunidades`, `#/cobros`, `#/mapa`). Clientes/sedes/contactos
siguen en la app; las OPORTUNIDADES son ya del hub. Detalle en `docs/FASE4.md`.
**Fase 5 HECHA** (2026-09-27): wiki y buscador (`20261009_wiki.sql`, `#/wiki`,
`#/buscar`, funciones `documentos-indexar`, `documentos-preguntar`). Detalle en
`docs/FASE5.md`. Las decisiones de Fran para las fases 5 a Final están en
`docs/DECISIONES_FASES.md` y lo que tiene que hacer él, en `docs/PENDIENTE_FRAN.md`.
**Fase 6 HECHA** (2026-09-27): Desk (`20261010_desk.sql`, `#/tickets`, funciones
`desk-correo` y `ticket-valorar`, `valorar.html`). Los TICKETS son ya del hub.
Detalle en `docs/FASE6.md`.
**Fase 7 HECHA** (2026-09-27): portal de clientes (`20261011_portal.sql`,
`portal.html`, función `portal`, `#/portal`). Detalle en `docs/FASE7.md`.
**Fase 8 HECHA** (2026-09-27): comandas (`20261012_comandas.sql`, `#/comandas`,
función `comandas`, notas de voz al bot). Detalle en `docs/FASE8.md`.
**Fase 9 HECHA** (2026-09-27): almacén (`20261013_almacen.sql`, `#/almacen`, MRP en
`hub.mrp()`, proveedores, pedidos de compra y envíos; inventario en espejo).
Detalle en `docs/FASE9.md`.
**Fase 10 HECHA** (2026-09-27): personas (`20261014_personas.sql`, `#/personas`,
`#/firmas`, `firmar.html`, `gestoria.html`, funciones `gastos-ocr` y `firma`).
Detalle en `docs/FASE10.md`.
**Fase 11 PROGRAMADA SIN ACTIVAR** (2026-09-27): facturación propia
(`20261015_facturacion.sql`, `#/facturacion`); Zoho sigue facturando; solo emite
la serie de PRUEBA. Detalle y pasos para activarla en `docs/FASE11.md`.
**Fase Final PROGRAMADA SIN EL CAMBIO** (2026-09-27): `#/trabajos`, `#/calendario`,
`#/chat`, `#/hoy` (`20261016_final.sql`); el corte está preparado en
`supabase/cortes/corte_final.sql` y NO se aplica sin el OK de Fran. Pasos en
`docs/FASE_FINAL.md`.

**Paridad con la app** (decisión de Fran, 2026-10-03): la app y el hub avanzan
en paralelo; el hub tiene que hacer TODO lo que hace la app (también lo que se
le añada) más lo suyo, hasta sustituirla, sin molestar el uso diario. Mapa,
estados y orden de bloques en `docs/PARIDAD.md` (con «Revisado hasta» = último
commit de la app revisado). Lo nuevo de la app se trae con **`/paridad`**, solo
cuando Fran lo pida: lo de un área que ya está en el hub se porta, se fusiona y
se despliega; lo demás se apunta. Primero la paridad, después lo propio.

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
   aplicadas. Ninguna contiene `public.` (salvo en un FROM/JOIN de lectura,
   para las vistas `hub.rmm_*`) ni `alter role breeze`; el arnés lo
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
- `src/shell/`: shell, login, buscador (la paleta Ctrl+K), tema, tour,
  `pantalla.ts` (pintar un módulo en un contenedor) y `escritorio.ts` (modo
  escritorio).
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
- Monitorización (`src/modulos/monitorizacion/`): lee SOLO las vistas
  `hub.rmm_*`; lo que se le pide a Breeze va por `breeze-api` (catálogo
  `_shared/rmm-acciones.ts`, compartido con el MCP) y queda en
  `hub.rmm_acciones`. Las vistas son solo SELECT (una vista simple es
  actualizable y escribiría en Breeze): toda vista nueva sobre `public`, con
  `hub.ve_rmm()` en el `where` y su `revoke`. `comprobar-migraciones` deja
  nombrar `public.` solo en FROM/JOIN. Resolver alertas y control remoto: en el
  panel de Breeze (el usuario de servicio es Partner Technician, sin MFA).
- Gráficas: SVG propio (sin librerías), una serie por gráfica, hover por
  `data-on-pointermove`/`pointerout` (el dispatcher los delega). El atributo
  `hidden` no esconde un elemento SVG: va con CSS (`[hidden] { display: none }`).
- Puesto de mando: `hub.panorama_direccion(p_para)` es el ÚNICO motor de
  avisos (panel, bot, informes, MCP); un aviso nuevo se añade ahí, con
  `dinero = true` si es de dinero (solo admins). Es `security definer`: filtra
  él mismo con `hub.admin_para()`. Dinero de Zoho: espejo de SOLO LECTURA
  (`hub.zoho_*`, RLS solo admins) que rellena `zoho-lectura`. Las ÚNICAS
  escrituras del hub en Zoho son las de la paridad con la app, cada una con su
  área cortada: contactos de clientes («Clientes con escritura»), presupuestos y
  facturas de trabajos (función `zoho-ventas`, «Presupuestos con escritura»). Los 7 informes viven en `_shared/informes.ts` (texto en el
  HTML de Telegram, escapado con `h()`); el front lo pinta con `htmlTelegram()`,
  que solo deja pasar `<b>`, `<i>`, `<code>` y enlaces https.
- Los técnicos se guardan por NOMBRE en la app y no siempre igual («Matteo» /
  «Matteo Monastero»): para saber si algo es de alguien, nombre completo o de
  pila (`esDe` en `_shared/informes.ts`, `esMio` en `direccion/`).
- Funciones que llama pg_cron: `hub.lanzar_funcion('<nombre>', cuerpo)` (misma
  URL base y token que el sync) y van en `SIN_JWT`.
- Llamar a una función desde el front: `llamarFuncion()` de `src/core/funciones.ts`.
- Ventas: el CRM del hub va ENCIMA del espejo sin tocarlo (`hub.clientes_crm`,
  `hub.actividades`, `hub.clases_clientes()`, `hub.linea_tiempo()`); lo común
  del front está en `src/modulos/ventas/datos.ts`. Oportunidades: área del hub
  con `hub.areas.importar_altas`: `sync-app` inserta las que la app sigue
  creando (web, WhatsApp) con `ignore-duplicates`, nunca pisa. Una etapa nueva
  se define en `hub.pipelines` (la valida un trigger). Recordatorios de cobro:
  se PREPARAN (`hub.preparar_recordatorios`) y los manda una persona; nunca
  salen solos hacia un cliente.
- **Embudo a lo Bitrix24** (2026-10-04, `20261025_embudo_reglas.sql`,
  embudo ÚNICO «Ventas» por decisión de Fran): barra de etapas en flechas en
  la ficha, zonas «Ganado / Perdido» al pie del kanban para soltar, alta
  rápida por columna y PRÓXIMO PASO (`fecha_seguimiento` = cuándo,
  `siguiente_texto` = qué; abierta sin fecha = «sin próximo paso», avisado en
  tarjeta, columna y baldosa). Reglas por etapa DENTRO de `pipelines.etapas`:
  `seguimiento_dias`/`seguimiento_texto` las aplica la BASE al cambiar de
  etapa (trigger `hub.oportunidad_etapa`, salvo que el cambio traiga su
  fecha; al CREAR las aplica la pantalla con `conRegla`); `proponer`
  (`presupuesto` | `trabajo` | `comanda`, + `comanda_texto` con `{cliente}`,
  `{titulo}`, `{valor}`) solo lo PROPONE la pantalla y lo confirma una
  persona; nada sale hacia el cliente. Cada cambio de etapa queda como
  actividad `tipo = 'etapa'` (trigger `etapa_traza`). Trabajo desde una
  oportunidad: `#/trabajos/nuevo/o/<id>` (enlaza `oportunidad_id`).
  Esqueletos de carga: `esqueleto(forma)` de `src/ui/esqueleto.ts` (lleva
  `.cargando`, así que los arneses que esperan a que se vaya siguen valiendo;
  sin degradados). Arnés `verify-embudo.mjs`.
- Buscador (RAG): `public` está cerrado también al `service_role`, así que los
  vectores (`public.vector(384)`, gte-small) solo entran y salen como TEXTO por
  `hub.guardar_fragmentos` / `hub.buscar_fragmentos` (security definer). Algo
  nuevo que deba encontrarse: una fila en `hub.documentos` (`pendiente`) y la
  cola lo indexa; el extractor está en `documentos-indexar`. Claude, por
  `_shared/claude.ts` (sin clave, se degrada: fuentes sin redacción).
- Desk: tickets y `ticket_comentarios` son del hub (área cortada con
  `importar_altas`; numeración propia desde el 5000). El SLA lo calcula la base
  (trigger + `hub.sumar_laborables`), no el front. Una respuesta al cliente es
  un comentario `tipo = 'respuesta'` y el envío queda en `enviado_at`/`canal`;
  por correo lo manda `desk-correo` (Gmail con delegación, actuando como
  info@). Nada sale solo hacia un cliente: lo manda una persona.
- Páginas públicas sueltas (sin login): `public/<nombre>.html`, autorizadas por
  un token en la URL y una función SIN_JWT; el service worker no las toca.
- Portal de clientes: los clientes NO son usuarios de Supabase ni tocan
  PostgREST; todo va por la función `portal` con sesión propia
  (`x-portal-token`) y filtrado por el cliente del acceso. Algo nuevo que vea
  el cliente = una acción en `portal/index.ts` que filtre por
  `s.cliente_id`, y nunca notas internas. `portal.html` es otra entrada de Vite
  (`src/portal/`), sin supabase-js.
- Comandas: tareas DEL HUB (`hub.comanda_tareas`), no las de la app (que no se
  cortan). Todo lo que crea comandas pasa por `crearComanda()` de
  `_shared/comandas.ts` (pantalla, bot y MCP), que también avisa por Telegram.
- Jornada (RD-ley 8/2019): `hub.jornada()` la CALCULA sobre los fichajes de la
  app; nunca se corrige tocando `sesiones` (espejo) sino con
  `hub.jornada_ajustes` (motivo + autor). Gestoría = acceso del portal de
  `tipo = 'gestoria'`: todo lo que ve pasa por las acciones `g_*` de la función
  `portal` y queda en `portal_traza`.
- Gastos y cobros de la app (paridad bloque 7, tanda 2, PREPARADO para el corte
  del área `gastos`): UNIFICADOS en Personas → Gastos (`personas/movimientos.ts`,
  `pm-`; `#/personas/gastos/gasto|cobro[/t/<trabajo>]` y `/mov/<id>`), debajo de
  los tickets de Claude. La foto va al cubo privado por `gastos-ocr` (`foto`) y
  `foto_url` = `hub:gastos/<ruta>` (se abre con `foto_url`, enlace de minutos);
  las viejas de la app (Drive o data URL) se abren tal cual. Borrar, solo admin.
- Facturas de compra (bloque 7, tanda 2): DEL HUB desde ya (`hub.facturas_compra`;
  en la app la tabla nunca llegó a producción). Almacén → «Facturas de compra»
  (`almacen/facturas.ts`, `afc-`); el adjunto lo sube y lo lee `gastos-ocr`
  (`compra`, `compra_url`). Arnés de las dos: `verify-compras-gastos.mjs`.
- **VeriFactu** (`src/modulos/verifactu/`, `#/verifactu`, paridad bloque 7,
  tanda 3, PREPARADO para el corte del área `verifactu`): el tablero de la app
  (una tarjeta por SEDE, seis fases, tres carriles). Sus reglas (carril por la
  letra del NIF, plazos 1/1/2027 y 1/7/2027, criterio de salida que AVISA al
  avanzar y no bloquea) están COPIADAS en `verifactu/reglas.ts`: si cambian en
  `modules/verifactu.js` de la app, cambiarlas ahí. Espejo `hub.verifactu_sedes`
  (auditado en la app, va por el incremental). Quitar del tablero, solo admin.
  Arnés `verify-verifactu.mjs`.
- **Control de equipos** (paridad bloque 7, tanda 4; decisión de Fran: verlo
  ya, la pasada propia preparada sin encender): Monitorización → «Software
  obligatorio» (`monitorizacion/control.ts`, `mce-`) y la sección de la sede,
  sobre el espejo `hub.equipos_control` (área `equipos`; la app no lo audita:
  llega en la nocturna y en `hub-equipos-control` a las 6:40 UTC, tras su
  comprobación de las 6:10). La función `control-equipos` del hub (SIN_JWT,
  token del cron o admin) está portada de la app pero lee Breeze por las
  vistas `hub.rmm_*`; con el área de la app contesta `omitido`. Su cron se
  pone con el corte. Arnés `verify-control-equipos.mjs`.
- **Google** (paridad bloque 7, tanda 5): función `google` (con sesión) sobre la
  cuenta de servicio y la delegación de dominio (`_shared/google.ts`), nunca el
  OAuth de cada persona: `calendario` (SOLO LECTURA, calendar.readonly: el de
  info@ y el de quien tenga correo de la empresa; sin el permiso devuelve
  `falta_permiso` y el calendario lo dice), `contacto` (Contactos de info@ y
  `google_contact_id`; 409 mientras `clientes` sea de la app) y `carpeta`
  (Drive: cliente → sede por nombre en la carpeta compartida de la empresa).
  Capa en el calendario (casilla «Google», `hub_ca_google`; los de todo el día
  con fin EXCLUSIVO) y «Drive» en las fichas (`ui/drive.ts`, abre la pestaña en
  el mismo gesto). Arnés `verify-google.mjs`.
- Firmas: lo firmado es inmutable (trigger `hub.firma_antes`); solo
  `hub.firma_firmar` (service_role, con la huella) lo pasa a firmado.
- Ficheros privados (Storage, cubo `gastos`): los sube y firma URLs
  `_shared/archivos.ts` con la service key; el navegador nunca toca Storage.
- Facturación propia: SIN ACTIVAR. Nada la activa salvo
  `hub.config.facturacion_activa = true` con el OK de Fran (no hay botón). Una
  factura se emite SOLO con `hub.emitir_factura()`; lo emitido es inmutable
  (se rectifica con `hub.crear_rectificativa()`).
- Áreas aún de la app (trabajos, agenda, sesiones, inventario…): las pantallas
  del hub preguntan `esDelHub()` (`src/core/areas.ts`) y, si es de la app,
  enseñan en solo lectura con `avisoSoloLectura()`. Las escrituras de esas
  áreas van por funciones de la base (`hub.fichar`, `hub.trabajo_guardar_lineas`,
  `hub.trabajo_estado`, `hub.agenda_mover`) que llaman a `hub.exigir_area()`:
  el corte (supabase/cortes/) las enciende sin tocar el front.
- Pantallas pesadas: `pintar` hace `import('./vista')` (se cargan bajo demanda);
  el `index.ts` del módulo solo lleva el contrato y el `contador()`.
- `supabase/cortes/`: SQL preparado que NO se aplica solo (lo comprueba
  `comprobar-migraciones` y lo prueba `probar-migraciones`).
- Avisos de fases nuevas: cada fase tiene su gancho (`hub.avisos_portal`,
  `_comandas`, `_almacen`, `_personas`, `_facturacion`; este último solo para
  admins) que junta `hub.avisos_extra()` y llama `panorama_direccion`. Un aviso
  nuevo se añade redefiniendo SOLO el gancho de su fase.
- Almacén: el inventario es ESPEJO (área `inventario`, dueño `app`); el MRP
  (`hub.mrp()`) lo lee. Lo recibido se da de entrada en la app y se marca
  «entrada dada» en el pedido.
- El shell pinta cada navegación en un contenedor nuevo (`.vista`): un
  `pintar()` lento que acaba tarde escribe en el suyo, ya fuera del documento.
- Leaflet se importa de forma diferida (`import('leaflet')`) solo en `#/mapa`.
  Desde el 2026-10-05 (paridad bloque 8, tanda 2) el mapa lleva a la derecha
  el planificador de la app (`mapa/planificador.ts`, `map-`): Día (técnicos
  fichados con el GPS del fichaje o al lado de su sede, trabajos del día por
  `fecha_programada` Y por bloque de agenda, tickets), Semana (arrastrar y
  soltar: un pendiente se planifica a las 9:00 escribiendo la fecha en el
  trabajo, como el calendario; un bloque se mueve con `hub.agenda_mover` o se
  quita soltándolo en la bandeja; solo con `trabajos` y `agenda` del hub) y
  Ruta (vecino más cercano desde `OFICINA` de `calendario/motor.ts`, km en
  línea recta, enlace a Google Maps). Arnés `verify-mapa-planificador.mjs`.
- Al entrar se busca el correo de la sesión en `hub.usuarios` (activo): sin
  fila, se cierra la sesión y se avisa. La RLS usa la misma regla
  (`hub.es_usuario()`, `hub.es_admin()`).
- **Marca en el front** (2026-09-28): `src/estilo.css` lleva los tokens del
  sistema «OK Computer» (`--verde`, `--lima`, `--hondo`, `--tinta`, `--noche`,
  `--menta`, `--palido`, `--linea`) y redefine los de interfaz en los dos temas
  (`--primario` = hondo/lima para texto y activo, `--primario-suave` para
  fondos de lo activo, `--accion` = verde/lima para el botón principal). Las
  pantallas siguen usando los nombres de siempre. El hexágono es el único
  motivo gráfico (`.hex`, `.hex-punto`, `--hex`); sin azules ni degradados.
  OJO: `.aviso` es una CAJA (padding y fondo); un color de gravedad va como
  `g-mal` / `g-aviso`. Gráficas: `--serie-1` verde y `--serie-2` ámbar.
- **Modo escritorio** (`src/shell/escritorio.ts`, `src/escritorio.css`, todo
  bajo `body.os-modo`; `docs/MODO_ESCRITORIO.md`): el hub como escritorio con
  ventanas (una por módulo, pintadas con `shell/pantalla.ts`, la misma pieza
  que usa el shell clásico), widgets (Hoy, Avisos de `panorama_direccion`,
  Cobros solo admin, Equipos, Agenda), dock, escritorios con nombre y centro
  de avisos. Desde el 2026-10-03 (decisión de Fran) es la ENTRADA POR DEFECTO
  a partir de 1024 px (`hub_escritorio` sin valor o `'1'`); «Volver a la app
  clásica» (o `?os=0`) guarda `'0'` y se respeta hasta volver a pulsar «Modo
  escritorio». En el móvil, siempre el clásico con la portada de Oki. Lleva
  también las piezas de Oki como widgets (Voz, Oki dice, Estadísticas, Órdenes
  rápidas: `modulos/inicio/piezas.ts`, las MISMAS de la portada, sin ids: la
  voz se agrupa con `data-voz`) y «Oki» en el dock abre la portada entera en su
  ventana (`#/inicio` sigue siendo el escritorio). Los widgets van en columnas
  que se rellenan de arriba abajo hasta que se mueve uno. La disposición va en
  `localStorage.hub_os_<usuario>`; lo ÚNICO que va a la base son las fijas del
  dock (abajo). Ventanas (2026-10-03, como las de la app y mejoradas): cuerpo
  OPACO en `fondo`, menú de disposiciones sobre Maximizar y asistente de ajuste
  que rellena el hueco; abrir, cerrar, minimizar y encajar van animados
  (`.os-anima`): un arnés que mida la geometría espera a que no quede
  `.os-win.os-anima`, y cerrar quita el id AL MOMENTO. Barra (2026-10-04): cristal como el dock, iconos de línea
  (`ICONO_BARRA`, NADA de emojis: el arnés lo comprueba), «› <ventana de
  delante>» junto a la marca (`#os-frente`, lo pone `pintarDock`), número de
  ventanas por escritorio (`contarVentanas`, desde `guardarEstado`), sync con
  hexágono de estado, reloj con el día que abre `#/calendario` y menú del
  avatar con iconos y «Nuevo escritorio». Centro de avisos (2026-10-04): panel flotante por
  gravedad (Urgente · Atento · Para saber), icono de la pantalla de cada tipo
  (`AVISO_PANTALLA`: tipo → icono del dock y verbo de la acción; un tipo nuevo
  del motor sin entrada sale con su inicial y «Abrir»), Todos/Los míos + chips
  por tipo, «N nuevos» = claves que no estaban la vez anterior que se abrió
  (`localStorage.hub_os_avisos_vistos_<usuario>`; la primera vez, ninguno),
  Actualizar, Esc cierra y pie con la hora de la última lectura. Un módulo nuevo entra solo en el lanzador y, mientras nadie
  haya elegido sus fijas, en el dock (las 12 primeras de `visibles()`). Los arneses usan
  el clásico salvo que pidan `preparar(…, { escritorio: 'defecto' })`. Arnés
  `verify-escritorio.mjs`.
- **Clientes con escritura** (2026-10-03, paridad bloque 2, PREPARADO para
  el corte del área `clientes`): `#/clientes/nuevo` y `#/clientes/<id>/editar`
  (`clientes/formulario.ts`, prefijo `cf-`); con NIF repetido NO se crea
  (`clientePorNif`). Dar de baja / reactivar = SOLO `activo` (no se borra
  nada; Zoho no se toca); eliminar (admin) = baja + quitar de Zoho. Zoho
  (decisión de Fran: igual que la app) por la función `clientes`
  (`zoho_alta` al crear, `zoho_quitar` al eliminar; `nif` busca la razón
  social y vale ya), que con el área de la app contesta 409. Es la ÚNICA
  escritura del hub en Zoho (`zohoEnviar` de `_shared/zoho.ts`); editar no
  manda nada a Zoho, como la app. Excel: `descargarCsv` de `src/ui/csv.ts`.
  Arnés `verify-clientes.mjs`.
- **Sitios** (`src/modulos/sitios/`, `#/sitios`, 2026-09-28): las sedes como
  en «Sitios» de la app (lista con filtros y ficha con resumen, contactos,
  trabajos, tickets y equipos). Espejo en SOLO LECTURA (área `clientes`); la
  cuota solo para admin y el código de alarma oculto hasta pulsar «Ver». Las
  sedes de la ficha del cliente enlazan aquí. Arnés `verify-sitios.mjs`.
  Desde el 2026-10-03 (paridad bloque 2, tanda 2) con escritura PREPARADA para
  el corte del área `clientes`: alta y edición (`sitios/formulario.ts`, prefijo
  `sf-`, sin el mantenimiento, que es del bloque 4), baja/reactivar (solo
  `activo`), eliminar (admin: DELETE de sus `local_telefonos` y después de la
  sede, porque el espejo no tiene cascada) y pestaña «Teléfonos» con ROL
  (`hub.local_telefonos`, en el área `clientes`; sin CHECK de rol por ser
  espejo). Arnés `verify-sitios-escritura.mjs`. Tanda 3 (mismo día): pestañas
  Software, Hardware, Cámaras y Seguimiento (`sitios/equipamiento.ts`, prefijos
  `si-eq-`/`si-rem-`) sobre los espejos de `20261022_sitio_equipamiento.sql`
  (área `clientes`), y «🖥 Remoto»: AnyDesk de hardware + software sin repetir
  y RustDesk de Breeze con la contraseña de la sede al portapapeles
  (`hub.rmm_despliegues`: SOLO LECTURA también tras el corte y FUERA de
  `hub.auditoria`, que la guardaría en claro; su clave es `local_id`, que el
  sync lee de `clave` en `tablas-app.ts`). Contraseñas de cámaras tras «Ver».
  En una Vivienda no salen Software ni Seguimiento. Eliminar una sede borra
  antes lo que cuelga de ella. Arnés `verify-sitios-equipamiento.mjs`.
- **Contactos** (`src/modulos/contactos/`, `#/contactos`, 2026-09-28): la
  agenda de la app (tipos, favoritos, etiquetas, de baja; llamar/WhatsApp/correo
  desde la fila) y ficha con datos, trabajos y tickets donde figura. Espejo en
  SOLO LECTURA; los contactos de las fichas de cliente y sitio enlazan aquí.
  Arnés `verify-contactos.mjs`.
  Desde el 2026-10-03 (paridad bloque 2, tanda 4) con escritura PREPARADA para
  el corte: `contactos/formulario.ts` (prefijo `ctf-`; `#/contactos/nuevo`,
  `/nuevo/c/<cliente>`, `/nuevo/l/<sede>`, `/<id>/editar`); los EMPLEADOS solo
  los toca un admin; «eliminar» es baja (`activo = false`). Arnés
  `verify-contactos-escritura.mjs` (que prueba también lo de abajo).
- **Google Maps** (`src/ui/maps.ts`, 2026-10-03): `buscadorMaps(prefijo)` +
  `alElegirLugar(prefijo, fn)`, portado de `google-places.js` de la app: SOLO
  Tenerife (`locationRestriction` sin `locationBias`, que Google rechaza junto) y
  aviso si la ficha cae fuera; un fallo de Google se dice, no se vende como «sin
  resultados». La clave es la de NAVEGADOR de la app (`PLACES_API_KEY` en
  `config.ts`, no es secreta; la protege su lista de webs permitidas en Google
  Cloud, PENDIENTE_FRAN §2 bis). Lo usan el formulario de sede
  (`rellenarConLugar`) y la sede rápida del trabajo. Antes de crear una sede se
  pregunta si hay otra de nombre parecido (`confirmarSedeNoDuplicada`, ≥ 80 %).
- **Cliente y sede al vuelo** en el alta de trabajo (2026-10-03): «+ Nuevo
  cliente» (mini formulario `tf-nc-`, decisión de Fran) y «+ Nueva sede»
  (`tf-nl-`, con Google Maps) solo si el área `clientes` está cortada; se crean
  al momento y quedan elegidos. El alta de cliente pasa SIEMPRE por
  `crearCliente()` de `clientes/formulario.ts` (NIF repetido no, alta en Zoho).
- **Tareas** (`src/modulos/tareas/`, `#/tareas`, 2026-09-28): las tareas de la
  app (ya no es un enlace): filtros de la app, por persona, lista y tablero, y
  ficha con lo que enlaza. Espejo en SOLO LECTURA (área `tareas`); NO son las
  comandas (`hub.comanda_tareas`). Arnés `verify-tareas.mjs`.
- **Presupuestos con escritura y facturar trabajos** (2026-10-03, paridad
  bloque 3, PREPARADO para el corte): alta y edición (`presupuestos/formulario.ts`,
  prefijo `pf-`; desde la lista, un cliente `/nuevo/c/<id>` o una oportunidad
  `/nuevo/o/<id>`), editor de líneas COMPARTIDO (`presupuestos/lineas.ts`, ids
  `<prefijo>-lin-*`, catálogo del espejo), plantillas (`/plantillas`, espejo
  `presupuesto_plantillas`; varias se JUNTAN y el mismo concepto suma), imprimible
  (`/<id>/pdf`, vale ya), duplicar, «Convertir en trabajo» (`/<id>/trabajo`) y
  eliminar (solo admin, RLS restrictiva). Las líneas de un presupuesto viven en
  `documento_lineas` (área `trabajos`), así que se escriben SOLO con
  `hub.presupuesto_guardar_lineas` (exige `presupuestos` y deja el `total`);
  el trabajo nace con `hub.trabajo_desde_presupuesto` (exige `trabajos`, copia
  las líneas). Zoho: función `zoho-ventas` (`presupuesto`, `borradores`,
  `factura`, `anadir`; líneas por `_shared/zoho-lineas.ts`, rótulo + detalle y
  artículo del catálogo si está enlazado), 409 con el área de la app.
  Facturar: `#/trabajos/facturar/<id,…>` (`trabajos/facturar.ts`, prefijo
  `ft-`; botón en la ficha y casillas en «Por facturar»), líneas como la app
  (fichajes, artículos o los del presupuesto, materiales) y la sede sin cliente
  se queda con el elegido ANTES de facturar. OJO: en un editor de líneas el
  `change` salta al perder el foco; repintar la tabla ahí rompe el clic que
  viene (se actualizan solo subtotal y total). La ficha del trabajo se abre por
  número o por id. Arnés `verify-presupuestos-escritura.mjs`.
- **Presupuestos** (`src/modulos/presupuestos/`, `#/presupuestos`, 2026-10-02):
  ya no es un enlace. Cifras (abiertos, enviados sin respuesta más de una
  semana —el mismo umbral que el aviso del puesto de mando—, aceptado y tasa de 12 meses),
  barras de importe por estado (una serie, `--serie-1`; la barra filtra) y
  ficha con sus `documento_lineas` y los trabajos que salieron de él. Espejo en
  SOLO LECTURA (área `presupuestos`); se crean y se mandan a Zoho en la app.
  Arnés `verify-presupuestos.mjs`.
- **Mantenimientos** (`src/modulos/mantenimientos/`, `#/mantenimientos`,
  2026-10-02): la cartera de sedes con plan en SOLO LECTURA (área `clientes`).
  «Quién cobra» y la cuota NETA siguen las reglas de `mant-estados.js` de la app
  (`sedeEnZoho`, `netoSede`; el bruto heredado de Zoho se divide por el IGIC
  del 7 %, que `mant_config` no viaja): si cambian allí, cambiarlas aquí. Euros
  y deuda solo para admins. Arnés `verify-mantenimientos.mjs`.
  Desde el 2026-10-04 (paridad bloque 4, tanda 1, PREPARADO para el corte) con
  las pestañas de la app: Resumen, Locales (tabla maestra; certificado, copia y
  control horario se editan en la fila), ficha de cada sede (`ficha.ts`, `fm-`,
  teléfonos con rol), Checklist (tareas del plan por periodo), Seguimiento
  (`mse-`), Plantillas (planes SOLO admin y por NOMBRE —las sedes lo llevan
  así, no se renombra—, sus tareas y checklists de visita) y «+ Contrato»
  (`alta.ts`, `mal-`: a una sede con `stripe_subscription_id` NO se le tocan
  plan, cuota ni frecuencia; eso es «Cambiar plan» de Cobros). Área
  `mantenimiento` (`20261024_mantenimiento.sql`); las reglas de
  `mant-estados.js` en `datos.ts` (compara `estado_pago` SIN acentos: Stripe
  escribe «Ultimo aviso»). El checklist de la visita va en la ficha del
  trabajo (`trabajos/checklist-visita.ts`, `tcv-`, `checklist_respuestas` en
  el área `trabajos`). Arnés `verify-mantenimientos-escritura.mjs`.
- **Contratos de mantenimiento** (paridad bloque 4, tanda 2, 2026-10-04,
  PREPARADO para el corte): `#/mantenimientos/documentos` (`documentos.ts`,
  `mdo-`) y `#/mantenimientos/contrato/nuevo[/<sede>]`, `/<id>`, `/<id>/enlace`,
  `/<id>/ver` (`contrato.ts`, `mco-`). El documento es el de la app copiado
  LITERAL (`contrato-doc.ts`: `CONTRATO_BOILERPLATE` + `renderContratoDoc`; si
  cambia allí, cambiarlo aquí). Pendiente = se cambia todo y se rehace el
  documento; firmado = solo sede, cliente y contacto. Importe vacío: al generar
  = el del plan; al editar = sin cuota. La renovación NO se guarda: es el
  aniversario de `fecha_inicio`, que pone la base al firmar
  (`renovacionDe` en `datos.ts`). Firma pública: `contrato.html?token=` (otra
  entrada de Vite, `src/contrato/`) + función `firma-contrato` (SIN_JWT, por el
  token; sin el área del hub contesta 409); al firmar baja plan, cuota NETA y
  frecuencia a la sede salvo que ya se cobre. El pago tras firmar (`pagar`)
  usa el alta de Stripe del cobro (abajo), solo tras el corte. `sync-app` repasa tablas sueltas con
  `{ modo: 'completo', tablas: [...] }` (así entra una tabla auditada nueva).
  Arnés `verify-contratos.mjs`.
- **Cobro del mantenimiento** (paridad bloque 4, tanda 3, 2026-10-04,
  PREPARADO Y SIN CONECTAR, decisión de Fran): `#/mantenimientos/cobros`
  (`cobros.ts`, solo admin; `/sede/<id>`, `/cambiar/<id>`, `/abonar/<id>`,
  `/ajustes`) y las funciones `stripe-suscripcion` (admin) y `stripe-webhook`
  (SIN_JWT, firma de Stripe), portadas de la app CASI LITERAL: hablan con la
  base por `dbHub()` de `_shared/sb-hub.ts` (supabase-js sobre `hub`; OJO, sin
  «embeds»: el espejo no tiene claves foráneas, la sede y su cliente se leen
  aparte) y con Zoho por `_shared/zoho-ctx.ts` (el Zoho propio del hub). Con
  el área `mantenimiento` de la app NO hacen nada (409 / el webhook contesta
  200 sin tocar): cobra y factura la app, y el webhook del hub NO se registra
  en Stripe hasta el corte (PENDIENTE_FRAN §8 bis), o habría dos facturas por
  cuota. Las series MANT-/ABONO- solo salen de `hub.siguiente_numero_*()` (que
  exigen el área) y sus contadores son espejo, para seguir la numeración de
  la app. Arreglado al portar: el import que rompía «Emitir en Zoho», la
  frecuencia sin normalizar en «Cambiar plan» y la forma de pago
  («Stripe <frecuencia>»). Arnés `verify-cobros.mjs`.
  La cartera vieja de Zoho Billing (tanda 4, `20261027_zoho_cartera.sql`):
  función `zoho-cartera` (SIN_JWT: token del cron o persona del hub) que junta
  las tres de la app — `comprobar` una sede, `listar` las suscripciones de un
  cliente, `vincular` (admin) y `diario` (pg_cron 4:10 UTC). Hacia Zoho, solo
  lectura; en la sede escribe SOLO con `locales` y `mant_facturas` del hub
  (antes devuelve lo que dice Zoho con `guardado: false`: lo guarda la app).
  «Esa suscripción no existe» desvincula la sede (`camposZohoBorrada`, la deuda
  se queda) y las sedes con Stripe no se tocan. En el front: «Comprobar en
  Zoho» en Cobros (vale ya) y «Zoho Billing» en la pestaña Sedes del cliente
  (`mantenimientos/zoho-billing.ts`, `czb-`). El enlace a una suscripción sale
  de `urlZohoBilling()` de `datos.ts`.
- **Inventario** (`src/modulos/inventario/`, `#/inventario`, 2026-10-02): el
  stock POR UBICACIÓN (furgonetas, tienda) y «Todas» sumando el mismo producto
  por `catalogo_id` o por nombre (la regla de «Total» de `furgonetas.js`), el
  libro de movimientos (`#/inventario/movimientos`; llegan cada noche) y la
  ficha del producto. Espejo en SOLO LECTURA (área `inventario`); lo agregado
  por material y «qué pedir» siguen en `#/almacen`. Arnés `verify-inventario.mjs`.
  Desde el 2026-10-05 (paridad bloque 7, tanda 1) con escritura PREPARADA para
  el corte (`inventario/escritura.ts`, `inw-`): `#/inventario/nuevo[/<ubic>]`,
  `/<id>/editar`, `/<id>/mover`, `/vehiculo`, `/albaran` e `/importar`. El
  stock NUNCA se toca a secas: todo va por `hub.inventario_guardar`,
  `_mover` y `_entradas` (`20261031_inventario.sql`, exigen el área), que
  apuntan el movimiento a nombre de quien lo hace y enlazan (o crean) la ficha
  del catálogo (`hub.inventario_catalogo`, la regla de
  `syncInventarioACatalogo`). Albarán = Claude lee en `gastos-ocr`
  (`accion: 'albaran'`, no guarda nada) y lo que ya está por nombre SUMA;
  Excel = CSV (`leerCsv` de `ui/csv.ts`), cada fila un alta, como la app. Tras
  escribir se dispara `hub:inventario` para que la vista relea. Arnés
  `verify-inventario-escritura.mjs`.
- **Sistema común de pantallas** (2026-10-04): el bloque «Sistema común» al
  final de `src/estilo.css` da a TODAS las pantallas el acabado del modo
  escritorio (cabecera de cristal, botones, tablas con cabecera en versalitas y
  pie de totales, `.segmentado` en píldora, `.di-cifra` con rótulo pequeño,
  `p.vacio` con hexágono hueco, columna vacía de tablero `p.vacio.col-vacia`,
  barra `.pr-barra` con campos alineada a la izquierda). Una pantalla nueva usa
  esas clases y no se pinta las suyas. Cabecera de pantalla = `.pantalla-cab`
  con el hexágono de su módulo (`iconoHex`, el del dock) y el menú lateral
  también; los iconos de línea salen de `src/shell/linea.ts`: `svgLinea` en
  el cromo y `ico('nombre')` (1 em, color del texto, nombres tipados
  `IconoLinea`) en el CONTENIDO. Nada de emojis en ninguna pantalla
  (2026-10-05): donde no cabe HTML (`<option>`, `title`, toast, CSV, texto
  que sale a Telegram/WhatsApp) va el texto solo; los emojis que escribe una
  persona (icono de una página de la wiki o de una plantilla) son datos y se
  respetan. El `icono` del contrato `Modulo` ya no se pinta (paleta, baldosas y
  lanzador usan `iconoHex`). Icono nuevo = su trazo en `ICONOS`. Los grupos del puesto de mando
  usan `AVISO_PANTALLA` (en `direccion/`, compartido con el centro de avisos).
  Para repasar el aspecto de todo: `verify-galeria.mjs` (captura de cada
  pantalla del menú; `GALERIA_NOCHE=1`, `GALERIA_MOVIL=1`, `GALERIA=a,b`).
- **Barras de una serie**: `src/ui/barras.ts` (tabla de verdad, `--serie-1`,
  etiqueta directa, la fila filtra con su `data-action` y la `activa` lleva el
  hexágono). `.chip.aviso` es una
  píldora; la CIFRA en ámbar es `.di-cifra.atento` (nunca `.aviso`, que es caja).
- **Dock estilo macOS** (`src/shell/dock.ts`, `src/shell/iconos.ts`,
  `20261022_dock.sql`, 2026-10-03, diseño «Dock del hub»): aumento bajo el
  puntero (coseno, medido sobre el dock EN REPOSO para que no tiemble), nombre
  encima, rebote al abrir una ventana nueva y punto en lo abierto. Fijas POR
  PERSONA en `hub.dock_fijas` (una fila, `modulos` en orden, RLS «propia»;
  copia en `localStorage.hub_dock_<usuario>` para pintar al instante; sin fila,
  las 12 primeras). Tres gestos: clic derecho → Mantener/Quitar (también en
  «Todas»), arrastrar desde «Todas» o dentro del dock (ordena) y sacar hacia
  arriba (quita). Panel, Oki, Claude y «Todas» van siempre. Iconos: SVG de
  línea duotono en hexágono (`iconoHex(id)`), colores por CSS (`.os-ico-*`);
  pantalla nueva = su dibujo en `DIBUJOS` (si no, sale su inicial). OJO: tras
  un arrastre el clic que sigue se descarta, pero solo en ese mismo turno (si
  no llega, no puede quedarse esperando al siguiente). Aspecto (2026-10-04):
  bandeja de cristal, iconos con relieve que se hunden al pulsar, hexágono
  pequeño debajo (verde = delante, hueco = minimizada), nombre con flecha y
  menú del clic derecho con estado y acciones (Abrir/Traer delante o
  Minimizar, Cerrar, Mantener/Quitar; con él abierto el dock vuelve al reposo).
  INSIGNIAS: el `contador()` de cada pantalla del dock (al pintar y cada
  3 min); solo si su tono es `aviso`/`mal`, como un hexágono ámbar/rojo SIN
  número (el valor no siempre es «lo pendiente»), y el nombre lo cuenta.
  Arnés `verify-dock.mjs`.
- **Widgets movibles** del modo escritorio: se arrastran por cualquier punto
  que no sea un enlace o botón; al mover el primero se congela el sitio de
  todos (`Escritorio.widgets`, por escritorio, en la misma disposición de
  `localStorage`) y «Recolocar los widgets» (menú del avatar) vuelve a la
  rejilla. La rejilla NO son columnas CSS (mandaban el sobrante a una columna
  invisible): la reparte `rejillaWidgets` en JS (columnas seguidas en orden,
  cortadas donde la más alta queda más baja, de nuevo al cambiar de alto un
  widget) y si no cabe el panel hace scroll. Aspecto (2026-10-04): cabecera con
  el icono hexagonal de su pantalla (`cabWidget`), pie con flecha, asa al
  pasar y entrada escalonada SOLO en opacidad (los arneses miden las cajas).
- **Portada de Oki** (`src/modulos/inicio/vista.ts`, `src/oki.css`,
  2026-10-02): Inicio es el centro de mando de Oki (diseño del lienzo «Oki ·
  Centro de mando», tablero «Flujo de Oki en blanco»): Oki en el centro unido
  por circuitos a seis áreas, cada una con el `contador()` de SU pantalla
  (`AREAS`; WhatsApp sale de la función), estadísticas del Desk de la semana
  (SLA de respuesta de 30 días, cerrados por día), «Oki dice» y «Necesita a una
  persona» desde `panorama_direccion` y, debajo, las baldosas de siempre. El
  diagrama es un lienzo de 860 × 620 que escala por `cqw`. Sin colores fuera de
  los tokens; el movimiento se apaga con `prefers-reduced-motion`. El menú
  lateral se anima desde `oki.css`. Arnés `verify-oki.mjs`. Desde el
  2026-10-03 lleva el resto del tablero: cabecera con «Estado» (última pasada
  buena de `sync_estado`) y campana de avisos, «Voz de Oki» y órdenes rápidas
  (columna a la izquierda solo si la portada pasa de 1250 px; si no, en fila
  arriba), «Trabajos completados» (completados cuyo fichaje acabó esta semana:
  la app no guarda cuándo se completa), «Sí, contéstalo» cuando lo más urgente
  es un ticket (`#/tickets/<n>/responder`: la función `oki` lo redacta y una
  persona lo manda) y el pie con «Hablar con Oki» y el repaso de la mañana
  (`informes-enviar`, `vista_previa`). La voz (`grabarYTranscribir` de
  `ui/dictado.ts`): lo que suena a pregunta (`esPregunta`) va a `#/buscar`; un
  encargo se reparte como comanda SOLO tras confirmarlo (avisa al equipo). OJO:
  el despachador desactiva el botón mientras dura una acción asíncrona; una
  acción que espera a que la persona vuelva a pulsar (grabar) tiene que volver
  al momento y seguir aparte.
  **Centro de mando** (2026-10-04, a imagen del puesto de mando que mandó
  Fran, en VERDE y hexágonos, no en azul): la portada ocupa todo el ancho
  (`.principal:has(.ok-portada)`), barra de mando arriba (marca OKI, «Estado
  del sistema», reloj con segundos, Buscar, campana y operador) y rejilla de
  SEIS pistas a partir de 1100 px de contenedor (`.ok-cuerpo`, por
  `grid-template-areas`): núcleo y voz | Oki | avisos en vivo; «Oki dice»;
  agentes | hoy en la agenda | órdenes; monitor del Desk | memoria |
  conexiones. En el móvil, una columna en otro orden (las areas mandan).
  Paneles nuevos, todos de SOLO LECTURA y que se degradan a «—» si algo no se
  puede leer: NÚCLEO (`ok-nuc-*`: sync, documentos indexados, voz, peticiones
  a Claude, conexiones, avisos graves), AVISOS EN VIVO (`panorama_direccion`
  con insignia Urgente · Atento · Para saber; los informativos van detrás),
  AGENTES (`ok-ag-*`, `data-estado` activo | espera | reposo | mal: la onda
  solo se mueve en activo; sincronizador = `sync_estado`, trabajador de Claude
  = `claude_peticiones`, vigía = `rmm_equipos`, indexador = `documentos`, bot =
  `informes_programados`/`telegram_vinculos`, oído = `puedeDictar()`), HOY EN
  LA AGENDA (bloques de hoy del espejo `agenda`, mismo filtro que el contador
  del calendario; Hecho · Ahora · En X min), MEMORIA (constelación de
  documentos indexados por día, 14 días, y cifras: documentos, fragmentos sumados
  de `documentos.fragmentos` porque `documentos_fragmentos` no se lee desde el
  front, wiki, proyectos abiertos, comandas hechas) y CONEXIONES (`ok-cx-*`: app
  por `sync_estado.audit`, Zoho/correo/Drive por sus claves de `sync_estado`,
  Breeze por `rmm_equipos`, WhatsApp y Claude por la acción `estado` de la
  función `whatsapp`, Telegram por `telegram_vinculos`). Un agente o conexión
  nuevos: una entrada en `AGENTES`/`CONEXIONES`, su icono en `ICO` y su
  `ponAgente`/`ponConexion` en la función que lea el dato. El título y el
  párrafo del shell se esconden en la portada a partir de 1340 px (la barra
  ya lleva la marca). Los arneses que midan la portada: `.ok-ph-n` ya no es
  `nowrap` (en 390 px desbordaba 2 px).
- **Chat de WhatsApp fijo** (`src/shell/whatsapp.ts`, función `whatsapp`,
  2026-10-02, con el OK de Fran a escribir en la app para esto): ventana abajo a
  la derecha en TODAS las pantallas, plegada al entrar. Las conversaciones son
  de la APP (`wa_conversaciones`/`wa_mensajes`, las recibe su webhook): la
  función las LEE con la service key de la app y, al contestar, manda a Meta con
  `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` (secrets del hub, los mismos que
  la app; `_shared/whatsapp.ts` portado) y APUNTA como `guardarSaliente` de la
  app: insert en `wa_mensajes`, `ultimo_mensaje*` y `sin_leer` en
  `wa_conversaciones`. Son las ÚNICAS escrituras del hub en `okcomputer`; nada
  más se le escribe. El comentario del ticket va a `hub.ticket_comentarios`
  (`tipo = respuesta`, canal whatsapp). Regla de Meta: texto libre solo dentro
  de las 24 h desde el último mensaje del CLIENTE (la caja se bloquea fuera).
  Oki PROPONE (`proponer`, Claude) y una
  persona manda. Si cambian las tablas `wa_*` de la app, cambiar la función.
  Fuera de las 24 h, «📨 Mandar plantilla» manda `WHATSAPP_PLANTILLA_TEXTO`
  (plantilla de Meta con UNA variable, `{{1}}` = nombre) y se apunta como
  `tipo = template`, igual que las de la app.
  Desde el 2026-10-04 (paridad bloque 5, tanda 1) con la cabecera de la
  bandeja de la app: fila de enlaces rápidos (`#wa-atajos`: Cliente, Sede con
  el chip del plan del espejo, 🖥 Remoto con `remotosDe`/`abrirRemoto` de
  `sitios/equipamiento.ts`, 🎫 Ticket, 📄 Presupuesto `#/presupuestos/nuevo/l/<sede>`
  y 📎 Factura / presupuesto: `enviar_documento` baja el PDF de Zoho, SOLO de
  documentos de ese cliente, y fuera de 24 h usa `WHATSAPP_PLANTILLA_DOCUMENTO`),
  panel `#wa-panel` para elegir, fotos en la conversación y «Ver foto» (`media`,
  por el id del MENSAJE, nunca un media_id suelto). Un alta que llega rellena
  desde otra pantalla va por `dejarBorrador` / `tomarBorrador` de
  `src/ui/borrador.ts` (ticket y trabajo; se gasta al tomarlo). «Desde
  WhatsApp» (`#/tickets/whatsapp`, `tickets/whatsapp.ts`, `wai-`): pegado o
  captura → `parse-whatsapp` (portada literal, Groq; prompt en
  `_shared/whatsapp-clasificar.ts`, el mismo del webhook) → sede/cliente/contacto
  por teléfono o nombre (`buscarCandidatos` de la app sobre el espejo) → alta
  rellena; sin IA, `analisisDeReserva`. Arnés `verify-whatsapp.mjs`.
  Tanda 2 (mismo día): el WEBHOOK, PREPARADO Y SIN CONECTAR (decisión de
  Fran). `whatsapp-webhook` (SIN_JWT, firma `X-Hub-Signature-256`) + `equipo.ts`,
  portados de la app sobre `dbHub`; con el área `whatsapp` de la app no hace
  NADA (Meta sigue llamando a la app). Espejos `hub.wa_conversaciones` /
  `hub.wa_mensajes` (área `whatsapp`, nocturna), `hub.ticket_adjuntos` (área
  `tickets`, altas de la app por el sync; la ficha del ticket los lista),
  `usuarios.telefono` (un WhatsApp del EQUIPO va a las órdenes internas),
  `hub.wa_buscar_por_telefono` / `hub.wa_locales_autorizados` (últimos 9
  dígitos) y cubos públicos `whatsapp-adjuntos` y `trabajo-fotos`
  (`20261028_whatsapp.sql`). `_shared/whatsapp-app.ts` es la ÚNICA manera de
  abrir la conversación de un teléfono, apuntar lo enviado o mandar un PDF de
  Zoho; los avisos a admins van por Telegram. Las órdenes del equipo que
  escriben en áreas aún de la app lo DICEN y no escriben (`delHub`); el fichaje
  va por `hub.reloj_fichar` (la misma `hub.fichar`). La función `whatsapp`
  cambia de fuente sola (`fuente()`: app o hub según el área; en el hub, sin
  «embeds», `leerConvs` junta los nombres aparte). El corte:
  `supabase/cortes/corte_whatsapp.sql` y la URL en Meta, en ese orden
  (PENDIENTE_FRAN §1 quinquies). Tanda 3: `meta-agente-mcp` (SIN_JWT,
  `x-mcp-token`) portado con sus skills LITERALES (`_shared/meta-agente-skills.ts`;
  si cambian en la app, cambiarlas aquí); sin el área del hub sus herramientas
  contestan que no está activo. El alta del conector en Meta es la acción
  `meta_conector` de la función `whatsapp` (admin, «🤖 Agente de Meta» al pie de
  la lista de la ventana), que solo deja registrar con el cambio hecho (lo
  apunta a la URL del hub); `meta_conector_estado` dice a dónde apunta.
- **Trabajos: alta y edición** (`src/modulos/trabajos/formulario.ts`,
  2026-10-03, paridad bloque 1): UN formulario para crear y editar
  (`#/trabajos/nuevo`, `#/trabajos/<n>/editar`, prefijo `tf-`) con caras Simple
  y Completa (`.tf-completa`; el móvil arranca en Simple y lo elegido se
  recuerda). Al añadir un campo, decidir si es `.tf-completa`. El estado
  SIEMPRE va por `hub.trabajo_estado` (que exige fichaje para completar, cierra
  los tickets del trabajo y tras el que se propone «Para facturar»), nunca en
  el PATCH. La fecha del trabajo crea o mueve su bloque por
  `hub.trabajo_espejo_agenda` (y la agenda devuelve la del primer bloque),
  disparadores que se apartan mientras la agenda sea de la app o escriba el
  sync (`hub.espejo_agenda_activo()`). Arnés `verify-trabajos.mjs`.
- **Calendario planificador** (`src/modulos/calendario/`, 2026-10-03, paridad
  bloque 1): las reglas del calendario de la app viven en `motor.ts`, puro y sin
  DOM (solapes por técnico con nombre de pila, traslados a 40 km/h × 1,3 + 5 min
  y 30 min sin coordenadas, carga de 8 h por técnico, «Sugerir hueco» en 14
  días de 9 a 19): si cambian en la app, cambiarlas ahí. Vistas Semana · Día
  (rejilla por técnico; soltar en otra columna reasigna) · Por técnico ·
  Agenda (la del móvil) · Mes. PLANIFICAR escribe la fecha en el trabajo y el
  bloque lo crea la base; mover/reasignar va por `hub.agenda_mover`. Citas
  sueltas y días de un trabajo: `cita.ts` (`#/calendario/cita`,
  `#/calendario/dia/<trabajo>` y `dia/b:<bloque>`). Arnés `verify-calendario.mjs`.
- **Firma, parte y plantillas de trabajo** (2026-10-03, paridad bloque 1):
  la firma es un lienzo a pantalla completa (`trabajos/firma.ts`, prefijo
  `fc-`, eventos de puntero enganchados al lienzo) que guarda PNG en data URL
  en `trabajos.firma_cliente`, como la app. El parte (`#/trabajos/<n>/parte`)
  es una página «Imprimir o guardar en PDF» (sin librería de PDF; empresa de
  `hub.config.facturacion_emisor`, IGIC 7 %); al imprimir, `.tr-parte` va con
  `top/left/right` y NUNCA `inset: 0`, que lo corta al alto de la ventana.
  Plantillas: `#/trabajos/plantillas` (prefijo `tp-`), espejo en el área
  `trabajos`; eliminar = `activa = false`. Arnés `verify-parte.mjs`.
- **Tablero y chat por ficha** (2026-10-03, paridad bloque 1): `#/tablero`
  (prefijo `tb-`) sobre el espejo `tablero_notas` (área `conocimiento`); todos
  ven todas y se escriben SOLO las propias (`user_id` = id en usuarios, RLS
  «propias»). Dictar en un campo: `alternarDictado(boton, campoId)` de
  `src/ui/dictado.ts` (función `comandas`, acción `transcribir`). Chat por
  ficha: `botonChatFicha(tipo, id, título, ruta)` de `src/ui/chat-ficha.ts` →
  `hub.chat_ficha` (canal `tipo = 'ficha'`, uno por ficha, apunta a quien
  entra). `chat_resumen` NO cambia de forma (la 20261016 la redefine): la ruta
  de vuelta se lee del canal abierto. Arnés `verify-tablero.mjs`.
- **Lista del día** (`src/modulos/lista-dia/`, `#/lista-dia`, 2026-10-03,
  paridad bloque 1): espejo de `lista_dia` (área propia, dueño `app`); una fila
  = una cosa de UNA persona para UN día, `usuario` por NOMBRE. Meterla en la
  lista de alguien es ASIGNÁRSELA (al trabajo se le AÑADE el técnico; tarea y
  ticket cambian de `tecnico_id`); marcar va SIEMPRE por `hub.lista_dia_marcar`
  (cierra el origen guardando `estado_previo`; trabajo y tarea sin fichaje se
  marcan en la lista y no se cierran). `anadirALista()` es la única entrada
  (pantalla y casilla del alta de trabajo). «Planificar» (`#/lista-dia/planificar`)
  mueve fecha Y hora del trabajo juntas. Arnés `verify-lista-dia.mjs`.
- **Reloj** (`reloj/`, `#/reloj`, función `reloj`, `20261017_reloj.sql`,
  2026-10-02): app Wear OS (Galaxy Watch) con tile, complicación y app
  (avisos, mi día, RMM, cifras, fichar, comanda dictada). Se vincula con un
  código corto que se teclea en `#/reloj` (token `okr_…`, solo su huella en
  la base). Fichar va por `hub.reloj_fichar` → la MISMA `hub.fichar`. El APK
  lo compila `reloj-apk.yml` y desde `main` lo publica como versión
  `reloj-<n>`; aquí no hay SDK de Android (dl.google.com bloqueado). El
  `resumen` es un contrato con relojes ya instalados: se añaden campos, no se
  quitan. Detalle e instalación en `docs/RELOJ.md`.
- **Usuarios, modo empleado y registro de cambios** (paridad bloque 6 HECHO,
  tanda 1, 2026-10-04): `#/usuarios` (`usuarios/`, `us-`, admin; PREPARADO para el
  corte del área `usuarios`: alta, rol, teléfono y activar, nunca a uno mismo).
  Modo empleado = `core/empleado.ts` (`MENU_EMPLEADO`): quien NO es admin ve el
  menú del técnico (lo filtra `visibles()`; es solo interfaz, la URL sigue
  abriendo, como la app) y en el móvil entra a `#/hoy`. Pantalla nueva que deba
  ver un técnico: añadir su id a `MENU_EMPLEADO`. Registro de cambios:
  `#/registro` y `#/registro/<tabla>/<id>` (`registro/`, `rg-`, admin) sobre la
  función `historial`, que junta `hub.auditoria` y el `audit_log` de la app
  (LEÍDO con su service key, `_shared/app-lectura.ts`: consultas pequeñas, nunca
  tablas enteras); en las fichas, `enlaceHistorial(tabla, id)` de
  `src/ui/historial.ts`. Arnés `verify-sistema.mjs`.
  Tanda 2: aviso de versión (`shell/version.ts`, lee `version.json` del build;
  `buildActual()`), F5 guarda (`shell/atajos.ts`: el formulario con el foco o el
  ÚNICO visible de la pantalla de delante; si no, recarga), tamaño del texto en
  el móvil (`shell/texto.ts`, `html[data-fs]` agranda la letra raíz: lo nuevo,
  en rem), `public/privacidad.html` (copia LITERAL de la app) y `#/configuracion`
  (`cfg-`, admin; en `hub.config`: la empresa es la MISMA `facturacion_emisor`
  de Facturación, `igic_pct`, `tarifa_sin_mantenimiento`). En el móvil, con el
  menú abierto se esconde la barra de WhatsApp (tapaba su pie).
  Tanda 3: el cliente de datos (`core/api.ts`) lleva ahora, como la app, (1)
  la COLA sin red (`core/cola.ts`, IndexedDB `hub-local`): las escrituras de
  `TABLAS_OFFLINE` (todas con `id uuid`; un POST lleva su id de cliente ANTES
  del primer intento) y las funciones de `RPCS_OFFLINE` se guardan sin red y
  salen solas (al volver la red, al entrar, cada minuto), FIFO; lo rechazado
  queda en rojo. El fichaje se encola SOLO sin red (no es idempotente) y lleva
  `p_cuando` = la hora de la pulsación (`hub.fichar`, `20261029_fichar_cuando.sql`:
  hasta 72 h atrás, nunca un fin antes del inicio). Cada op lleva su persona:
  con otra en el mismo móvil, no sale. (2) La última copia de las lecturas de
  `LECTURAS_OFFLINE` (`core/lecturas.ts`, por persona, se borra al salir): si
  la red falla se sirve la copia con lo pendiente encima (`aplicarPendientes`;
  las sesiones se recalculan con los fichajes encolados). (3) El DESHACER
  (`core/deshacer.ts`, `registrarObservadorEscrituras`): foto antes de cada
  PATCH/DELETE de su lista `TABLAS`, un gesto = una acción, `sinBorrado` en las
  fichas con hijas; ni RPC ni upserts. `API._raw` es la petición sin nada de
  esto. UI: chips abajo a la izquierda (`shell/pendientes.ts`, `sis-`) y Ctrl+Z
  (`shell/atajos.ts`). OJO en los arneses: guardar ahora hace un GET antes del
  PATCH; esperar a lo que dice la pantalla («Guardado»), no a un valor que ya
  estaba puesto.
  Tanda 4 (2026-10-05): AVISOS PUSH (Web Push con VAPID PROPIO del hub: la
  pública en `config.ts`, la privada en el secret `VAPID_PRIVATE_KEY`).
  `core/push.ts` suscribe y la función `push` (SIN_JWT: sesión o token del
  cron) guarda en `hub.push_suscripciones` a nombre de quien tiene la sesión
  (al entrar se reapunta; las caducadas se borran solas). Mandar un aviso desde
  una función: `avisarPush(usuarioIds, { title, body, tag, url })` de
  `_shared/push.ts` (nunca lanza); va ADEMÁS de Telegram. Avisan las comandas,
  el chat (el front llama `push` `chat` tras enviar; el service worker no lo
  enseña si el hub está a la vista) y los avisos de WhatsApp a admins; el cron
  `hub-push-proximos` (trabajos en ~1 h) no hace nada mientras la agenda sea de
  la app. Botón «🔔 Avisos» al pie del menú y tarjeta en Configuración
  (`shell/avisos-dispositivo.ts`, `av-`, con «Instalar como app»).
  FEEDBACK: `#/feedback` (`feedback/`, `fb-`, todos; en `MENU_EMPLEADO`) sobre
  `hub.feedback` (el autor y el estado inicial los pone la base; gestionar,
  solo admin). Contexto solo: `core/errores.ts` (últimos errores JS y la
  pantalla de antes) y `buildActual()`. «Pasar a Claude» = estado `claude`; el
  trabajador lo toma por el MCP (`feedback_pendientes`/`_tomar`/`_terminar`,
  docs/CLAUDE_TRABAJADOR.md punto 3) y deja `resultado`. Sin GitHub.
- **Tickets completos** (paridad bloque 8, tanda 1, 2026-10-05,
  `20261104_tickets_completos.sql`): en la ficha del ticket, TAREAS (las de la
  app, `hub.tareas.ticket_id`: se ven ya y se crean con el corte de `tareas`),
  DUPLICAR (vale ya), «Crear trabajo desde el ticket» (borrador con
  `ticket_id`: al crear el trabajo, el ticket queda enlazado y cerrado «Pasó a
  trabajo»; solo con el área `trabajos` del hub) y la RESOLUCIÓN A LA WIKI
  (decisión de Fran: una página por ticket, `hub.paginas.ticket_id`, colgada de
  «Resoluciones»; se reindexa). En las alertas de Breeze, «Abrir ticket»
  (`moTicketAlerta`): el enlace vive en `hub.tickets.rmm_alerta_id` (único: una
  alerta, un ticket), porque a Breeze no se le escribe. Código en
  `tickets/extra.ts` (`tkx-`). Arnés `verify-tickets-completos.mjs`.
- **Entrada de ventas** (paridad bloque 8, tanda 3, 2026-10-05, PREPARADA SIN
  CONECTAR, decisión de Fran): funciones `formulario-web` (webs públicas; cada
  web una entrada de `SITIOS` con sus chips, que cuadran al carácter con su
  snippet de `docs/formularios-web/`) y `captar-lead` (comerciales desde
  `public/captacion.html`, con el ID token de Google del cliente OAuth de la
  app), las dos SIN_JWT, portadas literal y que insertan en
  `hub.oportunidades` («Detectado»). Las webs y los comerciales siguen
  mandando a la app hasta que Fran haga PENDIENTE_FRAN §2 quater. Aceptar un
  presupuesto en el portal lo pasa solo a «Aceptado» con el área
  `presupuestos` del hub. Arnés `verify-captacion.mjs`.
- **Guía de instalación, escáner, catálogo y conocimiento** (paridad bloque 8,
  tanda 4, 2026-10-05, PREPARADO para el corte, `20261105_guia_catalogo.sql`):
  la guía del trabajo (`trabajos/guia.ts`, `gi-`; `#/trabajos/<n>/instalacion[/<id>[/paso/<i>[/r]]]`)
  usa `GUIA_TIPOS` COPIADO de la app (`trabajos/guia-tipos.ts`: las claves de
  `instalaciones.datos` son `<tipo>_<paso>_<campo>` y las opciones guardan el
  MISMO valor que la app, «✅ OK», aunque se enseñen sin emoji con
  `textoOpcion`); al finalizar, el resumen a las observaciones, «En progreso»
  por `hub.trabajo_estado` y el equipo a la sede. Escáner: `abrirEscaner(fn)` de
  `src/ui/escaner.ts` (`esc-`). Catálogo: Inventario → «Catálogo»
  (`inventario/catalogo.ts`, `cat-`; RLS restrictiva: solo un admin lo
  escribe, las altas del inventario van por `hub.inventario_catalogo`). Base de
  conocimiento: Wiki → `#/wiki/conocimiento` (`wiki/conocimiento.ts`, `kc-`).
  Arnés `verify-guia-catalogo.mjs`.
- **Avisos del chat** (paridad bloque 8, tanda 5, 2026-10-05): `shell/chat-avisos.ts`
  (`cha-`): `vigilarChat()` (desde `main.ts`) mira `hub.chat_resumen` cada 20 s y
  al volver a la pestaña; con mensajes nuevos de otro suena el tono de la
  conversación (Web Audio, los ocho de la app, o el sonido propio en IndexedDB
  `hub-chat-sonido`), sale un aviso arriba a la derecha y el título lleva
  «(N) » (el shell pone el título con `ponerTitulo`, nunca `document.title` a
  secas). Silenciar y tono por conversación en «Avisos» de la conversación;
  prefs en `localStorage.hub_chat_avisos_<usuario>`. Arnés `verify-chat-avisos.mjs`.
  Backup propio: `.github/workflows/backup.yml` (volcado de `hub`; sin el
  secret `HUB_DB_PASSWORD` avisa y no falla).
- **Asistente de voz** (paridad de `voice.js`/`groq-proxy`, decisiones de Fran
  2026-10-05: Groq como la app y Claude de reserva, micro en la cabecera
  `#voz-btn` + la voz de Oki, las 21 órdenes, confirmar como la app): función
  `voz` (con sesión; el `SYSTEM_PROMPT` de la app COPIADO más `crear_comanda` y
  el aviso de áreas; `accion: 'estado'`), ventana `src/ui/voz.ts` (`vz-`:
  reconocimiento del navegador o grabar + `comandas` `transcribir`, leer en voz
  alta, manos libres solo con reconocimiento) y ejecutor `src/ui/voz-acciones.ts`
  (las reglas de `voice-actions.js`: estados de palabra, local por nombre de
  sede o cliente; sin «embeds»: `sedes()` cachea sedes + clientes). Una acción
  nueva: su texto en el prompt de `voz/index.ts` Y su función aquí
  (`registrarAccionesVoz`), desplegando la función en el mismo rato. Oki:
  con asistente configurado (`asistenteDisponible()`), lo dictado va a él; si
  no, como antes (buscador o comanda). Arnés `verify-voz.mjs`.
  Tanda 2: ÓRDENES DIRECTAS en `src/ui/voz-ordenes.ts` (carga diferida desde
  `ejecutarAccion`): fichar (`hub.fichar`), estados (trabajo SIEMPRE por
  `hub.trabajo_estado`), programar/mover (`hub.agenda_mover`; el técnico se
  AÑADE al trabajo), cita, gasto, nota, descripción y comanda. Se ejecutan sin
  confirmar; antes de escribir en un área, `esDelHub` (si es de la app, lo dice
  con `enLaApp` y no escribe). Arnés `verify-voz-ordenes.mjs`.
- **Paleta Ctrl+K** (`src/shell/buscador.ts`): cuatro modos con Tab
  (Pantallas · Datos · Preguntar · Pedir a Claude). «Preguntar» va a
  `#/buscar/<pregunta>`; «Pedir a Claude» abre la pestaña Claude del proyecto
  elegido (Claude trabaja siempre sobre un proyecto).

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
