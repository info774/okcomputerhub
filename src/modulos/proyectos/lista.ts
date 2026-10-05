// Proyectos: kanban por fase (arrastrar entre columnas), lista y tablero de
// tareas por persona. Arriba, la bandeja de ideas: una línea y Enter.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { ir } from '../../core/router';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { FASES, nombreFase, listarProyectos, crearProyecto, actualizarProyecto, type Proyecto, type TareaP } from './datos';

type Vista = 'kanban' | 'lista' | 'personas';
const CLAVE_VISTA = 'hub_proyectos_vista';
const CLAVE_CERRADOS = 'hub_proyectos_cerrados';

function leer(k: string, def: string) { try { return localStorage.getItem(k) ?? def; } catch { return def; } }
function guardar(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

let _el: HTMLElement | null = null;
let _proyectos: Proyecto[] = [];
let _arrastrando: string | null = null;

const hoy = () => new Date().toLocaleDateString('sv-SE');
const vencido = (f: string | null) => !!f && f < hoy();

function tarjeta(p: Proyecto): string {
  const resp = nombreDe(p.responsable_id);
  return `<article class="pr-tarjeta prio-${esc(p.prioridad)}" draggable="true" data-id="${esc(p.id)}"
      data-on-dragstart="proyectosArrastrar:$this" data-on-dragend="proyectosSoltarFin"
      data-action="abrirProyecto" data-p0="${p.numero}">
    <div class="pr-tarjeta-cab"><span class="pr-num">#${p.numero}</span>
      <span class="chip ${p.tipo === 'cliente' ? 'aviso' : 'neutro'}">${p.tipo === 'cliente' ? 'Cliente' : 'Interno'}</span></div>
    <h4>${esc(p.titulo)}</h4>
    <div class="pr-tarjeta-pie">
      ${resp ? `<span>${ico('persona')} ${esc(resp)}</span>` : '<span class="nota">Sin responsable</span>'}
      ${p.fecha_objetivo ? `<span class="${vencido(p.fecha_objetivo) && p.estado !== 'cerrado' ? 'mal' : ''}">${ico('calendario')} ${esc(p.fecha_objetivo)}</span>` : ''}
    </div>
  </article>`;
}

function pintarKanban(verCerrados: boolean): string {
  const fases = FASES.filter(f => verCerrados || f.id !== 'cerrado');
  return `<div class="pr-kanban">${fases.map(f => {
    const col = _proyectos.filter(p => p.estado === f.id);
    return `<section class="pr-columna" data-fase="${f.id}"
        data-on-dragover="proyectosSobre:$this" data-prevent="1" data-on-dragleave="proyectosFuera:$this"
        data-on-drop="proyectosSoltar:${f.id}" >
      <header><h3>${esc(f.nombre)}</h3><span class="chip">${col.length}</span></header>
      <p class="nota">${esc(f.ayuda)}</p>
      <div class="pr-col-cuerpo">${col.map(tarjeta).join('') || '<p class="vacio col-vacia">—</p>'}</div>
    </section>`;
  }).join('')}</div>`;
}

function pintarLista(): string {
  if (!_proyectos.length) return '<p class="vacio">Todavía no hay proyectos. Apunta una idea arriba.</p>';
  return `<div class="tarjeta"><table class="tabla">
    <thead><tr><th>#</th><th>Proyecto</th><th>Fase</th><th>Tipo</th><th>Responsable</th><th>Objetivo</th></tr></thead>
    <tbody>${_proyectos.map(p => `<tr class="fila-clic" data-action="abrirProyecto" data-p0="${p.numero}">
      <td>${p.numero}</td><td>${esc(p.titulo)}</td><td>${esc(nombreFase(p.estado))}</td>
      <td>${p.tipo === 'cliente' ? 'Cliente' : 'Interno'}</td><td>${esc(nombreDe(p.responsable_id))}</td>
      <td class="${vencido(p.fecha_objetivo) && p.estado !== 'cerrado' ? 'mal' : ''}">${esc(p.fecha_objetivo ?? '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function pintarPersonas(): Promise<string> {
  const abiertos = _proyectos.filter(p => p.estado !== 'cerrado');
  if (!abiertos.length) return '<p class="vacio">No hay proyectos abiertos.</p>';
  const { data, error } = await API.get<TareaP[]>('proyecto_tareas', {
    select: '*', proyecto_id: `in.(${abiertos.map(p => p.id).join(',')})`, estado: 'neq.hecho', order: 'fecha_limite.nullslast,orden',
  });
  if (error) return `<p class="aviso mal">No se pudieron leer las tareas: ${esc(error.message)}</p>`;
  const porPersona = new Map<string, TareaP[]>();
  for (const t of data ?? []) {
    const k = t.responsable_id ?? '';
    porPersona.set(k, [...(porPersona.get(k) ?? []), t]);
  }
  if (!porPersona.size) return '<p class="vacio">Nadie tiene tareas pendientes en proyectos abiertos.</p>';
  const titulo = (id: string) => _proyectos.find(p => p.id === id);
  const claves = [...porPersona.keys()].sort((a, b) => (nombreDe(a) || 'zzz').localeCompare(nombreDe(b) || 'zzz'));
  return `<div class="pr-personas">${claves.map(k => `<section class="tarjeta">
    <h3>${esc(nombreDe(k) || 'Sin asignar')} <span class="chip">${porPersona.get(k)!.length}</span></h3>
    <ul class="pr-tareas-lista">${porPersona.get(k)!.map(t => {
      const p = titulo(t.proyecto_id);
      return `<li class="fila-clic" data-action="abrirProyecto" data-p0="${p?.numero ?? ''}" data-p1="tareas">
        <span class="chip ${t.estado === 'en_curso' ? 'aviso' : 'neutro'}">${t.estado === 'en_curso' ? 'En curso' : 'Pendiente'}</span>
        ${esc(t.titulo)} <small>· #${p?.numero ?? '?'} ${esc(p?.titulo ?? '')}</small>
        ${t.fecha_limite ? `<small class="${vencido(t.fecha_limite) ? 'mal' : ''}"> · ${ico('calendario')} ${esc(t.fecha_limite)}</small>` : ''}
      </li>`;
    }).join('')}</ul></section>`).join('')}</div>`;
}

export async function pintarListaProyectos(el: HTMLElement) {
  _el = el;
  const vista = leer(CLAVE_VISTA, 'kanban') as Vista;
  const verCerrados = leer(CLAVE_CERRADOS, '0') === '1';
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ data, error }] = await Promise.all([listarProyectos(verCerrados), equipo()]);
  if (error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los proyectos: ${esc(error.message)}</p>`; return; }
  _proyectos = data ?? [];

  const cuerpo = vista === 'lista' ? pintarLista() : vista === 'personas' ? await pintarPersonas() : pintarKanban(verCerrados);
  el.innerHTML = `
    <form class="pr-idea tarjeta" data-on-submit="apuntarIdea" data-prevent="1">
      <label for="pri-titulo">${ico('idea')} Apuntar una idea</label>
      <div class="acciones">
        <input id="pri-titulo" maxlength="200" placeholder="p. ej. Ofrecer copias en la nube a los restaurantes" autocomplete="off">
        <select id="pri-tipo" aria-label="Tipo"><option value="interno">Interno</option><option value="cliente">De cliente</option></select>
        <button class="btn" type="submit">Apuntar</button>
      </div>
    </form>
    <div class="acciones pr-barra">
      <div class="segmentado" role="tablist">
        ${(['kanban', 'lista', 'personas'] as Vista[]).map(v => `<button role="tab" aria-selected="${v === vista}" class="${v === vista ? 'activo' : ''}"
          data-action="proyectosVista" data-p0="${v}">${{ kanban: 'Por fase', lista: 'Lista', personas: 'Tareas por persona' }[v]}</button>`).join('')}
      </div>
      <label class="check"><input type="checkbox" ${verCerrados ? 'checked' : ''} data-on-change="proyectosCerrados:$checked"> Ver cerrados</label>
    </div>
    ${cuerpo}`;
}

const repintar = () => { if (_el) void pintarListaProyectos(_el); };

registrarAcciones({
  abrirProyecto(numero: string, pestana?: string) { if (numero) ir('proyectos', numero, ...(pestana ? [pestana] : [])); },
  proyectosVista(v: string) { guardar(CLAVE_VISTA, v); repintar(); },
  proyectosCerrados(v: boolean) { guardar(CLAVE_CERRADOS, v ? '1' : '0'); repintar(); },
  async apuntarIdea() {
    const campo = document.getElementById('pri-titulo') as HTMLInputElement;
    const titulo = campo.value.trim();
    if (!titulo) { campo.focus(); return; }
    const tipo = (document.getElementById('pri-tipo') as HTMLSelectElement).value;
    const minimo = Math.min(0, ..._proyectos.filter(p => p.estado === 'idea').map(p => p.orden));
    const { data, error } = await crearProyecto({ titulo, tipo: tipo as Proyecto['tipo'], estado: 'idea', orden: minimo - 1,
      responsable_id: usuario()?.id ?? null });
    if (error) { toast(`No se pudo apuntar: ${error.message}`, 'error'); return; }
    toast(`Idea #${data?.[0]?.numero} apuntada`);
    repintar();
  },
  proyectosArrastrar(el: HTMLElement) { _arrastrando = el.dataset.id ?? null; el.classList.add('arrastrando'); },
  proyectosSoltarFin() {
    _arrastrando = null;
    document.querySelectorAll('.arrastrando,.pr-columna.sobre').forEach(e => e.classList.remove('arrastrando', 'sobre'));
  },
  proyectosSobre(el: HTMLElement) { el.classList.add('sobre'); },
  proyectosFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  async proyectosSoltar(fase: string) {
    const id = _arrastrando;
    document.querySelectorAll('.pr-columna.sobre').forEach(e => e.classList.remove('sobre'));
    const p = _proyectos.find(x => x.id === id);
    if (!p || p.estado === fase) return;
    const orden = Math.max(0, ..._proyectos.filter(x => x.estado === fase).map(x => x.orden)) + 1;
    const { error } = await actualizarProyecto(p.id, { estado: fase as Proyecto['estado'], orden });
    if (error) toast(`No se pudo mover: ${error.message}`, 'error');
    else toast(`#${p.numero} → ${nombreFase(fase)}`);
    repintar();
  },
});
