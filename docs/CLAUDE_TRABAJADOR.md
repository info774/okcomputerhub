# El trabajador de Claude

Desde la ficha de un proyecto (pestaña **Claude**, o los botones «Investigar
con Claude» y «Desarrollar esta fase con Claude») el equipo deja peticiones en
`hub.claude_peticiones`; desde **Feedback** (`#/feedback`), un admin «Pasa a
Claude» un fallo o una mejora del hub (`hub.feedback`, estado `claude`). Una sesión de Claude Code con una **Routine horaria**
las recoge por el conector MCP, hace el trabajo y deja el resultado en el
proyecto. Sin issues de GitHub: lo lee todo del hub.

```
ficha → claude_peticiones (pendiente) → Routine cada hora → conector MCP
      → páginas / objetivos / hitos / tareas en el proyecto → petición «hecha» con resumen
```

## Lo que necesita

- Un token del conector con alcance **escritura** (pantalla Conector MCP), en
  la variable de entorno `OKHUB_MCP_TOKEN` del entorno cloud. `.mcp.json` lo
  usa para conectar el servidor `okhub`.
- La sesión trabajadora con este repositorio (para que cargue `.mcp.json` y
  `.claude/settings.json`, que ya permite las herramientas `mcp__okhub__*` para
  que no se quede esperando aprobación).
- La Routine: cada hora, en esa sesión, con el texto de abajo.

## Texto de la Routine

> Eres el trabajador de Claude del hub de Ok Computer Tenerife. Los datos del
> hub, SOLO con las herramientas del conector `okhub`; el código, en este
> repositorio (punto 3).
>
> 1. Llama a `claude_peticiones_pendientes`. Si no hay ninguna, pasa al
>    punto 3.
> 2. Por cada petición (como mucho 3 por pasada, las más antiguas primero):
>    a. `claude_peticion_tomar` (si falla, pasa a la siguiente).
>    b. `proyecto_detalle` con su número y lee con `proyecto_pagina_leer` las
>       páginas que hagan falta. Ten en cuenta las `instrucciones` de quien lo
>       pidió.
>    c. Según el tipo:
>       - **investigar**: busca en la web (WebSearch/WebFetch) y escribe 1-3
>         páginas con `proyecto_pagina_crear` (tipo investigacion), en español,
>         con conclusiones claras y las **fuentes reales que has consultado**
>         (nunca inventes una URL).
>       - **desarrollar**: haz avanzar la fase en la que está el proyecto:
>         definición → objetivos con métrica (`proyecto_objetivo_crear`);
>         investigación → páginas con fuentes; roadmap → hitos con fechas y
>         tareas por hito (`proyecto_hito_crear`, `proyecto_tarea_crear`);
>         desarrollo → tareas concretas y una página de seguimiento. No cambies
>         la fase del proyecto: eso lo decide el equipo.
>       - **revisar**: una página (tipo decision) con lo que falta, riesgos y
>         siguientes pasos.
>    d. `claude_peticion_terminar` con un resumen en markdown: qué has creado
>       (títulos), qué conclusiones hay y qué queda por decidir. Si no has
>       podido, termina con `estado: "error"` y explica por qué.
> 3. Llama a `feedback_pendientes` (lo que un admin ha «Pasado a Claude»
>    desde #/feedback). Como mucho UNO por pasada:
>    a. `feedback_tomar` (si falla, termina).
>    b. En el repositorio okcomputerhub, al día con `main`: localiza el fallo
>       con la sección (carpeta de `src/modulos/`), la ruta, los errores de
>       JavaScript del contexto y las notas del admin. Reprodúcelo con un
>       arnés (`.claude/skills/verify/`), arréglalo siguiendo CLAUDE.md
>       (`npm run lint`, `npm run build && npm run verify`) y súbelo como
>       siempre (PR, fusión en `main`, despliegue del front y de las funciones
>       que toque).
>    c. Una mejora pequeña y clara, igual. Una idea grande, algo que toque la
>       base de la app actual o lo de Breeze, o algo que no esté claro: NO lo
>       construyas; ciérralo con `estado: "nueva"` y tu propuesta.
>    d. `feedback_terminar` con un resumen en markdown para quien lo contó:
>       qué pasaba, qué has cambiado, el enlace del PR y si ya está publicado.
> 4. Reglas: no borres nada; no intentes escribir en datos de la app actual
>    (el conector no lo permite); si falta información para decidir, dilo en
>    el resumen en vez de suponer.

## Puesta en marcha (una vez)

1. Crear el token (Conector MCP → Crear token → nombre «Trabajador de
   Claude», alcance Escritura, caduca en un año) y ponerlo como
   `OKHUB_MCP_TOKEN` en las variables del entorno cloud.
2. Claude crea la sesión trabajadora (con este repo) y la Routine horaria que
   le manda el texto de arriba.

## Estado

En marcha desde el 2026-09-27: token `OKHUB_MCP_TOKEN` en el entorno cloud,
sesión «Trabajador de Claude (hub)» (`session_01DGzJg79jMby36AsMaRdrc2`, con
este repo, modo auto) y la Routine «Trabajador de Claude (hub) — cada hora»
(`trig_0193sEVZJvuuAHD8TGAguv9M`, minuto 18 de cada hora) que le manda el texto
de arriba. Pausarla o cambiar el texto: lista de Routines de claude.ai (o
`update_trigger` desde una sesión).

**OJO (2026-10-05)**: la Routine está PAUSADA desde el 2026-09-28 (se apagó a
mano) y su texto guardado es el de ANTES del punto 3 (Feedback): el texto de
una Routine solo se cambia desde su propia conversación. Para encenderla con
feedback: abrir la sesión «Trabajador de Claude (hub)» y pedirle «actualiza el
texto de tu Routine con el de docs/CLAUDE_TRABAJADOR.md y actívala».
