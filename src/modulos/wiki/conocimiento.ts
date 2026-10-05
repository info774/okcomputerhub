// Wiki → Base de conocimiento (paridad bloque 8, tanda 4: conocimiento.js de
// la app). Los artículos de la app (enlaces a un PDF o vídeo de Drive o a
// YouTube) por categoría, con buscador; se abren en su enlace. Espejo
// `hub.conocimiento` (área `conocimiento`): se ve ya; alta y edición se
// encienden con el corte del área (eliminar, solo admin). Lo nuevo se escribe
// en la wiki; esto es lo que la app ya tenía.
//   #/wiki/conocimiento, #/wiki/conocimiento/nuevo, #/wiki/conocimiento/<id>
// Prefijo de ids: kc-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esc, toast } from '../../ui/dom';
import { ico, type IconoLinea } from '../../shell/linea';

interface Articulo { id: string; titulo: string; categoria: string | null; tipo: string | null; descripcion: string | null; url: string | null; palabras_clave: string | null }
const CATEGORIAS = ['TPV', 'Cámaras', 'Alarmas', 'Red', 'Procedimientos'];
const TIPOS: [string, string, IconoLinea][] = [['pdf_drive', 'PDF de Drive', 'documento'], ['video_drive', 'Vídeo de Drive', 'video'], ['youtube', 'YouTube', 'play']];
const urlSegura = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : '');

let _cat = '';
let _q = '';
let _todos: Articulo[] = [];

function lista(): string {
  const q = _q.toLowerCase();
  const vis = _todos.filter(a => (!_cat || a.categoria === _cat) && (!q || a.titulo.toLowerCase().includes(q)
    || (a.descripcion ?? '').toLowerCase().includes(q) || (a.palabras_clave ?? '').toLowerCase().includes(q)));
  if (!vis.length) return '<p class="vacio">Sin artículos.</p>';
  return `<ul class="kc-lista">${vis.map(a => {
    const t = TIPOS.find(x => x[0] === a.tipo);
    const url = urlSegura(a.url);
    return `<li class="tarjeta"><span class="kc-ico">${ico(t?.[2] ?? 'documento')}</span>
      <div><strong>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(a.titulo)} ${ico('externo')}</a>` : esc(a.titulo)}</strong>
        <br><small class="nota">${esc([a.categoria, t?.[1], a.descripcion?.slice(0, 120)].filter(Boolean).join(' · '))}</small></div>
      <a class="btn secundario" href="#/wiki/conocimiento/${esc(a.id)}" aria-label="Ficha de ${esc(a.titulo)}">${ico('editar')}</a></li>`;
  }).join('')}</ul>`;
}

async function vistaLista(): Promise<string> {
  const [r, escribe] = await Promise.all([API.get<Articulo[]>('conocimiento', { select: '*', order: 'categoria,titulo' }), esDelHub('conocimiento')]);
  _todos = r.data ?? [];
  return `<nav class="wk-migas" aria-label="Ruta"><a href="#/wiki">Wiki</a> › Base de conocimiento</nav>
    <div class="tarjeta-cab"><h2>${ico('libro')} Base de conocimiento</h2>${escribe ? `<a class="btn" href="#/wiki/conocimiento/nuevo">${ico('mas')} Nuevo artículo</a>` : ''}</div>
    ${escribe ? '' : avisoSoloLectura('La base de conocimiento')}
    <p class="nota">Los manuales y vídeos que la app guardaba como enlaces (${_todos.length} artículo${_todos.length === 1 ? '' : 's'}). Lo nuevo, mejor como página de la wiki.</p>
    <div class="acciones pr-barra"><div class="segmentado">${['', ...CATEGORIAS].map(c => `<button type="button" class="${c === _cat ? 'activo' : ''}" data-action="kcFiltro" data-p0="${esc(c)}">${c || 'Todas'}</button>`).join('')}</div>
      <input id="kc-q" type="search" placeholder="Buscar en la base de conocimiento…" value="${esc(_q)}" data-on-input="kcBuscar:$value" aria-label="Buscar en la base de conocimiento"></div>
    <div id="kc-cuerpo">${lista()}</div>`;
}

async function vistaFicha(id: string | null): Promise<string> {
  const [escribe, r] = await Promise.all([esDelHub('conocimiento'), id ? API.single<Articulo>('conocimiento', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null })]);
  const a = r.data as Articulo | null;
  if (id && !a) return '<p class="aviso mal">No existe ese artículo.</p><p><a href="#/wiki/conocimiento">← Base de conocimiento</a></p>';
  return `<nav class="wk-migas" aria-label="Ruta"><a href="#/wiki">Wiki</a> › <a href="#/wiki/conocimiento">Base de conocimiento</a></nav>
    <h2>${a ? esc(a.titulo) : 'Nuevo artículo'}</h2>${escribe ? '' : avisoSoloLectura('La base de conocimiento')}
    <form class="tarjeta" id="kc-form" data-on-submit="kcGuardar" data-prevent="1" data-id="${esc(a?.id ?? '')}"><fieldset class="in-campos" ${escribe ? '' : 'disabled'}>
      <label>Título <input id="kc-titulo" required maxlength="200" value="${esc(a?.titulo ?? '')}"></label>
      <label>Enlace <input id="kc-url" type="url" required placeholder="https://drive.google.com/…" value="${esc(a?.url ?? '')}"></label>
      <label>Categoría <select id="kc-categoria">${CATEGORIAS.map(c => `<option ${c === (a?.categoria ?? 'TPV') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Tipo <select id="kc-tipo">${TIPOS.map(([k, t]) => `<option value="${k}" ${k === (a?.tipo ?? 'pdf_drive') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="ancho">Descripción <textarea id="kc-descripcion" rows="3">${esc(a?.descripcion ?? '')}</textarea></label>
      <label class="ancho">Palabras clave <input id="kc-palabras" placeholder="separadas por comas" value="${esc(a?.palabras_clave ?? '')}"></label></fieldset>
      ${escribe ? `<div class="acciones"><button class="btn" type="submit">${a ? 'Guardar' : 'Crear artículo'}</button>${a && esAdmin() ? '<button type="button" class="btn peligro" data-action="kcEliminar">Eliminar</button>' : ''}</div>` : ''}
      ${urlSegura(a?.url ?? null) ? `<p><a href="${esc(urlSegura(a!.url))}" target="_blank" rel="noopener noreferrer">Abrir el enlace ${ico('externo')}</a></p>` : ''}</form>`;
}

/** El cuerpo de #/wiki/conocimiento[/nuevo|/<id>] (lo pinta el marco de la wiki). */
export async function vistaConocimiento(param?: string): Promise<string> {
  if (param === 'nuevo') return vistaFicha(null);
  if (param) return vistaFicha(param);
  return vistaLista();
}

const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();
registrarAcciones({
  kcFiltro(c: string) { _cat = c; resolver(); },
  kcBuscar(q: string) { _q = q; const c = document.getElementById('kc-cuerpo'); if (c) c.innerHTML = lista(); },
  async kcGuardar() {
    const id = (document.getElementById('kc-form') as HTMLFormElement | null)?.dataset.id ?? '';
    const titulo = val('kc-titulo'), url = val('kc-url');
    if (!titulo || !url) { toast('Título y enlace son obligatorios', 'error'); return; }
    if (!/^https:\/\//i.test(url)) { toast('El enlace tiene que empezar por https://', 'error'); return; }
    const cuerpo = { titulo, url, categoria: val('kc-categoria'), tipo: val('kc-tipo'), descripcion: val('kc-descripcion') || null, palabras_clave: val('kc-palabras') || null };
    const r = id ? await API.patch('conocimiento', { id: `eq.${id}` }, cuerpo) : await API.post('conocimiento', { id: crypto.randomUUID(), ...cuerpo });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast('Artículo guardado');
    ir('wiki', 'conocimiento');
  },
  async kcEliminar() {
    const id = (document.getElementById('kc-form') as HTMLFormElement | null)?.dataset.id;
    if (!id || !confirm('¿Eliminar este artículo de la base de conocimiento?')) return;
    const r = await API.delete('conocimiento', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Artículo eliminado');
    ir('wiki', 'conocimiento');
  },
});
