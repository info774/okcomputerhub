// El contrato de mantenimiento (modal único `gc-` de la app: generar y editar
// son el MISMO formulario), el enlace para firmarlo (`cl-`) y el firmado
// (`vf-`):
//   #/mantenimientos/contrato/nuevo[/<sede>]   generar (con la sede, sale
//                                              relleno con su plan y su cuota)
//   #/mantenimientos/contrato/<id>             editar
//   #/mantenimientos/contrato/<id>/enlace      el enlace: copiar, firmar aquí,
//                                              WhatsApp o correo
//   #/mantenimientos/contrato/<id>/ver         el documento firmado con la firma
// Reglas de la app: mientras esté PENDIENTE se cambia TODO y se rehace el
// documento (el enlace no cambia); FIRMADO no se toca lo impreso, solo a qué
// sede, cliente y contacto va. Importe vacío: al generar = el del plan; al
// editar = sin cuota. Lo tecleado manda y solo lo vacío se rellena de las
// fichas. Prefijo de ids: mco-.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { buscarClientes, eur } from '../ventas/datos';
import { type Contrato, COLS_CONTRATO, FRECUENCIAS, normalizaFrecuencia, netoMensual, fechaCorta, cuotaPeriodo, IGIC } from './datos';
import { renderContratoDoc, numEs, type PlantillaContrato } from './contrato-doc';
import { planesActivos, type Plan } from './planes';
import { olvidarMantenimientos } from './vista';

let _c: Contrato | null = null;
let _modo: 'nuevo' | 'pendiente' | 'firmado' = 'nuevo';
let _planes: Plan[] = [];
let _timer: number | undefined;
let _enlace = '';

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const poner = (id: string, v: string) => { const e = document.getElementById(id) as HTMLInputElement | null; if (e) e.value = v; };
const lineas = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean);
export const urlFirma = (token: string) => `${location.origin}/contrato.html?token=${encodeURIComponent(token)}`;

async function opciones(tabla: 'locales' | 'contactos', clienteId: string | null, elegida: string | null, vacio: string) {
  if (!clienteId) return `<option value="">${vacio}</option>`;
  const { data } = await API.get<{ id: string; nombre: string }[]>(tabla, { select: 'id,nombre', cliente_id: `eq.${clienteId}`, activo: 'neq.false', order: 'nombre' });
  return `<option value="">${vacio}</option>${(data ?? []).map(x => `<option value="${esc(x.id)}" ${x.id === elegida ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}`;
}

export async function pintarContrato(el: HTMLElement, id: string, sub?: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  if (id !== 'nuevo') {
    const { data } = await API.single<Contrato>('contratos', { select: COLS_CONTRATO, id: `eq.${id}` });
    if (!data) { el.innerHTML = '<p class="aviso mal">Ese contrato ya no existe.</p><p><a href="#/mantenimientos/documentos">← Documentos</a></p>'; return; }
    _c = data;
    if (sub === 'enlace') return pintarEnlace(el, data);
    if (sub === 'ver') return pintarFirmado(el, data.id);
  } else _c = null;
  return pintarFormulario(el, id === 'nuevo' ? sub ?? null : null);
}

// ── Generar / editar ────────────────────────────────────────────────────────
async function pintarFormulario(el: HTMLElement, sedeId: string | null) {
  const c = _c;
  _modo = !c ? 'nuevo' : c.estado === 'firmado' ? 'firmado' : 'pendiente';
  if (c?.estado === 'anulado') { el.innerHTML = '<p class="aviso">Un contrato anulado no se edita.</p><p><a href="#/mantenimientos/documentos">← Documentos</a></p>'; return; }
  const [escribe, planes] = await Promise.all([esDelHub('contratos'), planesActivos()]);
  _planes = planes.filter(p => (p.activo && p.nombre !== 'Sin mantenimiento') || p.nombre === c?.plan_nombre);
  // Con la sede (desde la tabla maestra): su cliente, su plan y su cuota neta.
  const sede = sedeId ? (await API.single<any>('locales', { select: 'id,nombre,cliente_id,plan,importe_mantenimiento,importe_incluye_impuesto,frecuencia_pago', id: `eq.${sedeId}` })).data : null;
  const clienteId = c?.cliente_id ?? sede?.cliente_id ?? null;
  const cli = clienteId ? (await API.single<{ id: string; nombre: string }>('clientes', { select: 'id,nombre', id: `eq.${clienteId}` })).data : null;
  const [sedes, contactos] = await Promise.all([opciones('locales', clienteId, c?.local_id ?? sede?.id ?? null, '— Sin sede —'), opciones('contactos', clienteId, c?.contacto_id ?? null, '— Sin contacto —')]);
  const plan = c?.plan_nombre ?? (sede?.plan && sede.plan !== 'Sin mantenimiento' ? sede.plan : '');
  const tpl = _planes.find(p => p.nombre === plan);
  const importe = c ? c.precio_mensual : sede?.importe_mantenimiento != null ? netoMensual(sede) : tpl?.precio_mensual ?? null;
  const frec = normalizaFrecuencia(c?.frecuencia_pago ?? sede?.frecuencia_pago ?? tpl?.frecuencia_pago) ?? 'Mensual';
  const serv = c?.servicios ?? tpl?.contrato_servicios ?? {};
  const firmado = _modo === 'firmado', nuevo = _modo === 'nuevo';
  const fecha = c ? fechaCorta(c.firmado_at ?? c.created_at) : '';
  el.innerHTML = `<p><a href="#/mantenimientos/documentos">← Documentos</a></p><h2>${nuevo ? 'Firmar contrato' : 'Editar contrato'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los contratos')}
    ${nuevo ? '<ol class="mco-pasos"><li>Cliente y sede</li><li>Plan y cuota</li><li>Datos del documento</li><li>Generar y firmar (aquí o con el enlace)</li></ol>'
      : `<p class="nota" id="mco-resumen"><strong>${esc(c!.plan_nombre)}</strong> · ${esc(c!.cliente_nombre ?? '—')} · ${firmado ? 'firmado' : 'generado'} el ${esc(fecha)} · ${Number(c!.precio_mensual) > 0 ? `cuota ${esc(numEs(Number(c!.precio_mensual)))} €/mes · pago ${esc(frec.toLowerCase())}` : 'sin cuota'}</p>
        <p class="aviso">${firmado ? 'El documento firmado no se toca: sigue diciendo lo mismo que el cliente aceptó. Aquí solo se elige a qué sede se le cobra la cuota y con quién se habla; el precio o el pago anual se cambian en Cobros («Cambiar plan»), para la cuota siguiente.'
          : 'Mientras no esté firmado se puede cambiar TODO: plan, condiciones, características y datos. Al guardar se rehace el documento y el enlace de firma sigue siendo el mismo.'}</p>`}
    <form class="tarjeta" id="mco-form" data-on-submit="mcoGuardar" data-prevent="1">
      <label>Cliente <input id="mco-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli?.nombre ?? '')}" data-on-input="mcoBuscarCliente:$value"></label>
      <input type="hidden" id="mco-cliente" value="${esc(clienteId ?? '')}"><ul id="mco-cliente-res" class="resultados"></ul>
      <div class="in-campos"><label>Sede <select id="mco-sede">${sedes}</select></label><label>Contacto <select id="mco-contacto">${contactos}</select></label></div>
      <div class="mco-impreso" ${firmado ? 'hidden' : ''}>
        <fieldset><legend>Plan</legend><div class="acciones" id="mco-planes">${_planes.map(p => `<button type="button" class="chip-boton ${p.nombre === plan ? 'activo' : ''}" data-action="mcoPlan" data-p0="${esc(p.nombre)}"
          aria-pressed="${p.nombre === plan}">${esc(p.nombre)}${p.precio_mensual != null ? ` · ${eur(p.precio_mensual)}` : ''}</button>`).join('') || '<span class="nota">No hay planes: créalos en Plantillas.</span>'}</div>
          <input type="hidden" id="mco-plan" value="${esc(plan)}"></fieldset>
        <div class="in-campos"><label>Cuota €/mes (sin impuestos) <input id="mco-importe" type="number" step="0.01" min="0" value="${importe ?? ''}" data-on-input="mcoCuota"></label>
          <label>Frecuencia de pago <select id="mco-frecuencia" data-on-change="mcoCuota">${FRECUENCIAS.map(([f]) => `<option ${f === frec ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div>
        <p class="nota" id="mco-cuota-nota" aria-live="polite"></p>
        <h3>Datos que salen en el documento</h3>
        <div class="in-campos"><label>Nombre o razón social <input id="mco-nombre" value="${esc(c?.cliente_nombre ?? '')}" placeholder="Si se deja vacío, el del cliente"></label>
          <label>NIF <input id="mco-nif" value="${esc(c?.cliente_nif ?? '')}" placeholder="El del cliente"></label></div>
        <div class="in-campos"><label>Dirección del establecimiento <input id="mco-direccion" value="${esc(c?.direccion ?? '')}" placeholder="La de la sede"></label>
          <label>Municipio / provincia <input id="mco-municipio" value="${esc(c?.municipio ?? '')}"></label></div>
        <details class="mco-caracs" ${c?.servicios ? 'open' : ''}><summary>Características pactadas (servicios y tarifas)</summary>
          <p class="nota">Salen del plan, pero se pueden retocar para ESTE cliente sin tocar el plan.</p>
          <div class="in-campos"><label>Servicios incluidos <span class="nota">(uno por línea)</span> <textarea id="mco-serv-inc" rows="5">${esc((serv.incluidos ?? []).join('\n'))}</textarea></label>
            <label>No incluidos <textarea id="mco-serv-no" rows="5">${esc((serv.no_incluidos ?? []).join('\n'))}</textarea></label></div>
          <div class="in-campos"><label>Visita estándar € <input id="mco-tarifa-est" type="number" step="0.01" min="0" value="${c?.tarifa_estandar ?? tpl?.coste_presencial_estandar ?? ''}"></label>
            <label>Visita urgente € <input id="mco-tarifa-urg" type="number" step="0.01" min="0" value="${c?.tarifa_urgente ?? tpl?.coste_presencial_urgente ?? ''}"></label></div>
          <button type="button" class="btn secundario" data-action="mcoRestaurar">Restaurar las del plan</button></details>
      </div>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${nuevo ? 'Generar y firmar' : 'Guardar'}</button>
        ${firmado ? '' : '<button type="button" class="btn secundario" data-action="mcoBorrador">👁 Ver borrador</button>'}
        <a class="btn secundario" href="#/mantenimientos/documentos">Cancelar</a></div></form>
    <section class="tarjeta" id="mco-borrador" hidden><h3>Borrador</h3><div class="mco-doc"></div></section>`;
  refrescaCuota();
}

function refrescaCuota() {
  const nota = document.getElementById('mco-cuota-nota'); if (!nota) return;
  const neto = Number(val('mco-importe').replace(',', '.'));
  const frec = normalizaFrecuencia(val('mco-frecuencia')) ?? 'Mensual';
  if (!neto || neto <= 0) { nota.textContent = 'Sin cuota: el contrato se firma pero no se cobra nada.'; return; }
  const { meses, bruto } = cuotaPeriodo(neto, frec);
  const cada = ({ Mensual: 'mes', Trimestral: 'trimestre', Semestral: 'semestre', Anual: 'año' } as Record<string, string>)[frec];
  nota.textContent = `Se le cobrarán ${numEs(bruto)} € cada ${cada} (con el ${IGIC} % de IGIC)${meses > 1 ? ` — ${numEs(neto)} €/mes × ${meses} meses` : ''}.`;
}

function pintarCaracs(p: Plan | undefined) {
  poner('mco-serv-inc', (p?.contrato_servicios?.incluidos ?? []).join('\n'));
  poner('mco-serv-no', (p?.contrato_servicios?.no_incluidos ?? []).join('\n'));
  poner('mco-tarifa-est', p?.coste_presencial_estandar != null ? String(p.coste_presencial_estandar) : '');
  poner('mco-tarifa-urg', p?.coste_presencial_urgente != null ? String(p.coste_presencial_urgente) : '');
}
const leerCaracs = () => ({
  servicios: { incluidos: lineas(val('mco-serv-inc')), no_incluidos: lineas(val('mco-serv-no')) },
  tarifaEst: val('mco-tarifa-est') === '' ? null : Number(val('mco-tarifa-est')), tarifaUrg: val('mco-tarifa-urg') === '' ? null : Number(val('mco-tarifa-urg')),
});

async function plantilla(nombre: string): Promise<PlantillaContrato | null> {
  return _planes.find(p => p.nombre === nombre) ?? (await API.single<PlantillaContrato>('planes_mantenimiento', { select: '*', nombre: `eq.${nombre}` })).data ?? null;
}

// Nombre/NIF del cliente y dirección de la sede SOLO si se dejaron vacíos: lo tecleado manda.
async function datosDoc(clienteId: string | null, localId: string | null) {
  let nombre = val('mco-nombre'), nif = val('mco-nif'), direccion = val('mco-direccion');
  if (clienteId && (!nombre || !nif)) {
    const { data } = await API.single<{ nombre: string; nif: string | null }>('clientes', { select: 'nombre,nif', id: `eq.${clienteId}` });
    if (data) { nombre ||= data.nombre ?? ''; nif ||= data.nif ?? ''; }
  }
  let codigo: string | null = null;
  if (localId) {
    const { data } = await API.single<{ direccion: string | null; codigo_verificacion: string | null }>('locales', { select: 'direccion,codigo_verificacion', id: `eq.${localId}` });
    if (!direccion && data?.direccion) direccion = data.direccion;
    codigo = data?.codigo_verificacion ?? null;
  }
  return { nombre, nif, direccion, municipio: val('mco-municipio'), codigo };
}

// ── El enlace para firmar ───────────────────────────────────────────────────
function pintarEnlace(el: HTMLElement, c: Contrato) {
  _enlace = urlFirma(c.token);
  const msg = `Hola${c.cliente_nombre ? ` ${c.cliente_nombre}` : ''}, aquí tienes tu contrato de mantenimiento ${c.plan_nombre} de OK Computer Tenerife para revisarlo y firmarlo online: ${_enlace}`;
  el.innerHTML = `<p><a href="#/mantenimientos/documentos">← Documentos</a></p><h2>Contrato ${esc(c.plan_nombre)} · ${esc(c.cliente_nombre ?? '')}</h2>
    <section class="tarjeta" id="mco-enlace">
      ${c.estado === 'firmado' ? `<p class="aviso">Firmado por ${esc(c.firmante_nombre ?? '—')} el ${esc(fechaCorta(c.firmado_at))}. El enlace enseña el acuse de firma.</p>`
        : c.estado === 'anulado' ? '<p class="aviso mal">Anulado: el enlace ya no deja firmar.</p>'
        : '<p>Se firma aquí mismo (el cliente delante, en la tablet o el móvil) o se le manda el enlace. El enlace no caduca.</p>'}
      <label>Enlace de firma <input id="mco-url" readonly value="${esc(_enlace)}"></label>
      <div class="acciones"><button class="btn secundario" data-action="mcoCopiar">📋 Copiar</button>
        ${c.estado === 'pendiente' ? '<button class="btn" data-action="mcoFirmarAqui">✍ Firmar ahora (aquí)</button>' : ''}
        <a class="btn secundario" id="mco-wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn secundario" id="mco-email" href="mailto:?subject=${encodeURIComponent(`Contrato de mantenimiento ${c.plan_nombre} · OK Computer Tenerife`)}&body=${encodeURIComponent(msg)}">✉️ Correo</a></div>
    </section>`;
}

// ── El firmado ──────────────────────────────────────────────────────────────
async function pintarFirmado(el: HTMLElement, id: string) {
  const { data: c } = await API.single<any>('contratos', { select: 'plan_nombre,cliente_nombre,cuerpo_html,firmante_nombre,firmado_at,firma_img,firmante_ip,estado', id: `eq.${id}` });
  if (!c) { el.innerHTML = '<p class="aviso mal">No existe ese contrato.</p>'; return; }
  el.innerHTML = `<p><a href="#/mantenimientos/documentos">← Documentos</a></p><h2>Contrato ${esc(c.plan_nombre)} · ${esc(c.cliente_nombre ?? '')}</h2>
    <p class="acciones"><button class="btn secundario" data-action="mcoImprimir">🖨 Imprimir o guardar en PDF</button></p>
    <div class="mco-imprimible"><article class="tarjeta mco-doc" id="mco-firmado"></article>
    <section class="tarjeta"><h3>Firma del cliente</h3>
      ${c.firma_img && /^data:image\/(png|jpeg);base64,/.test(c.firma_img) ? `<img class="tr-firma" src="${esc(c.firma_img)}" alt="Firma del cliente">` : '<p class="nota">Sin imagen de firma.</p>'}
      <p><strong>${esc(c.firmante_nombre ?? '—')}</strong><br><span class="nota">${c.firmado_at ? `Firmado el ${esc(new Date(c.firmado_at).toLocaleString('es-ES'))}` : 'Sin firmar todavía'}</span>
      ${c.firmante_ip ? `<br><small class="nota">IP ${esc(c.firmante_ip)}</small>` : ''}</p></section></div>`;
  // El documento se compuso escapando lo tecleado (renderContratoDoc): se pinta tal cual.
  document.getElementById('mco-firmado')!.innerHTML = c.cuerpo_html ?? '';
}

registrarAcciones({
  mcoBuscarCliente(q: string) {
    clearTimeout(_timer);
    poner('mco-cliente', '');
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById('mco-cliente-res'); if (!ul) return;
      ul.innerHTML = (await buscarClientes(q)).map(c => `<li><button type="button" class="btn secundario" data-action="mcoElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}</button></li>`).join('');
    }, 250);
  },
  async mcoElegirCliente(id: string, nombre: string) {
    poner('mco-cliente', id); poner('mco-cliente-q', nombre);
    const ul = document.getElementById('mco-cliente-res'); if (ul) ul.innerHTML = '';
    const [s, c] = await Promise.all([opciones('locales', id, null, '— Sin sede —'), opciones('contactos', id, null, '— Sin contacto —')]);
    const ss = document.getElementById('mco-sede'); if (ss) ss.innerHTML = s;
    const cc = document.getElementById('mco-contacto'); if (cc) cc.innerHTML = c;
  },
  // setPlanContrato de la app: cuota, frecuencia y características del plan (se pueden cambiar).
  mcoPlan(nombre: string) {
    poner('mco-plan', nombre);
    document.querySelectorAll<HTMLButtonElement>('#mco-planes .chip-boton').forEach(b => { const on = b.dataset.p0 === nombre; b.classList.toggle('activo', on); b.setAttribute('aria-pressed', String(on)); });
    const p = _planes.find(x => x.nombre === nombre);
    if (p) {
      poner('mco-importe', p.precio_mensual != null ? String(p.precio_mensual) : '');
      const f = normalizaFrecuencia(p.frecuencia_pago); if (f) poner('mco-frecuencia', f);
      pintarCaracs(p);
    }
    refrescaCuota();
  },
  mcoCuota() { refrescaCuota(); },
  mcoRestaurar() {
    const p = _planes.find(x => x.nombre === val('mco-plan'));
    if (!p) { toast('Elige antes un plan', 'error'); return; }
    pintarCaracs(p); toast('Características del plan restauradas');
  },
  async mcoBorrador() {
    const tpl = await plantilla(val('mco-plan'));
    if (!tpl) { toast('Elige antes un plan', 'error'); return; }
    const k = leerCaracs(), d = await datosDoc(val('mco-cliente') || null, val('mco-sede') || null);
    const caja = document.getElementById('mco-borrador')!;
    caja.querySelector('.mco-doc')!.innerHTML = renderContratoDoc(tpl, { ...d, precio: val('mco-importe') || null, frecuencia: val('mco-frecuencia'), servicios: k.servicios, tarifaEst: k.tarifaEst, tarifaUrg: k.tarifaUrg });
    caja.hidden = false; caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  async mcoGuardar() {
    const c = _c, nuevo = _modo === 'nuevo', editable = _modo !== 'firmado';
    const clienteId = val('mco-cliente') || null, localId = val('mco-sede') || null, contactoId = val('mco-contacto') || null;
    const plan = editable ? val('mco-plan') : c!.plan_nombre;
    if (editable && !plan) { toast('Elige un plan', 'error'); return; }
    const tpl = editable ? await plantilla(plan) : null;
    if (editable && !tpl) { toast('Plan no encontrado', 'error'); return; }
    const imp = val('mco-importe').replace(',', '.');
    if (imp !== '' && !(Number(imp) >= 0)) { toast('El importe no es un número válido', 'error'); return; }
    // Vacío al GENERAR = el precio del plan; vacío al EDITAR = sin cuota (alguien la quitó a mano).
    const precio = editable ? (imp !== '' ? Number(imp) : nuevo ? tpl!.precio_mensual ?? null : null) : c!.precio_mensual;
    const frecuencia = normalizaFrecuencia(editable ? val('mco-frecuencia') : c!.frecuencia_pago) ?? 'Mensual';
    if (Number(precio) > 0 && !localId && !confirm(nuevo
      ? `Este contrato lleva una cuota de ${numEs(Number(precio))} €/mes pero no tiene sede. La cuota se cobra por sede: sin ella no se podrá domiciliar y el contrato quedará firmado sin cobrarse. ¿Generarlo así?`
      : 'Sin sede no se puede domiciliar la cuota: el contrato queda firmado y sin cobrarse. ¿Guardar así?')) return;
    const cambios: Record<string, unknown> = { cliente_id: clienteId, local_id: localId, contacto_id: contactoId };
    if (editable) {
      const d = await datosDoc(clienteId, localId);
      if (!d.nombre) { toast('Indica el nombre del cliente', 'error'); return; }
      const k = leerCaracs();
      Object.assign(cambios, {
        cuerpo_html: renderContratoDoc(tpl!, { ...d, precio, frecuencia, servicios: k.servicios, tarifaEst: k.tarifaEst, tarifaUrg: k.tarifaUrg }),
        plan_nombre: plan, precio_mensual: precio, frecuencia_pago: frecuencia, cliente_nombre: d.nombre || null, cliente_nif: d.nif || null,
        direccion: d.direccion || null, municipio: d.municipio || null, servicios: k.servicios, tarifa_estandar: k.tarifaEst, tarifa_urgente: k.tarifaUrg,
      });
    }
    if (!nuevo) {
      const r = await API.patch('contratos', { id: `eq.${c!.id}` }, cambios);
      if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
      olvidarMantenimientos(); toast('Contrato actualizado'); ir('mantenimientos', 'documentos'); return;
    }
    const token = crypto.randomUUID().replace(/-/g, '');
    const r = await API.post<{ id: string }[]>('contratos', { ...cambios, token, estado: 'pendiente', created_by: usuario()?.id ?? null });
    const nuevoId = (r.data as { id: string }[] | null)?.[0]?.id;
    if (r.error || !nuevoId) { toast(`No se pudo generar: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    olvidarMantenimientos(); toast('Contrato generado');
    ir('mantenimientos', 'contrato', nuevoId, 'enlace');
  },
  async mcoCopiar() {
    try { await navigator.clipboard.writeText(_enlace); toast('Enlace copiado'); }
    catch { (document.getElementById('mco-url') as HTMLInputElement | null)?.select(); toast('Cópialo a mano (está seleccionado)', 'error'); }
  },
  // Sin 'noopener' en open(): con él window.open devuelve null siempre y se
  // daría por bloqueada una ventana que sí se abrió (el fallo de la app).
  mcoFirmarAqui() {
    const w = window.open(_enlace, '_blank');
    if (w) w.opener = null;
    else { navigator.clipboard?.writeText(_enlace).catch(() => undefined); toast('No se pudo abrir la ventana: el enlace se ha copiado, pégalo en el navegador', 'error'); }
  },
  mcoImprimir() { window.print(); },
});
