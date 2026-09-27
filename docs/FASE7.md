# Fase 7 · Portal de clientes

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Hecha en una
entrega (2026-09-27).

## Decisiones de Fran

- El cliente ve: **tickets** (abrir y seguir), **presupuestos y facturas**
  (ver, descargar, aceptar presupuestos, lo pendiente), **mantenimiento** y el
  **estado de sus equipos**.
- Entra con **enlace mágico por correo**, enviado desde el Gmail de la empresa,
  solo si su correo está **invitado**; accesos revocables y con traza.
- Dominio: `clientes.okcomputertenerife.com`.

## Cómo está hecho

- **Los clientes no son usuarios del hub.** No tienen cuenta en Supabase Auth
  ni tocan PostgREST: todo pasa por la función `portal` (SIN_JWT), que filtra
  cada respuesta por el cliente del acceso. Sesión propia de 30 días en la
  cabecera `x-portal-token`; enlaces de un solo uso de 30 minutos. En la base
  solo se guardan huellas sha256 de enlaces y sesiones.
- **Migración `20261011_portal.sql`** (aplicada): `hub.portal_accesos`
  (invitados; revocar cierra sesiones y enlaces), `portal_enlaces`,
  `portal_sesiones`, `portal_traza` (todo lo que hace cada acceso),
  `portal_aceptaciones` (presupuestos aceptados). Y el gancho
  **`hub.avisos_extra()`**: el motor de avisos lo llama, así las fases
  siguientes añaden avisos redefiniendo solo esa función.
- **Página `portal.html`** (entrada aparte de Vite, `src/portal/`): inicio con
  cifras, tickets (sin las notas internas, que la función no devuelve nunca),
  abrir aviso, escribir, presupuestos (PDF y aceptar escribiendo su nombre),
  facturas (lo pendiente y el PDF de Zoho), mantenimiento por sede y equipos
  de Breeze. En `clientes.okcomputertenerife.com` el `index.html` redirige a
  `/portal.html`, así no hace falta un segundo sitio de Firebase.
- **Pantalla del equipo `#/portal`** (solo admins): invitar (con el correo del
  contacto), generar un enlace para mandarlo a mano (por WhatsApp, mientras el
  correo no esté conectado), revocar/reactivar, la traza y los presupuestos
  aceptados pendientes de pasar a la app.
- **Aceptar un presupuesto** no lo cambia en la app (el hub no le escribe):
  queda en `portal_aceptaciones`, sale en avisos (`presupuesto_aceptado_portal`)
  y llega por Telegram a los admins vinculados. Una persona lo pasa a aceptado
  en la app y lo marca como hecho en `#/portal`.
- **Seguridad**: pedir enlace responde igual exista o no el correo (no se
  puede averiguar quién es cliente) y como mucho 5 enlaces por hora y correo.

## Lo que no está

- Contratos firmados (viven en la app, que no se copia): se enseña el plan de
  mantenimiento de cada sede. Se añadirá cuando se porte la firma (fase 10).
- Pagar desde el portal (Stripe es de la app).

## Falta (de Fran, ver `PENDIENTE_FRAN.md`)

- Lo mismo que el Desk: la delegación de Gmail (sin ella, los enlaces se
  generan a mano en `#/portal`).
- Permiso `ZohoBooks.estimates.READ` en el Self Client de Zoho (PDF de los
  presupuestos) además de los de facturas.
- DNS de `clientes.okcomputertenerife.com` y la variable `PORTAL_URL`.
