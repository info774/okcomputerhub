// Buscar (fase 5): #/buscar. Una pregunta en lenguaje normal → busca en la
// wiki, la carpeta de Drive indexada y el conocimiento/tablero de la app, y
// Claude contesta citando [n] (documentos-preguntar). Debajo, el estado del
// índice y, para admins, la carpeta de Drive. Prefijo de ids: bu-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace } from '../../ui/dom';
import { markdown } from '../../ui/markdown';
import { ico, type IconoLinea } from '../../shell/linea';

interface Fuente { n: number; titulo: string; url: string | null; fuente: string; texto: string }
interface Respuesta { respuesta: string | null; fuentes: Fuente[]; con_claude: boolean }
const CUENTA = 'firebase-adminsdk-fbsvc@okcomputerclaude.iam.gserviceaccount.com';
const ORIGEN: Record<string, { ico: IconoLinea; texto: string }> = { wiki: { ico: 'libro', texto: 'Wiki' }, drive: { ico: 'carpeta', texto: 'Drive' }, app: { ico: 'carpeta', texto: 'App' } };
const origen = (f: string) => ORIGEN[f] ? `${ico(ORIGEN[f].ico)} ${esc(ORIGEN[f].texto)}` : esc(f);
let _ultima: { pregunta: string; r: Respuesta } | null = null;

// [n] → enlace a la fuente n de la lista.
const citas = (html: string) => html.replace(/\[(\d{1,2})\]/g, '<a href="#bu-fuente-$1" class="bu-cita">[$1]</a>');

function pintarRespuesta(): string {
  if (!_ultima) return '';
  const { r } = _ultima;
  return `<section class="tarjeta bu-respuesta">${r.respuesta ? `<div class="md">${citas(markdown(r.respuesta))}</div>`
      : `<p class="nota">${r.fuentes.length ? 'Sin redacción (falta la clave de Claude): estos son los trozos más parecidos.' : ''}</p>`}
    ${r.fuentes.length ? `<h3>Fuentes</h3><ol class="bu-fuentes">${r.fuentes.map(f => `<li id="bu-fuente-${f.n}">
      <strong>${f.url ? `<a href="${esc(f.url)}"${f.url.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>${esc(f.titulo)}</a>` : esc(f.titulo)}</strong>
      <span class="chip">${origen(f.fuente)}</span><p class="nota">${esc(f.texto.slice(0, 300))}${f.texto.length > 300 ? '…' : ''}</p></li>`).join('')}</ol>` : ''}</section>`;
}

async function pintarEstado(): Promise<string> {
  const r = await llamarFuncion<any>('documentos-indexar', { accion: 'estado' });
  if (r.error || !r.data) return `<p class="nota">No se pudo leer el estado del índice: ${esc(r.error ?? '')}</p>`;
  const e = r.data;
  const filas = Object.entries((e.resumen ?? {}) as Record<string, Record<string, number>>).map(([f, est]) =>
    `<tr><td>${origen(f)}</td><td>${est.indexado ?? 0}</td><td>${est.pendiente ?? 0}</td><td>${(est.error ?? 0) + (est.omitido ?? 0)}</td></tr>`).join('');
  const drive = e.drive ?? {};
  return `<section class="tarjeta"><h3>Qué hay en el índice</h3>
    <table class="tabla"><thead><tr><th>Fuente</th><th>Indexados</th><th>Pendientes</th><th>Error / no legibles</th></tr></thead><tbody>${filas || '<tr><td colspan="4" class="vacio">Vacío.</td></tr>'}</tbody></table>
    <p class="nota">${e.fragmentos ?? 0} trozos. Se actualiza cada 10 minutos; Drive, cada 6 horas.</p>
    ${(e.errores ?? []).length ? `<details><summary>Documentos con error</summary><ul>${e.errores.map((x: any) => `<li>${esc(x.titulo)}: <small>${esc(x.error)}</small></li>`).join('')}</ul></details>` : ''}
    ${esAdmin() ? `<h3>Carpeta de Google Drive</h3>
      <p class="nota">Comparte la carpeta (solo lectura, «Lector») con <code>${CUENTA}</code> y pega aquí su enlace.
        ${drive.ultima_ok ? `Última lectura ${esc(hace(drive.ultima_ok))} (${drive.filas ?? 0} ficheros).` : ''}${drive.ultimo_error ? ` <span class="mal">${esc(drive.ultimo_error)}</span>` : ''}</p>
      <form class="acciones" data-on-submit="buCarpeta" data-prevent="1">
        <input id="bu-carpeta" placeholder="https://drive.google.com/drive/folders/…" value="${esc(drive.carpeta ?? '')}" aria-label="Carpeta de Drive">
        <button class="btn secundario" type="submit">Guardar</button>
        ${drive.carpeta ? '<button class="btn secundario" type="button" data-action="buDrive">Leer Drive ahora</button>' : ''}</form>` : ''}</section>`;
}

// #/buscar/<pregunta> (desde la paleta Ctrl+K) llega con la pregunta puesta y la lanza.
async function pintar(el: HTMLElement, params: string[] = []) {
  const pregunta = params[0]?.trim() ?? '';
  el.innerHTML = `<form class="tarjeta bu-caja" data-on-submit="buPreguntar" data-prevent="1">
      <label for="bu-q">¿Qué quieres saber?</label>
      <div class="acciones"><input id="bu-q" maxlength="500" placeholder="p. ej. ¿Qué TPV tiene el Bar Pepe y dónde está la clave del router?" value="${esc(pregunta || _ultima?.pregunta || '')}" required>
        <button class="btn" type="submit">Preguntar</button></div>
    </form>
    <div id="bu-respuesta">${pintarRespuesta()}</div>
    <div id="bu-estado"><p class="cargando">Cargando el índice…</p></div>`;
  if (pregunta && _ultima?.pregunta !== pregunta) (el.querySelector('form') as HTMLFormElement | null)?.requestSubmit();
  const est = document.getElementById('bu-estado');
  if (est) est.innerHTML = await pintarEstado();
}

registrarAcciones({
  async buPreguntar() {
    const pregunta = (document.getElementById('bu-q') as HTMLInputElement).value.trim();
    const caja = document.getElementById('bu-respuesta');
    if (!pregunta || !caja) return;
    caja.innerHTML = '<p class="cargando">Buscando…</p>';
    const r = await llamarFuncion<Respuesta>('documentos-preguntar', { pregunta }, 60000);
    if (r.error || !r.data) { caja.innerHTML = `<p class="aviso mal">${esc(r.error ?? 'Sin respuesta')}</p>`; return; }
    _ultima = { pregunta, r: r.data };
    caja.innerHTML = pintarRespuesta();
  },
  async buCarpeta() {
    const v = (document.getElementById('bu-carpeta') as HTMLInputElement).value.trim();
    const id = v.match(/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? v.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1] ?? (/^[A-Za-z0-9_-]{10,}$/.test(v) ? v : '');
    if (v && !id) { toast('No reconozco ese enlace de carpeta de Drive', 'error'); return; }
    const r = await API.patch('config', { clave: 'eq.drive_carpeta' }, { valor: id || null });
    toast(r.error ? `No se pudo guardar: ${r.error.message}` : 'Carpeta guardada: se lee en la próxima pasada', r.error ? 'error' : 'info');
    resolver();
  },
  async buDrive() {
    toast('Leyendo Drive e indexando (puede tardar un par de minutos)…');
    const r = await llamarFuncion<any>('documentos-indexar', { accion: 'drive' }, 150000);
    toast(r.error ? `Falló: ${r.error}` : `Drive: ${r.data?.drive?.ficheros ?? 0} ficheros; indexados ${r.data?.indexados ?? 0}, quedan ${r.data?.quedan ?? 0}`, r.error ? 'error' : 'info');
    resolver();
  },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('documentos', { estado: 'eq.indexado' });
  return n == null ? null : { valor: n, subtitulo: 'documentos en el buscador', tono: 'neutro' };
}

export const moduloBuscar: Modulo = {
  id: 'buscar',
  titulo: 'Buscar',
  grupo: 'Organizar',
  icono: '🔍',
  explicacion: 'Pregunta como se lo preguntarías a un compañero. Busca en la wiki, en la carpeta de Drive de la empresa y en el conocimiento y el tablero de la app, y contesta diciendo de qué documento sale cada dato.',
  pintar,
  contador,
};
