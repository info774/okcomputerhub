# Fase 0 · Cimientos — qué hay y cómo se pone en marcha

Estado a 2026-09-27: **migraciones (20261001 a e) APLICADAS y `sync-app`
DESPLEGADA** en `okcomputer-hub`, por el conector de Supabase; `public`
comprobado igual antes y después (1708 objetos, misma huella). Lo marcado ⏳
abajo sigue pendiente y se hace a mano: toca el panel o cuentas externas.

## Qué hay en el repo

| Pieza | Dónde |
|---|---|
| Esquema `hub`, grants, `hub.usuarios`, `hub.areas`, `hub.auditoria` + trigger, pg_cron / pg_net | `supabase/migrations/20261001_hub_cimientos.sql` |
| Tablas de la app actual con sus mismas columnas (espejo), RLS por área | `supabase/migrations/20261001b_hub_tablas_app.sql` |
| `hub.sync_estado`, `hub.lanzar_sync()`, cron cada 15 min + nocturno 03:30 UTC | `supabase/migrations/20261001c_hub_sync_app.sql` |
| Sincronización de solo lectura | `supabase/functions/sync-app/` (+ `_shared/http.ts`, `_shared/tablas-app.ts`) |
| Carga inicial desde el backup | `scripts/importar-app.mjs` |
| Front: Vite + TS, login, shell, Inicio con baldosas, Datos y sincronización, enlaces a la app actual, PWA | `src/`, `public/`, `index.html` |
| Workflows | `.github/workflows/` (deploy, lint, aplicar-migracion, deploy-funciones) |
| Comprobaciones | `npm run lint` (incluye `comprobar-migraciones.mjs`), `npm run verify`, `npm run probar-migraciones` |

### Cambio respecto al plan: el incremental va por `audit_log`

El plan decía «`updated_at > último corte`», pero **casi ninguna tabla de la
app tiene `updated_at`** (comprobado en producción). Sí tienen el trigger de
`audit_log` (id creciente, tabla, registro, acción) desde
`20260911_audit_log.sql`, así que `sync-app` lee ese registro desde el último
id y pide el estado ACTUAL de lo tocado: lo que existe se sube, lo que ya no
existe se borra. Es una consulta pequeña cada 15 min contra producción.
Las tablas sin auditoría en la app (`documento_lineas`) y `locales` (sus
columnas de Zoho/Stripe las reescriben crons que `audit_log` trata como ruido)
se repasan enteras cada noche.

## Puesta en marcha (a mano, en orden)

### 1. Supabase `okcomputer-hub` (ref `adomalsxsymxzuozksmt`)

1. Panel → Settings → General: renombrar el proyecto `breeze-rmm` →
   `okcomputer-hub`.
2. GitHub → Settings → Secrets → Actions: `HUB_DB_PASSWORD` (Settings →
   Database) y `SUPABASE_ACCESS_TOKEN`.
3. Comprobar el host del pooler en Settings → Database → Connection pooling
   (sesión, IPv4) y, si no es `aws-1-eu-west-1.pooler.supabase.com`,
   corregirlo en `.github/workflows/aplicar-migracion.yml`.
4. ✅ Hecho el 2026-09-27: `20261001_hub_cimientos.sql`,
   `20261001b_hub_tablas_app.sql`, `20261001c_hub_sync_app.sql`,
   `20261001d_hub_search_path.sql` y `20261001e_hub_secretos.sql`. Las
   siguientes, con Actions → **Aplicar migración**, una a una y en orden.
5. ⏳ **Settings → API → Exposed schemas: AÑADIR `hub`.** Hoy están
   `public` y `graphql_public`; se dejan como están (`public` está cerrado por
   permisos: `anon` y `authenticated` no tienen USAGE). Sin este paso ni el
   front ni `sync-app` llegan a nada: PostgREST contesta `PGRST106 Invalid
   schema: hub`.

### 2. Sincronización

Las claves van en el **Vault del hub** (las lee `hub.secreto()`, solo
service_role); una variable de entorno de la función con el mismo nombre en
mayúsculas manda sobre el Vault si se pone.

1. ✅ `sync-app` desplegada (sin JWT) el 2026-09-27.
2. ✅ En el Vault: `hub_sync_url`, `hub_sync_token` (aleatorio, generado
   dentro de la base: no lo ha visto nadie) y `app_supabase_url`.
3. ⏳ **La service key de la app actual**, en el SQL Editor del hub (la
   clave está en okcomputer → Settings → API → `service_role`; solo se usa
   para LEER y no sale de la función):
   ```sql
   select vault.create_secret('<service_role de okcomputer>', 'app_service_role_key');
   ```
4. **Carga inicial** (tras 1.5 y 2.3): una pasada completa de `sync-app`,
   que copia todo (~7.000 filas hoy) y deja el corte puesto para el cron:
   ```sql
   select net.http_post(
     url := (select decrypted_secret from vault.decrypted_secrets where name = 'hub_sync_url'),
     headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token',
                (select decrypted_secret from vault.decrypted_secrets where name = 'hub_sync_token')),
     body := '{"modo":"completo","todas":true}', timeout_milliseconds := 300000);
   -- y a los pocos segundos:
   select status_code, content from net._http_response order by id desc limit 1;
   ```
   Trae también `usuarios`: quien esté activo en la app puede entrar en el
   hub. La otra vía, sin tocar producción en absoluto, es el dump:
   `node scripts/importar-app.mjs backup_AAAA-MM-DD.dump` con las variables
   `PG*` del hub.

### 3. Auth

1. Authentication → URL Configuration: Site URL
   `https://okhub-tenerife.web.app`; Redirect URLs con esa y
   `http://localhost:5173`.
2. Authentication → Providers → Google: Client ID y secret del proyecto GCP
   **508620194342** (no crear otro). ✅ La redirect
   `https://adomalsxsymxzuozksmt.supabase.co/auth/v1/callback` ya está en el
   cliente «Ok Computer Web» (añadida el 2026-09-27).
3. Authentication → Users: invitar a cada persona con el MISMO correo que en
   la app actual (el hub la reconoce por el correo en `hub.usuarios`).

### 4. Firebase Hosting

1. Consola de Firebase, proyecto `okcomputerclaude` → Hosting → añadir sitio
   `okhub-tenerife` (si el id está cogido, cambiarlo en `.firebaserc`, en
   `_shared/http.ts` y aquí).
2. GitHub → secret `GOOGLE_CREDENTIALS_JSON` (el mismo que usa la app actual).
3. Push a `main` → **Deploy del hub a Firebase**.

### 5. Fuera del código

- Exportar Notion (zip Markdown) y Zoho (CRM, Desk, Projects) para las fases 4-6.
- Crear el bot de Telegram (BotFather) para la fase 3.
- Decidir dominio (`hub.okcomputertenerife.com`?) — pregunta abierta del plan.

## Cómo comprobar que funciona

- Pantalla **Datos y sincronización**: última pasada buena hace < 15 min y
  filas por tabla parecidas a las de la app.
- En `okcomputer` no debe notarse: una lectura de `audit_log` cada 15 min más
  las filas tocadas.
- Breeze sigue igual: `public` no cambia (lo prueba `npm run probar-migraciones`
  en local y `comprobar-migraciones.mjs` en cada lint).
