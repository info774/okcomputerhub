# Fase Final · Trabajos, calendario, chat y modo calle — PROGRAMADA, SIN EL CAMBIO

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Programada el
2026-09-27. **El cambio (que el equipo deje la app y trabaje en el hub) NO está
hecho**: espera al OK explícito de Fran.

## Qué hay ya

- **Migración `20261016_final.sql`** (aplicada, no corta nada):
  - Espejo de `trabajo_comentarios` y `trabajo_fotos` (sin la foto en crudo:
    su enlace de Drive), en el área `trabajos`. Carga hecha: 5 y 123.
  - Las escrituras del día a día, como **funciones de la base que portan las
    reglas de la app** y que **solo funcionan con el área cortada**
    (`hub.exigir_area`): hoy contestan «se sigue llevando en la app».
    - `hub.fichar('traslado' | 'inicio' | 'fin', …)`: `ui/fichaje.js` de la
      app — no hay dos sesiones abiertas; el inicio cierra la sesión olvidada,
      reusa el traslado y pone la ficha en curso.
    - `hub.trabajo_guardar_lineas(trabajo, líneas)`: `saveWdLineas` +
      `_ajustarStockTrabajo` — la diferencia mueve el stock REAL (nunca por
      debajo de 0) y apunta lo que de verdad cambió, con el trabajo.
    - Borrar un trabajo devuelve antes su material (trigger).
    - `hub.trabajo_estado(id, estado)`: Completado exige fichaje con inicio y fin.
    - `hub.agenda_mover(id, inicio, fin)`: arrastrar en el calendario.
  - **Chat del hub** (nuevo, el de la app no se copia): `hub.chat_canales`
    (grupos y directos), `hub.chat_mensajes`, `hub.chat_leidos`,
    `hub.chat_directo()`, `hub.chat_resumen()`. Canal «General» creado.
- **`supabase/cortes/corte_final.sql`** (preparado, **NO aplicado**): pasa todas
  las áreas al hub, da numeración propia a trabajos y tareas (siguiendo la de
  la app) y quita las tareas de pg_cron del sync. Probado en local
  (`npm run probar-migraciones` lo aplica sobre la base de prueba y ejerce las
  funciones de arriba).
- **Pantallas** (se cargan bajo demanda): `#/trabajos` (lista y ficha con
  material, agenda, fichajes, comentarios, fotos y tickets), `#/calendario`
  (semana por día o por técnico, con lo fichado encima), `#/chat` y `#/hoy`
  (modo calle: siguiente parada con llamar y cómo llegar, fichar, terminar con
  **foto obligatoria**). Con el área de la app enseñan todo y avisan de que se
  cambia en la app; tras el corte, las mismas pantallas escriben
  (`src/core/areas.ts`, `esDelHub()`).
- **Función `trabajo-foto`**: sube la foto al almacén privado «trabajos» (solo
  con el área cortada).

## El cambio, paso a paso (cuando Fran diga; NO antes)

1. **Aviso al equipo** con fecha y hora. Ese rato nadie toca la app.
2. **Congelar la app**: ponerla en solo lectura (o apagar su despliegue) para
   que nadie escriba mientras se corta. Es tocar la app actual: lo hace Fran
   (o Claude con su permiso expreso).
3. **Última copia**: Datos → «Pasada completa» (o `sync-app` con
   `{ modo: 'completo', todas: true }`) y comprobar en Datos que no hay error.
4. **Aplicar `supabase/cortes/corte_final.sql`** (workflow «Aplicar migración»
   o el SQL del proyecto del hub).
5. **Probar** en el hub: crear un trabajo, fichar inicio y fin desde Hoy,
   terminar con foto, mover un bloque en el calendario, gastar material y ver
   el movimiento en Almacén.
6. **Redirigir la app al hub**: en `okcomputerclaude`, que su dominio sirva una
   redirección a `https://hub.okcomputertenerife.com` (como ya hace
   `legacy-redirect/` con el dominio viejo).
7. **APK**: cambiar la URL que carga la APK por la del hub y reconstruirla
   (`build-apk.yml` de la app, mismo keystore).
8. **Apagar lo que quede** de la app (sus cron de Zoho/Stripe/WhatsApp siguen
   hasta portar esas integraciones: mantenimiento con Stripe, WhatsApp Cloud y
   la facturación, que tiene su propio interruptor en la fase 11).

## Lo que aún no está portado (a propósito)

- Mantenimientos con Stripe y la firma de contratos de la app (el hub tiene su
  firma genérica), WhatsApp Cloud (entrada y bandeja), presupuestos con Zoho,
  tareas y lista del día de la app. Hasta portarlos, esas pantallas se quedan
  en la app aunque se haga el cambio de trabajos.
