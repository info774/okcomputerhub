// Checklist de Mantenimientos (pestaña «Checklist» de la app): cada sede con
// plan × cada tarea activa de su plan, en el periodo ACTUAL de la tarea
// (mes, trimestre, semestre o año), cruzado con lo marcado en
// sitio_tarea_seguimiento. Marcar = una fila; desmarcar = quitarla (la misma
// regla que la pestaña «Seguimiento» de la ficha del sitio). Área `clientes`.
// Prefijo de ids: mck-.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { periodoKey, periodoLabel } from '../sitios/equipamiento';
import { navPestanas } from './vista';

interface Par { local_id: string; sede: string; tarea_id: string; tarea: string; periodicidad: string; es_backup: boolean; periodo: string; hecho_id: string | null }

let _pares: Par[] = [];
let _estado = 'pendiente';   // 'pendiente' | 'todas'
let _soloBackup = false;

export async function pintarChecklist(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [ls, ts, hs, escribe] = await Promise.all([
    API.fetchAll<{ id: string; nombre: string; plan: string }>('locales', { select: 'id,nombre,plan', plan: 'not.in.("Sin mantenimiento","")', activo: 'neq.false', order: 'nombre' }),
    API.get<{ id: string; plan: string; nombre: string; periodicidad: string; es_backup: boolean }[]>('plan_tareas', { select: 'id,plan,nombre,periodicidad,es_backup', activa: 'eq.true', order: 'orden' }),
    API.fetchAll<{ id: string; local_id: string; tarea_id: string; periodo: string }>('sitio_tarea_seguimiento', { select: 'id,local_id,tarea_id,periodo' }),
    esDelHub('sitio_tarea_seguimiento'),
  ]);
  if (ls.error || ts.error) { el.innerHTML = `<p class="aviso mal">${esc((ls.error ?? ts.error)!.message)}</p>`; return; }
  const hecho = new Map((hs.data ?? []).map(h => [`${h.local_id}|${h.tarea_id}|${h.periodo}`, h.id]));
  _pares = [];
  for (const s of ls.data ?? []) for (const t of (ts.data ?? []).filter(x => x.plan === s.plan)) {
    const periodo = periodoKey(t.periodicidad);
    _pares.push({ local_id: s.id, sede: s.nombre, tarea_id: t.id, tarea: t.nombre, periodicidad: t.periodicidad, es_backup: t.es_backup, periodo, hecho_id: hecho.get(`${s.id}|${t.id}|${periodo}`) ?? null });
  }
  const pendientes = _pares.filter(p => !p.hecho_id).length;
  const vistos = _pares.filter(p => (_estado === 'todas' || !p.hecho_id) && (!_soloBackup || p.es_backup));
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('El seguimiento de las tareas del plan')}${navPestanas('checklist')}
    <div class="acciones mo-barra">
      <div class="segmentado" role="tablist">${[['pendiente', 'Pendientes'], ['todas', 'Todas']].map(([k, n]) => `<button role="tab" aria-selected="${k === _estado}" class="${k === _estado ? 'activo' : ''}" data-action="mckEstado" data-p0="${k}">${n}</button>`).join('')}</div>
      <button class="chip-boton ${_soloBackup ? 'activo' : ''}" data-action="mckBackup" aria-pressed="${_soloBackup}">Solo copias de seguridad</button></div>
    <p class="nota">${pendientes} ${pendientes === 1 ? 'tarea pendiente' : 'tareas pendientes'} de ${_pares.length} en el periodo actual.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="mck-tabla"><thead><tr><th></th><th>Sede</th><th>Tarea</th><th>Periodo</th></tr></thead>
      <tbody>${vistos.map(p => `<tr data-par="${esc(`${p.local_id}|${p.tarea_id}`)}">
        <td><button class="si-seg-celda${p.hecho_id ? ' hecha' : ''}" ${escribe ? `data-action="mckMarcar" data-p0="${esc(p.local_id)}" data-p1="${esc(p.tarea_id)}"` : 'disabled'}
          aria-pressed="${!!p.hecho_id}" aria-label="${p.hecho_id ? 'Hecha' : 'Marcar hecha'}">${p.hecho_id ? '✓' : ''}</button></td>
        <td><a href="#/sitios/${esc(p.local_id)}/seguimiento">${esc(p.sede)}</a></td>
        <td>${esc(p.tarea)}${p.es_backup ? ' <span class="chip">Backup</span>' : ''}</td>
        <td>${esc(periodoLabel(p.periodicidad, p.periodo))} <small class="nota">${esc(p.periodicidad)}</small></td></tr>`).join('')
        || '<tr><td colspan="4" class="vacio">Nada pendiente en este periodo.</td></tr>'}</tbody></table></div>`;
}

registrarAcciones({
  mckEstado(k: string) { _estado = k; resolver(); },
  mckBackup() { _soloBackup = !_soloBackup; resolver(); },
  async mckMarcar(localId: string, tareaId: string) {
    const p = _pares.find(x => x.local_id === localId && x.tarea_id === tareaId);
    if (!p) return;
    const r = p.hecho_id
      ? await API.delete('sitio_tarea_seguimiento', { id: `eq.${p.hecho_id}` })
      : await API.post('sitio_tarea_seguimiento', { local_id: localId, tarea_id: tareaId, periodo: p.periodo, completado: true, completado_por: usuario()?.id ?? null });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    resolver();
  },
});
