// Plantillas de presupuesto (modal «Plantillas» de la app: renderPlantillasList,
// savePlantilla, desactivarPlantilla): #/presupuestos/plantillas (lista),
// #/presupuestos/plantillas/nueva y #/presupuestos/plantillas/<id> (editar).
// Espejo `presupuesto_plantillas` (área `presupuestos`); quitar una es
// `activa = false`, nunca borrarla. Prefijo de ids: ppl-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { eur } from '../ventas/datos';
import { editorLineas, lineasDe, aLinea, totalDe } from './lineas';
import { plantillasActivas, type Plantilla } from './formulario';

let _id: string | null = null;

export async function pintarPlantillas(el: HTMLElement, id?: string) {
  const escribe = await esDelHub('presupuesto_plantillas');
  if (id) return pintarEdicion(el, id === 'nueva' ? null : id, escribe);
  const ps = await plantillasActivas();
  el.innerHTML = `<p><a href="#/presupuestos">← Presupuestos</a></p>
    <div class="tarjeta-cab"><h2>Plantillas de presupuesto</h2>
      ${escribe ? '<div class="acciones"><a class="btn" href="#/presupuestos/plantillas/nueva">+ Nueva plantilla</a></div>' : ''}</div>
    ${escribe ? '' : avisoSoloLectura('Las plantillas de presupuesto')}
    <p class="nota">Al crear un presupuesto se eligen una o varias y sus líneas se juntan.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="ppl-tabla"><thead><tr><th>Plantilla</th><th class="num">Líneas</th><th class="num">Total</th>${escribe ? '<th></th>' : ''}</tr></thead>
      <tbody>${ps.map(p => {
        const ls = (p.lineas ?? []).map(aLinea);
        return `<tr data-plantilla="${esc(p.id)}"><td><strong>${esc(p.icono ?? '📄')} ${esc(p.nombre)}</strong>${p.descripcion ? `<br><small class="nota">${esc(p.descripcion)}</small>` : ''}</td>
          <td class="num">${ls.length}</td><td class="num">${eur(totalDe(ls), 2)}</td>
          ${escribe ? `<td class="acciones"><a class="btn secundario" href="#/presupuestos/plantillas/${esc(p.id)}">✎ Editar</a>
            <button class="btn secundario" data-action="pplQuitar" data-p0="${esc(p.id)}">Quitar</button></td>` : ''}</tr>`;
      }).join('') || `<tr><td colspan="${escribe ? 4 : 3}" class="vacio">Sin plantillas.</td></tr>`}</tbody></table></div>`;
}

async function pintarEdicion(el: HTMLElement, id: string | null, escribe: boolean) {
  const p = id ? (await API.single<Plantilla>('presupuesto_plantillas', { select: 'id,nombre,descripcion,icono,lineas', id: `eq.${id}` })).data : null;
  if (id && !p) { el.innerHTML = '<p class="aviso mal">No existe esa plantilla.</p><p><a href="#/presupuestos/plantillas">← Plantillas</a></p>'; return; }
  _id = p?.id ?? null;
  el.innerHTML = `<p><a href="#/presupuestos/plantillas">← Plantillas</a></p>
    <h2>${p ? 'Editar plantilla' : 'Nueva plantilla'}</h2>
    ${escribe ? '' : avisoSoloLectura('Las plantillas de presupuesto')}
    <form class="tarjeta" id="ppl-form" data-on-submit="pplGuardar" data-prevent="1">
      <div class="in-campos">
        <label>Icono <input id="ppl-icono" maxlength="4" value="${esc(p?.icono ?? '📄')}"></label>
        <label>Nombre <span class="nota">(obligatorio)</span> <input id="ppl-nombre" required maxlength="120" value="${esc(p?.nombre ?? '')}"></label>
      </div>
      <label>Descripción <input id="ppl-descripcion" value="${esc(p?.descripcion ?? '')}" placeholder="Qué incluye"></label>
      <h3>Líneas</h3>
      ${editorLineas('ppl', (p?.lineas ?? []).map(aLinea), escribe)}
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${p ? 'Guardar' : 'Crear plantilla'}</button>
        <a class="btn secundario" href="#/presupuestos/plantillas">Cancelar</a></div>
    </form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  async pplGuardar() {
    const nombre = val('ppl-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const cuerpo = { nombre, icono: val('ppl-icono') || '📄', descripcion: val('ppl-descripcion') || null, lineas: lineasDe('ppl'), activa: true };
    const r = _id ? await API.patch('presupuesto_plantillas', { id: `eq.${_id}` }, cuerpo) : await API.post('presupuesto_plantillas', cuerpo);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast(_id ? 'Plantilla guardada' : 'Plantilla creada');
    ir('presupuestos', 'plantillas');
  },
  async pplQuitar(id: string) {
    if (!confirm('¿Quitar esta plantilla? Deja de salir al crear presupuestos (no se borra).')) return;
    const r = await API.patch('presupuesto_plantillas', { id: `eq.${id}` }, { activa: false });
    if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
    toast('Plantilla quitada'); resolver();
  },
});
