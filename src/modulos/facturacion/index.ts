// Facturación propia (fase 11) — PROGRAMADA Y SIN ACTIVAR: Zoho sigue
// emitiendo. Hasta que `hub.config.facturacion_activa` sea true solo se emite
// la serie de PRUEBA (sin valor fiscal), para que la gestoría la revise.
// #/facturacion (lista), /nueva, /trabajos (desde trabajos por facturar),
// /ajustes (datos del emisor) y /<id> (borrador editable o factura emitida
// para imprimir, cobrar o rectificar). Solo admins. Prefijo de ids: fa-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esc, toast, fecha } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { buscarClientes, nombresClientes, eur } from '../ventas/datos';

interface Factura { id: string; created_at: string; serie: string; codigo: string | null; estado: string; tipo: string; rectifica_id: string | null; motivo_rectificacion: string | null;
  cliente_id: string | null; cliente_nombre: string | null; cliente_nif: string | null; cliente_direccion: string | null; cliente_email: string | null; emisor: Record<string, string> | null;
  fecha_emision: string | null; fecha_operacion: string | null; vencimiento: string | null; forma_pago: string | null; notas: string | null;
  base_total: number; impuesto_total: number; total: number; cobrado: number; huella: string | null; huella_anterior: string | null; emitida_at: string | null; trabajo_ids: string[] }
interface Linea { id: string; factura_id: string; orden: number; concepto: string; detalle: string | null; cantidad: number; precio: number; descuento_pct: number; impuesto_pct: number; base: number }
interface Serie { codigo: string; nombre: string; prueba: boolean; rectificativa: boolean }

const IGIC = [7, 3, 0, 9.5, 15, 5, 20];
const n2 = (v: number) => Number(v ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let _f: Factura | null = null;
let _series: Serie[] = [];
let _timer = 0;

async function estadoActivacion(): Promise<boolean> {
  const { data } = await API.single<{ valor: unknown }>('config', { select: 'valor', clave: 'eq.facturacion_activa' });
  return data?.valor === true || data?.valor === 'true';
}
const banner = (activa: boolean) => activa ? '' : `<p class="aviso fa-banner">${ico('atencion')} <strong>Sin activar.</strong> Las facturas de verdad las sigue haciendo Zoho Books.
  Aquí solo se emite la serie de <strong>PRUEBA</strong> (sin valor fiscal) para que la gestoría lo revise. Se activa cuando ella lo valide y Fran dé el OK (ver docs/FASE11.md).</p>`;

async function series(): Promise<Serie[]> {
  if (_series.length) return _series;
  return (_series = (await API.get<Serie[]>('series_factura', { select: '*', activa: 'eq.true', order: 'codigo' })).data ?? []);
}

// ── Lista ──────────────────────────────────────────────────────────────────
async function vistaLista(): Promise<string> {
  const [activa, fs] = await Promise.all([estadoActivacion(), API.get<Factura[]>('facturas', { select: '*', order: 'created_at.desc', limit: '300' })]);
  const lista = fs.data ?? [];
  return `${banner(activa)}<div class="acciones pr-barra"><button class="btn" data-action="faNueva">${ico('mas')} Factura</button><a class="btn secundario" href="#/facturacion/trabajos">Desde trabajos por facturar</a>
      <a class="btn secundario" href="#/facturacion/ajustes">Datos del emisor</a></div>
    <div class="tarjeta mo-scroll">${lista.length ? `<table class="tabla"><thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Cobrado</th><th>Estado</th></tr></thead><tbody>
    ${lista.map(f => `<tr class="fila-clic" data-action="faAbrir" data-p0="${f.id}"><td>${f.codigo ? esc(f.codigo) : '<span class="nota">borrador</span>'}${f.serie === 'P' ? ' <span class="chip">PRUEBA</span>' : ''}${f.tipo === 'rectificativa' ? ' <span class="chip aviso">rectificativa</span>' : ''}</td>
      <td>${esc(f.cliente_nombre ?? '')}</td><td>${esc(fecha(f.fecha_emision, true))}</td><td>${eur(f.total, 2)}</td><td>${f.estado === 'borrador' ? '' : eur(f.cobrado, 2)}</td>
      <td><span class="chip ${f.estado === 'emitida' ? (f.cobrado >= f.total ? 'bien' : 'aviso') : ''}">${esc(f.estado === 'emitida' && f.cobrado >= f.total ? 'cobrada' : f.estado)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Ninguna todavía.</p>'}</div>`;
}

// ── Desde trabajos ─────────────────────────────────────────────────────────
async function vistaTrabajos(): Promise<string> {
  const activa = await estadoActivacion();
  const { data: ts } = await API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,estado,cliente_id,fecha_programada', estado: 'in.("Para facturar",Completado)', order: 'cliente_id,numero' });
  const { data: usadas } = await API.get<{ trabajo_ids: string[] }[]>('facturas', { select: 'trabajo_ids', estado: 'neq.borrador' });
  const ya = new Set((usadas ?? []).flatMap(u => u.trabajo_ids ?? []));
  const pendientes = (ts ?? []).filter(t => !ya.has(t.id));
  const nombres = await nombresClientes(pendientes.map(t => t.cliente_id));
  const por = new Map<string, any[]>();
  for (const t of pendientes) por.set(t.cliente_id ?? '', [...(por.get(t.cliente_id ?? '') ?? []), t]);
  return `${banner(activa)}<p><a href="#/facturacion">← Facturación</a></p><h2>Trabajos por facturar</h2>
    <p class="nota">Trabajos de la app en «Para facturar» o «Completado». Marca los de un cliente y se prepara el borrador con una línea por trabajo (título y lo que se hizo) y su material.</p>
    ${[...por.entries()].map(([cid, lista]) => `<section class="tarjeta"><div class="tarjeta-cab"><h3>${esc(cid ? nombres.get(cid) ?? '¿?' : 'Sin cliente')}</h3>
      ${cid ? `<button class="btn" data-action="faDesdeTrabajos" data-p0="${esc(cid)}">Preparar factura</button>` : '<span class="nota">ponles cliente en la app</span>'}</div>
      <ul class="fa-trabajos">${lista.map(t => `<li><label class="check"><input type="checkbox" class="fa-tr" data-cli="${esc(cid)}" value="${t.id}" checked> #${t.numero} ${esc(t.titulo ?? t.descripcion?.slice(0, 80) ?? '')}
        <small class="nota">${esc(t.estado)}${t.fecha_programada ? ` · ${esc(fecha(t.fecha_programada, true))}` : ''}</small></label></li>`).join('')}</ul></section>`).join('') || '<p class="vacio">No hay trabajos por facturar.</p>'}`;
}

// ── Ficha ──────────────────────────────────────────────────────────────────
function desglose(ls: Linea[]): string {
  const por = new Map<number, number>();
  for (const l of ls) por.set(Number(l.impuesto_pct), (por.get(Number(l.impuesto_pct)) ?? 0) + Number(l.base));
  return [...por.entries()].map(([pct, base]) => `<tr><td>Base al ${String(pct).replace('.', ',')} %</td><td>${n2(base)} €</td><td>IGIC ${String(pct).replace('.', ',')} %</td><td>${n2(Math.round(base * pct) / 100)} €</td></tr>`).join('');
}

function imprimible(f: Factura, ls: Linea[]): string {
  const e = f.emisor ?? {};
  return `<article class="tarjeta fa-factura ${f.serie === 'P' ? 'fa-prueba' : ''}">
    ${f.serie === 'P' ? '<p class="fa-marca">PRUEBA — SIN VALOR FISCAL</p>' : ''}
    <header class="fa-cab"><div><strong>${esc(e.nombre ?? '')}</strong>${e.nombre_comercial ? `<br>${esc(e.nombre_comercial)}` : ''}<br>NIF ${esc(e.nif ?? '')}<br>${esc(e.direccion ?? '')} ${esc(e.cp ?? '')} ${esc(e.municipio ?? '')}</div>
      <div class="fa-num"><h2>${f.tipo === 'rectificativa' ? 'Factura rectificativa' : 'Factura'} ${esc(f.codigo ?? '')}</h2>Fecha: ${esc(fecha(f.fecha_emision, true))}${f.fecha_operacion && f.fecha_operacion !== f.fecha_emision ? `<br>Operación: ${esc(fecha(f.fecha_operacion, true))}` : ''}<br>Vence: ${esc(fecha(f.vencimiento, true))}</div></header>
    <section class="fa-cliente"><strong>${esc(f.cliente_nombre ?? '')}</strong><br>${f.cliente_nif ? `NIF ${esc(f.cliente_nif)}<br>` : ''}${esc(f.cliente_direccion ?? '')}</section>
    ${f.tipo === 'rectificativa' && f.motivo_rectificacion ? `<p>Motivo de la rectificación: ${esc(f.motivo_rectificacion)}</p>` : ''}
    <table class="tabla"><thead><tr><th>Concepto</th><th>Cant.</th><th>Precio</th><th>Dto.</th><th>IGIC</th><th>Importe</th></tr></thead><tbody>
      ${ls.map(l => `<tr><td>${esc(l.concepto)}${l.detalle ? `<br><small>${esc(l.detalle)}</small>` : ''}</td><td>${n2(l.cantidad)}</td><td>${n2(l.precio)}</td><td>${l.descuento_pct ? `${n2(l.descuento_pct)} %` : ''}</td><td>${String(l.impuesto_pct).replace('.', ',')} %</td><td>${n2(l.base)}</td></tr>`).join('')}</tbody></table>
    <table class="tabla fa-totales"><tbody>${desglose(ls)}<tr><th colspan="3">Total</th><th>${n2(f.total)} €</th></tr></tbody></table>
    <p class="nota">Forma de pago: ${esc(f.forma_pago ?? '')}${e.iban ? ` · IBAN ${esc(e.iban)}` : ''}${f.notas ? `<br>${esc(f.notas)}` : ''}</p>
    ${f.huella ? `<p class="fa-huella">Huella: ${esc(f.huella)}${f.huella_anterior ? `<br>Anterior: ${esc(f.huella_anterior)}` : ''}</p>` : ''}</article>`;
}

async function vistaFicha(id: string): Promise<string> {
  const [{ data: f }, ls, ss, activa] = await Promise.all([API.single<Factura>('facturas', { select: '*', id: `eq.${id}` }),
    API.get<Linea[]>('factura_lineas', { select: '*', factura_id: `eq.${id}`, order: 'orden,id' }), series(), estadoActivacion()]);
  if (!f) return '<p class="aviso mal">No existe esa factura.</p>';
  _f = f;
  const lineas = ls.data ?? [];
  if (f.estado !== 'borrador') {
    const { data: cobros } = await API.get<any[]>('factura_cobros', { select: '*', factura_id: `eq.${id}`, order: 'fecha' });
    return `${banner(activa)}<p class="no-imprimir"><a href="#/facturacion">← Facturación</a></p>${imprimible(f, lineas)}
      <div class="acciones no-imprimir"><button class="btn secundario" data-action="faImprimir">Imprimir o guardar en PDF</button>
        ${f.estado === 'emitida' ? '<button class="btn secundario" data-action="faRectificar">Rectificar</button>' : '<span class="chip">rectificada</span>'}</div>
      <section class="tarjeta no-imprimir"><h3>Cobros · ${eur(f.cobrado, 2)} de ${eur(f.total, 2)}</h3><ul>${(cobros ?? []).map(c => `<li>${esc(fecha(c.fecha, true))} · ${eur(c.importe, 2)} · ${esc(c.medio)}${c.nota ? ` · ${esc(c.nota)}` : ''}</li>`).join('') || '<li class="nota">Nada cobrado.</li>'}</ul>
        ${f.cobrado < f.total ? `<form class="acciones" data-on-submit="faCobrar" data-prevent="1"><input id="fa-cobro-imp" type="number" step="0.01" value="${(f.total - f.cobrado).toFixed(2)}" aria-label="Importe cobrado">
          <select id="fa-cobro-medio" aria-label="Medio"><option>Transferencia</option><option>Tarjeta</option><option>Efectivo</option><option>Bizum</option><option>Domiciliación</option></select>
          <button class="btn secundario" type="submit">Apuntar cobro</button></form>` : ''}</section>`;
  }
  const serieOpts = ss.filter(s => !s.rectificativa || f.tipo === 'rectificativa').map(s => `<option value="${s.codigo}" ${s.codigo === f.serie ? 'selected' : ''} ${!s.prueba && !activa ? 'disabled' : ''}>${esc(s.codigo)} · ${esc(s.nombre)}${!s.prueba && !activa ? ' (sin activar)' : ''}</option>`).join('');
  return `${banner(activa)}<p><a href="#/facturacion">← Facturación</a></p><h2>${f.tipo === 'rectificativa' ? 'Rectificativa' : 'Factura'} en borrador</h2>
    <form class="tarjeta" data-on-submit="faGuardar" data-prevent="1"><div class="in-campos">
      <label>Serie <select id="fa-serie">${serieOpts}</select></label>
      <label>Cliente <input id="fa-cliente-q" autocomplete="off" value="${esc(f.cliente_nombre ?? '')}" placeholder="Buscar…" data-on-input="faBuscarCliente:$value"></label>
      <label>NIF del cliente <input id="fa-nif" value="${esc(f.cliente_nif ?? '')}" placeholder="si no, el de su ficha"></label>
      <label>Fecha <input id="fa-fecha" type="date" value="${esc(f.fecha_emision ?? '')}"></label>
      <label>Forma de pago <input id="fa-pago" value="${esc(f.forma_pago ?? '')}"></label></div>
      <input type="hidden" id="fa-cliente" value="${esc(f.cliente_id ?? '')}"><ul id="fa-cliente-res" class="resultados"></ul>
      <label>Notas <input id="fa-notas" value="${esc(f.notas ?? '')}"></label>
      <div class="acciones"><button class="btn secundario" type="submit">Guardar datos</button></div></form>
    <section class="tarjeta mo-scroll"><h3>Líneas</h3><table class="tabla fa-lineas"><thead><tr><th>Concepto</th><th>Cant.</th><th>Precio</th><th>Dto. %</th><th>IGIC</th><th>Base</th><th></th></tr></thead><tbody>
      ${lineas.map(l => `<tr><td><input value="${esc(l.concepto)}" data-on-change="faLinea:${l.id},concepto,$value" aria-label="Concepto"><textarea rows="1" data-on-change="faLinea:${l.id},detalle,$value" aria-label="Detalle" placeholder="Detalle">${esc(l.detalle ?? '')}</textarea></td>
        <td><input type="number" step="any" value="${l.cantidad}" data-on-change="faLinea:${l.id},cantidad,$value" aria-label="Cantidad"></td>
        <td><input type="number" step="0.01" value="${l.precio}" data-on-change="faLinea:${l.id},precio,$value" aria-label="Precio"></td>
        <td><input type="number" min="0" max="100" step="0.01" value="${l.descuento_pct}" data-on-change="faLinea:${l.id},descuento_pct,$value" aria-label="Descuento"></td>
        <td><select data-on-change="faLinea:${l.id},impuesto_pct,$value" aria-label="IGIC">${IGIC.map(p => `<option value="${p}" ${Number(l.impuesto_pct) === p ? 'selected' : ''}>${String(p).replace('.', ',')} %</option>`).join('')}</select></td>
        <td>${n2(l.base)}</td><td><button class="btn secundario" data-action="faQuitarLinea" data-p0="${l.id}" aria-label="Quitar línea">${ico('cerrar')}</button></td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin líneas.</td></tr>'}
      </tbody></table>
      <form class="acciones" data-on-submit="faAnadirLinea" data-prevent="1"><input id="fa-l-concepto" placeholder="Concepto" required aria-label="Concepto nuevo"><input id="fa-l-cant" type="number" step="any" value="1" aria-label="Cantidad">
        <input id="fa-l-precio" type="number" step="0.01" placeholder="Precio" aria-label="Precio"><button class="btn secundario" type="submit">Añadir línea</button></form>
      <table class="tabla fa-totales"><tbody>${desglose(lineas)}<tr><th colspan="3">Total</th><th>${n2(f.total)} €</th></tr></tbody></table></section>
    <div class="acciones"><button class="btn" data-action="faEmitir">Emitir${f.serie === 'P' ? ' (prueba)' : ''}</button><button class="btn peligro" data-action="faBorrar">Borrar borrador</button></div>`;
}

async function vistaAjustes(): Promise<string> {
  const [{ data: e }, activa] = await Promise.all([API.single<{ valor: Record<string, string> }>('config', { select: 'valor', clave: 'eq.facturacion_emisor' }), estadoActivacion()]);
  const v = e?.valor ?? {};
  const c = (k: string, t: string) => `<label>${t} <input name="${k}" value="${esc(v[k] ?? '')}"></label>`;
  return `${banner(activa)}<p><a href="#/facturacion">← Facturación</a></p><h2>Datos del emisor</h2>
    <form class="tarjeta" data-on-submit="faGuardarEmisor:$this" data-prevent="1"><div class="in-campos">${c('nombre', 'Razón social')}${c('nombre_comercial', 'Nombre comercial')}${c('nif', 'NIF')}
      ${c('direccion', 'Dirección')}${c('cp', 'Código postal')}${c('municipio', 'Municipio')}${c('provincia', 'Provincia')}${c('email', 'Correo')}${c('telefono', 'Teléfono')}${c('iban', 'IBAN para transferencias')}</div>
      <div class="acciones"><button class="btn" type="submit">Guardar</button></div></form>
    <p class="nota">Estado: <strong>${activa ? 'ACTIVADA' : 'sin activar'}</strong>. La activación no está en pantalla a propósito: se hace cuando la gestoría lo valide (ver docs/FASE11.md).</p>`;
}

async function pintar(el: HTMLElement, params: string[]) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [a] = params;
  el.innerHTML = a === 'trabajos' ? await vistaTrabajos() : a === 'ajustes' ? await vistaAjustes() : a ? await vistaFicha(a) : await vistaLista();
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
async function nuevaFactura(extra: Record<string, unknown> = {}): Promise<Factura | null> {
  const activa = await estadoActivacion();
  const r = await API.post<Factura[]>('facturas', { serie: activa ? 'F' : 'P', ...extra });
  if (r.error || !r.data?.[0]) { toast(`No se pudo: ${r.error?.message}`, 'error'); return null; }
  return r.data[0];
}

registrarAcciones({
  faAbrir(id: string) { ir('facturacion', id); },
  async faNueva() { const f = await nuevaFactura(); if (f) ir('facturacion', f.id); },
  async faDesdeTrabajos(clienteId: string) {
    const ids = [...document.querySelectorAll<HTMLInputElement>(`.fa-tr[data-cli="${CSS.escape(clienteId)}"]:checked`)].map(x => x.value);
    if (!ids.length) { toast('Marca algún trabajo', 'error'); return; }
    const [{ data: ts }, { data: ls }, { data: cli }] = await Promise.all([
      API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion', id: `in.(${ids.join(',')})`, order: 'numero' }),
      API.get<any[]>('documento_lineas', { select: 'trabajo_id,nombre,cantidad,precio,descuento,orden', trabajo_id: `in.(${ids.join(',')})`, order: 'orden' }),
      API.single<any>('clientes', { select: 'nombre,nif,direccion,email', id: `eq.${clienteId}` })]);
    const f = await nuevaFactura({ cliente_id: clienteId, cliente_nombre: cli?.nombre ?? null, cliente_nif: cli?.nif ?? null, cliente_direccion: cli?.direccion ?? null, cliente_email: cli?.email ?? null, trabajo_ids: ids });
    if (!f) return;
    let orden = 1;
    const lineas = (ts ?? []).flatMap(t => [
      { factura_id: f.id, orden: orden++, concepto: `Trabajo #${t.numero}${t.titulo ? ` · ${t.titulo}` : ''}`, detalle: t.descripcion ?? null, cantidad: 1, precio: 0 },
      ...(ls ?? []).filter(l => l.trabajo_id === t.id).map(l => ({ factura_id: f.id, orden: orden++, concepto: l.nombre, cantidad: Number(l.cantidad) || 1, precio: Number(l.precio) || 0, descuento_pct: Number(l.descuento) || 0 })),
    ]);
    const r = await API.post('factura_lineas', lineas);
    if (r.error) toast(`Borrador creado, pero sin líneas: ${r.error.message}`, 'error'); else toast('Borrador preparado: pon el precio de la mano de obra y revisa');
    ir('facturacion', f.id);
  },
  faBuscarCliente(q: string) {
    clearTimeout(_timer);
    (document.getElementById('fa-cliente') as HTMLInputElement).value = '';
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById('fa-cliente-res');
      if (ul) ul.innerHTML = (await buscarClientes(q)).map(c => `<li><button type="button" class="btn secundario" data-action="faElegirCliente" data-p0="${c.id}" data-p1="${esc(c.nombre)}">${esc(c.nombre)} <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  async faElegirCliente(id: string, nombre: string) {
    (document.getElementById('fa-cliente') as HTMLInputElement).value = id;
    (document.getElementById('fa-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('fa-cliente-res'); if (ul) ul.innerHTML = '';
    const { data } = await API.single<any>('clientes', { select: 'nif', id: `eq.${id}` });
    const nif = document.getElementById('fa-nif') as HTMLInputElement; if (!nif.value && data?.nif) nif.value = data.nif;
  },
  async faGuardar() {
    if (!_f) return;
    const cid = val('fa-cliente') || _f.cliente_id;
    const cli = cid && cid !== _f.cliente_id ? (await API.single<any>('clientes', { select: 'nombre,direccion,email', id: `eq.${cid}` })).data : null;
    const r = await API.patch('facturas', { id: `eq.${_f.id}` }, { serie: val('fa-serie') || _f.serie, cliente_id: cid || null, cliente_nif: val('fa-nif') || null,
      ...(cli ? { cliente_nombre: cli.nombre, cliente_direccion: cli.direccion, cliente_email: cli.email } : {}),
      fecha_emision: val('fa-fecha') || null, forma_pago: val('fa-pago') || null, notas: val('fa-notas') || null });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast('Guardado'); resolver(); }
  },
  async faLinea(id: string, campo: string, v: string) {
    if (!['concepto', 'detalle', 'cantidad', 'precio', 'descuento_pct', 'impuesto_pct'].includes(campo)) return;
    const valor = ['concepto', 'detalle'].includes(campo) ? (v || null) : Number(v) || 0;
    const r = await API.patch('factura_lineas', { id: `eq.${id}` }, { [campo]: valor });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else if (campo !== 'detalle' && campo !== 'concepto') resolver();
  },
  async faAnadirLinea() {
    if (!_f) return;
    const r = await API.post('factura_lineas', { factura_id: _f.id, orden: 99, concepto: val('fa-l-concepto'), cantidad: Number(val('fa-l-cant')) || 1, precio: Number(val('fa-l-precio')) || 0 });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async faQuitarLinea(id: string) {
    const r = await API.delete('factura_lineas', { id: `eq.${id}` });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async faEmitir() {
    if (!_f || !confirm(_f.serie === 'P' ? '¿Emitir esta factura de PRUEBA?' : 'Una factura emitida ya no se puede cambiar ni borrar (solo rectificar). ¿Emitir?')) return;
    const r = await API.rpc<Factura>('emitir_factura', { p_id: _f.id });
    if (r.error) toast(r.error.message, 'error'); else { toast(`Emitida ${(r.data as Factura)?.codigo ?? ''}`); resolver(); }
  },
  async faBorrar() {
    if (!_f || !confirm('¿Borrar este borrador?')) return;
    const r = await API.delete('facturas', { id: `eq.${_f.id}` });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else ir('facturacion');
  },
  faImprimir() { window.print(); },
  async faRectificar() {
    if (!_f) return;
    const motivo = prompt(`¿Por qué se rectifica ${_f.codigo}? (sale en la factura rectificativa)`);
    if (!motivo) return;
    const r = await API.rpc<string>('crear_rectificativa', { p_id: _f.id, p_motivo: motivo });
    if (r.error) toast(r.error.message, 'error'); else { toast('Rectificativa en borrador: revísala y emítela'); ir('facturacion', String(r.data)); }
  },
  async faCobrar() {
    if (!_f) return;
    const r = await API.post('factura_cobros', { factura_id: _f.id, importe: Number(val('fa-cobro-imp')), medio: val('fa-cobro-medio') });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast('Cobro apuntado'); resolver(); }
  },
  async faGuardarEmisor(f: HTMLFormElement) {
    const d = Object.fromEntries([...new FormData(f).entries()].map(([k, v]) => [k, String(v).trim()]));
    const r = await API.patch('config', { clave: 'eq.facturacion_emisor' }, { valor: d });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else toast('Datos del emisor guardados');
  },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('facturas', { estado: 'eq.borrador' });
  return n == null ? null : { valor: n, subtitulo: 'borradores · sin activar (Zoho sigue)', tono: 'neutro' };
}

export const moduloFacturacion: Modulo = {
  id: 'facturacion',
  titulo: 'Facturación (sin activar)',
  grupo: 'Clientes',
  icono: '💶',
  soloAdmin: true,
  explicacion: 'La facturación propia del hub, lista pero SIN ACTIVAR: las facturas de verdad las sigue haciendo Zoho Books. Aquí se prueba con una serie sin valor fiscal para que la gestoría la revise: numeración sin huecos, IGIC por línea, rectificativas y cada factura encadenada con la anterior.',
  pintar,
  contador,
};
