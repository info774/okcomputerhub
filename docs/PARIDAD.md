# Paridad con la app actual

El hub tiene que hacer **todo lo que hace la app actual** (`okcomputerclaude`),
también lo que se le añada en el futuro, y además lo suyo propio, hasta el día
en que la sustituya. Mientras tanto las dos avanzan en paralelo y la app sigue
siendo la de uso diario: el hub no la interrumpe ni la molesta (decisión de
Fran, 2026-10-03).

**Revisado hasta**: `73b8ff6` (2026-10-02) — «WhatsApp: fotos y vídeos del cliente al ticket, con descripción de la IA (#161)». Comprobado de nuevo el 2026-10-05: la app no tiene commits nuevos en `main` desde entonces.

## Cómo se usa

- **Lo nuevo de la app** se trae con el comando **`/paridad`**, solo cuando Fran
  lo pide (`.claude/commands/paridad.md`). Si el área ya está en el hub, se porta,
  se fusiona y se despliega; si no, se apunta en su fila. Al terminar se pone al
  día «Revisado hasta».
- **Prioridad**: primero completar la paridad (lo que está en *Enlace*, *Falta*
  o *Solo lectura*); el desarrollo propio, después o cuando Fran lo pida.
- **Paridad sin cortar**: mientras un área sea de la app (`hub.areas`, dueño
  `app`), el hub la enseña en solo lectura y deja **preparadas** sus
  escrituras (funciones de la base con `hub.exigir_area()`, como `hub.fichar`):
  se encienden el día del corte de esa área, que necesita el OK de Fran. Así la
  app sigue mandando y nadie del equipo nota nada.
- Estados: **Hecho** (el hub lo hace y manda) · **Preparado** (hecho en el hub,
  se enciende con el corte) · **Solo lectura** (se ve en el hub, se edita en la
  app) · **Enlace** (el hub abre la app) · **Falta** · **No aplica** (con motivo).

## Bloques de paridad (orden propuesto)

1. **Trabajos y calendario completos** — tanda 1 HECHA (2026-10-03: alta y
   edición Simple/Completa, duplicar, continuación, kanban, Excel y espejo
   trabajo ⇄ agenda) y tanda 2 HECHA (calendario planificador: vistas, carga,
   solapes, traslados, pendientes, «Sugerir hueco», citas y días) y tanda 3
   HECHA (lista del día con su espejo y el planificador hoy/mañana) y tanda 4
   HECHA (firma del cliente, parte imprimible en PDF y plantillas de trabajo)
   y tanda 5 HECHA (chat por ficha y tablero de notas con nota de voz).
   **Bloque 1 HECHO** (2026-10-03), salvo lo que espera al corte final.
2. **Clientes, sedes y contactos con escritura**: alta y edición (NIF, Google
   Maps), baja/reactivar, pestañas Software, Hardware y Cámaras, teléfonos con
   rol, Excel; y lo que escribe en Zoho (alta de cliente). Decisiones de Fran
   (2026-10-03): Zoho igual que la app; Google Maps en la tanda 4. Tandas:
   1 clientes (HECHA 2026-10-03), 2 sedes (HECHA 2026-10-03), 3 Software/Hardware/Cámaras (HECHA 2026-10-03; decisiones de Fran:
   RustDesk con la contraseña de la sede como la app, contraseñas de cámaras tras «Ver», seguimiento solo marcar),
   4 contactos y Google Maps (HECHA 2026-10-03; decisiones de Fran: la MISMA clave de
   Places que la app, con okhub-tenerife.web.app en sus webs permitidas, y cliente
   rápido como mini formulario dentro del trabajo). **Bloque 2 HECHO** (2026-10-03),
   preparado para el corte del área `clientes`.
3. **Presupuestos y facturar trabajos**: crear con líneas del catálogo,
   plantillas, PDF, a Zoho, convertir en trabajo; facturar trabajos en Zoho.
   **Bloque 3 HECHO** (2026-10-03), preparado para el corte de `presupuestos`
   (y de `trabajos` para facturar): tanda 1 presupuestos con escritura
   (`20261023_presupuestos.sql`), tanda 2 a Zoho y tanda 3 facturar (función
   `zoho-ventas`). Falta que Fran amplíe los permisos del Self Client de Zoho
   (PENDIENTE_FRAN §5).
4. **Mantenimiento y cobros**: Stripe (domiciliar, enlace de pago, cambiar plan,
   abonos), libro de cuotas, contratos con firma y pago, renovaciones, tabla
   maestra de Locales. Decisiones de Fran (2026-10-04): Stripe «preparado, sin
   conectar» (pantallas y funciones portadas con los botones apagados; el
   webhook de Stripe sigue en la app hasta el corte, para no emitir dos
   facturas) y contratos «igual que la app» (misma plantilla y cláusulas, firma
   pública con pago en el mismo enlace, renovaciones). Tandas: 1 mantenimiento
   sin dinero (HECHA 2026-10-04: Resumen, tabla maestra y ficha de cada sede,
   Checklist, Seguimiento, Plantillas, «+ Contrato» y checklist de la visita en
   el trabajo; `20261024_mantenimiento.sql`, área `mantenimiento`), 2 contratos
   y firma (HECHA 2026-10-04: Documentos con renovaciones, generar/editar con el
   documento literal de la app, enlace, firmado, página pública `contrato.html`
   y función `firma-contrato`; `20261025_contratos.sql`), 3 motor de Stripe sin
   conectar (HECHA 2026-10-04: pestaña Cobros, funciones `stripe-suscripcion`
   y `stripe-webhook` desplegadas y SIN registrar en Stripe, pago tras firmar;
   `20261026_cobros.sql`; lo que falta para encenderlo, en PENDIENTE_FRAN
   §8 bis), 4 cartera vieja de Zoho Billing (HECHA 2026-10-04: función
   `zoho-cartera` con comprobar, listar, vincular y el repaso diario por
   pg_cron, que no escribe hasta el corte; «Comprobar en Zoho» en Cobros y
   suscripciones de Zoho Billing en la ficha del cliente; `20261027_zoho_cartera.sql`).
   **Bloque 4 HECHO** (2026-10-04), preparado para el corte de `mantenimiento`
   (y de `clientes`): falta lo de Fran (PENDIENTE_FRAN §5 y §8 bis).
5. **WhatsApp completo**: webhook con menú y horario, medios, plantilla fuera de
   24 h, mandar documentos, enlaces rápidos, de WhatsApp a ticket.
   Decisiones de Fran (2026-10-04): el webhook y el conector del Agente de Meta,
   **preparados y sin conectar** (Meta sigue apuntando a la app hasta el cambio
   de WhatsApp); mandar documentos desde el hub, **igual que contestar** (lo
   cubre el permiso de escribir en `wa_*` de la app).
   Tanda 1 HECHA (2026-10-04): bandeja completa (documentos, medios, enlaces
   rápidos, chip del plan) y «Desde WhatsApp» (pegado o captura → ticket o
   trabajo). Tanda 2 HECHA (2026-10-04): el webhook preparado y sin conectar
   (espejos `wa_*`, adjuntos del ticket, órdenes del equipo, corte en
   `supabase/cortes/corte_whatsapp.sql`). Tanda 3 HECHA (2026-10-04): el
   conector del Agente de Meta, preparado. **Bloque 5 HECHO** (2026-10-04),
   preparado para el cambio de WhatsApp: falta lo de Fran (PENDIENTE_FRAN §1
   quater y §1 quinquies, y `GROQ_API_KEY` §3).
6. **Sistema**: usuarios y modo empleado, deshacer, cola offline, historial por
   ficha, configuración, push y APK, aviso de versión.
   Decisiones de Fran (2026-10-04): push web además de Telegram; las pestañas
   no hacen falta (las cubre el modo escritorio); la APK, para el corte final.
   Tanda 1 HECHA (2026-10-04): usuarios, modo empleado y registro de cambios.
   Tanda 2 HECHA (2026-10-04): aviso de versión, F5, tamaño del texto,
   privacidad y configuración. Tanda 3 HECHA (2026-10-04): deshacer, cola sin
   red (también el fichaje) y la última copia de las lecturas. Tanda 4 HECHA
   (2026-10-05): avisos push en el dispositivo y Feedback con cola para Claude
   (decisión de Fran: pantalla + cola en el hub, sin GitHub). **Bloque 6
   HECHO** (2026-10-05); la APK, en el corte final.
7. **Resto**: inventario completo (albaranes, historial, Excel), VeriFactu,
   facturas de compra, gastos y cobros de la app, control de equipos, Google
   (Calendar, Contactos, Drive).
   Decisiones de Fran (2026-10-05): gastos y cobros de la app, UNIFICADOS en
   Personas → Gastos (con el OCR); VeriFactu, listo para el cambio (se edita
   en la app hasta su OK); control de equipos, se VE ya lo que comprueba la app
   y la pasada propia queda preparada sin encender; Google Calendar (capa de
   solo lectura) funcionando ya, Contactos y Drive listos para el cambio.
   Tanda 1 (inventario completo), 2 (facturas de compra, del hub, y gastos y
   cobros en Personas), 3 (VeriFactu), 4 (control de equipos) y 5 (Google)
   HECHAS el 2026-10-05. **Bloque 7 HECHO**: falta lo de Fran (claves de
   Action1, permiso de Calendar y carpeta de Drive, PENDIENTE_FRAN §2 ter).
8. **Lo que quedaba en «Falta»** (propuesto el 2026-10-05): 1 tickets
   completos, 2 mapa planificador (Día, Semana, Ruta, técnicos por GPS),
   3 entrada de ventas (formulario de las webs, captación de leads, aceptar el
   presupuesto en el portal), 4 catálogo y conocimiento con escritura, escáner
   y guía de cámaras, 5 chat (tonos, bandeja de avisos), backup propio y
   limpieza de filas. Decisiones de Fran (2026-10-05): ese orden; las tareas
   del ticket, como la app (preparadas para el corte de `tareas`); la
   resolución del ticket, a la wiki del hub; formulario de las webs y
   captación, preparados sin conectar.
   Tanda 1 HECHA (2026-10-05): tareas del ticket, duplicar, ticket a trabajo,
   resolución a la wiki y ticket desde una alerta de Breeze
   (`20261104_tickets_completos.sql`). Tanda 2 HECHA (2026-10-05): el
   planificador del Mapa (Día, Semana con arrastrar y soltar, Ruta y técnicos
   fichados). Tanda 3 HECHA (2026-10-05): formulario de las webs y captación
   de comerciales, preparados sin conectar (funciones `formulario-web` y
   `captar-lead`, `captacion.html`, snippets en `docs/formularios-web/`), y la
   aceptación del presupuesto en el portal, preparada para el corte.

## El mapa

### 1. Clientes y sedes

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Lista de clientes con filtros (`modules/clientes.js`) | Solo lectura | `#/clientes` | Corte del área `clientes`. |
| Alta/edición de cliente con Zoho (`saveCliente`, `push-cliente-to-zoho`) | Preparado | `#/clientes/nuevo`, `#/clientes/<id>/editar` (`clientes/formulario.ts`); función `clientes` (`zoho_alta`, inerte hasta el corte) | Permisos de escritura de contactos en el Self Client de Zoho (PENDIENTE_FRAN §5). |
| Eliminar cliente y quitarlo de Zoho (`delete-cliente-from-zoho`) | Preparado | Ficha → «Eliminar» (admin), función `clientes` (`zoho_quitar`) | Ídem. |
| Dar de baja y reactivar cliente o sede | Preparado | Ficha → «Dar de baja» / «Reactivar»; «De baja» en la lista (clientes y sitios) | Corte del área `clientes`. |
| Empresa por NIF y NIF duplicado (`lookup-nif`) | Hecho | «🔎 Buscar el nombre» del formulario (función `clientes`, acción `nif`); con NIF repetido no se crea | — |
| Cliente o sede desde Google Maps (`google-places.js`) | Preparado | «🔎 Buscar en Google Maps» (`src/ui/maps.ts`, solo Tenerife) en el alta/edición de sede y en la sede rápida del trabajo; aviso de sede de nombre parecido (≥ 80 %) | Que Fran añada el hub a las webs de la clave (PENDIENTE_FRAN §2 bis). Corte. |
| Sync de clientes y presupuestos desde Zoho (`sync-zoho*`, `sync-auto.js`) | Falta | — | Hoy entra por la app y el hub copia. |
| Ficha del cliente (General, Locales, Contactos, Historial) | Solo lectura | `#/clientes` (ficha 360) | Editar datos. |
| Suscripción de Zoho Billing a una sede (`list-zoho-subscriptions`) | Falta | — | Cartera vieja. |
| Lista de sitios, etiqueta RMM, Excel, AnyDesk/RustDesk (`modules/locales.js`) | Preparado | `#/sitios` (Excel con AnyDesk, «+ Nuevo sitio», enlace de AnyDesk en la fila); alta y edición en `#/sitios/nuevo[/<cliente>]`, `#/sitios/<id>/editar` (`sitios/formulario.ts`); ficha → «🖥 Remoto» (AnyDesk de hardware + software y RustDesk de Breeze con la contraseña de la sede de `rmm_despliegues`) | Corte del área `clientes`. Importar sitios desde Excel (`importSitiosExcel`). |
| Ficha del sitio: Info (renombrar, cliente, contacto) | Preparado | Ficha → «✎ Editar»; «Eliminar» (admin, se lleva sus teléfonos); «+ Nueva sede» en la ficha del cliente | Corte del área `clientes`. |
| Ficha del sitio: Software y Hardware (`loadSoftware`, `hwAutoGarantia`) | Preparado | Pestañas Software y Hardware (`sitios/equipamiento.ts`; certificado y garantía con aviso a 30 días; garantía = instalación + 1 año); espejos `20261022_sitio_equipamiento.sql` | Corte. El disparador que sube el certificado a `locales.cert_caducidad` va con la ficha de mantenimiento (bloque 4). |
| Ficha del sitio: Cámaras | Preparado | Pestaña Cámaras (contraseña oculta tras «Ver») | Corte. |
| Ficha del sitio: Alarma (código oculto) | Preparado | `#/sitios` (se edita en el formulario) | Corte. |
| Teléfonos de la sede con rol (`local_telefonos`) | Preparado | Ficha del sitio → «Teléfonos» (añadir, rol en la fila, editar, quitar); espejo `20261021_local_telefonos.sql` (pasada nocturna) | Corte. |
| Ficha del sitio: Historial | Solo lectura | `#/sitios` | — |
| Seguimiento de tareas de la sede (`loadSeguimientoLocal`) | Preparado | Pestaña Seguimiento (rejilla por periodo; marcar/desmarcar) sobre los espejos `plan_tareas` y `sitio_tarea_seguimiento` | Corte. Editar el catálogo de tareas por plan (bloque 4). |
| Agenda de contactos (`modules/contactos.js`) | Preparado | `#/contactos` (+ Nuevo contacto, ✎ Editar, Dar de baja/Reactivar); `#/contactos/nuevo[/c/<cliente>|/l/<sede>]` y `#/contactos/<id>/editar` (`contactos/formulario.ts`); empleados solo admin | Corte. Renombrar al usuario si es empleado, favoritos por persona (`user_favoritos`) y Google Contactos (bloque 7). |
| Google Contacts (`google-contacts.js`) | Preparado | Al crear o editar un cliente, la función `google` (acción `contacto`) lo guarda en los Contactos de info@ y apunta `google_contact_id` (delegación con el permiso de contactos, que ya está) | Corte del área `clientes` (hasta entonces lo hace la app; la función contesta 409). |
| Mapa de sedes con estado RMM (`modules/mapa.js`) | Hecho | `#/mapa` | — |
| Mapa: Día, Semana (planificador), Ruta, técnicos por GPS | Hecho / Preparado | `#/mapa` → panel Día · Semana · Ruta y técnicos fichados (`mapa/planificador.ts`); se ve ya | Arrastrar en la Semana: corte de `trabajos` y `agenda`. Sin geocodificar en Nominatim: el hub usa las coordenadas que la app guarda en `locales.lat/lng`. |

### 2. Trabajos y calendario

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Lista de trabajos, filtros, kanban, Excel (`modules/trabajos.js`) | Preparado | `#/trabajos` (lista, kanban y Excel ya hoy; arrastrar en el kanban cambia el estado tras el corte) | Corte. |
| Crear y editar trabajo (Simple/Completa), duplicar, continuación | Preparado | `#/trabajos/nuevo`, `#/trabajos/<n>/editar`, `trabajos/formulario.ts`; espejo trabajo ⇄ agenda en `20261017_trabajos_paridad.sql`; «+ Nuevo cliente» y «+ Nueva sede» al vuelo (con el área `clientes` cortada) | — |
| Ficha: estado, comentarios, material con stock (`saveWdLineas`); completar cierra sus tickets y propone «Para facturar» | Preparado | `#/trabajos`, `hub.trabajo_estado`, `hub.trabajo_guardar_lineas` | Se enciende con el corte. |
| Material con escáner de código de barras | Falta | — | Escáner. |
| Fichajes del trabajo con edición en línea | Solo lectura | `#/trabajos` | Correcciones por `hub.jornada_ajustes`. |
| Fotos del trabajo (a Drive con descripción) | Preparado | `#/trabajos`, `trabajo-foto` | Va a Storage, no a Drive. |
| Firma del cliente y PDF del parte (`saveFirma`, `generatePDF`) | Preparado | `trabajos/firma.ts` (lienzo a pantalla completa → `firma_cliente`), `#/trabajos/<n>/parte` (`parte.ts`, imprimir o guardar en PDF) | El parte no se guarda en Drive (la app lo sube si hay sesión de Google). |
| Guía de instalación de cámaras | Falta | — | — |
| Plantillas de trabajo (`modules/plantillas.js`) | Preparado | `#/trabajos/plantillas`, selector en el alta; espejo en `20261019_plantillas_trabajo.sql` (área `trabajos`) | Los pasos se guardan pero, como en la app, no pasan al trabajo. |
| Chat de grupo por trabajo/ticket/tarea | Hecho | «💬 Chat» en las fichas de trabajo, ticket, tarea, presupuesto y oportunidad → `hub.chat_ficha` (`20261020_tablero_chat_ficha.sql`, `ui/chat-ficha.ts`); en `#/chat`, «Abrir la ficha» | Las salas de la app no se traen: el chat del hub empieza vacío. |
| Borrar trabajo devolviendo el material | Preparado | trigger de `20261016_final.sql` | — |
| Agenda por bloques y eventos libres (`modules/agenda.js`) | Preparado | `#/calendario/cita`, `#/calendario/dia/<trabajo>` (días de la ficha del trabajo), `calendario/cita.ts` | Corte. |
| Calendario semanal con fichajes reales (`modules/calendario.js`) | Preparado | `#/calendario` (Semana y Por técnico; mover y reasignar arrastrando) | Corte. |
| Calendario: Mes, Día, Agenda, filtros guardados, alta rápida | Preparado | `#/calendario` (Día con rejilla por técnico; «+ Cita»; ir a fecha en vez de mini-mes) | Zoom, redimensionar arrastrando el borde, colores por estado. |
| Calendario: pendientes, «Sugerir hueco», traslados, solapes, carga del día | Preparado | `calendario/motor.ts` (mismas constantes que la app) y panel de pendientes | Origen de los traslados: oficina con coordenadas fijas (la app geocodifica la dirección de la empresa). |
| Capa de Google Calendar (`google-calendar-read.js`, `google-token`) | Hecho | Casilla «Google» del calendario: los eventos del calendario de la empresa (info@) y el tuyo si tienes correo de la empresa, SOLO LECTURA, en Semana, Día, Agenda y Mes (función `google`, acción `calendario`) | El permiso `calendar.readonly` en la delegación de dominio (PENDIENTE_FRAN §2 ter); mientras, el calendario lo dice. Quien entra con Gmail personal ve el de la empresa, no el suyo. |
| Lista del día (`modules/lista-dia.js`, `lista_dia`) | Preparado | `#/lista-dia`, `lista-dia/vista.ts`; espejo, `hub.lista_dia_marcar` y limpieza al borrar el origen en `20261018_lista_dia.sql`; casilla en el alta de trabajo | — |
| Planificador hoy/mañana (`ui/plan-dia.js`) | Preparado | `#/lista-dia/planificar` (hoy, mañana, +7 d; la hora se mueve con la fecha) | — |
| Modo calle (`ui/calle.js`) | Preparado | `#/hoy`, `hub.fichar`, `trabajo-foto` | Se enciende con el corte. |
| Fichaje traslado → inicio → fin (`ui/fichaje.js`) | Preparado | `#/hoy` (y Enlace «Fichaje y horas») | Botón + global; fichar tareas y tickets. |
| Tablero de notas de texto y voz (`modules/tablero.js`) | Preparado | `#/tablero` (nota de voz con `ui/dictado.ts` → `comandas` `transcribir`); solo las propias (RLS en `20261020`); lo indexa `#/buscar` | — |

### 3. Tickets / Desk

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Lista y kanban de tickets, Excel | Hecho | `#/tickets` | Kanban y Excel. |
| Ficha del ticket, comentarios y estado | Hecho | `#/tickets` | — |
| Adjuntos, también fotos y vídeos de WhatsApp descritos por IA (`ticket_adjuntos`; la app lo amplió el 2026-10-02, `73b8ff6`) | Hecho | `hub.ticket_adjuntos` (área `tickets`, las altas de la app entran por el sync) y la lista «Adjuntos» de la ficha del ticket, con la foto en miniatura | Subir un fichero desde la ficha. |
| Tareas dentro del ticket | Preparado | Ficha del ticket → «Tareas» (`tickets/extra.ts`): se ven ya | Crear: corte del área `tareas`. |
| Ticket a trabajo, duplicar ticket | Hecho / Preparado | Ficha del ticket: «Duplicar» (vale ya) y «Crear trabajo desde el ticket» (lo enlaza y lo cierra) | A trabajo: corte del área `trabajos` (hasta entonces, vincular por número). |
| Resolución a Conocimiento | Hecho | Ficha del ticket → «Guardar en la wiki» (una página por ticket bajo «Resoluciones», decisión de Fran 2026-10-05) | — |
| Ticket desde una alerta del RMM (`rmmTicketDeAlerta`) | Hecho | Monitorización → Alertas (y la del equipo y la sede): «Abrir ticket»; el enlace en `hub.tickets.rmm_alerta_id`, uno por alerta | — |

### 4. Ventas y presupuestos

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Oportunidades: embudo, lista, ficha | Hecho | `#/oportunidades` | — |
| Oportunidad a presupuesto, trabajo o tarea | Preparado (presupuesto) | Ficha de la oportunidad → «📄 Crear presupuesto» (`#/presupuestos/nuevo/o/<id>`) | A trabajo o tarea. |
| Formulario de las webs (`formulario-web`) | Preparado | Función `formulario-web` del hub (SIN_JWT) y los snippets en `docs/formularios-web/` | Conectar: pegar el snippet del hub en cada web (PENDIENTE_FRAN §2 quater). Hasta entonces entra por la app y se importa. |
| Captación de leads de comerciales (`captacion.html`, `captar-lead`) | Preparado | `captacion.html` + función `captar-lead` del hub (SIN_JWT, ID token de Google) | Añadir el origen del hub al cliente OAuth y pasar el enlace a los comerciales (PENDIENTE_FRAN §2 quater). |
| Lista de presupuestos | Preparado | `#/presupuestos` (+ Nuevo presupuesto, Plantillas) | Corte del área. |
| Crear y editar presupuesto con catálogo | Preparado | `#/presupuestos/nuevo[/c/<cliente>|/o/<oportunidad>]`, `#/presupuestos/<id>/editar` (`presupuestos/formulario.ts`, editor `lineas.ts`); líneas por `hub.presupuesto_guardar_lineas` (pone el total); duplicar; eliminar solo admin | Corte. |
| Plantillas de presupuesto | Preparado | `#/presupuestos/plantillas` (espejo `presupuesto_plantillas`; varias se juntan al crear) | Corte. |
| PDF del presupuesto | Hecho | `#/presupuestos/<id>/pdf` (imprimible con IGIC y condiciones; vale ya) | — |
| Presupuesto a Zoho (`send-to-zoho-estimate`) | Preparado | Ficha → «📤 Enviar a Zoho» (función `zoho-ventas`, acción `presupuesto`) | Corte y permisos de Zoho (PENDIENTE_FRAN §5). |
| Presupuesto a trabajo | Preparado | Ficha (aceptado) → «🛠 Convertir en trabajo» (`hub.trabajo_desde_presupuesto`, copia las líneas) | Corte de `trabajos`. |
| Aceptación por el cliente | Preparado | `portal` (`presupuesto_aceptar`) | Con el corte de `presupuestos`, aceptar en el portal lo pasa solo a «Aceptado»; hasta entonces se pasa a mano en la app. |

### 5. Mantenimiento y cobros

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Resumen (garantías, visitas, cuotas a 90 días, renovaciones) | Preparado | `#/mantenimientos` (cifras, por plan, requieren atención, próximas visitas, renovaciones a 2 meses, garantías ≤ 30 d) | Corte. |
| Locales: tabla maestra (`mant-ficha.js`) y ficha `fm-` | Preparado | `#/mantenimientos/locales` (certificado, copia y control horario editables en la fila; filtros de ficha) y `#/mantenimientos/ficha/<id>` (teléfonos con rol, código); disparadores del código y del certificado en `20261024_mantenimiento.sql` | Corte del área `clientes`. |
| «+ Contrato» (`openNewMant`, `saveMantenimiento`) | Preparado | `#/mantenimientos/alta[/<id>]` (`alta.ts`): plan, cuota neta, frecuencia y próxima revisión; a una sede en Stripe no se le toca la cuota | Corte de `mantenimiento` y `clientes`. |
| Cobros con Stripe (`mant-cobros.js`, `stripe-suscripcion`) | Preparado | `#/mantenimientos/cobros` (solo admin: cifras, sedes con sus botones, filtros, buscador, enlace de pago, cambiar plan, pausar, baja, desvincular de Zoho, ajustes) + función `stripe-suscripcion` (409 hasta el corte) | Corte de `mantenimiento` y las claves de Stripe (PENDIENTE_FRAN §8 bis). |
| Libro de cuotas, «Emitir en Zoho», abonos | Preparado | Libro en Cobros y en la sede (`/cobros/sede/<id>`), abonar (`/cobros/abonar/<id>`); espejos `mant_facturas`, `mant_abonos` y los contadores de serie | Corte (y los permisos nuevos de Zoho, PENDIENTE_FRAN §5). |
| Webhook de Stripe → factura MANT- en Zoho | Preparado | Función `stripe-webhook` (SIN_JWT, firma de Stripe; sin el corte no toca nada) | Registrarla en Stripe el día del corte (PENDIENTE_FRAN §8 bis). |
| Cartera vieja de Zoho Billing (`sync-zoho-subscription*`, `list-zoho-subscriptions`) | Preparado | Función `zoho-cartera` (comprobar, listar, vincular, `diario` a las 4:10 UTC por pg_cron); «Comprobar en Zoho» en Cobros (consulta ya; guarda tras el corte), «Desvincular», y «Zoho Billing» en la pestaña Sedes del cliente | Corte de `clientes` y `mantenimiento`; permisos ZohoSubscriptions en el Self Client (PENDIENTE_FRAN §5). |
| Checklist, Seguimiento (kanban), Plantillas de planes | Preparado | `#/mantenimientos/checklist` (tareas del plan por periodo), `/seguimiento` (kanban con arrastre y formulario), `/plantillas` (planes solo admin, sus tareas y checklists de visita) | Corte de `mantenimiento` (y `clientes` para marcar tareas). |
| Checklist de la visita en el trabajo (`loadChecklistForTrabajo`) | Preparado | Ficha del trabajo (`trabajos/checklist-visita.ts`, espejo `checklist_respuestas` en el área `trabajos`) | Corte de `trabajos`. |
| Contratos: generar, editar, firmar, renovaciones | Preparado | `#/mantenimientos/documentos` (contratos, renovaciones con preaviso, avisado, no renovar; insignia), `#/mantenimientos/contrato/…` (generar/editar UN formulario, borrador, enlace, firmado imprimible, anular y eliminar solo admin); el contrato de cada sede en la tabla maestra | Corte de `mantenimiento`. «Domiciliar», «Cambiar forma de pago» y «Cambiar plan» desde el contrato: con Cobros (tanda 3). |
| Firma pública con pago (`firma.html`, `firma-contrato`), `mandato.html` | Preparado | `contrato.html?token=` y `mandato.html` (entradas de Vite), función `firma-contrato` (SIN_JWT): ver, firmar (vuelca plan, cuota y frecuencia a la sede si no se cobra ya) y pagar la primera cuota con el MISMO alta que «Domiciliar»; sin el corte no firma ni cobra (409) | Corte y claves de Stripe. |
| Trabajo desde un mantenimiento (`generarTrabajoDesdeMant`) | No aplica | — | En la app no lo llama ningún botón (código muerto); las visitas se crean como trabajo de tipo Mantenimiento. |
| Ficha del sitio, pestaña «Mant.» con cobro | Preparado | Enlace «Cobro de la cuota» del resumen del sitio (admin) → `#/mantenimientos/cobros/sede/<id>` | Corte. |
| Ajustes de cobro (`mant_config`) | Preparado | `#/mantenimientos/cobros/ajustes` (serie, impuesto y cuenta de Zoho, métodos de pago) | Corte. |

### 6. Facturación

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Facturas de venta desde Zoho | Solo lectura | espejo `hub.zoho_facturas` (+ Enlace «Facturación y cobros») | Listado; credenciales de Zoho. |
| Facturar trabajos en Zoho (`send-to-zoho-invoice`, `add-to-zoho-invoice`) | Preparado | `#/trabajos/facturar/<ids>` (desde la ficha o marcando en «Por facturar»): factura nueva, añadir a un borrador o presupuesto; función `zoho-ventas` | Corte de `trabajos` y permisos de Zoho. |
| Asignar cliente a sede suelta al facturar | Preparado | La pantalla de facturar pide el cliente y se lo deja a las sedes sueltas y sus trabajos | Corte. |
| Factura o presupuesto en PDF por WhatsApp | Hecho | Chat de WhatsApp → «📎 Factura / presupuesto» (función `whatsapp`, `enviar_documento`; solo documentos de ese cliente) | Desde la lista de facturas a un teléfono suelto (el hub aún no tiene el listado de facturas). Fuera de 24 h, `WHATSAPP_PLANTILLA_DOCUMENTO` (PENDIENTE_FRAN §1 quater). |
| Tablero VeriFactu (`modules/verifactu.js`) | Preparado | `#/verifactu` (kanban por fase, carriles como filtro, plazos, casillas y lo que falta; ficha con la auditoría técnica; «Cargar sedes con TPV»; quitar solo admin), reglas copiadas en `verifactu/reglas.ts`; espejo `hub.verifactu_sedes` (`20261102_verifactu.sql`, área `verifactu`, por el incremental: 65 sedes) | Corte del área `verifactu` (decisión de Fran: listo para el cambio). |
| Facturas de compra (`facturas_compra.js`) | Hecho | Almacén → «Facturas de compra» (`#/almacen/facturas`, `almacen/facturas.ts`, `afc-`): alta con el adjunto leído por Claude (`gastos-ocr`, acción `compra`; elige el proveedor por NIF), desde un pedido, vencidas, pagada; eliminar solo admin; `hub.facturas_compra` (`20261101_compras_gastos.sql`) | Es del hub desde ya: en la app su tabla nunca llegó a producción. El adjunto va al almacén privado, no a Drive. |

### 7. Inventario y almacén

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Inventario por ubicación, movimientos, trasvases (`furgonetas.js`) | Preparado | `#/inventario` (stock por ubicación y total, libro de movimientos, ficha); alta y edición con el buscador del catálogo, «Mover» (entrada, salida, trasvase) y ubicación nueva (`inventario/escritura.ts`, `inw-`) sobre `hub.inventario_guardar` / `_mover` (`20261031_inventario.sql`: cada cambio deja su apunte) | Corte del área `inventario`. |
| Historial de una furgoneta | Hecho | `#/inventario/movimientos` filtrado por la ubicación (y los de cada producto en su ficha) | — |
| Albaranes, importar/exportar Excel | Preparado | «Excel» de la lista (vale ya, CSV como el resto del hub); «Escanear albarán» (Claude lee en `gastos-ocr`, acción `albaran`; lo ya existente suma) e «Importar» (CSV de Excel) por `hub.inventario_entradas` | Corte; el albarán necesita la clave de Claude (en la app llamaba a Anthropic sin clave). Excel nativo (.xlsx): se guarda como CSV. |
| Pedidos internos de reposición | Hecho | `#/almacen` (MRP, qué pedir) | — |
| Catálogo (editar, categorías, sync de Zoho) | Solo lectura | espejo `hub.catalogo` | — |
| Inventario → catálogo | Preparado | `hub.inventario_catalogo` (busca por nombre o referencia; si no está, crea la ficha como Hardware y la enlaza), en todo alta, trasvase o entrada | Corte. |
| Proveedores | Hecho | `#/almacen` | — |
| Pedidos de compra | Hecho | `#/almacen` | La entrada se da en la app. |
| Alta de vehículos | Preparado | `#/inventario/vehiculo` (nombre y a cargo de quién) | Corte. |

### 8. Personas, fichaje y gastos

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Mis horas | Hecho | `#/personas` (Jornada) | — |
| Informe de horas del mes | Hecho | `#/personas` | — |
| Gastos y cobros en efectivo con foto (`gastos.js`) | Preparado | Personas → Gastos (decisión de Fran: unificados con los tickets de Claude): lista del mes con trabajo, contacto y sede; «+ Gasto» (categoría, foto al almacén privado) y «+ Cobro» (descripción obligatoria), editar, eliminar solo admin; «Gasto» y «Cobro» en la ficha del trabajo (`personas/movimientos.ts`, `pm-`) | Corte del área `gastos`. |
| Usuarios: alta y activar (`configuracion.js`) | Preparado | `#/usuarios` (admin): alta, rol, teléfono del WhatsApp del equipo y activar/desactivar (nunca a uno mismo) | Corte del área `usuarios` (hasta entonces, solo lectura: se dan de alta en la app). |
| Modo empleado (menú reducido) | Hecho | `core/empleado.ts`: quien no es admin ve el menú del técnico (el de la app + comandas, tablero, wiki, buscador, reloj y monitorización); en el móvil entra a `#/hoy` | — |

### 9. Comunicación

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Chat interno en tiempo real (`chat.js`) | Hecho | `#/chat` | Tiempo real, adjuntos, historial de la app. |
| Tonos y avisos del chat | Falta | — | — |
| Push web y FCM (`push.js`, `send-*-push`) | Hecho | Web Push con VAPID propio: `core/push.ts`, «Avisos en este dispositivo» (pie del menú y Configuración, con prueba e «Instalar como app»), función `push` (`registrar`, `quitar`, `probar`, `chat`, `proximos`), `hub.push_suscripciones`; avisan comandas, chat y los avisos de WhatsApp, además de Telegram | FCM de la APK (corte final). Los trabajos en ~1 h: el cron ya llama, pero no avisa mientras la agenda sea de la app (avisa la app). |
| Bandeja de notificaciones (`inbox.js`) | Falta | (campana de avisos) | — |
| Bandeja de WhatsApp: leer y contestar (`wa-bandeja.js`) | Hecho | `shell/whatsapp.ts`, función `whatsapp`: plantilla fuera de 24 h, documentos de Zoho, fotos en la conversación y «Ver foto» pedida a Meta, enlaces rápidos (Cliente, Sede, Remoto, Ticket, Presupuesto) y chip del plan (2026-10-04) | Vincular un teléfono a una ficha (en la app). |
| Webhook de WhatsApp: menú, horario, ticket u oportunidad, órdenes del equipo, adjuntos | Preparado | Función `whatsapp-webhook` (SIN_JWT, firma de Meta) + `equipo.ts`, espejos `hub.wa_*` y `ticket_adjuntos` (`20261028_whatsapp.sql`); la ventana fija cambia sola de fuente con el área `whatsapp` | El cambio de WhatsApp (`supabase/cortes/corte_whatsapp.sql` + la URL en Meta, PENDIENTE_FRAN §1 quinquies). Avisos por Telegram en vez de push. Las órdenes del equipo que tocan trabajos, tareas o fichajes esperan a su corte (lo dicen y no escriben). |
| Agente de Meta por MCP (`meta-agente-mcp`) | Preparado | Función `meta-agente-mcp` (SIN_JWT, token `x-mcp-token`; skills LITERALES en `_shared/meta-agente-skills.ts`); «🤖 Agente de Meta» en la ventana de WhatsApp (admin: ver el estado; registrar/repuntar al hub, solo tras el cambio) | El cambio de WhatsApp y `META_AGENTE_MCP_TOKEN` (PENDIENTE_FRAN §1 quinquies, paso 5). |
| WhatsApp pegado o captura a ticket/trabajo (`parse-whatsapp`) | Hecho | `#/tickets/whatsapp` (`tickets/whatsapp.ts`, `wai-`) + función `parse-whatsapp` (Groq, el mismo prompt); abre el alta de ticket o trabajo rellena (`ui/borrador.ts`) | `GROQ_API_KEY` en el hub (PENDIENTE_FRAN §3). «Compartir» desde el móvil (share target) al hub. |
| Asistente de voz (`voice.js`, `groq-proxy`) | Falta | (notas de voz → comandas) | — |
| Repaso matinal y cierre | Hecho | `informes-enviar`, `telegram-bot` | — |
| Dictado en formularios (`dictado.js`, `transcribe-audio`) | Falta | — | — |

### 10. Monitorización

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Pestaña «Monitor.» de la sede (`rmm.js`) | Hecho | `#/monitorizacion` | Usuario de servicio de Breeze. |
| Réplica de Breeze (`breeze-sync`, `breeze-hook`) | No aplica | vistas `hub.rmm_*` | El hub lee Breeze directamente. |
| Agente OKRMM y sonda de red (`rmm-agente`) | No aplica | — | OKRMM se retira. |
| Control de equipos (`control-equipos`) | Hecho (lectura) · Preparado (pasada) | Monitorización → «Software obligatorio» (`monitorizacion/control.ts`, `mce-`: cifras, incompletos, sin sede, ignorados, IDs) y la sección de cada sede; espejo `hub.equipos_control` (`20261103_control_equipos.sql`, área `equipos`), copiado a las 6:40 UTC tras la comprobación de la app; ignorar, asignar sede y «Comprobar ahora» con el corte. Función `control-equipos` del hub (lee Breeze por las vistas `hub.rmm_*` y Action1 por API) | Corte del área `equipos` y las claves de Action1 (decisión de Fran: la pasada propia preparada sin encender). Columna «Equipos» en la tabla maestra de Mantenimientos. |
| AnyDesk de una sede | Hecho | Ficha del sitio → «Remoto» (AnyDesk de su hardware y software; RustDesk de Breeze con la contraseña al portapapeles) y en la ventana de WhatsApp | — |

### 11. Documentos

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Base de conocimiento (`conocimiento.js`) | Solo lectura | `#/buscar` | Se edita en la app; la wiki es lo nuevo. |
| Google Drive | Preparado | «Drive» en las fichas de cliente y sede: la carpeta del cliente (y la de la sede dentro) en la carpeta compartida de la empresa, buscada o creada por nombre como la app (función `google`, acción `carpeta`); Buscar indexa una carpeta | Compartir la carpeta con la cuenta de servicio (PENDIENTE_FRAN §2 ter). Las fotos y adjuntos van al almacén privado del hub, no a Drive (decidido en el bloque 1). |

### 12. Sistema

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Dashboard / Mi jornada | Hecho | `#/inicio` (Oki), `#/direccion`, `#/hoy`; «Mi lista de hoy» es la baldosa de `#/lista-dia` | — |
| Búsqueda global | Hecho | Ctrl+K | Los trabajos se abren en la app. |
| Auditoría por ficha y registro de cambios | Hecho | `#/registro` y «🕘 Historial» en cliente, sitio, trabajo, ticket y presupuesto (admin); función `historial`: junta `hub.auditoria` y el `audit_log` de la app (leído) | — |
| Deshacer (Ctrl+Z) | Hecho | `core/deshacer.ts` (observador del cliente de datos, un gesto = una acción), chip «↩ Deshacer» con su panel y Ctrl+Z | — |
| Cola offline | Hecho | `core/cola.ts` (IndexedDB, FIFO, id del móvil, lista blanca) y chip «☁ sin enviar»; el fichaje (`hub.fichar`) sale con la hora de la pulsación (`20261029_fichar_cuando.sql`) | Background Sync del service worker (aquí sale al volver la red, al entrar y cada minuto). |
| Caché de arranque | Hecho | `core/lecturas.ts`: sin red, la última copia de las lecturas de la calle (por persona) con lo pendiente encima | Pintar al instante con la copia ANTES de que llegue la red (aquí la copia solo entra si la red falla). |
| Feedback a Claude Code (`report-to-claude`) | Hecho | `#/feedback` (todos; el técnico ve lo suyo): fallo/mejora/idea con la pantalla de antes, versión, entorno y últimos errores (`core/errores.ts`); el admin lo gestiona y lo «Pasa a Claude» → `hub.feedback` en estado `claude` → el trabajador lo toma por el conector MCP (`feedback_*`) y lo cierra con lo hecho | Sin issues de GitHub (decisión de Fran). |
| Capa de repaso visual | No aplica | — | Herramienta de desarrollo de la app. |
| Modo escritorio | Hecho | `shell/escritorio.ts` | — |
| Paleta Ctrl+K con acciones | Hecho | `shell/buscador.ts` | Acciones sobre lo encontrado. |
| Centro de avisos | Hecho | campana del escritorio | — |
| Pestañas tipo navegador (`tabs.js`) | No aplica | — | Decisión de Fran (2026-10-04): lo cubre el modo escritorio (ventanas). |
| Atajos ESC y F5 | Hecho | ESC (buscador, dock, ventanas) y F5 guarda el formulario de delante (`shell/atajos.ts`) | — |
| Tema oscuro | Hecho | `shell/tema.ts` | — |
| Tamaño del texto en el móvil | Hecho | Pie del menú en el móvil (`shell/texto.ts`, `data-fs`, por dispositivo) | — |
| Guía de operaciones | Hecho | `shell/tour.ts` | — |
| Aviso de versión nueva | Hecho | `shell/version.ts` (lee `version.json` cada 5 min y al volver) → «Recargar» | — |
| Configuración (empresa, IGIC, tarifas, colores, Google) | Hecho | `#/configuracion` (admin): empresa = `facturacion_emisor`, IGIC, tarifa sin mantenimiento (las de los planes, en sus plantillas), en `hub.config` para todos | No se portan los colores de estado (los fija la marca) ni la contraseña de borrado (la RLS ya lo limita a admin). Google y Zoho: PENDIENTE_FRAN. |
| Política de privacidad | Hecho | `public/privacidad.html` (copia literal, colores del hub) y enlace en la entrada | — |
| APK Android | Falta | — | Decisión de Fran (2026-10-04): se deja para el corte final (cambiar la URL de la APK de la app al hub, paso 7); hasta entonces el hub es PWA instalable. |

### 13. Integraciones y programados

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Conector MCP (`mcp-server`) | Hecho | función `mcp` | — |
| OAuth y token de Google | No aplica | — | El hub usa la cuenta de servicio con delegación de dominio (`_shared/google.ts`), no el OAuth de cada persona. |
| Backup diario de la base | Falta | — | Backup propio del hub. |
| Refresco de suscripciones de Zoho | Falta | — | — |
| Push cada 15 min | Preparado | `hub-push-proximos` (pg_cron) → función `push` `proximos` | Se enciende solo con el corte de la agenda. |
| Control de equipos a diario | Preparado | `hub-equipos-control` copia la comprobación de la app cada mañana; la pasada propia, función `control-equipos` | El cron propio, con el corte del área `equipos`. |
| Repaso y cierre programados | Hecho | `hub-informes` | — |
| Repaso visual nocturno y `/repaso` | No aplica | — | El hub tiene su trabajador de Claude. |
| Despliegues y lint | Hecho | `.github/workflows/` | — |
| Previsualización de PRs, APK, FCM, borrar funciones | Falta | — | — |
| Redirección del dominio antiguo | Falta | — | Paso 6 del corte. |

## Lo propio del hub (la app no lo tiene)

Proyectos con Gantt y «Pedir a Claude» · conector MCP con tokens · puesto de
mando con un solo motor de avisos · informes programados y bot de Telegram ·
espejo de Zoho Books · CRM (actividades, clases, línea de tiempo, embudos,
previsión) · recordatorios de cobro · wiki con historial · buscador con IA ·
Desk con SLA laborable, correo y valoración · portal de clientes y de la
gestoría · comandas por voz · almacén con MRP y envíos · jornada legal, ausencias
y gastos por OCR · firma de documentos con huella · facturación propia (sin
activar) · consola de Breeze · estado del sync · portada de Oki y WhatsApp con
propuesta de Oki · escritorios con widgets.
