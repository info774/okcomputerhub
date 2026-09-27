# Plan del sistema unificado de Ok Computer («el hub»)

> Mapa y hoja de ruta para que UNA sola app haga lo que hoy se reparte entre
> la PWA actual (`okcomputerclaude`), **Notion** y **Zoho One**, y tome las
> ideas de **OKHUB** (`app.okcomputer.es`, demo de otra empresa: ver
> `docs/referencias/OKHUB_INVENTARIO.md`). Escrito el 2026-09-27. Es un
> documento de decisión: en este repo no hay código de ninguna fase todavía.

## 0. Decisiones tomadas

| Decisión | Detalle |
|---|---|
| **El hub nace en este repo (`okcomputerhub`)** | `okcomputerclaude` **no se toca**: sigue desplegándose y usándose igual mientras el hub crece. Nada de lo que se haga aquí abre PRs allí. |
| **Mismo Supabase** | El hub es un frontend nuevo y edge functions nuevas contra el MISMO proyecto Supabase (`okcomputer`, ref `gaksrtxgnuuuvhvgwxue`): comparte clientes, sedes, trabajos, tickets, inventario, usuarios y Auth. Solo **añade** (tablas, columnas nullable, vistas, funciones); nunca altera lo que la app actual lee. Reglas en `CLAUDE.md`. |
| **Stack: Vite + TypeScript sin framework** | Módulos ES por pantalla, hash-routing `#/ruta`, PWA instalable con service worker. Mismo espíritu que la app actual (JS vanilla) y que OKHUB, para poder **portar** módulos de `okcomputerclaude` cuando toque. |
| **El hub absorbe módulos poco a poco** | La fase 1 nace solo con lo nuevo (proyectos, MCP, después dirección, bot…) y enlaza a la app actual para el resto. Cada fase porta un módulo más. Al final la app actual redirige al hub y se apaga. |
| **Sustituir, no integrar** | Notion y las apps de Zoho One (CRM, Desk, Projects, People, Sign, Mail…) se reemplazan por funciones propias. |
| **Zoho Books también, pero al final** | La facturación fiscal sigue en Books hasta la fase 10. |
| **Notion hoy** | Pocas páginas sueltas (manuales, procedimientos): basta un editor de páginas con jerarquía y búsqueda. |
| **Dos piezas imprescindibles, primero** | (1) **Organizador de proyectos y tareas** con el ciclo entero: idea → creación → objetivos → búsqueda de información → roadmap → desarrollo; proyectos internos y de cliente en la misma entidad; la investigación la hace Claude (web + wiki/Drive) y queda en el proyecto con sus fuentes. (2) **MCP para Claude Code** que lea y escriba TODO el sistema con tokens con alcance, y que el sistema pueda **lanzar a Claude Code** y recoger el resultado. |
| **De OKHUB, todo lo preguntado** | Panel de dirección «qué decidir, ordenado por dinero», comandas, informes programados, bot que consulta el sistema, cobros con recordatorios, portal de clientes, ficha de cliente 360, web conectada + mapa por cobro, MRP + ficha maestra, jornada RD 8/2019 + ausencias + export, gastos con OCR + portal del asesor, RAG + envíos. |
| **Canal** | **Telegram** para el equipo (bot, informes, botones) y **WhatsApp** para lo que va al cliente (la app actual ya tiene Cloud API; el hub la reutiliza por sus propias funciones `hub-*`). |

## 1. Arquitectura del hub

### 1.1 Repo

```
okcomputerhub/
├─ src/                    Vite + TypeScript, sin framework
│  ├─ main.ts              arranque, router por hash, registro de módulos
│  ├─ core/                auth (Supabase Auth compartida), api (PostgREST), estado, mensajería
│  ├─ shell/               menú por grupos, baldosas con número en vivo, buscador, tema, tour
│  ├─ modulos/<nombre>/    una carpeta por pantalla (proyectos, direccion, clientes…)
│  └─ ui/                  piezas comunes (modal, kanban, vistas, dictado, editor markdown)
├─ public/                 manifest, iconos, service worker
├─ supabase/
│  ├─ migrations/          SOLO aditivas, sufijo _hub
│  └─ functions/           Deno, todas con prefijo hub-, con su propio _shared/
├─ .github/workflows/      deploy front (Firebase), deploy funciones, aplicar migración
├─ .claude/                settings.json, skills (verify), commands
├─ .mcp.json               conector hub-mcp para Claude Code
└─ docs/
```

### 1.2 Backend compartido (las cinco reglas)

1. **Aditivo.** Tablas nuevas, columnas nuevas **nullable** y sin default
   que cambie comportamiento, vistas y funciones nuevas. Nunca renombrar,
   borrar ni cambiar el significado de una columna o tabla que lea la app
   actual (`okcomputerclaude`).
2. **Migraciones con fecha y sufijo `_hub`** (`20261001_proyectos_hub.sql`),
   para distinguirlas en la base de las del otro repo. Se aplican con el
   workflow de este repo (mismo secret `SUPABASE_DB_PASSWORD`), en
   transacción con `ON_ERROR_STOP`. No se editan las ya aplicadas.
3. **Edge functions con prefijo `hub-`** (`hub-mcp`, `hub-telegram`,
   `hub-informes`, `hub-lanzar-claude`…). El deploy de `okcomputerclaude`
   despliega «todas las de su rama» y el de aquí «todas las de la suya»;
   sin colisión de nombres ninguno pisa al otro. Las funciones viejas
   (`mcp-server`, `whatsapp-api`, `asistente`…) no se tocan: si el hub
   necesita algo parecido, lo duplica con prefijo `hub-` y su propio
   `_shared/`.
4. **Toda tabla nueva entra en `audit_log`** (el trigger genérico ya
   existe) y lleva sus políticas RLS. En la lista `SIN_JWT` del workflow del
   hub solo entra una función si la autoriza otra cosa (firma, secret,
   código de un solo uso).
5. **Lo que falte se crea aquí.** Si el hub necesita una vista, una función
   SQL o un índice que no existe, se crea nuevo en este repo; no se abre PR
   contra `okcomputerclaude`.

Comprobación automática (fase 0): el arnés del hub falla si una migración
contiene `ALTER TABLE … DROP | RENAME | ALTER COLUMN` sobre una tabla que no
haya creado el propio hub.

### 1.3 Frontend, dominio y convivencia

- **Firebase Hosting**: sitio nuevo en el mismo proyecto de Firebase (el
  id `okcomputerhub` ya lo usa el redirect del dominio antiguo, así que
  otro, p. ej. `okhub-tenerife`) y dominio propio, p. ej.
  `hub.okcomputertenerife.com`. `app.okcomputer.es` es de otra empresa.
- **Misma Auth**: los mismos usuarios entran con la misma cuenta;
  `usuarios.rol` manda; la RLS existente cubre las tablas viejas.
- **Convivencia**: cada pantalla que el hub aún no tiene es un **enlace a la
  app actual** (`https://okcomputertenerife.web.app`). Son dos orígenes, así
  que hasta tener SSO (pasar la sesión de Supabase por URL al saltar) se
  entra dos veces. Cada fase porta un módulo más; la app actual se apaga
  cuando no quede nada.
- **Portar, no reescribir a ciegas**: los módulos de `okcomputerclaude`
  (`public/js/modules/*.js`) y su código compartido de funciones
  (`supabase/functions/_shared/*.ts`) se copian al hub cuando les toque,
  pasándolos a TypeScript y a la estructura nueva; se conserva lo que ya
  funciona (reglas de fichaje, de inventario, de mantenimiento…).

## 2. Mapa de cobertura

Inventario de la app actual hecho el 2026-09-27 (páginas de `app.js`,
tablas de `supabase/migrations`, funciones Zoho). **Fase** = en cuál se cierra
el hueco; **Vive en** = en qué fase el hub pasa a ser el dueño de esa área
(hasta entonces, enlace a la app actual).

| Área | Ya en la app actual | Referencia | Hueco | Fase | Vive en el hub desde |
|---|---|---|---|---|---|
| **Proyectos (ciclo completo)** | `tareas` (lista/kanban, recurrentes), `lista_dia`, `trabajos`, `agenda`, `tablero_notas` | Notion (tableros), Zoho Projects | Entidad `proyectos` con fases idea → objetivos → investigación → roadmap → desarrollo, objetivos, páginas de investigación con fuentes, hitos, tablero de tareas por proyecto, coste real | **1** | 1 (nuevo) |
| **MCP completo** | `mcp-server` (10 herramientas, un token, escrituras solo ticket/tarea) | — | Escritura sobre todo el sistema con tokens con alcance y auditoría; lanzar Claude Code desde la app y recoger resultados | **1** | 1 (`hub-mcp`) |
| Panel de dirección | `dashboard`, `informes` (resumen mensual fijo), `os/avisos.js` | OKHUB Panel de dirección | Tarjetas de dinero, avisos accionables por importe, ventas 12 meses, margen por familia, cuentas grandes, «lo último» | 2 | 2 |
| Bot + informes programados | `asistente` (apagado), repaso matinal (Routine), push cada 15 min | OKHUB Asistente + Informes por Telegram | Bot Telegram interno, informes con hora/días/destinatarios/regla y «Enviar ahora», pedir informes en lenguaje natural | 2 | 2 |
| Cliente 360 + CRM | `clientes`, `contactos`, `oportunidades` (kanban), `captar-lead`, `captacion.html` | Zoho CRM, OKHUB Clientes | `actividades` con línea de tiempo, clase A/B/C, «lo siguiente», pipelines configurables, previsión | 3 | 3 (se portan clientes, contactos, oportunidades, mapa) |
| Cobros | `facturas.js` (Zoho en vivo), `mant_facturas`, Cobros de mantenimiento | OKHUB Cobros | Deuda por cliente, recordatorios automáticos al cliente y aviso interno, Recordar/Cobrada | 3 | 3 (la parte Stripe sigue en la app actual hasta la 10) |
| Web conectada + mapa | `captacion.html`, `whatsapp-webhook`, `mapa.js` | OKHUB Tu web + Mapa | Bandeja de leads con dueño, catálogo publicado con stock real, capa de mapa por cobro | 3 | 3 |
| Wiki + RAG | `conocimiento` (lista plana), `tablero_notas` | Notion, OKHUB Buscador de documentos | Páginas jerárquicas con versiones y búsqueda; índice Drive + wiki con respuestas citando fuente | 4 | 4 (se portan conocimiento y tablero) |
| Desk | `tickets` (+ comentarios, adjuntos, kanban), WhatsApp → ticket, RMM → ticket | Zoho Desk | SLA, respuestas predefinidas, correo → ticket, satisfacción | 5 | 5 (se portan tickets y bandeja WhatsApp) |
| Portal de clientes | portal de Stripe (solo pago), `firma.html` | OKHUB Portal de tus clientes | Tickets, presupuestos, facturas, contratos, «lo de siempre», seguimiento; accesos invitables | 6 | 6 (nuevo) |
| Comandas | la voz crea tareas de una en una, `ui/dictado.js` | OKHUB Comandas | Audio → N tareas asignadas, tablero por persona | 7 | 7 (se portan tareas y lista del día) |
| Almacén / MRP / envíos | `furgoneta_*` (todo movimiento deja registro), `catalogo`, `proveedores`, `pedidos_compra`, `lista_pedidos` | OKHUB Maestro, Inventario, MRP, Envíos | Mínimo/cobertura, consumo semanal, «se agota en N días», sugerencias por proveedor, en camino, ubicaciones; envíos | 8 | 8 (se portan inventario, catálogo, proveedores, compras) |
| People / Admin / Sign | `usuarios`, `sesiones` (fichaje por trabajo), `gastos`, `firma-contrato` | Zoho People / Sign, OKHUB Fichajes, Gastos, Portal del asesor | Jornada RD 8/2019, ausencias, OCR de tickets, cierre mensual y accesos de la gestoría, firma de cualquier documento | 9 | 9 (se portan usuarios, fichaje, gastos, contratos/firma) |
| Facturación | Todo en Zoho Books (15 funciones, sin tabla local de facturas de venta) | Zoho Books | Facturas propias, series, IGIC, Verifactu, PDF, cobros, export contable | 10 | 10 (se portan presupuestos, facturas, mantenimiento Stripe) |
| Trabajos, calendario, RMM, chat, modo calle, APK | Completo en la app actual | — | Nada que sustituir: es lo más grande y lo que más usan los técnicos | Final | Al final, y entonces la app actual redirige al hub |
| Fuera (por ahora) | RMM cubre «Sistemas» | OKHUB Cámaras/NVR, Flota GPS, Conexiones ERP, alarma/tornos | No se copia | — | — |

## 3. Fases

Cada fase es desplegable sola, con su migración `_hub`, sus funciones
`hub-*`, su arnés de verificación y su nota en `CLAUDE.md`. Estimaciones
orientativas (semanas de una persona con Claude Code).

### Fase 0 · Cimientos del repo (1-2 semanas)

- Scaffold Vite + TypeScript + PWA (manifest, service worker, instalable,
  «sin red» visible). Sin framework; módulos ES por pantalla; hash-routing.
- **Login** con la Auth compartida de Supabase (email/contraseña y Google,
  los mismos que la app actual); lectura de `usuarios` para rol y nombre.
- **Shell** como OKHUB: menú por grupos, inicio de baldosas con su número
  en vivo (cada módulo expone `contador()` → valor, subtítulo, tono),
  buscador de módulos, párrafo explicativo por pantalla, tema claro/oscuro,
  tour de primeras veces.
- **Capa de datos**: cliente PostgREST con timeout (10 s lectura, 30 s
  escritura), reintento al caducar el JWT y paginación más allá de 1000
  filas (portado de `public/js/api.js` de la app actual, en TS).
- **Enlaces a la app actual** para todo lo que el hub aún no tiene (grupo
  «App actual» en el menú).
- **Workflows**: deploy del front a un sitio nuevo de Firebase Hosting;
  deploy de funciones `hub-*` (con lista `SIN_JWT`); aplicar migración por
  nombre. Mismos secrets que el otro repo.
- `.claude/settings.json` (permisos para sesiones desatendidas, deniega lo
  destructivo), `.mcp.json` apuntando a `hub-mcp` (fase 1) y skill `verify`
  (Playwright + Chromium con la red de Supabase interceptada y fixtures,
  portado de `.claude/skills/verify/` de la app actual) + la comprobación
  de migraciones aditivas.
- Fuera del código: exportar Notion (zip) y Zoho CRM/Desk/Projects (CSV);
  crear el bot de Telegram (BotFather); decidir dominio.

### Fase 1 · Organizador de proyectos + MCP completo (3-4 semanas) — LA BASE

**Proyectos.**

- Migración `…_proyectos_hub.sql`:
  - `proyectos`: `tipo` (`interno` / `cliente`), `cliente_id` y `local_id`
    opcionales, `responsable`, `estado` = fase del ciclo (`idea` →
    `definicion` → `investigacion` → `roadmap` → `desarrollo` → `cerrado`),
    `fecha_inicio`, `fecha_objetivo`, `presupuesto`, `presupuesto_id`,
    `descripcion`.
  - `proyecto_objetivos` (texto, métrica, `hecho`, `orden`),
    `proyecto_hitos` (roadmap: nombre, fecha objetivo, estado, `orden`),
    `proyecto_paginas` (investigación, decisiones, notas en markdown con
    `fuentes` jsonb y `autor` persona/Claude; en la fase 4 se funden con la
    wiki).
  - `proyecto_id` (FK **nullable**) en `tareas`, `trabajos`, `agenda`,
    `gastos`, `presupuestos`, `tickets`: columnas aditivas, permitidas por
    la regla 1; la app actual las ignora.
  - RLS, `audit_log` para las cuatro tablas.
- Pantalla `proyectos` (`src/modulos/proyectos/`): lista y **kanban por
  fase** (aquí nace el motor de vistas compartido lista/kanban/calendario),
  ficha con pestañas **Idea · Objetivos · Investigación · Roadmap · Tareas
  · Trabajos/Presupuestos/Gastos · Coste** (hitos + Gantt simple sobre
  `agenda`; coste real = horas de `sesiones` × tarifa + `documento_lineas` +
  `gastos` frente a `presupuesto`), botones **«Investigar»** y
  **«Desarrollar esta fase»**, bandeja de ideas con alta rápida (voz y, en
  la fase 2, Telegram) y tablero de tareas por persona **Pendiente / En
  curso / Hecho** (el mismo de las comandas de la fase 7).

**MCP completo (`hub-mcp`).**

- Función nueva `hub-mcp` (servidor MCP streamable HTTP sin estado, como
  `mcp-server`, que no se toca). `.mcp.json` de este repo apunta a ella.
- **Tokens con alcance**: tabla `mcp_tokens` (hash, nombre, alcance
  `lectura` / `escritura` / `admin`, `usuario_id` al que se atribuyen las
  escrituras, `expira`, `ultimo_uso`). Toda escritura queda en `audit_log`
  con ese usuario.
- **Herramientas de dominio, no SQL libre**: `proyecto_*` (crear, listar,
  detalle, objetivos, hitos, página, cambiar fase, registrar resultado),
  `tarea_*`, `ticket_*`, `trabajo_*`, `cliente_*`, `presupuesto_*`,
  `wiki_*` (fase 4), `informe_*` (fase 2), `agenda_*`, `buscar` global y
  `esquema` (tablas, campos y valores permitidos, para que Claude Code se
  oriente solo). Lista blanca de campos por tabla en un único catálogo de
  acciones (`supabase/functions/_shared/acciones.ts`) que después
  comparten voz, bot y MCP.
- **Lanzar Claude Code desde la app**: tabla `claude_peticiones`
  (`proyecto_id`, `tipo` = `investigar` / `desarrollar` / `revisar`, prompt
  generado con el contexto del proyecto, `estado`, `resultado`, `enlace`).
  Función `hub-lanzar-claude`: crea un issue en **este repo** con etiqueta
  `claude-proyecto` y el id (token de GitHub en secret, nunca en el
  navegador) y, si existe `CLAUDE_CODE_API_KEY`, abre además una sesión
  por la API de Claude Code Remote. Una **Routine** de la cuenta de Claude
  recoge los issues, trabaja y **devuelve el resultado por el MCP**
  (`proyecto_registrar_resultado`: página de investigación con fuentes,
  enlace a la PR, hitos actualizados) y cierra el issue.
- `docs/MCP.md`: alcances, catálogo de herramientas y el ciclo petición →
  issue → resultado.

**Verificación**: `verify-proyectos.mjs` (ficha, kanban por fase, objetivos,
hitos, coste) y prueba de `hub-mcp` con `curl` (listar herramientas, crear
proyecto con token de escritura, rechazo con token de lectura, fila en
`audit_log`).

### Fase 2 · Puesto de mando y canal (3 semanas) — se porta el dashboard

- **Motor de avisos accionables** (`hub-panorama` o vista SQL): cada aviso
  con tipo, importe, texto en lenguaje natural, detalle y acción.
  Fuentes: presupuesto enviado sin respuesta, factura vencida (Zoho
  `overdue`), cliente A sin comprar N días, stock bajo mínimo, ticket sin
  asignar o urgente, cobro de mantenimiento torcido (`mant_cobros_estado`),
  lead web sin contestar (fase 3), **hito de proyecto vencido**, cierre del
  mes pendiente (fase 9). La MISMA lista para el panel, el bot y los
  informes.
- **Pantalla `direccion`** (solo admin): 4 tarjetas de dinero (ventas del
  mes vs mismo mes del año anterior y «hoy llevas»; margen frente a
  objetivo; dinero en la calle con lo vencido; en juego), lista de avisos
  por importe con botón que abre la ficha, ventas 12 meses con rayita del
  año anterior, margen por familia del `catalogo`, cuentas grandes con cómo
  pagan, «lo último que ha pasado» desde `audit_log`. Hasta la fase 10 las
  cifras de facturación salen de Zoho (función `hub-zoho-lectura`, solo
  lectura, duplicada de `_shared/zoho.ts`).
- **Canal**: `hub-telegram` (webhook, `SIN_JWT`, autorizado por el secret
  de webhook de Telegram; usuario emparejado con código de un solo uso
  guardado en una tabla nueva `telegram_vinculos`, no en `usuarios`).
  Consultas en lenguaje natural sobre los mismos datos del panel y botones
  inline para fichar, marcar hecho, aprobar, «en 1 hora». Lo que va al
  **cliente** por WhatsApp: `hub-whatsapp` (envío por Cloud API con los
  mismos secrets de Meta). Capa común `_shared/mensajeria.ts`:
  `enviar(destino, texto, botones)` elige Telegram / WhatsApp / push.
- **Informes programados**: tabla `informes_programados` (nombre, tipo,
  hora, días, destinatarios, regla «solo si hay algo», activo) +
  `hub-informes` lanzada por pg_cron cada 15 min. Tipos iniciales: ventas
  de ayer, cierre del día, qué comprar, recordatorio de fichaje, cobros
  vencidos, **estado de proyectos**, repaso matinal por persona. Pantalla
  con «Enviar ahora» y «Pedir uno nuevo» en lenguaje natural.
- Se porta: dashboard («Hoy») y centro de avisos.

### Fase 3 · Ventas: cliente 360, cobros y web (3-4 semanas) — sustituye Zoho CRM

- **`actividades`** (tipo llamada / WhatsApp / email / reunión / nota /
  sistema, `cliente_id`, `contacto_id`, `oportunidad_id`, `ticket_id`,
  `proyecto_id`, fecha, texto, resultado, próxima acción, origen). Línea
  de tiempo que además proyecta `wa_mensajes`, trabajos y tickets.
- **Ficha 360**: clase A/B/C por facturación del año, saldo y vencido
  (Zoho), «lo siguiente que hay que hacer», pestañas al estilo OKHUB (qué
  compra, presupuestos/trabajos, cobros, tickets, envíos, comandas de hoy,
  dónde está, histórico) y «Apuntar lo de hoy» + Llamar / Escribir.
- **Pipelines configurables** (`crm_config`) para `oportunidades`;
  previsión ponderada en `direccion`; importación CSV de Zoho CRM por NIF.
- **Cobros**: pantalla `cobros` (facturas de Zoho + `mant_facturas`),
  estados al día / vence pronto / vencida con nº de avisos; recordatorio
  automático 3 días antes y al vencer (`cobros_recordatorios`, pg_cron):
  WhatsApp con **plantilla aprobada** o email; aviso interno por Telegram;
  botones Recordar / Cobrada.
- **Web conectada**: bandeja `leads_web` (formulario de captación,
  formularios de la web, WhatsApp de la web); Convertir en cliente / Pasar
  a un comercial / Descartar. Capa «estado de cobro» en el Mapa.
- Se portan: clientes, contactos, sitios (ficha), oportunidades, mapa.

### Fase 4 · Wiki y buscador de documentos (2-3 semanas) — sustituye Notion

- `paginas` (jerarquía, markdown, `proyecto_id` opcional, autor) +
  `paginas_versiones` + búsqueda `tsvector`; adjuntos en Storage. Las
  `proyecto_paginas` pasan a ser páginas con `proyecto_id`.
- Editor markdown ligero con vista previa, árbol lateral, enlaces
  `[[página]]`, dictado. Importador del zip de Notion.
- **RAG**: `hub-documentos-indexar` (carpeta de Drive por la cuenta de
  servicio existente + wiki) → `documentos_fragmentos` con `pgvector`;
  `hub-documentos-preguntar` responde citando fragmento y documento.
  Herramienta del bot, del asistente y del MCP; la investigación de
  proyectos la usa junto a la búsqueda web.
- Se portan: conocimiento (migrado a páginas) y tablero de notas.

### Fase 5 · Desk (2-3 semanas) — sustituye Zoho Desk

- `sla_config` por prioridad, `primera_respuesta_at` y `vence_at` en
  `tickets` (columnas aditivas), cronómetro, aviso en `direccion` y bot.
- `ticket_plantillas`, `ticket_valoraciones`, `hub-mail-to-ticket` (Gmail
  push o sondeo) con un clasificador propio (portado de
  `_shared/whatsapp-clasificar.ts`).
- Se portan: tickets y bandeja de WhatsApp (`hub-whatsapp-webhook` con la
  misma firma de Meta; el webhook de Meta se apunta al hub cuando esté
  listo y la función vieja deja de recibir).
- Migración: tickets abiertos de Desk por CSV.

### Fase 6 · Portal de clientes (3 semanas)

- Página pública del hub (`/portal/`) con acceso por enlace mágico o
  usuario con rol `cliente` (políticas RLS nuevas que solo ven su
  `cliente_id`).
- Tickets (abrir y seguir), presupuestos (aceptar), facturas y contratos
  (PDF de Zoho), «lo de siempre» (catálogo con su precio pactado → pedido),
  seguimiento de envíos (fase 8). Accesos invitables/revocables desde la
  ficha del cliente, con traza.

### Fase 7 · Comandas (1-2 semanas) — se portan tareas y lista del día

- Audio por Telegram, WhatsApp o dictado → transcripción (`hub-transcribir`,
  Groq Whisper) → el agente lo trocea en N tareas con responsable → tablero
  por persona de la fase 1, con origen y notificación al asignado.

### Fase 8 · Almacén: ficha maestra, MRP y envíos (3 semanas) — se porta inventario

- En `catalogo` / `furgoneta_inventario` (columnas aditivas): mínimo,
  cobertura en semanas, múltiplo; tabla `catalogo_proveedores` (precio,
  plazo, referencia, principal/alternativo); en camino desde
  `pedidos_compra`; consumo semanal de `furgoneta_movimientos`; «se agota
  en N días», «pedir antes de».
- Pantalla `compras-mrp`: sugerencias agrupadas por proveedor que crean
  `pedidos_compra`; el informe «qué comprar» la lee. Ficha de material con
  las secciones de OKHUB.
- `envios` (agencia, seguimiento, bultos, estado, incidencia) con aviso al
  cliente.
- Se portan: inventario por furgoneta (con la regla «todo movimiento deja
  registro»), catálogo, proveedores, pedidos y facturas de compra.

### Fase 9 · Personas y administración (3-4 semanas) — sustituye Zoho People / Sign

- `jornadas` RD 8/2019 (entrada/salida, vía app / Telegram), distinta de
  `sesiones` (por trabajo); aviso a las 10 h sin salida; PDF de inspección;
  export a la gestoría. `ausencias` con aprobación → bloque en `agenda`.
  Ficha de empleado sobre `usuarios`. Roles finos por RLS.
- Gastos con OCR (Groq visión): importe, IGIC/IVA, CIF, categoría; estados.
- Portal del asesor: rol `gestoria`, permisos por bloque, paquete de cierre
  mensual, «lo que falta para cerrar», traza de accesos.
- Sign: `documentos_firma` generalizando la firma de contratos.
- Se portan: usuarios/configuración, fichaje y Mis horas, gastos, contratos
  y firma.

### Fase 10 · Facturación propia (6-8 semanas) — sustituye Zoho Books

- Antes de diseñar: **verificar los requisitos legales vigentes**
  (Verifactu, factura electrónica B2B).
- `facturas` + `factura_lineas` + `cobros` + series por tipo (patrón de
  `mant_serie`), PDF propio, export contable, histórico de Zoho importado
  en solo lectura.
- Se portan presupuestos, facturas y todo el mantenimiento (contratos,
  Stripe, cuotas, abonos): `hub-stripe-webhook` escribe en `facturas`; la
  URL del webhook de Stripe se cambia al hub; se apagan las funciones Zoho
  de la app actual y la sincronización de clientes y catálogo.

### Final · Lo que más usan los técnicos

Trabajos, calendario/agenda, RMM/Breeze, chat, modo calle y APK se portan
al final, cuando el hub ya es la casa de todo lo demás. Entonces
`okcomputertenerife.web.app` redirige al hub, la APK cambia de URL y el
repo `okcomputerclaude` se archiva.

### Transversal

- Motor de vistas (lista / kanban / calendario sobre una fuente + mapeo de
  campos); baldosas con número en vivo; párrafo explicativo por pantalla;
  reglas del backend compartido en cada migración y función.

## 4. Orden y dependencias

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → final`

- La **fase 1** va primero porque es lo marcado como imprescindible y
  porque `hub-mcp` es lo que permite que Claude Code construya las fases
  siguientes **desde dentro del sistema**: cada fase de este plan nace como
  proyecto en el hub, con sus objetivos e hitos, y se lanza a Claude Code
  desde ahí.
- Las fases 3, 4 y 5 quitan Zoho CRM, Notion y Zoho Desk (las
  suscripciones). 6-9 son mejora propia. 10 es la única con riesgo fiscal.

## 5. Riesgos y qué NO hacer

- **Dos repos sobre una base**: solo lo mitigan las cinco reglas de 1.2 y
  la comprobación automática de migraciones. Ninguna migración del hub
  cambia lo que la app actual lee.
- No tocar `okcomputerclaude` desde este repo (ni PRs ni despliegues de
  sus funciones).
- No reutilizar AppFlowy ni otro proyecto AGPL; no copiar de OKHUB lo que
  depende de un ERP externo o de hardware.
- No quitar Zoho Books antes de la fase 10.
- No fusionar tablas de dominio (`trabajos`/`tareas`, `clientes`/leads).
- MCP: nunca SQL libre ni el service role expuesto; lista blanca de tablas
  y campos, tokens con alcance y caducidad, todo en `audit_log`.
- WhatsApp iniciado por la empresa exige plantilla aprobada por Meta;
  Telegram solo para lo interno; datos sensibles (NSS, IBAN) nunca por bot.
- Cada migración de datos con script repetible, y el origen en solo lectura
  un tiempo antes de cancelar la suscripción.

## 6. Preguntas abiertas

- SSO entre los dos orígenes (pasar la sesión de Supabase por URL al saltar
  del hub a la app actual) o entrar dos veces mientras convivan.
- Qué apps de Zoho One exactas se usan además de CRM / Desk / Projects y
  cuántos registros hay.
- Dominio definitivo del hub e id del sitio de Firebase.
- Si el correo de empresa vive en Zoho Mail o en Gmail (afecta a
  `hub-mail-to-ticket` y a los recordatorios por email).
- Si se quiere la API de Claude Code Remote para abrir sesiones desde la
  app (necesita clave) o basta el camino issue + Routine.
- Qué agencias de transporte se usan y qué programa usa la gestoría.
