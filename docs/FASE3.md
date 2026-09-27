# Fase 3 · Puesto de mando y canal

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md`. Hecha en una entrega (2026-09-27).
Decidido con Fran: Zoho de **solo lectura** con un cliente propio del hub,
canal **Telegram**, y el dinero **solo para admins**.

## Qué hay

- **Migración `20261007_mando.sql`** (aplicada):
  - `hub.zoho_facturas` y `hub.zoho_cobros`: espejo de las cabeceras de
    Zoho Books (organización «Dalmon Sistemas S.L.», `20107733530`). Solo
    lectura; RLS solo admins.
  - `hub.panorama_direccion(p_para)`: el **motor de avisos**, la misma lista
    para el panel, el bot, los informes y el MCP. Tipos: presupuesto sin
    respuesta (enviado hace más de 7 días), trabajo por facturar, ticket sin
    asignar, alerta RMM crítica/alta, sede sin conexión, hito vencido y, solo
    admins: factura vencida, cobro de mantenimiento torcido, cliente importante
    sin comprar (≥ 1.000 € en el año anterior y 90 días sin factura) y cierre de
    mes (borradores de Zoho). Es `security definer`: filtra él mismo quién ve
    qué (`hub.admin_para`), también cuando pregunta el bot en nombre de alguien.
  - `hub.direccion_resumen(p_para)`: tarjetas de dinero, ventas de 24 meses y
    cuentas grandes (null si no es admin).
  - `hub.telegram_vinculos` + `hub.telegram_codigo()` (código de un uso, 15
    min) y `hub.telegram_desvincular()`.
  - `hub.informes_programados` (qué, a quién, hora de Canarias, días) y
    `hub.informes_envios` (registro). Un técnico solo se programa los suyos y
    ninguno de dinero (RLS).
  - `hub.lanzar_funcion()` + crons `hub-zoho` (30 min), `hub-zoho-completo`
    (3:45) y `hub-informes` (15 min). `hub.guardar_secreto()` guarda solo el
    refresh token de Zoho.
- **Funciones** (las tres en `SIN_JWT`; de día las autoriza el cron con
  `x-sync-token`, y desde el hub la sesión):
  - `zoho-lectura`: estado, conectar (canjea el código del Self Client y
    guarda el refresh token en el Vault) y sincronizar (incremental por
    `last_modified_time`; completo de 24 meses que además borra del espejo lo
    que ya no está en Zoho; un fallo no mueve el corte).
  - `informes-enviar`: programados (cron), vista previa, enviar ahora.
  - `telegram-bot`: webhook con `X-Telegram-Bot-Api-Secret-Token`; solo
    contesta a chats vinculados; `/avisos`, `/repaso`, `/cierre`, `/rmm`,
    `/proyectos`, `/cobros` y `/ventas` (admins), `/baja`, `/ayuda`. Desde el
    hub: estado y configurar (admin: webhook + menú de comandos).
  - `_shared/informes.ts` (los 7 informes), `_shared/mensajeria.ts`
    (Telegram), `_shared/zoho.ts` (cliente de lectura), `_shared/personas.ts`.
- **Pantallas**: `#/direccion` «Puesto de mando» (avisos para todos con
  «Los míos»; para admins, 4 tarjetas, ventas 12 meses frente al año anterior
  con tabla, cuentas grandes y lo último de `hub.auditoria`), `#/informes`
  «Informes y Telegram» y la tarjeta **Zoho Books** en «Datos y
  sincronización».
- **MCP**: `avisos` e `informe`.
- Arnés `verify-mando.mjs`; `probar-migraciones` prueba RLS, dinero, Telegram
  y secretos.

## Cambios respecto al plan

- Sin **stock bajo mínimo** ni **lead web sin contestar**: el hub aún no
  tiene inventario ni oportunidades (fases 9 y 4). Se añaden al motor cuando
  lleguen.
- Sin **margen por familia**: necesita las líneas de factura y el coste de
  compra; queda para la fase 4 (cliente 360) o la 11.
- Sin informe **qué comprar** (inventario) ni **recordatorio de fichaje**
  (se puede montar sobre `sesiones` si se quiere).
- **WhatsApp** no: el número lo usa la app actual con su webhook. Telegram
  cubre el canal interno.
- Los nombres de técnico en la app no son uniformes («Matteo» / «Matteo
  Monastero»): «Los míos» y el repaso aceptan el nombre completo o el de pila.

## Lo que hace Fran (una vez)

### 1 · Zoho Books (solo lectura)

1. Entra en **https://api-console.zoho.eu** con `info@okcomputertenerife.com`.
2. Botón **ADD CLIENT** (o **GET STARTED**) → elige **Self Client** →
   **CREATE NOW** → **OK**.
3. Pestaña **Client Secret**: ahí están el **Client ID** y el **Client
   Secret**. En esta sesión: menú del entorno en la barra de título → **Edit**
   → variables de entorno, y añade dos líneas:
   ```
   ZOHO_HUB_CLIENT_ID=1000.XXXXXXXX
   ZOHO_HUB_CLIENT_SECRET=xxxxxxxx
   ```
   Avisa a Claude: los pasa a las funciones del hub (sin imprimirlos).
4. Después, en la misma consola, pestaña **Generate Code**:
   - **Scope** (pégalo tal cual):
     `ZohoBooks.invoices.READ,ZohoBooks.customerpayments.READ,ZohoBooks.contacts.READ,ZohoBooks.settings.READ`
   - **Time Duration**: 10 minutes · **Scope Description**: `Hub lectura`
   - **CREATE** → elige la organización **Dalmon Sistemas S.L.** → **CREATE**.
   - Copia el código (`1000.…`).
5. En el hub: **Datos y sincronización** → tarjeta **Zoho Books** → pega el
   código → **Conectar**. Hace la primera copia (unas 970 facturas de 24 meses)
   y desde ahí se refresca solo cada 30 minutos.

### 2 · Telegram

1. En Telegram, abre **@BotFather** → `/newbot` → nombre `Ok Computer Hub` →
   usuario, por ejemplo `OkComputerHubBot` (tiene que acabar en `bot`).
2. BotFather contesta con el **token** (`123456:ABC…`). En esta sesión, variables
   de entorno:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   ```
   Avisa a Claude: lo pasa a las funciones.
3. En el hub: **Informes y Telegram** → **Configurar el bot** (pone el webhook
   y el menú de comandos).
4. Cada persona: **Informes y Telegram** → **Vincular mi Telegram** → abre el
   enlace → **Iniciar**. Luego programa sus informes.
