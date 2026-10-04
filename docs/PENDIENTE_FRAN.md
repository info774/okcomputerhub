# Lo que queda en manos de Fran

Todo lo programado de las fases 2 a Final está hecho, probado y desplegado en
`https://okhub-tenerife.web.app`. Lo que sigue son las piezas que solo puedes
poner tú (claves, permisos en paneles, decisiones). Van **ordenadas por lo que
desbloquean**. Cada una dice dónde está exactamente y qué pegar.

## Cómo se da una clave (vale para todas)

Las claves **nunca** se escriben en el chat. Van a las variables de entorno de
esta sesión de Claude:

1. En la barra de título de la sesión, abre el **menú del entorno** → **Edit**.
2. En **variables de entorno**, añade una línea por clave, con este formato
   exacto (sin comillas ni espacios alrededor del `=`):
   ```
   NOMBRE_DE_LA_CLAVE=el-valor
   ```
3. Guarda y dile a Claude «ya están las claves». Claude las copia a las
   funciones del hub sin imprimirlas y prueba que funcionan.

---

## 1 · Clave de Claude (Anthropic) — la que más desbloquea

**Desbloquea**: el buscador contesta redactando con citas (#/buscar y
`/pregunta` en Telegram), las comandas se reparten bien (#/comandas) y los
tickets de gasto se leen solos (#/personas → Gastos).

1. Entra en **https://console.anthropic.com** con la cuenta de la empresa.
2. Menú de la izquierda → **API Keys** → botón **Create Key**.
3. Nombre: `Ok Computer Hub` → **Create**. Copia la clave (empieza por
   `sk-ant-`; solo se enseña una vez).
4. Variables de entorno:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

## 1 bis · WhatsApp: contestar desde el hub (2 claves, ~5 minutos)

**Desbloquea**: el botón **Enviar** del chat de WhatsApp del hub (la ventana de
abajo a la derecha). Leer las conversaciones ya funciona sin esto. Son las
MISMAS dos claves que tiene la app actual; Supabase no deja volver a verlas, así
que se sacan otra vez de Meta.

1. **El id del número**: entra en **https://developers.facebook.com** → **Mis
   apps** → la app de WhatsApp de la empresa → menú de la izquierda
   **WhatsApp** → **Configuración de la API**. Copia el número largo que pone
   **Identificador del número de teléfono** (no es el teléfono).
2. **El token**: entra en **https://business.facebook.com/settings** → menú
   **Usuarios** → **Usuarios del sistema** → elige el que ya usa la app →
   botón **Generar token** → app: la de WhatsApp → caducidad: **Nunca** →
   marca `whatsapp_business_messaging` y `whatsapp_business_management` →
   **Generar token** y cópialo (solo se enseña una vez). Generar uno nuevo NO
   anula el que usa la app.
3. Variables de entorno (ver arriba cómo):
   ```
   WHATSAPP_TOKEN=EAAG...
   WHATSAPP_PHONE_NUMBER_ID=1234567890...
   ```

### 1 ter · La plantilla para retomar una conversación (opcional, ~5 min + la aprobación de Meta)

**Desbloquea**: el botón **📨 Mandar plantilla** del chat de WhatsApp del hub.
Cuando el cliente lleva más de 24 h sin escribir, WhatsApp no deja mandarle
texto normal: solo una plantilla aprobada por Meta. La que tiene la app es para
mandar facturas con un PDF; esta es de texto, para volver a hablar con él.

1. Entra en **https://business.facebook.com/wa/manage/message-templates/** (el
   Administrador de WhatsApp de la empresa) → botón **Crear plantilla**.
2. Categoría: **Utilidad**. Nombre: `retomar_conversacion` (en minúsculas y
   con guion bajo, tal cual). Idioma: **Español (ESP)**.
3. En **Cuerpo** pega este texto (el `{{1}}` lo cambia el hub por el nombre del
   cliente; si Meta pide un ejemplo para la variable, pon `Marta`):
   ```
   Hola {{1}}, le escribimos de Ok Computer Tenerife sobre su consulta. ¿Podemos seguir por aquí?
   ```
4. **Enviar** y espera a que salga como **Activa** (suele tardar minutos; a veces
   unas horas).
5. Variable de entorno (ver arriba cómo):
   ```
   WHATSAPP_PLANTILLA_TEXTO=retomar_conversacion
   ```

### 1 quater · La plantilla para mandar facturas fuera de las 24 h (opcional, ~2 min)

**Desbloquea**: el botón **📎 Factura / presupuesto** del chat de WhatsApp del
hub cuando el cliente lleva más de 24 h sin escribir (dentro de las 24 h va sin
plantilla). Es la MISMA plantilla que ya usa la app; solo hay que decirle al
hub su nombre.

1. Entra en **https://business.facebook.com/wa/manage/message-templates/** (el
   Administrador de WhatsApp de la empresa).
2. En la lista, busca la plantilla **Activa** que lleva un **documento** en la
   cabecera (la de mandar facturas; su nombre es el de la columna **Nombre**,
   en minúsculas y con guiones bajos). Cópialo tal cual.
3. Variable de entorno (ver arriba cómo), con ese nombre en vez del ejemplo:
   ```
   WHATSAPP_PLANTILLA_DOCUMENTO=factura_documento
   ```

## 2 · Google: correo, Drive (una vez, ~10 minutos)

**Desbloquea**: los correos a info@ se convierten en tickets y las respuestas
salen del mismo buzón (#/tickets); llegan los enlaces para entrar al portal de
clientes y al de la gestoría; se mandan los documentos para firmar; y el
buscador lee la carpeta de Drive.

### 2a · Activar las dos APIs en el proyecto de Google Cloud

1. Entra en **https://console.cloud.google.com** con `info@okcomputertenerife.com`.
2. Arriba, en el selector de proyecto, elige **okcomputerclaude** (número
   `508620194342`, el mismo que ya usa la app).
3. Menú ☰ → **APIs y servicios** → **Biblioteca**.
4. Busca **Gmail API** → ábrela → **Habilitar**.
5. Vuelve a la Biblioteca, busca **Google Drive API** → **Habilitar**.

### 2b · Dejar que el hub use el buzón info@ (delegación de dominio)

1. Entra en **https://admin.google.com** (administrador de Google Workspace).
2. Menú ☰ → **Seguridad** → **Acceso y control de datos** → **Controles de API**.
3. Abajo, **Gestionar la delegación de todo el dominio** → **Añadir nuevo**.
4. **ID de cliente**: `117092961908352521785`
5. **Permisos de OAuth** (pégalo tal cual): `https://www.googleapis.com/auth/gmail.modify`
6. **Autorizar**. (Tarda unos minutos en valer.)

Qué hace el hub con el buzón: **lee** lo que entra en la bandeja principal
(no marca, no borra, no mueve nada) y **manda** las respuestas que escribe una
persona del equipo. Nada sale solo hacia un cliente.

### 2c · La carpeta de Drive para el buscador

1. En **Google Drive**, clic derecho en la carpeta que quieras que se pueda
   buscar → **Compartir**.
2. Añade `firebase-adminsdk-fbsvc@okcomputerclaude.iam.gserviceaccount.com`
   como **Lector** y **desmarca «Notificar»** → **Compartir**.
3. Clic derecho en la carpeta → **Compartir** → **Copiar enlace**.
4. En el hub: **Buscar** → abajo, «Carpeta de Google Drive» → pega el enlace
   → **Guardar** → **Leer Drive ahora**.

## 2 bis · Google Maps en el hub (una vez, ~2 minutos)

**Desbloquea**: el botón «🔎 Buscar en Google Maps» del alta de sede, de su
edición y de la «Sede nueva» del alta de trabajo (trae nombre, dirección,
enlace, horario y teléfono del negocio). Usa la MISMA clave que la app (decisión
tuya, 2026-10-03); solo hay que decirle a esa clave que el hub también puede
usarla. No hay que copiar ni pegar ninguna clave.

1. Entra en **https://console.cloud.google.com** con `info@okcomputertenerife.com`.
2. Arriba, en el selector de proyecto, elige **okcomputerclaude** (número
   `508620194342`).
3. Menú ☰ → **APIs y servicios** → **Credenciales**.
4. En el apartado **Claves de API**, busca la clave que empieza por
   **`AIzaSyCVo9`** (si no se ve entera, pulsa **Mostrar clave** en su fila) y
   pulsa su **nombre** (el texto azul de la izquierda).
5. En **Restricciones de aplicaciones** estará marcado **Sitios web**. Debajo,
   en **Restricciones de sitios web**, pulsa **AÑADIR** y pega exactamente:
   ```
   https://okhub-tenerife.web.app/*
   ```
   (Si más adelante el hub estrena dominio propio, se añade igual, por ejemplo
   `https://hub.okcomputertenerife.com/*`.)
6. No toques **Restricciones de API**. Pulsa **GUARDAR** abajo del todo.
7. Google tarda hasta 5 minutos en aplicarlo. Para probarlo: en el hub,
   **Sitios** → **+ Nuevo sitio** → escribe el nombre de un bar conocido en
   «Buscar en Google Maps» → **🔎 Buscar en Google Maps**. Si sale la lista, ya
   está. Mientras no se haga, el hub dice «No se ha podido consultar Google
   Maps» y todo lo demás funciona igual (los datos se escriben a mano).

> Ojo: el botón de crear sedes en el hub está preparado pero apagado hasta el
> cambio de clientes; la búsqueda en Maps ya se puede probar en el formulario.

## 3 · Clave de Groq (notas de voz → comandas, WhatsApp → ticket)

**Desbloquea**: dictar comandas en #/comandas y mandarle notas de voz al bot, y
que **Tickets → 💬 Desde WhatsApp** resuma el chat pegado o la captura (sin la
clave también funciona, pero con un resumen básico y sin leer capturas). Puede
ser la misma clave que usa la app.

1. Entra en **https://console.groq.com** → **API Keys** → **Create API Key**
   → nombre `Ok Computer Hub` → copia la clave (`gsk_...`).
2. Variables de entorno:
   ```
   GROQ_API_KEY=gsk_...
   ```

## 4 · Breeze: el usuario de servicio (monitorización)

**Desbloquea**: acusar alertas, lanzar comandos y scripts desde #/monitorizacion.

1. Entra en **https://breeze.oksistemas.online**.
2. Menú de la izquierda → **Settings** → **Users** → **Invite user**.
3. Correo `hub@okcomputertenerife.com`, nombre `Hub (servicio)`, rol
   **Partner Technician**, **sin MFA**. Acepta la invitación y pon una
   contraseña larga.
4. Variables de entorno:
   ```
   BREEZE_HUB_EMAIL=hub@okcomputertenerife.com
   BREEZE_HUB_PASSWORD=la-contraseña
   ```

## 5 · Zoho Books de solo lectura

**Desbloquea**: el dinero en el puesto de mando, los cobros, las facturas y
presupuestos en PDF del portal de clientes, y lo que ve la gestoría.

1. **https://api-console.zoho.eu** con `info@okcomputertenerife.com` →
   **ADD CLIENT** → **Self Client** → **CREATE NOW** → **OK**.
2. Pestaña **Client Secret** → variables de entorno:
   ```
   ZOHO_HUB_CLIENT_ID=1000.XXXXXXXX
   ZOHO_HUB_CLIENT_SECRET=xxxxxxxx
   ```
   y avisa a Claude.
3. Pestaña **Generate Code** → **Scope** (pégalo tal cual; incluye ya los
   presupuestos para el portal y, desde el 2026-10-03, lo que hará el hub
   cuando se corten sus áreas, igual que la app: dar de alta y quitar
   contactos, mandar presupuestos y crear facturas de trabajos o añadirles
   trabajos a un borrador):
   `ZohoBooks.invoices.READ,ZohoBooks.customerpayments.READ,ZohoBooks.contacts.READ,ZohoBooks.settings.READ,ZohoBooks.estimates.READ,ZohoBooks.contacts.CREATE,ZohoBooks.contacts.DELETE,ZohoBooks.estimates.CREATE,ZohoBooks.estimates.UPDATE,ZohoBooks.invoices.CREATE,ZohoBooks.invoices.UPDATE,ZohoBooks.creditnotes.CREATE,ZohoBooks.creditnotes.UPDATE,ZohoBooks.customerpayments.CREATE,ZohoBooks.accountants.READ,ZohoSubscriptions.subscriptions.READ,ZohoSubscriptions.invoices.READ`
   (Desde el 2026-10-04 lleva también los del cobro del mantenimiento: la
   factura MANT- con su cobro, los abonos ABONO- y la lista de cuentas
   bancarias, que solo se usan después del cambio; y los dos de Zoho Billing
   —`ZohoSubscriptions…`—, para «Comprobar en Zoho» la cartera vieja, que
   vale ya.)
   (Si ya lo conectaste con la lista de antes, genera otro código con esta y
   vuelve a pegarlo en el paso 4: el nuevo sustituye al viejo.)
   → **Time Duration** 10 minutes → descripción `Hub` → **CREATE** →
   organización **Dalmon Sistemas S.L.** → copia el código `1000.…`.
4. En el hub: **Datos y sincronización** → tarjeta **Zoho Books** → pega el
   código → **Conectar**.

## 6 · Bot de Telegram

1. En Telegram, **@BotFather** → `/newbot` → nombre `Ok Computer Hub` →
   usuario acabado en `bot` (p. ej. `OkComputerHubBot`). Copia el **token**.
2. Variables de entorno: `TELEGRAM_BOT_TOKEN=123456:ABC...` y avisa a Claude.
3. En el hub: **Informes y Telegram** → **Configurar el bot**.
4. Cada persona: **Informes y Telegram** → **Vincular mi Telegram** → **Iniciar**.

## 7 · Los dominios (`hub.` y `clientes.okcomputertenerife.com`)

Hoy el hub vive en `okhub-tenerife.web.app` y el portal en
`okhub-tenerife.web.app/portal.html`. Para los dominios propios:

1. **https://console.firebase.google.com** → proyecto **okcomputerclaude** →
   **Hosting** → sitio **okhub-tenerife** → **Añadir dominio personalizado**.
2. Escribe `hub.okcomputertenerife.com` → **Continuar**. Firebase enseña unos
   **registros DNS** (un TXT para verificar y uno o dos A).
3. Repite con `clientes.okcomputertenerife.com` (mismo sitio: el hub ya manda
   ese dominio al portal).
4. Esos registros van en el DNS del dominio (donde está
   `okcomputertenerife.com`). Si está en Hostinger, **dile a Claude «pon los
   registros en Hostinger»** y los pone él con el conector; si no, cópialos
   en tu panel de DNS tal cual los da Firebase.
5. Cuando Firebase diga «Conectado», avisa: Claude añade los dominios a la
   lista de acceso de la Auth del hub y apunta los enlaces del portal, la
   gestoría y las firmas al dominio nuevo.

## 8 · Decisiones y avisos al equipo

1. **Ya se llevan en el hub**: las **oportunidades** (fase 4) y los
   **tickets** (fase 6). Dile al equipo que no use esas pantallas en la app.
   Lo que la app sigue creando sola (formulario web, WhatsApp, voz) entra al
   hub igual.
2. **Gestoría**: en **Portal de clientes** → «Dar acceso» → Para: **La
   gestoría** → su correo → **Dar acceso**. Ella entra por
   `…/gestoria.html` con el enlace que le llega (o el que le generes con
   «Generar enlace» y le mandes por WhatsApp mientras el correo no esté).
3. **Clientes en el portal**: igual, en **Portal de clientes**, cliente a
   cliente (con el correo de su contacto).
4. **Almacén**: dar de alta los **proveedores** y qué material sirve cada uno
   (Almacén y compras → Proveedores), o el MRP no sabe a quién pedir.
5. **Facturación propia** (sin activar): completa los **datos del emisor**
   (Facturación → Datos del emisor: NIF, dirección, IBAN) y pide a la
   gestoría que revise unas facturas de la serie de PRUEBA. La activación va
   aparte, con tu OK (docs/FASE11.md).
6. **Registro de jornada**: revisa los días en rojo («más de 12 h: ¿se quedó
   un fichaje abierto?») en Personas → Jornada y corrígelos con su motivo.

## 8 bis · Stripe del mantenimiento (SOLO el día del cambio del mantenimiento)

**Desbloquea**: que el hub cobre las cuotas y emita sus facturas MANT- (hoy lo
hace la app). Está todo preparado y apagado: NO lo hagas antes del cambio del
área de mantenimiento, o cada cuota se facturaría dos veces (una la app y otra
el hub).

1. Variables de entorno del entorno cloud (menú del entorno en la barra de
   título de la sesión → **Edit** → variables), las MISMAS que tiene la app:
   ```
   STRIPE_SECRET_KEY=sk_live_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   ```
   Las dos están en **https://dashboard.stripe.com** con la cuenta
   **Ok Computer Zoho** (la que tiene SEPA): la primera en **Developers** →
   **API keys** → **Secret key** → **Reveal**; la segunda, en **Developers** →
   **Webhooks** → el endpoint que acaba en `/functions/v1/stripe-webhook` →
   **Signing secret** → **Reveal**. Avisa a Claude: él las pasa a las
   funciones del hub.
2. Cuando Claude te diga que el hub ya tiene el área de mantenimiento: en esa
   misma pantalla del webhook → **⋯** → **Update details** → en **Endpoint
   URL** cambia la dirección de la app por
   `https://adomalsxsymxzuozksmt.supabase.co/functions/v1/stripe-webhook` →
   **Update endpoint**. Al editar el mismo endpoint, el «Signing secret» no
   cambia.

## 9 · El cambio final (cuando tú digas)

La redirección de la app al hub, la URL de la APK y apagar el sync esperan a
tu OK. Los pasos están en `docs/FASE_FINAL.md`; el corte en sí está preparado
y probado (`supabase/cortes/corte_final.sql`).
