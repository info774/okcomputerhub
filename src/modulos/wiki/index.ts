// Wiki (fase 5, sustituye Notion): #/wiki, #/wiki/<id>, #/wiki/<id>/editar,
// #/wiki/<id>/historial y #/wiki/nueva[/<padre>]. Páginas en árbol, markdown
// SEGURO (src/ui/markdown.ts), historial de versiones (lo guarda la base) y
// enlace a un proyecto. Al guardar se reindexa la página en el buscador.
// Prefijo de ids: wk-.
import type { Modulo, Contador } from '../../core/modulo';
import { ico } from '../../shell/linea';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { markdown } from '../../ui/markdown';

interface Pagina { id: string; titulo: string; contenido?: string; padre_id: string | null; orden: number; icono: string | null;
  proyecto_id: string | null; archivada: boolean; version: number; updated_at: string; creado_por: string | null; actualizado_por: string | null }

let _arbol: Pagina[] = [];
let _actual: Pagina | null = null;
let _busqueda = '';
let _verArchivadas = false;

async function cargarArbol() {
  const { data } = await API.get<Pagina[]>('paginas', { select: 'id,titulo,padre_id,orden,icono,archivada,updated_at', order: 'orden,titulo',
    ...(_verArchivadas ? {} : { archivada: 'eq.false' }) });
  _arbol = data ?? [];
}

function arbol(padre: string | null = null, nivel = 0): string {
  const hijas = _arbol.filter(p => p.padre_id === padre || (padre === null && p.padre_id && !_arbol.some(x => x.id === p.padre_id)));
  if (!hijas.length) return '';
  return `<ul class="wk-arbol" ${nivel ? '' : 'role="tree"'}>${hijas.map(p => `<li role="treeitem">
    <a href="#/wiki/${esc(p.id)}" class="${_actual?.id === p.id ? 'activo' : ''} ${p.archivada ? 'in-pausado' : ''}">${p.icono != null ? esc(p.icono) : ico('documento')} ${esc(p.titulo)}</a>
    ${nivel < 6 ? arbol(p.id, nivel + 1) : ''}</li>`).join('')}</ul>`;
}

function migas(p: Pagina): string {
  const cadena: Pagina[] = [];
  let x = _arbol.find(a => a.id === p.padre_id);
  while (x && cadena.length < 10) { cadena.unshift(x); x = _arbol.find(a => a.id === x!.padre_id); }
  return `<nav class="wk-migas" aria-label="Ruta"><a href="#/wiki">Wiki</a>${cadena.map(c => ` › <a href="#/wiki/${esc(c.id)}">${esc(c.titulo)}</a>`).join('')}</nav>`;
}

function marco(cuerpo: string): string {
  return `<div class="wk-marco">
    <aside class="wk-lateral tarjeta">
      <form data-on-submit="wkBuscar" data-prevent="1"><input id="wk-q" type="search" placeholder="Buscar en la wiki…" value="${esc(_busqueda)}" aria-label="Buscar en la wiki"></form>
      <div class="acciones"><button class="btn" data-action="wkNueva">+ Página</button>
        <label class="check"><input type="checkbox" ${_verArchivadas ? 'checked' : ''} data-on-change="wkArchivadas:$checked"> Archivadas</label></div>
      ${arbol() || '<p class="vacio">Todavía no hay páginas.</p>'}
    </aside>
    <div class="wk-principal">${cuerpo}</div></div>`;
}

async function vistaInicio(): Promise<string> {
  if (_busqueda) {
    const { data } = await API.get<Pagina[]>('paginas', { select: 'id,titulo,updated_at,contenido', archivada: 'eq.false', tsv: `wfts(spanish).${_busqueda}`, limit: '30' });
    return `<h2>Resultados para «${esc(_busqueda)}»</h2>${(data ?? []).map(p => `<article class="tarjeta fila-clic" data-action="wkAbrir" data-p0="${esc(p.id)}">
      <h3>${esc(p.titulo)}</h3><p class="nota">${esc((p.contenido ?? '').slice(0, 200))}…</p></article>`).join('') || '<p class="vacio">Nada. Prueba en <a href="#/buscar">Buscar</a>, que entiende preguntas.</p>'}`;
  }
  const recientes = [..._arbol].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);
  return `<h2>Lo último</h2>${recientes.length ? `<ul class="di-ultimo">${recientes.map(p => `<li><small class="nota">${esc(hace(p.updated_at))}</small>
    <a href="#/wiki/${esc(p.id)}">${esc(p.titulo)}</a></li>`).join('')}</ul>` : '<p class="vacio">Crea la primera página con «+ Página».</p>'}
    <p class="nota">Para preguntar («¿qué router tiene el Hotel Playa?») usa <a href="#/buscar">Buscar</a>: mira también en Drive y en el conocimiento de la app.</p>`;
}

async function vistaPagina(id: string): Promise<string> {
  const { data: p } = await API.single<Pagina>('paginas', { select: '*', id: `eq.${id}` });
  if (!p) return '<p class="aviso mal">No existe esa página.</p>';
  _actual = p;
  await equipo();
  const hijas = _arbol.filter(x => x.padre_id === p.id);
  const proyecto = p.proyecto_id ? (await API.single<any>('proyectos', { select: 'numero,titulo', id: `eq.${p.proyecto_id}` })).data : null;
  const puedeBorrar = esAdmin() || p.creado_por === usuario()?.id;
  return `${migas(p)}
    <div class="tarjeta-cab"><h2>${p.icono != null ? esc(p.icono) : ico('documento')} ${esc(p.titulo)}</h2>
      <div class="acciones"><a class="btn" href="#/wiki/${esc(p.id)}/editar">Editar</a>
        <button class="btn secundario" data-action="wkNueva" data-p0="${esc(p.id)}">+ Subpágina</button>
        <a class="btn secundario" href="#/wiki/${esc(p.id)}/historial">Historial (${p.version - 1})</a></div></div>
    <p class="nota">Versión ${p.version} · cambiada ${esc(hace(p.updated_at))}${p.actualizado_por ? ` por ${esc(nombreDe(p.actualizado_por))}` : ''}
      ${proyecto ? ` · proyecto <a href="#/proyectos/${proyecto.numero}">#${proyecto.numero} ${esc(proyecto.titulo)}</a>` : ''}${p.archivada ? ' · <span class="chip">Archivada</span>' : ''}</p>
    <article class="tarjeta md wk-contenido">${markdown(p.contenido) || '<p class="vacio">Página vacía.</p>'}</article>
    ${hijas.length ? `<h3>Subpáginas</h3><ul>${hijas.map(h => `<li><a href="#/wiki/${esc(h.id)}">${esc(h.titulo)}</a></li>`).join('')}</ul>` : ''}
    <details class="tarjeta"><summary>Mover, archivar…</summary>
      <label>Dentro de <select id="wk-padre" data-on-change="wkMover:$value"><option value="">— Arriba del todo —</option>
        ${_arbol.filter(x => x.id !== p.id).map(x => `<option value="${esc(x.id)}" ${x.id === p.padre_id ? 'selected' : ''}>${esc(x.titulo)}</option>`).join('')}</select></label>
      <div class="acciones"><button class="btn secundario" data-action="wkArchivar" data-p0="${p.archivada ? '0' : '1'}">${p.archivada ? 'Desarchivar' : 'Archivar'}</button>
        ${puedeBorrar ? '<button class="btn peligro" data-action="wkBorrar">Borrar</button>' : ''}</div></details>`;
}

async function vistaEditor(id: string | null, padre?: string): Promise<string> {
  let p: Partial<Pagina> = { titulo: '', contenido: '', padre_id: padre ?? null };
  if (id) {
    const { data } = await API.single<Pagina>('paginas', { select: '*', id: `eq.${id}` });
    if (!data) return '<p class="aviso mal">No existe esa página.</p>';
    p = data; _actual = data;
  } else _actual = null;
  const { data: proys } = await API.get<any[]>('proyectos', { select: 'id,numero,titulo', estado: 'neq.cerrado', order: 'numero.desc' });
  return `<form class="wk-editor" data-on-submit="wkGuardar" data-prevent="1">
    <div class="in-campos"><label>Icono <input id="wk-icono" maxlength="4" value="${esc(p.icono ?? '')}"></label>
      <label>Proyecto <select id="wk-proyecto"><option value="">—</option>${(proys ?? []).map(x => `<option value="${esc(x.id)}" ${x.id === p.proyecto_id ? 'selected' : ''}>#${x.numero} ${esc(x.titulo)}</option>`).join('')}</select></label></div>
    <label>Título <input id="wk-titulo" required maxlength="200" value="${esc(p.titulo ?? '')}"></label>
    <input type="hidden" id="wk-padre-nuevo" value="${esc(p.padre_id ?? '')}">
    <div class="wk-dos"><label>Contenido (markdown: # títulos, **negrita**, - listas, [enlace](https://…), [otra página](#/wiki/…))
      <textarea id="wk-contenido" rows="22" data-on-input="wkPrevia:$value">${esc(p.contenido ?? '')}</textarea></label>
      <div><span class="nota">Vista previa</span><article id="wk-previa" class="tarjeta md">${markdown(p.contenido ?? '')}</article></div></div>
    <div class="acciones"><button class="btn" type="submit">Guardar</button>
      <a class="btn secundario" href="${id ? `#/wiki/${esc(id)}` : '#/wiki'}">Cancelar</a></div></form>`;
}

async function vistaHistorial(id: string): Promise<string> {
  const [{ data: p }, { data: vs }] = await Promise.all([
    API.single<Pagina>('paginas', { select: '*', id: `eq.${id}` }),
    API.get<any[]>('paginas_versiones', { select: '*', pagina_id: `eq.${id}`, order: 'version.desc' }),
  ]);
  if (!p) return '<p class="aviso mal">No existe esa página.</p>';
  _actual = p;
  await equipo();
  return `${migas(p)}<h2>Historial de «${esc(p.titulo)}»</h2>
    <p class="nota">Versión actual: ${p.version}. Cada vez que alguien cambia el título o el contenido, lo anterior se guarda aquí.</p>
    ${(vs ?? []).map(v => `<details class="tarjeta"><summary>Versión ${v.version} · ${esc(fechaHora(v.created_at))}${v.autor ? ` · ${esc(nombreDe(v.autor))}` : ''} · ${esc(v.titulo)}</summary>
      <article class="md">${markdown(v.contenido)}</article>
      <div class="acciones"><button class="btn secundario" data-action="wkRestaurar" data-p0="${v.version}">Restaurar esta versión</button></div></details>`).join('')
      || '<p class="vacio">Sin versiones anteriores.</p>'}`;
}

async function pintar(el: HTMLElement, params: string[]) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  await cargarArbol();
  const [a, b] = params;
  let cuerpo: string;
  if (a === 'nueva') cuerpo = await vistaEditor(null, b);
  else if (a && b === 'editar') cuerpo = await vistaEditor(a);
  else if (a && b === 'historial') cuerpo = await vistaHistorial(a);
  else if (a) cuerpo = await vistaPagina(a);
  else { _actual = null; cuerpo = await vistaInicio(); }
  el.innerHTML = marco(cuerpo);
}

const reindexar = (id: string) => { void llamarFuncion('documentos-indexar', { accion: 'pagina', id }); };

registrarAcciones({
  wkAbrir(id: string) { ir('wiki', id); },
  wkNueva(padre?: string) { ir('wiki', 'nueva', ...(padre ? [padre] : [])); },
  wkBuscar() { _busqueda = (document.getElementById('wk-q') as HTMLInputElement).value.replace(/[*,()%\\]/g, ' ').trim(); ir('wiki'); },
  wkArchivadas(v: boolean) { _verArchivadas = v; resolver(); },
  wkPrevia(v: string) { const c = document.getElementById('wk-previa'); if (c) c.innerHTML = markdown(v); },
  async wkGuardar() {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    const datos = { titulo: v('wk-titulo').trim(), contenido: v('wk-contenido'), icono: v('wk-icono').trim() || null, proyecto_id: v('wk-proyecto') || null };
    if (!datos.titulo) return;
    if (_actual) {
      const r = await API.patch('paginas', { id: `eq.${_actual.id}` }, datos);
      if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
      reindexar(_actual.id); toast('Guardada'); ir('wiki', _actual.id);
    } else {
      const r = await API.post<Pagina[]>('paginas', { ...datos, padre_id: v('wk-padre-nuevo') || null });
      if (r.error || !r.data?.[0]) { toast(`No se pudo crear: ${r.error?.message}`, 'error'); return; }
      reindexar(r.data[0].id); toast('Página creada'); ir('wiki', r.data[0].id);
    }
  },
  async wkMover(padre: string) {
    if (!_actual) return;
    const r = await API.patch('paginas', { id: `eq.${_actual.id}` }, { padre_id: padre || null });
    if (r.error) toast(`No se pudo mover: ${r.error.message}`, 'error'); else { toast('Movida'); resolver(); }
  },
  async wkArchivar(v: string) {
    if (!_actual) return;
    const r = await API.patch('paginas', { id: `eq.${_actual.id}` }, { archivada: v === '1' });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast(v === '1' ? 'Archivada' : 'Desarchivada'); resolver(); }
  },
  async wkBorrar() {
    if (!_actual || !confirm(`¿Borrar «${_actual.titulo}» y su historial? Las subpáginas quedan sueltas. No se puede deshacer.`)) return;
    const r = await API.delete('paginas', { id: `eq.${_actual.id}` });
    if (r.error) toast(`No se pudo borrar: ${r.error.message}`, 'error'); else ir('wiki');
  },
  async wkRestaurar(version: string) {
    if (!_actual) return;
    const { data: v } = await API.single<any>('paginas_versiones', { select: 'titulo,contenido', pagina_id: `eq.${_actual.id}`, version: `eq.${version}` });
    if (!v || !confirm(`¿Volver a la versión ${version}? La actual queda en el historial.`)) return;
    const r = await API.patch('paginas', { id: `eq.${_actual.id}` }, { titulo: v.titulo, contenido: v.contenido });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { reindexar(_actual.id); toast('Restaurada'); ir('wiki', _actual.id); }
  },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('paginas', { archivada: 'eq.false' });
  return n == null ? null : { valor: n, subtitulo: 'páginas en la wiki', tono: 'neutro' };
}

export const moduloWiki: Modulo = {
  id: 'wiki',
  titulo: 'Wiki',
  grupo: 'Organizar',
  icono: '📚',
  explicacion: 'Lo que sabe la empresa, escrito: procedimientos, instalaciones de clientes, claves de dónde encontrar cosas. Páginas dentro de páginas, con historial de cada cambio. Todo lo que se escribe aquí lo encuentra también el buscador.',
  pintar,
  contador,
};
