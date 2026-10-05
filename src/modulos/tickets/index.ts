// Desk (fase 6): #/tickets (lista por vistas con el SLA), #/tickets/nuevo,
// #/tickets/<numero> (ficha: conversación, responder por correo o WhatsApp,
// notas internas, plantillas, cerrar con valoración), #/tickets/bandeja
// (correos de desconocidos) y #/tickets/ajustes (plantillas; SLA, horario y
// festivos solo admins). Prefijo de ids: tk-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { APP_ACTUAL_URL } from '../../core/config';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { markdown } from '../../ui/markdown';
import { buscarClientes, nombresClientes, telWhatsApp } from '../ventas/datos';
import { botonChatFicha } from '../../ui/chat-ficha';
import { tomarBorrador } from '../../ui/borrador';
import {
  type Ticket, type Comentario, type Plantilla,
  ESTADOS, ABIERTOS, PRIORIDADES, CATEGORIAS, CANALES, ICONO_CANAL, TONO_PRIORIDAD, prioridadNorm, sla, limiteSla, esMio, rellenar, enlaceValoracion,
} from './datos';
import { enlaceHistorial } from '../../ui/historial';
import { ico } from '../../shell/linea';

type Vista = 'abiertos' | 'mios' | 'sin_asignar' | 'sla' | 'cerrados';
const VISTAS: Record<Vista, string> = { abiertos: 'Abiertos', mios: 'Míos', sin_asignar: 'Sin asignar', sla: 'SLA en riesgo', cerrados: 'Cerrados (30 días)' };
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

let _tickets: Ticket[] = [];
let _nombres = new Map<string, string>();
let _q = '';
let _actual: Ticket | null = null;
let _ctx: { contacto: string | null; cliente: string | null; email: string | null; telefono: string | null } = { contacto: null, cliente: null, email: null, telefono: null };
let _plantillas: Plantilla[] = [];
let _timerCli = 0;
let _prepararCierre = false; // tras cerrar: rellenar la respuesta con la plantilla de cierre

// Icono del canal por el que entró (con su espacio detrás); sin icono conocido, nada.
const iconoCanal = (c: string | null | undefined) => { const n = ICONO_CANAL[c ?? '']; return n ? `${ico(n)} ` : ''; };
const chipPrioridad = (p: string | null) => `<span class="chip ${TONO_PRIORIDAD[prioridadNorm(p)] ?? ''}">${esc(p ?? 'Media')}</span>`;
const chipSla = (t: Ticket) => { const s = sla(t); return s ? `<span class="chip ${s.tono === 'neutro' ? '' : s.tono}">${esc(s.texto)}</span>` : ''; };
const estrellas = (n: number | null) => n ? `<span class="tk-estrellas" aria-label="${n} de 5">${ico('estrella').repeat(n)}<span style="opacity:.35">${ico('estrella').repeat(5 - n)}</span></span>` : '';

async function plantillas(): Promise<Plantilla[]> {
  const { data } = await API.get<Plantilla[]>('plantillas_respuesta', { select: '*', activa: 'eq.true', order: 'orden,titulo' });
  return (_plantillas = data ?? []);
}

// ── Lista ──────────────────────────────────────────────────────────────────
function filtrar(vista: Vista): Ticket[] {
  const q = _q.toLowerCase();
  return _tickets.filter(t => {
    if (vista === 'mios' && !esMio(t.tecnico_id)) return false;
    if (vista === 'sin_asignar' && t.tecnico_id) return false;
    if (vista === 'sla' && !['mal', 'aviso'].includes(sla(t)?.tono ?? '')) return false;
    if (!q) return true;
    return `${t.numero} ${t.titulo} ${t.descripcion ?? ''} ${_nombres.get(t.cliente_id ?? '') ?? ''} ${t.tecnico_id ?? ''}`.toLowerCase().includes(q);
  });
}

async function pintarLista(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const vista = leer('hub_tk_vista', 'abiertos') as Vista;
  const filtro: Record<string, string> = vista === 'cerrados'
    ? { estado: 'eq.Cerrado', or: `(cerrado_at.gte.${new Date(Date.now() - 30 * 86400000).toISOString()},created_at.gte.${new Date(Date.now() - 30 * 86400000).toISOString()})`, order: 'created_at.desc', limit: '200' }
    : { estado: `in.(${ABIERTOS.map(e => `"${e}"`).join(',')})`, order: 'created_at.desc' };
  const [r, nBandeja] = await Promise.all([API.get<Ticket[]>('tickets', { select: '*', ...filtro }), API.contar('correos_entrantes', { estado: 'eq.nuevo' })]);
  if (r.error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los tickets: ${esc(r.error.message)}</p>`; return; }
  _tickets = r.data ?? [];
  if (vista !== 'cerrados') _tickets.sort((a, b) => limiteSla(a).localeCompare(limiteSla(b)));
  _nombres = await nombresClientes(_tickets.map(t => t.cliente_id));
  const lista = filtrar(vista);
  const cuenta = (v: Vista) => v === 'cerrados' ? '' : ` (${_tickets.filter(t => v === 'abiertos' || filtrarUno(t, v)).length})`;
  el.innerHTML = `<div class="acciones pr-barra">
      <div class="segmentado tk-vistas" role="tablist">${(Object.keys(VISTAS) as Vista[]).map(v =>
        `<button role="tab" aria-selected="${v === vista}" class="${v === vista ? 'activo' : ''}" data-action="tkVista" data-p0="${v}">${VISTAS[v]}${vista === 'cerrados' ? '' : cuenta(v)}</button>`).join('')}</div>
      <input id="tk-q" type="search" placeholder="Buscar número, cliente, texto…" value="${esc(_q)}" data-on-input="tkBuscar:$value" aria-label="Buscar tickets">
      <a class="btn secundario" href="#/tickets/bandeja">${ico('correo')} Bandeja${nBandeja ? ` <span class="chip aviso">${nBandeja}</span>` : ''}</a>
      <a class="btn secundario" href="#/tickets/ajustes">Plantillas y SLA</a>
      <a class="btn" href="#/tickets/nuevo">+ Nuevo ticket</a>
      <a class="btn secundario" href="#/tickets/whatsapp" title="Pega o captura un chat de WhatsApp y sale el ticket o el trabajo relleno">${ico('mensaje')} Desde WhatsApp</a>
    </div>
    <div id="tk-lista">${tabla(lista)}</div>`;
}
function filtrarUno(t: Ticket, v: Vista) {
  return v === 'mios' ? esMio(t.tecnico_id) : v === 'sin_asignar' ? !t.tecnico_id : v === 'sla' ? ['mal', 'aviso'].includes(sla(t)?.tono ?? '') : true;
}
function tabla(lista: Ticket[]): string {
  if (!lista.length) return '<p class="vacio">No hay tickets aquí.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla tk-tabla"><thead><tr><th>#</th><th>Ticket</th><th>Cliente</th><th>Quién</th><th>Prioridad</th><th>Estado</th><th>SLA</th></tr></thead>
    <tbody>${lista.map(t => `<tr class="fila-clic" data-action="tkAbrir" data-p0="${t.numero}">
      <td>${t.numero}</td><td><strong>${esc(t.titulo)}</strong><br><small class="nota">${iconoCanal(t.canal)}${esc(CANALES[t.canal ?? ''] ?? t.canal ?? '')} · ${esc(hace(t.created_at))}</small></td>
      <td>${esc(_nombres.get(t.cliente_id ?? '') ?? '')}</td><td>${esc(t.tecnico_id ?? '—')}</td><td>${chipPrioridad(t.prioridad)}</td>
      <td>${esc(t.estado)}</td><td>${t.estado === 'Cerrado' ? estrellas(t.valoracion) : chipSla(t)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ── Nuevo ──────────────────────────────────────────────────────────────────
async function pintarNuevo(el: HTMLElement) {
  // Desde WhatsApp (ventana fija o «Desde WhatsApp») llega relleno: se repasa y se guarda.
  const b = tomarBorrador('ticket');
  const personas = await equipo();
  el.innerHTML = `<p><a href="#/tickets">← Tickets</a></p><h2>Nuevo ticket</h2>
    <form class="tarjeta" data-on-submit="tkCrear" data-prevent="1">
      <label>Qué pasa <input id="tk-titulo" required maxlength="200" placeholder="p. ej. No imprime la impresora de cocina" value="${esc(b?.titulo ?? '')}"></label>
      <div class="in-campos">
        <label>Cliente <input id="tk-cliente-q" autocomplete="off" placeholder="Buscar…" data-on-input="tkBuscarCliente:$value"></label>
        <label>Sede <select id="tk-local"><option value="">—</option></select></label>
        <label>Contacto <select id="tk-contacto" data-on-change="tkElegirContacto:$value"><option value="">—</option></select></label>
        <label>Prioridad <select id="tk-prioridad">${PRIORIDADES.map(p => `<option ${p === (PRIORIDADES.includes(b?.prioridad ?? '') ? b!.prioridad : 'Media') ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>Técnico <select id="tk-tecnico"><option value="">Sin asignar</option>${personas.map(p => `<option>${esc(p.nombre)}</option>`).join('')}</select></label>
        <label>Entró por <select id="tk-canal">${Object.entries(CANALES).filter(([k]) => !['app', 'rmm', 'portal'].includes(k)).map(([k, v]) => `<option value="${k}" ${k === (b?.canal ?? 'telefono') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Correo del cliente <input id="tk-email" type="email" placeholder="para contestarle por correo"></label>
      </div>
      <input type="hidden" id="tk-cliente"><ul id="tk-cliente-res" class="resultados"></ul>
      <label>Detalle <textarea id="tk-descripcion" rows="5">${esc(b?.descripcion ?? '')}</textarea></label>
      <div class="acciones"><button class="btn" type="submit">Crear ticket</button></div>
    </form>`;
  if (b?.cliente_id) {
    const { data: c } = await API.single<{ id: string; nombre: string }>('clientes', { select: 'id,nombre', id: `eq.${b.cliente_id}` });
    if (c) await elegirCliente(c.id, c.nombre, b.local_id, b.contacto_id);
  }
}

// Cliente elegido: sus sedes y contactos (y, si vienen de un borrador, los ya elegidos).
async function elegirCliente(id: string, nombre: string, local?: string | null, contacto?: string | null) {
  const ci = document.getElementById('tk-cliente') as HTMLInputElement | null;
  if (!ci) return;
  ci.value = id;
  (document.getElementById('tk-cliente-q') as HTMLInputElement).value = nombre;
  const ul = document.getElementById('tk-cliente-res'); if (ul) ul.innerHTML = '';
  const [ls, ks] = await Promise.all([
    API.get<any[]>('locales', { select: 'id,nombre', cliente_id: `eq.${id}`, activo: 'eq.true', order: 'nombre' }),
    API.get<any[]>('contactos', { select: 'id,nombre,email', cliente_id: `eq.${id}`, activo: 'eq.true', order: 'favorito.desc,nombre' }),
  ]);
  const sl = document.getElementById('tk-local'), sc = document.getElementById('tk-contacto');
  const selLocal = (l: any) => local ? l.id === local : ls.data?.length === 1;
  if (sl) sl.innerHTML = `<option value="">—</option>${(ls.data ?? []).map(l => `<option value="${esc(l.id)}" ${selLocal(l) ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}`;
  if (sc) sc.innerHTML = `<option value="">—</option>${(ks.data ?? []).map(k => `<option value="${esc(k.id)}" data-email="${esc(k.email ?? '')}" ${k.id === contacto ? 'selected' : ''}>${esc(k.nombre)}</option>`).join('')}`;
  if (contacto) {
    const e = document.getElementById('tk-email') as HTMLInputElement | null;
    const k = (ks.data ?? []).find(x => x.id === contacto);
    if (e && k?.email && !e.value) e.value = k.email;
  }
}

// ── Ficha ──────────────────────────────────────────────────────────────────
function burbuja(c: Comentario): string {
  const autor = c.autor_nombre ?? (c.autor_id ? nombreDe(c.autor_id) : '');
  const envio = c.tipo !== 'respuesta' ? '' : c.enviado_at ? `<small class="nota">✓ enviada${c.canal ? ` por ${esc(CANALES[c.canal] ?? c.canal)}` : ''}</small>`
    : c.envio_error ? `<small class="mal">No se pudo enviar: ${esc(c.envio_error)}</small> <button class="btn secundario" data-action="tkReenviar" data-p0="${esc(c.id)}">Reintentar por correo</button>`
      : '<small class="nota">sin enviar</small>';
  return `<article class="tk-burbuja tk-${c.tipo}"><header><strong>${esc(autor || (c.tipo === 'cliente' ? 'Cliente' : ''))}</strong>
    <span class="chip">${{ nota: `${ico('candado')} Nota interna`, respuesta: `${ico('volver')} Al cliente`, cliente: `${ico('mensaje')} Cliente` }[c.tipo]}</span>
    <small class="nota" title="${esc(fechaHora(c.created_at))}">${esc(hace(c.created_at))}</small></header>
    <div class="md">${markdown(c.texto)}</div>${envio}</article>`;
}

async function pintarFicha(el: HTMLElement, numero: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const { data: t } = await API.single<Ticket>('tickets', { select: '*', numero: `eq.${Number(numero) || 0}` });
  if (!t) { el.innerHTML = '<p class="aviso mal">No existe ese ticket.</p><p><a href="#/tickets">← Tickets</a></p>'; return; }
  _actual = t;
  const [coms, personas, pls, cli, loc, con, trab, adj] = await Promise.all([
    API.get<Comentario[]>('ticket_comentarios', { select: '*', ticket_id: `eq.${t.id}`, order: 'created_at' }),
    equipo(), plantillas(),
    t.cliente_id ? API.single<any>('clientes', { select: 'id,nombre,telefono,email', id: `eq.${t.cliente_id}` }) : Promise.resolve({ data: null }),
    t.local_id ? API.single<any>('locales', { select: 'id,nombre,direccion', id: `eq.${t.local_id}` }) : Promise.resolve({ data: null }),
    t.contacto_id ? API.single<any>('contactos', { select: 'id,nombre,telefono,email', id: `eq.${t.contacto_id}` }) : Promise.resolve({ data: null }),
    t.trabajo_id ? API.single<any>('trabajos', { select: 'id,numero,titulo,estado', id: `eq.${t.trabajo_id}` }) : Promise.resolve({ data: null }),
    API.get<any[]>('ticket_adjuntos', { select: 'id,nombre,drive_url,mime_type,usuario,created_at', ticket_id: `eq.${t.id}`, order: 'created_at' }),
  ]);
  const c = cli.data, k = con.data;
  _ctx = { contacto: k?.nombre ?? null, cliente: c?.nombre ?? null, email: t.email_de ?? k?.email ?? c?.email ?? null, telefono: k?.telefono ?? c?.telefono ?? null };
  const wa = telWhatsApp(_ctx.telefono);
  const s = sla(t);
  const porDefecto = _ctx.email && (t.canal === 'email' || !wa) ? 'email' : wa ? 'whatsapp' : 'otro';
  const cerrado = t.estado === 'Cerrado';
  el.innerHTML = `<p><a href="#/tickets">← Tickets</a>${t.cliente_id ? ` · <a href="#/clientes/${esc(t.cliente_id)}">Ficha del cliente</a>` : ''}</p>
    <div class="tarjeta-cab"><h2>${ico('etiqueta')} #${t.numero} ${esc(t.titulo)}</h2>
      <div class="acciones">${chipPrioridad(t.prioridad)} <span class="chip">${esc(t.estado)}</span> ${s ? chipSla(t) : ''} ${botonChatFicha('ticket', t.id, `#${t.numero} ${t.titulo}`, `#/tickets/${t.numero}`)} ${enlaceHistorial('tickets', t.id)}</div></div>
    <p class="nota">Entró ${esc(hace(t.created_at))} por ${iconoCanal(t.canal)}${esc(CANALES[t.canal ?? ''] ?? t.canal ?? '—')}${t.email_de ? ` · ${esc(t.email_de)}` : ''}</p>
    <div class="op-ficha">
      <div>
        <section class="tk-conversacion">
          ${t.descripcion ? `<article class="tk-burbuja tk-cliente"><header><strong>${esc(_ctx.contacto ?? _ctx.cliente ?? 'Aviso')}</strong><span class="chip">Aviso inicial</span>
            <small class="nota">${esc(fechaHora(t.created_at))}</small></header><div class="md">${markdown(t.descripcion)}</div></article>` : ''}
          ${(coms.data ?? []).map(burbuja).join('')}
        </section>
        <form class="tarjeta tk-responder" data-on-submit="tkResponder" data-prevent="1">
          <div class="segmentado" role="radiogroup" aria-label="Tipo">
            <label class="tk-tipo"><input type="radio" name="tk-tipo" value="respuesta" checked data-on-change="tkTipo:$value"> Responder al cliente</label>
            <label class="tk-tipo"><input type="radio" name="tk-tipo" value="nota" data-on-change="tkTipo:$value"> Nota interna</label></div>
          <div class="in-campos">
            <label>Plantilla <select id="tk-plantilla" data-on-change="tkPlantilla:$value"><option value="">—</option>${pls.map(p => `<option value="${esc(p.id)}">${esc(p.titulo)}</option>`).join('')}</select></label>
            <label id="tk-via-l">Enviar por <select id="tk-via">
              <option value="email" ${porDefecto === 'email' ? 'selected' : ''} ${_ctx.email ? '' : 'disabled'}>Correo${_ctx.email ? ` (${esc(_ctx.email)})` : ' (sin correo)'}</option>
              <option value="whatsapp" ${porDefecto === 'whatsapp' ? 'selected' : ''} ${wa ? '' : 'disabled'}>WhatsApp${wa ? '' : ' (sin teléfono)'}</option>
              <option value="otro" ${porDefecto === 'otro' ? 'selected' : ''}>Ya se lo he dicho (teléfono, en persona)</option></select></label>
          </div>
          <textarea id="tk-texto" rows="5" required placeholder="Escribe…"></textarea>
          <div id="tk-oki"></div>
          <div class="acciones"><button class="btn" type="submit" id="tk-enviar">Enviar</button>
            <button type="button" class="btn secundario" data-action="tkOki">${ico('chispa')} Que Oki lo redacte</button></div>
        </form>
      </div>
      <div>
        <section class="tarjeta"><h3>Datos</h3>
          <div class="in-campos">
            <label>Estado <select id="tk-estado" data-on-change="tkCambiar:estado,$value">${ESTADOS.map(e => `<option ${e === t.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
            <label>Prioridad <select id="tk-prio" data-on-change="tkCambiar:prioridad,$value">${PRIORIDADES.map(p => `<option ${prioridadNorm(t.prioridad) === p.toLowerCase() ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
            <label>Técnico <select id="tk-tec" data-on-change="tkCambiar:tecnico_id,$value"><option value="">Sin asignar</option>
              ${[...new Set([...personas.map(p => p.nombre), ...(t.tecnico_id ? [t.tecnico_id] : [])])].map(n => `<option ${n === t.tecnico_id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          </div>
          <dl class="tk-dl">
            <dt>Cliente</dt><dd>${c ? `<a href="#/clientes/${esc(c.id)}">${esc(c.nombre)}</a>` : '—'}</dd>
            <dt>Sede</dt><dd>${loc.data ? `<a href="#/monitorizacion/sede/${esc(loc.data.id)}">${esc(loc.data.nombre)}</a>` : '—'}</dd>
            <dt>Contacto</dt><dd>${k ? esc(k.nombre) : '—'}${_ctx.telefono ? ` · <a href="tel:${esc(_ctx.telefono)}">${esc(_ctx.telefono)}</a>` : ''}${wa ? ` · <a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</dd>
            <dt>SLA</dt><dd>Respuesta: ${t.primera_respuesta_at ? `hecha ${esc(fechaHora(t.primera_respuesta_at))}` : esc(fechaHora(t.sla_respuesta_at))}<br>
              Resolución: ${cerrado ? `cerrado ${esc(fechaHora(t.cerrado_at))}` : esc(fechaHora(t.sla_resolucion_at))}</dd>
          </dl></section>
        ${adj.data?.length ? `<section class="tarjeta"><h3>Adjuntos <span class="chip">${adj.data.length}</span></h3>
          <ul class="tk-adjuntos">${adj.data.map(a => `<li>${a.drive_url ? `<a href="${esc(a.drive_url)}" target="_blank" rel="noopener">${String(a.mime_type ?? '').startsWith('image/')
            ? `<img src="${esc(a.drive_url)}" alt="${esc(a.nombre)}" loading="lazy">` : ''}${esc(a.nombre)}</a>` : esc(a.nombre)}
            <small class="nota">${esc([a.usuario, hace(a.created_at)].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul></section>` : ''}
        <section class="tarjeta"><h3>Trabajo</h3>
          ${trab.data ? `<p>${ico('herramienta')} Trabajo #${trab.data.numero} ${esc(trab.data.titulo ?? '')} · ${esc(trab.data.estado)} <button class="btn secundario" data-action="tkDesvincular">Quitar</button></p>`
            : `<form class="acciones" data-on-submit="tkVincular" data-prevent="1"><input id="tk-trabajo" type="number" min="1" placeholder="Nº de trabajo" aria-label="Número de trabajo">
              <button class="btn secundario" type="submit">Vincular</button></form>
              <p class="nota">¿Hay que ir? Crea el trabajo en la <a href="${esc(APP_ACTUAL_URL)}" target="_blank" rel="noopener">app actual ${ico('externo')}</a> y vincúlalo aquí con su número.</p>`}
        </section>
        <section class="tarjeta"><h3>${cerrado ? 'Cerrado' : 'Cerrar'}</h3>
          ${cerrado ? `<p>${esc(t.resolucion ?? '')}${t.resolucion_categoria ? ` <span class="chip">${esc(t.resolucion_categoria)}</span>` : ''}</p>
            ${t.valoracion ? `<p>Valoración: ${estrellas(t.valoracion)}${t.valoracion_comentario ? `<br><em>«${esc(t.valoracion_comentario)}»</em>` : ''}</p>`
              : '<p class="nota">Sin valoración todavía.</p>'}
            <div class="acciones"><button class="btn secundario" data-action="tkCopiarValoracion">Copiar enlace de valoración</button>
              <button class="btn secundario" data-action="tkCambiar" data-p0="estado" data-p1="Abierto">Reabrir</button></div>`
          : `<form data-on-submit="tkCerrar" data-prevent="1">
              <label>Qué se hizo <textarea id="tk-resolucion" rows="3" required>${esc(t.resolucion ?? '')}</textarea></label>
              <label>Cómo <select id="tk-categoria">${CATEGORIAS.map(x => `<option ${x === t.resolucion_categoria ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
              <div class="acciones"><button class="btn" type="submit">Cerrar ticket</button></div>
              <p class="nota">Al cerrar se prepara el mensaje de cierre con el enlace para que el cliente valore (lo mandas tú).</p></form>`}
        </section>
        ${esAdmin() ? '<div class="acciones"><button class="btn peligro" data-action="tkBorrar">Borrar ticket</button></div>' : ''}
      </div>
    </div>`;
  if (_prepararCierre) {
    _prepararCierre = false;
    const cierre = pls.find(p => p.cierre), ta = document.getElementById('tk-texto') as HTMLTextAreaElement | null;
    if (cierre && ta) { ta.value = rellenar(cierre.texto, t, _ctx); ta.scrollIntoView({ block: 'center' }); }
  }
}

// ── Bandeja de correo ──────────────────────────────────────────────────────
async function pintarBandeja(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const verTodo = leer('hub_tk_bandeja', 'nuevo') === 'todo';
  const [r, est] = await Promise.all([
    API.get<any[]>('correos_entrantes', { select: '*', ...(verTodo ? { recibido_at: `gte.${new Date(Date.now() - 7 * 86400000).toISOString()}` } : { estado: 'eq.nuevo' }), order: 'recibido_at.desc', limit: '100' }),
    llamarFuncion<any>('desk-correo', { accion: 'estado' }),
  ]);
  const e = est.data;
  const estado = !e ? `<p class="aviso mal">No se pudo comprobar el correo: ${esc(est.error ?? '')}</p>`
    : !e.configurado ? '<p class="aviso">El correo aún no está conectado (falta la clave de Google en las funciones).</p>'
      : !e.ok ? `<p class="aviso mal">No se puede leer ${esc(e.buzon)}: ${esc(e.error)}</p>`
        : `<p class="nota">Leyendo ${esc(e.buzon)} cada 5 minutos${e.sync?.ultima_ok ? ` · última lectura ${esc(hace(e.sync.ultima_ok))}` : ''}${e.sync?.ultimo_error ? ` · <span class="mal">${esc(e.sync.ultimo_error)}</span>` : ''}.</p>`;
  el.innerHTML = `<p><a href="#/tickets">← Tickets</a></p><h2>Bandeja de correo</h2>${estado}
    <p class="nota">Aquí solo llega lo que no es de un cliente conocido ni de un ticket abierto: lo de los clientes se convierte en ticket solo.</p>
    <div class="acciones pr-barra"><label class="check"><input type="checkbox" ${verTodo ? 'checked' : ''} data-on-change="tkBandejaTodo:$checked"> Ver también lo ya tratado (7 días)</label>
      ${esAdmin() && e?.ok ? '<button class="btn secundario" data-action="tkLeerCorreo">Leer ahora</button>' : ''}</div>
    ${(r.data ?? []).map(m => `<article class="tarjeta tk-correo">
      <header><strong>${esc(m.de_nombre ?? m.de)}</strong> <small class="nota">&lt;${esc(m.de)}&gt; · ${esc(hace(m.recibido_at))}</small>
        ${m.estado !== 'nuevo' ? `<span class="chip">${esc({ ticket: 'abrió ticket', comentario: 'siguió un ticket', descartado: `descartado${m.motivo ? ': ' + m.motivo : ''}` }[m.estado as string] ?? m.estado)}</span>` : ''}</header>
      <h3>${esc(m.asunto ?? '(sin asunto)')}</h3>
      <details><summary>${esc((m.texto ?? '').slice(0, 160))}${(m.texto ?? '').length > 160 ? '…' : ''}</summary><div class="md">${markdown(m.texto ?? '')}</div></details>
      ${m.estado === 'nuevo' ? `<div class="acciones">
        <button class="btn" data-action="tkDeCorreo" data-p0="${esc(m.id)}">Crear ticket</button>
        <form class="acciones" data-on-submit="tkCorreoATicket:${esc(m.id)}" data-prevent="1"><input id="tk-a-${esc(m.id)}" type="number" min="1" placeholder="Nº ticket" aria-label="Añadir al ticket número">
          <button class="btn secundario" type="submit">Añadir a un ticket</button></form>
        <button class="btn secundario" data-action="tkDescartar" data-p0="${esc(m.id)}">Descartar</button></div>`
        : m.ticket_id ? `<p><a href="#" data-action="tkAbrirId" data-p0="${esc(m.ticket_id)}">Ver ticket</a></p>` : ''}
    </article>`).join('') || `<p class="vacio">Nada por revisar. ${ico('trofeo')}</p>`}`;
}

// ── Ajustes ────────────────────────────────────────────────────────────────
async function pintarAjustes(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [pls, slas, hor, fes] = await Promise.all([
    API.get<Plantilla[]>('plantillas_respuesta', { select: '*', order: 'orden,titulo' }),
    API.get<any[]>('sla_politicas', { select: '*' }),
    API.get<any[]>('horario_laboral', { select: '*', order: 'dia_semana,desde' }),
    API.get<any[]>('festivos', { select: '*', fecha: `gte.${new Date().toLocaleDateString('sv-SE')}`, order: 'fecha' }),
  ]);
  const adm = esAdmin();
  const h = (m: number) => String(Math.round(m / 6) / 10).replace('.', ',');
  const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const editor = (p: Plantilla | null) => `<form class="tarjeta" data-on-submit="tkGuardarPlantilla:$this" data-prevent="1" data-id="${esc(p?.id ?? '')}">
    <label>Título <input name="titulo" required maxlength="80" value="${esc(p?.titulo ?? '')}"></label>
    <label>Texto <textarea name="texto" rows="4" required>${esc(p?.texto ?? '')}</textarea></label>
    <div class="acciones"><label class="check"><input type="checkbox" name="cierre" ${p?.cierre ? 'checked' : ''}> Se ofrece al cerrar</label>
      <label class="check"><input type="checkbox" name="activa" ${p?.activa !== false ? 'checked' : ''}> Activa</label>
      <button class="btn" type="submit">${p ? 'Guardar' : 'Añadir'}</button></div></form>`;
  const orden = ['urgente', 'alta', 'media', 'baja'];
  el.innerHTML = `<p><a href="#/tickets">← Tickets</a></p>
    <h2>Plantillas de respuesta</h2>
    <p class="nota">Se pueden usar <code>{{contacto}}</code>, <code>{{cliente}}</code>, <code>{{numero}}</code>, <code>{{tecnico}}</code> y <code>{{valoracion}}</code> (el enlace para puntuar).</p>
    <div class="in-rejilla">${(pls.data ?? []).map(editor).join('')}${editor(null)}</div>
    <h2>SLA</h2>
    <form class="tarjeta" data-on-submit="tkGuardarSla" data-prevent="1"><p class="nota">Horas LABORABLES (${adm ? 'se pueden cambiar' : 'solo las cambia un administrador'}).</p>
      <table class="tabla"><thead><tr><th>Prioridad</th><th>Primera respuesta (h)</th><th>Resolución (h)</th></tr></thead><tbody>
      ${[...(slas.data ?? [])].sort((a, b) => orden.indexOf(a.prioridad) - orden.indexOf(b.prioridad)).map(s => `<tr><td>${esc(s.prioridad)}</td>
        <td><input name="r-${esc(s.prioridad)}" type="number" min="0.25" step="0.25" value="${h(s.respuesta_min).replace(',', '.')}" ${adm ? '' : 'disabled'} aria-label="Respuesta ${esc(s.prioridad)}"></td>
        <td><input name="s-${esc(s.prioridad)}" type="number" min="0.25" step="0.25" value="${h(s.resolucion_min).replace(',', '.')}" ${adm ? '' : 'disabled'} aria-label="Resolución ${esc(s.prioridad)}"></td></tr>`).join('')}
      </tbody></table>${adm ? '<div class="acciones"><button class="btn" type="submit">Guardar SLA</button></div>' : ''}</form>
    <div class="in-rejilla">
      <section class="tarjeta"><h3>Horario laboral</h3><ul>${(hor.data ?? []).map(x => `<li>${DIAS[x.dia_semana]}: ${esc(String(x.desde).slice(0, 5))}–${esc(String(x.hasta).slice(0, 5))}</li>`).join('')}</ul>
        <p class="nota">El reloj del SLA solo corre en este horario (hora de Canarias).</p></section>
      <section class="tarjeta"><h3>Festivos</h3><ul class="tk-festivos">${(fes.data ?? []).map(f => `<li>${esc(f.fecha)} · ${esc(f.nombre)}${adm ? ` <button class="btn secundario" data-action="tkQuitarFestivo" data-p0="${esc(f.fecha)}" aria-label="Quitar ${esc(f.nombre)}">✕</button>` : ''}</li>`).join('') || '<li class="nota">Ninguno.</li>'}</ul>
        ${adm ? `<form class="acciones" data-on-submit="tkFestivo" data-prevent="1"><input id="tk-fes-fecha" type="date" required aria-label="Fecha"><input id="tk-fes-nombre" required placeholder="Nombre" aria-label="Nombre del festivo"><button class="btn secundario" type="submit">Añadir</button></form>` : ''}</section>
    </div>`;
}

async function pintar(el: HTMLElement, params: string[]) {
  const [a] = params;
  if (!a) return pintarLista(el);
  if (a === 'nuevo') return pintarNuevo(el);
  if (a === 'whatsapp') return (await import('./whatsapp')).pintarDesdeWhatsapp(el);
  if (a === 'bandeja') return pintarBandeja(el);
  if (a === 'ajustes') return pintarAjustes(el);
  await pintarFicha(el, a);
  // #/tickets/<n>/responder («Sí, contéstalo» de la portada): Oki redacta y la persona manda.
  if (params[1] === 'responder' && _actual) await proponerOki();
}

async function proponerOki() {
  const caja = document.getElementById('tk-oki'), ta = document.getElementById('tk-texto') as HTMLTextAreaElement | null;
  if (!_actual || !caja || !ta) return;
  const id = _actual.id;
  caja.innerHTML = '<p class="nota"><span class="hex-punto pulso" aria-hidden="true"></span> Oki está redactando la respuesta…</p>';
  const r = await llamarFuncion<{ propuesta: string | null; motivo?: string }>('oki', { accion: 'proponer_ticket', ticket_id: id }, 60000);
  if (_actual?.id !== id || !document.getElementById('tk-oki')) return;
  if (r.data?.propuesta) {
    ta.value = r.data.propuesta;
    ta.focus();
    caja.innerHTML = `<p class="nota">${ico('chispa')} Lo ha redactado Oki: repásalo antes de enviarlo.</p>`;
  } else caja.innerHTML = `<p class="nota">${esc(r.error ? `Oki no ha podido redactarla: ${r.error}` : r.data?.motivo ?? 'Oki no ha propuesto nada.')}</p>`;
}

// ── Acciones ───────────────────────────────────────────────────────────────
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

async function responderYEnviar(c: Comentario, via: string): Promise<void> {
  const t = _actual!;
  if (via === 'email') {
    const r = await llamarFuncion<any>('desk-correo', { accion: 'enviar', comentario_id: c.id });
    toast(r.error ? `Guardada, pero no se pudo mandar: ${r.error}` : `Enviada a ${r.data?.para ?? 'el cliente'}`, r.error ? 'error' : 'info');
  } else if (via === 'whatsapp') {
    const wa = telWhatsApp(_ctx.telefono);
    if (wa) window.open(`https://wa.me/${wa}?text=${encodeURIComponent(c.texto)}`, '_blank', 'noopener');
    await API.patch('ticket_comentarios', { id: `eq.${c.id}` }, { enviado_at: new Date().toISOString(), canal: 'whatsapp' });
  } else {
    await API.patch('ticket_comentarios', { id: `eq.${c.id}` }, { enviado_at: new Date().toISOString(), canal: 'telefono' });
  }
  if (t.estado === 'Abierto') await API.patch('tickets', { id: `eq.${t.id}` }, { estado: 'En curso' });
}

registrarAcciones({
  tkVista(v: string) { guardar('hub_tk_vista', v); resolver(); },
  tkBuscar(q: string) {
    _q = q;
    const c = document.getElementById('tk-lista');
    if (c) c.innerHTML = tabla(filtrar(leer('hub_tk_vista', 'abiertos') as Vista));
  },
  tkAbrir(n: string) { ir('tickets', n); },
  async tkAbrirId(id: string) {
    const { data } = await API.single<Ticket>('tickets', { select: 'numero', id: `eq.${id}` });
    if (data) ir('tickets', String(data.numero));
  },
  tkBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('tk-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('tk-cliente-res');
      if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="tkElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}
        <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  tkElegirCliente: (id: string, nombre: string) => elegirCliente(id, nombre),
  tkElegirContacto(id: string) {
    const o = document.querySelector<HTMLOptionElement>(`#tk-contacto option[value="${CSS.escape(id)}"]`);
    const e = document.getElementById('tk-email') as HTMLInputElement | null;
    if (o?.dataset.email && e && !e.value) e.value = o.dataset.email;
  },
  async tkCrear() {
    const d = { titulo: val('tk-titulo'), descripcion: val('tk-descripcion') || null, cliente_id: val('tk-cliente') || null, local_id: val('tk-local') || null,
      contacto_id: val('tk-contacto') || null, prioridad: val('tk-prioridad') || 'Media', tecnico_id: val('tk-tecnico') || null, canal: val('tk-canal') || 'hub',
      email_de: val('tk-email').toLowerCase() || null, estado: 'Abierto' };
    if (!d.titulo) return;
    const r = await API.post<Ticket[]>('tickets', d);
    if (r.error || !r.data?.[0]) { toast(`No se pudo crear: ${r.error?.message}`, 'error'); return; }
    toast(`Ticket #${r.data[0].numero} creado`);
    ir('tickets', String(r.data[0].numero));
  },
  tkTipo(v: string) {
    const via = document.getElementById('tk-via-l'), b = document.getElementById('tk-enviar');
    if (via) via.hidden = v === 'nota';
    if (b) b.textContent = v === 'nota' ? 'Guardar nota' : 'Enviar';
  },
  tkOki: proponerOki,
  tkPlantilla(id: string) {
    const p = _plantillas.find(x => x.id === id), ta = document.getElementById('tk-texto') as HTMLTextAreaElement | null;
    if (p && ta && _actual) { ta.value = rellenar(p.texto, _actual, _ctx); ta.focus(); }
  },
  async tkResponder() {
    if (!_actual) return;
    const tipo = (document.querySelector('input[name="tk-tipo"]:checked') as HTMLInputElement)?.value ?? 'respuesta';
    const texto = val('tk-texto');
    if (!texto) return;
    const r = await API.post<Comentario[]>('ticket_comentarios', { ticket_id: _actual.id, texto, tipo, autor_nombre: usuario()?.nombre ?? null });
    if (r.error || !r.data?.[0]) { toast(`No se pudo guardar: ${r.error?.message}`, 'error'); return; }
    if (tipo === 'respuesta') await responderYEnviar(r.data[0], val('tk-via'));
    else toast('Nota guardada');
    resolver();
  },
  async tkReenviar(id: string) {
    const r = await llamarFuncion<any>('desk-correo', { accion: 'enviar', comentario_id: id });
    toast(r.error ? `No se pudo mandar: ${r.error}` : 'Enviada', r.error ? 'error' : 'info');
    resolver();
  },
  async tkCambiar(campo: string, v: string) {
    if (!_actual || !['estado', 'prioridad', 'tecnico_id'].includes(campo)) return;
    const r = await API.patch('tickets', { id: `eq.${_actual.id}` }, { [campo]: v || null });
    if (r.error) toast(`No se pudo cambiar: ${r.error.message}`, 'error'); else { toast('Cambiado'); resolver(); }
  },
  async tkVincular() {
    if (!_actual) return;
    const n = Number(val('tk-trabajo'));
    const { data } = await API.single<any>('trabajos', { select: 'id,numero', numero: `eq.${n || 0}` });
    if (!data) { toast('No hay ningún trabajo con ese número', 'error'); return; }
    const r = await API.patch('tickets', { id: `eq.${_actual.id}` }, { trabajo_id: data.id });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast(`Vinculado al trabajo #${data.numero}`); resolver(); }
  },
  async tkDesvincular() {
    if (!_actual) return;
    await API.patch('tickets', { id: `eq.${_actual.id}` }, { trabajo_id: null });
    resolver();
  },
  async tkCerrar() {
    if (!_actual) return;
    const r = await API.patch('tickets', { id: `eq.${_actual.id}` }, { estado: 'Cerrado', resolucion: val('tk-resolucion'), resolucion_categoria: val('tk-categoria') || null });
    if (r.error) { toast(`No se pudo cerrar: ${r.error.message}`, 'error'); return; }
    toast('Ticket cerrado: revisa el mensaje de cierre y mándalo');
    _prepararCierre = true;
    resolver();
  },
  async tkCopiarValoracion() {
    if (!_actual) return;
    try { await navigator.clipboard.writeText(enlaceValoracion(_actual)); toast('Enlace copiado'); } catch { toast(enlaceValoracion(_actual)); }
  },
  async tkBorrar() {
    if (!_actual || !confirm(`¿Borrar el ticket #${_actual.numero} y su conversación? No se puede deshacer.`)) return;
    await API.delete('ticket_comentarios', { ticket_id: `eq.${_actual.id}` });
    const r = await API.delete('tickets', { id: `eq.${_actual.id}` });
    if (r.error) toast(`No se pudo borrar: ${r.error.message}`, 'error'); else ir('tickets');
  },
  // Bandeja
  tkBandejaTodo(v: boolean) { guardar('hub_tk_bandeja', v ? 'todo' : 'nuevo'); resolver(); },
  async tkLeerCorreo() {
    toast('Leyendo el correo…');
    const r = await llamarFuncion<any>('desk-correo', { accion: 'leer' }, 90000);
    toast(r.error ? `Falló: ${r.error}` : `Tickets nuevos: ${r.data?.ticket ?? 0} · a tickets: ${r.data?.comentario ?? 0} · a la bandeja: ${r.data?.nuevo ?? 0}`, r.error ? 'error' : 'info');
    resolver();
  },
  async tkDeCorreo(id: string) {
    const { data: m } = await API.single<any>('correos_entrantes', { select: '*', id: `eq.${id}` });
    if (!m) return;
    const r = await API.post<Ticket[]>('tickets', { titulo: (m.asunto ?? 'Correo').slice(0, 200), descripcion: m.texto, estado: 'Abierto', prioridad: 'Media',
      canal: 'email', via_contacto: 'email', email_hilo: m.hilo, email_de: m.de, created_at: m.recibido_at });
    if (r.error || !r.data?.[0]) { toast(`No se pudo crear: ${r.error?.message}`, 'error'); return; }
    await API.patch('correos_entrantes', { id: `eq.${id}` }, { estado: 'ticket', ticket_id: r.data[0].id });
    toast(`Ticket #${r.data[0].numero} creado: ponle el cliente`);
    ir('tickets', String(r.data[0].numero));
  },
  async tkCorreoATicket(id: string) {
    const n = Number(val(`tk-a-${id}`));
    const [{ data: m }, { data: t }] = await Promise.all([
      API.single<any>('correos_entrantes', { select: '*', id: `eq.${id}` }), API.single<Ticket>('tickets', { select: 'id,numero,email_hilo,email_de', numero: `eq.${n || 0}` })]);
    if (!m) return;
    if (!t) { toast('No existe ese ticket', 'error'); return; }
    const r = await API.post('ticket_comentarios', { ticket_id: t.id, texto: m.texto || '(sin texto)', tipo: 'cliente', canal: 'email', email_id: m.gmail_id,
      autor_nombre: `${m.de_nombre ?? m.de} (correo)`, created_at: m.recibido_at });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    await Promise.all([API.patch('correos_entrantes', { id: `eq.${id}` }, { estado: 'comentario', ticket_id: t.id }),
      t.email_hilo ? Promise.resolve() : API.patch('tickets', { id: `eq.${t.id}` }, { email_hilo: m.hilo, email_de: t.email_de ?? m.de })]);
    toast(`Añadido al ticket #${t.numero}`);
    resolver();
  },
  async tkDescartar(id: string) {
    await API.patch('correos_entrantes', { id: `eq.${id}` }, { estado: 'descartado', motivo: `a mano (${usuario()?.nombre ?? ''})` });
    resolver();
  },
  // Ajustes
  async tkGuardarPlantilla(f: HTMLFormElement) {
    const id = f.dataset.id ?? '';
    const fd = new FormData(f);
    const d = { titulo: String(fd.get('titulo') ?? '').trim(), texto: String(fd.get('texto') ?? '').trim(), cierre: fd.get('cierre') === 'on', activa: fd.get('activa') === 'on' };
    const r = id ? await API.patch('plantillas_respuesta', { id: `eq.${id}` }, d) : await API.post('plantillas_respuesta', { ...d, orden: 99 });
    if (r.error) toast(`No se pudo guardar: ${r.error.message}`, 'error'); else { toast('Plantilla guardada'); resolver(); }
  },
  async tkGuardarSla() {
    for (const p of ['urgente', 'alta', 'media', 'baja']) {
      const r = Number((document.querySelector(`input[name="r-${p}"]`) as HTMLInputElement)?.value), s = Number((document.querySelector(`input[name="s-${p}"]`) as HTMLInputElement)?.value);
      if (!(r > 0 && s > 0)) continue;
      const res = await API.patch('sla_politicas', { prioridad: `eq.${p}` }, { respuesta_min: Math.round(r * 60), resolucion_min: Math.round(s * 60) });
      if (res.error) { toast(`No se pudo guardar: ${res.error.message}`, 'error'); return; }
    }
    toast('SLA guardado (vale para los tickets nuevos o al cambiar su prioridad)');
    resolver();
  },
  async tkFestivo() {
    const r = await API.post('festivos', { fecha: val('tk-fes-fecha'), nombre: val('tk-fes-nombre') });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async tkQuitarFestivo(fecha: string) {
    await API.delete('festivos', { fecha: `eq.${fecha}` });
    resolver();
  },
});

async function contador(): Promise<Contador | null> {
  const [n, vencidos] = await Promise.all([
    API.contar('tickets', { estado: `in.(${ABIERTOS.map(e => `"${e}"`).join(',')})` }),
    API.contar('tickets', { estado: 'in.(Abierto,"En curso")', or: `(and(primera_respuesta_at.is.null,sla_respuesta_at.lt.${new Date().toISOString()}),sla_resolucion_at.lt.${new Date().toISOString()})` }),
  ]);
  if (n == null) return null;
  return { valor: n, subtitulo: vencidos ? `abiertos · ${vencidos} con el SLA vencido` : 'abiertos', tono: vencidos ? 'mal' : n ? 'aviso' : 'bien' };
}

export const moduloTickets: Modulo = {
  id: 'tickets',
  titulo: 'Tickets',
  grupo: 'Clientes',
  icono: '🎫',
  explicacion: 'El soporte: lo que entra por correo, WhatsApp, teléfono o la app, con su plazo (SLA) contando en horario laboral. Contesta al cliente desde aquí (por correo sale del buzón de la empresa), apunta notas internas y ciérralo con el enlace para que el cliente valore.',
  pintar,
  contador,
};
