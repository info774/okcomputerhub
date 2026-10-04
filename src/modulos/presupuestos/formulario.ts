// Alta y edición de un presupuesto (createPresupuesto / savePresupuesto de la
// app): #/presupuestos/nuevo, #/presupuestos/nuevo/c/<cliente>,
// #/presupuestos/nuevo/o/<oportunidad> y #/presupuestos/<id>/editar, el MISMO
// formulario. Prefijo de ids: pf-.
// - Cliente, sede y contacto; asunto (obligatorio), lo que pide el cliente,
//   quién lo lleva, fecha y, al editar, el estado.
// - Al crear se pueden elegir VARIAS plantillas: sus líneas se juntan (el mismo
//   concepto suma cantidades) y, si el asunto está vacío, se pone su nombre.
// - Las líneas se guardan con hub.presupuesto_guardar_lineas (que pone el total).
// Escribe solo con el área `presupuestos` cortada (RLS + esDelHub).
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { buscarClientes, eur } from '../ventas/datos';
import { editorLineas, lineasDe, sumarLineas, aLinea, totalDe, type LineaEd } from './lineas';

export const ESTADOS_PRESUPUESTO = ['Borrador', 'Enviado', 'Aceptado', 'Rechazado'];
export interface Plantilla { id: string; nombre: string; descripcion: string | null; icono: string | null; lineas: LineaEd[] | null }

let _id: string | null = null;
let _oportunidad: string | null = null;
let _plantillas: Plantilla[] = [];
const _elegidas = new Set<string>();
let _timerCli: number | undefined;
let _tituloAuto = '';   // el asunto que puso una plantilla (se puede cambiar al juntar otra)

export const plantillasActivas = async () =>
  (await API.get<Plantilla[]>('presupuesto_plantillas', { select: 'id,nombre,descripcion,icono,lineas', activa: 'neq.false', order: 'created_at' })).data ?? [];

async function opciones(tabla: 'locales' | 'contactos', clienteId: string | null, elegida: string | null, vacio: string): Promise<string> {
  if (!clienteId) return `<option value="">${vacio}</option>`;
  const { data } = await API.get<{ id: string; nombre: string }[]>(tabla, { select: 'id,nombre', cliente_id: `eq.${clienteId}`, activo: 'neq.false', order: 'nombre' });
  return `<option value="">${vacio}</option>${(data ?? []).map(x => `<option value="${esc(x.id)}" ${x.id === elegida ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}`;
}

export async function pintarFormulario(el: HTMLElement, id?: string, desde?: { cliente?: string; oportunidad?: string; local?: string }) {
  const [escribe, personas] = await Promise.all([esDelHub('presupuestos'), equipo()]);
  let p: any = null;
  if (id) {
    p = (await API.single<any>('presupuestos', { select: '*', id: `eq.${id}` })).data;
    if (!p) { el.innerHTML = '<p class="aviso mal">No existe ese presupuesto.</p><p><a href="#/presupuestos">← Presupuestos</a></p>'; return; }
  }
  // Desde una oportunidad: su cliente, sede, contacto y lo que se habló (la app: oportunidad → presupuesto).
  const opo = !p && desde?.oportunidad
    ? (await API.single<any>('oportunidades', { select: 'id,titulo,descripcion,cliente_id,local_id,contacto_id', id: `eq.${desde.oportunidad}` })).data : null;
  _id = p?.id ?? null;
  _oportunidad = p?.oportunidad_id ?? opo?.id ?? null;
  _elegidas.clear();
  _tituloAuto = '';
  // Desde una sede (#/presupuestos/nuevo/l/<sede>, p. ej. la conversación de WhatsApp): su cliente y ella.
  const sede = !p && desde?.local
    ? (await API.single<{ id: string; cliente_id: string | null }>('locales', { select: 'id,cliente_id', id: `eq.${desde.local}` })).data : null;
  const clienteId = p?.cliente_id ?? opo?.cliente_id ?? desde?.cliente ?? sede?.cliente_id ?? null;
  const [cli, sedes, contactos, lineas, plantillas] = await Promise.all([
    clienteId ? API.single<{ id: string; nombre: string }>('clientes', { select: 'id,nombre', id: `eq.${clienteId}` }) : Promise.resolve({ data: null }),
    opciones('locales', clienteId, p?.local_id ?? opo?.local_id ?? sede?.id ?? null, '— Sin sede —'),
    opciones('contactos', clienteId, p?.contacto_id ?? opo?.contacto_id ?? null, '— Sin contacto —'),
    p ? API.get<any[]>('documento_lineas', { select: 'nombre,cantidad,precio,descuento', presupuesto_id: `eq.${p.id}`, order: 'orden.nullslast,created_at' }) : Promise.resolve({ data: [] }),
    p ? Promise.resolve([]) : plantillasActivas(),
  ]);
  _plantillas = plantillas;
  const atras = p ? `#/presupuestos/${p.id}` : opo ? `#/oportunidades/${opo.id}` : '#/presupuestos';
  const opt = (v: string, t: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  el.innerHTML = `<p><a href="${atras}">← ${p ? esc(p.titulo || 'Presupuesto') : opo ? esc(opo.titulo) : 'Presupuestos'}</a></p>
    <h2>${p ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los presupuestos')}
    <form class="tarjeta" id="pf-form" data-on-submit="pfGuardar" data-prevent="1">
      ${plantillas.length ? `<fieldset class="pf-plantillas"><legend>Partir de plantillas <span class="nota">(se pueden juntar varias)</span></legend>
        <div class="acciones">${plantillas.map(t => `<button type="button" class="chip-boton" data-action="pfPlantilla" data-p0="${esc(t.id)}" aria-pressed="false">${esc(t.icono ?? '📄')} ${esc(t.nombre)}</button>`).join('')}</div>
        <p class="nota" id="pf-plantillas-resumen" aria-live="polite"></p></fieldset>` : ''}
      <label>Cliente <input id="pf-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli.data?.nombre ?? '')}" data-on-input="pfBuscarCliente:$value"></label>
      <input type="hidden" id="pf-cliente" value="${esc(cli.data?.id ?? '')}"><ul id="pf-cliente-res" class="resultados"></ul>
      <div class="in-campos">
        <label>Sede <select id="pf-sede">${sedes}</select></label>
        <label>Contacto <select id="pf-contacto">${contactos}</select></label>
      </div>
      <label>Asunto <span class="nota">(obligatorio)</span> <input id="pf-titulo" required maxlength="200" value="${esc(p?.titulo ?? opo?.titulo ?? '')}" placeholder="Ej.: 4 cámaras y grabador"></label>
      <label>Lo que pide el cliente <textarea id="pf-exigencias" rows="3">${esc(p?.exigencias ?? opo?.descripcion ?? '')}</textarea></label>
      <div class="in-campos">
        <label>Lo lleva <select id="pf-tecnico"><option value="">—</option>${personas.map(x => opt(x.nombre, x.nombre, x.nombre === p?.tecnico_id)).join('')}
          ${p?.tecnico_id && !personas.some(x => x.nombre === p.tecnico_id) ? opt(p.tecnico_id, p.tecnico_id, true) : ''}</select></label>
        <label>Fecha <input id="pf-fecha" type="date" value="${esc(p?.fecha ?? new Date().toLocaleDateString('sv-SE'))}"></label>
        ${p ? `<label>Estado <select id="pf-estado">${ESTADOS_PRESUPUESTO.map(e => opt(e, e, e === (p.estado ?? 'Borrador'))).join('')}</select></label>` : ''}
      </div>
      <h3>Líneas</h3>
      ${editorLineas('pf', (lineas.data ?? []).map(aLinea), escribe)}
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${p ? 'Guardar' : 'Crear presupuesto'}</button>
        <a class="btn secundario" href="${atras}">Cancelar</a></div>
    </form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  pfBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('pf-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('pf-cliente-res');
      if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="pfElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}
        <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  async pfElegirCliente(id: string, nombre: string) {
    (document.getElementById('pf-cliente') as HTMLInputElement).value = id;
    (document.getElementById('pf-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('pf-cliente-res'); if (ul) ul.innerHTML = '';
    const [s, c] = await Promise.all([opciones('locales', id, null, '— Sin sede —'), opciones('contactos', id, null, '— Sin contacto —')]);
    const ss = document.getElementById('pf-sede'); if (ss) ss.innerHTML = s;
    const cc = document.getElementById('pf-contacto'); if (cc) cc.innerHTML = c;
  },
  // Elegir una plantilla SUMA sus líneas (togglePlantillaSeleccion +
  // updatePlantillasSummary de la app); volver a pulsarla no las quita (se
  // quitan a mano en la tabla), para no pisar lo que ya se haya tocado.
  pfPlantilla(id: string) {
    const t = _plantillas.find(x => x.id === id);
    if (!t || _elegidas.has(id)) return;
    _elegidas.add(id);
    sumarLineas('pf', (t.lineas ?? []).map(aLinea));
    document.querySelector(`[data-action="pfPlantilla"][data-p0="${CSS.escape(id)}"]`)?.setAttribute('aria-pressed', 'true');
    document.querySelector(`[data-action="pfPlantilla"][data-p0="${CSS.escape(id)}"]`)?.classList.add('activo');
    const nombres = _plantillas.filter(x => _elegidas.has(x.id)).map(x => x.nombre);
    const titulo = document.getElementById('pf-titulo') as HTMLInputElement;
    if (!titulo.value.trim() || titulo.value === _tituloAuto) titulo.value = _tituloAuto = nombres.length === 1 ? nombres[0] : `Pack ${nombres.join(' + ')}`;
    const r = document.getElementById('pf-plantillas-resumen');
    if (r) r.textContent = `${nombres.length} ${nombres.length === 1 ? 'plantilla' : 'plantillas'}: ${nombres.join(' + ')} · ${lineasDe('pf').length} líneas · ${eur(totalDe(lineasDe('pf')), 2)}`;
  },
  async pfGuardar() {
    const titulo = val('pf-titulo');
    if (!titulo) { toast('El asunto es obligatorio', 'error'); return; }
    const cuerpo: Record<string, unknown> = {
      cliente_id: val('pf-cliente') || null, local_id: val('pf-sede') || null, contacto_id: val('pf-contacto') || null,
      titulo, exigencias: val('pf-exigencias') || null, tecnico_id: val('pf-tecnico') || null, fecha: val('pf-fecha') || null,
    };
    let id = _id;
    if (id) {
      cuerpo.estado = val('pf-estado') || 'Borrador';
      const r = await API.patch('presupuestos', { id: `eq.${id}` }, cuerpo);
      if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    } else {
      const r = await API.post<{ id: string }[]>('presupuestos', { ...cuerpo, estado: 'Borrador', total: 0, oportunidad_id: _oportunidad });
      id = r.data?.[0]?.id ?? null;
      if (r.error || !id) { toast(`No se pudo crear: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    }
    const l = await API.rpc<number>('presupuesto_guardar_lineas', { p_presupuesto: id, p_lineas: lineasDe('pf') });
    if (l.error) { toast(`Guardado, pero las líneas no: ${l.error.message}`, 'error'); ir('presupuestos', id); return; }
    (await import('./vista')).olvidarPresupuestos();
    toast(_id ? 'Presupuesto guardado' : `Presupuesto creado${lineasDe('pf').length ? ` con ${lineasDe('pf').length} líneas` : ''}`);
    ir('presupuestos', id);
  },
});
