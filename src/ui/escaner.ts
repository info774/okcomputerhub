// Escáner de códigos de barras (paridad bloque 8, tanda 4: openWdBarcodeScanner
// de la app). Con BarcodeDetector (Chrome de Android) lee por la cámara de
// atrás; si no lo hay, o la cámara no se deja, queda el campo para el lector
// de mano o para teclearlo. `abrirEscaner(fn)` llama a `fn(código)` una vez y
// se cierra. Prefijo de ids: esc-.
import { registrarAcciones } from '../core/dispatcher';
import { ico } from '../shell/linea';

type Detector = { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> };
const FORMATOS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'itf'];

let _fn: ((codigo: string) => void) | null = null;
let _stream: MediaStream | null = null;
let _intervalo = 0;

export const hayCamaraLectora = () => typeof (window as any).BarcodeDetector !== 'undefined';

function cerrar() {
  clearInterval(_intervalo); _intervalo = 0;
  _stream?.getTracks().forEach(t => t.stop()); _stream = null;
  document.getElementById('esc-capa')?.remove();
}

function leido(codigo: string) {
  const c = String(codigo ?? '').trim();
  if (!c) return;
  const fn = _fn; _fn = null;
  cerrar();
  fn?.(c);
}

export async function abrirEscaner(fn: (codigo: string) => void) {
  cerrar();
  _fn = fn;
  const camara = hayCamaraLectora();
  const capa = document.createElement('div');
  capa.id = 'esc-capa';
  capa.className = 'esc-capa';
  capa.setAttribute('role', 'dialog');
  capa.setAttribute('aria-label', 'Escanear código de barras');
  capa.innerHTML = `<div class="tarjeta esc-caja"><h3>${ico('camara')} Escanear código de barras</h3>
    ${camara ? `<div class="esc-video"><video id="esc-video" autoplay playsinline muted></video><div class="esc-marco"></div></div>
      <p class="nota">Apunta la cámara al código, o escríbelo:</p>` : '<p class="nota">Usa el lector de mano o escribe el código:</p>'}
    <form class="acciones" data-on-submit="escBuscar" data-prevent="1"><input id="esc-codigo" placeholder="Código de barras…" autocomplete="off" inputmode="numeric" aria-label="Código de barras">
      <button class="btn" type="submit">Buscar</button></form>
    <button type="button" class="btn secundario esc-cancelar" data-action="escCerrar">Cancelar</button></div>`;
  document.body.appendChild(capa);
  setTimeout(() => (document.getElementById('esc-codigo') as HTMLInputElement | null)?.focus(), 100);
  if (!camara) return;
  try {
    _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('esc-video') as HTMLVideoElement | null;
    if (!video) { cerrar(); return; }
    video.srcObject = _stream;
    const det: Detector = new (window as any).BarcodeDetector({ formats: FORMATOS });
    _intervalo = window.setInterval(async () => {
      if (!video.videoWidth) return;
      try { const r = await det.detect(video); if (r.length) leido(r[0].rawValue); } catch { /* el siguiente fotograma */ }
    }, 500);
  } catch { /* sin cámara: queda el campo */ }
}

registrarAcciones({
  escBuscar() { leido((document.getElementById('esc-codigo') as HTMLInputElement | null)?.value ?? ''); },
  escCerrar() { _fn = null; cerrar(); },
});
