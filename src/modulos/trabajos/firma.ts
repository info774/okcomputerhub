// Firma del cliente en un trabajo (la «firma pantalla completa» de trabajos.js
// de la app): un lienzo que ocupa la pantalla, se firma con el dedo, el lápiz o
// el ratón y se guarda en `trabajos.firma_cliente` como PNG en data URL, igual
// que la guarda la app (así el espejo la trae y la lleva en los dos sentidos).
// Solo con el área `trabajos` cortada: antes, la ficha no enseña el botón y la
// RLS no lo dejaría pasar. El trazo va con eventos de puntero enganchados al
// lienzo (sin `on*=` en el HTML). Prefijo de ids: fc-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { toast } from '../../ui/dom';

let _trabajoId = '';
let _ctx: CanvasRenderingContext2D | null = null;
let _hayTrazo = false;

export function abrirFirma(trabajoId: string) {
  _trabajoId = trabajoId;
  document.getElementById('fc-capa')?.remove();
  const capa = document.createElement('div');
  capa.id = 'fc-capa';
  capa.className = 'fc-capa';
  capa.setAttribute('role', 'dialog');
  capa.setAttribute('aria-label', 'Firma del cliente');
  capa.innerHTML = `<div class="fc-barra"><strong>Firma del cliente</strong><span class="nota fc-gira">Mejor con el móvil en horizontal</span>
      <span class="fc-botones"><button type="button" class="btn secundario" data-action="fcBorrar">Borrar</button>
      <button type="button" class="btn secundario" data-action="fcCerrar">Cancelar</button>
      <button type="button" class="btn" data-action="fcGuardar">Guardar firma</button></span></div>
    <div class="fc-zona"><canvas id="fc-lienzo" aria-label="Zona de firma"></canvas><p class="fc-ayuda" id="fc-ayuda">Firme aquí</p></div>`;
  document.body.appendChild(capa);
  prepararLienzo();
}

function prepararLienzo() {
  const lienzo = document.getElementById('fc-lienzo') as HTMLCanvasElement | null;
  if (!lienzo) return;
  const dpr = window.devicePixelRatio || 1;
  const r = lienzo.getBoundingClientRect();
  lienzo.width = Math.max(1, Math.round(r.width * dpr));
  lienzo.height = Math.max(1, Math.round(r.height * dpr));
  _ctx = lienzo.getContext('2d');
  if (!_ctx) return;
  _ctx.scale(dpr, dpr);
  // Trazo oscuro sobre blanco aunque el hub esté en tema oscuro: es un papel.
  _ctx.strokeStyle = '#172c22';
  _ctx.lineWidth = 2.5;
  _ctx.lineCap = 'round';
  _ctx.lineJoin = 'round';
  _hayTrazo = false;
  let dibujando = false;
  const punto = (e: PointerEvent) => { const b = lienzo.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  lienzo.addEventListener('pointerdown', e => {
    e.preventDefault();
    lienzo.setPointerCapture(e.pointerId);
    dibujando = true;
    const p = punto(e);
    _ctx?.beginPath(); _ctx?.moveTo(p.x, p.y);
    document.getElementById('fc-ayuda')?.setAttribute('hidden', '');
  });
  lienzo.addEventListener('pointermove', e => {
    if (!dibujando || !_ctx) return;
    e.preventDefault();
    const p = punto(e);
    _ctx.lineTo(p.x, p.y); _ctx.stroke();
    _hayTrazo = true;
  });
  const soltar = () => { dibujando = false; };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
}

function cerrar() { document.getElementById('fc-capa')?.remove(); _ctx = null; }

registrarAcciones({
  fcBorrar() {
    const lienzo = document.getElementById('fc-lienzo') as HTMLCanvasElement | null;
    if (lienzo && _ctx) _ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    _hayTrazo = false;
    document.getElementById('fc-ayuda')?.removeAttribute('hidden');
  },
  fcCerrar() { cerrar(); },
  async fcGuardar() {
    const lienzo = document.getElementById('fc-lienzo') as HTMLCanvasElement | null;
    if (!lienzo || !_hayTrazo) { toast('El cliente tiene que firmar primero', 'error'); return; }
    const r = await API.patch('trabajos', { id: `eq.${_trabajoId}` }, { firma_cliente: lienzo.toDataURL('image/png') });
    if (r.error) { toast(`No se pudo guardar la firma: ${r.error.message}`, 'error'); return; }
    cerrar();
    toast('Firma guardada');
    resolver();
  },
});
