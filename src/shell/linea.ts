// Iconos de línea de 16 px (trazo del texto, sin relleno). Los usan el cromo
// del programa (barra del escritorio, cabecera, menús) y el CONTENIDO de las
// pantallas (botones, rótulos, filas): nada de emojis en el hub. El hexágono
// de cada PANTALLA es otra cosa (shell/iconos.ts).
//
//   svgLinea('buscar')      → para la cabecera y los menús (.os-bico, 16 px)
//   ico('telefono')         → dentro de un texto o botón (.ico, 1 em, se alinea
//                             con la letra y toma su color)
//
// Un icono nuevo: su trazo aquí (viewBox 0 0 16 16, sin relleno) y nada más.
// En un sitio que no admite HTML (title, <option>, confirm, toast, CSV, texto
// de Telegram) no va icono: va el texto solo.
const ICONOS = {
  buscar: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2 13.5 13.5"/>',
  campana: '<path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.3H2.8z"/><path d="M6.6 14.2a1.5 1.5 0 0 0 2.8 0"/>',
  luna: '<path d="M13 9.6A5.3 5.3 0 0 1 6.4 3a5.3 5.3 0 1 0 6.6 6.6z"/>',
  sol: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1"/>',
  mas: '<path d="M8 3.5v9M3.5 8h9"/>',
  renombrar: '<path d="M10.5 3 13 5.5 6 12.5H3.5V10z"/>',
  editar: '<path d="M10.5 3 13 5.5 6 12.5H3.5V10z"/><path d="M9 4.5 11.5 7"/>',
  eliminar: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>',
  widgets: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  clasica: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5.5 3v10"/>',
  salir: '<path d="M9.5 3H13v10H9.5M7 5.2 4.2 8 7 10.8M4.2 8H10"/>',
  actualizar: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.8h-2.8"/>',
  repetir: '<path d="M3 7V6a2 2 0 0 1 2-2h8M11 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3M5 14l-2-2 2-2"/>',
  externo: '<path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13H3V4.5h3.5"/>',
  enlace: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  ayuda: '<circle cx="8" cy="8" r="5.8"/><path d="M6.2 6.3a1.9 1.9 0 0 1 3.6.8c0 1.3-1.8 1.6-1.8 2.7M8 11.6v.1"/>',
  escritorio: '<rect x="2" y="2.8" width="12" height="8.4" rx="1.4"/><path d="M5.5 13.5h5M8 11.2v2.3"/>',
  // Comunicación
  mensaje: '<path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H6.5L3.5 13.5V11H4a1.5 1.5 0 0 1-1.5-1.5z"/>',
  correo: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="m2.5 4.5 5.5 4.3 5.5-4.3"/>',
  telefono: '<path d="M5.6 2.5 4 2.6A1.6 1.6 0 0 0 2.5 4.3a10 10 0 0 0 9.2 9.2 1.6 1.6 0 0 0 1.7-1.5l.1-1.6-2.8-1.2-1.3 1.3a6.6 6.6 0 0 1-3-3l1.3-1.3z"/>',
  movil: '<rect x="4.5" y="1.8" width="7" height="12.4" rx="1.5"/><path d="M7.2 11.8h1.6"/>',
  enviar: '<path d="M14 2 7 9M14 2l-4.5 12L7 9 2 6.5z"/>',
  recibir: '<path d="M2.5 9.5h3l1 1.8h3l1-1.8h3M2.5 9.5 4.3 3.5h7.4l1.8 6V13h-11zM8 3.5v4.5M6.3 6.3 8 8l1.7-1.7"/>',
  responder: '<path d="M6 4 2.5 7.5 6 11M2.5 7.5H9a4.5 4.5 0 0 1 4.5 4.5v.5"/>',
  reenviar: '<path d="M10 4l3.5 3.5L10 11M13.5 7.5H7A4.5 4.5 0 0 0 2.5 12v.5"/>',
  web: '<circle cx="8" cy="8" r="5.8"/><path d="M2.2 8h11.6M8 2.2c1.6 1.6 2.4 3.5 2.4 5.8S9.6 12.2 8 13.8M8 2.2C6.4 3.8 5.6 5.7 5.6 8s.8 4.2 2.4 5.8"/>',
  antena: '<path d="M8 8.5V14M6 14h4M5.2 5.7a4 4 0 0 0 0 5.6M10.8 5.7a4 4 0 0 1 0 5.6M3.5 4a6.4 6.4 0 0 0 0 9M12.5 4a6.4 6.4 0 0 1 0 9"/><circle cx="8" cy="8.5" r=".9"/>',
  micro: '<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.8 7.5a4.2 4.2 0 0 0 8.4 0M8 11.7V14M6 14h4"/>',
  // Avisos y estado
  atencion: '<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3v.1"/>',
  alarma: '<path d="M4.5 12V8.5a3.5 3.5 0 0 1 7 0V12M3 12h10v1.8H3zM8 2v1.3M3 4.2l.9.9M13 4.2l-.9.9"/>',
  hecho: '<circle cx="8" cy="8" r="5.8"/><path d="m5.4 8.2 1.8 1.8 3.5-3.6"/>',
  ok: '<path d="m3.5 8.5 3 3 6-6.5"/>',
  cerrar: '<path d="M4 4l8 8M12 4l-8 8"/>',
  prohibido: '<circle cx="8" cy="8" r="5.8"/><path d="M3.9 3.9l8.2 8.2"/>',
  info: '<circle cx="8" cy="8" r="5.8"/><path d="M8 7.3v4M8 4.9v.1"/>',
  estrella: '<path d="m8 2.3 1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11.1 4.5 13l.8-3.9-2.9-2.7 3.9-.5z"/>',
  trofeo: '<path d="M5 2.5h6v3.8a3 3 0 0 1-6 0zM5 3.8H2.8a2 2 0 0 0 2.3 3M11 3.8h2.2a2 2 0 0 1-2.3 3M8 9.3v2.5M5.5 13.5h5M6.3 11.8h3.4"/>',
  rayo: '<path d="M9 1.8 3.5 9h4l-1 5.2L12.5 7h-4z"/>',
  chispa: '<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12"/>',
  idea: '<path d="M6 11.5h4M6.5 13.8h3M5.8 11.5c0-1.6-2-2.3-2-5a4.2 4.2 0 0 1 8.4 0c0 2.7-2 3.4-2 5"/>',
  objetivo: '<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="3.2"/><circle cx="8" cy="8" r=".8"/>',
  bandera: '<path d="M3.5 14V2.5M3.5 3h8l-1.8 2.8 1.8 2.7h-8"/>',
  escudo: '<path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"/>',
  candado: '<rect x="3.5" y="7" width="9" height="6.8" rx="1.3"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  abierto: '<rect x="3.5" y="7" width="9" height="6.8" rx="1.3"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/>',
  llave: '<circle cx="5" cy="10.5" r="2.8"/><path d="m7 8.5 6-6M11 4.5l1.6 1.6M9.5 6l1.4 1.4"/>',
  ver: '<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="2"/>',
  espera: '<path d="M4 2h8M4 14h8M4.8 2c0 3.3 6.4 3.7 6.4 6S4.8 10.7 4.8 14M11.2 2c0 3.3-6.4 3.7-6.4 6s6.4 2.7 6.4 6"/>',
  // Personas y sitios
  persona: '<circle cx="8" cy="5.5" r="2.7"/><path d="M2.8 14a5.2 5.2 0 0 1 10.4 0"/>',
  personas: '<circle cx="6" cy="5.8" r="2.3"/><path d="M1.8 13.5a4.2 4.2 0 0 1 8.4 0M10.5 3.6a2.3 2.3 0 0 1 0 4.4M12 9.6a4.2 4.2 0 0 1 2.2 3.9"/>',
  tecnico: '<circle cx="8" cy="6.3" r="2.5"/><path d="M4.6 4.8a3.6 3.6 0 0 1 6.8 0zM2.8 14a5.2 5.2 0 0 1 10.4 0"/>',
  trato: '<path d="M1.8 6.5 4.5 4l2.3 1 2-1 3 1L14.2 7M4 9.5l2 2c.6.6 1.4.6 2 0l.4-.4M8.4 11.1l.5.5c.6.6 1.4.6 2 0L13 9.5M1.8 6.5l2 3.8M14.2 7l-1.4 2.7M6.8 5 5 7a1 1 0 0 0 1.4 1.4L8.5 6.7"/>',
  empresa: '<path d="M2.5 14V3.5h7V14M9.5 7h4v7M1.5 14h13M4.8 6h2.4M4.8 8.6h2.4M4.8 11.2h2.4M11.3 9.5h.4M11.3 11.8h.4"/>',
  casa: '<path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13.5h8V6.5M6.8 13.5V10h2.4v3.5"/>',
  ubicacion: '<path d="M8 14s4.5-4.2 4.5-7.8a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.3" r="1.6"/>',
  mapa: '<path d="M2 4l4-1.5 4 1.5 4-1.5v9.5L10 13.5 6 12l-4 1.5zM6 2.5V12M10 4v9.5"/>',
  brujula: '<circle cx="8" cy="8" r="5.8"/><path d="m10.5 5.5-1.6 3.4-3.4 1.6 1.6-3.4z"/>',
  coche: '<path d="M2.5 10.5V8.3l1.4-3.5a1.2 1.2 0 0 1 1.1-.8h6a1.2 1.2 0 0 1 1.1.8l1.4 3.5v2.2zM2.5 10.5V12M13.5 10.5V12M2.8 8.3h10.4"/><circle cx="5" cy="9.6" r=".5"/><circle cx="11" cy="9.6" r=".5"/>',
  furgoneta: '<path d="M1.8 11.5V4.5h8v7M9.8 6.5h2.4l2 2.5v2.5h-1.4M1.8 11.5h1.4M6 11.5h4.6"/><circle cx="4.6" cy="11.8" r="1.4"/><circle cx="12" cy="11.8" r="1.4"/>',
  andando: '<circle cx="8.8" cy="3" r="1.3"/><path d="m6 14 1.6-4.2L9.8 12V14M7.6 9.8l.8-4.3-2.6 1.3-.8 2.2M8.4 5.5l1.5 2.2 2 .8"/>',
  vacaciones: '<path d="M8 6.5 6 14M2.5 6.5a5.6 5.6 0 0 1 11 0zM2 14h12"/>',
  salud: '<path d="M8 13.5S2.5 10.3 2.5 6.3A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.3c0 4-5.5 7.2-5.5 7.2z"/><path d="M4 8h1.8l1-1.5 1.5 3L9.5 8H12"/>',
  // Documentos y dinero
  documento: '<path d="M4 2h5.5L12.5 5v9h-8.5z"/><path d="M9.5 2v3h3M6 8h4.5M6 10.5h4.5"/>',
  nota: '<path d="M3 2.5h7.5L13 5v8.5H3z"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>',
  lista: '<rect x="3.5" y="2.8" width="9" height="11.2" rx="1.2"/><path d="M6 2.2h4v1.6H6zM5.8 7h4.4M5.8 9.5h4.4M5.8 12h2.5"/>',
  libreta: '<path d="M4 2h8.5v12H4zM4 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14M6.5 5.5h3.5M6.5 8h3.5"/>',
  libro: '<path d="M8 4c-1.5-1.3-3.5-1.5-5.5-1.2v10c2-.3 4 0 5.5 1.2 1.5-1.2 3.5-1.5 5.5-1.2v-10C11.5 2.5 9.5 2.7 8 4zM8 4v10"/>',
  carpeta: '<path d="M2 4.2a1 1 0 0 1 1-1h3.3l1.4 1.6H13a1 1 0 0 1 1 1V12.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  ficha: '<rect x="2" y="3.5" width="12" height="9" rx="1.3"/><circle cx="5.7" cy="7.2" r="1.3"/><path d="M3.8 10.5a2 2 0 0 1 3.8 0M9.3 6.5h3M9.3 9h3"/>',
  adjunto: '<path d="M12.5 7.5 7.8 12.2a3 3 0 0 1-4.2-4.2l5-5a2 2 0 0 1 2.8 2.8L6.6 10.6a1 1 0 0 1-1.4-1.4l4.5-4.5"/>',
  recibo: '<path d="M3.5 2h9v12l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z"/><path d="M5.8 5.5h4.4M5.8 8h4.4M5.8 10.5h2.4"/>',
  dinero: '<rect x="1.8" y="4" width="12.4" height="8" rx="1.3"/><circle cx="8" cy="8" r="1.8"/><path d="M4.2 6.2v.1M11.8 9.8v.1"/>',
  tarjeta: '<rect x="1.8" y="3.5" width="12.4" height="9" rx="1.4"/><path d="M1.8 6.5h12.4M4.5 10h2.5"/>',
  banco: '<path d="M2 6 8 2.5 14 6zM3 13.5h10M2 14.5h12M4 6.5V12M6.7 6.5V12M9.3 6.5V12M12 6.5V12"/>',
  firma: '<path d="M2.5 12.5c1.5 0 2-4 3.5-4s.5 3 2 3 1.5-1.8 2.7-1.8M10 3l2.5 2.5-3.8 3.8H6.2V6.8z"/><path d="M2 14.5h12"/>',
  imprimir: '<path d="M4.5 6V2.5h7V6M4.5 11.5H2.8V6h10.4v5.5h-1.7M4.5 9.5h7v4h-7z"/>',
  descargar: '<path d="M8 2.5v8M4.8 7.3 8 10.5l3.2-3.2M2.8 12.5v1h10.4v-1"/>',
  subir: '<path d="M8 10.5v-8M4.8 5.7 8 2.5l3.2 3.2M2.8 12.5v1h10.4v-1"/>',
  caja: '<path d="M2.5 5 8 2.5 13.5 5v6.5L8 14l-5.5-2.5zM2.5 5 8 7.5 13.5 5M8 7.5V14"/>',
  etiqueta: '<path d="M2.5 2.5h5.3l5.7 5.7-5.3 5.3-5.7-5.7z"/><circle cx="5.3" cy="5.3" r=".9"/>',
  regla: '<path d="m2 10.5 8.5-8.5 3.5 3.5L5.5 14zM5 7.5l1.5 1.5M7 5.5l1 1M9 3.5l1.5 1.5"/>',
  // Tiempo
  calendario: '<rect x="2.3" y="3.3" width="11.4" height="10.4" rx="1.4"/><path d="M2.3 6.5h11.4M5.3 2v2.6M10.7 2v2.6"/>',
  reloj: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.5"/>',
  cronometro: '<circle cx="8" cy="9" r="5"/><path d="M8 6.5V9l1.5 1M6.5 2h3M8 2v2M12.2 4.5l.9-.9"/>',
  smartwatch: '<rect x="4" y="4" width="8" height="8" rx="2"/><path d="M5.5 4l.5-2.3h4l.5 2.3M5.5 12l.5 2.3h4l.5-2.3M8 6.5V8l1 .8"/>',
  // Herramientas y equipos
  herramienta: '<path d="M10.2 2.2a3.3 3.3 0 0 0-3.9 4.4L2.5 10.4a1.5 1.5 0 0 0 2.1 2.1l3.8-3.8a3.3 3.3 0 0 0 4.4-3.9l-1.9 1.9-1.8-.3-.3-1.8z"/>',
  ajustes: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3"/>',
  monitor: '<rect x="2" y="2.8" width="12" height="8.4" rx="1.4"/><path d="M5.5 13.5h5M8 11.2v2.3"/>',
  conector: '<path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3"/>',
  robot: '<rect x="3" y="5" width="10" height="7.5" rx="2"/><path d="M8 2.5V5M1.8 8v2M14.2 8v2M6 10.5h4"/><circle cx="6" cy="8" r=".7"/><circle cx="10" cy="8" r=".7"/>',
  cohete: '<path d="M9.5 2.5c2 0 4 0 4 0s0 2-0 4L9 11 5 7zM5 7 2.5 7.5 4 5.5h3M9 11l-.5 2.5 2-1.5V9M4.5 11.5 3 13"/><circle cx="10.5" cy="5.5" r="1"/>',
  imagen: '<rect x="2" y="3" width="12" height="10" rx="1.4"/><circle cx="5.8" cy="6.5" r="1.2"/><path d="m2.5 12 3.8-3.5 2.4 2 2-1.6L13.5 12"/>',
  camara: '<path d="M2 5.5a1 1 0 0 1 1-1h2l1-1.5h4l1 1.5h2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><circle cx="8" cy="8.5" r="2.4"/>',
  video: '<rect x="1.8" y="4" width="9" height="8" rx="1.3"/><path d="m10.8 7 3.4-2v6l-3.4-2"/>',
  nube: '<path d="M4.5 12.5a3 3 0 0 1-.4-6A4 4 0 0 1 11.8 6a3.3 3.3 0 0 1 .2 6.5z"/>',
  ramas: '<circle cx="4.5" cy="3.5" r="1.4"/><circle cx="4.5" cy="12.5" r="1.4"/><circle cx="11.5" cy="5.5" r="1.4"/><path d="M4.5 4.9v6.2M11.5 6.9c0 2.5-2.5 3-6 4.4"/>',
  // Movimiento
  play: '<path d="M5 3.2v9.6L12.5 8z"/>',
  pausa: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  parar: '<rect x="4" y="4" width="8" height="8" rx="1"/>',
  derecha: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  izquierda: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  flecha: '<path d="M2.8 8h10M9.3 4.5 12.8 8l-3.5 3.5"/>',
  volver: '<path d="M6 3.8 2.8 7 6 10.2M2.8 7H10a3.2 3.2 0 0 1 0 6.4H8"/>',
  chincheta: '<path d="M6 2.2h4M6.8 2.2v4L4.5 9h7L9.2 6.2v-4M8 9v5"/>',
  casilla: '<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2"/>',
  casillaHecha: '<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2"/><path d="m5.5 8.2 1.8 1.8 3.3-3.6"/>',
} as const satisfies Record<string, string>;

export type IconoLinea = keyof typeof ICONOS;
export const ICONO_LINEA: Record<string, string> = ICONOS;

export const svgLinea = (n: string, clase = '') =>
  `<svg class="os-bico ${clase}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONO_LINEA[n] ?? ''}</svg>`;

/** Icono de línea DENTRO de un texto o botón: 1 em, color de la letra. */
export const ico = (n: IconoLinea, clase = '') =>
  `<svg class="ico${clase ? ` ${clase}` : ''}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONOS[n]}</svg>`;
