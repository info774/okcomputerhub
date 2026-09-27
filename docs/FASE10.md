# Fase 10 · Personas: jornada, ausencias, gastos, gestoría y firma

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Hecha en una
entrega (2026-09-27).

## Decisiones de Fran

- **Gestoría con acceso propio** (jornada, gastos, facturas y cierre mensual),
  con traza de lo que consulta.
- **Firma propia del hub** para cualquier documento.
- Fichaje y gastos de los técnicos **siguen en la app** hasta la Final; el hub
  calcula el registro de jornada sobre la copia.

## Qué hay

- **Migración `20261014_personas.sql`** (aplicada):
  - **`hub.jornada(desde, hasta, persona)`**: registro diario (RD-ley 8/2019)
    sobre los fichajes de la app (`hub.sesiones`): entrada = primer traslado o
    inicio, salida = último fin, tiempo trabajado = unión de los tramos (lo
    solapado no cuenta dos veces), pausas = el resto. Cada uno ve lo suyo; los
    admins, todo. Los fichajes sin `tecnico_id` se casan por nombre.
  - `hub.jornada_ajustes`: correcciones de un admin con **motivo obligatorio**
    y autor; mandan sobre lo calculado, sin tocar el fichaje.
    `hub.jornada_cierres`: la conformidad de cada persona con su mes.
  - `hub.ausencias` (vacaciones, asuntos propios, baja, permiso): se piden, las
    decide un admin; los días laborables los cuenta la base con el horario y
    los festivos del Desk (`hub.dias_laborables`). Salen en la jornada.
    `hub.config.vacaciones_dias` = 22.
  - `hub.tickets_gasto`: foto o PDF de un gasto, leído por Claude (fecha,
    proveedor, NIF, base, IGIC, total, categoría), que alguien revisa y un
    admin confirma. Los ficheros van al almacén PRIVADO `gastos` de Storage (lo
    crea la función; se descargan con URL firmada de minutos).
  - `hub.cierres_mes`: la gestoría lo marca revisado (con nota) y un admin lo
    cierra.
  - `hub.firmas`: documento en markdown con enlace público; la huella sha256 se
    recalcula con cada cambio (y el enlace viejo deja de valer); al firmar se
    comprueba que es la misma; firmado = inmutable (lo impide un trigger, ni un
    admin). `hub.firma_ver` / `hub.firma_firmar` solo para la función.
  - Gestoría: `portal_accesos.tipo = 'gestoria'` (sin cliente).
  - Avisos (`hub.avisos_personas`): ausencia por aprobar, documento sin firmar
    (> 3 días), gastos por revisar, mes sin cerrar con la gestoría.
- **Funciones**: `gastos-ocr` (con sesión), `firma` (SIN_JWT para el
  firmante; `enviar` con sesión, por Gmail) y `portal` (acciones `g_*` de la
  gestoría, cada una a la traza).
- **Pantallas**: `#/personas` (Jornada con CSV, imprimir, corregir y
  conformidad; Ausencias; Gastos; Cierre del mes) y `#/firmas`. En `#/portal`
  se da el acceso a la gestoría.
- **Páginas públicas**: `firmar.html?t=…` (firma con el dedo, nombre, DNI,
  huella) y `gestoria.html` (jornada por persona, ausencias, gastos con su
  ticket, facturas emitidas, cierre; CSV de cada vista).

## Ojo

- Hay días con más de 12 h en los fichajes de la app (fichajes que se quedaron
  abiertos): la jornada los marca en rojo para corregirlos con su motivo.
- La jornada es tan buena como el fichaje: lo que no se fichó en la app no
  existe hasta que un admin lo corrige.

## Falta (de Fran, ver `PENDIENTE_FRAN.md`)

- `ANTHROPIC_API_KEY` (lectura de los tickets; sin ella se rellenan a mano).
- Dar el acceso a la gestoría en `#/portal` con su correo.
- La delegación de Gmail para mandar enlaces de firma y de entrada (sin ella,
  se copian y se mandan a mano).
