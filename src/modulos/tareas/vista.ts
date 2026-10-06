// Vista de Tareas (ver index.ts). Solo lectura mientras el área sea de la app.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, hace } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { enApp } from '../ventas/datos';
import { esMio } from '../direccion';
import { botonChatFicha } from '../../ui/chat-ficha';

interface Tarea {
  id: string; numero: number | null; titulo: string; descripcion: string | null; notas: string | null; estado: string; prioridad: string | null;
  fecha_vencimiento: string | null; hora_inicio: string | null; hora_fin: string | null; tecnico_id: string | null; tipo: string | null;
  cliente_id: string | null; local_id: string | null; contacto_id: string | null; trabajo_id: string | null; ticket_id: string | null;
  oportunidad_id: string | null; recurrencia: string | null; recurrencia_cada: number | null; created_at: string | null; duracion_teorica: number | null;
}

const COLS = 'id,numero,titulo,descripcion,notas,estado,prioridad,fecha_vencimiento,hora_inicio,hora_fin,tecnico_id,tipo,cliente_id,local_id,contacto_id,trabajo_id,ticket_id,oportunidad_id,recurrencia,recurrencia_cada,created_at,duracion_teorica';
const ESTADOS: Record<string, string> = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', archivada: 'Archivada' };
const TONO_ESTADO: Record<string, string> = { pendiente: '', en_progreso: 'aviso', completada: 'bien', archivada: '' };
const PRIO = { urgente: 0, alta: 1, media: 2, baja: 3 } as Record<string, number>;
const FILTROS: [string, string][] = [['pendientes', 'Pendientes'], ['hoy', 'Hoy'], ['vencidas', 'Vencidas'], ['alta', 'Alta prioridad'],
  ['en_progreso', 'En progreso'], ['', 'Todas'], ['archivada', 'Archivadas']];

let _lista: Tarea[] = [];
let _listaAt = 0;
let _listaArch = false;
let _clientes = new Map<string, string>();
let _q = '';
let _filtro = 'pendientes';
let _persona = '';      // '' todas · '__mias' · '__sin' · un nombre
let _vista: 'lista' | 'kanban' = (() => { try { return localStorage.getItem('hub_tareas_vista') === 'kanban' ? 'kanban' : 'lista'; } catch { return 'lista'; } })();
let _actual: Tarea | null = null;

const hoy = () => new Date().toLocaleDateString('sv-SE');
const abierta = (t: Tarea) => t.estado !== 'completada' && t.estado !== 'archivada';
const vencida = (t: Tarea) => !!t.fecha_vencimiento && t.fecha_vencimiento < hoy() && abierta(t);
const fecha = (t: Tarea) => t.fecha_vencimiento
  ? `<span class="${vencida(t) ? 'g-mal' : ''}">${esc(new Date(`${t.fecha_vencimiento}T12:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }))}${t.hora_inicio ? ` ${esc(t.hora_inicio.slice(0, 5))}` : ''}</span>` : '';
const chipEstado = (e: string) => `<span class="chip ${TONO_ESTADO[e] ?? ''}">${esc(ESTADOS[e] ?? e)}</span>`;
const chipPrio = (p: string | null) => p === 'alta' || p === 'urgente' ? `<span class="chip ${p === 'urgente' ? 'mal' : 'aviso'}">${esc(p)}</span>` : '';

// ── Lista ───────────────────────────────────────────────────────────────────
async function cargar() {
  const arch = _filtro === 'archivada';
  if (_lista.length && _listaArch === arch && Date.now() - _listaAt < 5 * 60_000) return null;
  const [ts, cs] = await Promise.all([
    API.fetchAll<Tarea>('tareas', { select: COLS, estado: arch ? 'eq.archivada' : 'neq.archivada', order: 'fecha_vencimiento.nullslast,created_at.desc' }),
    _clientes.size ? Promise.resolve(null) : API.fetchAll<{ id: string; nombre: string }>('clientes', { select: 'id,nombre' }),
  ]);
  if (cs && !cs.error) _clientes = new Map((cs.data ?? []).map(c => [c.id, c.nombre]));
  if (ts.error) return ts.error;
  _lista = ts.data ?? []; _listaAt = Date.now(); _listaArch = arch;
  return null;
}

function filtradas(): Tarea[] {
  const q = _q.toLowerCase();
  return _lista.filter(t => {
    switch (_filtro) {
      case 'pendientes': if (!abierta(t)) return false; break;
      case 'hoy': if (t.fecha_vencimiento !== hoy()) return false; break;
      case 'vencidas': if (!vencida(t)) return false; break;
      case 'alta': if (t.prioridad !== 'alta' && t.prioridad !== 'urgente') return false; break;
      case 'en_progreso': if (t.estado !== 'en_progreso') return false; break;
    }
    if (_persona === '__mias' && !esMio(t.tecnico_id)) return false;
    if (_persona === '__sin' && t.tecnico_id) return false;
    if (_persona && !_persona.startsWith('__') && t.tecnico_id !== _persona) return false;
    return !q || [t.titulo, t.descripcion, t.notas, t.tecnico_id, _clientes.get(t.cliente_id ?? ''), t.numero != null ? `#${t.numero}` : '']
      .some(x => (x ?? '').toLowerCase().includes(q));
  }).sort((a, b) => (a.fecha_vencimiento ?? '9999').localeCompare(b.fecha_vencimiento ?? '9999') || (PRIO[a.prioridad ?? 'media'] ?? 2) - (PRIO[b.prioridad ?? 'media'] ?? 2));
}

function tarjeta(t: Tarea): string {
  return `<article class="pr-tarjeta prio-${esc(t.prioridad ?? 'media')} fila-clic" data-action="taAbrir" data-p0="${esc(t.id)}">
    <div class="pr-tarjeta-cab">${t.numero != null ? `<span>#${t.numero}</span>` : ''}${chipPrio(t.prioridad)}${fecha(t)}</div>
    <h4>${esc(t.titulo)}</h4>
    <div class="pr-tarjeta-pie">${t.tecnico_id ? `<span>${ico('persona')} ${esc(t.tecnico_id)}</span>` : '<span class="chip aviso">Sin asignar</span>'}${t.cliente_id && _clientes.get(t.cliente_id) ? `<span>${esc(_clientes.get(t.cliente_id))}</span>` : ''}</div></article>`;
}

async function pintarLista(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [error, delHub] = await Promise.all([cargar(), esDelHub('tareas')]);
  if (error && !_lista.length) { el.innerHTML = `<p class="aviso mal">No se pudieron leer las tareas: ${esc(error.message)}</p>`; return; }
  const personas = [...new Set(_lista.map(t => t.tecnico_id).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const lista = filtradas();
  const cuerpo = _vista === 'kanban'
    ? `<div class="pr-kanban tres" id="ta-kanban">${['pendiente', 'en_progreso', 'completada'].map(e => {
        const col = lista.filter(t => t.estado === e);
        return `<section class="pr-columna"><header><h3>${esc(ESTADOS[e])}</h3><span class="chip">${col.length}</span></header>
          <div class="pr-col-cuerpo">${col.slice(0, 100).map(tarjeta).join('') || '<p class="nota">—</p>'}</div></section>`;
      }).join('')}</div>`
    : `<div class="tarjeta mo-scroll"><table class="tabla" id="ta-tabla"><thead><tr><th>Tarea</th><th>Estado</th><th>Vence</th><th>Quién</th><th>Cliente</th></tr></thead>
      <tbody>${lista.slice(0, 200).map(t => `<tr class="fila-clic" data-action="taAbrir" data-p0="${esc(t.id)}">
        <td>${t.numero != null ? `<small class="nota">#${t.numero}</small> ` : ''}<strong>${esc(t.titulo)}</strong> ${chipPrio(t.prioridad)}${t.recurrencia && t.recurrencia !== 'ninguna' ? ` <span title="Se repite" role="img" aria-label="Se repite">${ico('repetir')}</span>` : ''}</td>
        <td>${chipEstado(t.estado)}</td><td>${fecha(t)}</td>
        <td>${t.tecnico_id ? esc(t.tecnico_id) : '<span class="chip aviso">Sin asignar</span>'}</td>
        <td>${esc(_clientes.get(t.cliente_id ?? '') ?? '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Ninguna tarea con ese filtro.</td></tr>'}</tbody></table></div>`;
  el.innerHTML = `${delHub ? '' : avisoSoloLectura('Tareas')}
    <div class="acciones mo-barra">
      <input id="ta-filtro" type="search" placeholder="Buscar por título, número, persona o cliente…" value="${esc(_q)}" data-on-input="taFiltrar:$value" aria-label="Buscar tarea">
      <select id="ta-persona" data-on-change="taPersona:$value" aria-label="Persona">
        <option value="">Todo el equipo</option><option value="__mias" ${_persona === '__mias' ? 'selected' : ''}>Mis tareas</option><option value="__sin" ${_persona === '__sin' ? 'selected' : ''}>Sin asignar</option>
        ${personas.map(p => `<option ${p === _persona ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <div class="segmentado" role="tablist">${[['lista', 'Lista'], ['kanban', 'Tablero']].map(([k, n]) =>
        `<button role="tab" aria-selected="${_vista === k}" class="${_vista === k ? 'activo' : ''}" data-action="taVista" data-p0="${k}">${n}</button>`).join('')}</div>
    </div>
    <div class="acciones mo-barra">${FILTROS.map(([k, n]) => `<button class="chip-boton ${_filtro === k ? 'activo' : ''}" data-action="taFiltro" data-p0="${k}">${n}</button>`).join('')}</div>
    <p class="nota">Mostrando ${Math.min(lista.length, _vista === 'kanban' ? 300 : 200)} de ${lista.length}.</p>
    ${cuerpo}`;
}

// ── Ficha ───────────────────────────────────────────────────────────────────
const dato = (t: string, v: string) => v ? `<div class="me-dato"><dt>${esc(t)}</dt><dd>${v}</dd></div>` : '';

async function pintarFicha(el: HTMLElement, id: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const { data: t, error } = await API.single<Tarea>('tareas', { select: COLS, id: `eq.${id}` });
  if (error || !t) { el.innerHTML = '<p class="aviso mal">No se encontró la tarea.</p><p><a href="#/tareas">← Tareas</a></p>'; return; }
  _actual = t;
  const uno = async (tabla: string, idv: string | null, cols: string) => idv ? (await API.single<any>(tabla, { select: cols, id: `eq.${idv}` })).data : null;
  const [cli, loc, con, tra, tic, opo, delHub] = await Promise.all([
    uno('clientes', t.cliente_id, 'id,nombre'), uno('locales', t.local_id, 'id,nombre'), uno('contactos', t.contacto_id, 'id,nombre,telefono'),
    uno('trabajos', t.trabajo_id, 'id,numero,titulo'), uno('tickets', t.ticket_id, 'id,numero,titulo'), uno('oportunidades', t.oportunidad_id, 'id,titulo'),
    esDelHub('tareas'),
  ]);
  if (_actual?.id !== id) return;
  const enl = (href: string, txt: string) => `<a href="${esc(href)}">${esc(txt)}</a>`;
  const rec = t.recurrencia && t.recurrencia !== 'ninguna' ? `${t.recurrencia}${(t.recurrencia_cada ?? 1) > 1 ? ` (cada ${t.recurrencia_cada})` : ''}` : '';
  el.innerHTML = `<p><a href="#/tareas">← Tareas</a></p>
    ${delHub ? '' : avisoSoloLectura('Tareas')}
    <div class="tarjeta-cab"><h2>${t.numero != null ? `#${t.numero} ` : ''}${esc(t.titulo)}</h2>
      <div class="acciones">${botonChatFicha('tarea', t.id, t.titulo, `#/tareas/${t.id}`)}<a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Las tareas se cambian en la app actual">Abrir en la app ${ico('externo')}</a></div></div>
    <p>${chipEstado(t.estado)} ${chipPrio(t.prioridad)} ${vencida(t) ? '<span class="chip mal">Vencida</span>' : ''}</p>
    <div class="me-grid">
      <section class="tarjeta"><h3>${ico('lista')} La tarea</h3><dl class="me-datos">
        ${dato('Quién', t.tecnico_id ? esc(t.tecnico_id) : '<span class="chip aviso">Sin asignar</span>')}
        ${dato('Vence', t.fecha_vencimiento ? `${fecha(t)}${t.hora_fin ? ` – ${esc(t.hora_fin.slice(0, 5))}` : ''}` : '')}
        ${dato('Duración prevista', t.duracion_teorica ? `${t.duracion_teorica} min` : '')}
        ${dato('Tipo', esc(t.tipo ?? ''))}${dato('Se repite', esc(rec))}${dato('Creada', t.created_at ? esc(hace(t.created_at)) : '')}</dl></section>
      <section class="tarjeta"><h3>${ico('enlace')} De qué es</h3><dl class="me-datos">
        ${dato('Cliente', cli ? enl(`#/clientes/${cli.id}`, cli.nombre) : '')}${dato('Sitio', loc ? enl(`#/sitios/${loc.id}`, loc.nombre) : '')}
        ${dato('Contacto', con ? `${enl(`#/contactos/${con.id}`, con.nombre)}${con.telefono ? ` · <a href="tel:${esc(con.telefono)}">${esc(con.telefono)}</a>` : ''}` : '')}
        ${dato('Trabajo', tra ? enl(`#/trabajos/${tra.id}`, `#${tra.numero ?? '?'} ${tra.titulo ?? ''}`) : '')}
        ${dato('Ticket', tic ? enl(`#/tickets/${tic.id}`, `#${tic.numero ?? '?'} ${tic.titulo ?? ''}`) : '')}
        ${dato('Oportunidad', opo ? enl(`#/oportunidades/${opo.id}`, opo.titulo) : '')}</dl>
        ${cli || loc || con || tra || tic || opo ? '' : '<p class="nota">No cuelga de nada: es una tarea suelta.</p>'}</section>
      ${t.descripcion || t.notas ? `<section class="tarjeta"><h3>${ico('nota')} Detalle</h3>${t.descripcion ? `<p class="si-pre">${esc(t.descripcion)}</p>` : ''}${t.notas ? `<p class="si-pre nota">${esc(t.notas)}</p>` : ''}</section>` : ''}
    </div>`;
}

export async function pintarTareas(el: HTMLElement, params: string[]) {
  if (params[0]) await pintarFicha(el, params[0]);
  else await pintarLista(el);
}

let _timer: number | undefined;
registrarAcciones({
  taAbrir(id: string) { ir('tareas', id); },
  taFiltro(k: string) { _filtro = k; resolver(); },
  taPersona(v: string) { _persona = v; resolver(); },
  taVista(v: string) { _vista = v === 'kanban' ? 'kanban' : 'lista'; try { localStorage.setItem('hub_tareas_vista', _vista); } catch { /* sin almacenamiento */ } resolver(); },
  taFiltrar(v: string) {
    _q = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('ta-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
});
