// Área de clientes (fase 7): página aparte del hub, sin supabase-js ni la
// sesión del equipo. Todo va por la función `portal` con la sesión propia del
// cliente (x-portal-token). Entrada: ?c=<código> del enlace mágico.
import './portal.css';
import { FUNCIONES_URL, SUPABASE_ANON_KEY } from '../core/config';
import { esc, fechaHora, pl } from '../ui/dom';
import { markdown } from '../ui/markdown';

const CLAVE = 'okc_portal_token';
const raiz = document.getElementById('portal')!;
const leerToken = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
const guardarToken = (t: string | null) => { try { if (t) localStorage.setItem(CLAVE, t); else localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ } };
const eur = (n: unknown) => `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fecha = (d: unknown) => d ? new Date(String(d)).toLocaleDateString('es-ES') : '—';

async function llamar<T = any>(accion: string, cuerpo: Record<string, unknown> = {}): Promise<T> {
  const token = leerToken();
  const res = await fetch(`${FUNCIONES_URL}/portal`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, ...(token ? { 'x-portal-token': token } : {}) },
    body: JSON.stringify({ accion, ...cuerpo }) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && j.sesion === false) { guardarToken(null); pantallaEntrar(j.error); throw new Error(j.error); }
  if (!res.ok) throw new Error(j.error ?? 'No se pudo completar');
  return j as T;
}

let _t = 0;
function aviso(msg: string) {
  let el = document.getElementById('po-toast');
  if (!el) { el = document.createElement('div'); el.id = 'po-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('visible');
  clearTimeout(_t); _t = window.setTimeout(() => el!.classList.remove('visible'), 4000);
}

// ── Entrar ─────────────────────────────────────────────────────────────────
function pantallaEntrar(error?: string) {
  raiz.innerHTML = `<main><div class="po-tarjeta po-entrar">
    <h1>Área de clientes</h1><p class="po-nota">Ok Computer Tenerife</p>
    ${error ? `<p class="po-mal">${esc(error)}</p>` : ''}
    <form id="po-form-entrar"><label>Tu correo <input id="po-email" type="email" required autocomplete="email"></label>
      <button class="po-btn" type="submit">Enviarme el enlace para entrar</button></form>
    <p class="po-nota">Te mandamos un enlace de un solo uso. Si tu correo no está dado de alta, pídenoslo.</p></div></main>`;
  document.getElementById('po-form-entrar')!.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = (e.target as HTMLFormElement).querySelector('button')!;
    btn.disabled = true;
    try {
      const r = await llamar<{ mensaje: string }>('pedir_enlace', { email: (document.getElementById('po-email') as HTMLInputElement).value });
      (e.target as HTMLFormElement).outerHTML = `<p>${esc(r.mensaje)}</p>`;
    } catch (err) { aviso((err as Error).message); btn.disabled = false; }
  });
}

// ── Pantallas ──────────────────────────────────────────────────────────────
const SECCIONES: [string, string][] = [['inicio', 'Inicio'], ['tickets', 'Tickets'], ['presupuestos', 'Presupuestos'], ['facturas', 'Facturas'], ['mantenimiento', 'Mantenimiento'], ['equipos', 'Equipos']];
let _yo: { nombre: string | null; email: string; cliente: string } | null = null;
const TONO_ESTADO: Record<string, string> = { Abierto: 'aviso', 'En curso': 'aviso', Pendiente: 'aviso', Cerrado: 'bien', Enviado: 'aviso', Aceptado: 'bien', Rechazado: 'mal' };
const chip = (t: string | null | undefined, tono = TONO_ESTADO[t ?? ''] ?? '') => `<span class="po-chip ${tono}">${esc(t ?? '—')}</span>`;

async function inicio(): Promise<string> {
  const r = await llamar('resumen');
  const c = (href: string, n: unknown, txt: string, tono = '') => `<a class="po-tarjeta po-cifra" href="#/${href}"><strong class="${tono}">${esc(n)}</strong>${esc(txt)}</a>`;
  return `<h1>Hola${_yo?.nombre ? ', ' + esc(_yo.nombre.split(' ')[0]) : ''}</h1><p class="po-nota">${esc(_yo?.cliente ?? '')}</p>
    <div class="po-cifras">${c('tickets', r.tickets_abiertos, 'tickets abiertos')}${c('presupuestos', r.presupuestos_pendientes, 'presupuestos por aceptar')}
      ${c('facturas', eur(r.saldo_pendiente), `pendiente en ${pl(r.facturas_pendientes, 'factura', 'facturas')}`, r.saldo_pendiente > 0 ? 'po-mal' : '')}
      ${c('equipos', `${r.equipos_conectados}/${r.equipos}`, `equipos conectados${r.alertas ? ` · ${pl(r.alertas, 'alerta', 'alertas')}` : ''}`)}</div>
    <div class="po-acciones"><a class="po-btn" href="#/nuevo" style="display:inline-flex;align-items:center;text-decoration:none">Abrir un aviso</a></div>`;
}

async function tickets(): Promise<string> {
  const ts = await llamar<any[]>('tickets');
  return `<div class="po-acciones" style="justify-content:space-between"><h1>Tickets</h1><a class="po-btn" href="#/nuevo" style="display:inline-flex;align-items:center;text-decoration:none">Abrir un aviso</a></div>
    <div class="po-tarjeta po-scroll">${ts.length ? `<table class="po-tabla"><thead><tr><th>#</th><th>Asunto</th><th>Estado</th><th class="po-ocultable">Abierto</th></tr></thead><tbody>
      ${ts.map(t => `<tr><td><a href="#/tickets/${t.numero}">${t.numero}</a></td><td><a href="#/tickets/${t.numero}">${esc(t.titulo)}</a></td><td>${chip(t.estado)}</td><td class="po-ocultable">${fecha(t.created_at)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="po-nota">No tienes tickets.</p>'}</div>`;
}

async function ticket(n: string): Promise<string> {
  const t = await llamar('ticket', { numero: n });
  return `<p><a href="#/tickets">← Tickets</a></p><h1>#${t.numero} ${esc(t.titulo)}</h1><p>${chip(t.estado)} <span class="po-nota">abierto el ${fechaHora(t.created_at)}</span></p>
    <section class="po-tarjeta">${t.descripcion ? `<div class="po-msg tu"><header>tú · ${fechaHora(t.created_at)}</header>${markdown(t.descripcion)}</div>` : ''}
      ${t.mensajes.map((m: any) => `<div class="po-msg ${m.de === 'tú' ? 'tu' : ''}"><header>${esc(m.de)} · ${fechaHora(m.fecha)}</header>${markdown(m.texto)}</div>`).join('')}
      ${t.estado === 'Cerrado' && t.resolucion ? `<p class="po-nota">Resuelto: ${esc(t.resolucion)}</p>` : ''}</section>
    <form class="po-tarjeta" id="po-form-msg"><label>${t.estado === 'Cerrado' ? 'Si sigue sin ir bien, escríbenos y lo reabrimos' : 'Añadir un mensaje'}
      <textarea id="po-msg" rows="4" required maxlength="5000"></textarea></label><button class="po-btn" type="submit">Enviar</button></form>`;
}

async function nuevo(): Promise<string> {
  const sedes = await llamar<any[]>('mantenimiento');
  return `<p><a href="#/tickets">← Tickets</a></p><h1>Abrir un aviso</h1>
    <form class="po-tarjeta" id="po-form-nuevo"><label>¿Qué pasa? <input id="po-titulo" required maxlength="200" placeholder="p. ej. La impresora de cocina no imprime"></label>
      ${sedes.length > 1 ? `<label>¿Dónde? <select id="po-sede"><option value="">—</option>${sedes.map((s: any) => `<option value="${esc(s.local_id ?? '')}">${esc(s.nombre)}</option>`).join('')}</select></label>` : ''}
      <label>Cuéntanos más (opcional) <textarea id="po-desc" rows="5" maxlength="5000"></textarea></label>
      <button class="po-btn" type="submit">Enviar aviso</button></form>`;
}

async function presupuestos(): Promise<string> {
  const ps = await llamar<any[]>('presupuestos');
  return `<h1>Presupuestos</h1><div class="po-tarjeta po-scroll">${ps.length ? `<table class="po-tabla"><thead><tr><th>Nº</th><th>Concepto</th><th>Importe</th><th>Estado</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr><td>${esc(p.numero ?? '')}</td><td>${esc(p.titulo ?? '')}<br><small class="po-nota">${fecha(p.fecha)}</small></td><td>${eur(p.total)}</td>
      <td>${p.aceptado ? chip(`Aceptado por ti (${fecha(p.aceptado.created_at)})`, 'bien') : chip(p.estado)}</td>
      <td><div class="po-acciones" style="margin:0">${p.pdf ? `<button class="po-btn sec" data-pdf="presupuesto" data-id="${esc(p.id)}">PDF</button>` : ''}
        ${p.estado === 'Enviado' && !p.aceptado ? `<button class="po-btn" data-aceptar="${esc(p.id)}" data-num="${esc(p.numero ?? '')}">Aceptar</button>` : ''}</div></td></tr>`).join('')}
  </tbody></table>` : '<p class="po-nota">No hay presupuestos.</p>'}</div>`;
}

async function facturas(): Promise<string> {
  const fs = await llamar<any[]>('facturas');
  const pend = fs.filter(f => Number(f.saldo) > 0);
  return `<h1>Facturas</h1>${pend.length ? `<p class="po-tarjeta">Pendiente de pago: <strong class="po-mal">${eur(pend.reduce((a, f) => a + Number(f.saldo), 0))}</strong> en ${pl(pend.length, 'factura', 'facturas')}.</p>` : ''}
    <div class="po-tarjeta po-scroll">${fs.length ? `<table class="po-tabla"><thead><tr><th>Nº</th><th>Fecha</th><th>Total</th><th>Pendiente</th><th></th></tr></thead><tbody>
    ${fs.map(f => `<tr><td>${esc(f.numero)}</td><td>${fecha(f.fecha)}${Number(f.saldo) > 0 && f.vence ? `<br><small class="${new Date(f.vence) < new Date() ? 'po-mal' : 'po-nota'}">vence ${fecha(f.vence)}</small>` : ''}</td>
      <td>${eur(f.total)}</td><td>${Number(f.saldo) > 0 ? `<span class="po-mal">${eur(f.saldo)}</span>` : chip('Pagada', 'bien')}</td>
      <td><button class="po-btn sec" data-pdf="factura" data-id="${esc(f.invoice_id)}">PDF</button></td></tr>`).join('')}
  </tbody></table>` : '<p class="po-nota">No hay facturas.</p>'}</div>`;
}

async function mantenimiento(): Promise<string> {
  const ls = await llamar<any[]>('mantenimiento');
  return `<h1>Mantenimiento</h1>${ls.map(l => `<section class="po-tarjeta"><h2>${esc(l.nombre)}</h2><p class="po-nota">${esc(l.direccion ?? '')}</p>
    ${l.plan ? `<p>Plan <strong>${esc(l.plan)}</strong>${l.importe ? ` · ${eur(l.importe)} al mes + impuestos` : ''}${l.frecuencia ? ` · pago ${esc(String(l.frecuencia).toLowerCase())}` : ''}</p>
      <p>${chip(l.estado_pago ?? 'Sin datos', l.estado_pago === 'Al corriente' ? 'bien' : l.estado_pago ? 'aviso' : '')}${l.proxima_cuota ? ` <span class="po-nota">próxima cuota ${fecha(l.proxima_cuota)}</span>` : ''}</p>`
      : '<p class="po-nota">Sin contrato de mantenimiento.</p>'}</section>`).join('') || '<p class="po-nota">No hay sedes.</p>'}`;
}

async function equipos(): Promise<string> {
  const es = await llamar<any[]>('equipos');
  return `<h1>Estado de tus equipos</h1><p class="po-nota">Los equipos con nuestro agente de monitorización. Se actualiza cada pocos minutos.</p>
    <div class="po-tarjeta po-scroll">${es.length ? `<table class="po-tabla"><thead><tr><th>Equipo</th><th>Estado</th><th class="po-ocultable">Sede</th><th class="po-ocultable">Visto</th></tr></thead><tbody>
    ${es.map(e => `<tr><td>${esc(e.nombre || e.hostname)}<br><small class="po-nota">${esc(e.so ?? '')}</small></td>
      <td>${e.conectado ? chip('Conectado', 'bien') : chip('Sin conexión', 'mal')}${e.alertas_abiertas ? ` ${chip(`${pl(e.alertas_abiertas, 'alerta', 'alertas')}`, 'aviso')}` : ''}${e.reinicio_pendiente ? ` ${chip('Reinicio pendiente', 'aviso')}` : ''}</td>
      <td class="po-ocultable">${esc(e.sede)}</td><td class="po-ocultable">${fechaHora(e.visto_ultimo)}</td></tr>`).join('')}
  </tbody></table>` : '<p class="po-nota">Todavía no hay equipos monitorizados.</p>'}</div>`;
}

async function pintar() {
  const [sec = 'inicio', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const cuerpo = document.getElementById('po-cuerpo');
  if (!cuerpo) return;
  document.querySelectorAll('.po-menu a').forEach(a => a.classList.toggle('activo', a.getAttribute('href') === `#/${sec === 'nuevo' ? 'tickets' : sec}`));
  cuerpo.innerHTML = '<p class="po-cargando">Cargando…</p>';
  try {
    cuerpo.innerHTML = sec === 'tickets' && arg ? await ticket(arg) : sec === 'tickets' ? await tickets() : sec === 'nuevo' ? await nuevo()
      : sec === 'presupuestos' ? await presupuestos() : sec === 'facturas' ? await facturas() : sec === 'mantenimiento' ? await mantenimiento()
        : sec === 'equipos' ? await equipos() : await inicio();
  } catch (e) { if (leerToken()) cuerpo.innerHTML = `<p class="po-mal">${esc((e as Error).message)}</p>`; }
}

function marco() {
  raiz.innerHTML = `<header class="po-cab"><span class="po-marca">Ok Computer Tenerife</span><span class="po-nota">${esc(_yo?.email ?? '')}</span>
      <button class="po-btn sec" id="po-salir">Salir</button></header>
    <nav class="po-menu" aria-label="Secciones">${SECCIONES.map(([k, t]) => `<a href="#/${k}">${t}</a>`).join('')}</nav>
    <main id="po-cuerpo"></main>`;
  document.getElementById('po-salir')!.addEventListener('click', async () => { await llamar('salir').catch(() => {}); guardarToken(null); pantallaEntrar(); });
  // Delegación de los botones y formularios de las pantallas.
  raiz.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.pdf) {
      b.disabled = true;
      try {
        const res = await fetch(`${FUNCIONES_URL}/portal`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, 'x-portal-token': leerToken() ?? '' },
          body: JSON.stringify({ accion: 'pdf', tipo: b.dataset.pdf, id: b.dataset.id }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'No se pudo descargar');
        const url = URL.createObjectURL(await res.blob());
        const a = Object.assign(document.createElement('a'), { href: url, download: `${b.dataset.pdf}.pdf` });
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) { aviso((err as Error).message); }
      b.disabled = false;
    } else if (b.dataset.aceptar) {
      const nombre = prompt(`Para aceptar el presupuesto ${b.dataset.num ?? ''}, escribe tu nombre y apellidos:`);
      if (!nombre) return;
      try { await llamar('presupuesto_aceptar', { id: b.dataset.aceptar, nombre }); aviso('¡Gracias! Hemos recibido tu aceptación y nos ponemos en marcha.'); pintar(); }
      catch (err) { aviso((err as Error).message); }
    }
  });
  raiz.addEventListener('submit', async e => {
    const f = e.target as HTMLFormElement;
    e.preventDefault();
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
    try {
      if (f.id === 'po-form-nuevo') {
        const r = await llamar('ticket_crear', { titulo: val('po-titulo'), descripcion: val('po-desc'), local_id: val('po-sede') || null });
        aviso(`Aviso #${r.numero} recibido. Te contestamos lo antes posible.`); location.hash = `#/tickets/${r.numero}`;
      } else if (f.id === 'po-form-msg') {
        const n = location.hash.split('/')[2];
        await llamar('ticket_mensaje', { numero: n, texto: val('po-msg') }); aviso('Mensaje enviado'); pintar();
      }
    } catch (err) { aviso((err as Error).message); }
  });
}

async function arrancar() {
  const codigo = new URLSearchParams(location.search).get('c');
  if (codigo) {
    history.replaceState(null, '', location.pathname + location.hash);
    try { const r = await llamar<{ token: string }>('entrar', { codigo }); guardarToken(r.token); }
    catch (e) { pantallaEntrar((e as Error).message); return; }
  }
  if (!leerToken()) { pantallaEntrar(); return; }
  try { _yo = await llamar('yo'); } catch { return; }
  marco();
  window.addEventListener('hashchange', pintar);
  pintar();
}
arrancar();
