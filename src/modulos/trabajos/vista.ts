// Trabajos (fase Final): #/trabajos (lista con filtros) y #/trabajos/<numero>
// (ficha). Mientras el área `trabajos` sea de la app, solo lectura; al cortarla,
// escribe por las funciones de la base que portan las reglas de la app:
// hub.trabajo_estado (Completado exige fichaje), hub.trabajo_guardar_lineas
// (el material mueve el stock). Alta y edición en formulario.ts (#/trabajos/nuevo,
// #/trabajos/<n>/editar); duplicar y continuación, desde la ficha. Prefijo de ids: tr-.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { equipo } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { markdown } from '../../ui/markdown';
import { nombresClientes, telWhatsApp, eur } from '../ventas/datos';
import { pintarFormulario, ofrecerFacturar } from './formulario';
import { APP_ACTUAL_URL } from '../../core/config';
import { descargarCsv } from '../../ui/csv';
import { botonChatFicha } from '../../ui/chat-ficha';
import { seccionChecklist } from './checklist-visita';
import { enlaceHistorial } from '../../ui/historial';

interface Trabajo { id: string; numero: number; created_at: string; titulo: string | null; tipo?: string | null; chain_root_id?: string | null; descripcion: string | null; estado: string; tecnicos: string[] | null;
  cliente_id: string | null; local_id: string | null; contacto_id: string | null; fecha_programada: string | null; hora_llegada: string | null; prioridad: string | null;
  materiales: string | null; observaciones: string | null; firma_cliente?: string | null; presupuesto_id: string | null; zoho_invoice_number: string | null; duracion_teorica: number | null }
interface Linea { id?: string; nombre: string; cantidad: number; precio: number; descuento: number; inventario_id: string | null; furgoneta_id: string | null; categoria: string | null }

export const ESTADOS = ['Pendiente', 'En progreso', 'Completado', 'Para facturar', 'Facturado', 'No facturar', 'Cancelado'];
const FILTROS: Record<string, string[] | null> = { abiertos: ['Pendiente', 'En progreso'], facturar: ['Completado', 'Para facturar'], cerrados: ['Facturado', 'No facturar', 'Cancelado'], todos: null };
const TONO: Record<string, string> = { Pendiente: '', 'En progreso': 'aviso', Completado: 'bien', 'Para facturar': 'aviso', Facturado: 'bien', 'No facturar': '', Cancelado: '' };
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const esMio = (tecnicos: string[] | null) => { const n = norm(usuario()?.nombre); return (tecnicos ?? []).some(t => { const g = norm(t); return g === n || g === n.split(/\s+/)[0]; }); };

let _lista: Trabajo[] = [];
let _nombres = new Map<string, string>();
let _t: Trabajo | null = null;
let _lineas: Linea[] = [];
let _arrastrado = '';
// Trabajos marcados para facturarlos juntos (lista «Por facturar»).
const _sel = new Set<string>();

function filas(): Trabajo[] {
  const q = norm(leer('hub_tr_q', ''));
  const tec = leer('hub_tr_tecnico', '');
  return _lista.filter(t => (!tec || (tec === '__yo' ? esMio(t.tecnicos) : (t.tecnicos ?? []).includes(tec)))
    && (!q || norm(`${t.numero} ${t.titulo ?? ''} ${t.descripcion ?? ''} ${_nombres.get(t.cliente_id ?? '') ?? ''}`).includes(q)));
}
const facturando = () => _escribe && leer('hub_tr_filtro', 'abiertos') === 'facturar';
const barraSel = () => facturando() ? `<div class="acciones tr-sel" id="tr-sel"><span class="nota">${_sel.size ? `${_sel.size} ${_sel.size === 1 ? 'trabajo marcado' : 'trabajos marcados'}` : 'Marca los trabajos que van en la misma factura.'}</span>
  <button class="btn" data-action="trFacturarSel" ${_sel.size ? '' : 'disabled'}>💶 Facturar ${_sel.size ? `(${_sel.size})` : ''}</button></div>` : '';
const tabla = () => { const fs = filas(); return fs.length ? `${barraSel()}<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr>${facturando() ? '<th><span class="sr">Marcar</span></th>' : ''}<th>#</th><th>Trabajo</th><th>Cliente</th><th>Técnicos</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>
  ${fs.map(t => `<tr class="fila-clic" data-action="trAbrir" data-p0="${t.numero}">${facturando() ? `<td><input type="checkbox" aria-label="Marcar #${t.numero}" data-action="trSel" data-p0="${t.id}" data-p1="$this" ${_sel.has(t.id) ? 'checked' : ''}></td>` : ''}<td>${t.numero}</td><td><strong>${esc(t.titulo ?? '')}</strong><br><small class="nota">${esc((t.descripcion ?? '').slice(0, 90))}</small></td>
    <td>${esc(_nombres.get(t.cliente_id ?? '') ?? '')}</td><td>${esc((t.tecnicos ?? []).join(', '))}</td><td>${esc(t.fecha_programada ?? '')}${t.hora_llegada ? ` ${esc(t.hora_llegada.slice(0, 5))}` : ''}</td>
    <td><span class="chip ${TONO[t.estado] ?? ''}">${esc(t.estado)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Ningún trabajo con ese filtro.</p>'; };

// Kanban por estado (las columnas son los estados del filtro elegido); con el
// área cortada se arrastra de columna para cambiar el estado (hub.trabajo_estado).
const COLS_KANBAN = ['Pendiente', 'En progreso', 'Completado', 'Para facturar'];
let _escribe = false;
const kanban = () => {
  const fs = filas();
  const cols = FILTROS[leer('hub_tr_filtro', 'abiertos')] ?? ESTADOS;
  const usadas = cols.length > 4 ? cols : [...new Set([...cols, ...COLS_KANBAN.filter(c => cols.includes(c))])];
  return `<div class="pr-kanban tr-kanban">${usadas.map(e => {
    const col = fs.filter(t => t.estado === e);
    return `<section class="pr-columna" data-estado="${esc(e)}" ${_escribe ? `data-on-dragover="trSobre:$this" data-prevent="1" data-on-dragleave="trFuera:$this" data-on-drop="trSoltar:${esc(e)}"` : ''}>
      <header><h3>${esc(e)}</h3><span class="chip">${col.length}</span></header>
      <div class="pr-col-cuerpo">${col.map(t => `<article class="pr-tarjeta" ${_escribe ? `draggable="true" data-on-dragstart="trArrastrar:${t.id}"` : ''} data-action="trAbrir" data-p0="${t.numero}">
        <strong>#${t.numero} ${esc(t.titulo ?? '')}</strong><small class="nota">${esc(_nombres.get(t.cliente_id ?? '') ?? '')}</small>
        <small class="nota">${esc((t.tecnicos ?? []).join(', ') || 'Sin técnico')}${t.fecha_programada ? ` · ${esc(t.fecha_programada)}` : ''}</small></article>`).join('') || '<p class="vacio">—</p>'}</div>
    </section>`;
  }).join('')}</div>`;
};
const cuerpoLista = () => (leer('hub_tr_vista', 'lista') === 'kanban' ? kanban() : tabla());

// Exportar lo filtrado a Excel: CSV con BOM y «;», que Excel en español abre
// con las columnas bien (exportTrabajosExcel de la app).
function exportarCsv() {
  descargarCsv('trabajos', ['Nº', 'Título', 'Tipo', 'Cliente', 'Técnicos', 'Fecha', 'Hora', 'Estado', 'Descripción'],
    filas().map(t => [t.numero, t.titulo, t.tipo, _nombres.get(t.cliente_id ?? '') ?? '', (t.tecnicos ?? []).join(', '), t.fecha_programada ?? '',
      t.hora_llegada ? new Date(t.hora_llegada).toTimeString().slice(0, 5) : '', t.estado, t.descripcion]));
}

async function vistaLista(): Promise<string> {
  const f = leer('hub_tr_filtro', 'abiertos');
  const est = FILTROS[f];
  const [{ data, error }, personas, escribe] = await Promise.all([
    API.get<Trabajo[]>('trabajos', { select: 'id,numero,created_at,titulo,tipo,descripcion,estado,tecnicos,cliente_id,fecha_programada,hora_llegada,prioridad',
      ...(est ? { estado: `in.(${est.map(e => `"${e}"`).join(',')})` } : {}), order: 'numero.desc', limit: '400' }),
    equipo(), esDelHub('trabajos')]);
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  _escribe = escribe;
  _lista = data ?? [];
  _nombres = await nombresClientes(_lista.map(t => t.cliente_id));
  const tec = leer('hub_tr_tecnico', '');
  const vista = leer('hub_tr_vista', 'lista');
  return `${escribe ? '' : avisoSoloLectura('Trabajos')}
    <div class="acciones">${escribe ? '<a class="btn" href="#/trabajos/nuevo">+ Nuevo trabajo</a>' : `<a class="btn secundario" href="${esc(APP_ACTUAL_URL)}" target="_blank" rel="noopener">+ Nuevo trabajo en la app ↗</a>`}
      <div class="segmentado" role="tablist" aria-label="Vista">${(['lista', 'kanban'] as const).map(v => `<button role="tab" aria-selected="${v === vista}" class="${v === vista ? 'activo' : ''}" data-action="trVista" data-p0="${v}">${v === 'lista' ? '☰ Lista' : '▦ Kanban'}</button>`).join('')}</div>
      <button class="btn secundario" data-action="trExportar">⬇ Excel</button><a class="btn secundario" href="#/trabajos/plantillas">Plantillas</a></div>
    <div class="acciones pr-barra"><div class="segmentado" role="tablist">${Object.keys(FILTROS).map(k => `<button role="tab" aria-selected="${k === f}" class="${k === f ? 'activo' : ''}" data-action="trFiltro" data-p0="${k}">${{ abiertos: 'Abiertos', facturar: 'Por facturar', cerrados: 'Cerrados', todos: 'Todos' }[k]}</button>`).join('')}</div>
      <select id="tr-tecnico" data-on-change="trTecnico:$value" aria-label="Técnico"><option value="">Todos</option><option value="__yo" ${tec === '__yo' ? 'selected' : ''}>Los míos</option>${personas.map(p => `<option ${tec === p.nombre ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>
      <input id="tr-q" type="search" placeholder="Buscar nº, cliente, texto…" value="${esc(leer('hub_tr_q', ''))}" data-on-input="trBuscar:$value" aria-label="Buscar trabajos"></div>
    <div id="tr-lista">${cuerpoLista()}</div>`;
}

function editorLineas(): string {
  return `<table class="tabla tr-lineas"><thead><tr><th>Material o concepto</th><th>Cant.</th><th>Precio</th><th>Dto. %</th><th></th></tr></thead><tbody>
    ${_lineas.map((l, i) => `<tr><td>${esc(l.nombre)}${l.inventario_id ? ' <small class="nota">(del inventario)</small>' : ''}</td>
      <td><input type="number" min="0" step="any" value="${l.cantidad}" data-on-change="trLinea:${i},cantidad,$value" aria-label="Cantidad"></td>
      <td><input type="number" step="0.01" value="${l.precio}" data-on-change="trLinea:${i},precio,$value" aria-label="Precio"></td>
      <td><input type="number" min="0" max="100" value="${l.descuento}" data-on-change="trLinea:${i},descuento,$value" aria-label="Descuento"></td>
      <td><button class="btn secundario" data-action="trQuitarLinea" data-p0="${i}" aria-label="Quitar">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin material.</td></tr>'}
    </tbody></table>
    <form class="acciones" data-on-submit="trAnadirLinea" data-prevent="1"><input id="tr-l-q" placeholder="Material del inventario o texto libre" autocomplete="off" data-on-input="trBuscarInv:$value" aria-label="Material">
      <input id="tr-l-cant" type="number" min="0" step="any" value="1" aria-label="Cantidad"><input type="hidden" id="tr-l-inv"><input type="hidden" id="tr-l-furgo"><input type="hidden" id="tr-l-precio">
      <button class="btn secundario" type="submit">Añadir</button></form><ul id="tr-inv-res" class="resultados"></ul>
    <div class="acciones"><button class="btn" data-action="trGuardarLineas">Guardar material</button><span class="nota">Lo que se añade del inventario se descuenta del stock; lo que se quita, vuelve.</span></div>`;
}

async function vistaFicha(numero: string): Promise<string> {
  // Por número (#/trabajos/151) o por id: las fichas de sede, contacto, tarea y
  // presupuesto enlazan con el id del trabajo.
  const filtro: Record<string, string> = /^[0-9a-f-]{36}$/i.test(numero) ? { id: `eq.${numero}` } : { numero: `eq.${Number(numero) || 0}` };
  const { data: t } = await API.single<Trabajo>('trabajos', { select: '*', ...filtro });
  if (!t) return '<p class="aviso mal">No existe ese trabajo.</p><p><a href="#/trabajos">← Trabajos</a></p>';
  _t = t;
  const [cli, loc, con, bloques, ses, lin, coms, fotos, tks, personas, escribe] = await Promise.all([
    t.cliente_id ? API.single<any>('clientes', { select: 'id,nombre,telefono', id: `eq.${t.cliente_id}` }) : Promise.resolve({ data: null }),
    t.local_id ? API.single<any>('locales', { select: 'id,nombre,direccion,lat,lng,maps_url,plan', id: `eq.${t.local_id}` }) : Promise.resolve({ data: null }),
    t.contacto_id ? API.single<any>('contactos', { select: 'nombre,telefono', id: `eq.${t.contacto_id}` }) : Promise.resolve({ data: null }),
    API.get<any[]>('agenda', { select: 'id,inicio,fin,tecnicos,estado,notas', trabajo_id: `eq.${t.id}`, order: 'inicio' }),
    API.get<any[]>('sesiones', { select: 'id,traslado,inicio,fin,duracion_min,tecnico_nombre', entidad_tipo: 'eq.trabajo', entidad_id: `eq.${t.id}`, order: 'inicio' }),
    API.get<Linea[]>('documento_lineas', { select: 'id,nombre,cantidad,precio,descuento,inventario_id,furgoneta_id,categoria', trabajo_id: `eq.${t.id}`, order: 'orden' }),
    API.get<any[]>('trabajo_comentarios', { select: '*', trabajo_id: `eq.${t.id}`, order: 'created_at' }),
    API.get<any[]>('trabajo_fotos', { select: 'id,created_at,descripcion,drive_url,archivo_path,tecnico_id', trabajo_id: `eq.${t.id}`, order: 'created_at' }),
    API.get<any[]>('tickets', { select: 'numero,titulo,estado', trabajo_id: `eq.${t.id}` }), equipo(), esDelHub('trabajos', 'documento_lineas', 'furgoneta_inventario')]);
  const [escribeAgenda, checklist] = await Promise.all([esDelHub('agenda'), esDelHub('checklist_respuestas').then(e => seccionChecklist(t.id, loc.data?.plan ?? null, e))]);
  _lineas = (lin.data ?? []).map(l => ({ ...l, cantidad: Number(l.cantidad), precio: Number(l.precio), descuento: Number(l.descuento ?? 0) }));
  const tel = con.data?.telefono ?? cli.data?.telefono, wa = telWhatsApp(tel);
  const mapa = loc.data?.lat && loc.data?.lng ? `https://www.google.com/maps/dir/?api=1&destination=${loc.data.lat},${loc.data.lng}` : loc.data?.direccion ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.data.direccion)}` : null;
  const horas = (ses.data ?? []).reduce((a, s) => a + Number(s.duracion_min ?? 0), 0);
  const total = _lineas.reduce((a, l) => a + l.cantidad * l.precio * (1 - l.descuento / 100), 0);
  return `<p><a href="#/trabajos">← Trabajos</a>${t.cliente_id ? ` · <a href="#/clientes/${esc(t.cliente_id)}">Ficha del cliente</a>` : ''}</p>
    ${escribe ? '' : avisoSoloLectura('Este trabajo')}
    <div class="tarjeta-cab"><h2>🛠 #${t.numero} ${esc(t.titulo ?? '')}</h2>
      ${escribe ? `<select id="tr-estado" data-on-change="trEstado:$value" aria-label="Estado">${ESTADOS.map(e => `<option ${e === t.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>` : `<span class="chip ${TONO[t.estado] ?? ''}">${esc(t.estado)}</span>`}</div>
    <p class="nota">Creado ${esc(hace(t.created_at))}${t.fecha_programada ? ` · para el ${esc(t.fecha_programada)}${t.hora_llegada ? ` a las ${esc(t.hora_llegada.slice(0, 5))}` : ''}` : ''}${t.zoho_invoice_number ? ` · factura ${esc(t.zoho_invoice_number)}` : ''}</p>
    <div class="acciones">${tel ? `<a class="btn secundario" href="tel:${esc(tel)}">📞 Llamar</a>` : ''}${wa ? `<a class="btn secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      ${mapa ? `<a class="btn secundario" href="${esc(mapa)}" target="_blank" rel="noopener">🗺 Cómo llegar</a>` : ''}
      <a class="btn secundario" href="#/trabajos/${t.numero}/parte">🖨 Parte (PDF)</a>
      ${botonChatFicha('trabajo', t.id, `#${t.numero} ${t.titulo ?? ''}`.trim(), `#/trabajos/${t.numero}`)}${enlaceHistorial('trabajos', t.id)}
      ${escribe ? `<a class="btn secundario" href="#/trabajos/${t.numero}/editar">✎ Editar</a>
        <button class="btn secundario" data-action="trDuplicar">⧉ Duplicar</button>
        ${['Facturado', 'No facturar', 'Cancelado'].includes(t.estado) ? '' : `<a class="btn" href="#/trabajos/facturar/${esc(t.id)}">💶 Facturar</a>`}
        ${['Completado', 'Cancelado', 'Facturado', 'No facturar'].includes(t.estado) ? '' : '<button class="btn secundario" data-action="trContinuacion" title="Otro trabajo que sigue a este (otra visita)">↪ Continuación</button>'}` : ''}</div>
    <div class="op-ficha"><div>
      <section class="tarjeta"><h3>Qué hay que hacer</h3><div class="md">${markdown(t.descripcion) || '<p class="nota">Sin descripción.</p>'}</div>
        ${t.observaciones ? `<h4>Lo que se hizo</h4><div class="md">${markdown(t.observaciones)}</div>` : ''}</section>
      <section class="tarjeta mo-scroll"><h3>Material · ${eur(total, 2)}</h3>${escribe ? editorLineas() : `<table class="tabla"><tbody>${_lineas.map(l => `<tr><td>${esc(l.nombre)}</td><td>${l.cantidad}</td><td>${eur(l.precio, 2)}</td></tr>`).join('') || '<tr><td class="vacio">Sin material.</td></tr>'}</tbody></table>`}</section>
      ${checklist}
      <section class="tarjeta"><h3>Comentarios</h3><ul class="di-ultimo">${(coms.data ?? []).map(c => `<li><small class="nota" title="${esc(fechaHora(c.created_at))}">${esc(hace(c.created_at))}</small><span><strong>${esc(c.autor_nombre ?? '')}</strong> ${esc(c.texto)}</span></li>`).join('') || '<li class="nota">Ninguno.</li>'}</ul>
        ${escribe ? '<form class="acciones" data-on-submit="trComentar" data-prevent="1"><input id="tr-com" required placeholder="Escribe un comentario…" aria-label="Comentario"><button class="btn secundario" type="submit">Añadir</button></form>' : ''}</section>
    </div><div>
      <section class="tarjeta"><h3>Dónde y quién</h3><dl class="tk-dl"><dt>Cliente</dt><dd>${esc(cli.data?.nombre ?? '—')}</dd><dt>Sede</dt><dd>${loc.data ? `<a href="#/monitorizacion/sede/${esc(loc.data.id)}">${esc(loc.data.nombre)}</a><br><small class="nota">${esc(loc.data.direccion ?? '')}</small>` : '—'}</dd>
        <dt>Contacto</dt><dd>${esc(con.data?.nombre ?? '—')}</dd><dt>Técnicos</dt><dd>${escribe ? `<div class="tr-tecnicos">${personas.map(p => `<label class="check"><input type="checkbox" value="${esc(p.nombre)}" ${(t.tecnicos ?? []).includes(p.nombre) ? 'checked' : ''} data-on-change="trTecnicos"> ${esc(p.nombre)}</label>`).join('')}</div>` : esc((t.tecnicos ?? []).join(', ') || '—')}</dd></dl></section>
      <section class="tarjeta"><h3>Días de agenda</h3><ul class="tr-dias">${(bloques.data ?? []).map((b, i, xs) => `<li>${xs.length > 1 ? `<strong>Día ${i + 1}</strong> · ` : ''}${esc(fechaHora(b.inicio))} → ${esc(new Date(b.fin).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))} · ${esc((b.tecnicos ?? []).join(', ') || 'sin técnico')}
          ${escribeAgenda ? ` <a href="#/calendario/dia/b:${esc(b.id)}" aria-label="Cambiar este día">✎</a>` : ''}</li>`).join('') || '<li class="nota">Sin programar.</li>'}</ul>
        <p class="acciones">${escribeAgenda ? `<a class="btn secundario" href="#/calendario/dia/${esc(t.id)}">+ Añadir día</a>` : ''}<a href="#/calendario">Ver en el calendario</a></p></section>
      <section class="tarjeta"><h3>Firma del cliente</h3>${t.firma_cliente && /^data:image\/(png|jpeg);base64,/.test(t.firma_cliente) ? `<img class="tr-firma" src="${esc(t.firma_cliente)}" alt="Firma del cliente">` : '<p class="nota">Sin firmar.</p>'}
        ${escribe ? `<p class="acciones"><button class="btn secundario" data-action="trFirmar">✍ ${t.firma_cliente ? 'Volver a firmar' : 'Firmar'}</button></p>` : ''}</section>
      <section class="tarjeta"><h3>Fichajes · ${Math.floor(horas / 60)} h ${horas % 60} min</h3><ul>${(ses.data ?? []).map(s => `<li>${esc(s.tecnico_nombre ?? '')}: ${esc(fechaHora(s.traslado ?? s.inicio))} → ${s.fin ? esc(new Date(s.fin).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })) : '<strong>en curso</strong>'}</li>`).join('') || '<li class="nota">Nadie ha fichado aún.</li>'}</ul></section>
      ${(fotos.data ?? []).length ? `<section class="tarjeta"><h3>Fotos</h3><ul>${(fotos.data ?? []).map(f => `<li>${f.drive_url && /^https:\/\//.test(f.drive_url) ? `<a href="${esc(f.drive_url)}" target="_blank" rel="noopener">${esc(f.descripcion || 'Foto')}</a>` : f.archivo_path ? `<button class="btn secundario" data-action="trVerFoto" data-p0="${esc(f.id)}">${esc(f.descripcion || 'Foto')}</button>` : esc(f.descripcion || 'Foto')} <small class="nota">${esc(hace(f.created_at))}</small></li>`).join('')}</ul></section>` : ''}
      ${(tks.data ?? []).length ? `<section class="tarjeta"><h3>Tickets</h3><ul>${(tks.data ?? []).map(k => `<li><a href="#/tickets/${k.numero}">#${k.numero} ${esc(k.titulo)}</a> · ${esc(k.estado)}</li>`).join('')}</ul></section>` : ''}
    </div></div>`;
}

export async function pintar(el: HTMLElement, params: string[]) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  if (params[0] === 'nuevo') { await pintarFormulario(el, undefined, params[1] === 'o' ? params[2] : undefined); return; }
  if (params[0] && params[1] === 'editar') { await pintarFormulario(el, params[0]); return; }
  if (params[0] === 'plantillas') { await (await import('./plantillas')).pintarPlantillas(el, params[1]); return; }
  if (params[0] === 'facturar') { await (await import('./facturar')).pintarFacturar(el, params[1]); return; }
  if (params[0] && params[1] === 'parte') { await (await import('./parte')).pintarParte(el, params[0]); return; }
  el.innerHTML = params[0] ? await vistaFicha(params[0]) : await vistaLista();
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
let _timer = 0;
registrarAcciones({
  trAbrir(n: string) { ir('trabajos', n); },
  trFiltro(f: string) { guardar('hub_tr_filtro', f); _sel.clear(); resolver(); },
  // Marcar sin abrir la ficha: la casilla es su propia acción (la más cercana gana).
  trSel(id: string, el: HTMLInputElement) {
    if (el.checked) _sel.add(id); else _sel.delete(id);
    const b = document.getElementById('tr-sel');
    if (b) b.outerHTML = barraSel();
  },
  trFacturarSel() { if (_sel.size) { const ids = [..._sel]; _sel.clear(); ir('trabajos', 'facturar', ids.join(',')); } },
  trTecnico(v: string) { guardar('hub_tr_tecnico', v); const c = document.getElementById('tr-lista'); if (c) c.innerHTML = cuerpoLista(); },
  trBuscar(q: string) { guardar('hub_tr_q', q); const c = document.getElementById('tr-lista'); if (c) c.innerHTML = cuerpoLista(); },
  trVista(v: string) { guardar('hub_tr_vista', v); resolver(); },
  trExportar: exportarCsv,
  trArrastrar(id: string, ev: DragEvent) { _arrastrado = id; ev?.dataTransfer?.setData('text/plain', id); },
  trSobre(el: HTMLElement) { el.classList.add('sobre'); },
  trFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  async trSoltar(estado: string, ev?: DragEvent) {
    document.querySelectorAll('.tr-kanban .sobre').forEach(x => x.classList.remove('sobre'));
    const id = ev?.dataTransfer?.getData('text/plain') || _arrastrado;
    const t = _lista.find(x => x.id === id);
    if (!t || t.estado === estado) return;
    const r = await API.rpc('trabajo_estado', { p_id: t.id, p_estado: estado });
    if (r.error) { toast(r.error.message, 'error'); return; }
    t.estado = estado;
    toast(`#${t.numero}: ${estado}`);
    if (estado === 'Completado' && await ofrecerFacturar(t.id)) t.estado = 'Para facturar';
    const c = document.getElementById('tr-lista'); if (c) c.innerHTML = cuerpoLista();
  },
  async trDuplicar() {
    if (!_t) return;
    // Mismos datos, en Pendiente y SIN programación ni ejecución (duplicarTrabajo de la app).
    const t: any = _t;
    const r = await API.post<any[]>('trabajos', { cliente_id: t.cliente_id, local_id: t.local_id, contacto_id: t.contacto_id, tipo: t.tipo || 'Asistencia',
      titulo: t.titulo ? `${t.titulo} (copia)` : null, descripcion: t.descripcion, materiales: t.materiales, observaciones: t.observaciones,
      ubicacion: t.ubicacion, duracion_teorica: t.duracion_teorica, prioridad: t.prioridad, tecnicos: t.tecnicos, estado: 'Pendiente' });
    if (r.error || !r.data?.[0]) { toast(`No se pudo duplicar: ${r.error?.message ?? ''}`, 'error'); return; }
    toast(`Duplicado como #${r.data[0].numero} (sin programar)`);
    ir('trabajos', String(r.data[0].numero));
  },
  async trContinuacion() {
    if (!_t) return;
    // Otro trabajo de la misma cadena (generarTrabajoContinuacion de la app).
    const t: any = _t;
    const r = await API.post<any[]>('trabajos', { cliente_id: t.cliente_id, local_id: t.local_id, tipo: t.tipo || 'Asistencia', titulo: t.titulo,
      descripcion: t.descripcion, estado: 'Pendiente', parent_trabajo_id: t.id, chain_root_id: t.chain_root_id || t.id });
    if (r.error || !r.data?.[0]) { toast(`No se pudo crear la continuación: ${r.error?.message ?? ''}`, 'error'); return; }
    toast(`Continuación creada: #${r.data[0].numero}`);
    ir('trabajos', String(r.data[0].numero));
  },
  async trEstado(estado: string) {
    if (!_t) return;
    const r = await API.rpc('trabajo_estado', { p_id: _t.id, p_estado: estado });
    if (r.error) { toast(r.error.message, 'error'); resolver(); return; }
    toast(`Trabajo: ${estado}`);
    if (estado === 'Completado' && await ofrecerFacturar(_t.id)) resolver();
  },
  async trTecnicos() {
    if (!_t) return;
    const tecnicos = [...document.querySelectorAll<HTMLInputElement>('.tr-tecnicos input:checked')].map(i => i.value);
    const r = await API.patch('trabajos', { id: `eq.${_t.id}` }, { tecnicos });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else toast('Técnicos guardados');
  },
  trLinea(i: string, campo: string, v: string) {
    const l = _lineas[Number(i)];
    if (l && ['cantidad', 'precio', 'descuento'].includes(campo)) (l as any)[campo] = Number(v) || 0;
  },
  trQuitarLinea(i: string) {
    _lineas.splice(Number(i), 1);
    const s = document.querySelector('.tr-lineas')?.closest('section');
    if (s) s.innerHTML = `<h3>Material</h3>${editorLineas()}`;
  },
  trBuscarInv(q: string) {
    clearTimeout(_timer);
    (document.getElementById('tr-l-inv') as HTMLInputElement).value = '';
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById('tr-inv-res'), t = q.replace(/[*,()%\\]/g, ' ').trim();
      if (!ul) return;
      if (t.length < 2) { ul.innerHTML = ''; return; }
      const { data } = await API.get<any[]>('furgoneta_inventario', { select: 'id,nombre,cantidad,furgoneta_id,precio,categoria', nombre: `ilike.*${t}*`, order: 'nombre', limit: '8' });
      const { data: fs } = await API.get<any[]>('furgonetas', { select: 'id,nombre' });
      ul.innerHTML = (data ?? []).map(p => `<li><button type="button" class="btn secundario" data-action="trElegirInv" data-p0="${p.id}" data-p1="${esc(p.nombre)}" data-p2="${esc(p.furgoneta_id ?? '')}" data-p3="${p.precio ?? 0}">${esc(p.nombre)}
        <small class="nota">${esc((fs ?? []).find(f => f.id === p.furgoneta_id)?.nombre ?? '')} · quedan ${p.cantidad}</small></button></li>`).join('');
    }, 250);
  },
  trElegirInv(id: string, nombre: string, furgo: string, precio: string) {
    (document.getElementById('tr-l-inv') as HTMLInputElement).value = id;
    (document.getElementById('tr-l-furgo') as HTMLInputElement).value = furgo;
    (document.getElementById('tr-l-precio') as HTMLInputElement).value = precio;
    (document.getElementById('tr-l-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('tr-inv-res'); if (ul) ul.innerHTML = '';
  },
  trAnadirLinea() {
    if (!val('tr-l-q')) return;
    _lineas.push({ nombre: val('tr-l-q'), cantidad: Number(val('tr-l-cant')) || 1, precio: Number(val('tr-l-precio')) || 0, descuento: 0,
      inventario_id: val('tr-l-inv') || null, furgoneta_id: val('tr-l-furgo') || null, categoria: null });
    const s = document.querySelector('.tr-lineas')?.closest('section');
    if (s) s.innerHTML = `<h3>Material</h3>${editorLineas()}`;
  },
  async trGuardarLineas() {
    if (!_t) return;
    const r = await API.rpc<number>('trabajo_guardar_lineas', { p_trabajo: _t.id, p_lineas: _lineas.map(l => ({ nombre: l.nombre, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento, inventario_id: l.inventario_id, furgoneta_id: l.furgoneta_id, categoria: l.categoria })) });
    if (r.error) toast(r.error.message, 'error'); else { toast('Material guardado (y el stock ajustado)'); resolver(); }
  },
  async trComentar() {
    if (!_t) return;
    const r = await API.post('trabajo_comentarios', { trabajo_id: _t.id, texto: val('tr-com'), autor_nombre: usuario()?.nombre ?? null });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async trFirmar() { if (_t) (await import('./firma')).abrirFirma(_t.id); },
  async trVerFoto(id: string) {
    const { llamarFuncion } = await import('../../core/funciones');
    const r = await llamarFuncion<{ url: string }>('trabajo-foto', { accion: 'url', id });
    if (r.error || !r.data) toast(`No se pudo: ${r.error}`, 'error'); else window.open(r.data.url, '_blank', 'noopener');
  },
});
