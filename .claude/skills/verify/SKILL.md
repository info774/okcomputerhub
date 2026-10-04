---
name: verify
description: Verifica cambios del frontend del hub (src/) arrancando el build real en Chromium headless con la red de Supabase interceptada y fixtures, sin tocar datos reales. Úsala antes de cerrar cualquier cambio de pantalla, shell o capa de datos.
---

# Verificación del hub

El hub va contra el proyecto `okcomputer-hub` (`adomalsxsymxzuozksmt`), que
comparte base con Breeze (RMM en producción). NUNCA se verifica escribiendo
contra él: se intercepta la red.

## Receta

1. `npm run build` (el arnés sirve `dist/` con `vite preview`).
2. `npm run verify` → `.claude/skills/verify/verify-shell.mjs`.
   - Chromium en `/opt/pw-browsers/chromium` (en CI, el que instala Playwright).
   - `newContext({ serviceWorkers: 'block' })`: con el SW activo las peticiones
     se saltan la intercepción.
   - Sesión: `localStorage['sb-adomalsxsymxzuozksmt-auth-token']` con una sesión
     de supabase-js v2 y un JWT falso con `exp` futuro; luego se responde
     `usuarios` con la persona (vacío = no dada de alta).
   - `https://adomalsxsymxzuozksmt.supabase.co/rest/v1/<tabla>` → fixtures. Los
     `HEAD` (contadores de las baldosas) contestan con `Content-Range: 0-0/N`
     **y** `Access-Control-Expose-Headers: Content-Range`: sin esa cabecera el
     navegador no deja leer el total y la baldosa se queda en «—».
   - `functions/v1/*` → se captura el cuerpo y la cabecera Authorization.
3. Capturas en `verify-capturas/` (ignorado por git): mirarlas.

Lo que siempre se comprueba: todas las peticiones REST llevan
`Accept-Profile: hub` (nunca `public`, que es de Breeze) y no queda ningún
`on*=` inline en el DOM.

## Migraciones

`npm run probar-migraciones` las aplica DOS veces en un Postgres local
desechable (imitando lo mínimo de Supabase, con pg_cron y pg_net simulados) y
prueba RLS, áreas, auditoría, que `public` no cambia y el importador con un
dump falso. `node scripts/comprobar-migraciones.mjs` (dentro de `npm run lint`)
rechaza cualquier migración que nombre `public.` o un rol de Breeze.

## Arneses

- `verify-shell.mjs`: login, usuario sin alta, shell, baldosas, Datos y
  sincronización, buscador, tema, tour, móvil.
- `verify-proyectos.mjs` (usa `comun.mjs`, un PostgREST EN MEMORIA que acepta
  escrituras): idea → kanban y arrastre entre fases, ficha entera (idea,
  objetivos, páginas con fuentes y markdown seguro, hitos y Gantt, tareas y
  arrastre, vínculo a un trabajo, coste), tareas por persona, que no se escribe
  en tablas espejo, técnico sin «Borrar proyecto», móvil.

- `verify-monitorizacion.mjs`: sedes con semáforo, equipos y buscador, alertas
  y «Acusar» por `breeze-api`, emparejado manual (upsert en `rmm_sitios`),
  ficha del equipo (TPV, gráfica con hover, comando y script por `breeze-api`,
  enlaces a Breeze), botones apagados sin usuario de servicio, móvil a 390 px
  SIN `isMobile` (con él, el navegador ensancha el viewport y esconde el
  desborde).

- `verify-mando.mjs`: Puesto de mando (cifras, avisos agrupados y «Los
  míos», gráfica de ventas con hover y tabla), Informes (vincular Telegram,
  programar, vista previa saneada, enviar ahora, pausar, configurar el bot),
  conexión de Zoho en Datos; un técnico no ve dinero; móvil.

- `verify-ventas.mjs`: Clientes 360 (lista y clase, «lo siguiente», clase a
  mano, apuntar, línea de tiempo, sedes, contactos), Oportunidades (arrastre,
  nueva con cliente, ganar, perder con motivo, actividad, previsión, embudos),
  Cobros (WhatsApp con el texto, editar, marcar enviado) y Mapa (puntos y
  capas; mosaicos de OSM interceptados). Nada escribe en el espejo; un técnico
  no ve dinero ni Cobros. OJO: el PostgREST en memoria no entiende
  `not.is.null` (lo trata como «todo»).

- `verify-wiki.mjs`: wiki (crear con vista previa segura, subpágina, mover,
  editar, historial y restaurar, archivar, reindexado al guardar) y Buscar
  (respuesta en markdown seguro con citas, fuentes, estado del índice,
  carpeta de Drive solo admin). Funciones simuladas en el propio arnés.

- `verify-tickets.mjs`: Desk (vistas y SLA, nuevo con cliente/sede/contacto,
  responder por correo y por WhatsApp, nota interna, plantillas, técnico,
  vincular trabajo, cerrar con valoración, bandeja de correo, ajustes, técnico
  sin borrar ni cambiar el SLA) y la página pública `valorar.html`.
  `window.open` se sustituye en la página para ver la URL de WhatsApp.

- `verify-portal.mjs`: `portal.html` con la función `portal` simulada (enlace,
  entrar y quitar el código de la URL, tickets, aviso, mensaje, aceptar,
  PDF, mantenimiento, equipos, sesión caducada, salir; comprueba que no toca
  PostgREST) y `#/portal` del equipo (invitar, enlace, revocar, aceptaciones).

- `verify-comandas.mjs`: escribir y GRABAR una comanda (Chromium con
  `--use-fake-device-for-media-stream`: `navegador(args)` de `comun.mjs`),
  tablero (botones y arrastre; ventana alta para que arrastrar no desplace la
  página), repartir, tarea suelta, filtro por persona, borrar solo lo propio.

- `verify-almacen.mjs`: stock y filtros (MRP simulado por RPC), «Qué pedir» →
  pedido en borrador, ficha (línea del catálogo, cantidad, enviar pide
  proveedor, recibido, entrada dada), proveedor y sus materiales (preferido),
  envíos (seguimiento, estado); nada escribe en el espejo del inventario.

- `verify-personas.mjs`: jornada (RPC simulado; corrección con motivo en hora
  de Canarias, CSV), ausencias (pedir, aprobar), gastos (subir → gastos-ocr
  simulada → confirmar), cierre, firmas (vista previa segura, enviar) y las
  páginas `firmar.html` (firma dibujada en el lienzo) y `gestoria.html`.
  OJO al simular funciones: un cuerpo puede traer su propio `nombre`
  (`{ ...b, nombre }`, no al revés).

- `verify-facturacion.mjs`: sin activar (aviso, serie real deshabilitada),
  borrador de prueba (cliente, línea, IGIC), emitir por RPC, emitida (marca
  PRUEBA, huella, no editable, cobro, rectificar), desde trabajos, emisor.

- `verify-escritorio.mjs`: modo escritorio (entrar desde el menú y por
  `?os=1`, widgets con datos del espejo y del motor de avisos, ventanas por
  el dock y por la URL, ajuste a zonas al arrastrar y con Alt+Mayús,
  minimizar/restaurar/cerrar, escritorios con nombre que se recuerdan, centro
  de avisos con «Los míos», lanzador, tema noche, volver a la app clásica, un
  técnico sin Cobros, 900 px no entra) y la paleta Ctrl+K con sus cuatro
  modos. No escribe nada.

  Desde el 2026-10-03: el escritorio es la entrada por defecto (sin preferencia
  guardada), widgets de Oki (voz, Oki dice, estadísticas, órdenes) que se
  arrastran, «Oki» en el dock abre la portada en su ventana, WhatsApp plegado
  como botón y «Volver a la app clásica» se recuerda al recargar.
- `verify-final.mjs`: trabajos, calendario, hoy y chat en los dos mundos: con
  las áreas de la app (todo se ve, nada se edita, avisa) y cortadas (estado,
  material, mover, fichar, terminar con foto, por sus RPC). El GPS no
  contesta en el arnés: el fichaje sigue a los 6 s sin él.

- `verify-presupuestos.mjs`: Presupuestos (cifras abiertos / sin respuesta /
  aceptado / tasa, barras de importe por estado que filtran, filtros, por
  persona, buscador, ficha con líneas y enlaces, tema noche, móvil sin
  desbordar); solo lectura.
- `verify-mantenimientos.mjs`: Resumen (cifras, barras por plan que abren
  Locales filtrado, requieren atención, próximas visitas, garantías) y tabla
  maestra (quién cobra: Stripe, esperando el primer pago, Zoho viva o
  cancelada, sin domiciliar; cobro torcido y en curso; cuota NETA con el bruto
  heredado de Zoho sin IGIC; certificado, copia, teléfonos, código; filtros de
  ficha y búsqueda por teléfono), y un técnico en el móvil sin euros; solo
  lectura.
  `comun.mjs` entiende `not.` (un NULL no cumple `not.in`, como en SQL).
- `verify-oki.mjs`: portada de Oki (diagrama con 6 áreas y su dato, SLA y
  cerrados por día, «Oki dice» y «Necesita a una persona» desde
  `panorama_direccion`, baldosas debajo) y chat de WhatsApp fijo (plegado al
  entrar, leer y marcar leída, propuesta de Oki, enviar, ventana de 24 h
  cerrada bloquea, sigue en otra pantalla, móvil sin desbordar). La función
  `whatsapp` va simulada con su propia ruta encima de la de `preparar`.
  Tablero completo (2026-10-03): cabecera con el estado del sync y la campana,
  «Trabajos completados», «Sí, contéstalo» (la función `oki` redacta en el
  ticket), voz con micrófono de mentira (pregunta → `#/buscar`; encargo →
  comanda solo tras confirmar), órdenes rápidas, pie con el último sync y el
  repaso de la mañana, y «Mandar plantilla» fuera de las 24 h.
- `verify-trabajos.mjs`: paridad de trabajos. Sin corte: el alta lleva a la
  app y el formulario no guarda. Con corte: alta Simple/Completa (el modo se
  recuerda; el móvil arranca en Simple), editar (estado por RPC y «¿Para
  facturar?»), duplicar, continuación, kanban (soltar cambia el estado) y
  Excel (CSV con BOM). `comun.mjs` numera los `trabajos` que se crean.
- `verify-calendario.mjs`: calendario planificador. Semana (carga del día,
  solapes por nombre de pila, traslados con «llega tarde» y salida de la
  oficina), pendientes y «Sugerir hueco» (salta al Día con el hueco marcado,
  «Otro hueco», «Planificar aquí» escribe la fecha en el TRABAJO), rejilla del
  Día (soltar en otra columna reasigna y a esa hora), Por técnico, Agenda, Mes,
  filtros guardados, citas sueltas y días de un trabajo. Sin corte: nada se
  arrastra ni se planifica. Fecha fija (martes de la semana que viene).
- `verify-lista-dia.mjs`: lista del día por persona (título leído del origen),
  marcar por `hub.lista_dia_marcar` con su aviso de fichaje, pasar a otra
  persona (reasigna), recado, añadir de lo pendiente (asigna), traer lo ya
  asignado, quitar, Planificar (atrasado; «Mañana» mueve fecha y hora), la
  casilla del alta de trabajo y el técnico que solo ve lo suyo.
- `verify-parte.mjs`: firma del cliente (sin trazo no guarda; con trazo, PNG en
  `firma_cliente`), parte imprimible (empresa de `hub.config`, cliente, duración,
  productos con IGIC, firma, fotos; al imprimir sale solo el parte y entero),
  plantillas (crear con pasos, editar, eliminar = desactivar, aplicarlas en el
  alta) y el mundo sin corte (se ve, no se escribe).
- `verify-tablero.mjs`: tablero (todas las notas con su autor, buscador; con
  corte, nueva con el título sacado de la nota, editar y borrar solo las
  propias, nota de voz con micrófono de mentira → `comandas` `transcribir`) y
  chat por ficha («💬 Chat» del trabajo → `hub.chat_ficha` → `#/chat/<canal>`
  con «Abrir la ficha»).
- `verify-clientes.mjs`: alta de cliente (NIF que trae la razón social y avisa
  del duplicado; con NIF repetido no se crea; alta en Zoho del recién creado),
  editar (sin Zoho), dar de baja y reactivar, «De baja», Excel, eliminar (admin:
  baja + quitar de Zoho), el técnico sin «Eliminar» y el mundo sin corte.
- `verify-sitios-escritura.mjs`: alta de sede (desde «+ Nueva sede» del cliente
  o buscándolo; mapa de la dirección; teléfono «Principal»; sin tocar el
  mantenimiento), editar (TPV y alarma), teléfonos con rol (añadir, cambiar el
  rol en la fila, editar, quitar), baja y reactivar desde «De baja», Excel,
  eliminar (admin: teléfonos y después la sede), técnico sin «Eliminar» y el
  mundo sin corte.
- `verify-sitios-equipamiento.mjs`: pestañas Software, Hardware y Cámaras
  (avisos de certificado y garantía, garantía = instalación + 1 año, añadir,
  editar, quitar; contraseña de cámara tras «Ver»), Seguimiento (marcar y
  desmarcar por periodo), «🖥 Remoto» (AnyDesk sin repetir y RustDesk con la
  contraseña al portapapeles), AnyDesk en la lista y en el Excel, vivienda sin
  Software ni Seguimiento, eliminar con lo que cuelga y el mundo sin corte.
- `verify-contactos-escritura.mjs`: alta de contacto (tipo, favorito,
  etiquetas, cliente y sede; desde la agenda, el cliente y la sede), editar,
  baja y reactivar, empleados solo admin; «Buscar en Google Maps» con Google
  SIMULADO (solo Tenerife, rellena, aviso fuera de la isla, fallo dicho), aviso
  de sede de nombre parecido, y cliente y sede al vuelo en el alta de trabajo
  (con Zoho y NIF repetido); el mundo sin corte.
- `verify-presupuestos-escritura.mjs`: presupuestos (alta con plantillas que se
  juntan, catálogo y a mano; desde una oportunidad; editar, duplicar, Zoho, a
  trabajo, imprimible con IGIC, plantillas, eliminar solo admin) y facturar
  trabajos (casillas en «Por facturar», líneas como la app, factura nueva,
  añadir a un borrador, presupuesto desde trabajos, sede sin cliente); Zoho
  SIMULADO; el mundo sin corte.
- `verify-mantenimientos-escritura.mjs`: con las áreas cortadas, la fila de la
  tabla maestra, la ficha de mantenimiento con teléfonos (9 cifras), el
  checklist del plan por periodo, el seguimiento (alta y arrastre), planes solo
  admin con sus tareas, checklists de visita, «+ Contrato» (a una sede en
  Stripe no se le toca la cuota) y el checklist de la visita en el trabajo (el
  del plan o el genérico; solo lectura con `trabajos` en la app).
- `verify-contratos.mjs`: Documentos (estado del contrato y del cobro;
  renovaciones a 60 días sin la sede de baja, preaviso, avisado, no renovar,
  insignia), el contrato de cada sede en la tabla maestra, generar desde una
  sede (cuota del periodo con IGIC, borrador con cliente, dirección, código,
  servicios y tarifas), editar pendiente y firmado, enlace, firmado, anular y
  eliminar solo admin, el mundo sin corte, y las páginas públicas
  `contrato.html` (firmar con nombre + firma + casilla, estados, primera cuota
  cuando la haya) y `mandato.html`; `firma-contrato` SIMULADA.
- `verify-cobros.mjs`: Cobros del mantenimiento (solo admin): cifras, sedes
  con sus botones según quién cobra (Stripe, Zoho viva, Zoho de baja, nadie),
  filtros y buscador sobre sedes y libro, domiciliar con la cuota del periodo
  + IGIC y el enlace de pago, pausar, baja, desvincular de Zoho, emitir en
  Zoho, cuotas descuadradas, la página de la sede, cambiar plan, abonar y
  ajustes con los desplegables de Zoho; la cartera vieja de Zoho Billing
  («Comprobar en Zoho», que sin corte consulta y no guarda, y vincular una
  suscripción desde la ficha del cliente); sin corte, botones apagados;
  `stripe-suscripcion` y `zoho-cartera` SIMULADAS.
- `verify-inventario.mjs`: stock por ubicación y «Todas» sumando el mismo
  producto (por catálogo o por nombre), bajo mínimo/agotados y medidor, barras
  por ubicación que la eligen (y quedan marcadas), valor solo admin; libro de
  movimientos (tipos, trasvase con destino, trabajo) y lo más gastado en 90
  días; ficha con dónde más lo hay; técnico en el móvil sin euros.

`npm run verify` pasa todos los de la lista.

## Pantalla nueva

Un `verify-<modulo>.mjs` propio sobre `comun.mjs` (`servidor`, `navegador`,
`baseMemoria`, `preparar` —que deja el shell clásico salvo `{ escritorio: 'defecto' }`, porque a partir de 1024 px el modo escritorio es la entrada por defecto—), añadido a `npm run verify`, y una línea aquí con
qué cubre.
