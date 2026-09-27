// Clientes 360 (fase 4): #/clientes (lista con clase A/B/C) y
// #/clientes/<id>/<pestaña> (ficha). Los datos del cliente, sus sedes y
// contactos son la copia de la app (se editan allí); aquí se ve todo junto y
// se apunta lo del CRM: «lo siguiente», la clase a mano y las actividades.
// Prefijo de ids: cl-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import {
  type Cliente, type Crm, type Evento, type Oportunidad,
  TIPOS_ACTIVIDAD, ICONO_EVENTO, CLASE_TONO, eur, clases, olvidarClases, telWhatsApp, enApp,
} from '../ventas/datos';

const PESTANAS = [['resumen', 'Resumen'], ['actividad', 'Actividad'], ['sedes', 'Sedes'], ['contactos', 'Contactos'], ['oportunidades', 'Oportunidades']] as const;
let _lista: Cliente[] = [];
let _listaAt = 0;
let _filtro = '';
let _clase = '';
let _filtroTimeline = '';
let _cliente: Cliente | null = null;

const hoy = () => new Date().toLocaleDateString('sv-SE');
const chipClase = (c: string | undefined, auto?: string) =>
  c ? `<span class="chip ${CLASE_TONO[c]} cl-clase" title="${auto && auto !== c ? `Puesta a mano (la calculada es ${auto})` : 'Calculada por facturación'}">${c}</span>` : '';

// ── Lista ───────────────────────────────────────────────────────────────────
async function cargarLista() {
  if (_lista.length && Date.now() - _listaAt < 5 * 60_000) return;
  const r = await API.fetchAll<Cliente>('clientes', { select: 'id,nombre,nif,telefono,email,estado,zoho_id', activo: 'eq.true', order: 'nombre' });
  if (!r.error) { _lista = r.data ?? []; _listaAt = Date.now(); }
}

async function pintarLista(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [, cs, crm] = await Promise.all([cargarLista(), clases(), API.get<Crm[]>('clientes_crm', { select: 'cliente_id,siguiente_fecha,siguiente_texto' })]);
  const sig = new Map((crm.data ?? []).map(c => [c.cliente_id, c]));
  const q = _filtro.toLowerCase();
  const filtrados = _lista.filter(c => (!_clase || cs.get(c.id)?.clase === _clase) &&
    (!q || [c.nombre, c.nif, c.telefono, c.email].some(x => (x ?? '').toLowerCase().includes(q))));
  const orden = { A: 0, B: 1, C: 2 } as Record<string, number>;
  filtrados.sort((a, b) => (orden[cs.get(a.id)?.clase ?? 'C'] - orden[cs.get(b.id)?.clase ?? 'C']) || a.nombre.localeCompare(b.nombre));
  const cuenta = (k: string) => _lista.filter(c => cs.get(c.id)?.clase === k).length;
  el.innerHTML = `<div class="acciones mo-barra">
      <input id="cl-filtro" type="search" placeholder="Buscar por nombre, NIF, teléfono o email…" value="${esc(_filtro)}" data-on-input="clFiltrar:$value" aria-label="Buscar cliente">
      <div class="segmentado" role="tablist">${['', 'A', 'B', 'C'].map(k => `<button role="tab" aria-selected="${_clase === k}" class="${_clase === k ? 'activo' : ''}"
        data-action="clClase" data-p0="${k}">${k ? `${k} (${cuenta(k)})` : `Todos (${_lista.length})`}</button>`).join('')}</div>
    </div>
    <p class="nota">A = los que suman el 80 % de lo facturado en 12 meses; B = el 15 % siguiente; C = el resto. Mostrando ${Math.min(filtrados.length, 150)} de ${filtrados.length}.</p>
    <div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Clase</th><th>Cliente</th><th>Contacto</th><th>Lo siguiente</th></tr></thead>
    <tbody>${filtrados.slice(0, 150).map(c => {
      const s = sig.get(c.id);
      return `<tr class="fila-clic" data-action="clAbrir" data-p0="${esc(c.id)}">
        <td>${chipClase(cs.get(c.id)?.clase)}</td><td><strong>${esc(c.nombre)}</strong>${c.nif ? `<br><small class="nota">${esc(c.nif)}</small>` : ''}</td>
        <td>${esc(c.telefono ?? '')}${c.email ? `<br><small class="nota">${esc(c.email)}</small>` : ''}</td>
        <td>${s?.siguiente_fecha ? `<span class="${s.siguiente_fecha < hoy() ? 'mal' : ''}">${esc(s.siguiente_fecha)}</span> ${esc(s.siguiente_texto ?? '')}` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="vacio">Ningún cliente con ese filtro.</td></tr>'}</tbody></table></div>`;
}

// ── Ficha ───────────────────────────────────────────────────────────────────
async function tabResumen(c: Cliente): Promise<string> {
  const [crmR, cs, personas, abiertos] = await Promise.all([
    API.single<Crm>('clientes_crm', { select: '*', cliente_id: `eq.${c.id}` }),
    clases(), equipo(),
    Promise.all([
      API.contar('trabajos', { cliente_id: `eq.${c.id}`, estado: 'in.(Pendiente,"En progreso")' }),
      API.contar('tickets', { cliente_id: `eq.${c.id}`, estado: 'in.(Abierto,"En curso")' }),
      API.contar('presupuestos', { cliente_id: `eq.${c.id}`, estado: 'in.(Borrador,Enviado,Aceptado)' }),
      API.contar('oportunidades', { cliente_id: `eq.${c.id}`, cerrada_at: 'is.null' }),
    ]),
  ]);
  const crm = crmR.data;
  const cl = cs.get(c.id);
  let dinero = '';
  if (esAdmin() && c.zoho_id) {
    const { data } = await API.get<any[]>('zoho_facturas', { select: 'total,saldo,vence,fecha,estado', cliente_zoho_id: `eq.${c.zoho_id}`, estado: 'not.in.(void,draft)' });
    const fs = data ?? [];
    const hace12 = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const pend = fs.reduce((s, f) => s + Number(f.saldo), 0);
    const venc = fs.filter(f => f.saldo > 0 && f.vence < hoy()).reduce((s, f) => s + Number(f.saldo), 0);
    const ano = fs.filter(f => f.fecha >= hace12).reduce((s, f) => s + Number(f.total), 0);
    dinero = `<section class="tarjeta"><h3>💶 Dinero (Zoho)</h3><dl class="me-datos">
      <div class="me-dato"><dt>Facturado 12 meses</dt><dd>${eur(ano)}</dd></div>
      <div class="me-dato"><dt>Pendiente de cobro</dt><dd>${eur(pend, 2)}</dd></div>
      <div class="me-dato"><dt>Vencido</dt><dd class="${venc ? 'mal' : ''}">${eur(venc, 2)}</dd></div></dl>
      ${fs.length ? '' : '<p class="nota">Sin facturas en la copia de Zoho (¿Zoho sin conectar todavía?).</p>'}</section>`;
  }
  const [trab, tick, pres, opor] = abiertos;
  return `<div class="me-grid">
    <section class="tarjeta"><h3>➡️ Lo siguiente</h3>
      <form data-on-submit="clGuardarSiguiente" data-prevent="1">
        <div class="in-campos"><label>Fecha <input id="cl-sig-fecha" type="date" value="${esc(crm?.siguiente_fecha ?? '')}"></label>
          <label>Quién <select id="cl-sig-resp"><option value="">—</option>${personas.map(p => `<option value="${esc(p.id)}" ${p.id === (crm?.responsable_id ?? usuario()?.id) ? 'selected' : ''}>${esc(nombreDe(p.id) || p.nombre)}</option>`).join('')}</select></label></div>
        <label>Qué <input id="cl-sig-texto" maxlength="300" value="${esc(crm?.siguiente_texto ?? '')}" placeholder="p. ej. Llamar para renovar el mantenimiento"></label>
        <div class="acciones"><button class="btn" type="submit">Guardar</button>${crm?.siguiente_fecha ? '<button class="btn secundario" type="button" data-action="clSiguienteHecho">Hecho ✓</button>' : ''}</div>
      </form></section>
    <section class="tarjeta"><h3>✍️ Apuntar lo de hoy</h3>
      <form data-on-submit="clApuntar" data-prevent="1">
        <div class="segmentado cl-tipos" role="radiogroup">${Object.entries(TIPOS_ACTIVIDAD).map(([k, t], i) =>
          `<label><input type="radio" name="cl-tipo" value="${k}" ${i === 1 ? 'checked' : ''}> ${t.icono} ${esc(t.nombre)}</label>`).join('')}</div>
        <textarea id="cl-texto" rows="3" maxlength="4000" placeholder="Qué se habló, qué se hizo, qué quedó pendiente…" required></textarea>
        <div class="acciones"><button class="btn" type="submit">Apuntar</button></div>
      </form></section>
    <section class="tarjeta"><h3>📋 Ahora mismo</h3><dl class="me-datos">
      <div class="me-dato"><dt>Clase</dt><dd>${chipClase(cl?.clase, cl?.clase_auto)}
        <select id="cl-clase" data-on-change="clClaseManual:$value" aria-label="Clase a mano">
          <option value="">Automática (${esc(cl?.clase_auto ?? 'C')})</option>${['A', 'B', 'C'].map(k => `<option ${crm?.clase_manual === k ? 'selected' : ''}>${k}</option>`).join('')}</select></dd></div>
      <div class="me-dato"><dt>Trabajos en curso</dt><dd>${trab ?? '—'}</dd></div>
      <div class="me-dato"><dt>Tickets abiertos</dt><dd>${tick ?? '—'}</dd></div>
      <div class="me-dato"><dt>Presupuestos abiertos</dt><dd>${pres ?? '—'}</dd></div>
      <div class="me-dato"><dt>Oportunidades abiertas</dt><dd>${opor ?? '—'}</dd></div>
      <div class="me-dato"><dt>Estado en la app</dt><dd>${esc(c.estado ?? '—')}</dd></div></dl>
      ${c.notas ? `<p class="nota">${esc(c.notas)}</p>` : ''}</section>
    ${dinero}
  </div>`;
}

async function tabActividad(c: Cliente): Promise<string> {
  const { data, error } = await API.rpc<Evento[]>('linea_tiempo', { p_cliente: c.id, p_limite: 200 });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  const tipos = [['', 'Todo'], ['actividad', 'Actividades'], ['trabajo', 'Trabajos'], ['ticket', 'Tickets'], ['presupuesto', 'Presupuestos'], ['oportunidad', 'Oportunidades'],
    ...(esAdmin() ? [['factura', 'Facturas'], ['cobro', 'Cobros']] : [])];
  const lista = (data ?? []).filter(e => !_filtroTimeline || e.tipo.startsWith(_filtroTimeline));
  return `<div class="acciones mo-barra">${tipos.map(([k, n]) => `<button class="chip-boton ${_filtroTimeline === k ? 'activo' : ''}" data-action="clTimeline" data-p0="${k}">${n}</button>`).join('')}</div>
    ${lista.length ? `<ol class="cl-linea">${lista.map(e => `<li class="cl-evento">
      <span class="cl-icono" aria-hidden="true">${ICONO_EVENTO[e.tipo] ?? '•'}</span>
      <div><div class="cl-ev-cab"><strong>${esc(e.titulo)}</strong>${e.importe ? ` <span class="nota">${eur(e.importe, 2)}</span>` : ''}
        ${e.enlace ? ` <a href="${esc(e.enlace)}"${e.enlace.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>abrir</a>` : ''}</div>
        ${e.detalle ? `<div class="cl-ev-texto">${esc(e.detalle)}</div>` : ''}
        <small class="nota" title="${esc(fechaHora(e.fecha))}">${esc(hace(e.fecha))}${e.autor ? ` · ${esc(e.autor)}` : ''}</small></div></li>`).join('')}</ol>`
      : '<p class="vacio">Nada todavía. Apunta lo de hoy desde el Resumen.</p>'}`;
}

async function tabSedes(c: Cliente): Promise<string> {
  const { data } = await API.get<any[]>('locales', { select: 'id,nombre,direccion,plan,estado_pago,importe_mantenimiento,programa_tpv,lat,lng,maps_url,activo', cliente_id: `eq.${c.id}`, order: 'nombre' });
  const ls = data ?? [];
  if (!ls.length) return '<p class="vacio">Este cliente no tiene sedes en la app.</p>';
  const { data: est } = await API.get<any[]>('rmm_estado_local', { select: 'local_id,estado,equipos,conectados', local_id: `in.(${ls.map(l => l.id).join(',')})` });
  const rmm = new Map((est ?? []).map(e => [e.local_id, e]));
  const tonoRmm: Record<string, string> = { ok: 'bien', alerta: 'mal', parcial: 'aviso', caido: 'mal' };
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Sede</th><th>Mantenimiento</th><th>TPV</th><th>Equipos</th></tr></thead>
    <tbody>${ls.map(l => {
      const e = rmm.get(l.id);
      const mapa = l.maps_url || (l.lat ? `https://www.google.com/maps?q=${l.lat},${l.lng}` : l.direccion ? `https://www.google.com/maps/search/${encodeURIComponent(l.direccion)}` : '');
      return `<tr class="${l.activo === false ? 'in-pausado' : ''}"><td><strong>${esc(l.nombre)}</strong>${l.direccion ? `<br><small class="nota">${esc(l.direccion)}</small>` : ''}
        ${mapa ? ` <a href="${esc(mapa)}" target="_blank" rel="noopener">mapa ↗</a>` : ''}</td>
        <td>${l.plan ? `${esc(l.plan)}${esAdmin() && l.importe_mantenimiento ? ` · ${eur(l.importe_mantenimiento, 2)}/mes` : ''}<br>` : '—'}${l.estado_pago && l.estado_pago !== 'Al corriente' ? `<span class="chip aviso">${esc(l.estado_pago)}</span>` : ''}</td>
        <td>${esc(l.programa_tpv ?? '—')}</td>
        <td>${e ? `<a class="chip ${tonoRmm[e.estado]}" href="#/monitorizacion/sede/${esc(l.id)}">${e.conectados}/${e.equipos} conectados</a>` : '<span class="nota">sin agente</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function tabContactos(c: Cliente): Promise<string> {
  const { data } = await API.get<any[]>('contactos', { select: 'id,nombre,cargo,telefono,telefono2,email,local_id,favorito', cliente_id: `eq.${c.id}`, activo: 'eq.true', order: 'favorito.desc.nullslast,nombre' });
  const cs = data ?? [];
  if (!cs.length) return '<p class="vacio">Sin contactos en la app.</p>';
  return `<div class="cl-contactos">${cs.map(p => {
    const wa = telWhatsApp(p.telefono);
    return `<article class="tarjeta"><h3>${p.favorito ? '⭐ ' : ''}${esc(p.nombre)}</h3>${p.cargo ? `<p class="nota">${esc(p.cargo)}</p>` : ''}
      <div class="acciones">${p.telefono ? `<a class="btn secundario" href="tel:${esc(p.telefono)}">📞 ${esc(p.telefono)}</a>` : ''}
        ${wa ? `<a class="btn secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
        ${p.email ? `<a class="btn secundario" href="mailto:${esc(p.email)}">✉️ ${esc(p.email)}</a>` : ''}</div></article>`;
  }).join('')}</div>`;
}

async function tabOportunidades(c: Cliente): Promise<string> {
  const { data } = await API.get<Oportunidad[]>('oportunidades', { select: '*', cliente_id: `eq.${c.id}`, order: 'cerrada_at.nullsfirst,created_at.desc' });
  return `<div class="acciones mo-barra"><button class="btn" data-action="clNuevaOportunidad">+ Nueva oportunidad</button></div>
    ${(data ?? []).length ? `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Oportunidad</th><th>Etapa</th><th>Valor</th><th>Seguimiento</th></tr></thead>
    <tbody>${(data ?? []).map(o => `<tr class="fila-clic" data-action="clAbrirOportunidad" data-p0="${esc(o.id)}"><td>${esc(o.titulo)}</td><td>${esc(o.estado)}</td>
      <td>${eur(o.valor_estimado)}</td><td>${esc(o.fecha_seguimiento ?? '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Ninguna.</p>'}`;
}

async function pintarFicha(el: HTMLElement, id: string, pestana = 'resumen') {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const { data: c, error } = await API.single<Cliente>('clientes', { select: '*', id: `eq.${id}` });
  if (error || !c) { el.innerHTML = `<p class="aviso mal">No se encontró el cliente.</p><p><a href="#/clientes">← Clientes</a></p>`; return; }
  _cliente = c;
  const cl = (await clases()).get(c.id);
  const p = PESTANAS.some(([k]) => k === pestana) ? pestana : 'resumen';
  const wa = telWhatsApp(c.telefono);
  el.innerHTML = `<p><a href="#/clientes">← Clientes</a></p>
    <div class="tarjeta-cab"><h2>${chipClase(cl?.clase, cl?.clase_auto)} ${esc(c.nombre)}</h2>
      <div class="acciones">${c.telefono ? `<a class="btn secundario" href="tel:${esc(c.telefono)}">📞 ${esc(c.telefono)}</a>` : ''}
        ${wa ? `<a class="btn secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬</a>` : ''}
        ${c.email ? `<a class="btn secundario" href="mailto:${esc(c.email)}">✉️</a>` : ''}
        <a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Los datos del cliente se editan en la app actual">Editar en la app ↗</a></div></div>
    <p class="nota">${[c.nif, c.direccion].filter(Boolean).map(x => esc(x)).join(' · ')}</p>
    <nav class="pestanas" role="tablist">${PESTANAS.map(([k, n]) =>
      `<button role="tab" aria-selected="${k === p}" class="${k === p ? 'activo' : ''}" data-action="clPestana" data-p0="${esc(id)}" data-p1="${k}">${n}</button>`).join('')}</nav>
    <div id="cl-cuerpo"><p class="cargando">Cargando…</p></div>`;
  const cuerpo = await ({ resumen: tabResumen, actividad: tabActividad, sedes: tabSedes, contactos: tabContactos, oportunidades: tabOportunidades }[p]!)(c);
  const caja = document.getElementById('cl-cuerpo');
  if (caja && _cliente?.id === id) caja.innerHTML = cuerpo;
}

async function guardarCrm(cambios: Partial<Crm>) {
  if (!_cliente) return false;
  const r = await API.upsert('clientes_crm', 'cliente_id', { cliente_id: _cliente.id, ...cambios });
  if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return false; }
  return true;
}

let _timer: number | undefined;
registrarAcciones({
  clAbrir(id: string) { ir('clientes', id); },
  clPestana(id: string, p: string) { ir('clientes', id, p); },
  clClase(k: string) { _clase = k; resolver(); },
  clFiltrar(v: string) {
    _filtro = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('cl-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
  clTimeline(k: string) { _filtroTimeline = k; resolver(); },
  async clGuardarSiguiente() {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
    if (await guardarCrm({ siguiente_fecha: v('cl-sig-fecha') || null, siguiente_texto: v('cl-sig-texto') || null, responsable_id: v('cl-sig-resp') || null })) toast('Guardado');
  },
  async clSiguienteHecho() {
    const texto = (document.getElementById('cl-sig-texto') as HTMLInputElement).value.trim();
    if (!_cliente) return;
    if (texto) await API.post('actividades', { tipo: 'nota', texto: `Hecho: ${texto}`, cliente_id: _cliente.id });
    if (await guardarCrm({ siguiente_fecha: null, siguiente_texto: null })) { toast('Hecho, y apuntado en la actividad'); resolver(); }
  },
  async clClaseManual(v: string) {
    if (await guardarCrm({ clase_manual: (v || null) as Crm['clase_manual'] })) { olvidarClases(); toast(v ? `Clase ${v} a mano` : 'Clase automática'); resolver(); }
  },
  async clApuntar() {
    if (!_cliente) return;
    const texto = (document.getElementById('cl-texto') as HTMLTextAreaElement).value.trim();
    const tipo = (document.querySelector('input[name="cl-tipo"]:checked') as HTMLInputElement | null)?.value ?? 'nota';
    if (!texto) return;
    const r = await API.post('actividades', { tipo, texto, cliente_id: _cliente.id });
    if (r.error) { toast(`No se pudo apuntar: ${r.error.message}`, 'error'); return; }
    toast('Apuntado');
    ir('clientes', _cliente.id, 'actividad');
  },
  clNuevaOportunidad() { if (_cliente) ir('oportunidades', 'nueva', _cliente.id); },
  clAbrirOportunidad(id: string) { ir('oportunidades', id); },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('clientes_crm', { siguiente_fecha: `lt.${hoy()}` });
  if (n == null) return null;
  return { valor: n, subtitulo: 'cosas pendientes con clientes, vencidas', tono: n ? 'aviso' : 'bien' };
}

export const moduloClientes: Modulo = {
  id: 'clientes',
  titulo: 'Clientes',
  grupo: 'Clientes',
  icono: '🏢',
  explicacion: 'Todo lo de un cliente en una ficha: sus sedes (con el estado de los equipos), contactos, lo que se ha hecho con él (trabajos, tickets, presupuestos, oportunidades y lo que apunte el equipo) y lo siguiente que toca. Los datos del cliente se siguen editando en la app actual; aquí se añade el seguimiento.',
  async pintar(el, params) {
    if (params[0]) await pintarFicha(el, params[0], params[1]);
    else await pintarLista(el);
  },
  contador,
};

