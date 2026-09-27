# Plan del sistema unificado de Ok Computer («el hub»)

> Mapa y hoja de ruta para que UNA sola app haga lo que hoy se reparte entre
> la PWA actual (`okcomputerclaude`), **Notion**, **Zoho One** y la web de
> **Breeze** (RMM), y tome las ideas de **OKHUB** (`app.okcomputer.es`, demo
> de otra empresa: ver `docs/referencias/OKHUB_INVENTARIO.md`). Escrito el
> 2026-09-27. Es un documento de decisión: en este repo no hay código de
> ninguna fase todavía.

## 0. Decisiones tomadas

| Decisión | Detalle |
|---|---|
| **El hub nace en este repo (`okcomputerhub`)** | `okcomputerclaude` **no se toca**: sigue desplegándose y usándose igual mientras el hub crece. Nada de lo que se haga aquí abre PRs allí. |
| **Supabase PROPIO, separado del de producción** | El proyecto `okcomputer` (`gaksrtxgnuuuvhvgwxue`) ya va justo de carga y se cae; el desarrollo del hub no puede sumarle nada. El hub usa el proyecto **`okcomputer-hub`** (antes `breeze-rmm`, ref `adomalsxsymxzuozksmt`, eu-west-1, organización en plan Pro), que ya existe y es la base de datos de **Breeze**, el motor RMM. |
| **El hub se encarga también del RMM** | Consola RMM propia dentro del hub, con Breeze solo como motor (agente + servidor) y leído en la misma base. **OKRMM** (`rmm.oksistemas.online`, el primer motor) **se retira**: los equipos que queden pasan al agente de Breeze. |
| **Datos de negocio: copia inicial + sync de solo lectura hasta el corte por área** | Clientes, sedes, trabajos, tickets… se cargan desde el backup nocturno de `okcomputer` y se refrescan con una sincronización incremental ligera; cuando un área pasa al hub, se corta y el hub manda. |
| **Stack: Vite + TypeScript sin framework** | Módulos ES por pantalla, hash-routing `#/ruta`, PWA instalable. Mismo espíritu que la app actual y que OKHUB, para poder **portar** módulos de `okcomputerclaude` cuando toque. |
| **El hub absorbe módulos poco a poco** | Nace con lo nuevo (proyectos, MCP, monitorización, dirección…) y enlaza a la app actual para el resto. Al final la app actual redirige al hub y se apaga. |
| **Sustituir, no integrar** | Notion y las apps de Zoho One (CRM, Desk, Projects, People, Sign, Mail…) se reemplazan por funciones propias. **Zoho Books al final** (fase 11). Notion hoy: pocas páginas sueltas. |
| **Dos piezas imprescindibles, primero** | (1) **Organizador de proyectos y tareas** con el ciclo entero: idea → creación → objetivos → búsqueda de información → roadmap → desarrollo; internos y de cliente; la investigación la hace Claude y queda en el proyecto con fuentes. (2) **MCP para Claude Code** que lea y escriba TODO con tokens con alcance y que el sistema pueda **lanzar a Claude Code** y recoger el resultado. |
| **De OKHUB, todo lo preguntado** | Panel de dirección «qué decidir, ordenado por dinero», comandas, informes programados, bot, cobros con recordatorios, portal de clientes, cliente 360, web conectada + mapa por cobro, MRP + ficha maestra, jornada RD 8/2019 + ausencias + export, gastos OCR + portal del asesor, RAG + envíos. |
| **Canal** | **Telegram** para el equipo y **WhatsApp** para el cliente (Cloud API, con secrets propios en este proyecto). |

## 1. Arquitectura del hub

### 1.1 Repo

```
okcomputerhub/
├─ src/                    Vite + TypeScript, sin framework
│  ├─ main.ts              arranque, router por hash, registro de módulos
│  ├─ core/                auth, api (PostgREST sobre el esquema hub), estado, mensajería
│  ├─ shell/               menú por grupos, baldosas con número en vivo, buscador, tema, tour
│  ├─ modulos/<nombre>/    una carpeta por pantalla (proyectos, monitorizacion, direccion…)
│  └─ ui/                  piezas comunes (modal, kanban, vistas, dictado, editor markdown)
├─ public/                 manifest, iconos, service worker
├─ supabase/
│  ├─ migrations/          fecha_descripcion.sql, SOLO sobre el esquema hub
│  └─ functions/           Deno, con _shared/ propio
├─ scripts/                importar-app.mjs (carga inicial desde el dump), utilidades
├─ .github/workflows/      deploy front (Firebase), deploy funciones, aplicar migración
├─ .claude/                settings.json, skills (verify), commands
├─ .mcp.json               conector MCP del hub para Claude Code
└─ docs/
```

### 1.2 El proyecto Supabase, compartido con Breeze

Lo que hay hoy en `adomalsxsymxzuozksmt` (comprobado el 2026-09-27):

- **Breeze** (lanternops/breeze, Docker en el VPS; repo `okcomputer-rmm` =
  `/opt/breeze`) usa esta base por **Postgres directo**, no por Supabase:
  394 tablas en `public`, 560 MB, métricas cada 5 min (`device_metrics`,
  `metric_rollups_*`), 5 equipos, 119 sites, 107 organizaciones. Roles
  `breeze` (migrador, BYPASSRLS), `breeze_app` (sirve peticiones, con RLS) y
  `breeze_search`; definidos en `okcomputer-rmm/scripts/db-supabase.sql`.
- La **capa Supabase está sin usar**: `auth.users` vacío, ninguna edge
  function, sin `pg_cron`, y la **API REST cerrada sobre `public`** (`anon` y
  `authenticated` no tienen USAGE; migraciones «neutralizar_api_rest…»).
  Extensiones ya instaladas: `vector`, `pg_trgm`, `pgcrypto`, `uuid-ossp`,
  `supabase_vault`.
- Supabase avisa de **16 tablas de Breeze sin RLS** (`breeze_migrations`,
  `device_commands`, `patches`, `permissions`…). No están expuestas porque la
  REST está cerrada sobre `public`, y así tiene que seguir.

**Las seis reglas del proyecto compartido** (también en `CLAUDE.md`):

1. **`public` es de Breeze.** El hub no crea, altera ni concede nada en
   `public`, no expone `public` en la API REST y no toca los roles `breeze`,
   `breeze_app`, `breeze_search` ni `db-supabase.sql`.
2. **Todo lo del hub vive en el esquema `hub`** (`hub.proyectos`,
   `hub.clientes`…): se expone `hub` en PostgREST (Settings → API → schemas
   expuestos), con grants a `authenticated` y `service_role` solo en ese
   esquema, RLS en todas sus tablas y auditoría propia (`hub.auditoria`, con
   un trigger genérico portado de `audit_log` de la app actual).
3. **Leer Breeze, no escribirle.** Vistas `hub.rmm_*` (propiedad de
   `postgres`, que salta la FORCE RLS de Breeze) sobre `public.devices`,
   `sites`, `organizations`, `alerts`, `device_metrics`/`metric_rollups`,
   `device_patches`, `software_inventory`, `remote_sessions`,
   `device_commands`… Cualquier acción sobre un equipo (comando, script,
   sesión remota, acuse de alerta) va por la **API REST de Breeze** desde
   una edge function con usuario de servicio (como hacía `breeze-sync`),
   nunca por UPDATE en `public`.
4. **Migraciones con fecha** (`supabase/migrations/20261001_proyectos.sql`),
   aplicadas a mano con el workflow «Aplicar migración» de este repo (secret
   `HUB_DB_PASSWORD`, transacción con `ON_ERROR_STOP`). Ninguna contiene
   `public.`; el arnés lo comprueba.
5. **Edge functions** en `supabase/functions/<nombre>/index.ts` (sin prefijo:
   el proyecto no tenía ninguna) con `_shared/` propio (`http.ts` CORS + JWT
   de sesión, `mensajeria.ts`, `acciones.ts`). Lista `SIN_JWT` en el workflow
   solo para las que autoriza otra cosa (firma, secret, código de un uso).
6. **Se habilita `pg_cron`** en el proyecto (sincronización, informes).

### 1.3 Auth y usuarios

Supabase Auth del proyecto (hoy vacía): se dan de alta los empleados con el
mismo correo que en la app actual (email/contraseña y Google, con el Client
ID existente del proyecto GCP 508620194342 añadiendo la redirect URL del
hub). `hub.usuarios` (portada de `usuarios`) guarda rol y nombre.

### 1.4 Datos de negocio: copia inicial + sincronización hasta el corte

- Las tablas de negocio se recrean en `hub` por migraciones del hub con
  **los mismos nombres de columnas** que en `okcomputer`: así el sync es
  columna a columna y el porte de cada módulo no cambia consultas.
- **Carga inicial**: `scripts/importar-app.mjs` toma el backup nocturno de
  `okcomputer` (`pg_dump -Fc --schema=public`, workflow `backup.yml`), lo
  pasa a SQL plano (`pg_restore -f`), renombra `public.` → `app_import.`,
  lo carga en el esquema temporal `app_import` del hub, vuelca a `hub.*` y
  borra `app_import`. Repetible; no toca la base viva de producción.
- **Sync**: edge function `sync-app` lanzada por `pg_cron` cada 15 min:
  lectura incremental del PostgREST de `okcomputer` (service key guardada en
  el Vault, filtro `updated_at > último corte` por tabla; las tablas sin
  `updated_at`, una pasada nocturna), escritura en `hub.*`. Solo deltas: la
  carga sobre producción es mínima. Un sync que falla no mueve el corte.
- **Corte por área**: tabla `hub.areas` (área, dueño `app` | `hub`, fecha).
  Mientras el dueño sea `app`, el hub enseña esa área en solo lectura y el
  sync la refresca; al cortar, el hub manda, el sync la salta y en la app
  actual deja de usarse esa pantalla (regla de equipo, sin tocar su código).
  Ninguna escritura del hub sobre un área cuyo dueño sea `app`.

### 1.5 Frontend, dominio y convivencia

- **Firebase Hosting**: sitio nuevo en el mismo proyecto de Firebase (el id
  `okcomputerhub` ya lo usa el redirect del dominio antiguo; otro id, p. ej.
  `okhub-tenerife`) y dominio propio (p. ej. `hub.okcomputertenerife.com`).
  `app.okcomputer.es` es de otra empresa.
- Cada pantalla que el hub aún no tiene es un **enlace a la app actual**
  (`https://okcomputertenerife.web.app`). Son dos orígenes y dos Auth: se
  entra dos veces mientras convivan.
- **Portar, no reescribir a ciegas**: los módulos de `okcomputerclaude`
  (`public/js/modules/*.js`) y su `_shared/*.ts` se copian aquí cuando les
  toque, pasándolos a TypeScript y conservando sus reglas de negocio.

## 2. Mapa de cobertura

**Fase** = en cuál se cierra el hueco; **Vive en el hub desde** = cuándo el hub
pasa a ser el dueño del área (corte en `hub.areas`).

| Área | Ya en la app actual | Referencia | Hueco | Fase | Vive en el hub desde |
|---|---|---|---|---|---|
| **Proyectos (ciclo completo)** | `tareas`, `lista_dia`, `trabajos`, `agenda`, `tablero_notas` | Notion, Zoho Projects | Entidad `proyectos` con fases idea → objetivos → investigación → roadmap → desarrollo, objetivos, páginas de investigación con fuentes, hitos, tablero de tareas, coste real | **1** | 1 (nuevo) |
| **MCP completo** | `mcp-server` (10 herramientas, un token, escrituras solo ticket/tarea) | — | Escritura sobre todo el sistema con tokens con alcance y auditoría; lanzar Claude Code y recoger resultados | **1** | 1 (nuevo) |
| **Monitorización (RMM)** | Pestaña Monitor. sobre `rmm_*` rellenadas por `breeze-sync`/`breeze-hook` (Breeze) y `rmm-agente` (OKRMM); color RMM en Sitios y Mapa | Breeze (motor), OKHUB Sistemas | Consola propia sobre las tablas de Breeze en la misma base: sedes con estado, equipos, alertas → tickets, parches, software (versión TPV), comandos/scripts, remoto; OKRMM se retira | **2** | 2 (se porta Monitor.; `breeze-sync`, `breeze-hook`, `rmm_*` y `rmm-agente` quedan sin uso) |
| Panel de dirección | `dashboard`, `informes`, `os/avisos.js` | OKHUB Panel de dirección | Tarjetas de dinero, avisos accionables por importe, ventas 12 meses, margen por familia, cuentas grandes, «lo último» | 3 | 3 |
| Bot + informes programados | `asistente` (apagado), repaso matinal (Routine), push | OKHUB Asistente + Informes | Bot Telegram, informes con hora/días/destinatarios/regla y «Enviar ahora», alta en lenguaje natural | 3 | 3 |
| Cliente 360 + CRM | `clientes`, `contactos`, `oportunidades`, `captar-lead` | Zoho CRM, OKHUB Clientes | `actividades` con línea de tiempo, clase A/B/C, «lo siguiente», pipelines configurables, previsión | 4 | 4 (clientes, contactos, sitios, oportunidades, mapa) |
| Cobros | `facturas.js` (Zoho en vivo), `mant_facturas` | OKHUB Cobros | Deuda por cliente, recordatorios automáticos, Recordar/Cobrada | 4 | 4 (la parte Stripe sigue en la app hasta la 11) |
| Web conectada + mapa | `captacion.html`, `whatsapp-webhook`, `mapa.js` | OKHUB Tu web + Mapa | Leads con dueño, catálogo con stock real, capa de mapa por cobro | 4 | 4 |
| Wiki + RAG | `conocimiento`, `tablero_notas` | Notion, OKHUB Buscador | Páginas jerárquicas con versiones; índice Drive + wiki con respuestas citando fuente (`vector` ya instalado) | 5 | 5 (conocimiento, tablero) |
| Desk | `tickets`, WhatsApp → ticket, RMM → ticket | Zoho Desk | SLA, respuestas predefinidas, correo → ticket, satisfacción | 6 | 6 (tickets, bandeja WhatsApp) |
| Portal de clientes | portal Stripe, `firma.html` | OKHUB Portal | Tickets, presupuestos, facturas, contratos, «lo de siempre», seguimiento | 7 | 7 (nuevo) |
| Comandas | voz crea tareas de una en una | OKHUB Comandas | Audio → N tareas asignadas, tablero por persona | 8 | 8 (tareas, lista del día) |
| Almacén / MRP / envíos | `furgoneta_*`, `catalogo`, `proveedores`, `pedidos_compra` | OKHUB Maestro, Inventario, MRP, Envíos | Mínimo/cobertura, consumo semanal, «se agota en N días», sugerencias por proveedor, en camino; envíos | 9 | 9 (inventario, catálogo, proveedores, compras) |
| People / Admin / Sign | `usuarios`, `sesiones`, `gastos`, `firma-contrato` | Zoho People / Sign, OKHUB Fichajes, Gastos, Portal asesor | Jornada RD 8/2019, ausencias, OCR, cierre mensual y accesos de la gestoría, firma de documentos | 10 | 10 (usuarios, fichaje, gastos, contratos/firma) |
| Facturación | Todo en Zoho Books (15 funciones) | Zoho Books | Facturas propias, series, IGIC, Verifactu, PDF, cobros, export contable | 11 | 11 (presupuestos, facturas, mantenimiento Stripe) |
| Trabajos, calendario, chat, modo calle, APK | Completo en la app actual | — | Nada que sustituir; lo más grande y lo que más usan los técnicos | Final | Final; entonces la app actual redirige al hub |
| Fuera (por ahora) | — | OKHUB Cámaras/NVR, Flota GPS, Conexiones ERP | No se copia | — | — |

## 3. Fases

Cada fase es desplegable sola, con su migración sobre `hub`, sus funciones,
su arnés y su nota en `CLAUDE.md`. Estimaciones orientativas (semanas de una
persona con Claude Code). «Se porta» = migración de sus tablas a `hub` (ya
cargadas por el sync), corte del área en `hub.areas` y pantalla en el hub.

### Fase 0 · Cimientos (2 semanas)

- Proyecto Supabase: renombrar a `okcomputer-hub` (panel), habilitar
  `pg_cron`, crear el esquema `hub` y exponerlo en la API, grants solo sobre
  `hub`, `hub.usuarios`, `hub.areas`, `hub.auditoria` + trigger genérico.
  Alta de usuarios en Auth y Google OAuth.
- **Carga inicial** con `scripts/importar-app.mjs` desde el último dump y
  **`sync-app`** con `pg_cron` cada 15 min. Tablas de negocio en `hub` con las
  mismas columnas que en `okcomputer`.
- Scaffold Vite + TS + PWA; login; **shell** (menú por grupos, baldosas con
  número en vivo vía `contador()`, buscador de módulos, párrafo explicativo
  por pantalla, tema, tour); capa de datos (`src/core/api.ts`, portada de
  `public/js/api.js`: timeout, reintento de JWT, paginación) apuntando al
  esquema `hub` (cabecera `Accept-Profile`/`Content-Profile`).
- Enlaces a la app actual para todo lo que aún no existe.
- Workflows: Firebase Hosting (sitio nuevo), deploy de funciones con
  `SIN_JWT`, aplicar migración. Secrets nuevos del proyecto.
- `.claude/settings.json`, `.mcp.json`, skill `verify` (Playwright + Chromium
  con la red interceptada; portado de la app actual) y la comprobación
  «ninguna migración toca `public` ni los roles de Breeze».
- Fuera del código: exportar Notion y Zoho; bot de Telegram; dominio.

### Fase 1 · Organizador de proyectos + MCP completo (3-4 semanas) — LA BASE

**Proyectos.**

- Migración `…_proyectos.sql` en `hub`: `proyectos` (`tipo` interno/cliente,
  `cliente_id`/`local_id` opcionales, `responsable`, `estado` = `idea` →
  `definicion` → `investigacion` → `roadmap` → `desarrollo` → `cerrado`,
  fechas, `presupuesto`, `presupuesto_id`, `descripcion`),
  `proyecto_objetivos` (texto, métrica, `hecho`, `orden`), `proyecto_hitos`
  (nombre, fecha objetivo, estado, `orden`), `proyecto_paginas` (markdown +
  `fuentes` jsonb + `autor` persona/Claude; en la fase 5 se funden con la
  wiki), y `proyecto_id` nullable en `hub.tareas`, `hub.trabajos`,
  `hub.agenda`, `hub.gastos`, `hub.presupuestos`, `hub.tickets`. RLS y
  auditoría.
- Pantalla `proyectos`: lista y **kanban por fase** (aquí nace el motor de
  vistas lista/kanban/calendario), ficha con pestañas **Idea · Objetivos ·
  Investigación · Roadmap (hitos + Gantt simple) · Tareas · Trabajos /
  Presupuestos / Gastos · Coste** (horas de `sesiones` × tarifa +
  `documento_lineas` + `gastos` frente a `presupuesto`), botones
  **«Investigar»** y **«Desarrollar esta fase»**, bandeja de ideas con alta
  rápida, tablero de tareas por persona Pendiente / En curso / Hecho.

**MCP completo (`mcp`).**

- Edge function `mcp` (servidor MCP streamable HTTP sin estado; patrón de
  `mcp-server` de la app actual, portado). `.mcp.json` apunta a ella.
- `hub.mcp_tokens` (hash, nombre, alcance `lectura` / `escritura` / `admin`,
  `usuario_id`, `expira`, `ultimo_uso`); toda escritura en `hub.auditoria`
  con ese usuario.
- Herramientas de dominio (`proyecto_*`, `tarea_*`, `ticket_*`, `trabajo_*`,
  `cliente_*`, `presupuesto_*`, `wiki_*`, `informe_*`, `agenda_*`, `rmm_*`
  en la fase 2, `buscar`, `esquema`), nunca SQL libre; lista blanca de
  campos en `_shared/acciones.ts`, compartida por voz, bot y MCP. Las
  escrituras respetan `hub.areas` (rechazan un área cuyo dueño sea `app`).
- `hub.claude_peticiones` (`proyecto_id`, `tipo` investigar / desarrollar /
  revisar, prompt, estado, resultado, enlace) + función `lanzar-claude`
  (issue en este repo con etiqueta `claude-proyecto`; opcionalmente sesión
  por la API de Claude Code Remote). Una Routine de Claude recoge, trabaja y
  devuelve por el MCP (`proyecto_registrar_resultado`).
- `docs/MCP.md`.

### Fase 2 · Monitorización: consola RMM sobre Breeze (2-3 semanas)

- Vistas `hub.rmm_equipos`, `hub.rmm_sites`, `hub.rmm_alertas`,
  `hub.rmm_metricas` (con ventana de tiempo), `hub.rmm_parches`,
  `hub.rmm_software`, `hub.rmm_sesiones_remotas`, `hub.rmm_comandos` sobre
  `public` de Breeze (propiedad de `postgres`, SELECT a `authenticated`,
  sin tocar `public`). Se revisan en cada salto de versión de Breeze
  (`okcomputer-rmm/VERSIONES.md`).
- `hub.rmm_sitios` (Site de Breeze ⇆ `hub.locales`, portado de
  `rmm_breeze_sitios`: emparejado por nombre, `local_id` a mano no se pisa) y
  `hub.rmm_estado_local` (misma regla que hoy: conectado si checkin en el
  último cuarto de hora).
- Pantalla `monitorizacion`: sedes con estado, equipos (hardware, discos,
  SO, antivirus, parches pendientes, software con versión del TPV cruzada
  con `programa_tpv`), alertas con «Crear ticket» y acuse, sesiones remotas
  (RustDesk), comandos y scripts. Pestaña Monitor. en la ficha del sitio;
  color RMM en Sitios y Mapa.
- Función `breeze-api`: login de servicio contra `breeze.oksistemas.online`
  para lo que escribe (comandos, scripts, acuse); secrets en este proyecto.
- Alertas como fuente del panel de dirección y del bot (fase 3).
- **Retirada de OKRMM**: inventario de equipos que sigan en OKRMM, alta en
  Breeze con el procedimiento de `okcomputer-rmm/agente/`, y `rmm-agente`,
  `rmm_altas`, `rmm_sondas` no se portan. `breeze-sync`/`breeze-hook` de la
  app actual siguen hasta que Monitor. deje de usarse allí.

### Fase 3 · Puesto de mando y canal (3 semanas) — se porta el dashboard

- Motor de avisos accionables (`panorama_direccion`): presupuesto sin
  respuesta, factura vencida (Zoho `overdue`, leído por `zoho-lectura`),
  cliente A sin comprar, stock bajo mínimo, ticket sin asignar, cobro de
  mantenimiento torcido, lead web sin contestar, **alerta RMM crítica**,
  **hito de proyecto vencido**, cierre del mes pendiente. Misma lista para
  panel, bot e informes.
- Pantalla `direccion`: 4 tarjetas de dinero, avisos por importe con botón,
  ventas 12 meses vs año anterior, margen por familia, cuentas grandes, «lo
  último» desde `hub.auditoria`.
- Canal: `telegram-bot` (webhook, `SIN_JWT`, secret de Telegram;
  `hub.telegram_vinculos`), `whatsapp` (Cloud API), `_shared/mensajeria.ts`.
- Informes programados: `hub.informes_programados` + `informes-enviar` por
  `pg_cron`; tipos: ventas de ayer, cierre del día, qué comprar, recordatorio
  de fichaje, cobros vencidos, estado de proyectos, **resumen RMM**, repaso
  matinal por persona; «Enviar ahora» y «Pedir uno nuevo».

### Fase 4 · Ventas: cliente 360, cobros y web (3-4 semanas) — sustituye Zoho CRM

- `hub.actividades` con línea de tiempo; ficha 360 (clase A/B/C, saldo y
  vencido de Zoho, «lo siguiente», pestañas al estilo OKHUB, «apuntar lo de
  hoy»); pipelines configurables; importación CSV de Zoho CRM.
- `cobros` (facturas de Zoho + `mant_facturas`), recordatorios automáticos
  (`hub.cobros_recordatorios`, WhatsApp con plantilla o email), aviso interno.
- `hub.leads_web` desde el formulario de captación, la web y el WhatsApp de
  la web; capa «estado de cobro» en el Mapa.
- Se portan: clientes, contactos, sitios, oportunidades, mapa.

### Fase 5 · Wiki y buscador de documentos (2-3 semanas) — sustituye Notion

- `hub.paginas` (jerarquía, markdown, `proyecto_id`, versiones, `tsvector`),
  editor ligero, importador del zip de Notion.
- RAG con `vector` (ya instalado): `documentos-indexar` (Drive + wiki) →
  `hub.documentos_fragmentos`; `documentos-preguntar` cita fragmento y
  documento; herramienta del bot, del asistente y del MCP.
- Se portan: conocimiento (migrado a páginas) y tablero de notas.

### Fase 6 · Desk (2-3 semanas) — sustituye Zoho Desk

SLA, plantillas de respuesta, valoraciones, `mail-to-ticket`; se portan
tickets y bandeja de WhatsApp (el webhook de Meta se apunta al hub).

### Fase 7 · Portal de clientes (3 semanas)

`/portal/` con enlace mágico o rol `cliente` (RLS sobre `hub`): tickets,
presupuestos, facturas y contratos, «lo de siempre», seguimiento; accesos
invitables/revocables con traza.

### Fase 8 · Comandas (1-2 semanas) — se portan tareas y lista del día

Audio (Telegram, WhatsApp, dictado) → `transcribir` → N tareas asignadas →
tablero por persona de la fase 1.

### Fase 9 · Almacén: ficha maestra, MRP y envíos (3 semanas) — se porta inventario

Mínimo, cobertura, múltiplo, `catalogo_proveedores`, en camino, consumo
semanal de `furgoneta_movimientos`, «se agota en N días»; `compras-mrp`;
`envios`. Se portan inventario (con «todo movimiento deja registro»),
catálogo, proveedores, compras.

### Fase 10 · Personas y administración (3-4 semanas) — sustituye Zoho People / Sign

`jornadas` RD 8/2019, `ausencias` → `agenda`, gastos con OCR, portal del
asesor (rol `gestoria`, permisos por bloque, cierre mensual, traza),
`documentos_firma`. Se portan usuarios, fichaje, gastos, contratos y firma.

### Fase 11 · Facturación propia (6-8 semanas) — sustituye Zoho Books

Verificar Verifactu antes; `facturas` + líneas + `cobros` + series; PDF;
export contable; histórico de Zoho en solo lectura; se portan presupuestos,
facturas y el mantenimiento con Stripe (`stripe-webhook` propio, URL del
webhook cambiada al hub); se apagan las funciones Zoho de la app actual.

### Final · Lo que más usan los técnicos

Trabajos, calendario/agenda, chat, modo calle y APK se portan al final.
Entonces `okcomputertenerife.web.app` redirige al hub, la APK cambia de
URL, `sync-app` se apaga y el proyecto `okcomputer` queda como copia
(pausado) hasta archivarlo.

### Transversal

Motor de vistas; baldosas con número en vivo; párrafo explicativo por
pantalla; reglas del proyecto compartido en cada migración y función;
comprobación automática de migraciones.

## 4. Orden y dependencias

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → final`

- La **fase 1** va primero porque es lo marcado como imprescindible y porque
  el MCP permite que Claude Code construya las siguientes fases desde dentro
  del sistema (cada fase nace como proyecto en el hub).
- La **fase 2** va justo después porque la infraestructura ya está en este
  proyecto (Breeze en la misma base) y arregla el punto flaco actual: el
  espejo `rmm_*` por sync de 5 minutos.
- Las fases 4, 5 y 6 quitan Zoho CRM, Notion y Zoho Desk; 7-10 son mejora
  propia; 11 es la única con riesgo fiscal.

## 5. Riesgos y qué NO hacer

- **Breeze y el hub en la misma base.** Una migración que toque `public` o
  los roles de Breeze puede tumbar el RMM; solo lo evitan las reglas de 1.2 y
  la comprobación automática. Las vistas `hub.rmm_*` son la única dependencia
  del esquema de Breeze y se revisan en cada actualización.
- **Carga del proyecto**: Breeze ya escribe métricas cada 5 min; el hub añade
  poco (usuarios internos), pero las vistas sobre métricas van con ventana de
  tiempo y las pantallas no hacen `count(*)` a pelo.
- **Dos copias de los datos de negocio** durante la convivencia: el sync es
  de solo lectura, por área y solo deltas; ninguna escritura del hub sobre un
  área con dueño `app`; un sync que falla no mueve el corte.
- No tocar `okcomputerclaude` desde este repo; no exponer `public`; no
  reutilizar AppFlowy ni otro proyecto AGPL; no copiar de OKHUB lo que depende
  de ERP externo o hardware; no quitar Zoho Books antes de la fase 11; no
  fusionar `trabajos`/`tareas`; MCP sin SQL libre; WhatsApp iniciado por la
  empresa con plantilla aprobada; datos sensibles nunca por bot.
- Las 16 tablas de Breeze sin RLS: no es cosa del hub (la REST está cerrada
  sobre `public`), pero hay que saberlo antes de tocar la exposición de la API.

## 6. Preguntas abiertas

- Compute del proyecto Supabase (plan Pro) para absorber hub + Breeze;
  revisar tras la fase 2.
- Dominio definitivo del hub e id del sitio de Firebase.
- Correo de empresa en Zoho Mail o Gmail (afecta a `mail-to-ticket`).
- API de Claude Code Remote para abrir sesiones desde la app, o solo issue +
  Routine.
- Agencias de transporte y programa de la gestoría.
- Apps de Zoho One exactas además de CRM / Desk / Projects y volumen de datos.
