# Ok Computer Hub

El «puesto de mando» de **Ok Computer Tenerife**: la app que va a reunir en un
solo sitio lo que hoy se reparte entre la PWA de gestión
([`okcomputerclaude`](https://github.com/info774/okcomputerclaude)), Notion y
Zoho One, con las ideas del producto OKHUB como referencia.

- **Estado (2026-09-27)**: solo documentación. El plan por fases está en
  [`docs/PLAN_SISTEMA_UNIFICADO.md`](docs/PLAN_SISTEMA_UNIFICADO.md) y la
  referencia de OKHUB en
  [`docs/referencias/OKHUB_INVENTARIO.md`](docs/referencias/OKHUB_INVENTARIO.md).
- **Backend**: el MISMO proyecto Supabase que la app actual. El hub solo
  añade tablas, columnas y funciones; nunca altera lo que la app actual lee.
  Las reglas están en [`CLAUDE.md`](CLAUDE.md).
- **Stack previsto**: Vite + TypeScript sin framework, PWA, hash-routing;
  edge functions Deno con prefijo `hub-`.
- **Convivencia**: el hub absorbe módulos de la app actual fase a fase y
  enlaza a ella para lo que aún no tiene. `okcomputerclaude` no se toca desde
  aquí.

Primero: fase 0 (cimientos del repo) y fase 1 (organizador de proyectos +
conector MCP completo para Claude Code).
