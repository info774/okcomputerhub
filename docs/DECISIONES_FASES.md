# Decisiones de Fran para las fases 5 a Final (2026-09-27)

Fran pidió que se le hicieran de una vez todas las preguntas de las fases que
faltan y que se programen seguidas sin revisión intermedia. Esto es lo que
contestó; manda sobre el plan (`PLAN_SISTEMA_UNIFICADO.md`) donde choque.

## Reglas generales

- **Cortes de área**: solo los que NO rompen la app actual. Lo que usan
  trabajos, calendario o modo calle (tareas, lista del día, inventario,
  catálogo, fichaje, gastos de los técnicos) se prepara en el hub pero no se
  corta hasta la fase Final.
- **Nunca escribir en la base de la app** (`okcomputer`). Si algo lo
  necesitaría, se busca otra salida y se apunta como pendiente.
- **Fase Final**: se programan las pantallas, pero la redirección de la app al
  hub, el cambio de URL de la APK y apagar `sync-app` esperan a un OK
  explícito de Fran.
- **Dominios**: `hub.okcomputertenerife.com` para el hub y
  `clientes.okcomputertenerife.com` para el portal. DNS: se le dice
  exactamente qué registros poner (o se ponen en Hostinger con su permiso).

## Fase 5 · Wiki y buscador

- Respuestas redactadas por **Claude** (clave de la API de Anthropic en las
  funciones del hub), citando la fuente.
- Se indexa **una carpeta de Google Drive** compartida (solo lectura) con la
  cuenta de servicio del hub.
- **Sin importador de Notion** (pocas páginas; se copian a mano).
- La extensión `vector` se usa **donde está** (esquema `public`, de Breeze):
  solo su tipo y su operador, sin crear ni cambiar nada allí. El comprobador
  de migraciones lo permite solo para eso.

## Fase 6 · Desk

- **Tickets pasan al hub** (área `tickets` cortada con `importar_altas`: lo
  que la app sigue creando sola —WhatsApp, RMM— entra al hub). En la app se
  deja de usar la pantalla de tickets; «convertir en trabajo» se hace creando
  el trabajo en la app y enlazándolo.
- **Correo → ticket** con **Google Workspace** (API de Gmail sobre
  info@okcomputertenerife.com), respuestas desde el mismo buzón.
- **SLA** (horario L-V 9-14 y 16-19, Canarias), primera respuesta /
  resolución (el doble): Urgente 2 h / 4 h · Alta 4 h / 8 h · Media 1 día /
  2 días · Baja 3 días / 6 días. Editables.
- **Valoración**: enlace para puntuar 1-5 en el mensaje de cierre (lo manda el
  técnico); nada sale solo.

## Fase 7 · Portal de clientes

- Ven: **tickets** (abrir y seguir), **presupuestos y facturas** (ver,
  descargar, aceptar presupuestos, lo pendiente), **contratos y
  mantenimiento**, **estado de sus equipos** (Breeze).
- Entran con **enlace mágico por correo** (enviado desde el Gmail de la
  empresa), solo emails invitados; accesos revocables con traza.

## Fase 8 · Comandas

- Audio → texto con **Groq Whisper** (clave de Groq para el hub).
- Tareas y lista del día NO se cortan (las usa el calendario de la app): las
  comandas crean tareas del hub, en su tablero por persona.

## Fase 9 · Almacén

- Inventario y catálogo se quedan en la app hasta la Final (los técnicos
  gastan material desde los trabajos).
- **Proveedores y pedidos de compra pasan al hub**; el MRP calcula con el
  stock y el consumo que llegan de la app.
- Envíos: **Correos / Correos Express** y, sobre todo, registro manual con
  número de seguimiento (sin integración obligatoria).

## Fase 10 · Personas

- **Gestoría con acceso propio** (rol `gestoria`: jornada, gastos, facturas y
  cierre mensual, con traza de lo que consulta).
- **Firma propia del hub** (portada de la firma de contratos de la app) para
  cualquier documento.
- Fichaje y gastos de los técnicos siguen en la app hasta la Final; el hub
  calcula el registro de jornada (RD 8/2019) sobre la copia.

## Fase 11 · Facturación

- **Programada y probada pero SIN ACTIVAR**: Zoho Books sigue emitiendo hasta
  que la gestoría la valide y Fran dé el OK.
