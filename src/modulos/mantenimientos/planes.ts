// Plantillas de Mantenimientos (pestaña «Plantillas» de la app):
//   #/mantenimientos/plantillas                 los planes (precio NETO €/mes,
//                                               resumen, características, descuentos,
//                                               visitas) y los checklists de visita
//   #/mantenimientos/plantillas/<id|nuevo>      editar un plan (savePlan) con sus
//                                               tareas de seguimiento (plan_tareas)
//   #/mantenimientos/plantillas/checklist/<id|nuevo>  un checklist de visita
// Catálogo y checklists: solo un admin y con el área `mantenimiento` cortada;
// las tareas del plan van con el área `clientes` (plan_tareas). Los precios de
// Stripe del plan se sincronizan desde Cobros (tanda 3). Prefijos: mpl-, mcl-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { eur } from '../ventas/datos';
import { navPestanas } from './vista';
import { FRECUENCIAS } from './datos';

export interface Plan {
  id: string; nombre: string; orden: number; precio_mensual: number | null; frecuencia_pago: string | null; revisiones_anuales: number;
  descuento_mano_obra: number; descuento_material: number; coste_presencial_estandar: number | null; coste_presencial_urgente: number | null;
  color: string | null; resumen: string | null; caracteristicas: string[] | null; activo: boolean; notas: string | null;
  contrato_servicios: { incluidos?: string[]; no_incluidos?: string[] } | null; contrato_plantilla: string | null;
}
interface Tarea { id: string; plan: string; nombre: string; periodicidad: string; es_backup: boolean; orden: number }
interface ItemCheck { id: string; texto: string; tipo: 'check' | 'text' | 'number'; obligatorio: boolean }

const PERIODICIDADES = ['mensual', 'trimestral', 'semestral', 'anual'];
let _plan: Plan | null = null;
let _tareas: Tarea[] = [];
let _check: { id: string | null; items: ItemCheck[] } = { id: null, items: [] };

export const planesActivos = async () => (await API.get<Plan[]>('planes_mantenimiento', { select: '*', order: 'orden' })).data ?? [];

export async function pintarPlanes(el: HTMLElement, id?: string, sub?: string) {
  if (id === 'checklist') return pintarChecklistVisita(el, sub ?? 'nuevo');
  if (id) return pintarPlan(el, id === 'nuevo' ? null : id);
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [planes, cks, escribe] = await Promise.all([
    planesActivos(),
    API.get<{ id: string; nombre: string; plan: string | null; items: ItemCheck[]; activa: boolean }[]>('checklist_plantillas', { select: 'id,nombre,plan,items,activa', order: 'nombre' }),
    esDelHub('planes_mantenimiento'),
  ]);
  const puede = escribe && esAdmin();
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('Los planes de mantenimiento')}${navPestanas('plantillas')}
    <div class="tarjeta-cab"><h2>Planes</h2>${puede ? `<div class="acciones"><a class="btn" href="#/mantenimientos/plantillas/nuevo">${ico('mas')} Nuevo plan</a></div>` : ''}</div>
    <div class="mpl-planes">${planes.map(p => `<article class="tarjeta mpl-plan ${p.activo ? '' : 'mpl-inactivo'}" data-plan="${esc(p.id)}">
      <h3><span class="hex-punto" aria-hidden="true"></span> ${esc(p.nombre)}</h3>
      <p class="di-valor">${p.precio_mensual != null ? `${eur(p.precio_mensual, 2)}<small class="nota">/mes sin impuestos</small>` : '<small class="nota">Sin cuota</small>'}</p>
      ${p.resumen ? `<p class="nota">${esc(p.resumen)}</p>` : ''}
      ${(p.caracteristicas ?? []).length ? `<ul>${(p.caracteristicas ?? []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <p>${[p.revisiones_anuales ? `${p.revisiones_anuales} rev./año` : '', p.descuento_mano_obra ? `−${p.descuento_mano_obra} % mano de obra` : '',
        p.descuento_material ? `−${p.descuento_material} % material` : '', p.coste_presencial_estandar != null ? `visita ${eur(p.coste_presencial_estandar)}` : '',
        p.coste_presencial_urgente != null ? `urgente ${eur(p.coste_presencial_urgente)}` : '', p.activo ? '' : 'Inactivo'].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join(' ')}</p>
      ${puede ? `<a class="btn secundario" href="#/mantenimientos/plantillas/${esc(p.id)}">${ico('editar')} Editar</a>` : `<a class="btn secundario" href="#/mantenimientos/plantillas/${esc(p.id)}">Ver</a>`}</article>`).join('')
      || '<p class="vacio">Sin planes (llegan de la app con la copia de cada noche).</p>'}</div>
    <div class="tarjeta-cab"><h2>Checklists de visita</h2>${puede ? `<div class="acciones"><a class="btn secundario" href="#/mantenimientos/plantillas/checklist/nuevo">${ico('mas')} Nuevo checklist</a></div>` : ''}</div>
    <p class="nota">Se rellenan en la ficha del trabajo de mantenimiento: el del plan de la sede o, si no hay, el genérico.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="mcl-tabla"><thead><tr><th>Checklist</th><th>Plan</th><th class="num">Puntos</th><th></th></tr></thead>
      <tbody>${(cks.data ?? []).map(c => `<tr><td><strong>${esc(c.nombre)}</strong>${c.activa ? '' : ' <span class="chip">Inactivo</span>'}</td><td>${esc(c.plan ?? 'Genérico')}</td>
        <td class="num">${(c.items ?? []).length}</td><td><a class="btn secundario" href="#/mantenimientos/plantillas/checklist/${esc(c.id)}">${puede ? `${ico('editar')} Editar` : 'Ver'}</a></td></tr>`).join('')
        || '<tr><td colspan="4" class="vacio">Sin checklists.</td></tr>'}</tbody></table></div>`;
}

async function pintarPlan(el: HTMLElement, id: string | null) {
  const [{ data: p }, escribe, tareasHub] = await Promise.all([
    id ? API.single<Plan>('planes_mantenimiento', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null }),
    esDelHub('planes_mantenimiento'), esDelHub('plan_tareas'),
  ]);
  if (id && !p) { el.innerHTML = '<p class="aviso mal">No existe ese plan.</p><p><a href="#/mantenimientos/plantillas">← Plantillas</a></p>'; return; }
  _plan = p;
  _tareas = p ? (await API.get<Tarea[]>('plan_tareas', { select: 'id,plan,nombre,periodicidad,es_backup,orden', plan: `eq.${p.nombre}`, activa: 'eq.true', order: 'orden' })).data ?? [] : [];
  const puede = escribe && esAdmin();
  const n = (k: keyof Plan, t: string, extra = 'type="number" step="0.01" min="0"') => `<label>${t} <input id="mpl-${String(k)}" ${extra} value="${esc(p?.[k] ?? '')}"></label>`;
  const srv = p?.contrato_servicios ?? {};
  el.innerHTML = `<p><a href="#/mantenimientos/plantillas">← Plantillas</a></p><h2>${p ? `Plan ${esc(p.nombre)}` : 'Nuevo plan'}</h2>
    ${escribe ? (esAdmin() ? '' : '<p class="aviso">Solo un administrador cambia los planes.</p>') : avisoSoloLectura('Los planes de mantenimiento')}
    <form class="tarjeta" id="mpl-form" data-on-submit="mplGuardar" data-prevent="1">
      <div class="in-campos"><label>Nombre <span class="nota">(obligatorio)</span> <input id="mpl-nombre" required value="${esc(p?.nombre ?? '')}" ${p ? 'readonly title="Las sedes lo llevan por el nombre: no se cambia"' : ''}></label>
        ${n('orden', 'Orden', 'type="number" step="1"')}
        ${n('precio_mensual', 'Precio €/mes (sin impuestos)')}
        <label>Frecuencia de pago <select id="mpl-frecuencia_pago">${FRECUENCIAS.map(([f]) => `<option ${f === (p?.frecuencia_pago ?? 'Mensual') ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div>
      <div class="in-campos">${n('revisiones_anuales', 'Revisiones al año', 'type="number" step="1" min="0"')}${n('descuento_mano_obra', 'Dto. mano de obra %', 'type="number" step="1" min="0" max="100"')}
        ${n('descuento_material', 'Dto. material %', 'type="number" step="1" min="0" max="100"')}${n('coste_presencial_estandar', 'Visita estándar €')}${n('coste_presencial_urgente', 'Visita urgente €')}</div>
      <label>Resumen <input id="mpl-resumen" value="${esc(p?.resumen ?? '')}"></label>
      <label>Características <span class="nota">(una por línea)</span> <textarea id="mpl-caracteristicas" rows="4">${esc((p?.caracteristicas ?? []).join('\n'))}</textarea></label>
      <div class="in-campos"><label>En el contrato: servicios incluidos <span class="nota">(uno por línea)</span> <textarea id="mpl-incluidos" rows="4">${esc((srv.incluidos ?? []).join('\n'))}</textarea></label>
        <label>Servicios NO incluidos <textarea id="mpl-no-incluidos" rows="4">${esc((srv.no_incluidos ?? []).join('\n'))}</textarea></label></div>
      <label class="check"><input type="checkbox" id="mpl-activo" ${p?.activo === false ? '' : 'checked'}> Activo (se ofrece en contratos nuevos)</label>
      <div class="acciones"><button class="btn" type="submit" ${puede ? '' : 'disabled'}>${p ? 'Guardar' : 'Crear plan'}</button>
        <a class="btn secundario" href="#/mantenimientos/plantillas">Cancelar</a></div></form>
    ${p ? `<section class="tarjeta"><h3>Tareas de seguimiento del plan</h3>
      <p class="nota">Las que se marcan por periodo en la ficha de cada sede y en Checklist. Las de copia de seguridad salen aparte en la tabla maestra.</p>
      <div id="mpl-tareas">${filasTareas(tareasHub && esAdmin())}</div>
      ${tareasHub && esAdmin() ? `<button type="button" class="btn secundario" data-action="mplTareaNueva">${ico('mas')} Tarea</button>` : ''}</section>` : ''}`;
}

function filasTareas(puede: boolean): string {
  return `<table class="tabla" id="mpl-tareas-tabla"><thead><tr><th>Tarea</th><th>Cada</th><th>Copia</th>${puede ? '<th></th>' : ''}</tr></thead><tbody>${_tareas.map(t => puede
    ? `<tr data-tarea="${esc(t.id)}"><td><input value="${esc(t.nombre)}" aria-label="Tarea" data-on-change="mplTarea:${t.id},nombre,$value"></td>
      <td><select aria-label="Periodicidad" data-on-change="mplTarea:${t.id},periodicidad,$value">${PERIODICIDADES.map(x => `<option ${x === t.periodicidad ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><input type="checkbox" aria-label="Es copia de seguridad" ${t.es_backup ? 'checked' : ''} data-on-change="mplTarea:${t.id},es_backup,$checked"></td>
      <td><button type="button" class="btn secundario" data-action="mplTareaQuitar" data-p0="${esc(t.id)}" aria-label="Quitar">${ico('eliminar')}</button></td></tr>`
    : `<tr><td>${esc(t.nombre)}</td><td>${esc(t.periodicidad)}</td><td>${t.es_backup ? 'Sí' : ''}</td></tr>`).join('')
    || `<tr><td colspan="${puede ? 4 : 3}" class="vacio">Sin tareas.</td></tr>`}</tbody></table>`;
}

async function pintarChecklistVisita(el: HTMLElement, id: string) {
  const [{ data: c }, planes, escribe] = await Promise.all([
    id !== 'nuevo' ? API.single<{ id: string; nombre: string; plan: string | null; items: ItemCheck[]; activa: boolean }>('checklist_plantillas', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null }),
    planesActivos(), esDelHub('checklist_plantillas'),
  ]);
  if (id !== 'nuevo' && !c) { el.innerHTML = '<p class="aviso mal">No existe ese checklist.</p><p><a href="#/mantenimientos/plantillas">← Plantillas</a></p>'; return; }
  _check = { id: c?.id ?? null, items: (c?.items ?? []).map(x => ({ ...x })) };
  const puede = escribe && esAdmin();
  el.innerHTML = `<p><a href="#/mantenimientos/plantillas">← Plantillas</a></p><h2>${c ? 'Editar checklist de visita' : 'Nuevo checklist de visita'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los checklists de visita')}
    <form class="tarjeta" id="mcl-form" data-on-submit="mclGuardar" data-prevent="1">
      <div class="in-campos"><label>Nombre <input id="mcl-nombre" required value="${esc(c?.nombre ?? '')}"></label>
        <label>Plan <select id="mcl-plan"><option value="">Genérico (cualquier plan)</option>${planes.map(p => `<option ${p.nombre === c?.plan ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label></div>
      <div id="mcl-items">${filasItems()}</div>
      <button type="button" class="btn secundario" data-action="mclItem">${ico('mas')} Punto</button>
      <label class="check"><input type="checkbox" id="mcl-activa" ${c?.activa === false ? '' : 'checked'}> Activo</label>
      <div class="acciones"><button class="btn" type="submit" ${puede ? '' : 'disabled'}>Guardar</button><a class="btn secundario" href="#/mantenimientos/plantillas">Cancelar</a></div></form>`;
}

function filasItems(): string {
  return _check.items.map((it, i) => `<div class="in-campos" data-item="${i}">
    <label>Punto <input value="${esc(it.texto)}" data-on-change="mclCampo:${i},texto,$value"></label>
    <label>Tipo <select data-on-change="mclCampo:${i},tipo,$value">${[['check', 'Casilla'], ['text', 'Texto'], ['number', 'Número']].map(([k, n]) => `<option value="${k}" ${k === it.tipo ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" ${it.obligatorio ? 'checked' : ''} data-on-change="mclCampo:${i},obligatorio,$checked"> Obligatorio</label>
    <button type="button" class="btn secundario" data-action="mclQuitar" data-p0="${i}" aria-label="Quitar">${ico('eliminar')}</button></div>`).join('') || '<p class="nota">Sin puntos todavía.</p>';
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const lineas = (id: string) => val(id).split('\n').map(x => x.trim()).filter(Boolean);
const num = (id: string) => { const v = val(id); return v === '' ? null : Number(v.replace(',', '.')); };

registrarAcciones({
  async mplGuardar() {
    const nombre = val('mpl-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const cuerpo = {
      nombre, orden: num('mpl-orden') ?? 0, precio_mensual: num('mpl-precio_mensual'), frecuencia_pago: val('mpl-frecuencia_pago') || 'Mensual',
      revisiones_anuales: num('mpl-revisiones_anuales') ?? 0, descuento_mano_obra: num('mpl-descuento_mano_obra') ?? 0, descuento_material: num('mpl-descuento_material') ?? 0,
      coste_presencial_estandar: num('mpl-coste_presencial_estandar'), coste_presencial_urgente: num('mpl-coste_presencial_urgente'),
      resumen: val('mpl-resumen') || null, caracteristicas: lineas('mpl-caracteristicas'),
      contrato_servicios: { incluidos: lineas('mpl-incluidos'), no_incluidos: lineas('mpl-no-incluidos') },
      activo: (document.getElementById('mpl-activo') as HTMLInputElement).checked,
    };
    const r = _plan ? await API.patch('planes_mantenimiento', { id: `eq.${_plan.id}` }, cuerpo) : await API.post('planes_mantenimiento', cuerpo);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast(_plan ? 'Plan guardado' : 'Plan creado'); ir('mantenimientos', 'plantillas');
  },
  async mplTarea(id: string, campo: 'nombre' | 'periodicidad' | 'es_backup', v: string | boolean) {
    const r = await API.patch('plan_tareas', { id: `eq.${id}` }, { [campo]: v });
    if (r.error) toast(`No se pudo guardar la tarea: ${r.error.message}`, 'error');
  },
  async mplTareaNueva() {
    if (!_plan) return;
    const r = await API.post('plan_tareas', { plan: _plan.nombre, nombre: 'Nueva tarea', periodicidad: 'mensual', es_backup: false, orden: _tareas.length, activa: true });
    if (r.error) { toast(`No se pudo añadir: ${r.error.message}`, 'error'); return; }
    resolver();
  },
  async mplTareaQuitar(id: string) {
    if (!confirm('¿Quitar esta tarea del plan? Lo ya marcado en las sedes se queda.')) return;
    const r = await API.patch('plan_tareas', { id: `eq.${id}` }, { activa: false });
    if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
    resolver();
  },
  mclCampo(i: string, k: 'texto' | 'tipo' | 'obligatorio', v: string | boolean) { const it = _check.items[Number(i)]; if (it) (it as unknown as Record<string, unknown>)[k] = v; },
  mclItem() { _check.items.push({ id: crypto.randomUUID(), texto: '', tipo: 'check', obligatorio: false }); const c = document.getElementById('mcl-items'); if (c) c.innerHTML = filasItems(); },
  mclQuitar(i: string) { _check.items.splice(Number(i), 1); const c = document.getElementById('mcl-items'); if (c) c.innerHTML = filasItems(); },
  async mclGuardar() {
    const nombre = val('mcl-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const cuerpo = { nombre, plan: val('mcl-plan') || null, items: _check.items.filter(x => x.texto.trim()), activa: (document.getElementById('mcl-activa') as HTMLInputElement).checked };
    const r = _check.id ? await API.patch('checklist_plantillas', { id: `eq.${_check.id}` }, cuerpo) : await API.post('checklist_plantillas', cuerpo);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast('Checklist guardado'); ir('mantenimientos', 'plantillas');
  },
});
