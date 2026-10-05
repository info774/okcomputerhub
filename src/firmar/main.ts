// Firmar un documento (fase 10): página pública, sin sesión. La autoriza el
// token del enlace; la huella del texto que se lee viaja con la firma y la
// base la compara (si el documento cambió, no se firma). Firma con el dedo o
// el ratón en un lienzo → PNG.
import '../portal/portal.css';
import { FUNCIONES_URL, SUPABASE_ANON_KEY } from '../core/config';
import { esc, fechaHora } from '../ui/dom';
import { markdown } from '../ui/markdown';
import { ico } from '../shell/linea';

const raiz = document.getElementById('firmar')!;
const token = new URLSearchParams(location.search).get('t') ?? '';
const llamar = async (cuerpo: Record<string, unknown>) => {
  const r = await fetch(`${FUNCIONES_URL}/firma`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ token, ...cuerpo }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'No se pudo');
  return j;
};

let trazos = 0;
function lienzo(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const ajustar = () => { const r = c.getBoundingClientRect(); c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height); trazos = 0; };
  ajustar();
  let dibujando = false;
  const punto = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', e => { dibujando = true; c.setPointerCapture(e.pointerId); const [x, y] = punto(e); ctx.beginPath(); ctx.moveTo(x, y); });
  c.addEventListener('pointermove', e => { if (!dibujando) return; const [x, y] = punto(e); ctx.lineTo(x, y); ctx.stroke(); trazos++; });
  c.addEventListener('pointerup', () => { dibujando = false; });
  return { borrar: ajustar };
}

async function arrancar() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) { raiz.innerHTML = '<main><p class="po-mal">Este enlace no está completo.</p></main>'; return; }
  let d: any;
  try { d = await llamar({ accion: 'ver' }); } catch (e) { raiz.innerHTML = `<main><div class="po-tarjeta"><p class="po-mal">${esc((e as Error).message)}</p></div></main>`; return; }
  const cab = `<header class="po-cab"><span class="po-marca">Ok Computer Tenerife</span></header>`;
  if (d.estado !== 'pendiente' || d.caducado) {
    raiz.innerHTML = `${cab}<main><div class="po-tarjeta"><h1>${esc(d.titulo)}</h1><p>${d.estado === 'firmado' ? `${ico('hecho')} Firmado el ${esc(fechaHora(d.firmado_at))}. ¡Gracias!`
      : d.estado === 'anulado' ? 'Este documento se ha anulado.' : 'El enlace ha caducado: pídenos otro.'}</p></div></main>`;
    return;
  }
  raiz.innerHTML = `${cab}<main>
    <article class="po-tarjeta"><h1>${esc(d.titulo)}</h1><div class="md">${markdown(d.contenido)}</div>
      <p class="po-nota">Huella del documento: <code>${esc(d.contenido_hash)}</code></p></article>
    <form class="po-tarjeta" id="fr-form"><h2>Firma</h2>
      <label>Nombre y apellidos <input id="fr-nombre" required minlength="3" autocomplete="name" value="${esc(d.firmante_nombre ?? '')}"></label>
      <label>DNI / NIE (opcional) <input id="fr-dni" maxlength="20" autocomplete="off"></label>
      <p class="po-nota">Firma aquí con el dedo o el ratón:</p>
      <canvas id="fr-lienzo" class="fr-lienzo" aria-label="Espacio para firmar"></canvas>
      <div class="po-acciones"><button type="button" class="po-btn sec" id="fr-borrar">Borrar firma</button></div>
      <label class="fr-acepto"><input type="checkbox" id="fr-acepto" required> He leído el documento y estoy de acuerdo.</label>
      <button class="po-btn" type="submit">Firmar</button><p id="fr-aviso" role="status" class="po-mal"></p></form></main>`;
  const c = document.getElementById('fr-lienzo') as HTMLCanvasElement;
  const l = lienzo(c);
  document.getElementById('fr-borrar')!.addEventListener('click', () => l.borrar());
  document.getElementById('fr-form')!.addEventListener('submit', async e => {
    e.preventDefault();
    const aviso = document.getElementById('fr-aviso')!;
    if (trazos < 5) { aviso.textContent = 'Falta la firma'; return; }
    const btn = (e.target as HTMLFormElement).querySelector('button[type=submit]') as HTMLButtonElement;
    btn.disabled = true;
    try {
      const r = await llamar({ accion: 'firmar', hash: d.contenido_hash, nombre: (document.getElementById('fr-nombre') as HTMLInputElement).value,
        dni: (document.getElementById('fr-dni') as HTMLInputElement).value, firma: c.toDataURL('image/png') });
      raiz.innerHTML = `${cab}<main><div class="po-tarjeta"><h1>${ico('hecho')} Firmado</h1><p>${esc(d.titulo)}</p><p class="po-nota">Firmado el ${esc(fechaHora(r.firmado_at))}. Te enviaremos una copia. ¡Gracias!</p></div></main>`;
    } catch (err) { aviso.textContent = (err as Error).message; btn.disabled = false; }
  });
}
arrancar();
