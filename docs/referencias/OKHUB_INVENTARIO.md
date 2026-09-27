# OKHUB (app.okcomputer.es) — inventario de la demo, pantalla a pantalla

> Recorrido el 2026-09-27 con Chromium sobre la demo pública
> (`https://app.okcomputer.es/`, credenciales precargadas, datos ficticios de
> «Materiales Sierra Nevada, S.L.», un almacén de materiales de construcción
> de Atarfe). **OKHUB es un producto de otra empresa** (OK COMPUTER, Granada;
> `okcomputer.es`), no tiene relación con Ok Computer Tenerife: se recoge aquí
> como REFERENCIA de producto para `docs/PLAN_SISTEMA_UNIFICADO.md`. No se
> reutiliza código ni marca.

## Qué es

«El puesto de mando de IA de tu empresa»: una PWA (Vite, hash-routing
`#/ruta`, service worker, instalable, «Simular sin red») que NO sustituye al
ERP del cliente —se conecta a SAGE 200, STEL Order, ERPiA, A3, agencias de
transporte, cámaras, GPS…— y cruza todo en una sola pantalla. Un **bot de
Telegram** atraviesa todos los módulos: consulta, comandas por audio,
informes programados, clips de cámara, fichaje con un botón, recordatorios de
agenda con «Hecho / En 1 hora». Backend en Supabase (se ve la URL de
`realtime` en el bundle).

Patrones de producto que se repiten en todas las pantallas:

- **Baldosa = módulo, con su número en vivo** («8.420 € ventas de hoy»,
  «6 bajo mínimo», «5/6 fichados ahora mismo») y un tono (positivo, aviso,
  negativo). El inicio son las baldosas agrupadas por área.
- **Cada pantalla abre con un párrafo en primera persona** que dice para qué
  sirve y qué decisión ayuda a tomar, seguido de 4 tarjetas KPI y las tablas.
- **Avisos accionables ordenados por dinero**, con un botón que lleva al
  sitio exacto (Perseguirlo, Ver la oferta, Ver el MRP, Resolverlo…).
- **El «origen» del dato siempre a la vista** (SAGE 200 / STEL Order / OKHUB):
  el hub lee, cruza y enseña; «no le cambia los números al ERP por la
  espalda».
- **Tour guiado de 10 pasos** al entrar, botón Reiniciar (vuelve a los datos
  de demo), tema claro/oscuro, reloj, buscador de módulos.

## Menú (6 grupos, 25 módulos + 2 fichas)

| Grupo | Módulos (ruta) |
|---|---|
| Dirección | Panel de dirección `#/bi` · Comandas `#/comandas` · Asistente `#/asistente` · Informes por Telegram `#/informes` · Cámaras y NVR `#/camaras` · Agenda `#/agenda` |
| Ventas | Clientes `#/clientes` (+ ficha `#/cliente/<id>`) · Pedidos y presupuestos `#/ventas` · Portal de tus clientes `#/b2b` · Mapa de clientes `#/mapa` · Cobros `#/cobros` · Tu web, conectada `#/web` |
| Almacén | Maestro de materiales `#/maestro` (+ ficha `#/material/<ref>`) · Inventario y stock `#/inventario` · Envíos y agencias `#/envios` · Flota y repartos `#/flota` |
| Compras / MRP | Compras y MRP `#/compras` |
| Servicio técnico (SAT) | Partes y asistencias `#/sat` |
| Administración | Control de presencia `#/fichajes` · Gastos y tickets `#/gastos` · Portal del asesor `#/gestoria` · Sistemas `#/sistemas` · Conexiones (ERP) `#/conexiones` · App del equipo `#/empleado` · Buscador de documentos `#/archivos` |

## Dirección

### Panel de dirección (`#/bi`) — «Lo que necesita una decisión tuya, ordenado por dinero»
- KPI: **Ventas del mes** (vs mismo mes del año pasado, y «hoy llevas»),
  **Lo que te queda** (margen € y % frente al objetivo marcado), **Dinero en
  la calle** (saldo pendiente, cuánto ya vencido y en cuántas facturas),
  **Lo que está en juego** (ofertas enviadas sin respuesta).
- **Lo que necesita tu atención (N)**: lista ordenada por importe, cada fila
  con título en lenguaje natural, detalle (documento, días, avisos ya
  enviados), importe y botón: presupuesto sin respuesta → *Ver la oferta*;
  factura vencida → *Perseguirlo*; cliente A sin comprar 53 días → *Abrir su
  ficha*; referencias bajo mínimo (con el coste de reponerlas) → *Ver el
  MRP*; envío parado por dirección incompleta → *Resolverlo*; preguntas de la
  web sin contestar → *Contestar*; cita vencida → *Ver agenda*; cierre del mes
  sin mandar a la asesoría → *Ir al portal*.
- **Doce meses de ventas**: barras del año con una rayita del año anterior
  por mes (rojo si no llega). **Dónde ganas dinero**: ventas y margen por
  familia, con una frase de conclusión («Cemento es lo que más vendes y lo
  que menos margen te deja; cada punto son 442 €/mes»). **Tus cuentas
  grandes**: top 5 por venta anual con cómo pagan (6 días tarde /
  pendiente) y frase de consejo. **Lo último que ha pasado**: feed en vivo
  (reparto salió, recordatorio de cobro enviado, comanda desde Telegram,
  fichaje).

### Panel de comandas (`#/comandas`) — «Audio del jefe → tareas para el equipo»
- Nota de voz (Telegram o grabada en la app) → transcripción → se trocea en
  tareas y se reparte «como las comandas de un bar». Chips de personas para
  añadir a mano. Columnas **Pendiente / En curso / Hecho** con contador;
  cada tarjeta: texto, persona, origen (MANUAL · TELEGRAM) y hora, botones
  *Empezar* · *Volver* · *Hecha* · *Reabrir*, marca PRIORIDAD.

### Asistente (`#/asistente`) — «Pregúntale al sistema en lenguaje natural»
- Chat estilo Telegram con el bot conectado al sistema; «no inventa: lee el
  ERP, la flota y el almacén». Sugerencias: ¿Qué comandas quedan? ¿Quién me
  debe dinero? ¿Qué tengo hoy en la agenda? ¿Cómo van los repartos? ¿Cuánto
  llevamos vendido hoy? ¿Está hecha la copia de seguridad?

### Informes por Telegram (`#/informes`) — «Lo que el HUB te cuenta solo»
- KPI: informes en marcha (4/5), último enviado, destinatarios distintos.
- Vista del móvil del gerente con los mensajes reales: **Cierre del día**
  (facturado, pedidos, cobrado hoy, en la calle, repartos, «queda abierto»),
  **Qué hay que comprar** (referencias bajo mínimo con proveedor y plazo, «te
  he dejado la solicitud de pedido preparada»), **Ventas de ayer** (vs
  semana anterior, mejor cliente, cliente A sin comprar), **Recordatorio de
  fichaje** con botones ✅ Fichar entrada · ⏰ En 15 min.
- **Qué se manda y a quién**: por informe, hora · días · destinatarios ·
  regla («solo escribe si hay algo bajo mínimo», «los lunes cubre el fin de
  semana», «si a las 10 h no hay salida reinsiste y a los 30 min avisa a
  gerencia»), estado apagado/encendido y botón *Enviar ahora*.
- **Pide uno nuevo** en lenguaje natural: «cada viernes, márgenes por
  familia», «cuando un cliente A lleve 30 días sin comprar», «si el stock de
  cemento baja de 300», «los días 1, el resumen del mes para la gestoría».

### Cámaras y NVR (`#/camaras`)
- Bridge on-prem (mini PC en la nave) que habla por LAN con el grabador
  (Dahua, Hikvision, X-Security, Uniview…) y solo sale hacia el hub; canales
  en directo, eventos del día de vídeo-analítica (camión entra al muelle,
  operario sin chaleco, movimiento en vallado) con clip, cola de peticiones
  de clip pedidas por Telegram («muelle 2, ayer 13:55» → URL firmada).
  Tabla de compatibilidades (grabadores, ERPs, accesos, mensajería).
  **No aplica a Ok Computer** (no es el negocio); la idea de «pide un clip
  por chat» podría aplicarse algún día a las alertas RMM.

### Agenda (`#/agenda`) — «Tu calendario de siempre, con el sistema dentro»
- Calendarios conectados: OKHUB (lo que genera el sistema), Google Calendar,
  Microsoft 365, «Conectar otro». Vistas Semana / Día / Lista, botón
  *Avisar*. Lo del sistema entra solo (seguro que vence, cierre con la
  asesoría, entrega del jueves). **Recordatorio por Telegram 30 min antes**
  con botones ✅ Hecho · ⏰ En 1 hora · 📋 Ver la ficha; si no se hace,
  reinsiste y avisa a quien lleve la cuenta. **Notas rápidas** con
  etiquetas `#proveedores #flota #ideas`.

## Ventas

### Clientes (`#/clientes`) — «Cartera · saldo, última compra y a quién hay que llamar»
- KPI: en cartera (cuentas y localidades), ventas del año (y % que ponen las
  cuentas A), saldo en la calle (cuentas con factura vencida), vencido (el
  peor y sus días).
- Filtros-chip: Toda la cartera · Ya vencido · Con saldo abierto · Cuentas A
  · Sin comprar hace un mes. Botón *Verla en el mapa*.
- Tarjeta por cliente: iniciales, nombre, contacto · localidad, **estado de
  cobro** (SALDO / DEBE X € · N D / AL DÍA), ventas del año, última compra
  (fecha e importe; «hace 53 días» si es vieja), **CLASE A/B/C**, origen
  (SAGE/STEL), **la siguiente acción** en una línea («Cobrar factura vencida
  — llamar a Paco hoy», «Ofrecer bovedilla para el forjado») y *Ver todo lo
  suyo*.

### Ficha de cliente (`#/cliente/<id>`) — «Cada cuenta con su película»
- Cabecera: sector · localidad · cliente desde; clase; origen. Pestañas con
  contador: **Qué compra** · Pedidos · Cobros · Averías · Envíos · Comandas
  de hoy · Dónde está · Histórico.
- KPI: ventas del año (% de la facturación de la casa), saldo pendiente,
  vencido, pedidos del periodo.
- **Con quién se habla** (contacto, teléfono, email, *Llamar* / *Escribir*).
  **Lo siguiente que hay que hacer** (fecha + texto + *Hecho*) y «última
  compra el … · qué fue».
- Qué compra (referencias, unidades, pedidos, importe; avisa si una está
  bajo mínimo), pedidos, cobros (factura, emitida, vence, importe,
  situación, recordatorios enviados), averías/SAT, envíos por agencia,
  comandas de hoy que le nombran, mapa, **histórico de todo lo que se ha
  hablado** (pedido servido, WhatsApp, llamada, con quién) y **«Apuntar lo de
  hoy»** (llamada / whatsapp / email + texto + *Anotar*).

### Pedidos y presupuestos (`#/ventas`)
- KPI: pedidos del periodo (importe, nº, en curso), presupuestos vivos (nº e
  importe en juego), origen de los datos (15 SAGE + 12 STEL), ticket medio.
- Tabla de pedidos (nº, cliente, origen, fecha, líneas, importe, estado
  SERVIDO / PENDIENTE / EN PREPARACIÓN) y de presupuestos (validez, estado
  ENVIADO / ACEPTADO / PENDIENTE / RECHAZADO). El nombre del cliente abre su
  ficha.

### Portal de tus clientes (`#/b2b`) — «Piden solos, con su precio y su histórico»
- KPI: pedidos por el portal, clientes con acceso (de N invitados), pedidos
  fuera de horario.
- **Así lo ve tu cliente**: `clientes.<dominio>` con «Hola, Manuel»,
  catálogo con precio de tarifa tachado y **su precio pactado**, stock en el
  almacén, +/−, carrito; botón **«Lo de siempre»** (recompra).
- Qué ve cada cliente (se enciende uno a uno): catálogo con su precio, lo de
  siempre, sus pedidos y albaranes, sus facturas, seguimiento de envíos,
  partes de SAT y bot de soporte, soporte desde el portal (espejo en
  Telegram). Tabla de pedidos entrados por el portal (SIN ATENDER → *Pasar a
  almacén*). **Quién tiene acceso**: persona, email, ACTIVO/INVITADO, último
  acceso, *Revocar*.

### Mapa de clientes (`#/mapa`)
- Leaflet + OpenStreetMap; cada cliente un punto con su clase (A/B/C) y
  color por **estado de cobro** (verde al día, rojo vencido, gris sin
  saldo). KPI: clientes en el mapa, con pagos vencidos, dinero en la calle,
  cuentas A.

### Cobros (`#/cobros`) — «Quién te debe, desde cuándo, recordatorios automáticos»
- KPI: en la calle (facturas sin cobrar), vencido (la peor, días), cobrado
  este mes.
- Tabla de facturas pendientes (factura, cliente, importe, vence «hace 14
  días»/fecha, estado VENCIDA 2 AVISOS / VENCE PRONTO / AL DÍA) con botones
  *Recordar* y *Cobrada*; *Perseguir las vencidas*.
- Regla: 3 días antes de vencer recordatorio amable por email y WhatsApp; al
  vencer, otro; a ti te avisa por Telegram de a quién llamar primero.

### Tu web, conectada (`#/web`)
- KPI: preguntas sin contestar, visitas de la semana, productos publicados
  con stock.
- **Lo que ha entrado por la web**: formulario de contacto, ficha de
  producto, WhatsApp de la web; cada uno con nombre, empresa, texto,
  teléfono/email, estado SIN CONTESTAR / YA ES CLIENTE y botones *Convertir
  en cliente* · *Pasar a un comercial* · *Descartar*.
- **Cómo se ve la web**: catálogo publicado con «desde X €», stock real y
  «entrega en 24 h»; interruptor «Enseñar el stock real en la web» (si se
  apaga, «consultar disponibilidad»). Tabla del catálogo publicado.

## Almacén

### Maestro de materiales (`#/maestro`)
- «Qué es cada referencia», no cuánto hay. KPI: referencias (alta/baja),
  familias, proveedores (referencias sin proveedor), margen de tarifa
  (rango). Filtros por familia y almacén; chips Todas · De alta · De baja ·
  Sin proveedor · Fuera del MRP; *Exportar CSV*.
- Tabla: referencia + EAN, descripción + marca/subfamilia, familia, almacén
  principal + ubicación, unidad + peso, múltiplo («compra ×56»), stock de
  seguridad, plazo, proveedor principal (su referencia, «+1 alternativo»),
  tarifa (coste y margen), ficha en (SAGE/STEL), estado.

### Ficha de material (`#/material/<ref>`)
- Secciones: Datos básicos · Costes y precios · Existencias · En camino ·
  Proveedores · Reposición y MRP · Quién lo compra · Pedidos abiertos ·
  Movimientos · Ficha comercial.
- KPI: stock ahora (mínimo, ubicación, «+560 de camino»), valor a coste,
  margen, vendidas (clientes e importe).
- «Lo que el HUB le añade a la ficha del ERP»: unidad, peso, EAN y notas
  internas viven en el hub y se guardan; referencia/descripción/familia/
  coste/PVP son del ERP («el HUB los lee, no los pisa»).
- Costes: último coste de compra (albarán), coste medio ponderado, coste de
  ficha, PVP, margen unitario, valor del stock. Existencias por almacén con
  **asignado a pedido** y **por ubicar**, y por hueco (estantería / asignado
  / por ubicar). *Ajustar stock* y *Traspasar* escriben contra el ERP con el
  usuario.
- En camino (pedidos de compra confirmados; «el MRP las descuenta»).
  Proveedores con precio, plazo, múltiplo, condiciones y su referencia.
  **Reposición y MRP**: stock disponible (nave + camino), consumo semanal
  (media de semanas con salidas), **se agota en N días** (fecha), **pedir
  antes de** (fecha, según plazo del proveedor principal), gráfico de
  consumo por semana, parámetros editables: stock de seguridad y cobertura
  en semanas.

### Inventario y stock (`#/inventario`)
- KPI: referencias en N almacenes, valor del stock a coste, bajo mínimo,
  familias. Tabla ref · producto · almacén · ubicación · stock · mínimo ·
  PVP · origen; bajo mínimo en rojo y «pasa sola a Compras/MRP».

### Envíos y agencias (`#/envios`)
- KPI: bultos en la calle, entregados hoy (con firma o confirmación de la
  agencia), incidencias («saltan aquí, no cuando llama el cliente»).
- Filtros por estado (preparado, en tránsito, en reparto, entregado,
  incidencia) y por agencia (Palibex, SEUR, MRW, GLS, Correos Express,
  Nacex). Tabla: albarán, cliente y destino, agencia y servicio, bultos y
  kg, nº de seguimiento, estado (y «sin avisar» si el cliente no ha recibido
  aviso). Agencias conectadas con última sincronización.

### Flota y repartos (`#/flota`)
- Mapa en vivo (posición cada 30 s), repartos de hoy por parada (cliente,
  destino, hora, carga, «llega sobre las», conductor, vehículo, estado EN
  RUTA / CARGANDO / ENTREGADO + FIRMADO), botones *Marcar entregado* /
  *Salir a ruta*; vehículos con estado. **No aplica** salvo la idea de
  paradas del día por técnico, que Ok Computer ya tiene (Mapa → Ruta).

## Compras / MRP (`#/compras`)
- Explica el MRP en dos frases. KPI: sugerencias de compra, inversión
  propuesta, proveedores implicados («agrupables en un pedido cada uno»),
  plazo máximo de entrega.
- Tabla de sugerencias: ref, producto, stock/mín., **pedir +N** (respeta el
  múltiplo), proveedor y plazo, origen, coste. Tabla de proveedores:
  familia, plazo, teléfono, valoración ★, origen.

## Servicio técnico (`#/sat`)
- KPI: partes abiertos, averías activas, técnicos en campo, cerrados.
  Tabla: nº, cliente y trabajo, tipo (INSTALACIÓN / AVERÍA / MANTENIMIENTO),
  técnico, fecha, origen, estado. Ok Computer ya lo tiene mucho más
  completo (trabajos + tickets + fichaje + firma).

## Administración

### Control de presencia (`#/fichajes`) — RD 8/2019
- Aviso arriba: «Rafa lleva 10 h 12 min sin fichar salida; ya se lo ha
  recordado por Telegram». Cronómetro de la propia jornada y *Fichar
  entrada*. Registro de hoy: persona, entrada, salida, **vía** (Torno /
  Telegram / App), estado DENTRO. Botones *PDF Inspección* y *A3 Nóminas*.
  **Ausencias y vacaciones**: persona, tipo, fechas, APROBADA / *Aprobar*.

### Gastos y tickets (`#/gastos`)
- «Foto al ticket y listo»: OCR extrae importe, calcula IVA, propone
  categoría. KPI: gasto acumulado, sin contabilizar, tickets registrados.
  Tabla concepto · categoría · fecha · importe · estado CONTABILIZADO /
  PENDIENTE (*Contabilizar*). Botón *Fotografiar ticket*.

### Portal del asesor (`#/gestoria`) — «solo lectura · lo autorizas tú»
- KPI: cierre del mes (gastos, fichajes, km), falta por cerrar, accesos del
  despacho. Datos del despacho y su programa contable (a3ASESOR, Sage
  Despachos, Sage 50, ContaSOL, Excel/CSV, SUENLACE.DAT).
- **El cierre del mes**: gastos, base imponible, cuota de IVA, tickets
  adjuntos, fichajes, kilómetros, cobros pendientes, nóminas repartidas →
  *Generar el paquete*; meses anteriores «descargado el … por …», REVISADO,
  BLOQUEADO.
- **Lo que falta para cerrar** («sin esto, el despacho te llama»): ticket
  sin foto, CIF ilegible, entrada sin salida, contrato que falta — cada uno
  con la persona y *Reclamar*; *Reclamar todo*.
- **Quién entra y qué ve**: personas del despacho (fiscal, laboral, admin)
  ACTIVO/INVITADO, *Revocar*, *Invitar*; **permisos por bloque** (fichajes y
  ausencias, gastos, km y dietas, cobros pendientes, nóminas-buzón; ventas y
  márgenes APAGADO; datos de personal NSS/IBAN APAGADO). **Traza de
  accesos** (entró, descargó, marcó revisado y bloqueó).

### Sistemas (`#/sistemas`)
- Copias 3-2-1 (última, tamaño, duración, retención, cifrado, tres
  destinos con ocupación), **restauración probada** (fecha, «SAGE abrió sin
  errores», *Probar restauración*), últimas copias con avisos («el portátil
  estaba apagado, no entró»). Control de accesos (puertas y tornos, abrir/
  cerrar, últimos pasos, intento denegado con clip). Alarma perimetral
  (armada/desarmada, programación, zonas, batería baja). **Salud de
  equipos** (SO, antivirus, parches, visto hace, disco %, OK/AVISO). Avisos
  abiertos con nivel y *archivar*. Ok Computer cubre lo de equipos con RMM;
  «copias probadas» es una idea reutilizable.

### Conexiones (`#/conexiones`)
- Dos ERPs en paralelo con lo que aporta cada uno; lista de 15 sistemas
  conectados con último latido; incidencias internas (cámara caída,
  transpaleta hace ruido) con nivel, quién abrió y estado. No aplica.

### App del equipo (`#/empleado`) — «funciona sin cobertura»
- Móvil simulado: Fichar entrada · Fotografiar un gasto (OCR) · Compartir
  ubicación (en ruta); **cola de sincronización** visible; «Simular sin
  red». Ok Computer ya lo tiene (`offline-cola.js`, modo calle).

### Buscador de documentos (`#/archivos`) — «RAG · respuestas con cita a la fuente»
- Indexa la carpeta de Google Drive (tarifas, contratos, procedimientos,
  prevención) cada vez que cambia un archivo; preguntas en lenguaje natural
  («¿a cómo está el saco de cemento?», «apilado máximo de sacos»);
  respuesta con el dato y de qué documento sale; lista de documentos
  indexados con categoría y nº de fragmentos.

## Qué se toma para Ok Computer (resumen; el detalle está en el plan)

- Sí: panel de dirección con avisos por dinero; comandas; informes
  programados con «enviar ahora» y alta en lenguaje natural; bot de chat
  sobre el sistema; ficha de cliente 360 con línea de tiempo y «lo
  siguiente»; cobros con recordatorios; portal de clientes; web conectada;
  mapa por cobro; ficha maestra + MRP; envíos; jornada RD 8/2019 con
  ausencias y export; gastos con OCR; portal del asesor; RAG; baldosas con
  número en vivo; el párrafo explicativo de cada pantalla.
- No (por ahora): cámaras/NVR, flota GPS, conexiones ERP, alarma/tornos.
