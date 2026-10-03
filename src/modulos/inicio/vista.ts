// Portada «Oki»: el centro de mando del hub. Oki en el centro, unido por
// circuitos a seis áreas (cada una con el `contador()` de su pantalla), las
// estadísticas de la semana del Desk, lo que Oki ve (los avisos de
// hub.panorama_direccion, el ÚNICO motor de avisos) y, debajo, todas las
// pantallas en baldosas como antes. Diseño: lienzo «Oki · Centro de mando»,
// tablero «1 + 4 · Flujo de Oki en blanco» (2026-10-02); el resto del tablero
// (2026-10-03): cabecera con el estado del sync y la campana de avisos, la voz
// de Oki y las órdenes rápidas a la izquierda, «Trabajos completados», los
// botones de «Oki dice» y el pie con «Hablar con Oki» y el repaso de la mañana.
// La voz: lo dictado que suena a pregunta va al buscador (#/buscar); un
// encargo se reparte como comanda, pero solo tras confirmarlo (avisa al equipo).
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { modulos, ir } from '../../core/router';
import { registrarAcciones } from '../../core/dispatcher';
import { htmlTelegram } from '../informes/index';
import { grabando, grabarYTranscribir, pararGrabacion, puedeDictar } from '../../ui/dictado';
import { esAdmin, usuario } from '../../core/estado';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace } from '../../ui/dom';

interface Aviso {
  clave: string; tipo: string; gravedad: 'mal' | 'aviso' | 'info'; titulo: string; detalle: string | null;
  enlace: string | null; dinero: boolean;
}
interface TicketMin {
  id: string; estado: string; created_at: string; cerrado_at: string | null;
  sla_respuesta_at: string | null; primera_respuesta_at: string | null;
}

// Las seis áreas del diagrama: posición del centro de la tarjeta en el lienzo
// de 860 × 620 y el módulo cuyo contador pinta su dato.
const AREAS: { id: string; titulo: string; x: number; y: number; icono: string; puertos: 'izq' | 'der' | 'dos' }[] = [
  { id: 'tickets', titulo: 'Desk', x: 100, y: 100, puertos: 'der', icono: '<path d="M3 7h18v3a2 2 0 000 4v3H3v-3a2 2 0 000-4z" class="r"/><path d="M14 7v10" stroke-dasharray="2 2"/>' },
  { id: 'monitorizacion', titulo: 'Equipos · Breeze', x: 100, y: 310, puertos: 'dos', icono: '<rect x="3" y="4" width="18" height="12" rx="2" class="r"/><path d="M8 20h8M12 16v4"/><path d="M7 11l2.5-2.5 2.5 2 3-3.5" class="a"/>' },
  { id: 'whatsapp', titulo: 'WhatsApp', x: 100, y: 520, puertos: 'der', icono: '<path d="M4 5h16v11H9l-5 4z" class="r"/><path d="M8 9h8M8 12h5"/>' },
  { id: 'calendario', titulo: 'Agenda', x: 760, y: 100, puertos: 'izq', icono: '<rect x="3" y="5" width="18" height="16" rx="2" class="r"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4" class="a"/>' },
  { id: 'oportunidades', titulo: 'Ventas', x: 760, y: 310, puertos: 'dos', icono: '<rect x="4" y="13" width="4" height="7" class="r"/><rect x="10" y="9" width="4" height="11" class="r"/><rect x="16" y="5" width="4" height="15" class="v"/>' },
  { id: 'wiki', titulo: 'Wiki y buscador', x: 760, y: 520, puertos: 'izq', icono: '<path d="M4 5a2 2 0 012-2h13v15H6a2 2 0 00-2 2z" class="r"/><path d="M4 20a2 2 0 002 1h13v-3"/><path d="M9 8h6M9 11h4"/>' },
];

// Circuitos: de la tarjeta al hexágono de Oki (y su largo, para el pulso).
const CIRCUITOS: [string, number][] = [
  ['M144 100 H220 Q236 100 236 116 V270 Q236 286 252 286 H340', 368],
  ['M144 310 H340', 196],
  ['M144 520 H220 Q236 520 236 504 V350 Q236 334 252 334 H340', 368],
  ['M716 100 H640 Q624 100 624 116 V270 Q624 286 608 286 H520', 368],
  ['M716 310 H520', 196],
  ['M716 520 H640 Q624 520 624 504 V350 Q624 334 608 334 H520', 368],
  ['M0 310 H56', 56], ['M804 310 H860', 56], ['M430 415 V620', 205],
];
const NODOS: [number, number][] = [[236, 193], [250, 310], [236, 427], [624, 193], [610, 310], [624, 427], [430, 530]];
const hexPts = (r: number) => [[0, -r], [r * .866, -r / 2], [r * .866, r / 2], [0, r], [-r * .866, r / 2], [-r * .866, -r / 2]].map(p => p.join(',')).join(' ');
const pct = (v: number, de: number) => `${(v / de * 100).toFixed(3)}%`;

function celdasOki(): string {
  const c: [number, number][] = [[50, 50], [70.8, 50], [60.4, 68], [39.6, 68], [29.2, 50], [39.6, 32], [60.4, 32]];
  return c.map(([x, y], i) => `<polygon transform="translate(${x} ${y})" points="${hexPts(10)}" style="animation-delay:${(i * .3).toFixed(1)}s"/>`).join('');
}

function diagrama(): string {
  return `<div class="ok-escena">
    <svg viewBox="0 0 860 620" class="ok-escena-svg" aria-hidden="true">
      <defs><pattern id="ok-puntos" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.1" class="ok-punto"/></pattern></defs>
      <rect width="860" height="620" fill="url(#ok-puntos)"/>
      <g class="ok-cable">${CIRCUITOS.map(([d]) => `<path d="${d}"/>`).join('')}</g>
      <g class="ok-flujo">${CIRCUITOS.map(([d, l], i) => `<path d="${d}" style="--l:${l}px;animation-duration:${(2 + (l / 180) + (i % 3) * .4).toFixed(1)}s;animation-delay:${(i * .37 % 1.6).toFixed(2)}s"/>`).join('')}</g>
      <polygon class="ok-giro" points="430,180 543.6,245 543.6,375 430,440 316.4,375 316.4,245"/>
      <polygon class="ok-halo" points="430,194 531.5,252 531.5,368 430,426 328.5,368 328.5,252"/>
      <g class="ok-nodos">${NODOS.map(([x, y], i) => `<polygon transform="translate(${x} ${y})" points="${hexPts(7)}" style="animation-delay:${(i * .4).toFixed(1)}s"/>`).join('')}</g>
    </svg>
    <div class="ok-cerebro" style="left:${pct(340, 860)};top:${pct(206, 620)}">
      <div class="ok-cerebro-in">
        <svg viewBox="0 0 100 100" class="ok-celdas" aria-hidden="true">${celdasOki()}</svg>
        <b>OKI</b>
        <small><span class="hex-punto pulso" aria-hidden="true"></span>EN MARCHA</small>
      </div>
    </div>
    ${AREAS.map(a => `
      <${a.id === 'whatsapp' ? 'button type="button" data-action="waAlternar"' : `a href="#/${a.id}"`} class="ok-area" id="ok-area-${a.id}"
         style="left:${pct(a.x - 44, 860)};top:${pct(a.y - 44, 620)}" aria-label="${esc(a.titulo)}">
        ${a.puertos !== 'der' ? '<span class="ok-puerto izq"></span>' : ''}${a.puertos !== 'izq' ? '<span class="ok-puerto der"></span>' : ''}
        <svg viewBox="0 0 24 24" class="ok-area-ico" aria-hidden="true">${a.icono}</svg>
      </${a.id === 'whatsapp' ? 'button' : 'a'}>
      <div class="ok-etq" style="left:${pct(a.x - 85, 860)};top:${pct(a.y + 52, 620)}">
        <b>${esc(a.titulo)}</b><small id="ok-dato-${a.id}">…</small>
      </div>`).join('')}
  </div>`;
}

export async function pintar(el: HTMLElement, baldosas: string) {
  const u = usuario();
  const nombre = u?.nombre?.split(' ')[0] ?? '';
  const h = new Date().getHours();
  const saludo = h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  el.innerHTML = `<div class="ok-portada">
    <header class="ok-cab">
      <h2>${saludo}${nombre ? `, ${esc(nombre)}` : ''}.</h2>
      <span class="ok-estado" id="ok-estado" title="Sincronización con la app"><span>Estado</span><span class="hex-punto pulso" aria-hidden="true"></span><b>…</b></span>
      <span class="ok-reloj"><span id="ok-fecha"></span><b id="ok-hora"></b></span>
      <details class="ok-campana" id="ok-campana">
        <summary aria-label="Avisos de Oki"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0"/></svg><span class="ok-campana-n" id="ok-campana-n" hidden></span></summary>
        <div class="ok-campana-menu" role="menu"><div class="ok-campana-cab"><b>Avisos de Oki</b><a href="#/direccion">Ver todos</a></div><div id="ok-campana-lista"><p class="cargando">Cargando…</p></div></div>
      </details>
    </header>
    <div class="ok-cuerpo">
    <aside class="ok-lateral">
      <section class="ok-panel ok-voz" id="ok-voz">
        <div class="ok-ph"><span class="hex-punto" aria-hidden="true"></span><h3>Voz de Oki</h3><span class="ok-ph-l"></span></div>
        <div class="ok-ola" aria-hidden="true">${ola(24)}</div>
        <p class="ok-voz-estado" id="ok-voz-estado" aria-live="polite">${puedeDictar() ? 'Pulsa para hablar' : 'Este navegador no deja grabar audio'}</p>
        <div class="ok-voz-hex"><span class="ok-anillo"></span><span class="ok-anillo d2"></span>
          <button type="button" class="ok-voz-btn" id="ok-voz-btn" data-action="okHablar" aria-label="Hablar con Oki" aria-pressed="false" ${puedeDictar() ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button></div>
        <div class="ok-voz-res" id="ok-voz-res"></div>
      </section>
      <section class="ok-panel ok-ordenes">
        <div class="ok-ph"><span class="hex-punto" aria-hidden="true"></span><h3>Órdenes rápidas</h3><span class="ok-ph-l"></span></div>
        ${ORDENES.map(o => o.href ? `<a class="ok-orden" href="${o.href}"><span aria-hidden="true">›</span>${esc(o.t)}</a>`
          : `<button type="button" class="ok-orden" data-action="${o.accion}"><span aria-hidden="true">›</span>${esc(o.t)}</button>`).join('')}
      </section>
    </aside>
    <div class="ok-principal">
    <div class="ok-fila1">
      <section class="ok-panel ok-diagrama">
        <div class="ok-ph"><span class="hex-punto" aria-hidden="true"></span><h3>Cómo trabaja Oki ahora</h3><span class="ok-ph-l"></span><span class="ok-ph-n">6 áreas · en vivo</span></div>
        ${diagrama()}
      </section>
      <section class="ok-panel ok-stats" id="ok-stats">
        <div class="ok-ph"><span class="hex-punto" aria-hidden="true"></span><h3>Estadísticas</h3><span class="ok-ph-l"></span><span class="ok-ph-n">Esta semana</span></div>
        <p class="cargando">Cargando…</p>
      </section>
    </div>
    <div class="ok-fila2">
      <section class="ok-dice" id="ok-dice"><p class="cargando">Oki está repasando los avisos…</p></section>
      <section class="ok-panel ok-persona" id="ok-persona">
        <div class="ok-ph"><span class="hex-punto mal" aria-hidden="true"></span><h3>Necesita a una persona</h3><span class="ok-ph-l"></span><span class="ok-ph-n" id="ok-persona-n"></span></div>
        <p class="cargando">Cargando…</p>
      </section>
    </div>
    </div>
    </div>
    <footer class="ok-pie">
      <div class="ok-pie-datos"><span class="ok-con"><small>Último sync con la app</small><b id="ok-sync">…</b></span></div>
      <button type="button" class="ok-hablar" id="ok-hablar" data-action="okHablar" ${puedeDictar() ? '' : 'disabled'}>
        <span class="ok-ola corta" aria-hidden="true">${ola(10)}</span>
        <span class="ok-hablar-txt"><b>Hablar con Oki</b><small id="ok-hablar-sub">Te escucho</small></span>
        <span class="ok-ola corta" aria-hidden="true">${ola(10)}</span></button>
      <button type="button" class="btn" data-action="okRepaso">Repaso de la mañana</button>
    </footer>
    <section class="ok-panel ok-repaso" id="ok-repaso" hidden></section>
    <section class="ok-todas"><h3>Todas las pantallas</h3>${baldosas}</section>
  </div>`;

  reloj(el);
  void estadoSync();
  void datosAreas();
  void estadisticas();
  void avisos();
}

// La onda del micrófono: barras de alto y retraso fijos (se mueve con CSS).
function ola(n: number): string {
  return Array.from({ length: n }, (_, i) => `<span style="--h:${30 + ((i * 37) % 70)}%;animation-delay:${((i * 0.13) % 1.2).toFixed(2)}s"></span>`).join('');
}

const ORDENES: { t: string; href?: string; accion?: string }[] = [
  { t: 'Mi lista de hoy', href: '#/lista-dia' },
  { t: 'Nuevo trabajo', href: '#/trabajos/nuevo' },
  { t: 'Nuevo ticket', href: '#/tickets/nuevo' },
  { t: 'Repartir una comanda', href: '#/comandas' },
  { t: 'Planificar la semana', href: '#/calendario' },
  { t: 'Preguntar a Oki', accion: 'abrirBuscador' },
];

// «Estado» de la cabecera y «Último sync» del pie: la última pasada buena del
// sync incremental con la app (hub.sync_estado, clave `audit`).
async function estadoSync() {
  const { data } = await API.get<{ clave: string; ultima_ok: string | null; ultimo_error_at: string | null }[]>('sync_estado', { select: 'clave,ultima_ok,ultimo_error_at' });
  const est = document.getElementById('ok-estado'), sync = document.getElementById('ok-sync');
  if (!est || !sync) return;
  const a = data?.find(x => x.clave === 'audit') ?? data?.[0];
  const ok = a?.ultima_ok ? new Date(a.ultima_ok).getTime() : 0;
  const enMarcha = !!ok && Date.now() - ok < 30 * 60000 && !(a?.ultimo_error_at && new Date(a.ultimo_error_at).getTime() > ok);
  est.classList.toggle('mal', !enMarcha);
  est.querySelector('b')!.textContent = enMarcha ? 'En marcha' : ok ? 'Sync con retraso' : 'Sin sync';
  sync.textContent = a?.ultima_ok ? hace(a.ultima_ok) : 'nunca';
}

function reloj(el: HTMLElement) {
  const pintarHora = () => {
    const f = document.getElementById('ok-fecha'), hh = document.getElementById('ok-hora');
    if (!f || !hh || !el.isConnected) { clearInterval(t); return; }
    const d = new Date();
    const fecha = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    f.textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
    hh.textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };
  const t = window.setInterval(pintarHora, 15000);
  pintarHora();
}

function ponDato(id: string, texto: string, tono?: string) {
  const s = document.getElementById(`ok-dato-${id}`);
  if (!s) return;
  s.textContent = texto;
  s.dataset.tono = tono ?? 'neutro';
}

async function datosAreas() {
  const mods = new Map<string, Modulo>(modulos().filter(m => !m.soloAdmin || esAdmin()).map(m => [m.id, m]));
  for (const a of AREAS) {
    if (a.id === 'whatsapp') continue;
    const m = mods.get(a.id);
    if (!m?.contador) { ponDato(a.id, '—'); continue; }
    m.contador().then((c: Contador | null) => ponDato(a.id, c ? `${c.valor} ${c.subtitulo ?? ''}`.trim() : '—', c?.tono))
      .catch(() => ponDato(a.id, '—'));
  }
  const { data } = await llamarFuncion<{ conversaciones: { pendiente: boolean }[] }>('whatsapp', { accion: 'conversaciones' }, 20000);
  if (!Array.isArray(data?.conversaciones)) { ponDato('whatsapp', 'sin conexión', 'aviso'); return; }
  const n = data!.conversaciones.filter(c => c.pendiente).length;
  ponDato('whatsapp', n ? `${n} por contestar` : 'todo contestado', n ? 'aviso' : 'bien');
}

function lunes(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

async function estadisticas() {
  const el = document.getElementById('ok-stats');
  if (!el) return;
  const ini = lunes();
  const hace30 = new Date(Date.now() - 30 * 86400000);
  const { data, error } = await API.get<TicketMin[]>('tickets', {
    select: 'id,estado,created_at,cerrado_at,sla_respuesta_at,primera_respuesta_at',
    or: `(created_at.gte.${hace30.toISOString()},cerrado_at.gte.${ini.toISOString()})`, limit: '2000',
  });
  if (!document.getElementById('ok-stats')) return;
  const cab = el.querySelector('.ok-ph')!.outerHTML;
  if (error || !data) { el.innerHTML = `${cab}<p class="aviso">No se pudieron leer los tickets: ${esc(error?.message)}</p>`; return; }

  const ahora = Date.now();
  const conSla = data.filter(t => t.sla_respuesta_at && new Date(t.created_at) >= hace30);
  const enPlazo = conSla.filter(t => t.primera_respuesta_at
    ? t.primera_respuesta_at <= t.sla_respuesta_at!
    : new Date(t.sla_respuesta_at!).getTime() > ahora).length;
  const fuera = conSla.length - enPlazo;
  const sla = conSla.length ? Math.round(enPlazo / conSla.length * 100) : null;
  const cerrados = data.filter(t => t.cerrado_at && new Date(t.cerrado_at) >= ini);
  const nuevos = data.filter(t => new Date(t.created_at) >= ini).length;
  const hoyIdx = (new Date().getDay() + 6) % 7;
  const porDia = Array.from({ length: 7 }, (_, i) => cerrados.filter(t => (new Date(t.cerrado_at!).getDay() + 6) % 7 === i).length);
  const max = Math.max(1, ...porDia);
  const off = `${sla == null ? 240 : (240 * (1 - sla / 100)).toFixed(1)}px`;
  const completados = await trabajosCompletados(ini);
  if (!document.getElementById('ok-stats')) return;

  el.innerHTML = `${cab}
    <p class="ok-titular"><b>${cerrados.length}</b> ${cerrados.length === 1 ? 'ticket cerrado' : 'tickets cerrados'} esta semana</p>
    <div class="ok-medidor">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon class="ok-med-ticks" points="50,2 91.6,26 91.6,74 50,98 8.4,74 8.4,26"/>
        <polygon class="ok-med-pista" points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30"/>
        <polygon class="ok-med-valor" points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30" style="--off:${off}"/>
      </svg>
      <div class="ok-med-txt">
        <b>${sla == null ? '—' : `${sla} %`}</b>
        <span>SLA de respuesta cumplido</span>
        <small class="${fuera ? 'mal' : ''}">${conSla.length ? (fuera ? `${fuera} fuera de plazo (30 días)` : 'ninguno fuera de plazo') : 'sin tickets con plazo'}</small>
      </div>
    </div>
    <div class="ok-fila-dato"><span>Tickets cerrados</span><b>${cerrados.length}</b></div>
    <div class="ok-fila-dato"><span>Tickets nuevos</span><b>${nuevos}</b></div>
    <a class="ok-fila-dato" href="#/trabajos"><span>Trabajos completados</span><b>${completados ?? '—'}</b></a>
    <div class="ok-barras" role="img" aria-label="Tickets cerrados por día esta semana: ${porDia.map((n, i) => `${'LMXJVSD'[i]} ${n}`).join(', ')}">
      <span class="ok-barras-tit">Tickets cerrados por día</span>
      <div class="ok-barras-fila">${porDia.map((n, i) => `<div class="ok-barra${i === hoyIdx ? ' hoy' : ''}">
        <small>${i > hoyIdx ? '' : n}</small><span style="--h:${i > hoyIdx ? 0 : Math.max(2, n / max * 100)}%"></span><em>${'LMXJVSD'[i]}</em></div>`).join('')}</div>
    </div>`;
}

// Trabajos que se terminaron esta semana: los que están completados (o ya
// para facturar o facturados) y cuyo último fichaje acabó desde el lunes. La
// app no guarda cuándo se completó un trabajo; el fin del fichaje es lo más fiel.
async function trabajosCompletados(desde: Date): Promise<number | null> {
  const { data, error } = await API.get<{ entidad_id: string }[]>('sesiones', { select: 'entidad_id', entidad_tipo: 'eq.trabajo', fin: `gte.${desde.toISOString()}`, limit: '1000' });
  if (error || !data) return null;
  const ids = [...new Set(data.map(x => x.entidad_id).filter(Boolean))];
  if (!ids.length) return 0;
  return API.contar('trabajos', { id: `in.(${ids.join(',')})`, estado: 'in.(Completado,"Para facturar",Facturado)' });
}

const ORDEN = { mal: 0, aviso: 1, info: 2 } as const;
const href = (a: Aviso) => (a.enlace?.startsWith('#/') ? a.enlace : '#/direccion');

async function avisos() {
  const { data, error } = await API.rpc<Aviso[]>('panorama_direccion');
  const dice = document.getElementById('ok-dice');
  const persona = document.getElementById('ok-persona');
  if (!dice || !persona) return;
  const cab = persona.querySelector('.ok-ph')!.outerHTML;
  if (error || !data) {
    dice.innerHTML = `<p class="aviso">Oki no ha podido leer los avisos: ${esc(error?.message)}</p>`;
    persona.innerHTML = cab;
    return;
  }
  const lista = [...data].sort((a, b) => ORDEN[a.gravedad] - ORDEN[b.gravedad]);
  const urgentes = lista.filter(a => a.gravedad !== 'info');
  document.getElementById('ok-persona-n')!.textContent = String(urgentes.length);
  const primero = urgentes[0];
  const n = document.getElementById('ok-campana-n'), campana = document.getElementById('ok-campana-lista');
  if (n) { n.hidden = !urgentes.length; n.textContent = String(urgentes.length); }
  if (campana) campana.innerHTML = urgentes.length
    ? urgentes.slice(0, 6).map(a => `<a class="ok-campana-op ${a.gravedad}" href="${esc(href(a))}" role="menuitem"><span class="hex-punto" aria-hidden="true"></span>
        <span><b>${esc(a.titulo)}</b>${a.detalle ? `<small>${esc(a.detalle)}</small>` : ''}</span></a>`).join('')
    : '<p class="vacio">Nada pendiente.</p>';
  // Si lo más urgente es un ticket, Oki se ofrece a redactar la respuesta
  // (#/tickets/<n>/responder): la redacta y una persona la manda.
  const ticket = primero?.enlace?.match(/^#\/tickets\/(\d+)$/)?.[1];
  dice.innerHTML = `
    <button type="button" class="ok-dice-btn" data-action="abrirBuscador" aria-label="Preguntar a Oki">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
    <div class="ok-dice-txt">
      <span class="ok-dice-et">Oki dice</span>
      <p>${primero
        ? `Hay ${urgentes.length === 1 ? 'una cosa que necesita' : `${urgentes.length} cosas que necesitan`} a una persona. Lo más urgente: <b>${esc(primero.titulo)}</b>${primero.detalle ? ` — ${esc(primero.detalle)}` : ''}.${ticket ? ' ¿Te redacto la respuesta?' : ''}`
        : 'Todo en orden: no hay nada pendiente que necesite a una persona.'}</p>
      <div class="acciones">
        ${ticket ? `<a class="btn" href="#/tickets/${ticket}/responder">Sí, contéstalo</a><a class="btn secundario" href="#/tickets/${ticket}">Lo miro yo</a>`
          : primero ? `<a class="btn" href="${esc(href(primero))}">Ir a lo más urgente</a>` : ''}
        <a class="btn secundario" href="#/direccion">Ver todos los avisos</a>
      </div>
    </div>`;
  persona.innerHTML = cab + (urgentes.length
    ? `<ul class="ok-lista">${urgentes.slice(0, 4).map(a => `<li class="ok-aviso ${a.gravedad}">
        <span class="hex-punto" aria-hidden="true"></span>
        <span class="ok-aviso-txt"><b>${esc(a.titulo)}</b>${a.detalle ? `<small>${esc(a.detalle)}</small>` : ''}</span>
        <a class="btn secundario" href="${esc(href(a))}">Abrir</a></li>`).join('')}</ul>
       ${urgentes.length > 4 ? `<a href="#/direccion">Y ${urgentes.length - 4} más en Dirección ›</a>` : ''}`
    : '<p class="vacio">Nada urgente. Buen trabajo.</p>');
}

// ── Voz de Oki ──────────────────────────────────────────────────────────────
// Suena a pregunta si acaba en «?», empieza por «¿» o por una palabra de
// pregunta o de buscar. Lo demás es un encargo para el equipo (comanda).
const PREGUNTA = new Set(['que', 'cual', 'cuales', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'cuando', 'donde', 'quien', 'quienes', 'como', 'por',
  'hay', 'tengo', 'tenemos', 'tiene', 'esta', 'estan', 'dime', 'busca', 'buscame', 'ensename', 'muestrame', 'sabes', 'cuentame']);
export function esPregunta(t: string): boolean {
  const s = t.trim();
  if (s.startsWith('¿') || s.endsWith('?')) return true;
  const w = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-zñ]+/)?.[0] ?? '';
  return PREGUNTA.has(w);
}

let _dicho = '';
function vozEstado(modo: 'quieto' | 'escucha' | 'pasa', texto: string) {
  const voz = document.getElementById('ok-voz'), pie = document.getElementById('ok-hablar');
  for (const e of [voz, pie]) { e?.classList.toggle('escuchando', modo === 'escucha'); e?.classList.toggle('pensando', modo === 'pasa'); }
  document.getElementById('ok-voz-btn')?.setAttribute('aria-pressed', String(modo === 'escucha'));
  const est = document.getElementById('ok-voz-estado'); if (est) est.textContent = texto;
  const sub = document.getElementById('ok-hablar-sub');
  if (sub) sub.textContent = modo === 'escucha' ? 'Escuchando… pulsa para acabar' : modo === 'pasa' ? 'Pasando a texto…' : 'Te escucho';
}

function vozResultado(html: string) {
  const r = document.getElementById('ok-voz-res');
  if (r) { r.innerHTML = html; r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// Ojo: el despachador desactiva el botón mientras dura una acción asíncrona,
// así que okHablar vuelve al momento y la escucha sigue aparte (si no, no se
// podría pulsar otra vez para parar).
async function escuchar() {
    vozResultado('');
    const r = await grabarYTranscribir({
      empieza: () => vozEstado('escucha', 'Escuchando…'),
      pasando: () => vozEstado('pasa', 'Pasando a texto…'),
    });
    vozEstado('quieto', puedeDictar() ? 'Pulsa para hablar' : '');
    if (!r.texto) { vozResultado(`<p class="nota">${esc(r.error ?? 'No se entendió nada')}</p>`); return; }
    _dicho = r.texto;
    if (esPregunta(r.texto)) { ir('buscar', r.texto); return; }
    vozResultado(`<p class="ok-dicho">«${esc(r.texto)}»</p>
      <p class="nota">Suena a un encargo para el equipo. ¿Lo reparto como comanda?</p>
      <div class="acciones"><button type="button" class="btn" data-action="okComanda">Repartir como comanda</button>
        <button type="button" class="btn secundario" data-action="okPreguntar">No, pregúntalo</button>
        <button type="button" class="btn secundario" data-action="okDescartar">Descartar</button></div>`);
}

registrarAcciones({
  okHablar() { if (grabando()) pararGrabacion(); else void escuchar(); },
  async okComanda() {
    if (!_dicho) return;
    vozResultado('<p class="nota"><span class="hex-punto pulso" aria-hidden="true"></span> Repartiendo…</p>');
    const r = await llamarFuncion<{ tareas: unknown[] }>('comandas', { accion: 'crear', texto: _dicho }, 120000);
    if (r.error || !r.data) { vozResultado(`<p class="nota">No se pudo repartir: ${esc(r.error)}</p>`); return; }
    _dicho = '';
    toast(`Comanda repartida en ${r.data.tareas.length} tarea(s)`);
    vozResultado(`<p class="nota">Repartida en ${r.data.tareas.length} tarea(s). <a href="#/comandas">Ver comandas ›</a></p>`);
  },
  okPreguntar() { if (_dicho) ir('buscar', _dicho); },
  okDescartar() { _dicho = ''; vozResultado(''); },
  // El repaso de la mañana (el mismo informe que llega por Telegram), aquí mismo.
  async okRepaso() {
    const caja = document.getElementById('ok-repaso');
    if (!caja) return;
    if (!caja.hidden) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.innerHTML = '<p class="cargando">Oki está preparando tu repaso…</p>';
    const r = await llamarFuncion<{ texto: string }>('informes-enviar', { accion: 'vista_previa', tipo: 'repaso_matinal' }, 60000);
    if (caja.hidden) return;
    caja.innerHTML = `<div class="ok-ph"><span class="hex-punto" aria-hidden="true"></span><h3>Repaso de la mañana</h3><span class="ok-ph-l"></span>
        <button type="button" class="icono-btn pequeno" data-action="okRepaso" aria-label="Cerrar el repaso">✕</button></div>
      ${r.error ? `<p class="aviso mal">${esc(r.error)}</p>` : `<div class="ok-repaso-txt">${htmlTelegram(r.data?.texto ?? '')}</div>`}
      <p class="nota">Programarlo o recibirlo por Telegram: <a href="#/informes">Informes y Telegram ›</a></p>`;
    caja.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
});
