// Esqueletos de carga (idea de Bitrix24, 2026-10-04): mientras llegan los
// datos se pinta la FORMA de lo que va a salir (tabla, kanban, ficha) en
// gris, en vez de un «Cargando…» suelto. Sin degradados (marca): late en
// opacidad y se queda quieto con prefers-reduced-motion.
// Lleva la clase `cargando` para que los arneses que esperan a que se vaya
// sigan valiendo, y el texto para los lectores de pantalla.
export type FormaEsqueleto = 'tabla' | 'kanban' | 'ficha' | 'lineas';

const barra = (ancho: number) => `<span class="esq-barra" style="width:${ancho}%"></span>`;

export function esqueleto(forma: FormaEsqueleto = 'lineas', n = 0): string {
  let dentro: string;
  if (forma === 'tabla') {
    const filas = n || 6;
    dentro = `<div class="esq-tabla">${Array.from({ length: filas }, (_, i) =>
      `<div class="esq-fila">${barra(28 + (i * 13) % 20)}${barra(22)}${barra(16 + (i * 7) % 12)}${barra(12)}</div>`).join('')}</div>`;
  } else if (forma === 'kanban') {
    const cols = n || 4;
    dentro = `<div class="esq-kanban">${Array.from({ length: cols }, (_, c) =>
      `<div class="esq-col">${barra(60)}${Array.from({ length: 3 - (c % 2) }, () => '<span class="esq-tarjeta"></span>').join('')}</div>`).join('')}</div>`;
  } else if (forma === 'ficha') {
    dentro = `${barra(45)}<div class="esq-etapas">${Array.from({ length: 5 }, () => '<span class="esq-etapa"></span>').join('')}</div>
      <div class="esq-ficha"><div class="esq-bloque">${[80, 60, 70, 50, 65].map(barra).join('')}</div>
      <div class="esq-bloque">${[40, 90, 75, 85].map(barra).join('')}</div></div>`;
  } else {
    dentro = [70, 90, 55].slice(0, n || 3).map(barra).join('');
  }
  return `<div class="cargando esq esq-${forma}" role="status" aria-live="polite"><span class="solo-lector">Cargando…</span>${dentro}</div>`;
}
