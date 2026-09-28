# Fase 8 · Comandas

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Hecha en una
entrega (2026-09-27).

## Decisiones de Fran

- Audio → texto con **Groq Whisper** (clave de Groq para el hub).
- Las tareas y la lista del día de la app **no se cortan** (las usa su
  calendario): las comandas crean **tareas del hub**, con su tablero por persona.

## Qué hay

- **Migración `20261012_comandas.sql`** (aplicada): `hub.comandas` (lo dictado
  o escrito, quién, por dónde, si lo troceó Claude) y `hub.comanda_tareas`
  (texto, persona, Pendiente / En curso / Hecha, prioridad, fecha límite,
  origen). Un trigger apunta cuándo se empezó y se hizo. El tablero es del
  equipo: cualquiera mueve o reparte una tarjeta; borrarla, quien la creó o un
  admin. Aviso nuevo en `hub.avisos_extra()`: `comanda_parada` (prioritaria sin
  empezar tras 4 h, o con la fecha pasada).
- **`_shared/comandas.ts`**: `transcribir()` (Groq Whisper,
  `whisper-large-v3-turbo`, en español), `trocear()` (Claude con salida JSON
  fija; sin clave, una tarea por línea o frase y la persona si la frase empieza
  por su nombre) y `crearComanda()` (guarda y avisa por Telegram a cada persona
  de lo suyo).
- **Función `comandas`** (con sesión): `estado` y `crear` (texto o audio en
  base64).
- **Pantalla `#/comandas`**: grabar (micrófono del navegador) o escribir, tarea
  suelta, chips por persona, tablero con Empezar · Volver · Hecha · Reabrir y
  arrastre, repartir a otra persona, últimas comandas con lo transcrito.
- **Telegram**: una **nota de voz** al bot se reparte como comanda;
  `/comanda <texto>` y `/comandas` (lo tuyo pendiente).
- **MCP**: `comanda_crear`, `comandas_listar`, `comanda_tarea_actualizar`.

## Falta (de Fran, ver `PENDIENTE_FRAN.md`)

- `GROQ_API_KEY` en los secrets de las funciones del hub (puede ser la misma
  clave que usa la app).
- `ANTHROPIC_API_KEY` (la misma del buscador) para que Claude reparta bien.
