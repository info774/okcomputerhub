# Fase 4 · Ventas: cliente 360, oportunidades, cobros y mapa

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md`. Hecha en una entrega (2026-09-27).

## Decisiones de Fran (2026-09-27)

- **Clientes, contactos y sitios siguen mandando en la app.** Los usa toda la
  app (trabajos, tickets, mantenimiento, Zoho): si pasaran al hub, la app no
  vería lo nuevo. El hub pone encima su CRM y se editan en la app hasta que
  trabajos y tickets pasen al hub.
- **Las oportunidades pasan al hub** (área `oportunidades`, dueño `hub`). En
  la app se deja de usar su pantalla de Oportunidades.
- **Recordatorios de cobro: aviso interno + mensaje preparado.** Nada sale
  solo hacia el cliente.
- **Sin importación de Zoho CRM** (no hay datos que traer).

## Qué hay

- **Migración `20261008_ventas.sql`** (aplicada):
  - `hub.pipelines`: embudos configurables; el de por defecto, «Ventas», lleva
    las etapas de la app (Detectado → Contactado → Propuesta → Negociando →
    Ganado / Perdido) con su probabilidad.
  - `hub.oportunidades`: mismas columnas que la app + `pipeline_id`, `orden`,
    `updated_at` y `cerrada_at` (la pone un trigger al ganar o perder). La
    etapa tiene que existir en su embudo. Borrar: solo admins.
  - **Altas que sigue creando la app**: `hub.areas.importar_altas`. El
    formulario de las webs y el WhatsApp siguen creando oportunidades en la
    app; `sync-app` las inserta en el hub (sin pisar nunca lo editado aquí).
    Copia inicial: 9 oportunidades.
  - `hub.actividades`: la línea de tiempo (nota, llamada, visita, email,
    WhatsApp, reunión), por cliente y/o oportunidad, siempre a nombre de quien
    la apunta.
  - `hub.clientes_crm`: lo que el hub añade al cliente de la app (clase a mano,
    «lo siguiente» con fecha y responsable, etiquetas).
  - `hub.clases_clientes()`: clase A/B/C por Pareto de lo facturado en Zoho en
    12 meses (A = el 80 %, B = el 15 % siguiente, C = el resto); sin Zoho, por
    trabajos del año. La clase puesta a mano manda. No devuelve importes.
  - `hub.linea_tiempo(cliente)`: actividades + trabajos, tickets,
    presupuestos, oportunidades y, solo admins, facturas y cobros de Zoho.
  - `hub.cobros_recordatorios` + `hub.preparar_recordatorios()` (pg_cron
    `hub-recordatorios`, 7:20 UTC): a los 7, 21 y 45 días de vencida una
    factura se prepara el 1.º, 2.º o 3.er aviso con la plantilla de
    `hub.config` (`recordatorio_primero|segundo|tercero`, `recordatorio_dias`).
    Pagada la factura, lo pendiente se descarta solo.
  - Motor de avisos: lead sin contestar (24 h en Detectado sin actividad),
    seguimiento vencido, «lo siguiente» vencido y (admins) recordatorio de
    cobro listo.
- **Pantallas**:
  - `#/clientes` (sustituye el enlace a la app) y la ficha 360 `#/clientes/<id>`:
    Resumen («lo siguiente», apuntar lo de hoy, clase, lo abierto y, para
    admins, el dinero de Zoho), Actividad (línea de tiempo con filtros), Sedes
    (plan, cobro, TPV y equipos), Contactos (llamar, WhatsApp, email),
    Oportunidades. «Editar en la app» para los datos del cliente.
  - `#/oportunidades`: embudo con arrastre, lista, previsión (valor ×
    probabilidad por mes de seguimiento; ganado en 90 días y tasa), ficha
    (etapas, actividad, lo vinculado en la app) y, para admins, «Configurar
    embudos».
  - `#/cobros` (solo admins): recordatorios listos con el texto editable y
    botones de WhatsApp (`wa.me` con el texto), email (`mailto:`), llamar y
    copiar; marcar enviado o descartar. Además, vencidas que aún no llegan al
    primer aviso y mantenimiento torcido de la app.
  - `#/mapa`: sedes con ubicación y capas Equipos, Cobro, Clase A/B/C y
    Oportunidades (Leaflet con mosaicos de OpenStreetMap, se carga solo al
    abrir la pantalla).
- **MCP**: `cliente_linea_tiempo`, `oportunidades_listar` (lectura),
  `actividad_apuntar`, `cliente_siguiente`, `oportunidad_crear`,
  `oportunidad_actualizar` (escritura).
- Arnés `verify-ventas.mjs` y pruebas en `probar-migraciones`.

## Lo que queda

- **En la app, dejar de usar la pantalla de Oportunidades** (regla de equipo:
  no se toca su código). Lo que se cree allí a mano también entraría al hub,
  pero lo que se EDITE allí ya no llega.
- **Convertir una oportunidad en presupuesto o trabajo** sigue en la app (son
  áreas de la app): se crea allí eligiendo la oportunidad y el hub lo enseña
  en su ficha.
- `hub.leads_web` del plan no hace falta: los leads son oportunidades con
  origen `web`/`whatsapp`. Si algún día el formulario escribe directamente en
  el hub, cambia solo el `SITIOS` de la función de la app.
- Recordatorios automáticos por correo o WhatsApp: cuando se decida la cuenta
  de correo (pregunta abierta del plan) y haya plantilla de Meta.
- Necesita Zoho conectado (fase 3) para la clase por facturación, el dinero
  de la ficha, los recordatorios y la capa de cobro del mapa.
