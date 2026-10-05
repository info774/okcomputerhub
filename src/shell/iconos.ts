// Iconos del dock y del lanzador del modo escritorio (diseño «Dock del hub»,
// 2026-10-03): línea duotono como los de la web (trazo `tinta`, relleno
// `menta`, rejilla de 24 px) dentro del hexágono de la marca. Cada icono son
// dos trazados: `r` se rellena y se perfila, `l` solo se perfila. Los colores
// van por CSS (`.os-ico`), así el tema noche no necesita otro juego.
// Pantalla sin dibujo: un hexágono con su inicial.

interface Dibujo { r: string; l: string }

const C = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

export const DIBUJOS: Record<string, Dibujo> = {
  panel: { r: 'M4 4h7v7H4z M13 13h7v7h-7z', l: 'M13 4h7v7h-7z M4 13h7v7H4z' },
  direccion: { r: C(12, 12, 8.5), l: `${C(12, 12, 4.5)} M12 12l6-6 M15.5 6H18v2.5` },
  informes: { r: 'M3 5h18v13H3z', l: 'M3 5l9 7 9-7' },
  proyectos: { r: 'M4 4h4.5v16H4z', l: 'M10.5 4H15v10h-4.5z M17 4h3.5v7H17z' },
  comandas: { r: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z', l: 'M9 8h6 M9 11.5h6 M9 15h3.5' },
  tareas: { r: 'M4 4h16v16H4z', l: 'M8 12.5l3 3 5.5-6.5' },
  chat: { r: 'M4 5h16v11H9l-5 4z', l: 'M8 9h8 M8 12.5h5' },
  feedback: { r: 'M4 5h16v11H9l-5 4z', l: 'M12 8v3.5 M12 13.5v.5' },
  tablero: { r: 'M5 4h14v16H5z', l: 'M9 4V2.5 M15 4V2.5 M8.5 9h7 M8.5 12.5h7 M8.5 16h4' },
  personas: { r: `${C(9, 8, 3.5)} M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6z`, l: `${C(17, 9, 2.5)} M16 14.2c2.8.2 5 2.3 5 5.8` },
  wiki: { r: 'M4 4.5c3-1 5.5-1 8 .8v15c-2.5-1.8-5-1.8-8-.8z', l: 'M12 5.3c2.5-1.8 5-1.8 8-.8v15c-3-1-5.5-1-8 .8' },
  buscar: { r: C(10.5, 10.5, 6.5), l: 'M15.3 15.3L21 21' },
  clientes: { r: 'M4 21V5l8-3v19z', l: 'M12 8h8v13 M2 21h20 M7 8h2 M7 12h2 M7 16h2 M15 12h2 M15 16h2' },
  sitios: { r: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z', l: C(12, 9.5, 2.5) },
  contactos: { r: 'M5 3h14v18H5z', l: `${C(12, 10, 2.8)} M8 17c.6-2.2 2.1-3.4 4-3.4s3.4 1.2 4 3.4 M3 7h2 M3 12h2 M3 17h2` },
  oportunidades: { r: 'M3 4h18l-7 8.5V19l-4 2v-8.5z', l: '' },
  presupuestos: { r: 'M6 2h9l4 4v16H6z', l: 'M15 2v4h4 M9 11h7 M9 14.5h7 M9 18h4' },
  mantenimientos: { r: C(12, 12, 4), l: 'M20 12a8 8 0 0 1-14.3 4.9 M4 12a8 8 0 0 1 14.3-4.9 M18.5 3.5v3.6h-3.6 M5.5 20.5v-3.6h3.6' },
  tickets: { r: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z', l: 'M14.5 8v1.5 M14.5 11.25v1.5 M14.5 14.5v1.5' },
  portal: { r: C(12, 12, 9), l: 'M3 12h18 M12 3c2.6 2.5 3.8 5.5 3.8 9s-1.2 6.5-3.8 9 M12 3c-2.6 2.5-3.8 5.5-3.8 9s1.2 6.5 3.8 9' },
  firmas: { r: 'M14.5 4.5l5 5L9 20H4v-5z', l: 'M12.5 6.5l5 5 M3 22.5h18' },
  cobros: { r: 'M2 6h20v12H2z', l: `${C(12, 12, 3)} M5.5 9v6 M18.5 9v6` },
  facturacion: { r: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z', l: 'M14.5 8.5c-.7-.8-1.6-1-2.5-1-1.6 0-2.5 1.1-2.5 3.5s.9 3.5 2.5 3.5c.9 0 1.8-.2 2.5-1 M8.5 10h4 M8.5 12.2h4' },
  mapa: { r: 'M9 4l6 2.5v14L9 18z', l: 'M9 4L3 6.5v14L9 18 M15 6.5L21 4v14l-6 2.5' },
  hoy: { r: 'M2 6h11v10H2z', l: `M13 9h4.5l3.5 3.5V16h-8 ${C(6.2, 18.2, 1.8)} ${C(16.8, 18.2, 1.8)}` },
  'lista-dia': { r: 'M6 3h12v18H6z', l: 'M9.5 2v2.5h5V2 M9 10l1.5 1.5L13 9 M9 15.5l1.5 1.5L13 14.5 M14.5 10.5h1 M14.5 16h1' },
  trabajos: { r: 'M15 3a5 5 0 0 0-4.6 6.9L3.6 16.7a2 2 0 0 0 2.8 2.8l6.8-6.8A5 5 0 0 0 20.6 8l-3 3-3.4-1-1-3.4 3-3A5 5 0 0 0 15 3z', l: '' },
  calendario: { r: 'M3 5h18v4H3z', l: 'M3 5h18v15H3z M8 3v4 M16 3v4 M7 13h2 M11 13h2 M15 13h2 M7 16.5h2 M11 16.5h2' },
  monitorizacion: { r: 'M3 4h18v12H3z', l: 'M9 20h6 M12 16v4 M6 11.5l3-3 3 3 3.5-3.5 2.5 2.5' },
  almacen: { r: 'M3 7l9-4 9 4-9 4z', l: 'M3 7v10l9 4 9-4V7 M12 11v10' },
  inventario: { r: 'M4 13h7v7H4z M13 13h7v7h-7z M8.5 4h7v7h-7z', l: '' },
  datos: { r: 'M5 5.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5v13c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5z', l: 'M5 5.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5 M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5' },
  conector: { r: 'M7 8h10v5a5 5 0 0 1-10 0z', l: 'M9.5 8V3 M14.5 8V3 M12 18v4' },
  reloj: { r: 'M7 6h10v12H7z', l: `M9 6l.8-3.5h4.4L15 6 M9 18l.8 3.5h4.4L15 18 M12 9.5V12l1.8 1.2` },
  claude: { r: 'M10 10h4v4h-4z', l: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8' },
  todas: { r: 'M5 5h3v3H5z M10.5 5h3v3h-3z M16 5h3v3h-3z M5 10.5h3v3H5z M10.5 10.5h3v3h-3z M16 10.5h3v3h-3z M5 16h3v3H5z M10.5 16h3v3h-3z M16 16h3v3h-3z', l: '' },
};

const HEX = '32,3 59,18.5 59,48.5 32,64 5,48.5 5,18.5';
const escapar = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// El icono entero (hexágono + dibujo) en SVG. `clase` va al <svg> para que el
// CSS elija la variante (os-ico-oki, os-ico-claude…).
export function iconoHex(id: string, titulo = '', clase = ''): string {
  const d = DIBUJOS[id];
  const dentro = id === 'oki'
    ? '<text x="32" y="39.5" text-anchor="middle" class="os-ico-txt">OKI</text>'
    : d
      ? `<g transform="translate(16 17) scale(1.333)" class="os-ico-trazo"><path class="os-ico-r" d="${d.r}"/>${d.l ? `<path d="${d.l}"/>` : ''}</g>`
      : `<text x="32" y="40" text-anchor="middle" class="os-ico-txt os-ico-ini">${escapar((titulo.trim()[0] ?? '?').toUpperCase())}</text>`;
  return `<svg class="os-ico ${clase}" viewBox="0 0 64 66" aria-hidden="true" focusable="false"><polygon class="os-ico-hex" points="${HEX}"/>${dentro}</svg>`;
}
