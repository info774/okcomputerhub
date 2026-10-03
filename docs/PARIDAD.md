# Paridad con la app actual

El hub tiene que hacer **todo lo que hace la app actual** (`okcomputerclaude`),
también lo que se le añada en el futuro, y además lo suyo propio, hasta el día
en que la sustituya. Mientras tanto las dos avanzan en paralelo y la app sigue
siendo la de uso diario: el hub no la interrumpe ni la molesta (decisión de
Fran, 2026-10-03).

**Revisado hasta**: `73b8ff6` (2026-10-02) — «WhatsApp: fotos y vídeos del cliente al ticket, con descripción de la IA (#161)».

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
   HECHA (lista del día con su espejo y el planificador hoy/mañana). Falta:
   firma del cliente y PDF del parte, plantillas (tanda 4), chat por ficha y
   tablero de notas (tanda 5). Es lo que más usan los técnicos.
2. **Clientes, sedes y contactos con escritura**: alta y edición (NIF, Google
   Maps), baja/reactivar, pestañas Software, Hardware y Cámaras, teléfonos con
   rol, Excel; y lo que escribe en Zoho (alta de cliente).
3. **Presupuestos y facturar trabajos**: crear con líneas del catálogo,
   plantillas, PDF, a Zoho, convertir en trabajo; facturar trabajos en Zoho.
4. **Mantenimiento y cobros**: Stripe (domiciliar, enlace de pago, cambiar plan,
   abonos), libro de cuotas, contratos con firma y pago, renovaciones, tabla
   maestra de Locales.
5. **WhatsApp completo**: webhook con menú y horario, medios, plantilla fuera de
   24 h, mandar documentos, enlaces rápidos, de WhatsApp a ticket.
6. **Sistema**: usuarios y modo empleado, deshacer, cola offline, historial por
   ficha, configuración, push y APK, aviso de versión.
7. **Resto**: inventario completo (albaranes, historial, Excel), VeriFactu,
   facturas de compra, gastos y cobros de la app, control de equipos, Google
   (Calendar, Contactos, Drive).

## El mapa

### 1. Clientes y sedes

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Lista de clientes con filtros (`modules/clientes.js`) | Solo lectura | `#/clientes` | Corte del área `clientes`. |
| Alta/edición de cliente con Zoho (`saveCliente`, `push-cliente-to-zoho`) | Falta | — | Alta propia y escribir en Zoho. |
| Eliminar cliente y quitarlo de Zoho (`delete-cliente-from-zoho`) | Falta | — | Ídem. |
| Dar de baja y reactivar cliente o sede | Falta | — | Escribir `activo`. |
| Empresa por NIF y NIF duplicado (`lookup-nif`) | Falta | — | Portar la función. |
| Cliente o sede desde Google Maps (`google-places.js`) | Falta | — | Places en el alta. |
| Sync de clientes y presupuestos desde Zoho (`sync-zoho*`, `sync-auto.js`) | Falta | — | Hoy entra por la app y el hub copia. |
| Ficha del cliente (General, Locales, Contactos, Historial) | Solo lectura | `#/clientes` (ficha 360) | Editar datos. |
| Suscripción de Zoho Billing a una sede (`list-zoho-subscriptions`) | Falta | — | Cartera vieja. |
| Lista de sitios, etiqueta RMM, Excel, AnyDesk/RustDesk (`modules/locales.js`) | Solo lectura | `#/sitios` | Excel, AnyDesk, alta y edición. |
| Ficha del sitio: Info (renombrar, cliente, contacto) | Solo lectura | `#/sitios` | Escrituras. |
| Ficha del sitio: Software y Hardware (`loadSoftware`, `hwAutoGarantia`) | Falta | — | Espejo de sus tablas y pestaña. |
| Ficha del sitio: Cámaras | Falta | — | Espejo y pestaña. |
| Ficha del sitio: Alarma (código oculto) | Solo lectura | `#/sitios` | Editar. |
| Teléfonos de la sede con rol (`local_telefonos`) | Solo lectura | `#/sitios` | `local_telefonos` no viaja en el sync. |
| Ficha del sitio: Historial | Solo lectura | `#/sitios` | — |
| Seguimiento de tareas de la sede (`loadSeguimientoLocal`) | Falta | — | — |
| Agenda de contactos (`modules/contactos.js`) | Solo lectura | `#/contactos` | Alta y edición. |
| Google Contacts (`google-contacts.js`) | Falta | — | — |
| Mapa de sedes con estado RMM (`modules/mapa.js`) | Hecho | `#/mapa` | — |
| Mapa: Día, Semana (planificador), Ruta, técnicos por GPS | Falta | — | Planificar y rutas. |

### 2. Trabajos y calendario

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Lista de trabajos, filtros, kanban, Excel (`modules/trabajos.js`) | Preparado | `#/trabajos` (lista, kanban y Excel ya hoy; arrastrar en el kanban cambia el estado tras el corte) | Corte. |
| Crear y editar trabajo (Simple/Completa), duplicar, continuación | Preparado | `#/trabajos/nuevo`, `#/trabajos/<n>/editar`, `trabajos/formulario.ts`; espejo trabajo ⇄ agenda en `20261017_trabajos_paridad.sql` | Crear cliente o sede al vuelo (bloque 2), plantillas (tanda 4). |
| Ficha: estado, comentarios, material con stock (`saveWdLineas`); completar cierra sus tickets y propone «Para facturar» | Preparado | `#/trabajos`, `hub.trabajo_estado`, `hub.trabajo_guardar_lineas` | Se enciende con el corte. |
| Material con escáner de código de barras | Falta | — | Escáner. |
| Fichajes del trabajo con edición en línea | Solo lectura | `#/trabajos` | Correcciones por `hub.jornada_ajustes`. |
| Fotos del trabajo (a Drive con descripción) | Preparado | `#/trabajos`, `trabajo-foto` | Va a Storage, no a Drive. |
| Firma del cliente y PDF del parte (`saveFirma`, `generatePDF`) | Falta | — | — |
| Guía de instalación de cámaras | Falta | — | — |
| Plantillas de trabajo (`modules/plantillas.js`) | Falta | — | — |
| Chat de grupo por trabajo/ticket/tarea | Falta | — | Salas por ficha en `#/chat`. |
| Borrar trabajo devolviendo el material | Preparado | trigger de `20261016_final.sql` | — |
| Agenda por bloques y eventos libres (`modules/agenda.js`) | Preparado | `#/calendario/cita`, `#/calendario/dia/<trabajo>` (días de la ficha del trabajo), `calendario/cita.ts` | Corte. |
| Calendario semanal con fichajes reales (`modules/calendario.js`) | Preparado | `#/calendario` (Semana y Por técnico; mover y reasignar arrastrando) | Corte. |
| Calendario: Mes, Día, Agenda, filtros guardados, alta rápida | Preparado | `#/calendario` (Día con rejilla por técnico; «+ Cita»; ir a fecha en vez de mini-mes) | Zoom, redimensionar arrastrando el borde, colores por estado. |
| Calendario: pendientes, «Sugerir hueco», traslados, solapes, carga del día | Preparado | `calendario/motor.ts` (mismas constantes que la app) y panel de pendientes | Origen de los traslados: oficina con coordenadas fijas (la app geocodifica la dirección de la empresa). |
| Capa de Google Calendar (`google-calendar-read.js`, `google-token`) | Falta | — | — |
| Lista del día (`modules/lista-dia.js`, `lista_dia`) | Preparado | `#/lista-dia`, `lista-dia/vista.ts`; espejo, `hub.lista_dia_marcar` y limpieza al borrar el origen en `20261018_lista_dia.sql`; casilla en el alta de trabajo | — |
| Planificador hoy/mañana (`ui/plan-dia.js`) | Preparado | `#/lista-dia/planificar` (hoy, mañana, +7 d; la hora se mueve con la fecha) | — |
| Modo calle (`ui/calle.js`) | Preparado | `#/hoy`, `hub.fichar`, `trabajo-foto` | Se enciende con el corte. |
| Fichaje traslado → inicio → fin (`ui/fichaje.js`) | Preparado | `#/hoy` (y Enlace «Fichaje y horas») | Botón + global; fichar tareas y tickets. |
| Tablero de notas de texto y voz (`modules/tablero.js`) | Falta | (lo indexa `#/buscar`) | Pantalla. |

### 3. Tickets / Desk

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Lista y kanban de tickets, Excel | Hecho | `#/tickets` | Kanban y Excel. |
| Ficha del ticket, comentarios y estado | Hecho | `#/tickets` | — |
| Adjuntos, también fotos y vídeos de WhatsApp descritos por IA (`ticket_adjuntos`; la app lo amplió el 2026-10-02, `73b8ff6`) | Falta | — | Espejo de `ticket_adjuntos` y subida. |
| Tareas dentro del ticket | Falta | — | — |
| Ticket a trabajo, duplicar ticket | Falta | — | — |
| Resolución a Conocimiento | Falta | — | — |
| Ticket desde una alerta del RMM (`rmmTicketDeAlerta`) | Falta | — | — |

### 4. Ventas y presupuestos

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Oportunidades: embudo, lista, ficha | Hecho | `#/oportunidades` | — |
| Oportunidad a presupuesto, trabajo o tarea | Falta | — | — |
| Formulario de las webs (`formulario-web`) | Falta | — | Entra por la app y se importa. |
| Captación de leads de comerciales (`captacion.html`, `captar-lead`) | Falta | — | — |
| Lista de presupuestos | Solo lectura | `#/presupuestos` | Corte del área. |
| Crear y editar presupuesto con catálogo | Falta | — | — |
| Plantillas de presupuesto | Falta | — | — |
| PDF del presupuesto | Falta | — | — |
| Presupuesto a Zoho (`send-to-zoho-estimate`) | Falta | — | Escribir en Zoho. |
| Presupuesto a trabajo | Falta | — | — |
| Aceptación por el cliente | Falta | `portal` | En el portal se acepta, pero hay que pasarlo a la app a mano. |

### 5. Mantenimiento y cobros

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Resumen (garantías, visitas, cuotas a 90 días, renovaciones) | Solo lectura | `#/mantenimientos` | Garantías, visitas, renovaciones. |
| Locales: tabla maestra (`mant-ficha.js`) | Solo lectura | `#/mantenimientos` | Columnas de la ficha y modal `fm-`. |
| Cobros con Stripe (`mant-cobros.js`, `stripe-suscripcion`) | Falta | (`#/cobros` avisa del cobro torcido) | Portar `stripe-*` y `stripe-cobros.ts`. |
| Libro de cuotas, «Emitir en Zoho», abonos | Falta | — | — |
| Webhook de Stripe → factura MANT- en Zoho | Falta | — | — |
| Cartera vieja de Zoho Billing | Falta | — | Solo se pinta (`sedeEnZoho`). |
| Checklist, Seguimiento (kanban), Plantillas de planes | Falta | — | — |
| Contratos: generar, editar, firmar, renovaciones | Falta | `#/firmas` es firma genérica | Contratos con cuota. |
| Firma pública con pago (`firma.html`, `firma-contrato`), `mandato.html` | Falta | — | — |
| Trabajo desde un mantenimiento | Falta | — | — |
| Ficha del sitio, pestaña «Mant.» con cobro | Solo lectura | `#/sitios` | Botones de Stripe. |
| Ajustes de cobro (`mant_config`) | Falta | — | — |

### 6. Facturación

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Facturas de venta desde Zoho | Solo lectura | espejo `hub.zoho_facturas` (+ Enlace «Facturación y cobros») | Listado; credenciales de Zoho. |
| Facturar trabajos en Zoho (`send-to-zoho-invoice`, `add-to-zoho-invoice`) | Falta | `#/facturacion` (propia, sin activar) | — |
| Asignar cliente a sede suelta al facturar | Falta | — | — |
| Factura o presupuesto en PDF por WhatsApp | Falta | — | — |
| Tablero VeriFactu (`modules/verifactu.js`) | Falta | — | Tabla y pantalla. |
| Facturas de compra (`facturas_compra.js`) | Falta | — | — |

### 7. Inventario y almacén

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Inventario por ubicación, movimientos, trasvases (`furgonetas.js`) | Solo lectura | `#/almacen` (+ Enlace «Inventario») | Corte del área `inventario`. |
| Historial de una furgoneta | Falta | — | Lista de movimientos. |
| Albaranes, importar/exportar Excel | Falta | — | — |
| Pedidos internos de reposición | Hecho | `#/almacen` (MRP, qué pedir) | — |
| Catálogo (editar, categorías, sync de Zoho) | Solo lectura | espejo `hub.catalogo` | — |
| Inventario → catálogo | Falta | — | — |
| Proveedores | Hecho | `#/almacen` | — |
| Pedidos de compra | Hecho | `#/almacen` | La entrada se da en la app. |
| Alta de vehículos | Falta | — | — |

### 8. Personas, fichaje y gastos

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Mis horas | Hecho | `#/personas` (Jornada) | — |
| Informe de horas del mes | Hecho | `#/personas` | — |
| Gastos y cobros en efectivo con foto (`gastos.js`) | Falta | `#/personas` (Gastos por OCR, flujo propio) | Gasto y cobro de la app. |
| Usuarios: alta y activar (`configuracion.js`) | Falta | — | Pantalla de usuarios. |
| Modo empleado (menú reducido) | Falta | — | Más que `soloAdmin`. |

### 9. Comunicación

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Chat interno en tiempo real (`chat.js`) | Hecho | `#/chat` | Tiempo real, adjuntos, historial de la app. |
| Tonos y avisos del chat | Falta | — | — |
| Push web y FCM (`push.js`, `send-*-push`) | Falta | — | El hub avisa por Telegram. |
| Bandeja de notificaciones (`inbox.js`) | Falta | (campana de avisos) | — |
| Bandeja de WhatsApp: leer y contestar (`wa-bandeja.js`) | Hecho | `shell/whatsapp.ts`, función `whatsapp` | Plantilla fuera de 24 h, documentos, ver medios, enlaces rápidos, chip del plan. |
| Webhook de WhatsApp: menú, horario, ticket u oportunidad, órdenes del equipo, adjuntos | Falta | — | Entra por la app. |
| Agente de Meta por MCP (`meta-agente-mcp`) | Falta | — | — |
| WhatsApp pegado o captura a ticket/trabajo (`parse-whatsapp`) | Falta | — | — |
| Asistente de voz (`voice.js`, `groq-proxy`) | Falta | (notas de voz → comandas) | — |
| Repaso matinal y cierre | Hecho | `informes-enviar`, `telegram-bot` | — |
| Dictado en formularios (`dictado.js`, `transcribe-audio`) | Falta | — | — |

### 10. Monitorización

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Pestaña «Monitor.» de la sede (`rmm.js`) | Hecho | `#/monitorizacion` | Usuario de servicio de Breeze. |
| Réplica de Breeze (`breeze-sync`, `breeze-hook`) | No aplica | vistas `hub.rmm_*` | El hub lee Breeze directamente. |
| Agente OKRMM y sonda de red (`rmm-agente`) | No aplica | — | OKRMM se retira. |
| Control de equipos (`control-equipos`) | Falta | — | — |
| AnyDesk de una sede | Falta | — | — |

### 11. Documentos

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Base de conocimiento (`conocimiento.js`) | Solo lectura | `#/buscar` | Se edita en la app; la wiki es lo nuevo. |
| Google Drive | Falta | (Buscar indexa una carpeta) | Subir a Drive. |

### 12. Sistema

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Dashboard / Mi jornada | Hecho | `#/inicio` (Oki), `#/direccion`, `#/hoy`; «Mi lista de hoy» es la baldosa de `#/lista-dia` | — |
| Búsqueda global | Hecho | Ctrl+K | Los trabajos se abren en la app. |
| Auditoría por ficha y registro de cambios | Falta | (`#/direccion`, lo último) | Historial por ficha. |
| Deshacer (Ctrl+Z) | Falta | — | — |
| Cola offline | Falta | — | — |
| Caché de arranque | Falta | — | — |
| Feedback a Claude Code (`report-to-claude`) | Falta | — | — |
| Capa de repaso visual | No aplica | — | Herramienta de desarrollo de la app. |
| Modo escritorio | Hecho | `shell/escritorio.ts` | — |
| Paleta Ctrl+K con acciones | Hecho | `shell/buscador.ts` | Acciones sobre lo encontrado. |
| Centro de avisos | Hecho | campana del escritorio | — |
| Pestañas tipo navegador (`tabs.js`) | Falta | — | — |
| Atajos ESC y F5 | Falta | (solo ESC) | F5 guarda. |
| Tema oscuro | Hecho | `shell/tema.ts` | — |
| Tamaño del texto en el móvil | Falta | — | — |
| Guía de operaciones | Hecho | `shell/tour.ts` | — |
| Aviso de versión nueva | Falta | — | — |
| Configuración (empresa, IGIC, tarifas, colores, Google) | Falta | (`#/facturacion`, `#/datos`) | — |
| Política de privacidad | Falta | — | — |
| APK Android | Falta | — | Paso 7 del corte. |

### 13. Integraciones y programados

| Función de la app | Estado | Dónde en el hub | Qué falta |
|---|---|---|---|
| Conector MCP (`mcp-server`) | Hecho | función `mcp` | — |
| OAuth y token de Google | Falta | — | — |
| Backup diario de la base | Falta | — | Backup propio del hub. |
| Refresco de suscripciones de Zoho | Falta | — | — |
| Push cada 15 min | Falta | — | — |
| Control de equipos a diario | Falta | — | — |
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
