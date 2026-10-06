// Ficha de un proyecto: #/proyectos/<numero>/<pestaña>.
// Pestañas: Idea · Objetivos · Investigación · Roadmap · Tareas · Vinculado · Coste.
// Prefijo de ids: pf- (ficha), pp- (página), ph- (hito), pt- (tarea), pv- (vínculo).
import { API, type Fila } from '../../core/api';
import { usuario, esAdmin } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { ir } from '../../core/router';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, toast, fechaHora, fecha, pl } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { markdown } from '../../ui/markdown';
import {
  type Peticion,
  FASES, nombreFase, siguienteFase, proyectoPorNumero, actualizarProyecto, piezas, ENLAZABLES, limpiarBusqueda,
  type Proyecto, type Hito, type Pagina, type TareaP,
} from './datos';

const PESTANAS = [
  ['idea', 'Idea'], ['objetivos', 'Objetivos'], ['investigacion', 'Investigación'], ['roadmap', 'Roadmap'],
  ['tareas', 'Tareas'], ['vinculado', 'Vinculado'], ['coste', 'Coste'], ['claude', 'Claude'],
] as const;

let _el: HTMLElement | null = null;
let _p: Proyecto | null = null;
let _pz: Awaited<ReturnType<typeof piezas>> | null = null;
let _pestana = 'idea';
let _paginaAbierta: string | null = null; // id | 'nueva' | null
let _clienteNombre = '';
let _arrastrandoTarea: string | null = null;

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const valONull = (id: string) => val(id) || null;
const hoy = () => new Date().toLocaleDateString('sv-SE');
const opcionesEquipo = async (sel: string | null) =>
  `<option value="">— Sin asignar —</option>${(await equipo()).map(u =>
    `<option value="${esc(u.id)}" ${u.id === sel ? 'selected' : ''}>${esc(nombreDe(u.id))}</option>`).join('')}`;

async function recargar() {
  if (!_p) return;
  const [p, pz] = await Promise.all([proyectoPorNumero(_p.numero), piezas(_p.id)]);
  if (p.data) _p = p.data;
  _pz = pz;
  await pintarCuerpo();
}

async function falla(r: { error: { message: string } | null }, que: string) {
  if (r.error) { toast(`No se pudo ${que}: ${r.error.message}`, 'error'); return true; }
  return false;
}

// ── Pestañas ────────────────────────────────────────────────────────────────
async function tabIdea(p: Proyecto): Promise<string> {
  const sig = siguienteFase(p.estado);
  return `<div class="pr-idea-grid">
    <section class="tarjeta">
      <label>Título <input id="pf-titulo" value="${esc(p.titulo)}" maxlength="200"></label>
      <div class="pr-campos">
        <label>Fase <select id="pf-estado">${FASES.map(f => `<option value="${f.id}" ${f.id === p.estado ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}</select></label>
        <label>Tipo <select id="pf-tipo" data-on-change="pfTipo:$value"><option value="interno" ${p.tipo === 'interno' ? 'selected' : ''}>Interno</option>
          <option value="cliente" ${p.tipo === 'cliente' ? 'selected' : ''}>De cliente</option></select></label>
        <label>Prioridad <select id="pf-prioridad">${['baja', 'media', 'alta', 'urgente'].map(x => `<option ${x === p.prioridad ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Responsable <select id="pf-responsable">${await opcionesEquipo(p.responsable_id)}</select></label>
        <label>Empieza <input id="pf-inicio" type="date" value="${esc(p.fecha_inicio ?? '')}"></label>
        <label>Fecha objetivo <input id="pf-objetivo" type="date" value="${esc(p.fecha_objetivo ?? '')}"></label>
        <label>Presupuesto previsto (€) <input id="pf-presupuesto" type="number" step="0.01" min="0" value="${p.presupuesto ?? ''}"></label>
      </div>
      <div class="pr-cliente" ${p.tipo === 'cliente' ? '' : 'hidden'} id="pf-cliente-bloque">
        <label>Cliente
          <input id="pf-cliente-q" placeholder="Buscar cliente por nombre o NIF…" autocomplete="off"
            value="${esc(_clienteNombre)}" data-on-input="pfBuscarCliente:$value">
        </label>
        <input type="hidden" id="pf-cliente-id" value="${esc(p.cliente_id ?? '')}">
        <ul id="pf-cliente-res" class="resultados"></ul>
      </div>
      <label>La idea (markdown) <textarea id="pf-descripcion" rows="10" placeholder="Qué es, por qué merece la pena, para quién…">${esc(p.descripcion ?? '')}</textarea></label>
      ${p.estado === 'cerrado' ? `<label>Resultado <textarea id="pf-resultado" rows="3">${esc(p.resultado ?? '')}</textarea></label>` : ''}
      <div class="acciones">
        <button class="btn" data-action="pfGuardar">Guardar</button>
        ${sig ? `<button class="btn secundario" data-action="pfAvanzar">Pasar a ${esc(nombreFase(sig))} →</button>` : ''}
        ${p.estado !== 'cerrado' ? `<button class="btn secundario" data-action="pfPedirClaude" data-p0="desarrollar">${ico('cohete')} Desarrollar esta fase con Claude</button>` : ''}
        ${esAdmin() ? '<button class="btn peligro" data-action="pfBorrarProyecto">Borrar proyecto</button>' : ''}
      </div>
    </section>
    <section class="tarjeta">
      <h3>Vista previa</h3>
      <div class="md">${markdown(p.descripcion) || '<p class="nota">Sin descripción todavía.</p>'}</div>
      <p class="nota">Creado ${esc(fechaHora(p.created_at))} · actualizado ${esc(fechaHora(p.updated_at))}</p>
    </section>
  </div>`;
}

function tabObjetivos(): string {
  const obs = _pz!.objetivos;
  const hechos = obs.filter(o => o.hecho).length;
  return `<section class="tarjeta">
    <h3>Objetivos <span class="chip ${obs.length && hechos === obs.length ? 'bien' : 'neutro'}">${hechos}/${obs.length}</span></h3>
    <p class="nota">Qué se quiere conseguir y cómo se sabrá que se ha conseguido (la métrica).</p>
    <ul class="pr-objetivos">${obs.map(o => `<li>
      <label class="check"><input type="checkbox" ${o.hecho ? 'checked' : ''} data-on-change="pfObjetivoHecho:${o.id},$checked">
        <span class="${o.hecho ? 'tachado' : ''}">${esc(o.texto)}</span></label>
      ${o.metrica ? `<small>${ico('regla')} ${esc(o.metrica)}</small>` : ''}
      <button class="icono-btn pequeno" aria-label="Quitar objetivo" data-action="pfBorrar" data-p0="proyecto_objetivos" data-p1="${o.id}">${ico('cerrar')}</button>
    </li>`).join('') || '<li class="vacio">Sin objetivos todavía.</li>'}</ul>
    <form class="acciones" data-on-submit="pfNuevoObjetivo" data-prevent="1">
      <input id="pfo-texto" placeholder="Objetivo (p. ej. 20 clientes con copia en la nube)" maxlength="300">
      <input id="pfo-metrica" placeholder="Cómo se mide (opcional)" maxlength="200">
      <button class="btn" type="submit">Añadir</button>
    </form>
  </section>`;
}

function editorPagina(pg: Pagina | null): string {
  const fuentes = (pg?.fuentes ?? []).map(f => f.titulo ? `${f.titulo} | ${f.url}` : f.url).join('\n');
  return `<section class="tarjeta">
    <h3>${pg ? 'Editar página' : 'Nueva página'}</h3>
    <div class="pr-campos">
      <label>Título <input id="pp-titulo" value="${esc(pg?.titulo ?? '')}" maxlength="200"></label>
      <label>Tipo <select id="pp-tipo">${[['investigacion', 'Investigación'], ['nota', 'Nota'], ['decision', 'Decisión']].map(([v, n]) =>
        `<option value="${v}" ${(pg?.tipo ?? 'investigacion') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <label>Contenido (markdown) <textarea id="pp-contenido" rows="14">${esc(pg?.contenido ?? '')}</textarea></label>
    <label>Fuentes, una por línea («título | https://…» o solo la URL)
      <textarea id="pp-fuentes" rows="4">${esc(fuentes)}</textarea></label>
    <div class="acciones">
      <button class="btn" data-action="pfGuardarPagina" data-p0="${pg?.id ?? ''}">Guardar</button>
      <button class="btn secundario" data-action="pfCerrarPagina">Cancelar</button>
      ${pg ? `<button class="btn peligro" data-action="pfBorrar" data-p0="proyecto_paginas" data-p1="${pg.id}">Borrar</button>` : ''}
    </div>
  </section>`;
}

function tabInvestigacion(): string {
  const pags = _pz!.paginas;
  if (_paginaAbierta) return editorPagina(_paginaAbierta === 'nueva' ? null : pags.find(p => p.id === _paginaAbierta) ?? null);
  return `<div class="acciones pr-barra">
      <button class="btn" data-action="pfAbrirPagina" data-p0="nueva">${ico('mas')} Página</button>
      <button class="btn secundario" data-action="pfPedirClaude" data-p0="investigar">${ico('buscar')} Investigar con Claude</button>
    </div>
    ${pags.map(pg => `<article class="tarjeta pr-pagina">
      <div class="tarjeta-cab"><h3>${esc(pg.titulo)}</h3>
        <div class="acciones"><span class="chip ${pg.autor === 'claude' ? 'aviso' : 'neutro'}">${pg.autor === 'claude' ? `${ico('robot')} Claude` : esc(nombreDe(pg.autor_id) || 'Persona')}</span>
        <span class="chip">${esc(pg.tipo)}</span>
        <button class="btn secundario" data-action="pfAbrirPagina" data-p0="${pg.id}">Editar</button></div></div>
      <div class="md">${markdown(pg.contenido)}</div>
      ${pg.fuentes?.length ? `<h4>Fuentes</h4><ol class="fuentes">${pg.fuentes.map(f =>
        `<li><a href="${esc(/^https?:\/\//.test(f.url) ? f.url : '#')}" target="_blank" rel="noopener">${esc(f.titulo || f.url)}</a></li>`).join('')}</ol>` : ''}
      <p class="nota">Actualizada ${esc(fechaHora(pg.updated_at))}</p>
    </article>`).join('') || '<p class="vacio">Sin páginas. La investigación, las notas y las decisiones del proyecto van aquí, con sus fuentes.</p>'}`;
}

function gantt(hitos: Hito[]): string {
  const conFecha = hitos.filter(h => h.fecha_inicio || h.fecha_objetivo);
  if (!conFecha.length) return '<p class="nota">Pon fechas a los hitos para ver el calendario.</p>';
  const dia = (s: string) => new Date(`${s}T00:00:00`).getTime();
  const ini = Math.min(...conFecha.map(h => dia(h.fecha_inicio ?? h.fecha_objetivo!)));
  const fin = Math.max(...conFecha.map(h => dia(h.fecha_objetivo ?? h.fecha_inicio!)), ini + 86400000);
  const pct = (t: number) => ((t - ini) / (fin - ini)) * 100;
  const hoyT = dia(hoy());
  return `<div class="gantt">
    ${hoyT >= ini && hoyT <= fin ? `<div class="gantt-hoy" style="left:${pct(hoyT)}%" title="Hoy"></div>` : ''}
    ${conFecha.map(h => {
      const a = dia(h.fecha_inicio ?? h.fecha_objetivo!), b = dia(h.fecha_objetivo ?? h.fecha_inicio!);
      const tarde = h.estado !== 'hecho' && h.fecha_objetivo && h.fecha_objetivo < hoy();
      return `<div class="gantt-fila"><span class="gantt-nombre">${esc(h.nombre)}</span>
        <div class="gantt-pista"><div class="gantt-barra ${h.estado} ${tarde ? 'tarde' : ''}"
          style="left:${pct(a)}%;width:${Math.max(pct(b) - pct(a), 1.5)}%" title="${esc(fecha(h.fecha_inicio))} → ${esc(fecha(h.fecha_objetivo))}"></div></div></div>`;
    }).join('')}
    <div class="gantt-eje"><span>${new Date(ini).toLocaleDateString('es-ES')}</span><span>${new Date(fin).toLocaleDateString('es-ES')}</span></div>
  </div>`;
}

function tabRoadmap(): string {
  const hitos = _pz!.hitos;
  const tareasDe = (id: string) => _pz!.tareas.filter(t => t.hito_id === id);
  return `<section class="tarjeta"><h3>Calendario</h3>${gantt(hitos)}</section>
    <section class="tarjeta">
      <h3>Hitos</h3>
      <table class="tabla"><thead><tr><th>Hito</th><th>Empieza</th><th>Objetivo</th><th>Estado</th><th>Tareas</th><th></th></tr></thead>
      <tbody>${hitos.map(h => {
        const ts = tareasDe(h.id);
        return `<tr>
          <td>${esc(h.nombre)}</td>
          <td><input type="date" value="${esc(h.fecha_inicio ?? '')}" data-on-change="pfHitoCampo:${h.id},fecha_inicio,$value"></td>
          <td><input type="date" value="${esc(h.fecha_objetivo ?? '')}" data-on-change="pfHitoCampo:${h.id},fecha_objetivo,$value"></td>
          <td><select data-on-change="pfHitoCampo:${h.id},estado,$value">${[['pendiente', 'Pendiente'], ['en_curso', 'En curso'], ['hecho', 'Hecho']].map(([v, n]) =>
            `<option value="${v}" ${h.estado === v ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
          <td>${ts.filter(t => t.estado === 'hecho').length}/${ts.length}</td>
          <td><button class="icono-btn pequeno" aria-label="Quitar hito" data-action="pfBorrar" data-p0="proyecto_hitos" data-p1="${h.id}">${ico('cerrar')}</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" class="vacio">Sin hitos todavía.</td></tr>'}</tbody></table>
      <form class="acciones" data-on-submit="pfNuevoHito" data-prevent="1">
        <input id="ph-nombre" placeholder="Hito (p. ej. Piloto con 3 clientes)" maxlength="200">
        <input id="ph-inicio" type="date" aria-label="Empieza"><input id="ph-objetivo" type="date" aria-label="Fecha objetivo">
        <button class="btn" type="submit">Añadir hito</button>
      </form>
    </section>`;
}

async function tabTareas(): Promise<string> {
  const ts = _pz!.tareas;
  const col = (estado: string, nombre: string) => {
    const lista = ts.filter(t => t.estado === estado);
    return `<section class="pr-columna" data-on-dragover="pfTareaSobre:$this" data-prevent="1" data-on-dragleave="pfTareaFuera:$this"
        data-on-drop="pfTareaSoltar:${estado}">
      <header><h3>${nombre}</h3><span class="chip">${lista.length}</span></header>
      <div class="pr-col-cuerpo">${lista.map(t => tarjetaTarea(t)).join('') || '<p class="vacio col-vacia">—</p>'}</div>
    </section>`;
  };
  return `<form class="tarjeta acciones" data-on-submit="pfNuevaTarea" data-prevent="1">
      <input id="pt-titulo" placeholder="Nueva tarea" maxlength="200">
      <select id="pt-responsable" aria-label="Responsable">${await opcionesEquipo(usuario()?.id ?? null)}</select>
      <select id="pt-hito" aria-label="Hito"><option value="">— Sin hito —</option>${_pz!.hitos.map(h => `<option value="${h.id}">${esc(h.nombre)}</option>`).join('')}</select>
      <input id="pt-fecha" type="date" aria-label="Fecha límite">
      <button class="btn" type="submit">Añadir</button>
    </form>
    <div class="pr-kanban tres">${col('pendiente', 'Pendiente')}${col('en_curso', 'En curso')}${col('hecho', 'Hecho')}</div>`;
}

function tarjetaTarea(t: TareaP): string {
  const hito = _pz!.hitos.find(h => h.id === t.hito_id);
  const tarde = t.estado !== 'hecho' && t.fecha_limite && t.fecha_limite < hoy();
  const mover = (a: string, texto: string) => `<button class="icono-btn pequeno" data-action="pfTareaEstado" data-p0="${t.id}" data-p1="${a}" aria-label="${texto}">${texto === 'Atrás' ? ico('izquierda') : ico('derecha')}</button>`;
  const orden = ['pendiente', 'en_curso', 'hecho'];
  const i = orden.indexOf(t.estado);
  return `<article class="pr-tarjeta" draggable="true" data-id="${t.id}" data-on-dragstart="pfTareaArrastrar:$this" data-on-dragend="pfTareaFin">
    <h4>${esc(t.titulo)}</h4>
    <div class="pr-tarjeta-pie">
      <span>${ico('persona')} ${esc(nombreDe(t.responsable_id) || 'Sin asignar')}</span>
      ${t.fecha_limite ? `<span class="${tarde ? 'mal' : ''}">${ico('calendario')} ${esc(fecha(t.fecha_limite))}</span>` : ''}
      ${hito ? `<span>${ico('bandera')} ${esc(hito.nombre)}</span>` : ''}
    </div>
    <div class="acciones">${i > 0 ? mover(orden[i - 1], 'Atrás') : ''}${i < 2 ? mover(orden[i + 1], 'Adelante') : ''}
      <button class="icono-btn pequeno" aria-label="Quitar tarea" data-action="pfBorrar" data-p0="proyecto_tareas" data-p1="${t.id}">${ico('cerrar')}</button></div>
  </article>`;
}

async function filasVinculadas(): Promise<Map<string, Fila>> {
  const porTabla = new Map<string, string[]>();
  for (const v of _pz!.vinculos) porTabla.set(v.tabla, [...(porTabla.get(v.tabla) ?? []), v.registro_id]);
  const out = new Map<string, Fila>();
  await Promise.all([...porTabla].map(async ([tabla, ids]) => {
    const def = ENLAZABLES[tabla];
    if (!def) return;
    const { data } = await API.get(tabla, { select: def.select, id: `in.(${ids.join(',')})` });
    for (const f of data ?? []) out.set(`${tabla}:${f.id}`, f);
  }));
  return out;
}

async function tabVinculado(): Promise<string> {
  const filas = await filasVinculadas();
  return `<section class="tarjeta">
      <h3>Enlazado desde la app actual</h3>
      <p class="nota">Trabajos, tickets, presupuestos, gastos y tareas de la app que forman parte de este proyecto. Se enlazan sin tocarlos: siguen viviendo en la app.</p>
      <ul class="pr-vinculos">${_pz!.vinculos.map(v => {
        const f = filas.get(`${v.tabla}:${v.registro_id}`);
        const def = ENLAZABLES[v.tabla];
        return `<li><span class="chip">${esc(def?.nombre ?? v.tabla)}</span> ${f ? esc(def.rotulo(f)) : '<span class="nota">(ya no está en la copia)</span>'}
          <button class="icono-btn pequeno" aria-label="Quitar vínculo" data-action="pfBorrar" data-p0="proyecto_vinculos" data-p1="${v.id}">${ico('cerrar')}</button></li>`;
      }).join('') || '<li class="vacio">Nada enlazado todavía.</li>'}</ul>
    </section>
    <section class="tarjeta">
      <h3>Enlazar</h3>
      <form class="acciones" data-on-submit="pfBuscarVinculo" data-prevent="1">
        <select id="pv-tabla">${Object.entries(ENLAZABLES).map(([k, d]) => `<option value="${k}">${esc(d.nombre)}</option>`).join('')}</select>
        <input id="pv-q" placeholder="Número o texto" maxlength="60">
        <button class="btn" type="submit">Buscar</button>
      </form>
      <ul id="pv-res" class="resultados"></ul>
    </section>`;
}

async function tabCoste(p: Proyecto): Promise<string> {
  const ids = (t: string) => _pz!.vinculos.filter(v => v.tabla === t).map(v => v.registro_id);
  const trabajos = ids('trabajos'), gastos = ids('gastos'), presus = ids('presupuestos');
  const [ses, lin, gas, pre, cfg] = await Promise.all([
    trabajos.length ? API.get('sesiones', { select: 'inicio,fin,duracion_min', entidad_id: `in.(${trabajos.join(',')})` }) : { data: [], error: null },
    trabajos.length ? API.get('documento_lineas', { select: 'subtotal', trabajo_id: `in.(${trabajos.join(',')})` }) : { data: [], error: null },
    gastos.length ? API.get('gastos', { select: 'importe', id: `in.(${gastos.join(',')})` }) : { data: [], error: null },
    presus.length ? API.get('presupuestos', { select: 'total', id: `in.(${presus.join(',')})` }) : { data: [], error: null },
    API.get('config', { select: 'valor', clave: 'eq.tarifa_hora' }),
  ]);
  const min = (ses.data ?? []).reduce((s, x) => s + (x.duracion_min ?? (x.inicio && x.fin ? (Date.parse(x.fin) - Date.parse(x.inicio)) / 60000 : 0)), 0);
  const suma = (r: { data: Fila[] | null }, c: string) => (r.data ?? []).reduce((s, x) => s + Number(x[c] ?? 0), 0);
  const material = suma(lin, 'subtotal'), gastado = suma(gas, 'importe'), presupuestado = suma(pre, 'total');
  const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  // Una sola tarifa por hora para todo el equipo (hub.config.tarifa_hora); sin ella las horas no se pasan a euros.
  const tarifa = Number(cfg.data?.[0]?.valor) > 0 ? Number(cfg.data![0].valor) : null;
  const manoObra = tarifa ? (min / 60) * tarifa : 0;
  const dinero = manoObra + material + gastado;
  const previsto = p.presupuesto ?? 0;
  const pctUso = previsto ? Math.round((dinero / previsto) * 100) : null;
  const horasPrev = _pz!.tareas.reduce((s, t) => s + Number(t.horas_previstas ?? 0), 0);
  const queCuenta = tarifa ? 'horas + material + gastos' : 'material + gastos';
  return `<div class="baldosas">
      <div class="baldosa"><span class="baldosa-titulo">Horas fichadas</span><span class="baldosa-valor">${(min / 60).toFixed(1)} h</span>
        <span class="baldosa-sub">${tarifa ? `${eur(manoObra)} a ${eur(tarifa)}/h` : 'sin tarifa: no se pasan a euros'}${horasPrev ? ` · previstas ${horasPrev.toFixed(1)} h` : ''}</span></div>
      <div class="baldosa"><span class="baldosa-titulo">Material</span><span class="baldosa-valor">${eur(material)}</span><span class="baldosa-sub">líneas de los trabajos</span></div>
      <div class="baldosa"><span class="baldosa-titulo">Gastos</span><span class="baldosa-valor">${eur(gastado)}</span><span class="baldosa-sub">gastos enlazados</span></div>
      <div class="baldosa"><span class="baldosa-titulo">Coste total</span><span class="baldosa-valor">${eur(dinero)}</span><span class="baldosa-sub">${queCuenta}</span></div>
      <div class="baldosa" data-tono="${pctUso == null ? 'neutro' : pctUso > 100 ? 'mal' : pctUso > 80 ? 'aviso' : 'bien'}"><span class="baldosa-titulo">Previsto</span>
        <span class="baldosa-valor">${previsto ? eur(previsto) : '—'}</span>
        <span class="baldosa-sub">${pctUso == null ? 'pon el presupuesto en Idea' : `usado ${pctUso}%`}</span></div>
      ${presus.length ? `<div class="baldosa"><span class="baldosa-titulo">Presupuestado al cliente</span><span class="baldosa-valor">${eur(presupuestado)}</span>
        <span class="baldosa-sub">${pl(presus.length, 'presupuesto enlazado', 'presupuestos enlazados')}</span></div>` : ''}
    </div>
    <p class="nota">El coste sale de lo enlazado en «Vinculado». ${tarifa ? `Tarifa por hora: ${eur(tarifa)} (una para todo el equipo).` : 'Falta la tarifa por hora para pasar las horas a euros.'}</p>
    ${esAdmin() ? `<form class="acciones" data-on-submit="pfGuardarTarifa" data-prevent="1">
      <label>Tarifa por hora para todo el equipo (€/h, sin impuestos)
        <input id="pfc-tarifa" type="number" min="0" step="0.5" value="${tarifa ?? ''}" placeholder="p. ej. 40"></label>
      <button class="btn secundario" type="submit">Guardar tarifa</button>
    </form>` : ''}`;
}

// ── Claude: peticiones de trabajo ──────────────────────────────────────────
const QUE_HACE: Record<string, string> = {
  investigar: 'Busca información sobre el proyecto (opciones, precios, proveedores, riesgos) y la deja como páginas de investigación con sus fuentes.',
  desarrollar: 'Hace avanzar la fase actual: en Definición propone objetivos con su métrica; en Investigación, páginas con fuentes; en Roadmap, hitos con fechas y tareas; en Desarrollo, tareas concretas y una página de seguimiento.',
  revisar: 'Revisa el proyecto entero y deja una página con lo que falta, riesgos y siguientes pasos.',
};
const ESTADO_PET: Record<string, [string, string]> = {
  pendiente: ['neutro', 'Pendiente'], en_curso: ['aviso', 'Claude trabajando'], hecha: ['bien', 'Hecha'],
  error: ['mal', 'Error'], cancelada: ['neutro', 'Cancelada'],
};
let _pidiendo: string | null = null;

function formularioPeticion(tipo: string): string {
  return `<section class="tarjeta pc-form">
    <h3>${tipo === 'investigar' ? `${ico('buscar')} Investigar con Claude` : tipo === 'desarrollar' ? `${ico('cohete')} Desarrollar «${esc(nombreFase(_p!.estado))}» con Claude` : `${ico('buscar')} Revisar con Claude`}</h3>
    <p class="nota">${esc(QUE_HACE[tipo])} Claude lo recoge en menos de una hora y deja el resultado en el proyecto; aquí verás el resumen.</p>
    <label>¿Algo concreto? (opcional) <textarea id="pc-instrucciones" rows="4" maxlength="4000"
      placeholder="p. ej. Compara al menos 3 proveedores con precio por TB y soporte en español"></textarea></label>
    <div class="acciones">
      <button class="btn" data-action="pfEnviarClaude" data-p0="${tipo}">Pedírselo a Claude</button>
      <button class="btn secundario" data-action="pfCancelarForm">Cancelar</button>
    </div>
  </section>`;
}

function tabClaude(): string {
  const ps = _pz!.peticiones;
  return `${_pidiendo ? formularioPeticion(_pidiendo) : `<div class="acciones pr-barra">
      <div class="acciones">
        <button class="btn" data-action="pfPedirClaude" data-p0="investigar">${ico('buscar')} Investigar</button>
        ${_p!.estado !== 'cerrado' ? `<button class="btn" data-action="pfPedirClaude" data-p0="desarrollar">${ico('cohete')} Desarrollar «${esc(nombreFase(_p!.estado))}»</button>` : ''}
        <button class="btn secundario" data-action="pfPedirClaude" data-p0="revisar">${ico('buscar')} Revisar el proyecto</button>
      </div></div>`}
    ${ps.map((x: Peticion) => {
      const [tono, texto] = ESTADO_PET[x.estado] ?? ['neutro', x.estado];
      return `<article class="tarjeta">
        <div class="tarjeta-cab"><h3>${esc({ investigar: 'Investigar', desarrollar: 'Desarrollar', revisar: 'Revisar' }[x.tipo] ?? x.tipo)}
          ${x.fase ? `<small>· fase ${esc(nombreFase(x.fase))}</small>` : ''}</h3>
          <div class="acciones"><span class="chip ${tono}">${texto}</span>
          ${x.estado === 'pendiente' ? `<button class="btn secundario" data-action="pfCancelarPeticion" data-p0="${x.id}">Cancelar</button>` : ''}</div></div>
        <p class="nota">Pedido por ${esc(nombreDe(x.pedido_por) || '—')} · ${esc(fechaHora(x.created_at))}${x.terminada_at ? ` · terminado ${esc(fechaHora(x.terminada_at))}` : ''}</p>
        ${x.instrucciones ? `<blockquote class="md">${esc(x.instrucciones)}</blockquote>` : ''}
        ${x.resultado ? `<div class="md">${markdown(x.resultado)}</div>` : ''}
        ${x.error ? `<p class="aviso mal">${esc(x.error)}</p>` : ''}
      </article>`;
    }).join('') || '<p class="vacio">Todavía no se le ha pedido nada a Claude en este proyecto.</p>'}`;
}

async function pintarCuerpo() {
  const cuerpo = document.getElementById('pf-cuerpo');
  if (!cuerpo || !_p || !_pz) return;
  document.querySelectorAll('.pf-pestana').forEach(b => {
    b.classList.toggle('activo', (b as HTMLElement).dataset.p1 === _pestana);
    b.setAttribute('aria-selected', String((b as HTMLElement).dataset.p1 === _pestana));
  });
  const cab = document.getElementById('pf-fase');
  if (cab) cab.textContent = nombreFase(_p.estado);
  const html = {
    idea: () => tabIdea(_p!), objetivos: async () => tabObjetivos(), investigacion: async () => tabInvestigacion(),
    roadmap: async () => tabRoadmap(), tareas: () => tabTareas(), vinculado: () => tabVinculado(), coste: () => tabCoste(_p!),
    claude: async () => tabClaude(),
  }[_pestana] ?? (() => tabIdea(_p!));
  cuerpo.innerHTML = await html();
}

export async function pintarFicha(el: HTMLElement, numero: number, pestana?: string) {
  _el = el;
  _pestana = PESTANAS.some(([k]) => k === pestana) ? pestana! : 'idea';
  if (!_p || _p.numero !== numero) _paginaAbierta = null;
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  await equipo();
  const { data, error } = await proyectoPorNumero(numero);
  if (error || !data) { el.innerHTML = `<p class="aviso mal">No se encontró el proyecto #${numero}.</p><p><a href="#/proyectos">← Proyectos</a></p>`; return; }
  _p = data;
  _pz = await piezas(data.id);
  _clienteNombre = '';
  if (data.cliente_id) {
    const c = await API.single('clientes', { select: 'nombre', id: `eq.${data.cliente_id}` });
    _clienteNombre = c.data?.nombre ?? '';
  }
  document.getElementById('pantalla-titulo')!.textContent = `#${data.numero} ${data.titulo}`;
  el.innerHTML = `
    <p><a href="#/proyectos">← Proyectos</a> · <span class="chip aviso" id="pf-fase">${esc(nombreFase(data.estado))}</span>
      ${data.tipo === 'cliente' && _clienteNombre ? ` · ${ico('empresa')} ${esc(_clienteNombre)}` : ''}</p>
    <nav class="pestanas" role="tablist">${PESTANAS.map(([k, n]) =>
      `<button role="tab" class="pf-pestana" data-action="pfPestana" data-p0="${data.numero}" data-p1="${k}">${n}</button>`).join('')}</nav>
    <div id="pf-cuerpo"></div>`;
  if (_pz.error) toast(`Algunas partes no se pudieron leer: ${_pz.error.message}`, 'error');
  await pintarCuerpo();
}

// ── Acciones ────────────────────────────────────────────────────────────────
function leerFuentes(texto: string) {
  return texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [a, b] = l.split('|').map(s => s.trim());
    return b ? { titulo: a, url: b } : { url: a };
  }).filter(f => /^https?:\/\//.test(f.url));
}

let _busqClienteT: number | undefined;

registrarAcciones({
  pfPedirClaude(tipo: string) {
    _pidiendo = tipo;
    if (_p && _pestana !== 'claude') ir('proyectos', String(_p.numero), 'claude');
    else void pintarCuerpo();
  },
  async pfGuardarTarifa() {
    const v = Number((document.getElementById('pfc-tarifa') as HTMLInputElement).value);
    if (!(v > 0)) { toast('Pon una tarifa mayor que 0', 'error'); return; }
    const r = await API.upsert('config', 'clave',
      { clave: 'tarifa_hora', valor: v, descripcion: 'Tarifa por hora (€/h, sin impuestos), una para todo el equipo' });
    if (await falla(r, 'guardar la tarifa')) return;
    toast('Tarifa guardada');
    await pintarCuerpo();
  },
  pfCancelarForm() { _pidiendo = null; void pintarCuerpo(); },
  async pfEnviarClaude(tipo: string) {
    if (!_p) return;
    const instr = (document.getElementById('pc-instrucciones') as HTMLTextAreaElement | null)?.value.trim() || null;
    if (await falla(await API.post('claude_peticiones', { proyecto_id: _p.id, tipo, fase: _p.estado, instrucciones: instr,
      pedido_por: usuario()?.id }), 'enviar la petición')) return;
    _pidiendo = null;
    toast('Pedido a Claude: lo recoge en menos de una hora');
    await recargar();
  },
  async pfCancelarPeticion(id: string) {
    if (!confirm('¿Cancelar esta petición a Claude?')) return;
    if (await falla(await API.patch('claude_peticiones', { id: `eq.${id}` }, { estado: 'cancelada' }), 'cancelar')) return;
    await recargar();
  },
  // El buscador de cliente solo tiene sentido en un proyecto de cliente.
  pfTipo(tipo: string) { document.getElementById('pf-cliente-bloque')?.toggleAttribute('hidden', tipo !== 'cliente'); },
  pfPestana(numero: string, pestana: string) { _paginaAbierta = null; _pidiendo = null; ir('proyectos', numero, pestana); },

  async pfGuardar() {
    if (!_p) return;
    const titulo = val('pf-titulo');
    if (!titulo) { toast('El título no puede quedar vacío', 'error'); return; }
    const tipo = val('pf-tipo') as Proyecto['tipo'];
    const cambios: Partial<Proyecto> = {
      titulo, tipo, estado: val('pf-estado') as Proyecto['estado'], prioridad: val('pf-prioridad'),
      responsable_id: valONull('pf-responsable'), fecha_inicio: valONull('pf-inicio'), fecha_objetivo: valONull('pf-objetivo'),
      presupuesto: val('pf-presupuesto') ? Number(val('pf-presupuesto')) : null,
      descripcion: (document.getElementById('pf-descripcion') as HTMLTextAreaElement).value,
      cliente_id: tipo === 'cliente' ? valONull('pf-cliente-id') : null,
    };
    const res = document.getElementById('pf-resultado') as HTMLTextAreaElement | null;
    if (res) cambios.resultado = res.value;
    if (await falla(await actualizarProyecto(_p.id, cambios), 'guardar')) return;
    toast('Guardado');
    if (_el) await pintarFicha(_el, _p.numero, _pestana);
  },

  async pfAvanzar() {
    if (!_p) return;
    const sig = siguienteFase(_p.estado);
    if (!sig) return;
    if (await falla(await actualizarProyecto(_p.id, { estado: sig }), 'cambiar de fase')) return;
    toast(`Ahora en ${nombreFase(sig)}`);
    await recargar();
  },

  async pfBorrarProyecto() {
    if (!_p || !confirm(`¿Borrar el proyecto #${_p.numero} «${_p.titulo}» con sus objetivos, páginas, hitos y tareas? No se puede deshacer.`)) return;
    if (await falla(await API.delete('proyectos', { id: `eq.${_p.id}` }), 'borrar')) return;
    toast('Proyecto borrado');
    _p = null;
    ir('proyectos');
  },

  pfBuscarCliente(q: string) {
    clearTimeout(_busqClienteT);
    _busqClienteT = window.setTimeout(async () => {
      const ul = document.getElementById('pf-cliente-res');
      const limpio = limpiarBusqueda(q);
      if (!ul) return;
      if (limpio.length < 2) { ul.innerHTML = ''; return; }
      const { data } = await API.get('clientes', { select: 'id,nombre,nif', activo: 'eq.true',
        or: `(nombre.ilike.*${limpio}*,nif.ilike.*${limpio}*)`, order: 'nombre', limit: '8' });
      ul.innerHTML = (data ?? []).map(c => `<li><button type="button" data-action="pfElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">
        ${esc(c.nombre)} <small>${esc(c.nif ?? '')}</small></button></li>`).join('') || '<li class="vacio">Sin resultados</li>';
    }, 250);
  },
  pfElegirCliente(id: string, nombre: string) {
    (document.getElementById('pf-cliente-id') as HTMLInputElement).value = id;
    (document.getElementById('pf-cliente-q') as HTMLInputElement).value = nombre;
    document.getElementById('pf-cliente-res')!.innerHTML = '';
    _clienteNombre = nombre;
  },

  async pfBorrar(tabla: string, id: string) {
    if (!confirm('¿Quitar este elemento?')) return;
    if (await falla(await API.delete(tabla, { id: `eq.${id}` }), 'quitar')) return;
    if (tabla === 'proyecto_paginas') _paginaAbierta = null;
    await recargar();
  },

  async pfNuevoObjetivo() {
    if (!_p) return;
    const texto = val('pfo-texto');
    if (!texto) return;
    const orden = Math.max(0, ..._pz!.objetivos.map(o => o.orden)) + 1;
    if (await falla(await API.post('proyecto_objetivos', { proyecto_id: _p.id, texto, metrica: valONull('pfo-metrica'), orden }), 'añadir el objetivo')) return;
    await recargar();
  },
  async pfObjetivoHecho(id: string, hecho: boolean) {
    if (await falla(await API.patch('proyecto_objetivos', { id: `eq.${id}` }, { hecho }), 'marcar')) return;
    await recargar();
  },

  pfAbrirPagina(id: string) { _paginaAbierta = id; void pintarCuerpo(); },
  pfCerrarPagina() { _paginaAbierta = null; void pintarCuerpo(); },
  async pfGuardarPagina(id: string) {
    if (!_p) return;
    const titulo = val('pp-titulo');
    if (!titulo) { toast('La página necesita un título', 'error'); return; }
    const datos = {
      titulo, tipo: val('pp-tipo'),
      contenido: (document.getElementById('pp-contenido') as HTMLTextAreaElement).value,
      fuentes: leerFuentes((document.getElementById('pp-fuentes') as HTMLTextAreaElement).value),
    };
    const r = id
      ? await API.patch('proyecto_paginas', { id: `eq.${id}` }, datos)
      : await API.post('proyecto_paginas', { ...datos, proyecto_id: _p.id, autor: 'persona', autor_id: usuario()?.id ?? null,
          orden: Math.max(0, ..._pz!.paginas.map(p => p.orden)) + 1 });
    if (await falla(r, 'guardar la página')) return;
    _paginaAbierta = null;
    toast('Página guardada');
    await recargar();
  },

  async pfNuevoHito() {
    if (!_p) return;
    const nombre = val('ph-nombre');
    if (!nombre) return;
    const orden = Math.max(0, ..._pz!.hitos.map(h => h.orden)) + 1;
    if (await falla(await API.post('proyecto_hitos', { proyecto_id: _p.id, nombre, fecha_inicio: valONull('ph-inicio'),
      fecha_objetivo: valONull('ph-objetivo'), orden }), 'añadir el hito')) return;
    await recargar();
  },
  async pfHitoCampo(id: string, campo: string, valor: string) {
    if (!['fecha_inicio', 'fecha_objetivo', 'estado'].includes(campo)) return;
    if (await falla(await API.patch('proyecto_hitos', { id: `eq.${id}` }, { [campo]: valor || null }), 'guardar el hito')) return;
    await recargar();
  },

  async pfNuevaTarea() {
    if (!_p) return;
    const titulo = val('pt-titulo');
    if (!titulo) return;
    const orden = Math.max(0, ..._pz!.tareas.map(t => t.orden)) + 1;
    if (await falla(await API.post('proyecto_tareas', { proyecto_id: _p.id, titulo, responsable_id: valONull('pt-responsable'),
      hito_id: valONull('pt-hito'), fecha_limite: valONull('pt-fecha'), orden }), 'añadir la tarea')) return;
    await recargar();
  },
  async pfTareaEstado(id: string, estado: string) {
    if (await falla(await API.patch('proyecto_tareas', { id: `eq.${id}` }, { estado }), 'mover la tarea')) return;
    await recargar();
  },
  pfTareaArrastrar(el: HTMLElement) { _arrastrandoTarea = el.dataset.id ?? null; el.classList.add('arrastrando'); },
  pfTareaFin() { _arrastrandoTarea = null; document.querySelectorAll('.arrastrando,.pr-columna.sobre').forEach(e => e.classList.remove('arrastrando', 'sobre')); },
  pfTareaSobre(el: HTMLElement) { el.classList.add('sobre'); },
  pfTareaFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  async pfTareaSoltar(estado: string) {
    const id = _arrastrandoTarea;
    document.querySelectorAll('.pr-columna.sobre').forEach(e => e.classList.remove('sobre'));
    const t = _pz?.tareas.find(x => x.id === id);
    if (!t || t.estado === estado) return;
    if (await falla(await API.patch('proyecto_tareas', { id: `eq.${t.id}` }, { estado }), 'mover la tarea')) return;
    await recargar();
  },

  async pfBuscarVinculo() {
    const tabla = val('pv-tabla');
    const q = limpiarBusqueda(val('pv-q'));
    const ul = document.getElementById('pv-res')!;
    const def = ENLAZABLES[tabla];
    if (!def || !q) { ul.innerHTML = ''; return; }
    const { data, error } = await API.get(tabla, { select: def.select, ...def.buscar(q), limit: '10' });
    if (error) { ul.innerHTML = `<li class="aviso mal">${esc(error.message)}</li>`; return; }
    const ya = new Set(_pz!.vinculos.filter(v => v.tabla === tabla).map(v => v.registro_id));
    ul.innerHTML = (data ?? []).map(f => `<li>${esc(def.rotulo(f))}
      ${ya.has(f.id) ? '<span class="chip bien">enlazado</span>' : `<button class="btn secundario" data-action="pfEnlazar" data-p0="${tabla}" data-p1="${esc(f.id)}">Enlazar</button>`}</li>`).join('')
      || '<li class="vacio">Sin resultados</li>';
  },
  async pfEnlazar(tabla: string, id: string) {
    if (!_p) return;
    if (await falla(await API.post('proyecto_vinculos', { proyecto_id: _p.id, tabla, registro_id: id }), 'enlazar')) return;
    toast('Enlazado');
    await recargar();
  },
});
