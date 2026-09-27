# CLAUDE.md

Guía para Claude Code en este repositorio.

## Qué es esto

**Ok Computer Hub**: la app nueva de Ok Computer Tenerife (empresa de
servicios informáticos) que va a reunir gestión, proyectos, dirección,
comunicación con clientes y equipo, y a sustituir con el tiempo a la PWA
actual (`okcomputerclaude`), a Notion y a Zoho One. El plan completo, con
las decisiones tomadas y las fases, está en
`docs/PLAN_SISTEMA_UNIFICADO.md`; la referencia de producto (la demo de
OKHUB, de otra empresa) en `docs/referencias/OKHUB_INVENTARIO.md`.

**Estado**: solo documentación. No hay código todavía; la fase 0 del plan es
el scaffold.

## Relación con `okcomputerclaude` — LO MÁS IMPORTANTE

- **`okcomputerclaude` no se toca desde aquí.** Ni PRs, ni despliegues de sus
  funciones, ni cambios en sus tablas. Sigue en producción tal cual mientras
  el hub crece.
- **Mismo Supabase.** El hub usa el MISMO proyecto (`okcomputer`, ref
  `gaksrtxgnuuuvhvgwxue`, región eu-west-1) y la misma Auth: comparte
  clientes, sedes (`locales`), trabajos, tickets, tareas, agenda, inventario,
  usuarios y todo lo demás. Para saber qué hay, el snapshot y las migraciones
  viven en `okcomputerclaude/supabase/migrations/`; el `CLAUDE.md` de ese
  repo explica cada área (calendario por bloques, inventario con
  movimientos, mantenimiento con Stripe y Zoho, RMM, WhatsApp…). Léelo antes
  de escribir sobre una tabla que no haya creado el hub.
- **Portar, no reescribir a ciegas.** Cuando una fase traiga un módulo de la
  app actual (`public/js/modules/*.js`) o código compartido de sus funciones
  (`supabase/functions/_shared/*.ts`), se copia aquí y se pasa a TypeScript
  conservando sus reglas de negocio.

### Las cinco reglas del backend compartido

1. **Aditivo.** Tablas nuevas, columnas nuevas **nullable** y sin default
   que cambie comportamiento, vistas y funciones nuevas. Nunca renombrar,
   borrar ni cambiar el significado de una columna o tabla que lea la app
   actual.
2. **Migraciones con fecha y sufijo `_hub`**
   (`supabase/migrations/20261001_proyectos_hub.sql`). Se aplican A MANO con
   el workflow «Aplicar migración» de este repo (secret
   `SUPABASE_DB_PASSWORD`, transacción con `ON_ERROR_STOP`). No se editan las
   ya aplicadas: se añade otra.
3. **Edge functions con prefijo `hub-`** (`hub-mcp`, `hub-telegram`,
   `hub-informes`…), en `supabase/functions/hub-<nombre>/index.ts`, con su
   propio `supabase/functions/_shared/`. El deploy de cada repo despliega
   «todas las funciones de su rama»: sin colisión de nombres ninguno pisa al
   otro. Si el hub necesita algo parecido a una función vieja, la duplica
   con prefijo; la vieja sigue sirviendo a la app vieja.
4. **Toda tabla nueva lleva RLS y entra en `audit_log`** (el trigger
   genérico ya existe en la base; ver `docs/AUDITORIA.md` del otro repo). Una
   función va en la lista `SIN_JWT` del workflow de deploy solo si la
   autoriza otra cosa (firma, secret, código de un solo uso).
5. **Lo que falte se crea aquí.** Vistas, funciones SQL, índices: nuevos en
   este repo. Nada de PRs contra `okcomputerclaude`.

El arnés de verificación (fase 0) falla si una migración contiene
`ALTER TABLE … DROP | RENAME | ALTER COLUMN` sobre una tabla que no haya
creado el propio hub.

## Stack y estructura prevista (fase 0)

- **Frontend**: Vite + TypeScript **sin framework**. Módulos ES, una carpeta
  por pantalla en `src/modulos/<nombre>/`, hash-routing `#/ruta`, PWA
  (manifest + service worker). Sin `on*=` inline: los manejadores van por
  `data-action` / `data-on-<evento>` con un dispatcher central, como en la
  app actual (`public/js/dispatcher.js` de `okcomputerclaude`).
- **Datos**: cliente PostgREST propio (`src/core/api.ts`) con timeout (10 s
  lectura, 30 s escritura), reintento al caducar el JWT y paginación más
  allá de 1000 filas. Auth con `@supabase/supabase-js` (solo Auth). La anon
  key de producción va en el código (no es secreta); las de desarrollo, no.
- **Shell**: menú por grupos, inicio con baldosas (cada módulo expone
  `contador()` → valor, subtítulo, tono), buscador de módulos, párrafo
  explicativo por pantalla, tema claro/oscuro, enlaces a la app actual para
  lo que el hub aún no tiene.
- **Backend**: `supabase/migrations/` (solo aditivas, `_hub`) y
  `supabase/functions/hub-*/` (Deno) con `_shared/` propio: `http.ts` (CORS
  con lista blanca + JWT de sesión real), `mensajeria.ts` (Telegram /
  WhatsApp / push), `acciones.ts` (catálogo único de escrituras permitidas,
  compartido por voz, bot y MCP).
- **Despliegue** (`.github/workflows/`, mismos secrets que el otro repo):
  push a la rama por defecto → build → Firebase Hosting (sitio nuevo del
  mismo proyecto; el id `okcomputerhub` ya lo usa el redirect legado, así
  que otro id); «Deploy funciones hub» y «Aplicar migración» a mano.
- **Claude Code**: `.claude/settings.json` (permisos para sesiones
  desatendidas, deniega `rm -rf`, `sudo`, force-push, `reset --hard`),
  `.mcp.json` apuntando a `hub-mcp`, skill `verify` (Playwright + Chromium
  con la red de Supabase interceptada y fixtures; nunca contra producción).

## Comandos (cuando exista el scaffold)

- `npm run dev` — Vite en local.
- `npm run build` — `dist/`.
- `npm run lint` — ESLint + `tsc --noEmit`.
- `npm run verify` — arnés de verificación sin tocar producción.

## Convenciones

- Español en código de dominio, comentarios, commits y docs.
- Un prefijo de ids por modal, sin repetir en el documento.
- Cada pantalla nueva: registro en el router, entrada en el menú,
  `contador()`, párrafo explicativo, arnés `verify-<modulo>.mjs`, y una nota
  aquí si introduce una regla que el siguiente tenga que saber.
- Cada función nueva: `hub-` delante, `_shared/http.ts`, y desplegarla a
  mano en el mismo rato que el front que la llama (el front sale con el
  push; las funciones no).
