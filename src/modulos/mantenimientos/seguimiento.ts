// Seguimiento comercial de mantenimientos (pestaña «Seguimiento» de la app):
// #/mantenimientos/seguimiento (kanban por estado; arrastrar cambia el
// estado), /seguimiento/nuevo y /seguimiento/<id> (formulario). Espejo
// `mant_seguimiento` (área `mantenimiento`). Prefijo de ids: mse-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { buscarClientes } from '../ventas/datos';
import { navPestanas } from './vista';
import { fechaCorta, diasHasta, sinAcentos } from './datos';

export const COLUMNAS: [string, string][] = [['por_contactar', 'Por contactar'], ['contactado', 'Contactado'], ['interesado', 'Interesado'],
  ['negociando', 'Negociando'], ['ganado', 'Ganado'], ['perdido', 'Perdido']];
interface Seg { id: string; cliente_id: string | null; local_id: string | null; contacto_id: string | null; estado: string; tipo_respuesta: string | null;
  notas: string | null; recordatorio_fecha: string | null; dias_recordatorio: number | null }

let _segs: Seg[] = [];
let _q = '';
let _arrastrado = '';
let _escribe = false;
let _id: string | null = null;
let _timerCli: number | undefined;

export async function pintarSeguimiento(el: HTMLElement, id?: string) {
  if (id) return pintarFormulario(el, id === 'nuevo' ? null : id);
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [ss, escribe] = await Promise.all([API.fetchAll<Seg>('mant_seguimiento', { select: '*', order: 'updated_at.desc' }), esDelHub('mant_seguimiento')]);
  if (ss.error) { el.innerHTML = `<p class="aviso mal">${esc(ss.error.message)}</p>`; return; }
  _segs = ss.data ?? []; _escribe = escribe;
  const ids = (k: keyof Seg) => [...new Set(_segs.map(s => s[k]).filter(Boolean))] as string[];
  const [cs, ls] = await Promise.all([
    ids('cliente_id').length ? API.get<{ id: string; nombre: string }[]>('clientes', { select: 'id,nombre', id: `in.(${ids('cliente_id').join(',')})` }) : Promise.resolve({ data: [] }),
    ids('local_id').length ? API.get<{ id: string; nombre: string }[]>('locales', { select: 'id,nombre', id: `in.(${ids('local_id').join(',')})` }) : Promise.resolve({ data: [] }),
  ]);
  const cli = new Map((cs.data ?? []).map(c => [c.id, c.nombre])), loc = new Map((ls.data ?? []).map(l => [l.id, l.nombre]));
  const q = sinAcentos(_q);
  const vistos = _segs.filter(s => !q || [cli.get(s.cliente_id ?? ''), loc.get(s.local_id ?? ''), s.notas, s.tipo_respuesta].some(x => sinAcentos(x).includes(q)));
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('El seguimiento comercial')}${navPestanas('seguimiento')}
    <div class="acciones mo-barra"><input id="mse-q" type="search" placeholder="Buscar cliente, sede o nota…" value="${esc(_q)}" data-on-input="mseBuscar:$value" aria-label="Buscar">
      ${escribe ? '<a class="btn" href="#/mantenimientos/seguimiento/nuevo">+ Seguimiento</a>' : ''}</div>
    <div class="pr-kanban mse-kanban">${COLUMNAS.map(([k, n]) => {
      const col = vistos.filter(s => s.estado === k);
      return `<section class="pr-columna" data-estado="${k}" ${escribe ? `data-on-dragover="mseSobre:$this" data-prevent="1" data-on-dragleave="mseFuera:$this" data-on-drop="mseSoltar:${k}"` : ''}>
        <header><h3>${esc(n)}</h3><span class="chip">${col.length}</span></header>
        <div class="pr-col-cuerpo">${col.map(s => {
          const d = diasHasta(s.recordatorio_fecha);
          return `<article class="pr-tarjeta" data-seg="${esc(s.id)}" ${escribe ? `draggable="true" data-on-dragstart="mseArrastrar:${s.id}"` : ''} data-action="mseAbrir" data-p0="${esc(s.id)}">
            <strong>${esc(loc.get(s.local_id ?? '') ?? cli.get(s.cliente_id ?? '') ?? 'Sin nombre')}</strong>
            ${s.local_id && s.cliente_id ? `<small class="nota">${esc(cli.get(s.cliente_id) ?? '')}</small>` : ''}
            ${s.notas ? `<small>${esc(s.notas.slice(0, 60))}${s.notas.length > 60 ? '…' : ''}</small>` : ''}
            ${s.tipo_respuesta ? `<small class="nota">${esc(s.tipo_respuesta)}</small>` : ''}
            ${s.recordatorio_fecha ? `<small class="${d != null && d < 0 ? 'g-mal' : 'nota'}">${ico('reloj')} ${esc(fechaCorta(s.recordatorio_fecha))}</small>` : ''}</article>`;
        }).join('') || '<p class="vacio col-vacia">—</p>'}</div></section>`;
    }).join('')}</div>`;
}

async function opciones(tabla: 'locales' | 'contactos', clienteId: string | null, elegida: string | null, vacio: string): Promise<string> {
  if (!clienteId) return `<option value="">${vacio}</option>`;
  const { data } = await API.get<{ id: string; nombre: string }[]>(tabla, { select: 'id,nombre', cliente_id: `eq.${clienteId}`, activo: 'neq.false', order: 'nombre' });
  return `<option value="">${vacio}</option>${(data ?? []).map(x => `<option value="${esc(x.id)}" ${x.id === elegida ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}`;
}

async function pintarFormulario(el: HTMLElement, id: string | null) {
  const [escribe, seg] = await Promise.all([esDelHub('mant_seguimiento'), id ? API.single<Seg>('mant_seguimiento', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null })]);
  const s = seg.data;
  if (id && !s) { el.innerHTML = '<p class="aviso mal">No existe ese seguimiento.</p><p><a href="#/mantenimientos/seguimiento">← Seguimiento</a></p>'; return; }
  _id = s?.id ?? null;
  const cli = s?.cliente_id ? (await API.single<{ id: string; nombre: string }>('clientes', { select: 'id,nombre', id: `eq.${s.cliente_id}` })).data : null;
  const [sedes, contactos] = await Promise.all([opciones('locales', s?.cliente_id ?? null, s?.local_id ?? null, '— Sin sede —'), opciones('contactos', s?.cliente_id ?? null, s?.contacto_id ?? null, '— Sin contacto —')]);
  el.innerHTML = `<p><a href="#/mantenimientos/seguimiento">← Seguimiento</a></p><h2>${s ? 'Editar seguimiento' : 'Nuevo seguimiento'}</h2>
    ${escribe ? '' : avisoSoloLectura('El seguimiento comercial')}
    <form class="tarjeta" id="mse-form" data-on-submit="mseGuardar" data-prevent="1">
      <label>Cliente <input id="mse-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli?.nombre ?? '')}" data-on-input="mseBuscarCliente:$value"></label>
      <input type="hidden" id="mse-cliente" value="${esc(cli?.id ?? '')}"><ul id="mse-cliente-res" class="resultados"></ul>
      <div class="in-campos"><label>Sede <select id="mse-sede">${sedes}</select></label><label>Contacto <select id="mse-contacto">${contactos}</select></label>
        <label>Estado <select id="mse-estado">${COLUMNAS.map(([k, n]) => `<option value="${k}" ${k === (s?.estado ?? 'por_contactar') ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <label>Respuesta <input id="mse-respuesta" value="${esc(s?.tipo_respuesta ?? '')}" placeholder="Le interesa, lo piensa, no contesta…"></label>
      <label>Notas <textarea id="mse-notas" rows="3">${esc(s?.notas ?? '')}</textarea></label>
      <div class="in-campos"><label>Recordar el <input id="mse-recordatorio" type="date" value="${esc(s?.recordatorio_fecha ?? '')}"></label>
        <label>Volver a recordar cada (días) <input id="mse-dias" type="number" min="1" value="${s?.dias_recordatorio ?? 30}"></label></div>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${s ? 'Guardar' : 'Crear'}</button>
        ${s && escribe ? '<button type="button" class="btn peligro" data-action="mseBorrar">Quitar</button>' : ''}
        <a class="btn secundario" href="#/mantenimientos/seguimiento">Cancelar</a></div></form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  mseBuscar(v: string) { _q = v; resolver(); window.setTimeout(() => { const f = document.getElementById('mse-q') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60); },
  mseAbrir(id: string) { ir('mantenimientos', 'seguimiento', id); },
  mseArrastrar(id: string) { _arrastrado = id; },
  mseSobre(col: HTMLElement) { col.classList.add('sobre'); },
  mseFuera(col: HTMLElement) { col.classList.remove('sobre'); },
  async mseSoltar(estado: string) {
    document.querySelectorAll('.mse-kanban .sobre').forEach(c => c.classList.remove('sobre'));
    const s = _segs.find(x => x.id === _arrastrado);
    _arrastrado = '';
    if (!s || s.estado === estado || !_escribe) return;
    const r = await API.patch('mant_seguimiento', { id: `eq.${s.id}` }, { estado });
    if (r.error) { toast(`No se pudo mover: ${r.error.message}`, 'error'); return; }
    resolver();
  },
  mseBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('mse-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('mse-cliente-res'); if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="mseElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}</button></li>`).join('');
    }, 250);
  },
  async mseElegirCliente(id: string, nombre: string) {
    (document.getElementById('mse-cliente') as HTMLInputElement).value = id;
    (document.getElementById('mse-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('mse-cliente-res'); if (ul) ul.innerHTML = '';
    const [s, c] = await Promise.all([opciones('locales', id, null, '— Sin sede —'), opciones('contactos', id, null, '— Sin contacto —')]);
    const ss = document.getElementById('mse-sede'); if (ss) ss.innerHTML = s;
    const cc = document.getElementById('mse-contacto'); if (cc) cc.innerHTML = c;
  },
  async mseGuardar() {
    const cuerpo = {
      cliente_id: val('mse-cliente') || null, local_id: val('mse-sede') || null, contacto_id: val('mse-contacto') || null, estado: val('mse-estado') || 'por_contactar',
      tipo_respuesta: val('mse-respuesta') || null, notas: val('mse-notas') || null, recordatorio_fecha: val('mse-recordatorio') || null,
      dias_recordatorio: Number(val('mse-dias')) || 30,
    };
    if (!cuerpo.cliente_id && !cuerpo.local_id) { toast('Elige el cliente o la sede', 'error'); return; }
    const r = _id ? await API.patch('mant_seguimiento', { id: `eq.${_id}` }, cuerpo) : await API.post('mant_seguimiento', cuerpo);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast('Guardado'); ir('mantenimientos', 'seguimiento');
  },
  async mseBorrar() {
    if (!_id || !confirm('¿Quitar este seguimiento?')) return;
    const r = await API.delete('mant_seguimiento', { id: `eq.${_id}` });
    if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
    toast('Quitado'); ir('mantenimientos', 'seguimiento');
  },
});
