# Ok Computer Hub

El «puesto de mando» de **Ok Computer Tenerife**: la app que va a reunir en un
solo sitio lo que hoy se reparte entre la PWA de gestión
([`okcomputerclaude`](https://github.com/info774/okcomputerclaude)), Notion,
Zoho One y la web de Breeze (RMM), con las ideas del producto OKHUB como
referencia.

- **Estado (2026-09-27)**: fase 0 escrita y probada en local, pendiente de
  aplicar y desplegar: [`docs/FASE0.md`](docs/FASE0.md). El plan por fases está en
  [`docs/PLAN_SISTEMA_UNIFICADO.md`](docs/PLAN_SISTEMA_UNIFICADO.md) y la
  referencia de OKHUB en
  [`docs/referencias/OKHUB_INVENTARIO.md`](docs/referencias/OKHUB_INVENTARIO.md).
- **Backend propio**: el proyecto Supabase `okcomputer-hub` (antes
  `breeze-rmm`), separado del de producción para no cargarlo. Lo comparte con
  Breeze, el motor RMM, que usa `public`; todo lo del hub vive en el esquema
  `hub`. Las reglas están en [`CLAUDE.md`](CLAUDE.md).
- **Datos**: copia inicial desde el backup de la app actual y sincronización
  de solo lectura hasta que cada área se corta y pasa al hub.
- **Stack previsto**: Vite + TypeScript sin framework, PWA, hash-routing;
  edge functions Deno.
- **Convivencia**: el hub absorbe módulos de la app actual fase a fase y
  enlaza a ella para lo que aún no tiene. `okcomputerclaude` no se toca desde
  aquí.

Primero: fase 0 (cimientos y sincronización), fase 1 (organizador de
proyectos + conector MCP para Claude Code) y fase 2 (consola RMM sobre
Breeze).
