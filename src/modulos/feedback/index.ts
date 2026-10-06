// Feedback (paridad bloque 6, modules/feedback.js + report-to-claude de la
// app): cualquiera cuenta un fallo, una mejora o una idea del hub, y el hub
// adjunta solo el contexto (pantalla de antes, versión desplegada, entorno y
// los últimos errores de JavaScript, core/errores.ts). Quien no es admin ve lo
// suyo; el admin lo ve todo, lo gestiona y lo «Pasa a Claude»: queda en
// estado `claude` y el trabajador de Claude lo toma por el conector MCP
// (feedback_pendientes/_tomar/_terminar, docs/CLAUDE_TRABAJADOR.md), lo
// arregla y lo cierra con lo hecho. Sin issues de GitHub ni token en el
// navegador (decisión de Fran). Prefijo de ids: fb-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { usuario, esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { modulos, resolver } from '../../core/router';
import { ultimosErrores, rutaAnterior } from '../../core/errores';
import { buildActual } from '../../shell/version';
import { alternarDictado, puedeDictar } from '../../ui/dictado';
import { markdown } from '../../ui/markdown';
import { esc, toast } from '../../ui/dom';
import { ico, type IconoLinea } from '../../shell/linea';

interface Feedback {
  id: string; numero: number; created_at: string; tipo: string; descripcion: string; seccion: string | null; ruta: string | null;
  estado: string; autor_nombre: string | null; autor_id: string | null; contexto: Record<string, any>; notas: string | null;
  pasada_at: string | null; terminada_at: string | null; resultado: string | null;
}

const TIPOS: Record<string, string> = { bug: 'Fallo', mejora: 'Mejora', idea: 'Idea' };
const ICO_TIPO: Record<string, IconoLinea> = { bug: 'atencion', mejora: 'chispa', idea: 'idea' };
const ESTADOS: Record<string, [string, string]> = {
  nueva: ['Nueva', 'aviso'], claude: ['Para Claude', ''], en_curso: ['Claude trabajando', ''], hecha: ['Hecha', 'bien'], descartada: ['Descartada', ''],
};
const FILTROS: [string, string][] = [['abiertas', 'Abiertas'], ['claude', 'Con Claude'], ['hecha', 'Hechas'], ['todas', 'Todas']];
let _filtro = 'abiertas';

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const fecha = (s: string) => new Date(s).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const seccionDe = (ruta: string) => ruta.replace(/^#\/?/, '').split('/')[0] || 'inicio';

function entorno() {
  const pwa = matchMedia('(display-mode: standalone)').matches;
  return `${pwa ? 'PWA instalada' : 'Navegador'} · ${innerWidth}×${innerHeight}${matchMedia('(pointer: coarse)').matches ? ' · táctil' : ''}`;
}

function tarjeta(f: Feedback, admin: boolean) {
  const [et, tono] = ESTADOS[f.estado] ?? [f.estado, ''];
  const errores = (f.contexto?.errores as any[] | undefined) ?? [];
  return `<article class="tarjeta fb-item" data-estado="${esc(f.estado)}">
    <header class="fb-cab"><b>#${f.numero}</b> <span class="chip">${ICO_TIPO[f.tipo] ? ico(ICO_TIPO[f.tipo]) + ' ' : ''}${TIPOS[f.tipo] ?? esc(f.tipo)}</span> <span class="chip ${tono}">${esc(et)}</span>
      <small class="nota">${esc(f.autor_nombre ?? '')} · ${fecha(f.created_at)}${f.seccion ? ` · ${esc(f.seccion)}` : ''}</small></header>
    <div class="md">${markdown(f.descripcion)}</div>
    ${admin ? `<details class="fb-ctx"><summary>Contexto${errores.length ? ` · ${errores.length} error${errores.length === 1 ? '' : 'es'} de JavaScript` : ''}</summary>
      <p class="nota">Ruta ${esc(f.ruta ?? '—')} · versión ${esc(f.contexto?.version ?? '—')} · ${esc(f.contexto?.entorno ?? '')}</p>
      ${errores.length ? `<pre>${esc(errores.map(e => `${e.ts} ${e.ruta ?? ''}\n  ${e.mensaje}${e.origen ? `\n  ${e.origen}` : ''}`).join('\n'))}</pre>` : ''}</details>` : ''}
    ${f.resultado ? `<div class="fb-resultado"><h4>Lo que hizo Claude${f.terminada_at ? ` · ${fecha(f.terminada_at)}` : ''}</h4><div class="md">${markdown(f.resultado)}</div></div>` : ''}
    ${admin && ['nueva', 'claude'].includes(f.estado) ? `<label class="fb-notas">Notas para Claude <textarea id="fb-notas-${esc(f.id)}" rows="2" placeholder="Opcional: por dónde mirar, qué esperas…">${esc(f.notas ?? '')}</textarea></label>` : ''}
    ${admin ? `<div class="acciones">
      ${f.estado === 'nueva' ? `<button class="btn" data-action="fbClaude" data-p0="${esc(f.id)}">${ico('robot')} Pasar a Claude</button>` : ''}
      ${f.estado === 'claude' ? `<button class="btn secundario" data-action="fbEstado" data-p0="${esc(f.id)}" data-p1="nueva">Quitársela a Claude</button>` : ''}
      ${['nueva', 'claude', 'en_curso'].includes(f.estado) ? `<button class="btn secundario" data-action="fbEstado" data-p0="${esc(f.id)}" data-p1="hecha">Marcar hecha</button>
        <button class="btn secundario" data-action="fbEstado" data-p0="${esc(f.id)}" data-p1="descartada">Descartar</button>` : `<button class="btn secundario" data-action="fbEstado" data-p0="${esc(f.id)}" data-p1="nueva">Reabrir</button>`}
      <button class="btn peligro" data-action="fbBorrar" data-p0="${esc(f.id)}">Borrar</button></div>` : ''}
  </article>`;
}

async function pintarLista() {
  const cont = document.getElementById('fb-lista');
  if (!cont) return;
  const admin = esAdmin();
  const q: Record<string, string> = { select: '*', order: 'created_at.desc', limit: '200' };
  if (_filtro === 'abiertas') q.estado = 'in.(nueva,claude,en_curso)';
  else if (_filtro === 'claude') q.estado = 'in.(claude,en_curso)';
  else if (_filtro === 'hecha') q.estado = 'eq.hecha';
  const { data, error } = await API.get<Feedback[]>('feedback', q);
  if (error) { cont.innerHTML = `<p class="aviso">No se pudo leer: ${esc(error.message)}</p>`; return; }
  const filas = Array.isArray(data) ? data : [];
  cont.innerHTML = filas.map(f => tarjeta(f, admin)).join('') || `<p class="vacio">${_filtro === 'abiertas' ? 'Nada abierto.' : 'Nada por aquí.'}</p>`;
  document.querySelectorAll<HTMLButtonElement>('.fb-filtros button').forEach(b => b.classList.toggle('activo', b.dataset.p0 === _filtro));
}

async function pintar(el: HTMLElement) {
  const antes = rutaAnterior();
  const sec = antes ? seccionDe(antes) : '';
  const pantallas = modulos().filter(m => !m.enlaceExterno && m.id !== 'feedback');
  el.innerHTML = `
    <form class="tarjeta" id="fb-form" data-on-submit="fbEnviar" data-prevent="1"><h2>Cuéntalo</h2>
      <div class="in-campos">
        <label>Qué es <select id="fb-tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
        <label>Dónde <select id="fb-seccion"><option value="">(en general)</option>${pantallas.map(m => `<option value="${esc(m.id)}" ${m.id === sec ? 'selected' : ''}>${esc(m.titulo)}</option>`).join('')}</select></label>
      </div>
      <label>Qué pasa o qué te gustaría <textarea id="fb-desc" rows="5" required maxlength="8000" placeholder="Qué hacías, qué esperabas y qué salió. Si es una idea, para qué te serviría."></textarea></label>
      <p class="nota">Se adjunta solo: la pantalla (${esc(antes || '—')}), la versión del hub, el tipo de dispositivo y los últimos errores que haya habido.</p>
      <div class="acciones"><button class="btn" type="submit">Enviar</button>
        ${puedeDictar() ? `<button type="button" class="btn secundario" id="fb-dictar" data-action="fbDictar" aria-pressed="false">${ico('micro')} Dictar</button>` : ''}</div>
    </form>
    <section class="fb-zona"><div class="acciones"><h2>${esAdmin() ? 'Lo que ha contado el equipo' : 'Lo que has contado'}</h2>
      <div class="segmentado fb-filtros" role="tablist">${FILTROS.map(([k, t]) => `<button type="button" data-action="fbFiltro" data-p0="${k}" class="${k === _filtro ? 'activo' : ''}">${t}</button>`).join('')}</div></div>
      <div id="fb-lista"><p class="cargando">Cargando…</p></div></section>`;
  el.dataset.ruta = antes;
  await pintarLista();
}

async function cambiar(id: string, cambios: Record<string, unknown>, ok: string) {
  const r = await API.patch('feedback', { id: `eq.${id}` }, cambios);
  if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
  toast(ok);
  await pintarLista();
}

registrarAcciones({
  async fbEnviar() {
    const descripcion = val('fb-desc');
    if (descripcion.length < 3) { toast('Cuéntalo con un poco más de detalle', 'error'); return; }
    const ruta = (document.getElementById('fb-form')?.closest('[data-ruta]') as HTMLElement | null)?.dataset.ruta ?? rutaAnterior();
    const r = await API.post<{ numero: number }[]>('feedback', {
      tipo: val('fb-tipo') || 'bug', descripcion, seccion: val('fb-seccion') || null, ruta: ruta || null,
      contexto: { version: buildActual() ?? null, entorno: entorno(), navegador: navigator.userAgent.slice(0, 200), errores: ultimosErrores(), usuario: usuario()?.nombre ?? null },
    });
    if (r.error) { toast(`No se pudo enviar: ${r.error.message}`, 'error'); return; }
    toast(r.data?.[0]?.numero ? `Gracias: queda como #${r.data[0].numero}` : 'Gracias: apuntado');
    (document.getElementById('fb-desc') as HTMLTextAreaElement).value = '';
    await pintarLista();
  },
  fbDictar() { void alternarDictado(document.getElementById('fb-dictar'), 'fb-desc'); },
  async fbFiltro(f: string) { _filtro = f; await pintarLista(); },
  async fbClaude(id: string) {
    await cambiar(id, { estado: 'claude', notas: val(`fb-notas-${id}`) || null }, 'Pasada a Claude: el trabajador la recoge en su próxima pasada (cada hora)');
  },
  async fbEstado(id: string, estado: string) {
    const notas = document.getElementById(`fb-notas-${id}`) ? { notas: val(`fb-notas-${id}`) || null } : {};
    await cambiar(id, { estado, ...notas }, `«${ESTADOS[estado]?.[0] ?? estado}»`);
  },
  async fbBorrar(id: string) {
    if (!confirm('¿Borrar este feedback? No se puede deshacer.')) return;
    const r = await API.delete('feedback', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo borrar: ${r.error.message}`, 'error'); return; }
    toast('Borrado');
    resolver();
  },
});

async function contador(): Promise<Contador | null> {
  const admin = esAdmin();
  const n = await API.contar('feedback', admin ? { estado: 'eq.nueva' } : { estado: 'in.(nueva,claude,en_curso)', autor_id: `eq.${usuario()?.id}` });
  if (n == null) return null;
  return admin ? { valor: n, subtitulo: n === 1 ? 'nueva por revisar' : 'nuevas por revisar', tono: n ? 'aviso' : 'neutro' }
    : { valor: n, subtitulo: n === 1 ? 'tuya abierta' : 'tuyas abiertas' };
}

export const moduloFeedback: Modulo = {
  id: 'feedback',
  titulo: 'Feedback',
  grupo: 'Sistema',
  icono: '💬',
  explicacion: 'Cuenta un fallo, una mejora o una idea del hub: se adjunta solo dónde estabas, la versión y los últimos errores. El administrador lo revisa y puede pasárselo a Claude, que lo arregla y deja aquí lo que hizo.',
  pintar,
  contador,
};
