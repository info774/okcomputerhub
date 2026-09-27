# Conector MCP del hub

La edge function `mcp` expone el hub a Claude Code (y a cualquier cliente MCP)
por HTTP sin estado. Nada de SQL libre: solo las herramientas de
`supabase/functions/_shared/acciones.ts`.

## Cómo conectar Claude Code (paso a paso)

1. Entra en el hub → menú izquierdo → **Sistema → Conector MCP** (solo admins).
2. En **Crear token**: ponle un nombre («Claude Code de Fran»), elige en nombre
   de quién actúa, la caducidad y el **alcance**, y pulsa **Crear token**.
3. Sale un recuadro naranja con el token (`okh_…`) y el comando. **Se ve una
   sola vez.** Pulsa **Copiar comando** y pégalo en una terminal:
   ```
   claude mcp add okhub --transport http https://adomalsxsymxzuozksmt.supabase.co/functions/v1/mcp --header "Authorization: Bearer okh_…"
   ```
4. Dentro de este repositorio no hace falta el comando: `.mcp.json` ya apunta
   al conector y lee el token de la variable de entorno `OKHUB_MCP_TOKEN`
   (en una sesión cloud: menú del entorno en la barra de título → Edit →
   variables → `OKHUB_MCP_TOKEN=okh_…`).
5. Si un token se pierde o se filtra: **Revocar** en la misma pantalla. Deja
   de funcionar al momento.

## Alcances

| Alcance | Puede |
|---|---|
| `lectura` | Todas las consultas: buscar, esquema, clientes, trabajos, tickets, tareas de la app, agenda, presupuestos, proyectos, equipo, estado del sync monitorización (`rmm_resumen`, `rmm_equipos`, `rmm_equipo_detalle`, `rmm_scripts`) y puesto de mando (`avisos`, `informe`; lo de dinero solo si el dueño del token es admin). |
| `escritura` | Además crear y editar proyectos y sus piezas (objetivos, hitos, tareas, páginas con fuentes, vínculos) y pedirle cosas a Breeze: `rmm_acusar_alerta`, `rmm_comando`, `rmm_script` (quedan en `hub.rmm_acciones`). |
| `admin` | Todo lo anterior; reservado para lo que se añada de administración. |

Una escritura sobre un área cuyo dueño sea la app (`hub.areas`) **ni se ofrece
ni se ejecuta**: `ticket_crear` existe en el catálogo pero no aparece hasta que
el área `tickets` se corte al hub (fase 6).

## Seguridad y rastro

- En la base solo queda la huella sha256 del token (`hub.mcp_tokens`), su
  prefijo, alcance, dueño, caducidad, último uso y revocación.
- La función valida con `hub.mcp_validar` (solo `service_role`) y escribe con
  las cabeceras `x-hub-usuario` (correo del dueño) y `x-hub-origen: mcp`: en
  `hub.auditoria` cada cambio sale a nombre de esa persona, origen `mcp`. La
  cabecera solo cuenta si escribe una función de servidor; desde un navegador
  manda siempre el correo de su sesión.
- Va en `SIN_JWT` (el token no es un JWT de Supabase).
- Probado en vivo el 2026-09-27: sin token 401; 25 herramientas con token de
  escritura; `ticket_crear` rechazada; proyecto y página creados y auditados a
  nombre del dueño; token revocado → 401.

## Añadir una herramienta

En `_shared/acciones.ts`: nombre, descripción clara (la lee el modelo),
`alcance`, `tabla` si escribe (para la regla de áreas), `inputSchema` y
`ejecutar` con los campos en lista blanca y validados. Desplegar `mcp` a mano
(`npx supabase functions deploy mcp --no-verify-jwt --use-api --project-ref
adomalsxsymxzuozksmt`). La misma herramienta la aprovecharán la voz y el bot.
