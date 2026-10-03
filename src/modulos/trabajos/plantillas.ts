// Plantillas de trabajo (plantillas.js de la app, que las tenía en
// Configuración): #/trabajos/plantillas (lista), …/nueva y …/<id> (el MISMO
// formulario para crear y editar). Nombre, tipo, duración estimada,
// descripción y pasos. Se eligen en el alta de un trabajo (formulario.ts:
// rellenan tipo, descripción y duración). «Eliminar» las desactiva
// (`activa = false`), como la app. Van en el área `trabajos`: con dueño `app`
// se ven y no se tocan. Prefijo de ids: tp-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { TIPOS } from './formulario';

export interface Plantilla { id: string; nombre: string; tipo: string; descripcion: string | null; duracion_teorica: number | null; checklist: { texto: string; completado: boolean }[] | null }

export async function plantillasActivas(): Promise<Plantilla[]> {
  const { data } = await API.get<Plantilla[]>('plantillas_trabajo', { select: 'id,nombre,tipo,descripcion,duracion_teorica,checklist', activa: 'eq.true', order: 'nombre' });
  return data ?? [];
}

export const durTexto = (m: number | null | undefined) => (m ? (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`) : '');

let _id: string | null = null;
let _pasos: { texto: string; completado: boolean }[] = [];

export async function pintarPlantillas(el: HTMLElement, cual?: string) {
  const escribe = await esDelHub('trabajos');
  if (!cual) {
    const ps = await plantillasActivas();
    el.innerHTML = `<p><a href="#/trabajos">← Trabajos</a></p><div class="tarjeta-cab"><h2>Plantillas de trabajo</h2>${escribe ? '<a class="btn" href="#/trabajos/plantillas/nueva">+ Nueva plantilla</a>' : ''}</div>
      ${escribe ? '' : avisoSoloLectura('Las plantillas')}
      <p class="nota">Un trabajo que se repite (instalar un TPV, revisar una alarma…) con su tipo, su duración y lo que hay que hacer. Se eligen al dar de alta un trabajo.</p>
      <ul class="tarjeta tp-lista">${ps.map(p => `<li><a href="#/trabajos/plantillas/${esc(p.id)}"><strong>${esc(p.nombre)}</strong></a>
        <small class="nota">${esc([p.tipo, durTexto(p.duracion_teorica), p.checklist?.length ? `${p.checklist.length} pasos` : ''].filter(Boolean).join(' · '))}</small></li>`).join('') || '<li class="vacio">Sin plantillas aún.</li>'}</ul>`;
    return;
  }
  let p: Plantilla | null = null;
  if (cual !== 'nueva') {
    p = (await API.single<Plantilla>('plantillas_trabajo', { select: 'id,nombre,tipo,descripcion,duracion_teorica,checklist', id: `eq.${cual}` })).data;
    if (!p) { el.innerHTML = '<p class="aviso mal">No existe esa plantilla.</p><p><a href="#/trabajos/plantillas">← Plantillas</a></p>'; return; }
  }
  _id = p?.id ?? null;
  _pasos = [...(p?.checklist ?? [])];
  const dis = escribe ? '' : 'disabled';
  el.innerHTML = `<p><a href="#/trabajos/plantillas">← Plantillas</a></p><h2>${p ? 'Editar plantilla' : 'Nueva plantilla'}</h2>
    ${escribe ? '' : avisoSoloLectura('Las plantillas')}
    <form class="tarjeta" id="tp-form" data-on-submit="tpGuardar" data-prevent="1">
      <label>Nombre <input id="tp-nombre" required maxlength="120" value="${esc(p?.nombre ?? '')}" placeholder="Ej: Instalación TPV" ${dis}></label>
      <div class="in-campos">
        <label>Tipo <select id="tp-tipo" ${dis}>${TIPOS.map(x => `<option ${x === (p?.tipo ?? 'Asistencia') ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label>Duración estimada (min) <input id="tp-duracion" type="number" min="15" max="600" step="15" value="${esc(p?.duracion_teorica ?? '')}" ${dis}></label>
      </div>
      <label>Descripción <textarea id="tp-descripcion" rows="4" ${dis}>${esc(p?.descripcion ?? '')}</textarea></label>
      <fieldset><legend>Pasos</legend><ol id="tp-pasos" class="tp-pasos">${pasosHtml(escribe)}</ol>
        ${escribe ? '<div class="acciones"><input id="tp-paso" placeholder="Añadir un paso…" aria-label="Nuevo paso" data-on-keydown="tpPaso" data-key="Enter" data-prevent="1"><button type="button" class="btn secundario" data-action="tpPaso">Añadir</button></div>' : ''}</fieldset>
      <div class="acciones"><button class="btn" type="submit" ${dis}>Guardar</button>
        ${p && escribe ? '<button type="button" class="btn peligro" data-action="tpEliminar">Eliminar</button>' : ''}<a class="btn secundario" href="#/trabajos/plantillas">Cancelar</a></div>
    </form>`;
}

function pasosHtml(escribe: boolean) {
  return _pasos.map((x, i) => `<li>${esc(x.texto)}${escribe ? ` <button type="button" class="icono-btn pequeno" data-action="tpQuitarPaso" data-p0="${i}" aria-label="Quitar el paso">✕</button>` : ''}</li>`).join('') || '<li class="nota">Sin pasos.</li>';
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
registrarAcciones({
  tpPaso() {
    const inp = document.getElementById('tp-paso') as HTMLInputElement | null;
    const t = inp?.value.trim();
    if (!inp || !t) return;
    _pasos.push({ texto: t, completado: false });
    inp.value = '';
    const ol = document.getElementById('tp-pasos'); if (ol) ol.innerHTML = pasosHtml(true);
    inp.focus();
  },
  tpQuitarPaso(i: string) {
    _pasos.splice(Number(i), 1);
    const ol = document.getElementById('tp-pasos'); if (ol) ol.innerHTML = pasosHtml(true);
  },
  async tpGuardar() {
    const nombre = val('tp-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const cuerpo = { nombre, tipo: val('tp-tipo') || 'Asistencia', duracion_teorica: parseInt(val('tp-duracion'), 10) || null, descripcion: val('tp-descripcion') || null, checklist: _pasos };
    const r = _id ? await API.patch('plantillas_trabajo', { id: `eq.${_id}` }, cuerpo) : await API.post('plantillas_trabajo', cuerpo);
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Plantilla guardada');
    location.hash = '#/trabajos/plantillas';
  },
  async tpEliminar() {
    if (!_id || !confirm('¿Eliminar esta plantilla? Los trabajos hechos con ella no cambian.')) return;
    const r = await API.patch('plantillas_trabajo', { id: `eq.${_id}` }, { activa: false });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Plantilla eliminada');
    location.hash = '#/trabajos/plantillas';
  },
});
