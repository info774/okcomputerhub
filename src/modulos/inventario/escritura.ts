// Escritura del inventario (paridad bloque 7, tanda 1: furgonetas.js de la
// app), PREPARADA para el corte del área `inventario`: con el área en la app
// todo se ve y nada se guarda (las funciones de la base lo rechazan igual).
//   #/inventario/nuevo[/<ubicación>]  alta de un producto (con el buscador del catálogo)
//   #/inventario/<id>/editar           editar (la diferencia de cantidad queda apuntada)
//   #/inventario/<id>/mover            entrada, salida o trasvase
//   #/inventario/vehiculo              nueva ubicación (furgoneta o tienda)
//   #/inventario/albaran               foto o PDF del albarán → Claude lee → entrada
//   #/inventario/importar              CSV de Excel (las columnas del «Excel» de la lista)
// El stock nunca se toca a secas: TODO pasa por hub.inventario_guardar,
// _mover y _entradas, que apuntan el movimiento y enlazan el catálogo.
// Prefijo de ids: inw-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { llamarFuncion } from '../../core/funciones';
import { equipo } from '../../core/equipo';
import { esc, toast } from '../../ui/dom';
import { leerCsv } from '../../ui/csv';
import { ico } from '../../shell/linea';

interface Ubicacion { id: string; nombre: string }
interface Producto { id: string; furgoneta_id: string | null; nombre: string; categoria: string | null; cantidad: number | null; stock_minimo: number | null;
  notas: string | null; codigo_principal: string | null; codigo_barra: string | null; precio: number | null; catalogo_id: string | null }
interface Catalogo { id: string; nombre: string; referencia: string | null; precio: number | null; categoria: string | null }
interface Linea { incluir: boolean; nombre: string; cantidad: number; precio: number; referencia: string; categoria?: string; stock_minimo?: number; notas?: string }

export const CATEGORIAS = ['Material', 'Herramienta', 'Consumible', 'Equipo'];
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const numero = (id: string) => { const v = Number(val(id).replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = mal; r.readAsDataURL(f); });

let _catalogo: Catalogo[] | null = null;
// La vista guarda 5 min la lista: tras escribir se le avisa para que la vuelva a leer.
const cambiado = () => document.dispatchEvent(new CustomEvent('hub:inventario'));
let _lineas: Linea[] = [];
let _modoLineas: 'albaran' | 'excel' = 'albaran';

const ubicaciones = async () => (await API.get<Ubicacion[]>('furgonetas', { select: 'id,nombre', order: 'nombre' })).data ?? [];
// Sin ubicaciones no hay dónde dar de alta: el desplegable lo dice y lleva a crear una.
const selUbic = (id: string, us: Ubicacion[], actual = '', dis = '') => us.length
  ? `<select id="${id}" ${dis} aria-label="Ubicación">${us.map(u =>
    `<option value="${esc(u.id)}" ${u.id === actual ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>`
  : `<select id="${id}" disabled aria-label="Ubicación"><option value="">Primero crea una ubicación</option></select> <a href="#/inventario/vehiculo">Crear ubicación</a>`;
const volver = (ruta = '#/inventario', txt = 'Inventario') => `<p><a href="${ruta}">← ${txt}</a></p>`;

async function cabecera(que: string): Promise<{ dis: string; aviso: string }> {
  const delHub = await esDelHub('furgoneta_inventario');
  return { dis: delHub ? '' : 'disabled', aviso: delHub ? '' : avisoSoloLectura(que) };
}

// ── Producto: alta y edición ───────────────────────────────────────────────
export async function pintarProducto(el: HTMLElement, id: string | null, ubicacion = '') {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ dis, aviso }, us, r] = await Promise.all([cabecera('El inventario'), ubicaciones(),
    id ? API.single<Producto>('furgoneta_inventario', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null, error: null })]);
  const p = r.data;
  if (id && !p) { el.innerHTML = `${volver()}<p class="aviso mal">No se encontró el producto.</p>`; return; }
  el.innerHTML = `${volver(id ? `#/inventario/${esc(id)}` : '#/inventario', id ? 'Ficha' : 'Inventario')}${aviso}
    <form class="tarjeta" id="inw-form" data-on-submit="inwGuardar" data-prevent="1" data-id="${esc(id ?? '')}">
      <h3>${id ? 'Editar producto' : 'Añadir producto'}</h3>
      ${id ? '' : `<label>Buscar en el catálogo <input id="inw-cat-buscar" type="search" placeholder="Nombre o referencia…" data-on-input="inwBuscarCat:$value" autocomplete="off" ${dis}></label>
        <ul class="inw-cat" id="inw-cat-res"></ul>`}
      <input type="hidden" id="inw-catalogo" value="${esc(p?.catalogo_id ?? '')}">
      <p class="nota" id="inw-vinculo">${p?.catalogo_id ? `${ico('enlace')} Enlazado con su ficha del catálogo.` : 'Al guardar se enlaza con su ficha del catálogo (si no existe, se crea).'}</p>
      <div class="in-campos">
        ${id ? '' : `<label>Ubicación ${selUbic('inw-ubic', us, ubicacion, dis)}</label>`}
        <label>Nombre <input id="inw-nombre" required maxlength="200" value="${esc(p?.nombre ?? '')}" ${dis}></label>
        <label>Categoría <select id="inw-categoria" ${dis}>${CATEGORIAS.map(c => `<option ${c === (p?.categoria ?? 'Material') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Código <input id="inw-codigo" value="${esc(p?.codigo_principal ?? '')}" ${dis}></label>
        <label>Código de barras <input id="inw-barras" value="${esc(p?.codigo_barra ?? '')}" ${dis}></label>
        <label>Cantidad <input id="inw-cantidad" type="number" min="0" step="any" value="${esc(p?.cantidad ?? 1)}" ${dis}></label>
        <label>Stock mínimo <input id="inw-minimo" type="number" min="0" step="any" value="${esc(p?.stock_minimo ?? 1)}" ${dis}></label>
        <label>Precio (€, sin impuestos) <input id="inw-precio" type="number" min="0" step="0.01" value="${esc(p?.precio ?? 0)}" ${dis}></label>
      </div>
      <label>Notas <textarea id="inw-notas" rows="2" ${dis}>${esc(p?.notas ?? '')}</textarea></label>
      ${id ? '<p class="nota">Si cambias la cantidad, la diferencia queda apuntada como «Ajuste manual desde la ficha del producto». Para entradas y salidas normales, mejor «Mover».</p>' : ''}
      <div class="acciones"><button class="btn" type="submit" ${dis}>${id ? 'Guardar' : 'Añadir'}</button></div>
    </form>`;
}

async function buscarCatalogo(q: string) {
  const ul = document.getElementById('inw-cat-res');
  if (!ul) return;
  const t = q.trim().toLowerCase();
  if (t.length < 2) { ul.innerHTML = ''; return; }
  if (!_catalogo) _catalogo = (await API.fetchAll<Catalogo>('catalogo', { select: 'id,nombre,referencia,precio,categoria', activo: 'neq.false', order: 'nombre' })).data ?? null;
  const res = (_catalogo ?? []).filter(c => c.nombre.toLowerCase().includes(t) || (c.referencia ?? '').toLowerCase().includes(t)).slice(0, 8);
  ul.innerHTML = res.map(c => `<li><button type="button" class="chip-boton" data-action="inwElegirCat" data-p0="${esc(c.id)}">${esc(c.nombre)}${c.referencia ? ` <small class="nota">${esc(c.referencia)}</small>` : ''}</button></li>`).join('')
    || '<li class="nota">Nada en el catálogo: se creará su ficha al guardar.</li>';
}

// ── Mover: entrada, salida o trasvase ──────────────────────────────────────
export async function pintarMover(el: HTMLElement, id: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ dis, aviso }, us, r] = await Promise.all([cabecera('El inventario'), ubicaciones(), API.single<Producto>('furgoneta_inventario', { select: '*', id: `eq.${id}` })]);
  const p = r.data;
  if (!p) { el.innerHTML = `${volver()}<p class="aviso mal">No se encontró el producto.</p>`; return; }
  const otras = us.filter(u => u.id !== p.furgoneta_id);
  el.innerHTML = `${volver(`#/inventario/${esc(id)}`, 'Ficha')}${aviso}
    <form class="tarjeta" id="inw-mover" data-on-submit="inwMover" data-prevent="1" data-id="${esc(id)}">
      <h3>${esc(p.nombre)}</h3>
      <p>En ${esc(us.find(u => u.id === p.furgoneta_id)?.nombre ?? '—')}: <strong id="inw-stock">${Number(p.cantidad ?? 0)}</strong></p>
      <div class="segmentado" role="radiogroup" aria-label="Tipo de movimiento">${[['entrada', 'Entrada'], ['salida', 'Salida'], ['trasvase', 'Trasvase']].map(([k, t], i) =>
        `<button type="button" data-action="inwTipo" data-p0="${k}" class="${i === 0 ? 'activo' : ''}" ${dis}>${t}</button>`).join('')}</div>
      <input type="hidden" id="inw-tipo" value="entrada">
      <div class="in-campos">
        <label>Cantidad <input id="inw-mov-cant" type="number" min="0" step="any" value="1" required ${dis}></label>
        <label id="inw-dest-wrap" hidden>Hacia ${otras.length ? selUbic('inw-dest', otras, '', dis) : '<span class="nota">No hay otra ubicación</span>'}</label>
      </div>
      <label>Motivo / notas <input id="inw-mov-notas" maxlength="300" placeholder="Opcional" ${dis}></label>
      <div class="acciones"><button class="btn" type="submit" ${dis}>Apuntar</button></div>
    </form>`;
}

// ── Vehículo / ubicación nueva ─────────────────────────────────────────────
export async function pintarVehiculo(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [delHub, gente] = await Promise.all([esDelHub('furgonetas'), equipo()]);
  const dis = delHub ? '' : 'disabled';
  el.innerHTML = `${volver()}${delHub ? '' : avisoSoloLectura('El inventario')}
    <form class="tarjeta" id="inw-vehiculo" data-on-submit="inwVehiculo" data-prevent="1"><h3>Nueva ubicación</h3>
      <p class="nota">Una furgoneta, la tienda o cualquier sitio con stock propio.</p>
      <div class="in-campos">
        <label>Nombre <input id="inw-v-nombre" required maxlength="80" placeholder="Furgoneta de Matteo, Tienda…" ${dis}></label>
        <label>A cargo de <select id="inw-v-tecnico" ${dis}><option value="">— Nadie en concreto —</option>${gente.filter(u => u.activo).map(u => `<option>${esc(u.nombre)}</option>`).join('')}</select></label>
      </div>
      <div class="acciones"><button class="btn" type="submit" ${dis}>Crear</button></div></form>`;
}

// ── Albarán (Claude) e importar CSV: las dos acaban en la misma tabla ──────
function tablaLineas(dis: string) {
  return `<table class="tabla" id="inw-lineas"><thead><tr><th></th><th>Producto</th><th>Ref.</th><th class="num">Cant.</th><th class="num">Precio</th></tr></thead><tbody>
    ${_lineas.map((l, i) => `<tr class="${l.incluir ? '' : 'apagado'}">
      <td><input type="checkbox" ${l.incluir ? 'checked' : ''} data-on-change="inwIncluir:$n:${i},$checked" aria-label="Incluir" ${dis}></td>
      <td><input value="${esc(l.nombre)}" data-on-change="inwLinea:$n:${i},nombre,$value" aria-label="Nombre" ${dis}></td>
      <td><input value="${esc(l.referencia)}" data-on-change="inwLinea:$n:${i},referencia,$value" aria-label="Referencia" size="10" ${dis}></td>
      <td class="num"><input type="number" min="0" step="any" value="${l.cantidad}" data-on-change="inwLinea:$n:${i},cantidad,$value" aria-label="Cantidad" ${dis}></td>
      <td class="num"><input type="number" min="0" step="0.01" value="${l.precio}" data-on-change="inwLinea:$n:${i},precio,$value" aria-label="Precio" ${dis}></td></tr>`).join('')}
    </tbody></table>`;
}

function pintarPaso2(dis: string) {
  const c = document.getElementById('inw-paso2');
  if (!c) return;
  const n = _lineas.filter(l => l.incluir).length;
  c.hidden = !_lineas.length;
  c.innerHTML = `<h3>${_lineas.length} ${_lineas.length === 1 ? 'línea' : 'líneas'} leídas</h3>
    <p class="nota">${_modoLineas === 'albaran' ? 'Lo que ya esté en esa ubicación con el mismo nombre SUMA; lo nuevo se da de alta. Corrige lo que haga falta y quita lo que no entre.' : 'Cada fila se da de alta como producto nuevo en esa ubicación, como «Importar» de la app.'}</p>
    <div class="mo-scroll">${tablaLineas(dis)}</div>
    <div class="acciones"><button class="btn" data-action="inwConfirmar" ${dis || (n ? '' : 'disabled')}>Dar entrada a ${n}</button>
      ${_modoLineas === 'albaran' ? `<button class="btn secundario" data-action="inwLineaMas" ${dis}>${ico('mas')} Línea a mano</button>` : ''}</div>`;
}

export async function pintarAlbaran(el: HTMLElement, modo: 'albaran' | 'excel') {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  _lineas = []; _modoLineas = modo;
  const [{ dis, aviso }, us] = await Promise.all([cabecera('El inventario'), ubicaciones()]);
  el.innerHTML = `${volver()}${aviso}
    <section class="tarjeta" id="inw-paso1"><h3>${modo === 'albaran' ? `${ico('camara')} Escanear albarán` : `${ico('subir')} Importar desde Excel`}</h3>
      <p class="nota">${modo === 'albaran'
        ? 'Foto o PDF del albarán o la factura del proveedor: Claude lee los productos y tú confirmas qué entra.'
        : 'En Excel, «Guardar como» → CSV. Columnas: Nombre, Categoría, Cantidad, Stock mínimo, Notas (las mismas que salen al pulsar «Excel» en la lista).'}</p>
      <div class="in-campos"><label>Entra en ${selUbic('inw-dest-lote', us, '', dis)}</label>
        <label>${modo === 'albaran' ? 'Foto o PDF' : 'Fichero CSV'} <input id="inw-fichero" type="file" accept="${modo === 'albaran' ? 'image/*,application/pdf' : '.csv,text/csv'}"
          ${modo === 'albaran' ? 'capture="environment"' : ''} data-on-change="inwFichero:$this" ${dis}></label></div>
      <p id="inw-estado" class="nota" hidden></p>
    </section>
    <section class="tarjeta" id="inw-paso2" hidden></section>`;
}

function deCsv(texto: string): Linea[] {
  const filas = leerCsv(texto);
  if (!filas.length) return [];
  const cab = filas[0].map(h => h.trim().toLowerCase());
  const conCab = ['nombre', 'categoría', 'categoria', 'cantidad'].some(h => cab.includes(h));
  const col = (...ns: string[]) => { for (const n of ns) { const i = cab.indexOf(n); if (i >= 0) return i; } return -1; };
  const [iN, iC, iQ, iM, iO] = conCab ? [col('nombre'), col('categoría', 'categoria'), col('cantidad', 'cantidad total'), col('stock mínimo', 'stock minimo'), col('notas')] : [0, 1, 2, 3, 4];
  const num = (v: string | undefined) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  return (conCab ? filas.slice(1) : filas).map(f => ({
    incluir: true, nombre: (f[iN] ?? '').trim(), referencia: '', precio: 0, cantidad: num(f[iQ]),
    categoria: iC >= 0 ? (f[iC] ?? '').trim() : '', stock_minimo: iM >= 0 ? num(f[iM]) : 0, notas: iO >= 0 ? (f[iO] ?? '').trim() : '',
  })).filter(l => l.nombre);
}

registrarAcciones({
  inwBuscarCat(q: string) { void buscarCatalogo(q); },
  inwElegirCat(id: string) {
    const c = _catalogo?.find(x => x.id === id);
    if (!c) return;
    const pon = (k: string, v: unknown) => { const e = document.getElementById(k) as HTMLInputElement | null; if (e && v != null && v !== '') e.value = String(v); };
    pon('inw-nombre', c.nombre); pon('inw-codigo', c.referencia); pon('inw-precio', c.precio); pon('inw-catalogo', c.id);
    document.getElementById('inw-vinculo')!.innerHTML = `${ico('enlace')} Enlazado con «${esc(c.nombre)}» del catálogo.`;
    document.getElementById('inw-cat-res')!.innerHTML = '';
  },
  async inwGuardar() {
    const id = (document.getElementById('inw-form') as HTMLElement).dataset.id || null;
    const datos = { nombre: val('inw-nombre'), categoria: val('inw-categoria'), codigo_principal: val('inw-codigo'), codigo_barra: val('inw-barras'),
      cantidad: numero('inw-cantidad'), stock_minimo: numero('inw-minimo'), precio: numero('inw-precio'), notas: val('inw-notas') };
    if (!datos.nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const r = await API.rpc<string>('inventario_guardar', { p_id: id, p_furgoneta: id ? null : val('inw-ubic') || null, p_datos: datos, p_catalogo: val('inw-catalogo') || null });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    cambiado();
    toast(id ? 'Producto guardado' : 'Producto añadido');
    ir('inventario', String(r.data ?? id));
  },
  inwTipo(t: string) {
    (document.getElementById('inw-tipo') as HTMLInputElement).value = t;
    document.querySelectorAll<HTMLButtonElement>('#inw-mover .segmentado button').forEach(b => b.classList.toggle('activo', b.dataset.p0 === t));
    document.getElementById('inw-dest-wrap')!.hidden = t !== 'trasvase';
  },
  async inwMover() {
    const id = (document.getElementById('inw-mover') as HTMLElement).dataset.id!;
    const tipo = val('inw-tipo'), cant = numero('inw-mov-cant');
    if (cant <= 0) { toast('La cantidad tiene que ser mayor que cero', 'error'); return; }
    if (tipo === 'trasvase' && !val('inw-dest')) { toast('Elige a qué ubicación va', 'error'); return; }
    const r = await API.rpc<number>('inventario_mover', { p_producto: id, p_tipo: tipo, p_cantidad: cant, p_destino: tipo === 'trasvase' ? val('inw-dest') : null, p_notas: val('inw-mov-notas') || null });
    if (r.error) { toast(`No se pudo apuntar: ${r.error.message}`, 'error'); return; }
    cambiado();
    toast(`Apuntado: quedan ${r.data} aquí`);
    ir('inventario', id);
  },
  async inwVehiculo() {
    const nombre = val('inw-v-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const r = await API.post('furgonetas', { nombre, tecnico_responsable: val('inw-v-tecnico') || null });
    if (r.error) { toast(`No se pudo crear: ${r.error.message}`, 'error'); return; }
    cambiado();
    toast('Ubicación creada');
    ir('inventario');
  },
  async inwFichero(input: HTMLInputElement) {
    const f = input.files?.[0];
    const est = document.getElementById('inw-estado')!;
    if (!f) return;
    est.hidden = false; est.className = 'nota cargando';
    if (_modoLineas === 'excel') {
      _lineas = deCsv(await f.text());
      est.className = 'nota'; est.textContent = _lineas.length ? `${f.name}: ${_lineas.length} filas.` : 'No se encontraron filas con nombre.';
    } else {
      if (f.size > 12 * 1024 * 1024) { est.className = 'aviso'; est.textContent = 'El fichero pasa de 12 MB.'; return; }
      est.textContent = 'Claude está leyendo el albarán…';
      const r = await llamarFuncion<{ productos: { nombre: string; cantidad: number; precio: number; referencia: string }[] }>('gastos-ocr',
        { accion: 'albaran', archivo: await aBase64(f), tipo: f.type || 'image/jpeg' }, 90000);
      if (r.error || !r.data?.productos) { est.className = 'aviso'; est.textContent = r.error ?? 'No se pudo leer el albarán'; return; }
      _lineas = r.data.productos.map(p => ({ incluir: true, nombre: p.nombre, cantidad: Number(p.cantidad) || 1, precio: Number(p.precio) || 0, referencia: p.referencia ?? '' }));
      est.className = 'nota'; est.textContent = `${f.name}: leído.`;
    }
    pintarPaso2('');
  },
  inwIncluir(i: number, v: boolean) { if (_lineas[i]) _lineas[i].incluir = v; pintarPaso2(''); },
  inwLinea(i: number, campo: string, v: string) {
    const l = _lineas[i]; if (!l) return;
    if (campo === 'cantidad' || campo === 'precio') l[campo] = Number(String(v).replace(',', '.')) || 0;
    else if (campo === 'nombre' || campo === 'referencia') l[campo] = v;
  },
  inwLineaMas() { _lineas.push({ incluir: true, nombre: '', cantidad: 1, precio: 0, referencia: '' }); pintarPaso2(''); },
  async inwConfirmar() {
    const ubic = val('inw-dest-lote');
    const lineas = _lineas.filter(l => l.incluir && l.nombre.trim() && (_modoLineas === 'excel' || l.cantidad > 0))
      .map(l => ({ nombre: l.nombre, cantidad: l.cantidad, precio: l.precio, referencia: l.referencia, categoria: l.categoria, stock_minimo: l.stock_minimo, notas: l.notas }));
    if (!ubic) { toast('Elige la ubicación', 'error'); return; }
    if (!lineas.length) { toast('Marca al menos una línea con nombre y cantidad', 'error'); return; }
    const r = await API.rpc<{ altas: number; sumadas: number }>('inventario_entradas', { p_furgoneta: ubic, p_lineas: lineas, p_modo: _modoLineas });
    if (r.error) { toast(`No se pudo dar entrada: ${r.error.message}`, 'error'); return; }
    cambiado();
    toast(`${r.data?.altas ?? 0} productos nuevos · ${r.data?.sumadas ?? 0} sumados`);
    _lineas = [];
    ir('inventario');
  },
});
