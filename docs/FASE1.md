# Fase 1 · Organizador de proyectos + MCP completo

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md`. Se hace en tres entregas, cada una
desplegable sola.

## 1. Organizador de proyectos — ✅ hecho (2026-09-27)

- Migración `20261002_proyectos.sql` (aplicada): `proyectos` (número
  correlativo, fase, tipo interno/cliente, responsable, fechas, presupuesto
  previsto), `proyecto_objetivos`, `proyecto_hitos`, `proyecto_paginas`
  (markdown + fuentes, autor persona o Claude), `proyecto_tareas`,
  `proyecto_vinculos`. RLS (equipo lee y escribe; borrar un proyecto, solo
  admin), auditoría, `updated_at`, `hecha_at`/`cerrado_at` automáticos.
- **Cambio respecto al plan**: no hay `proyecto_id` en `tareas`, `trabajos`…
  del espejo (el hub no puede escribir en áreas con dueño `app`). Las tareas
  del proyecto son suyas y lo de la app se enlaza con `proyecto_vinculos`.
- Pantalla `#/proyectos`: bandeja de ideas, kanban por fase con arrastre,
  lista, tareas por persona. Ficha `#/proyectos/<n>/<pestaña>`: Idea,
  Objetivos, Investigación, Roadmap (hitos + Gantt), Tareas (tablero con
  arrastre), Vinculado (buscar y enlazar trabajos/tickets/presupuestos/gastos/
  tareas de la app), Coste (horas fichadas, material, gastos, % del previsto).
- Pendiente de decidir: **tarifa por hora** para pasar horas a euros.

## 2. MCP completo (`mcp`) — ✅ hecho (2026-09-27)

- `hub.mcp_tokens` (hash, alcance lectura/escritura/admin, usuario, caduca,
  último uso); cada escritura en `hub.auditoria` con ese usuario y
  `origen = 'mcp'`.
- Edge function `mcp` (streamable HTTP sin estado, patrón de `mcp-server` de
  la app) con herramientas de dominio, nunca SQL libre, y catálogo único de
  escrituras en `_shared/acciones.ts` que respeta `hub.areas`.
- Pantalla para crear y revocar tokens; `.mcp.json` ya apunta a la función.
- Hecho: migración `20261003_mcp.sql` (tokens por huella, RPC crear/revocar/
  validar, autoría por cabecera en la auditoría), función `mcp` desplegada y
  probada en vivo, 25 herramientas, pantalla `#/conector`. Detalle en
  `docs/MCP.md`.

## 3. Lanzar a Claude — siguiente

- `hub.claude_peticiones` + función `lanzar-claude` (issue con etiqueta
  `claude-proyecto`; opcionalmente sesión remota). Botones «Investigar con
  Claude» y «Desarrollar esta fase» (hoy desactivados en la ficha). El
  resultado vuelve por el MCP (`proyecto_registrar_resultado`).
