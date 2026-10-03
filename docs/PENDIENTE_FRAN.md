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

## 3 · Clave de Groq (notas de voz → comandas)

**Desbloquea**: dictar comandas en #/comandas y mandarle notas de voz al bot.

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
   presupuestos para el portal):
   `ZohoBooks.invoices.READ,ZohoBooks.customerpayments.READ,ZohoBooks.contacts.READ,ZohoBooks.settings.READ,ZohoBooks.estimates.READ`
   → **Time Duration** 10 minutes → descripción `Hub lectura` → **CREATE** →
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

## 9 · El cambio final (cuando tú digas)

La redirección de la app al hub, la URL de la APK y apagar el sync esperan a
tu OK. Los pasos están en `docs/FASE_FINAL.md`; el corte en sí está preparado
y probado (`supabase/cortes/corte_final.sql`).
