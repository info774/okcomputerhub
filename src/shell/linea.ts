// Iconos de línea de 16 px (trazo del texto, sin relleno) para botones de la
// interfaz: barra del escritorio, cabecera del shell clásico, menús. El
// hexágono de cada PANTALLA es otra cosa (shell/iconos.ts). Nada de emojis
// en el cromo del programa.
export const ICONO_LINEA: Record<string, string> = {
  buscar: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2 13.5 13.5"/>',
  campana: '<path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.3H2.8z"/><path d="M6.6 14.2a1.5 1.5 0 0 0 2.8 0"/>',
  luna: '<path d="M13 9.6A5.3 5.3 0 0 1 6.4 3a5.3 5.3 0 1 0 6.6 6.6z"/>',
  sol: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1"/>',
  mas: '<path d="M8 3.5v9M3.5 8h9"/>',
  renombrar: '<path d="M10.5 3 13 5.5 6 12.5H3.5V10z"/>',
  eliminar: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>',
  widgets: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  clasica: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5.5 3v10"/>',
  salir: '<path d="M9.5 3H13v10H9.5M7 5.2 4.2 8 7 10.8M4.2 8H10"/>',
  actualizar: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.8h-2.8"/>',
  externo: '<path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13H3V4.5h3.5"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  ayuda: '<circle cx="8" cy="8" r="5.8"/><path d="M6.2 6.3a1.9 1.9 0 0 1 3.6.8c0 1.3-1.8 1.6-1.8 2.7M8 11.6v.1"/>',
  escritorio: '<rect x="2" y="2.8" width="12" height="8.4" rx="1.4"/><path d="M5.5 13.5h5M8 11.2v2.3"/>',
};

export const svgLinea = (n: string, clase = '') =>
  `<svg class="os-bico ${clase}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONO_LINEA[n] ?? ''}</svg>`;
