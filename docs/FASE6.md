# Fase 6 · Desk (soporte)

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Hecha en una
entrega (2026-09-27).

## Decisiones de Fran

- **Los tickets pasan al hub.** En la app se deja de usar la pantalla de
  tickets. Lo que la app sigue creando sola (WhatsApp, voz, RMM) entra al hub.
- **Correo → ticket** con el Gmail de la empresa (info@okcomputertenerife.com),
  y las respuestas salen del mismo buzón, en el mismo hilo.
- **SLA** en horario laboral (L-V 9-14 y 16-19, Canarias): Urgente 2 h / 4 h ·
  Alta 4 h / 8 h · Media 1 día / 2 días · Baja 3 días / 6 días (primera
  respuesta / resolución). Editable por un admin.
- **Valoración** 1-5 con un enlace en el mensaje de cierre, que manda el técnico.

## Qué hay

- **Migración `20261010_desk.sql`** (aplicada):
  - Área `tickets` = `{tickets, ticket_comentarios}`, dueño `hub`, con
    `importar_altas`. Numeración propia del hub desde el **5000** (la app sigue
    con la suya, 1-4999). Un comentario del cliente (WhatsApp de la app o
    correo) sobre un ticket cerrado EN EL HUB lo reabre; uno en `Pendiente`
    vuelve a `Abierto`.
  - `hub.sumar_laborables()` + `hub.horario_laboral` + `hub.festivos`;
    `hub.sla_politicas` (minutos laborables). Un trigger calcula
    `sla_respuesta_at`/`sla_resolucion_at` al crear y al cambiar la prioridad;
    la primera respuesta la apunta el primer comentario `respuesta`.
  - `hub.ticket_comentarios` (tipo `nota` interna | `respuesta` al cliente |
    `cliente`), con el rastro del envío (`enviado_at`, `canal`, `email_id`).
  - `hub.plantillas_respuesta` (con `{{contacto}}`, `{{cliente}}`,
    `{{numero}}`, `{{tecnico}}`, `{{valoracion}}`), `hub.correos_entrantes`
    (todo lo leído del buzón y qué se hizo con ello) y
    `hub.valorar_ticket()` (solo `service_role`).
  - Avisos nuevos en el motor único: `sla_vencido`, `sla_por_vencer`,
    `correo_sin_revisar`; `ticket_sin_asignar` enlaza ya a `#/tickets/<n>`.
  - pg_cron `hub-correo` cada 5 min.
- **Funciones**: `desk-correo` (SIN_JWT para pg_cron; con sesión `estado`,
  `enviar`, `leer`) sobre `_shared/gmail.ts`, y `ticket-valorar` (SIN_JWT, lo
  autoriza el token del enlace).
- **Pantalla `#/tickets`**: vistas Abiertos · Míos · Sin asignar · SLA en
  riesgo · Cerrados, ficha con la conversación, responder por correo /
  WhatsApp / «ya se lo dije», notas internas, plantillas, técnico, vincular un
  trabajo de la app por su número, cerrar (prepara el mensaje de cierre con la
  valoración), bandeja de correo y ajustes (plantillas, SLA, horario, festivos).
- **Página pública** `valorar.html?t=<token>` (fuera de la app; el service
  worker ya no cachea las páginas sueltas).
- **MCP**: `ticket_crear` (ya activa), `ticket_detalle`, `ticket_actualizar`,
  `ticket_comentar` (nota interna).
- El shell pinta cada navegación en su propio contenedor: una pantalla lenta ya
  no escribe encima de la siguiente.

## Cómo decide el correo

1. Del mismo hilo que un ticket, o con `[#numero]` en el asunto → comentario
   del cliente en ese ticket.
2. Boletines, respuestas automáticas y remitentes `no-reply` → descartados
   (quedan apuntados en la bandeja con el motivo).
3. De un contacto o cliente con ese correo → ticket nuevo.
4. El resto → bandeja (`#/tickets/bandeja`): crear ticket, añadir a uno o
   descartar.

Solo se leen los de la bandeja principal de Gmail; el buzón no se modifica
(no se marca ni se etiqueta nada).

## Lo que no se hace (a propósito)

- El hub no escribe en la app: si alguien cambia un ticket en la app, el hub
  no se entera (solo se importan las altas). Por eso se deja de usar allí.
- El hub no manda WhatsApp (la API de WhatsApp es de la app): abre `wa.me` con
  el texto y lo manda la persona.
- El SLA no se pausa en `Pendiente`.

## Falta (de Fran, ver `PENDIENTE_FRAN.md`)

- Delegación de dominio en Google Workspace para la cuenta de servicio
  (ID de cliente `117092961908352521785`, permiso
  `https://www.googleapis.com/auth/gmail.modify`) y activar la API de Gmail en
  el proyecto de Google Cloud 508620194342.
- Decirle al equipo que los tickets se llevan ya en el hub.
