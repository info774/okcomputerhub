// Los dos chips de abajo a la izquierda (paridad bloque 6; en la app, «↩
// Deshacer» y «Cambios sin enviar» de la barra): salen solo cuando hay algo.
//   · ↩ Deshacer: el historial de la sesión (core/deshacer.ts); Ctrl+Z deshace
//     lo último (shell/atajos.ts).
//   · ☁ N sin enviar: lo guardado sin red (core/cola.ts), con «Reintentar» y
//     «Descartar» para lo que el servidor rechazó. La cola sale sola al volver
//     la red, al entrar y cada minuto.
// Valen igual en el shell clásico y en el modo escritorio (van fijos).
import { registrarAcciones } from '../core/dispatcher';
import { resolver } from '../core/router';
import { esc, toast } from '../ui/dom';
import { historial, deshacer, bloqueadoPor, hayDeshacer } from '../core/deshacer';
import { operaciones, enviarCola, reintentar, descartar, contarPendientes, refrescar } from '../core/cola';

let _panel: 'cola' | 'deshacer' | null = null;
const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

export function pintarPendientes(raiz: HTMLElement) {
  document.getElementById('sis')?.remove();
  const caja = document.createElement('div');
  caja.id = 'sis';
  caja.className = 'sis';
  caja.innerHTML = '<div class="sis-panel" id="sis-panel" hidden></div><div class="sis-chips"><button type="button" class="sis-chip" id="sis-deshacer" data-action="sisDeshacer" hidden>↩ <span>Deshacer</span></button><button type="button" class="sis-chip" id="sis-cola" data-action="sisCola" hidden></button></div>';
  raiz.appendChild(caja);
  void refrescar();
  pintarChips();
}

function pintarChips() {
  const d = document.getElementById('sis-deshacer'), c = document.getElementById('sis-cola');
  if (!d || !c) return;
  const ops = operaciones(), pend = contarPendientes(), errores = ops.length - pend;
  d.hidden = !hayDeshacer();
  if (hayDeshacer()) d.title = `Deshacer: ${historial()[0].etiqueta} (Ctrl+Z)`;
  c.hidden = !ops.length;
  c.className = `sis-chip ${errores ? 'mal' : 'aviso'}`;
  c.innerHTML = `☁ <span>${pend ? `${pend} sin enviar` : ''}${pend && errores ? ' · ' : ''}${errores ? `${errores} con fallo` : ''}</span>`;
  c.title = navigator.onLine === false ? 'Sin conexión: se enviará solo al volver la red' : 'Cambios guardados en el móvil';
  if (_panel) pintarPanel();
}

function pintarPanel() {
  const p = document.getElementById('sis-panel');
  if (!p) return;
  if (_panel === 'deshacer') {
    const pila = historial();
    p.innerHTML = `<h4>Deshacer</h4>${pila.length ? `<p class="nota">Lo último que has guardado en esta sesión. Deshacer devuelve la ficha a como estaba; lo dado de alta se borra. Los fichajes se corrigen en Personas.</p>
      <ul>${pila.map((g, i) => { const ch = bloqueadoPor(g); const n = g.entradas.reduce((s, e) => s + e.filas.length, 0); return `<li><div><b>${esc(g.etiqueta)}</b><small class="nota">${hora(g.ts)}${n > 1 ? ` · ${n} cambios` : ''}${ch ? `<br>Antes deshaz «${esc(ch.etiqueta)}», que toca lo mismo` : ''}</small></div>
        <button type="button" class="btn ${i ? 'secundario' : ''}" data-action="sisDeshacerGrupo" data-p0="${g.id}" ${ch ? 'disabled' : ''}>Deshacer</button></li>`; }).join('')}</ul>` : '<p class="nota">Nada que deshacer.</p>'}`;
  } else if (_panel === 'cola') {
    const ops = operaciones();
    p.innerHTML = `<h4>Cambios sin enviar</h4><p class="nota">${navigator.onLine === false ? 'Sin conexión: se enviarán solos al volver la red.' : 'Guardados en el móvil; salen solos, en orden.'}</p>
      <ul>${ops.map(o => `<li class="${o.estado === 'error' ? 'mal' : ''}"><div><b>${esc(o.etiqueta)}</b><small class="nota">${hora(o.ts)}${o.ultimoError ? ` · ${esc(o.ultimoError.slice(0, 160))}` : ''}</small></div>
        ${o.estado === 'error' ? `<span class="acciones"><button type="button" class="btn secundario" data-action="sisReintentar" data-p0="${o.id}">Reintentar</button><button type="button" class="btn secundario" data-action="sisDescartar" data-p0="${o.id}">Descartar</button></span>` : ''}</li>`).join('') || '<li class="nota">Todo enviado.</li>'}</ul>
      ${ops.some(o => o.estado === 'pendiente') ? '<div class="acciones"><button type="button" class="btn" data-action="sisEnviar">Enviar ahora</button></div>' : ''}`;
  }
  p.hidden = !_panel;
}

function abrir(cual: 'cola' | 'deshacer') { _panel = _panel === cual ? null : cual; pintarPanel(); }

export async function deshacerConAviso(id?: number) {
  const r = await deshacer(id);
  toast(r.mensaje, r.ok ? 'info' : 'error');
  if (r.ok) { if (!hayDeshacer()) { _panel = null; pintarPanel(); } resolver(); }
}

async function enviar(manual = false) {
  const r = await enviarCola();
  if (r.enviadas) { toast(`☁ ${r.enviadas === 1 ? 'Enviado el cambio' : `Enviados ${r.enviadas} cambios`} guardado${r.enviadas === 1 ? '' : 's'} sin conexión`); resolver(); }
  if (r.fallidas) toast(`${r.fallidas} cambio${r.fallidas === 1 ? '' : 's'} no se pudo aplicar: míralo en «☁»`, 'error');
  if (manual && !r.enviadas && !r.fallidas && r.pendientes) toast('Sigue sin haber conexión', 'error');
}

document.addEventListener('hub:cola', pintarChips);
document.addEventListener('hub:deshacer', pintarChips);
window.addEventListener('online', () => { pintarChips(); void enviar(); });
window.addEventListener('offline', () => { pintarChips(); toast('Sin conexión: lo que guardes se queda en el móvil y se enviará solo'); });
setInterval(() => { if (contarPendientes()) void enviar(); }, 60_000);
/** Al entrar: lo que quedó en el móvil, fuera. */
export const enviarAlEntrar = () => { void refrescar().then(() => { if (contarPendientes()) void enviar(); }); };

registrarAcciones({
  sisDeshacer: () => abrir('deshacer'),
  sisCola: () => abrir('cola'),
  sisDeshacerGrupo: (id: string) => deshacerConAviso(Number(id)),
  async sisReintentar(id: string) { await reintentar(Number(id)); await enviar(true); },
  async sisDescartar(id: string) { if (confirm('¿Descartar este cambio? No se enviará.')) await descartar(Number(id)); },
  sisEnviar: () => enviar(true),
});
