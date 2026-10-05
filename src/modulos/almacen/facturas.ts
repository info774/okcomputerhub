// Facturas de compra (paridad bloque 7, tanda 2: facturas_compra.js de la
// app). PROPIAS del hub desde ya: en la app la pantalla existe pero su tabla
// nunca llegó a producción. Van con los proveedores y pedidos de Almacén:
//   #/almacen/facturas                 lista (pendientes, vencidas, pagadas)
//   #/almacen/facturas/nueva[/p/<pedido>]  alta (desde un pedido, con su proveedor y total)
//   #/almacen/facturas/<id>            ficha (editar, marcar pagada, adjunto; eliminar solo admin)
// El adjunto (foto o PDF) va al almacén privado por `gastos-ocr` (acción
// `compra`), que con Claude lo lee y rellena lo que pueda; una persona revisa
// y guarda. Prefijo de ids: afc-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { eur } from '../ventas/datos';

interface Factura { id: string; created_at: string; proveedor_id: string | null; pedido_compra_id: string | null; numero: string | null; fecha: string;
  vence: string | null; base: number | null; impuesto: number | null; importe: number; estado: string; pagada_at: string | null;
  archivo_path: string | null; archivo_tipo: string | null; notas: string | null }
interface Prov { id: string; nombre: string; nif: string | null; activo: boolean }
interface Ped { id: string; numero: number; proveedor_id: string | null; total: number; estado: string; fecha: string }
interface Lectura { fecha: string | null; proveedor: string | null; nif: string | null; base: number | null; impuesto: number | null; total: number | null }

const FILTROS: [string, string][] = [['pendientes', 'Pendientes'], ['vencidas', 'Vencidas'], ['pagadas', 'Pagadas'], ['todas', 'Todas']];
let _filtro = 'pendientes';
let _adjunto: { ruta: string; tipo: string } | null = null;

const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' });
const vencida = (f: Factura) => f.estado === 'Pendiente' && !!f.vence && f.vence < hoy();
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const numOrNull = (id: string) => { const v = val(id).replace(',', '.'); return v === '' ? null : Number(v); };
const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = mal; r.readAsDataURL(f); });
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const proveedores = async () => (await API.get<Prov[]>('proveedores', { select: 'id,nombre,nif,activo', order: 'activo.desc,nombre' })).data ?? [];

export async function vistaFacturas(): Promise<string> {
  const [{ data, error }, provs] = await Promise.all([API.get<Factura[]>('facturas_compra', { select: '*', order: 'fecha.desc', limit: '500' }), proveedores()]);
  if (error) return `<p class="aviso mal">No se pudieron leer las facturas: ${esc(error.message)}</p>`;
  const todas = data ?? [];
  const pend = todas.filter(f => f.estado === 'Pendiente'), venc = pend.filter(vencida);
  const suma = (fs: Factura[]) => fs.reduce((t, f) => t + Number(f.importe ?? 0), 0);
  const lista = _filtro === 'pendientes' ? pend : _filtro === 'vencidas' ? venc : _filtro === 'pagadas' ? todas.filter(f => f.estado === 'Pagada') : todas;
  const prov = (id: string | null) => provs.find(p => p.id === id)?.nombre ?? 'Sin proveedor';
  return `<div class="di-cifras pp-cifras">
      <article class="tarjeta di-cifra ${pend.length ? 'atento' : ''}"><h3>Pendientes</h3><p class="di-valor">${eur(suma(pend))}</p><p class="nota">${pend.length} factura${pend.length === 1 ? '' : 's'} sin pagar</p></article>
      <article class="tarjeta di-cifra ${venc.length ? 'mal' : ''}"><h3>Vencidas</h3><p class="di-valor">${eur(suma(venc))}</p><p class="nota">${venc.length ? `${venc.length} pasada${venc.length === 1 ? '' : 's'} de fecha` : 'ninguna'}</p></article>
    </div>
    <div class="acciones mo-barra"><div class="segmentado" role="tablist">${FILTROS.map(([k, t]) => `<button type="button" data-action="afcFiltro" data-p0="${k}" class="${k === _filtro ? 'activo' : ''}">${t}</button>`).join('')}</div>
      <a class="btn" href="#/almacen/facturas/nueva">${ico('mas')} Nueva factura</a></div>
    <div class="tarjeta mo-scroll"><table class="tabla" id="afc-lista"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Número</th><th>Vence</th><th>Estado</th><th class="num">Importe</th></tr></thead><tbody>
      ${lista.map(f => `<tr class="fila-clic" data-action="afcAbrir" data-p0="${esc(f.id)}"><td>${esc(f.fecha)}</td><td><strong>${esc(prov(f.proveedor_id))}</strong></td>
        <td>${esc(f.numero ?? '')}${f.archivo_path ? ` <span title="Con adjunto">${ico('adjunto')}</span>` : ''}</td><td>${esc(f.vence ?? '')}</td>
        <td><span class="chip ${f.estado === 'Pagada' ? 'bien' : vencida(f) ? 'mal' : 'aviso'}">${f.estado === 'Pagada' ? 'Pagada' : vencida(f) ? 'Vencida' : 'Pendiente'}</span></td>
        <td class="num">${eur(f.importe, 2)}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Nada por aquí.</td></tr>'}
      </tbody>${lista.length ? `<tfoot><tr><td colspan="5">Total</td><td class="num">${eur(suma(lista), 2)}</td></tr></tfoot>` : ''}</table></div>
    <p class="nota">Las facturas que mandan los proveedores. Las de venta están en Zoho.</p>`;
}

export async function vistaFactura(id: string, pedidoId = ''): Promise<string> {
  const nueva = id === 'nueva';
  const [r, provs, peds] = await Promise.all([nueva ? Promise.resolve({ data: null, error: null }) : API.single<Factura>('facturas_compra', { select: '*', id: `eq.${id}` }),
    proveedores(), API.get<Ped[]>('pedidos_compra', { select: 'id,numero,proveedor_id,total,estado,fecha', estado: 'neq.Cancelado', order: 'numero.desc', limit: '200' })]);
  const f = r.data;
  if (!nueva && !f) return '<p class="aviso mal">No se encontró la factura.</p><p><a href="#/almacen/facturas">← Facturas</a></p>';
  _adjunto = null;
  const ped = (peds.data ?? []).find(p => p.id === (f?.pedido_compra_id ?? pedidoId));
  const provId = f?.proveedor_id ?? ped?.proveedor_id ?? '';
  return `<p><a href="#/almacen/facturas">← Facturas de compra</a></p>
    <form class="tarjeta" id="afc-form" data-on-submit="afcGuardar" data-prevent="1" data-id="${esc(f?.id ?? '')}">
      <div class="tarjeta-cab"><h3>${nueva ? 'Nueva factura de compra' : 'Factura de compra'}</h3>
        ${f ? `<span class="chip ${f.estado === 'Pagada' ? 'bien' : vencida(f) ? 'mal' : 'aviso'}">${f.estado === 'Pagada' ? `Pagada${f.pagada_at ? ` el ${esc(f.pagada_at)}` : ''}` : vencida(f) ? 'Vencida' : 'Pendiente'}</span>` : ''}</div>
      <label>${f?.archivo_path ? 'Cambiar el adjunto' : 'Foto o PDF de la factura'} <input id="afc-archivo" type="file" accept="image/*,application/pdf" data-on-change="afcArchivo:$this"></label>
      <p id="afc-leido" class="nota">${f?.archivo_path ? `<button type="button" class="btn secundario" data-action="afcVer" data-p0="${esc(f.id)}">${ico('adjunto')} Ver el adjunto</button>` : 'Con el adjunto, Claude rellena lo que lea (proveedor, número, fechas e importes) y tú lo revisas.'}</p>
      <div class="in-campos">
        <label>Proveedor <select id="afc-proveedor" required><option value="">— Elige —</option>${provs.map(p => `<option value="${esc(p.id)}" ${p.id === provId ? 'selected' : ''}>${esc(p.nombre)}${p.activo ? '' : ' (inactivo)'}</option>`).join('')}</select></label>
        <label>Pedido <select id="afc-pedido"><option value="">— Ninguno —</option>${(peds.data ?? []).map(p => `<option value="${esc(p.id)}" ${p.id === ped?.id ? 'selected' : ''}>#${p.numero} · ${esc(p.fecha)} · ${eur(p.total, 2)}</option>`).join('')}</select></label>
        <label>Número <input id="afc-numero" value="${esc(f?.numero ?? '')}"></label>
        <label>Fecha <input id="afc-fecha" type="date" value="${esc(f?.fecha ?? hoy())}" required></label>
        <label>Vence <input id="afc-vence" type="date" value="${esc(f?.vence ?? '')}"></label>
        <label>Base (€) <input id="afc-base" type="number" step="0.01" min="0" value="${esc(f?.base ?? '')}"></label>
        <label>Impuesto (€) <input id="afc-impuesto" type="number" step="0.01" min="0" value="${esc(f?.impuesto ?? '')}"></label>
        <label>Importe total (€) <input id="afc-importe" type="number" step="0.01" min="0" required value="${esc(f?.importe ?? ped?.total ?? '')}"></label>
      </div>
      <label>Notas <textarea id="afc-notas" rows="2">${esc(f?.notas ?? '')}</textarea></label>
      <label class="check"><input id="afc-pagada" type="checkbox" ${f?.estado === 'Pagada' ? 'checked' : ''}> Pagada</label>
      <div class="acciones"><button class="btn" type="submit">Guardar</button>
        ${f && esAdmin() ? `<button type="button" class="btn peligro" data-action="afcBorrar" data-p0="${esc(f.id)}">Eliminar</button>` : ''}</div>
    </form>`;
}

async function rellenar(l: Lectura) {
  const pon = (id: string, v: unknown) => { const e = document.getElementById(id) as HTMLInputElement | null; if (e && v != null && v !== '' && !e.value) e.value = String(v); };
  pon('afc-fecha', l.fecha); pon('afc-base', l.base); pon('afc-impuesto', l.impuesto); pon('afc-importe', l.total);
  const sel = document.getElementById('afc-proveedor') as HTMLSelectElement;
  let nota = '';
  if (sel && !sel.value && (l.proveedor || l.nif)) {
    const provs = await proveedores();
    const p = provs.find(x => l.nif && norm(x.nif) && norm(x.nif) === norm(l.nif)) ?? provs.find(x => l.proveedor && norm(x.nombre) === norm(l.proveedor));
    if (p) sel.value = p.id;
    else nota = ` El proveedor «${l.proveedor ?? l.nif}» no está en la lista: dalo de alta en Proveedores.`;
  }
  return nota;
}

registrarAcciones({
  afcFiltro(f: string) { _filtro = f; resolver(); },
  afcAbrir(id: string) { ir('almacen', 'facturas', id); },
  async afcArchivo(input: HTMLInputElement) {
    const f = input.files?.[0];
    const p = document.getElementById('afc-leido')!;
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { p.textContent = 'El fichero pasa de 12 MB.'; return; }
    p.className = 'nota cargando'; p.textContent = 'Subiendo y leyendo…';
    const r = await llamarFuncion<{ ruta: string; tipo: string; lectura: Lectura | null }>('gastos-ocr', { accion: 'compra', archivo: await aBase64(f), tipo: f.type || 'image/jpeg' }, 120000);
    p.className = 'nota';
    if (r.error || !r.data) { p.textContent = `No se pudo subir: ${r.error ?? 'sin respuesta'}`; return; }
    _adjunto = { ruta: r.data.ruta, tipo: r.data.tipo };
    p.textContent = r.data.lectura ? `Adjunto listo. Leído por Claude: revisa los datos.${await rellenar(r.data.lectura)}` : 'Adjunto listo (sin Claude: rellena los datos a mano).';
  },
  async afcVer(id: string) {
    const r = await llamarFuncion<{ url: string }>('gastos-ocr', { accion: 'compra_url', id });
    if (r.data?.url) window.open(r.data.url, '_blank', 'noopener'); else toast(r.error ?? 'No se pudo abrir el adjunto', 'error');
  },
  async afcGuardar() {
    const id = (document.getElementById('afc-form') as HTMLElement).dataset.id || null;
    const importe = numOrNull('afc-importe');
    if (!val('afc-proveedor')) { toast('Elige el proveedor', 'error'); return; }
    if (importe == null || importe < 0) { toast('El importe es obligatorio', 'error'); return; }
    const d: Record<string, unknown> = { proveedor_id: val('afc-proveedor'), pedido_compra_id: val('afc-pedido') || null, numero: val('afc-numero') || null,
      fecha: val('afc-fecha') || hoy(), vence: val('afc-vence') || null, base: numOrNull('afc-base'), impuesto: numOrNull('afc-impuesto'), importe,
      notas: val('afc-notas') || null, estado: (document.getElementById('afc-pagada') as HTMLInputElement).checked ? 'Pagada' : 'Pendiente' };
    if (_adjunto) { d.archivo_path = _adjunto.ruta; d.archivo_tipo = _adjunto.tipo; }
    const r = id ? await API.patch('facturas_compra', { id: `eq.${id}` }, d) : await API.post<Factura[]>('facturas_compra', d);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    _adjunto = null;
    toast('Factura guardada');
    const nuevoId = !id && Array.isArray(r.data) ? (r.data[0] as Factura | undefined)?.id : null;
    if (nuevoId) ir('almacen', 'facturas', nuevoId); else resolver();
  },
  async afcBorrar(id: string) {
    if (!confirm('¿Eliminar esta factura de compra? No se puede deshacer.')) return;
    const r = await API.delete('facturas_compra', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Factura eliminada');
    ir('almacen', 'facturas');
  },
});
