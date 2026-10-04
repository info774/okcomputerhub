// «+ Contrato» de Mantenimientos (openNewMant / openEditMant / saveMantenimiento
// de la app): da a una sede su plan con la cuota NETA y la frecuencia, apunta
// el mantenimiento programado (próxima revisión según la cadencia del plan) y
// el plan en el cliente. #/mantenimientos/alta y /alta/<id programado>.
// Reglas de la app: a una sede que ya cobra Stripe NO se le tocan plan, importe
// ni frecuencia (eso es «Cambiar plan» de Cobros, que habla con Stripe); lo
// tecleado es neto, así que quita la marca de bruto heredado de Zoho.
// Prefijo de ids: mal-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { buscarClientes, eur } from '../ventas/datos';
import { FRECUENCIAS, normalizaFrecuencia, fechaCorta } from './datos';
import { planesActivos, type Plan } from './planes';
import { olvidarMantenimientos } from './vista';

// PLAN_INFO de la app: cada cuántos meses toca la revisión. Un plan que no
// esté aquí la saca de sus revisiones al año (o no programa ninguna).
const CADENCIA: Record<string, number> = { Basic: 12, Premium: 3, Silver: 6, Gold: 1 };
const mesesRevision = (p: Plan | undefined) => p ? CADENCIA[p.nombre] ?? (p.revisiones_anuales > 0 ? Math.round(12 / p.revisiones_anuales) : 0) : 0;

interface Programado { id: string; cliente_id: string | null; local_id: string | null; contacto_id: string | null; plan: string | null; proxima_fecha: string | null; ultimo_generado: string | null }

let _id: string | null = null;
let _planes: Plan[] = [];
let _timer: number | undefined;
const hoy = () => new Date().toLocaleDateString('sv-SE');
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const poner = (id: string, v: string) => { const e = document.getElementById(id) as HTMLInputElement | null; if (e) e.value = v; };

async function opciones(tabla: 'locales' | 'contactos', clienteId: string | null, elegida: string | null, vacio: string) {
  if (!clienteId) return `<option value="">${vacio}</option>`;
  const { data } = await API.get<{ id: string; nombre: string }[]>(tabla, { select: 'id,nombre', cliente_id: `eq.${clienteId}`, activo: 'neq.false', order: 'nombre' });
  return `<option value="">${vacio}</option>${(data ?? []).map(x => `<option value="${esc(x.id)}" ${x.id === elegida ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}`;
}

export async function pintarAlta(el: HTMLElement, id?: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [escribe, planes, prog] = await Promise.all([
    esDelHub('mantenimientos_programados', 'locales', 'clientes'), planesActivos(),
    id ? API.single<Programado>('mantenimientos_programados', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null }),
  ]);
  const m = prog.data;
  if (id && !m) { el.innerHTML = '<p class="aviso mal">Ese mantenimiento programado ya no existe.</p><p><a href="#/mantenimientos/locales">← Locales</a></p>'; return; }
  _id = m?.id ?? null;
  _planes = planes.filter(p => p.activo || p.nombre === m?.plan);
  const [cli, sede] = await Promise.all([
    m?.cliente_id ? API.single<{ id: string; nombre: string }>('clientes', { select: 'id,nombre', id: `eq.${m.cliente_id}` }) : Promise.resolve({ data: null }),
    m?.local_id ? API.single<{ importe_mantenimiento: number | null; frecuencia_pago: string | null }>('locales', { select: 'importe_mantenimiento,frecuencia_pago', id: `eq.${m.local_id}` }) : Promise.resolve({ data: null }),
  ]);
  const [sedes, contactos] = await Promise.all([opciones('locales', m?.cliente_id ?? null, m?.local_id ?? null, '— Sin sede —'), opciones('contactos', m?.cliente_id ?? null, m?.contacto_id ?? null, '— Sin contacto —')]);
  const frec = normalizaFrecuencia(sede.data?.frecuencia_pago) ?? 'Mensual';
  el.innerHTML = `<p><a href="#/mantenimientos/locales">← Locales</a></p><h2>${m ? 'Editar contrato' : 'Nuevo contrato'}</h2>
    ${escribe ? '' : avisoSoloLectura('El alta de los contratos de mantenimiento')}
    <form class="tarjeta" id="mal-form" data-on-submit="malGuardar" data-prevent="1">
      <label>Cliente <input id="mal-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli.data?.nombre ?? '')}" data-on-input="malBuscarCliente:$value" ${m ? 'readonly' : ''}></label>
      <input type="hidden" id="mal-cliente" value="${esc(m?.cliente_id ?? '')}"><ul id="mal-cliente-res" class="resultados"></ul>
      <div class="in-campos"><label>Sede <select id="mal-sede">${sedes}</select></label><label>Contacto <select id="mal-contacto">${contactos}</select></label></div>
      <fieldset><legend>Plan</legend><div class="acciones" id="mal-planes">${_planes.map(p => `<button type="button" class="chip-boton ${p.nombre === m?.plan ? 'activo' : ''}"
        data-action="malPlan" data-p0="${esc(p.nombre)}" aria-pressed="${p.nombre === m?.plan}">${esc(p.nombre)}${p.precio_mensual != null ? ` · ${eur(p.precio_mensual)}` : ''}</button>`).join('') || '<span class="nota">No hay planes: créalos en Plantillas.</span>'}</div>
        <input type="hidden" id="mal-plan" value="${esc(m?.plan ?? '')}"><p class="nota" id="mal-plan-info"></p></fieldset>
      <div class="in-campos"><label>Cuota €/mes (sin impuestos) <input id="mal-importe" type="number" step="0.01" min="0" value="${sede.data?.importe_mantenimiento ?? ''}"></label>
        <label>Frecuencia de pago <select id="mal-frecuencia">${FRECUENCIAS.map(([f]) => `<option ${f === frec ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div>
      <div class="in-campos"><label>Inicio <input id="mal-inicio" type="date" value="${esc(m?.ultimo_generado ?? hoy())}" data-on-change="malRecalcular"></label>
        <label>Próxima revisión <input id="mal-proxima" type="date" value="${esc(m?.proxima_fecha ?? '')}"></label></div>
      <p class="nota" id="mal-proxima-auto">${m ? '' : 'Elige un plan y se calcula la próxima revisión.'}</p>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${m ? 'Guardar' : 'Crear contrato'}</button>
        <a class="btn secundario" href="#/mantenimientos/locales">Cancelar</a></div></form>`;
}

function recalcular() {
  const p = _planes.find(x => x.nombre === val('mal-plan'));
  const meses = mesesRevision(p), info = document.getElementById('mal-proxima-auto');
  if (!p) return;
  if (!meses) { if (info) info.textContent = 'Este plan no programa revisiones periódicas.'; return; }
  const d = new Date(`${val('mal-inicio') || hoy()}T12:00`);
  d.setMonth(d.getMonth() + meses);
  const f = d.toLocaleDateString('sv-SE');
  poner('mal-proxima', f);
  if (info) info.textContent = `Próxima revisión calculada: ${fechaCorta(f)} (cada ${meses} ${meses === 1 ? 'mes' : 'meses'}).`;
}

registrarAcciones({
  malBuscarCliente(q: string) {
    clearTimeout(_timer);
    poner('mal-cliente', '');
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById('mal-cliente-res'); if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="malElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}</button></li>`).join('');
    }, 250);
  },
  async malElegirCliente(id: string, nombre: string) {
    poner('mal-cliente', id); poner('mal-cliente-q', nombre);
    const ul = document.getElementById('mal-cliente-res'); if (ul) ul.innerHTML = '';
    const [s, c] = await Promise.all([opciones('locales', id, null, '— Sin sede —'), opciones('contactos', id, null, '— Sin contacto —')]);
    const ss = document.getElementById('mal-sede'); if (ss) ss.innerHTML = s;
    const cc = document.getElementById('mal-contacto'); if (cc) cc.innerHTML = c;
  },
  // setMantPlan de la app: rellena cuota y frecuencia con las del plan (se
  // pueden cambiar) y calcula la próxima revisión.
  malPlan(nombre: string) {
    poner('mal-plan', nombre);
    document.querySelectorAll<HTMLButtonElement>('#mal-planes .chip-boton').forEach(b => { const on = b.dataset.p0 === nombre; b.classList.toggle('activo', on); b.setAttribute('aria-pressed', String(on)); });
    const p = _planes.find(x => x.nombre === nombre);
    if (p) {
      poner('mal-importe', p.precio_mensual != null ? String(p.precio_mensual) : '');
      const f = normalizaFrecuencia(p.frecuencia_pago); if (f) poner('mal-frecuencia', f);
      const info = document.getElementById('mal-plan-info');
      if (info) info.textContent = [p.resumen, ...(p.caracteristicas ?? []).slice(0, 4)].filter(Boolean).join(' · ');
    }
    recalcular();
  },
  malRecalcular() { recalcular(); },
  async malGuardar() {
    const clienteId = val('mal-cliente') || null, localId = val('mal-sede') || null, plan = val('mal-plan');
    if (!clienteId && !localId) { toast('Elige un cliente o una sede', 'error'); return; }
    if (!plan) { toast('Elige un plan', 'error'); return; }
    const inicio = val('mal-inicio') || hoy(), proxima = val('mal-proxima') || null;
    const importe = val('mal-importe') === '' ? null : Number(val('mal-importe').replace(',', '.'));
    const frecuencia = val('mal-frecuencia') || null, contactoId = val('mal-contacto') || null;
    const r = _id
      ? await API.patch('mantenimientos_programados', { id: `eq.${_id}` }, { plan, local_id: localId, contacto_id: contactoId, proxima_fecha: proxima, activo: true })
      : await API.post('mantenimientos_programados', { cliente_id: clienteId, local_id: localId, contacto_id: contactoId, plan, proxima_fecha: proxima, ultimo_generado: inicio, activo: true });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    const errores: string[] = [];
    if (!_id && clienteId) { const c = await API.patch('clientes', { id: `eq.${clienteId}` }, { plan, fecha_activacion: inicio }); if (c.error) errores.push(c.error.message); }
    let aviso = '';
    if (localId) {
      const { data: s } = await API.single<{ stripe_subscription_id: string | null }>('locales', { select: 'stripe_subscription_id', id: `eq.${localId}` });
      if (s?.stripe_subscription_id) aviso = ' · La cuota de esta sede se cobra en Stripe: cámbiala desde Cobros → «Cambiar plan»';
      else {
        const cuerpo: Record<string, unknown> = { plan };
        if (importe != null && !Number.isNaN(importe)) { cuerpo.importe_mantenimiento = importe; cuerpo.importe_incluye_impuesto = false; }
        if (frecuencia) cuerpo.frecuencia_pago = frecuencia;
        const l = await API.patch('locales', { id: `eq.${localId}` }, cuerpo);
        if (l.error) errores.push(l.error.message);
      }
    }
    olvidarMantenimientos();
    if (errores.length) { toast(`El contrato se guardó, pero no todo: ${errores[0]}`, 'error'); return; }
    toast((_id ? 'Contrato actualizado' : 'Contrato creado') + aviso);
    ir('mantenimientos', 'locales');
  },
});
