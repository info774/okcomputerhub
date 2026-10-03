# Modo escritorio del hub

El hub como un escritorio con ventanas: la propuesta 6 del lienzo «Hub OS»
(centro de mando con el tema noche y el hexágono de la marca), llevada a
código el 2026-09-28. Convive con el hub clásico y no lo toca.

## Cómo se enciende

- **Desde el 2026-10-03 es la entrada por defecto** en pantallas de 1024 px o
  más (decisión de Fran): sin nada guardado, se entra al escritorio.
- Se apaga desde el avatar de la barra → **«Volver a la app clásica»**, y eso se
  recuerda por navegador (`localStorage.hub_escritorio = '0'`) hasta que se
  pulse **«🖥 Modo escritorio»** al pie del menú lateral.
- `?os=1` en la URL lo enciende y `?os=0` lo apaga (la URL se limpia sola).
- Por debajo de 1024 px no entra aunque esté activado: el móvil sigue con el
  hub de siempre.

## Qué hay en pantalla

- **Barra**: marca, chips de **escritorios** (varios con nombre: «+» crea, el
  avatar renombra o elimina), buscador **Ctrl+K**, chip del **sync** con la
  app (`hub.sync_estado`, verde / ámbar / rojo por antigüedad), **campana** con
  el número de avisos, tema día/noche, reloj y avatar.
- **El escritorio es el panel** (widgets, refrescados cada minuto). Cada
  widget se **arrastra** a cualquier sitio (cogiéndolo por donde no haya un
  enlace o botón); el sitio se guarda por escritorio y «Recolocar los widgets»
  (menú del avatar) los devuelve a la rejilla:
  - *Hoy*: bloques de agenda de hoy, tickets abiertos, sin técnico y tareas.
  - *Avisos*: los cinco primeros del motor `hub.panorama_direccion` (el mismo
    que el puesto de mando, el bot y los informes).
  - *Cobros* (solo admin: es dinero): cuotas de mantenimiento por estado de
    pago de `locales` y recordatorios pendientes.
  - *Equipos*: anillo hexagonal con los conectados de `hub.rmm_equipos`, sin
    señal, alertas activas y las dos últimas.
  - *Agenda de hoy*: bloques de `agenda` con su trabajo y cliente; un bloque
    sin técnico va marcado con «Asignar».
  - *Voz de Oki*: hablar con Oki (una pregunta va al buscador; un encargo se
    reparte como comanda tras confirmarlo).
  - *Oki dice*: lo más urgente, con «Sí, contéstalo» / «Lo miro yo» si es un
    ticket.
  - *Estadísticas*: SLA de respuesta, tickets de la semana, trabajos
    completados y cerrados por día (cada ~5 min).
  - *Órdenes rápidas*: lista del día, nuevo trabajo/ticket, comandas,
    calendario, preguntar a Oki.
  Las cuatro últimas son las mismas piezas que la portada de Oki
  (`src/modulos/inicio/piezas.ts`). Mientras nadie mueve un widget van en
  columnas que se rellenan de arriba abajo.
- **«Oki» en el dock** abre la portada de Oki entera (diagrama, estadísticas,
  pie con «Hablar con Oki» y el repaso) como una ventana más.
- **WhatsApp**: el chat de clientes, plegado, es un botón hexagonal encima de
  la esquina derecha del dock con el número de pendientes; abierto, sube por
  encima del dock.
- **Ventanas**: una por módulo. Navegar a `#/proyectos/12` pinta la ficha en
  la ventana de Proyectos (la misma `pintarPantalla` del shell clásico, en un
  contenedor con clase `principal` para que los estilos de formulario valgan).
  Arrastrar por el título; soltar en un borde encaja a media pantalla, en una
  esquina a un cuarto y arriba maximiza (guía verde mientras se arrastra);
  **Alt+Mayús+← → ↑ ↓** hace lo mismo con el teclado; doble clic en el título
  maximiza o restaura; redimensionar con la esquina (`resize: both`). Cerrar la
  ventana de la URL actual vuelve a `#/inicio` (el panel).
- **Aspecto de las ventanas** (2026-10-03, estudiando las de la app): barra de
  título en `superficie` y cuerpo OPACO en `fondo` (como el hub clásico, para
  que las tarjetas resalten y no se transparente lo de detrás); la de delante
  lleva aro verde fino, sombra alta y una línea de acento arriba, y las de
  detrás apagan título e icono. Botones con iconos SVG de línea y fondo
  hexagonal al pasar (Maximizar cambia a «Restaurar» maximizada) y tirador
  propio en la esquina. Movimiento: abrir crece, cerrar se desvanece (la
  ventana pierde su id AL MOMENTO), minimizar viaja a su icono del dock y
  restaurar vuelve de allí, y encajar o maximizar la desliza (`.os-anima`,
  mientras dura el ResizeObserver no apunta tamaños). Todo se apaga con
  `prefers-reduced-motion`. Los arneses miden la geometría cuando ya no queda
  `.os-win.os-anima`.
- **Menú de disposiciones y asistente de ajuste** (los de la app): con el ratón
  sobre Maximizar sale un menú con cinco miniaturas (dos mitades, cuatro
  cuartos, izquierda + dos, dos + derecha, pantalla completa) que marca la zona
  actual; al encajar con el ratón (arrastre o menú) el hueco que queda se
  ofrece a las demás ventanas del escritorio, sueltas o minimizadas, hueco a
  hueco (`COMPLEMENTO`). Esc o un clic fuera lo dejan libre. Arrastrar arriba
  junto a una esquina encaja en ese cuarto.
- **Dock**: las pantallas del hub (sin las que enlazan a la app actual) con su
  estado (abierta, delante), **Claude** (abre la paleta en modo «Pedir a
  Claude») y **Todas** (lanzador con todo, incluidas las de la app actual).
  Desde el 2026-10-03 funciona como el de macOS (`shell/dock.ts`): los iconos
  crecen al pasar el ratón, el nombre sale encima, la pantalla que se abre
  rebota y lo abierto lleva un punto. Iconos de línea en hexágono, como los de
  la web (`shell/iconos.ts`). **Cada persona elige sus fijas** y se guardan en
  la base (`hub.dock_fijas`), así es el mismo dock en cualquier ordenador:
  - clic derecho en un icono (del dock o de «Todas») → «Mantener en el dock»
    o «Quitar del dock»;
  - arrastrar una pantalla de «Todas» al dock la fija donde se suelte, y
    arrastrar dentro del dock cambia el orden;
  - sacar un icono hacia arriba, fuera del dock, lo quita.
  Panel, Oki, Claude y Todas no se mueven. Sin elegir nada, las 12 primeras
  pantallas del menú. Lo abierto que no está fijo sale mientras esté abierto.
- **Centro de avisos** (campana): la lista completa, con «Los míos» (misma regla
  `esMio` del puesto de mando) y el enlace de cada aviso.

## La paleta Ctrl+K (también en el hub clásico)

Cuatro modos, **Tab** cambia de uno a otro:

1. **Pantallas**: lo de siempre.
2. **Datos**: clientes, sedes y proyectos del hub por nombre (abren su ficha);
   trabajos y tickets del espejo por número o título (abren la app actual).
3. **Preguntar**: manda la pregunta a `#/buscar/<pregunta>` (RAG sobre los
   documentos).
4. **Pedir a Claude**: lista los proyectos abiertos; elegir uno abre su pestaña
   Claude, donde está el formulario de petición. Claude trabaja siempre sobre
   un proyecto (`hub.claude_peticiones.proyecto_id` es obligatorio).

## Dónde vive

- `src/shell/escritorio.ts` (lógica, prefijo `os-`), `src/escritorio.css`
  (todo bajo `body.os-modo`), `src/shell/pantalla.ts` (pintar un módulo en
  cualquier contenedor), `src/shell/buscador.ts` (la paleta).
- La disposición (ventanas, tamaño, sitio, zona, escritorios) se guarda por
  persona en `localStorage.hub_os_<usuario>`. Nada del escritorio escribe en
  la base.
- Arnés: `.claude/skills/verify/verify-escritorio.mjs` (en `npm run verify`).

## Tokens de marca

Con el modo escritorio llegaron los tokens del sistema «OK Computer» a
`src/estilo.css`: `--verde`, `--lima`, `--hondo`, `--tinta`, `--noche`,
`--menta`, `--palido`, `--linea`, y los de interfaz (`--primario`,
`--primario-suave`, `--accion`, `--fondo`, `--superficie`…) redefinidos en
los dos temas. Las pantallas siguen usando los mismos nombres de siempre. El
hexágono es el único motivo gráfico (`.hex`, `.hex-punto`, `--hex`). OJO:
`.aviso` es una caja (padding y fondo) en todo el hub; para un color de
gravedad se usan `g-mal` / `g-aviso`.
