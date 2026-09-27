# Fase 2 · Monitorización: consola RMM sobre Breeze

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md`. Hecha en una entrega (2026-09-27).

## Qué hay

- **Migración `20261006_rmm.sql`** (aplicada). Vistas de SOLO lectura sobre
  el `public` de Breeze, propiedad de `postgres` (salta la FORCE RLS de
  Breeze) y filtradas por `hub.ve_rmm()` (usuario del hub o `service_role`):
  `rmm_equipos` (hardware, SO, antivirus, discos, parches pendientes, alertas
  abiertas, `rustdesk_id`, versión del TPV cruzada con `locales.programa_tpv`),
  `rmm_sites`, `rmm_estado_local` (ok · alerta · parcial · caido; conectado =
  checkin en el último cuarto de hora), `rmm_alertas` (abiertas + 90 días),
  `rmm_metricas` (48 h; pedir siempre con `device_id=eq.…`), `rmm_parches`,
  `rmm_software`, `rmm_sesiones_remotas` (90 días), `rmm_comandos` (30 días),
  `rmm_scripts` (sin el código) y `rmm_scripts_ejecuciones` (30 días).
  **Solo SELECT**: los privilegios por defecto de `hub` daban
  insert/update/delete, y una vista simple escribiría en Breeze.
- **`hub.rmm_sitios`**: Site de Breeze ⇆ sede (`hub.locales`). Lo rellena
  `hub.rmm_emparejar()` (pg_cron `hub-rmm-emparejar`, cada hora) por nombre
  normalizado si casa con UNA sede; `manual = true` (lo puesto en la pestaña
  Emparejado) no se pisa. Una pasada sin cambios no escribe nada. Carga
  inicial: 115 por nombre + los 2 manuales que tenía la app (117 de 119).
- **`hub.rmm_acciones`**: rastro de todo lo que el hub le pide a Breeze.
- **Función `breeze-api`** (con JWT): acusar alerta, comando (refrescar
  inventario, reiniciar, apagar, encender) y script. Catálogo único en
  `_shared/rmm-acciones.ts`, que usa también el MCP; login en
  `_shared/breeze.ts`.
- **Pantalla `#/monitorizacion`**: Sedes (semáforo), Equipos (buscador, solo
  sin conexión), Alertas (Acusar; «Resolver en Breeze»), Emparejado, Acciones.
  `#/monitorizacion/sede/<local_id>` hace de pestaña «Monitor.» hasta que el
  hub tenga Sitios (fase 4). Ficha del equipo con Resumen, Métricas (48 h, con
  hover), Parches, Software, Alertas, Comandos y scripts, y Remoto.
- **MCP**: `rmm_resumen`, `rmm_equipos`, `rmm_equipo_detalle`, `rmm_scripts`
  (lectura) y `rmm_acusar_alerta`, `rmm_comando`, `rmm_script` (escritura).
- Arnés `verify-monitorizacion.mjs`; `probar-migraciones` carga un Breeze
  falso (`scripts/breeze-falso.sql`, columnas reales) y prueba las vistas.

## Cambios respecto al plan

- **Resolver alertas y control remoto se hacen en el panel de Breeze**, con el
  usuario de cada técnico. El usuario de servicio es «Partner Technician»
  (acusa, manda comandos y lanza scripts), que en Breeze NO puede resolver ni
  abrir sesiones remotas; darle «Partner Admin» obligaría a MFA (la función no
  sabría pasarlo) y abriría demasiado. La pantalla enlaza a
  `breeze.oksistemas.online/alerts/<id>`, `/devices/<id>`,
  `/remote/terminal/<id>` y `/remote/files/<id>`; RustDesk con
  `rustdesk://<id>` si el equipo tiene el campo `rustdesk_id` en Breeze.
- **«Crear ticket» desde una alerta: pendiente.** El área `tickets` sigue con
  dueño `app` (se corta en la fase 6) y escribir en la app actual necesita
  permiso de Fran.
- Pestaña Monitor. en la ficha del sitio y color en Sitios/Mapa: el hub aún no
  tiene esas pantallas; de momento, la vista por sede.
- El comprobador de migraciones deja nombrar `public.` solo en un
  `FROM`/`JOIN` (leer) y sigue prohibiendo todo lo demás, `delete from` incluido.

## Poner el usuario de servicio (lo hace Fran, una vez)

Sin él todo se ve igual, pero los botones de acusar, comandos y scripts salen
apagados con un aviso.

1. Entra en **https://breeze.oksistemas.online** con tu usuario.
2. Menú de la izquierda → **Settings** → **Users** → botón **Invite user**
   (o **Add user**).
3. Correo: `hub@okcomputertenerife.com` (o el que prefieras; no hace falta
   que sea un buzón que leas, pero sí que puedas recibir la invitación para
   poner la contraseña). Nombre: `Hub (servicio)`. Rol: **Partner Technician**.
   No le actives MFA.
4. Acepta la invitación y ponle una contraseña larga.
5. Aquí, en la sesión de Claude: menú del entorno en la barra de título →
   **Edit** → variables de entorno, y añade dos líneas:
   ```
   BREEZE_HUB_EMAIL=hub@okcomputertenerife.com
   BREEZE_HUB_PASSWORD=la-contraseña
   ```
6. Dímelo y las copio a los secrets del hub (sin imprimirlas) y pruebo un
   «Refrescar inventario».

## Al actualizar Breeze

Las vistas son la única dependencia del esquema de Breeze. Tras cada salto de
versión (`okcomputer-rmm/VERSIONES.md`): `select * from hub.rmm_equipos limit
1` (y el resto) con `request.jwt.claims` de `service_role`; si una columna
cambió, migración nueva que rehaga la vista y regenerar
`scripts/breeze-falso.sql`.

## Retirada de OKRMM (pendiente, fuera del hub)

Inventario de los equipos que sigan en OKRMM y alta en Breeze con el
procedimiento de `okcomputer-rmm/agente/`. `rmm-agente`, `rmm_altas` y
`rmm_sondas` no se portan; `breeze-sync`/`breeze-hook` de la app siguen hasta
que su pestaña Monitor. deje de usarse.
