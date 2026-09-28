// Paleta Ctrl+K con cuatro modos (Tab cambia de modo):
//   · Pantallas: filtra los módulos por título, grupo y explicación (lo de siempre).
//   · Datos: clientes, sedes y proyectos del hub por nombre; trabajos y
//     tickets del espejo (se abren en la app actual).
//   · Preguntar: manda la pregunta a Buscar (RAG sobre los documentos).
//   · Claude: elige un proyecto y abre su pestaña Claude para pedirle algo.
// Prefijo de ids: bus-.
import { esc } from '../ui/dom';
import { API } from '../core/api';
import { ir } from '../core/router';
import { visibles, hrefDe } from '../modulos/inicio';
import { APP_ACTUAL_URL } from '../core/config';

type Modo = 'pantallas' | 'datos' | 'preguntar' | 'claude';
const MODOS: { id: Modo; nombre: string; icono: string; placeholder: string }[] = [
  { id: 'pantallas', nombre: 'Pantallas', icono: '🔎', placeholder: '¿Qué pantalla?' },
  { id: 'datos', nombre: 'Datos', icono: '🗂', placeholder: 'Cliente, sede, proyecto, trabajo o ticket…' },
  { id: 'preguntar', nombre: 'Preguntar', icono: '📚', placeholder: 'Pregunta a los documentos, p. ej. «¿qué TPV tiene el Bar Pepe?»' },
  { id: 'claude', nombre: 'Pedir a Claude', icono: '✨', placeholder: '¿Sobre qué proyecto? (se abre su pestaña Claude)' },
];
let _modo: Modo = 'pantallas';
let _timer: number | undefined;
let _serie = 0;

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function abrirBuscador(modo: Modo = 'pantallas') {
  const dlg = document.getElementById('buscador') as HTMLDialogElement;
  const campo = document.getElementById('bus-campo') as HTMLInputElement;
  campo.value = '';
  ponerModo(modo);
  if (!dlg.open) dlg.showModal();
  campo.focus();
}

export function cerrarBuscador() {
  (document.getElementById('buscador') as HTMLDialogElement).close();
}

function ponerModo(modo: Modo) {
  _modo = modo;
  const campo = document.getElementById('bus-campo') as HTMLInputElement;
  campo.placeholder = MODOS.find(m => m.id === modo)!.placeholder;
  document.getElementById('bus-modos')!.innerHTML = MODOS.map(m => `
    <button role="tab" aria-selected="${m.id === modo}" class="bus-modo ${m.id === modo ? 'activo' : ''}" data-action="busModo" data-p0="${m.id}">
      <span aria-hidden="true">${m.icono}</span> ${esc(m.nombre)}</button>`).join('');
  void filtrarBuscador(campo.value);
}

export function busModo(modo: Modo) {
  ponerModo(modo);
  (document.getElementById('bus-campo') as HTMLInputElement).focus();
}

// Esc cierra; Tab pasa al modo siguiente (la paleta no tiene más sitios a los
// que ir con el tabulador que merezcan la pena).
export function buscadorTecla(ev: KeyboardEvent) {
  if (ev.key === 'Escape') { cerrarBuscador(); return; }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const i = MODOS.findIndex(m => m.id === _modo);
    busModo(MODOS[(i + (ev.shiftKey ? MODOS.length - 1 : 1)) % MODOS.length].id);
  }
}

const fila = (href: string, icono: string, texto: string, sub: string, externo = false, i = 0) =>
  `<li><a href="${esc(href)}" class="${i === 0 ? 'activo' : ''}"${externo ? ' target="_blank" rel="noopener"' : ''} data-action="cerrarBuscador">
    <span class="hex bus-ic" aria-hidden="true">${esc(icono)}</span> <span class="bus-texto">${esc(texto)}</span> <small>${esc(sub)}</small></a></li>`;

export function filtrarBuscador(q: string): void {
  const t = q.trim();
  const ul = document.getElementById('bus-resultados')!;
  clearTimeout(_timer);
  if (_modo === 'pantallas') {
    const n = normal(t);
    const lista = visibles().filter(m => !n || normal(`${m.titulo} ${m.grupo} ${m.explicacion}`).includes(n));
    ul.innerHTML = lista.map((m, i) => fila(hrefDe(m), m.icono, m.titulo, m.grupo, !!m.enlaceExterno, i)).join('')
      || '<li class="vacio">Nada con ese nombre.</li>';
    return;
  }
  if (_modo === 'preguntar') {
    ul.innerHTML = t
      ? `<li><a href="#/buscar/${encodeURIComponent(t)}" class="activo" data-action="cerrarBuscador"><span class="hex bus-ic" aria-hidden="true">📚</span> <span class="bus-texto">Preguntar «${esc(t)}»</span> <small>Buscar</small></a></li>`
      : '<li class="vacio">Escribe la pregunta y pulsa Enter: responde con lo que hay en la wiki, los proyectos y Drive.</li>';
    return;
  }
  // Datos y Claude consultan el hub: con un respiro, y solo la última búsqueda pinta.
  const serie = ++_serie;
  ul.innerHTML = '<li class="vacio">Buscando…</li>';
  _timer = window.setTimeout(async () => {
    const html = _modo === 'datos' ? await buscarDatos(t) : await buscarProyectos(t);
    if (serie === _serie) ul.innerHTML = html;
  }, t ? 250 : 0);
}

const like = (t: string) => `ilike.*${t.replace(/[%_*,()]/g, ' ').trim()}*`;

async function buscarDatos(t: string): Promise<string> {
  if (t.length < 2) return '<li class="vacio">Dos letras por lo menos. Un número busca por número de trabajo o ticket.</li>';
  const num = /^\d+$/.test(t);
  const [cl, lo, pr, tr, ti] = await Promise.all([
    API.get<any[]>('clientes', { select: 'id,nombre,telefono', nombre: like(t), activo: 'eq.true', order: 'nombre', limit: '5' }),
    API.get<any[]>('locales', { select: 'id,nombre,cliente_id,direccion', nombre: like(t), activo: 'neq.false', order: 'nombre', limit: '5' }),
    API.get<any[]>('proyectos', { select: 'id,numero,titulo,estado', ...(num ? { numero: `eq.${t}` } : { titulo: like(t) }), order: 'numero.desc', limit: '5' }),
    API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,estado', ...(num ? { numero: `eq.${t}` } : { or: `(titulo.${like(t)},descripcion.${like(t)})` }), order: 'numero.desc', limit: '5' }),
    API.get<any[]>('tickets', { select: 'id,numero,titulo,estado', ...(num ? { numero: `eq.${t}` } : { titulo: like(t) }), order: 'numero.desc', limit: '5' }),
  ]);
  const filas: string[] = [];
  for (const c of cl.data ?? []) filas.push(fila(`#/clientes/${c.id}`, '🤝', c.nombre, `Cliente${c.telefono ? ' · ' + c.telefono : ''}`, false, filas.length));
  for (const l of lo.data ?? []) filas.push(fila(l.cliente_id ? `#/clientes/${l.cliente_id}` : APP_ACTUAL_URL, '📍', l.nombre, `Sede${l.direccion ? ' · ' + l.direccion : ''}`, !l.cliente_id, filas.length));
  for (const p of pr.data ?? []) filas.push(fila(`#/proyectos/${p.numero}`, '🧭', `#${p.numero} ${p.titulo}`, `Proyecto · ${p.estado}`, false, filas.length));
  for (const w of tr.data ?? []) filas.push(fila(APP_ACTUAL_URL, '🛠', `#${w.numero ?? '?'} ${w.titulo || (w.descripcion ?? '').slice(0, 60)}`, `Trabajo · ${w.estado ?? ''} · app ↗`, true, filas.length));
  for (const k of ti.data ?? []) filas.push(fila(APP_ACTUAL_URL, '🎫', `#${k.numero ?? '?'} ${k.titulo ?? ''}`, `Ticket · ${k.estado ?? ''} · app ↗`, true, filas.length));
  const err = cl.error ?? lo.error ?? pr.error ?? tr.error ?? ti.error;
  return filas.join('') || `<li class="vacio">${err ? 'No se pudo buscar: ' + esc(err.message) : 'Nada con ese nombre.'}</li>`;
}

async function buscarProyectos(t: string): Promise<string> {
  const num = /^\d+$/.test(t);
  const { data, error } = await API.get<any[]>('proyectos', { select: 'id,numero,titulo,estado',
    ...(t ? (num ? { numero: `eq.${t}` } : { titulo: like(t) }) : {}), estado: 'neq.cerrado', order: 'numero.desc', limit: '12' });
  if (error) return `<li class="vacio">No se pudieron leer los proyectos: ${esc(error.message)}</li>`;
  const lista = (data ?? []).map((p, i) => fila(`#/proyectos/${p.numero}/claude`, '✨', `#${p.numero} ${p.titulo}`, `Pedir a Claude · ${p.estado}`, false, i));
  return lista.join('') || '<li class="vacio">Ningún proyecto abierto con ese nombre. Claude trabaja siempre sobre un proyecto.</li>';
}

// Enter abre el primero.
export function buscadorEnter() {
  const a = document.querySelector('#bus-resultados a') as HTMLAnchorElement | null;
  if (!a) return;
  cerrarBuscador();
  if (a.target === '_blank') { window.open(a.href, '_blank', 'noopener'); return; }
  const [id, ...params] = a.getAttribute('href')!.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  ir(id, ...params);
}

export function instalarAtajoBuscador() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBuscador(); }
  });
}
