# Fase 5 · Wiki y buscador (RAG)

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Hecha en una
entrega (2026-09-27).

## Decisiones de Fran

- Respuestas redactadas por **Claude**, citando de qué documento sale cada dato.
- Se indexa **una carpeta de Google Drive** compartida en solo lectura con la
  cuenta de servicio `firebase-adminsdk-fbsvc@okcomputerclaude.iam.gserviceaccount.com`.
- **Sin importador de Notion** (las pocas páginas se copian a mano).
- La extensión `vector` se usa **donde está** (en `public`, de Breeze).

## Qué hay

- **Migraciones `20261009_wiki.sql` y `20261009b_wiki_vector.sql`** (aplicadas):
  - `hub.paginas` (árbol por `padre_id`, markdown, icono, proyecto, archivada,
    `tsv` en español) y `hub.paginas_versiones`: un trigger guarda la versión
    anterior cada vez que cambia título o contenido y evita ciclos en el árbol.
  - Espejo de `conocimiento` y `tablero_notas` de la app (área `conocimiento`,
    dueño `app`): el buscador también encuentra lo que el equipo apuntó allí.
  - `hub.documentos` (una fila por cosa indexada: página, fichero de Drive,
    registro de la app; estado `pendiente | indexado | error | omitido`) y
    `hub.documentos_fragmentos` (trozos con `embedding public.vector(384)`,
    índice HNSW y `tsv`).
  - **`public` está cerrado incluso al `service_role`**: los vectores entran y
    salen como TEXTO por dos funciones `security definer`:
    `hub.guardar_fragmentos(documento, trozos)` (solo `service_role`) y
    `hub.buscar_fragmentos(embedding, texto, k)` (búsqueda híbrida: semántica
    + léxica, fusionadas por RRF).
  - pg_cron `hub-indexar` cada 10 min (`documentos-indexar`, `cola`); Drive se
    relee cada 6 h dentro de la misma pasada.
- **Funciones**:
  - `documentos-indexar` (SIN_JWT, la llama pg_cron; con sesión, `estado`,
    `pagina` y `drive`): trocea y calcula embeddings con `gte-small`
    (`Supabase.ai`, sin coste ni clave). Drive: Google Docs/Sheets/Slides
    exportados, PDF (`unpdf`), docx y texto; lo demás queda `omitido`.
  - `documentos-preguntar` (con JWT): busca y, con `ANTHROPIC_API_KEY`, Claude
    redacta citando `[n]`. Sin clave devuelve solo las fuentes.
  - `_shared/rag.ts` (trocear, embeddings, `preguntar`), `_shared/claude.ts`
    (cliente de la API de Anthropic, lo usarán comandas y gastos),
    `_shared/google.ts` (token de la cuenta de servicio, secret `GOOGLE_SA_KEY`).
- **Pantallas**: `#/wiki` (árbol, búsqueda por palabras, editor con vista
  previa, subpáginas, mover, archivar, historial y restaurar; al guardar se
  reindexa) y `#/buscar` (pregunta → respuesta con citas, estado del índice y,
  admins, la carpeta de Drive).
- **MCP**: `preguntar`, `wiki_buscar`, `wiki_leer`, `wiki_crear`, `wiki_editar`.
- **Telegram**: `/pregunta <texto>`.
- Arnés `verify-wiki.mjs`.

## Falta (de Fran, ver `PENDIENTE_FRAN.md`)

- `ANTHROPIC_API_KEY` en los secrets de las funciones del hub.
- Compartir la carpeta de Drive con la cuenta de servicio y pegar su enlace en
  `#/buscar`.
