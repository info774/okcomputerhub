// Dos páginas de la ficha de un presupuesto:
//   · #/presupuestos/<id>/pdf — el presupuesto imprimible (generatePresupuestoPDF
//     de la app): empresa, número, fecha y estado, cliente, asunto, lo que pide
//     el cliente, líneas con base, IGIC y total, y las condiciones. Como el parte
//     del trabajo: «Imprimir o guardar en PDF», sin librería. Solo lee.
//   · #/presupuestos/<id>/trabajo — «Convertir en trabajo»
//     (confirmarTrabajoDesdePresupuesto): descripción, tipo, fecha, hora y
//     técnicos → hub.trabajo_desde_presupuesto (exige el área `trabajos`).
// Prefijos de ids: ppd- y pat-.
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { eur } from '../ventas/datos';
import { TIPOS } from '../trabajos/formulario';

const IGIC = 7; // getEmpresaConfig().igic de la app por defecto
const CONDICIONES = 'Este presupuesto tiene una validez de 30 días. Los precios no incluyen IGIC. Cualquier trabajo adicional no contemplado en este presupuesto será presupuestado aparte.';
const fecha = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

export async function pintarDocumento(el: HTMLElement, id: string) {
  const { data: p } = await API.single<any>('presupuestos', { select: '*', id: `eq.${id}` });
  if (!p) { el.innerHTML = '<p class="aviso mal">No existe ese presupuesto.</p><p><a href="#/presupuestos">← Presupuestos</a></p>'; return; }
  const [cli, loc, lin, emi] = await Promise.all([
    p.cliente_id ? API.single<any>('clientes', { select: 'nombre,nif,telefono,email,direccion', id: `eq.${p.cliente_id}` }) : Promise.resolve({ data: null }),
    p.local_id ? API.single<any>('locales', { select: 'nombre,direccion', id: `eq.${p.local_id}` }) : Promise.resolve({ data: null }),
    API.get<any[]>('documento_lineas', { select: 'nombre,cantidad,precio,descuento', presupuesto_id: `eq.${p.id}`, order: 'orden.nullslast,created_at' }),
    API.single<{ valor: any }>('config', { select: 'valor', clave: 'eq.facturacion_emisor' }),
  ]);
  const e = emi.data?.valor ?? {};
  const empresa = e.nombre_comercial || e.nombre || 'Ok Computer Tenerife';
  const contacto = [e.telefono, e.email, [e.direccion, e.municipio].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const c = cli.data, l = loc.data;
  const lineas = (lin.data ?? []).map(x => ({ nombre: x.nombre, cantidad: Number(x.cantidad ?? 1), precio: Number(x.precio ?? 0), descuento: Number(x.descuento ?? 0) }));
  const sub = (x: { cantidad: number; precio: number; descuento: number }) => x.precio * x.cantidad * (1 - x.descuento / 100);
  const base = lineas.reduce((a, x) => a + sub(x), 0);
  el.innerHTML = `<p class="no-imprimir"><a href="#/presupuestos/${esc(p.id)}">← ${esc(p.titulo || 'Presupuesto')}</a></p>
    <div class="acciones no-imprimir"><button class="btn" data-action="ppdImprimir">Imprimir o guardar en PDF</button></div>
    <article class="tarjeta tr-parte" id="ppd-doc">
      <header class="pa-cab"><div><strong class="pa-empresa">${esc(empresa)}</strong>${contacto ? `<br><small>${esc(contacto)}</small>` : ''}</div>
        <div class="pa-num"><h2>Presupuesto</h2>${p.numero_presupuesto ? `Nº ${esc(p.numero_presupuesto)}<br>` : ''}Fecha: ${esc(fecha(p.fecha || p.created_at))}<br>Estado: ${esc(p.estado ?? 'Borrador')}</div></header>
      <section class="pa-cliente"><h4>Cliente</h4><strong>${esc(c?.nombre ?? '—')}</strong>
        ${[c?.nif, c?.telefono, c?.email].some(Boolean) ? `<br>${esc([c?.nif, c?.telefono, c?.email].filter(Boolean).join(' · '))}` : ''}
        ${l ? `<br>Local: ${esc([l.nombre, l.direccion].filter(Boolean).join(' — '))}` : ''}</section>
      <h3>${esc(p.titulo || 'Presupuesto')}</h3>
      ${p.exigencias ? `<section class="pa-bloque"><h4>Descripción / exigencias</h4><p class="pa-texto">${esc(p.exigencias)}</p></section>` : ''}
      ${lineas.length ? `<section class="pa-bloque"><table class="tabla pa-lineas"><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio unit.</th><th>Total</th></tr></thead><tbody>
        ${lineas.map(x => `<tr><td>${esc(x.nombre ?? '—')}${x.descuento ? ` <small class="nota">(−${x.descuento} %)</small>` : ''}</td><td>${x.cantidad.toLocaleString('es-ES')}</td><td>${eur(x.precio, 2)}</td><td>${eur(sub(x), 2)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3">Base imponible</th><th>${eur(base, 2)}</th></tr><tr><th colspan="3">IGIC ${IGIC} %</th><th>${eur(base * IGIC / 100, 2)}</th></tr>
          <tr><th colspan="3">TOTAL</th><th id="ppd-total">${eur(base * (1 + IGIC / 100), 2)}</th></tr></tfoot></table></section>` : '<p class="nota">Sin líneas.</p>'}
      <p class="nota">${esc(CONDICIONES)}</p>
      <footer class="pa-pie">${esc(empresa)}${e.email ? ` · ${esc(e.email)}` : ''}${e.telefono ? ` · ${esc(e.telefono)}` : ''}${e.nif ? `<br>CIF: ${esc(e.nif)}` : ''}${e.direccion ? ` · ${esc(e.direccion)}` : ''}</footer>
    </article>`;
}

let _pres: { id: string } | null = null;

export async function pintarATrabajo(el: HTMLElement, id: string) {
  const [{ data: p }, escribe, personas] = await Promise.all([
    API.single<any>('presupuestos', { select: 'id,titulo,tecnico_id,estado', id: `eq.${id}` }), esDelHub('trabajos'), equipo(),
  ]);
  if (!p) { el.innerHTML = '<p class="aviso mal">No existe ese presupuesto.</p><p><a href="#/presupuestos">← Presupuestos</a></p>'; return; }
  _pres = { id: p.id };
  el.innerHTML = `<p><a href="#/presupuestos/${esc(p.id)}">← ${esc(p.titulo || 'Presupuesto')}</a></p>
    <h2>Convertir en trabajo</h2>
    ${escribe ? '' : avisoSoloLectura('Los trabajos')}
    <p class="nota">El trabajo nace con el cliente, la sede, el contacto y el presupuesto, y con una copia de sus líneas.</p>
    <form class="tarjeta" id="pat-form" data-on-submit="patCrear" data-prevent="1">
      <label>Descripción <span class="nota">(obligatoria)</span> <textarea id="pat-descripcion" rows="3" required>${esc(p.titulo ?? '')}</textarea></label>
      <div class="in-campos">
        <label>Tipo <select id="pat-tipo">${TIPOS.map(t => `<option ${t === 'Instalación' ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Fecha <input id="pat-fecha" type="date"></label>
        <label>Hora <input id="pat-hora" type="time"></label>
      </div>
      <fieldset class="tf-tecnicos" id="pat-tecnicos"><legend>Técnicos</legend>
        ${personas.map(x => `<label class="check"><input type="checkbox" value="${esc(x.nombre)}" ${x.nombre === p.tecnico_id ? 'checked' : ''}> ${esc(x.nombre)}</label>`).join('')}</fieldset>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>Crear el trabajo</button>
        <a class="btn secundario" href="#/presupuestos/${esc(p.id)}">Cancelar</a></div>
    </form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  ppdImprimir() { window.print(); },
  async patCrear() {
    if (!_pres) return;
    const descripcion = val('pat-descripcion');
    if (!descripcion) { toast('La descripción es obligatoria', 'error'); return; }
    const fecha = val('pat-fecha'), hora = val('pat-hora');
    const d = fecha && hora ? new Date(`${fecha}T${hora}:00`) : null;
    const r = await API.rpc<{ id: string; numero: number }>('trabajo_desde_presupuesto', {
      p_presupuesto: _pres.id,
      p_datos: { descripcion, tipo: val('pat-tipo'), fecha: fecha || null, hora_llegada: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
        tecnicos: [...document.querySelectorAll<HTMLInputElement>('#pat-tecnicos input:checked')].map(i => i.value) },
    });
    if (r.error || !r.data) { toast(`No se pudo crear el trabajo: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    toast(`Trabajo #${r.data.numero} creado (con las líneas del presupuesto)`);
    ir('trabajos', String(r.data.numero));
  },
});
