# Reloj (Galaxy Watch · Wear OS)

El hub en la muñeca: app **Ok Hub** para Galaxy Watch 4 o posterior (Wear OS).

## Qué hace

- **Tile** (deslizar desde la esfera): avisos urgentes, siguiente parada o
  fichaje en curso, sedes caídas y, para admins, lo vencido.
- **Complicación** «Avisos del hub»: nº de avisos en la esfera (`⚠3` si hay
  urgentes); tocarla abre Avisos.
- **App**: Avisos (de `hub.panorama_direccion`, el mismo motor del puesto de
  mando) · Mi día (paradas de hoy, Cómo llegar, Empezar aquí, fichar traslado
  y fin) · Monitorización (sedes caídas, alertas) · Cifras (solo admins, de
  `hub.direccion_resumen`) · Comanda dictada (`crearComanda`, avisa por
  Telegram).
- **Abrir en el móvil**: un aviso, una ficha o Cómo llegar se abren en el
  teléfono emparejado (`RemoteActivityHelper`).
- Se refresca al abrirla y cada 15 min en segundo plano (WorkManager); tile y
  complicación pintan lo guardado, sin esperar a la red.

## Piezas

| Pieza | Dónde |
|---|---|
| App Android (Kotlin + Compose for Wear OS) | `reloj/` |
| Compilación del APK | `.github/workflows/reloj-apk.yml` (cada push a `reloj/**`) |
| Función del hub | `supabase/functions/reloj` (SIN_JWT, token `okr_…`) |
| Tablas y RPC | `supabase/migrations/20261017_reloj.sql` |
| Pantalla para vincular | `#/reloj` (`src/modulos/reloj/`), arnés `verify-reloj.mjs` |

## Reglas

- **Vinculación como una tele**: el reloj pide `vincular` y recibe un token
  `okr_…` (que aún no vale) y un código `K7M-4QP` (10 min). La persona lo
  teclea en `#/reloj` (o pulsa «Abrir en el móvil» en el reloj, que trae el
  código puesto) y el token queda atado a ella. En la base solo queda la
  HUELLA del token. Desvincular = `hub.reloj_revocar` (dueño o admin).
- El reloj **actúa como su dueño**: lo que escribe queda en `hub.auditoria`
  a su nombre con origen `reloj`.
- **Fichar** pasa por `hub.reloj_fichar`, que llama a la MISMA `hub.fichar`
  (las reglas no se duplican). Mientras el fichaje sea de la app (`hub.areas`),
  el reloj lo dice y ofrece abrir la app actual en el móvil.
- Un dato nuevo en el reloj: añadirlo al `resumen` de la función, a `Datos.kt`
  (`leerResumen`) y pintarlo en `Pantallas.kt` / `HubTileService.kt`. Cambiar
  la FORMA del resumen es un contrato: el reloj viejo sigue instalado, así
  que se AÑADEN campos, no se quitan.
- Firma: `reloj/app/reloj-firma.jks` va en el repo a propósito (no hay
  tienda; solo sirve para que cada versión se instale encima de la anterior).
  Con los secrets `RELOJ_KEYSTORE_*` se puede usar otra, pero cambiar de
  clave obliga a desinstalar la app del reloj una vez.

## Instalarla en el reloj (desde el móvil Android)

Se hace una vez; las actualizaciones repiten solo los pasos 3 y 4.

1. **Activar el modo desarrollador en el reloj**: en el reloj, *Ajustes* →
   *Información del reloj* → *Información de software* → pulsar **5 veces**
   sobre *Versión de software* hasta que diga que el modo desarrollador está
   activado.
2. **Activar la depuración por Wi-Fi**: en el reloj, *Ajustes* → *Opciones
   de desarrollador* → activar **Depuración ADB** y **Depuración
   inalámbrica**. El reloj y el móvil tienen que estar en la **misma Wi-Fi**.
   Al entrar en *Depuración inalámbrica* se ve la **dirección IP y el
   puerto** (p. ej. `192.168.1.40:41235`).
3. **Bajar el APK al móvil**: en el móvil, abrir
   `https://github.com/info774/okcomputerhub/releases` (con la sesión de
   GitHub iniciada), entrar en la última «Reloj N» y tocar
   `okhub-reloj-N.apk` para descargarlo.
4. **Instalarlo con Wear Installer 2** (Google Play, gratis): abrirla, poner
   la IP del reloj en *Watch IP*, elegir el APK descargado y pulsar
   *Install*. Si el reloj pregunta «¿Permitir depuración?» o pide un código
   de vinculación (*Vincular dispositivo con código*), aceptar o teclear el
   código que enseña el reloj.
5. **Vincular**: abrir **Ok Hub** en el reloj → *Vincular* → sale un código.
   Pulsar *Abrir en el móvil* (o abrir el hub → menú *Sistema* → *Reloj*),
   comprobar el código y pulsar **Vincular**. En unos segundos el reloj se
   pone al día.
6. **Tile y complicación**: mantener pulsada la esfera → *Personalizar* →
   tocar una complicación → *Ok Hub · Avisos del hub*. Para la tile: deslizar
   a la izquierda hasta el final → *Añadir* → *Ok Hub*.

Al terminar se puede volver a apagar la *Depuración ADB* del reloj (gasta
batería); para actualizar se enciende otra vez.
