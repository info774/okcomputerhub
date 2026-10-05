// Facturar trabajos (openCrearPresupuestoModal + confirmarFacturaDesdeTrabajos
// + confirmarPresupuestoDesdeTrabajos de la app): #/trabajos/facturar/<id,id,…>.
// Prefijo de ids: ft-.
// - Líneas, como la app: una por trabajo («#n - Sede» de rótulo y de detalle
//   título — descripción — fichajes — total de horas), sus artículos
//   (documento_lineas del trabajo o, si no tiene, los de su presupuesto) y los
//   materiales escritos a mano. Todo se puede cambiar antes de mandarlo.
// - Cliente: el del trabajo; si no, el de su sede; si tampoco, se elige y se
//   les queda puesto a las sedes sueltas y a los trabajos (facturar es cuando
//   se sabe de quién son). Se guarda ANTES de facturar.
// - Destino: factura nueva en Zoho, añadir a una factura en borrador del
//   cliente, o un presupuesto (y, si se quiere, mandarlo a Zoho). Las facturas
//   dejan los trabajos «Facturado» (función zoho-ventas).
// Facturar exige el área `trabajos`; el presupuesto, la de `presupuestos`.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { buscarClientes, eur } from '../ventas/datos';

export interface LineaFactura { tipo: 'trabajo' | 'producto' | 'material'; nombre: string; detalle: string; cantidad: number; precio: number; descuento: number }

let _lineas: LineaFactura[] = [];
let _trabajos: string[] = [];
let _asignar: { locales: string[]; trabajos: string[] } = { locales: [], trabajos: [] };
let _timerCli: number | undefined;

const duracion = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`; };
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** _fmtSesionesResumen de la app: «dd/mm hh:mm→hh:mm 1h 30min (Tito) | …». */
export function resumenFichajes(ses: { inicio: string | null; fin: string | null; duracion_min: number | null; tecnico_nombre: string | null }[]): string {
  return ses.map(s => {
    const f = s.inicio ? new Date(s.inicio).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : '';
    return `${f} ${s.inicio ? hora(s.inicio) : '—'}→${s.fin ? hora(s.fin) : 'En curso'}${s.duracion_min ? ` ${duracion(s.duracion_min)}` : ''}${s.tecnico_nombre ? ` (${s.tecnico_nombre})` : ''}`.trim();
  }).join(' | ');
}

/** _parseMateriales de la app: «2 cable UTP» → 2 × «cable UTP». */
export function materiales(texto: string | null): { cantidad: number; nombre: string }[] {
  return (texto ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d+[.,]?\d*)\s+(.+)$/);
    return m ? { cantidad: parseFloat(m[1].replace(',', '.')), nombre: m[2].trim() } : { cantidad: 1, nombre: l };
  });
}

const textoLinea = (l: LineaFactura) => [l.nombre, l.detalle].filter(Boolean).join(' — ');
const sub = (l: LineaFactura) => l.precio * l.cantidad * (1 - l.descuento / 100);

export async function pintarFacturar(el: HTMLElement, ids: string) {
  const lista = (ids ?? '').split(',').filter(x => /^[0-9a-f-]{36}$/i.test(x));
  if (!lista.length) { el.innerHTML = '<p class="aviso mal">No hay trabajos que facturar.</p><p><a href="#/trabajos">← Trabajos</a></p>'; return; }
  const [{ data: ts }, escribe, presHub] = await Promise.all([
    API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,materiales,cliente_id,local_id,presupuesto_id,estado', id: `in.(${lista.join(',')})`, order: 'numero' }),
    esDelHub('trabajos'), esDelHub('presupuestos'),
  ]);
  const trabajos = ts ?? [];
  if (!trabajos.length) { el.innerHTML = '<p class="aviso mal">No se encontraron esos trabajos.</p><p><a href="#/trabajos">← Trabajos</a></p>'; return; }
  const localIds = [...new Set(trabajos.map(t => t.local_id).filter(Boolean))];
  const [ses, lin, sedes] = await Promise.all([
    API.get<any[]>('sesiones', { select: 'entidad_id,inicio,fin,duracion_min,tecnico_nombre', entidad_tipo: 'eq.trabajo', entidad_id: `in.(${lista.join(',')})`, order: 'created_at' }),
    API.get<any[]>('documento_lineas', { select: 'trabajo_id,presupuesto_id,nombre,cantidad,precio,descuento', or: `(trabajo_id.in.(${lista.join(',')})${trabajos.some(t => t.presupuesto_id) ? `,presupuesto_id.in.(${[...new Set(trabajos.map(t => t.presupuesto_id).filter(Boolean))].join(',')})` : ''})`, order: 'orden.nullslast,created_at' }),
    localIds.length ? API.get<any[]>('locales', { select: 'id,nombre,cliente_id', id: `in.(${localIds.join(',')})` }) : Promise.resolve({ data: [] }),
  ]);
  const sedeDe = new Map((sedes.data ?? []).map(s => [s.id, s]));
  // Las líneas, como la app.
  _lineas = [];
  for (const t of trabajos) {
    const s = (ses.data ?? []).filter(x => x.entidad_id === t.id);
    const min = s.reduce((a, x) => a + (x.duracion_min ?? 0), 0);
    const titulo = (t.titulo ?? '').trim(), descr = (t.descripcion ?? '').trim();
    const cuerpo = [titulo, descr === titulo ? '' : descr].filter(Boolean).join(' — ');
    _lineas.push({ tipo: 'trabajo', nombre: [`#${t.numero ?? '?'}`, sedeDe.get(t.local_id)?.nombre].filter(Boolean).join(' - '),
      detalle: [cuerpo, resumenFichajes(s), min ? `Total: ${duracion(min)}` : ''].filter(Boolean).join(' — '), cantidad: 1, precio: 0, descuento: 0 });
    let prods = (lin.data ?? []).filter(l => l.trabajo_id === t.id);
    // Sin líneas propias, las del presupuesto del que viene: es lo que se pactó.
    if (!prods.length && t.presupuesto_id) prods = (lin.data ?? []).filter(l => l.presupuesto_id === t.presupuesto_id && !l.trabajo_id);
    for (const p of prods) _lineas.push({ tipo: 'producto', nombre: p.nombre ?? '', detalle: '', cantidad: Number(p.cantidad ?? 1), precio: Number(p.precio ?? 0), descuento: Number(p.descuento ?? 0) });
    for (const m of materiales(t.materiales)) _lineas.push({ tipo: 'material', nombre: m.nombre, detalle: '', cantidad: m.cantidad, precio: 0, descuento: 0 });
  }
  // El cliente: el de un trabajo, o el heredado de su sede; las sedes sueltas se apuntan.
  const sinCliente = trabajos.filter(t => !t.cliente_id);
  const sueltas = [...new Set(sinCliente.map(t => t.local_id).filter(id => id && !sedeDe.get(id)?.cliente_id))] as string[];
  const clienteId = trabajos.find(t => t.cliente_id)?.cliente_id ?? sinCliente.map(t => sedeDe.get(t.local_id)?.cliente_id).find(Boolean) ?? '';
  const cli = clienteId ? (await API.single<{ nombre: string }>('clientes', { select: 'nombre', id: `eq.${clienteId}` })).data : null;
  _trabajos = trabajos.map(t => t.id);
  _asignar = { locales: sueltas, trabajos: sinCliente.map(t => t.id) };
  const nums = trabajos.map(t => `#${t.numero ?? '?'}${sedeDe.get(t.local_id)?.nombre ? ` - ${sedeDe.get(t.local_id).nombre}` : ''}`).join(', ');
  const ya = trabajos.filter(t => t.estado === 'Facturado');
  el.innerHTML = `<p><a href="#/trabajos">← Trabajos</a></p>
    <h2>Facturar ${trabajos.length === 1 ? 'el trabajo' : `${trabajos.length} trabajos`}</h2>
    ${escribe ? '' : avisoSoloLectura('Los trabajos')}
    ${ya.length ? `<p class="aviso">Ojo: ${ya.map(t => `#${t.numero}`).join(', ')} ya ${ya.length === 1 ? 'está facturado' : 'están facturados'}.</p>` : ''}
    <form class="tarjeta" id="ft-form" data-on-submit="ftConfirmar" data-prevent="1">
      <label>Cliente ${clienteId ? '' : '<span class="nota">(obligatorio: elige a quién se factura)</span>'}
        <input id="ft-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli?.nombre ?? '')}" data-on-input="ftBuscarCliente:$value"></label>
      <input type="hidden" id="ft-cliente" value="${esc(clienteId)}"><ul id="ft-cliente-res" class="resultados"></ul>
      ${sueltas.length ? `<p class="nota" id="ft-aviso-sedes">${sueltas.length === 1 ? 'Esta sede no tiene' : 'Estas sedes no tienen'} cliente: ${esc(sueltas.map(id => sedeDe.get(id)?.nombre ?? 'sin nombre').join(', '))}. Al facturar se ${sueltas.length === 1 ? 'le' : 'les'} asignará el elegido (y a sus trabajos).</p>` : ''}
      <fieldset class="ft-destino"><legend>Qué hacer</legend>
        <label class="check"><input type="radio" name="ft-destino" value="factura" checked data-on-change="ftDestino"> Factura nueva en Zoho Books</label>
        <label class="check"><input type="radio" name="ft-destino" value="anadir" data-on-change="ftDestino"> Añadir a una factura en borrador</label>
        ${presHub ? '<label class="check"><input type="radio" name="ft-destino" value="presupuesto" data-on-change="ftDestino"> Crear un presupuesto</label>' : ''}</fieldset>
      <label id="ft-titulo-l">Referencia <input id="ft-titulo" maxlength="100" value="${esc(`Trabajos ${nums}`)}"></label>
      <label id="ft-borrador-l" hidden>Factura en borrador <select id="ft-borrador"><option value="">—</option></select></label>
      <label class="check" id="ft-zoho-l" hidden><input type="checkbox" id="ft-zoho"> Mandarlo también a Zoho</label>
      <h3>Líneas</h3>
      <div id="ft-lineas">${tablaLineas()}</div>
      <div class="acciones"><button class="btn" type="submit" id="ft-ok" ${escribe ? '' : 'disabled'}>Crear factura en Zoho Books</button>
        <a class="btn secundario" href="#/trabajos">Cancelar</a></div>
    </form>`;
}

function tablaLineas(): string {
  return `<table class="tabla pl-tabla ft-tabla"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Dto. %</th><th class="num">Subtotal</th><th></th></tr></thead>
    <tbody>${_lineas.map((l, i) => `<tr data-linea="${i}">
      <td><input value="${esc(l.nombre)}" aria-label="Concepto" data-on-change="ftCampo:${i},nombre,$value">
        ${l.tipo === 'trabajo' ? `<textarea rows="2" aria-label="Detalle" data-on-change="ftCampo:${i},detalle,$value">${esc(l.detalle)}</textarea>` : ''}</td>
      <td class="num"><input type="number" min="0" step="0.5" value="${l.cantidad}" aria-label="Cantidad" data-on-change="ftCampo:${i},cantidad,$value"></td>
      <td class="num"><input type="number" min="0" step="0.01" value="${l.precio}" aria-label="Precio" data-on-change="ftCampo:${i},precio,$value"></td>
      <td class="num"><input type="number" min="0" max="100" value="${l.descuento}" aria-label="Descuento" data-on-change="ftCampo:${i},descuento,$value"></td>
      <td class="num">${eur(sub(l), 2)}</td>
      <td><button type="button" class="btn secundario" data-action="ftQuitar" data-p0="${i}" aria-label="Quitar la línea">${ico('eliminar')}</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="vacio">Sin líneas.</td></tr>'}</tbody>
    <tfoot><tr><th colspan="4">Total (sin impuestos)</th><th class="num" id="ft-total">${eur(_lineas.reduce((a, l) => a + sub(l), 0), 2)}</th><th></th></tr></tfoot></table>
    <button type="button" class="btn secundario" data-action="ftAnadir">${ico('mas')} Línea</button>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const destino = () => (document.querySelector('input[name="ft-destino"]:checked') as HTMLInputElement | null)?.value ?? 'factura';

async function cargarBorradores() {
  const sel = document.getElementById('ft-borrador') as HTMLSelectElement | null;
  const cliente = val('ft-cliente');
  if (!sel) return;
  if (!cliente) { sel.innerHTML = '<option value="">Elige antes el cliente</option>'; return; }
  sel.innerHTML = '<option value="">Cargando…</option>';
  const r = await llamarFuncion<{ facturas: { invoice_id: string; invoice_number: string; reference_number: string; total: number }[] }>('zoho-ventas', { accion: 'borradores', cliente_id: cliente }, 30000);
  if (r.error) { sel.innerHTML = '<option value="">No se pudieron cargar</option>'; toast(`Zoho: ${r.error}`, 'error'); return; }
  const fs = r.data?.facturas ?? [];
  sel.innerHTML = fs.length ? fs.map(f => `<option value="${esc(f.invoice_id)}">${esc(f.invoice_number)}${f.reference_number ? ` · ${esc(f.reference_number)}` : ''}${f.total != null ? ` — ${eur(f.total, 2)}` : ''}</option>`).join('')
    : '<option value="">— Ese cliente no tiene facturas en borrador —</option>';
}

/** _pftAplicarCliente de la app: el cliente elegido se queda en las sedes sueltas y los trabajos sin él. */
async function aplicarCliente(clienteId: string) {
  let fallo = '';
  if (_asignar.locales.length) {
    const r = await API.patch('locales', { id: `in.(${_asignar.locales.join(',')})` }, { cliente_id: clienteId });
    if (r.error) fallo = r.error.message;
  }
  if (_asignar.trabajos.length) {
    const r = await API.patch('trabajos', { id: `in.(${_asignar.trabajos.join(',')})` }, { cliente_id: clienteId });
    if (r.error) fallo ||= r.error.message;
  }
  if (fallo) toast(`No se pudo guardar el cliente en la sede: ${fallo}`, 'error');
  else if (_asignar.locales.length) toast(`Cliente asignado a ${_asignar.locales.length === 1 ? 'la sede' : `${_asignar.locales.length} sedes`}`);
  _asignar = { locales: [], trabajos: [] };
}

registrarAcciones({
  ftCampo(i: string, k: keyof LineaFactura, v: string) {
    const l = _lineas[Number(i)];
    if (!l) return;
    if (k === 'nombre' || k === 'detalle') l[k] = v;
    else if (k === 'cantidad' || k === 'precio' || k === 'descuento') { l[k] = Math.max(0, Number(String(v).replace(',', '.')) || 0); if (k === 'cantidad' && !l.cantidad) l.cantidad = 1; }
    if (k === 'nombre' || k === 'detalle') return;
    // Solo el subtotal y el total: repintar la tabla en el `change` (al perder el foco) rompe el clic que viene.
    const celda = document.querySelector(`#ft-lineas tr[data-linea="${i}"]`)?.querySelectorAll('td')[4];
    if (celda) celda.textContent = eur(sub(l), 2);
    const t = document.getElementById('ft-total'); if (t) t.textContent = eur(_lineas.reduce((a, x) => a + sub(x), 0), 2);
  },
  ftQuitar(i: string) { _lineas.splice(Number(i), 1); const c = document.getElementById('ft-lineas'); if (c) c.innerHTML = tablaLineas(); },
  ftAnadir() { _lineas.push({ tipo: 'producto', nombre: '', detalle: '', cantidad: 1, precio: 0, descuento: 0 }); const c = document.getElementById('ft-lineas'); if (c) c.innerHTML = tablaLineas(); },
  ftBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('ft-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('ft-cliente-res');
      if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="ftElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)} <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  async ftElegirCliente(id: string, nombre: string) {
    (document.getElementById('ft-cliente') as HTMLInputElement).value = id;
    (document.getElementById('ft-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('ft-cliente-res'); if (ul) ul.innerHTML = '';
    if (destino() === 'anadir') await cargarBorradores();
  },
  async ftDestino() {
    const d = destino();
    (document.getElementById('ft-titulo-l') as HTMLElement).hidden = d === 'anadir';
    (document.getElementById('ft-borrador-l') as HTMLElement).hidden = d !== 'anadir';
    (document.getElementById('ft-zoho-l') as HTMLElement).hidden = d !== 'presupuesto';
    const l = document.querySelector('#ft-titulo-l');
    if (l?.firstChild) l.firstChild.textContent = d === 'presupuesto' ? 'Asunto del presupuesto ' : 'Referencia ';
    const b = document.getElementById('ft-ok');
    if (b) b.textContent = { factura: 'Crear factura en Zoho Books', anadir: 'Añadir a la factura en borrador', presupuesto: 'Crear el presupuesto' }[d] ?? 'Confirmar';
    if (d === 'anadir') await cargarBorradores();
  },
  async ftConfirmar() {
    const cliente = val('ft-cliente');
    if (!cliente) { toast('Elige el cliente: sin él no hay a quién facturar', 'error'); return; }
    const lineas = _lineas.filter(l => l.nombre.trim() || l.detalle.trim());
    if (!lineas.length) { toast('No hay líneas', 'error'); return; }
    const d = destino();
    if (d === 'anadir' && !val('ft-borrador')) { toast('Elige la factura en borrador', 'error'); return; }
    if (d === 'presupuesto' && !val('ft-titulo')) { toast('El asunto es obligatorio', 'error'); return; }
    // El cliente va a Zoho por cliente_id: la sede tiene que quedar apuntada ANTES.
    await aplicarCliente(cliente);
    if (d === 'presupuesto') {
      const r = await API.post<{ id: string }[]>('presupuestos', { cliente_id: cliente, titulo: val('ft-titulo'), estado: 'Borrador', total: 0, fecha: new Date().toLocaleDateString('sv-SE') });
      const id = r.data?.[0]?.id;
      if (r.error || !id) { toast(`No se pudo crear el presupuesto: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
      // En el presupuesto solo cabe una cadena por línea: rótulo y detalle juntos.
      const l = await API.rpc('presupuesto_guardar_lineas', { p_presupuesto: id, p_lineas: lineas.map(x => ({ nombre: textoLinea(x), cantidad: x.cantidad, precio: x.precio, descuento: x.descuento })) });
      if (l.error) { toast(`Presupuesto creado, pero las líneas no: ${l.error.message}`, 'error'); ir('presupuestos', id); return; }
      if ((document.getElementById('ft-zoho') as HTMLInputElement | null)?.checked) {
        const z = await llamarFuncion('zoho-ventas', { accion: 'presupuesto', presupuesto_id: id }, 45000);
        toast(z.error ? `Presupuesto creado, pero no se mandó a Zoho: ${z.error}` : 'Presupuesto creado y mandado a Zoho', z.error ? 'error' : 'info');
      } else toast('Presupuesto creado');
      ir('presupuestos', id);
      return;
    }
    // `detalle` viaja aparte: en Zoho el rótulo es el artículo y el texto largo, la descripción.
    const cuerpo = lineas.map(x => ({ nombre: x.nombre, detalle: x.detalle, cantidad: x.cantidad, precio: x.precio, descuento: x.descuento }));
    toast(d === 'anadir' ? 'Añadiendo a la factura en borrador…' : 'Creando la factura en Zoho Books…');
    const r = await llamarFuncion<{ invoice_number: string | null }>('zoho-ventas', d === 'anadir'
      ? { accion: 'anadir', invoice_id: val('ft-borrador'), lineas: cuerpo, trabajo_ids: _trabajos }
      : { accion: 'factura', cliente_id: cliente, titulo: val('ft-titulo'), lineas: cuerpo, trabajo_ids: _trabajos }, 60000);
    if (r.error) { toast(`Factura: ${r.error}`, 'error'); return; }
    toast(d === 'anadir' ? `Trabajos añadidos a la factura ${r.data?.invoice_number ?? ''}` : `Factura ${r.data?.invoice_number ?? ''} creada en Zoho Books`);
    ir('trabajos');
  },
});
