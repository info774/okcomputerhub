// Portada «Oki»: el centro de mando del hub, a la manera de un puesto de
// mando (diseño «centro de mando», 2026-10-04): una barra arriba con la marca,
// el estado del sistema, el reloj grande, buscar, la campana de avisos y
// quién está al mando; en el centro Oki unido por circuitos a seis áreas (cada
// una con el `contador()` de su pantalla); a la izquierda el NÚCLEO (qué
// piezas de Oki están en marcha) y la voz; a la derecha los AVISOS EN VIVO
// (hub.panorama_direccion, el ÚNICO motor de avisos); debajo los AGENTES de
// Oki (sincronizador, trabajador de Claude, vigía de equipos, indexador, bot,
// oído), HOY EN LA AGENDA (los bloques de hoy del espejo `agenda`), las
// órdenes rápidas, el MONITOR del Desk (SLA y cerrados por día), la MEMORIA
// (wiki, documentos indexados, comandas) y las CONEXIONES (qué servicio está
// conectado); al pie, «Hablar con Oki» y el repaso de la mañana. Debajo de
// todo, las pantallas en baldosas como siempre.
// La voz: lo dictado que suena a pregunta va al buscador (#/buscar); un
// encargo se reparte como comanda, pero solo tras confirmarlo (avisa al equipo).
// Nada de aquí escribe: todo son lecturas del hub y de sus funciones.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { modulos } from '../../core/router';
import { registrarAcciones } from '../../core/dispatcher';
import { htmlTelegram } from '../informes/index';
import { puedeDictar } from '../../ui/dictado';
import { esAdmin, usuario } from '../../core/estado';
import { llamarFuncion } from '../../core/funciones';
import { esc, hace } from '../../ui/dom';
import { type Aviso, urgentesDe, hrefAviso, diceHTML, pintarEstadisticas, vozHTML, ordenesHTML, ola } from './piezas';

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
      <g class="ok-orbitas"><circle cx="430" cy="310" r="170"/><circle cx="430" cy="310" r="215"/><circle cx="430" cy="310" r="260"/></g>
      <g class="ok-cable">${CIRCUITOS.map(([d]) => `<path d="${d}"/>`).join('')}</g>
      <g class="ok-flujo">${CIRCUITOS.map(([d, l], i) => `<path d="${d}" style="--l:${l}px;animation-duration:${(2 + (l / 180) + (i % 3) * .4).toFixed(1)}s;animation-delay:${(i * .37 % 1.6).toFixed(2)}s"/>`).join('')}</g>
      <polygon class="ok-giro" points="430,180 543.6,245 543.6,375 430,440 316.4,375 316.4,245"/>
      <polygon class="ok-giro inverso" points="430,160 559.9,235 559.9,385 430,460 300.1,385 300.1,235"/>
      <polygon class="ok-halo" points="430,194 531.5,252 531.5,368 430,426 328.5,368 328.5,252"/>
      <g class="ok-nodos">${NODOS.map(([x, y], i) => `<polygon transform="translate(${x} ${y})" points="${hexPts(7)}" style="animation-delay:${(i * .4).toFixed(1)}s"/>`).join('')}</g>
    </svg>
    <div class="ok-cerebro" style="left:${pct(340, 860)};top:${pct(206, 620)}">
      <div class="ok-cerebro-in">
        <svg viewBox="0 0 100 100" class="ok-celdas" aria-hidden="true">${celdasOki()}</svg>
        <b>OKI</b>
        <span class="ok-cerebro-sub">Centro de mando</span>
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

// ── Cabecera de panel ───────────────────────────────────────────────────────
const cab = (titulo: string, extra = '', tono = '') =>
  `<div class="ok-ph"><span class="hex-punto${tono ? ` ${tono}` : ''}" aria-hidden="true"></span><h3>${titulo}</h3><span class="ok-ph-l"></span>${extra}</div>`;

// ── Iconos de línea (24 × 24, sin relleno) ──────────────────────────────────
const ICO: Record<string, string> = {
  oki: '<polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5"/><circle cx="12" cy="12" r="3"/>',
  memoria: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M4 9h4M4 15h4"/>',
  voz: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  claude: '<path d="M4 20l8-16 8 16M8 14h8"/>',
  conexiones: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  sistema: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  sync: '<path d="M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M18 4v5h-5M6 20v-5h5"/>',
  vigia: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  indexador: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21"/>',
  bot: '<path d="M21 4L3 11l7 2 2 7 9-16z"/>',
  oido: '<path d="M6 10a6 6 0 0112 0c0 4-3 4-3 8a3 3 0 01-6 0"/><path d="M9 10a3 3 0 016 0"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  buscar: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21"/>',
  campana: '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0"/>',
  red: '<path d="M2 9a14 14 0 0120 0M5.5 12.5a9 9 0 0113 0M9 16a4 4 0 016 0"/><circle cx="12" cy="19.5" r="1"/>',
  sitio: '<path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};
const ico = (n: string, cls = '') => `<svg viewBox="0 0 24 24" class="ok-ico${cls ? ` ${cls}` : ''}" aria-hidden="true">${ICO[n]}</svg>`;

// ── Núcleo de Oki: qué piezas están en marcha ───────────────────────────────
const NUCLEO: { id: string; t: string }[] = [
  { id: 'oki', t: 'Oki' }, { id: 'memoria', t: 'Memoria' }, { id: 'voz', t: 'Voz' },
  { id: 'claude', t: 'Claude' }, { id: 'conexiones', t: 'Conexiones' }, { id: 'sistema', t: 'Sistema' },
];
const nucleoHTML = () => `<ul class="ok-nuc">${NUCLEO.map(n => `<li class="ok-nuc-fila" id="ok-nuc-${n.id}" data-tono="neutro">
    <span class="hex ok-nuc-ico">${ico(n.id)}</span><span class="ok-nuc-txt"><b>${n.t}</b><small>…</small></span></li>`).join('')}</ul>`;

function ponNucleo(id: string, texto: string, tono: 'bien' | 'aviso' | 'mal' | 'neutro' = 'bien') {
  const li = document.getElementById(`ok-nuc-${id}`);
  if (!li) return;
  li.querySelector('small')!.textContent = texto;
  li.dataset.tono = tono;
}

// ── Agentes de Oki: los trabajadores automáticos ────────────────────────────
const AGENTES: { id: string; t: string; href: string }[] = [
  { id: 'sync', t: 'Sincronizador', href: '#/datos' },
  { id: 'claude', t: 'Trabajador de Claude', href: '#/proyectos' },
  { id: 'vigia', t: 'Vigía de equipos', href: '#/monitorizacion' },
  { id: 'indexador', t: 'Indexador', href: '#/buscar' },
  { id: 'bot', t: 'Bot de Telegram', href: '#/informes' },
  { id: 'oido', t: 'Oído de Oki', href: '#/comandas' },
];
const agentesHTML = () => `<div class="ok-agentes-rej">${AGENTES.map(a => `<a class="ok-agente" id="ok-ag-${a.id}" href="${a.href}" data-estado="reposo">
    <span class="hex ok-ag-ico">${ico(a.id)}</span>
    <span class="ok-ag-txt"><b>${esc(a.t)}</b><small><span class="hex-punto" aria-hidden="true"></span><span class="ok-ag-est">…</span></small></span>
    <span class="ok-ola corta" aria-hidden="true">${ola(9)}</span></a>`).join('')}</div>`;

function ponAgente(id: string, estado: 'activo' | 'espera' | 'reposo' | 'mal', texto: string) {
  const a = document.getElementById(`ok-ag-${id}`);
  if (!a) return;
  a.dataset.estado = estado;
  a.querySelector('.ok-ag-est')!.textContent = texto;
}

// ── Conexiones: qué servicio está conectado ─────────────────────────────────
const CONEXIONES: { id: string; t: string; href: string }[] = [
  { id: 'app', t: 'App actual', href: '#/datos' }, { id: 'zoho', t: 'Zoho Books', href: '#/datos' }, { id: 'breeze', t: 'Breeze', href: '#/monitorizacion' },
  { id: 'whatsapp', t: 'WhatsApp', href: '#/tickets' }, { id: 'telegram', t: 'Telegram', href: '#/informes' }, { id: 'correo', t: 'Correo del Desk', href: '#/tickets' },
  { id: 'drive', t: 'Google Drive', href: '#/buscar' }, { id: 'claude', t: 'Claude', href: '#/conector' }, { id: 'maps', t: 'Google Maps', href: '#/mapa' },
];
const conexionesHTML = () => `<div class="ok-conex-rej">${CONEXIONES.map(c => `<a class="ok-conx" id="ok-cx-${c.id}" href="${c.href}" data-tono="neutro">
    <span class="hex ok-conx-ini">${esc(c.t.charAt(0))}</span><span class="ok-conx-txt"><b>${esc(c.t)}</b><small>…</small></span></a>`).join('')}</div>`;

let _conectadas = 0;
function ponConexion(id: string, conectada: boolean | null, texto: string) {
  const a = document.getElementById(`ok-cx-${id}`);
  if (!a) return;
  a.dataset.tono = conectada == null ? 'neutro' : conectada ? 'bien' : 'aviso';
  a.querySelector('small')!.textContent = texto;
  if (conectada) _conectadas++;
  const n = document.getElementById('ok-conex-n');
  if (n) n.textContent = `${_conectadas} conectadas`;
  ponNucleo('conexiones', `${_conectadas} de ${CONEXIONES.length} conectadas`, _conectadas >= CONEXIONES.length - 2 ? 'bien' : 'aviso');
}

export async function pintar(el: HTMLElement, baldosas: string) {
  const u = usuario();
  const nombre = u?.nombre?.split(' ')[0] ?? '';
  const h = new Date().getHours();
  const saludo = h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  _conectadas = 0;
  el.innerHTML = `<div class="ok-portada">
    <header class="ok-cab">
      <a class="ok-marca" href="#/inicio" aria-label="Oki, centro de mando">
        <span class="hex" aria-hidden="true"><svg viewBox="0 0 100 100" class="ok-celdas" aria-hidden="true">${celdasOki()}</svg></span>
        <span class="ok-marca-txt"><b>OKI</b><small>Centro de mando</small></span></a>
      <span class="ok-estado" id="ok-estado" title="Sincronización con la app"><span>Estado del sistema</span><span class="hex-punto pulso" aria-hidden="true"></span><b>…</b></span>
      <span class="ok-reloj"><span id="ok-fecha"></span><b id="ok-hora"></b></span>
      <div class="ok-cab-der">
        <button type="button" class="ok-buscar" data-action="abrirBuscador" aria-label="Buscar o pedir algo">${ico('buscar')}<span class="btn-label">Buscar o pedir algo…</span><kbd>Ctrl K</kbd></button>
        <details class="ok-campana" id="ok-campana">
          <summary aria-label="Avisos de Oki">${ico('campana')}<span class="ok-campana-n" id="ok-campana-n" hidden></span></summary>
          <div class="ok-campana-menu" role="menu"><div class="ok-campana-cab"><b>Avisos de Oki</b><a href="#/direccion">Ver todos</a></div><div id="ok-campana-lista"><p class="cargando">Cargando…</p></div></div>
        </details>
        <a class="ok-operador" href="#/personas" title="${esc(u?.email ?? '')}">
          <span class="ok-operador-txt"><b>${esc(nombre || 'Operador')}</b><small>${saludo} · ${esAdmin() ? 'al mando' : 'técnico'}</small></span>
          <span class="hex ok-operador-ini" aria-hidden="true">${esc((nombre || 'O').charAt(0).toUpperCase())}</span></a>
      </div>
    </header>
    <div class="ok-cuerpo">
      <section class="ok-panel ok-nucleo" id="ok-nucleo">
        ${cab('Núcleo de Oki')}
        ${nucleoHTML()}
      </section>
      <section class="ok-panel ok-voz" data-voz="portada">
        ${vozHTML('portada', cab('Voz de Oki'))}
      </section>
      <section class="ok-panel ok-diagrama">
        ${cab('Cómo trabaja Oki ahora', '<span class="ok-ph-n">6 áreas · en vivo</span>')}
        ${diagrama()}
      </section>
      <section class="ok-panel ok-feed" id="ok-persona">
        ${cab('Avisos en vivo', '<span class="ok-ph-n ok-ph-vivo"><span class="hex-punto pulso" aria-hidden="true"></span>En vivo</span>', 'mal')}
        <p class="cargando">Cargando…</p>
      </section>
      <section class="ok-dice" id="ok-dice"><p class="cargando">Oki está repasando los avisos…</p></section>
      <section class="ok-panel ok-agentes" id="ok-agentes">
        ${cab('Agentes de Oki', '<a class="ok-ph-enlace" href="#/datos">Ver todo ›</a>')}
        ${agentesHTML()}
      </section>
      <section class="ok-panel ok-agenda" id="ok-agenda">
        ${cab('Hoy en la agenda', '<span class="ok-ph-n">Hoy</span>')}
        <p class="cargando">Cargando…</p>
      </section>
      <section class="ok-panel ok-ordenes">
        ${cab('Órdenes rápidas')}
        ${ordenesHTML()}
      </section>
      <section class="ok-panel ok-stats" id="ok-stats">
        ${cab('Monitor del Desk', '<span class="ok-ph-n">Esta semana</span>')}
        <p class="cargando">Cargando…</p>
      </section>
      <section class="ok-panel ok-memoria" id="ok-memoria">
        ${cab('Memoria de Oki')}
        <p class="cargando">Cargando…</p>
      </section>
      <section class="ok-panel ok-conex" id="ok-conex">
        ${cab('Conexiones', '<span class="ok-ph-n" id="ok-conex-n">…</span>')}
        ${conexionesHTML()}
        <a class="ok-conex-pie" href="#/datos">Datos y sincronización ›</a>
      </section>
    </div>
    <footer class="ok-pie">
      <div class="ok-pie-datos">
        <span class="ok-con">${ico('sitio')}<span><small>Tenerife</small><b id="ok-pie-hora">…</b></span></span>
        <span class="ok-con">${ico('sync')}<span><small>Último sync con la app</small><b id="ok-sync">…</b></span></span>
        <span class="ok-con" id="ok-red">${ico('red')}<span><small>Red</small><b>${navigator.onLine ? 'En línea' : 'Sin conexión'}</b></span></span>
      </div>
      <span class="ok-pie-puntos" aria-hidden="true"></span>
      <button type="button" class="ok-hablar" data-voz="portada" data-action="okHablar" data-p0="portada" ${puedeDictar() ? '' : 'disabled'}>
        <span class="ok-ola corta" aria-hidden="true">${ola(10)}</span>
        <span class="ok-hablar-txt"><b>Hablar con Oki</b><small class="ok-hablar-sub" data-voz="portada">Te escucho</small></span>
        <span class="ok-ola corta" aria-hidden="true">${ola(10)}</span></button>
      <span class="ok-pie-puntos" aria-hidden="true"></span>
      <button type="button" class="btn secundario ok-repaso-btn" data-action="okRepaso">Repaso de la mañana</button>
    </footer>
    <section class="ok-panel ok-repaso" id="ok-repaso" hidden></section>
    <section class="ok-todas"><h3>Todas las pantallas</h3>${baldosas}</section>
  </div>`;

  reloj(el);
  red(el);
  ponNucleo('voz', puedeDictar() ? 'Lista para escuchar' : 'Este navegador no graba', puedeDictar() ? 'bien' : 'aviso');
  ponAgente('oido', puedeDictar() ? 'activo' : 'reposo', puedeDictar() ? 'Escuchando órdenes' : 'Sin micrófono');
  ponConexion('maps', true, 'Clave puesta');
  void estadoSync();
  void datosAreas();
  void estadisticas();
  void avisos();
  void agentes();
  void agendaHoy();
  void memoria();
  void conexiones();
}

// ── Estado, reloj y red ─────────────────────────────────────────────────────
interface SyncEstado { clave: string; ultima_ok: string | null; ultimo_error_at: string | null; ultimo_error?: string | null }
let _sync: Promise<SyncEstado[]> | null = null;
const syncEstados = () => (_sync ??= API.get<SyncEstado[]>('sync_estado', { select: 'clave,ultima_ok,ultimo_error_at,ultimo_error' })
  .then(r => r.data ?? []).finally(() => { setTimeout(() => { _sync = null; }, 60000); }));
const bien = (e: SyncEstado | undefined) => !!e?.ultima_ok && !(e.ultimo_error_at && e.ultimo_error_at > e.ultima_ok);

// «Estado del sistema» de la cabecera y «Último sync» del pie: la última
// pasada buena del sync incremental con la app (hub.sync_estado, clave `audit`).
async function estadoSync() {
  const data = await syncEstados();
  const est = document.getElementById('ok-estado'), sync = document.getElementById('ok-sync');
  if (!est || !sync) return;
  const a = data.find(x => x.clave === 'audit') ?? data[0];
  const ok = a?.ultima_ok ? new Date(a.ultima_ok).getTime() : 0;
  const enMarcha = !!ok && Date.now() - ok < 30 * 60000 && bien(a);
  est.classList.toggle('mal', !enMarcha);
  est.querySelector('b')!.textContent = enMarcha ? 'En marcha' : ok ? 'Sync con retraso' : 'Sin sync';
  sync.textContent = a?.ultima_ok ? hace(a.ultima_ok) : 'nunca';
  ponNucleo('oki', enMarcha ? 'En marcha' : ok ? 'Datos con retraso' : 'Sin datos de la app', enMarcha ? 'bien' : 'aviso');
  ponAgente('sync', enMarcha ? 'activo' : ok ? 'mal' : 'reposo', a?.ultima_ok ? `Última pasada ${hace(a.ultima_ok)}` : 'Sin pasadas');
  ponConexion('app', enMarcha, enMarcha ? 'Conectada' : ok ? 'Con retraso' : 'Sin conectar');
}

function reloj(el: HTMLElement) {
  const pintarHora = () => {
    const f = document.getElementById('ok-fecha'), hh = document.getElementById('ok-hora'), ph = document.getElementById('ok-pie-hora');
    if (!f || !hh || !el.isConnected) { clearInterval(t); return; }
    const d = new Date();
    const fecha = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    f.textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
    hh.textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (ph) ph.textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };
  const t = window.setInterval(pintarHora, 1000);
  pintarHora();
}

function red(el: HTMLElement) {
  const pintarRed = () => {
    const r = document.getElementById('ok-red');
    if (!r || !el.isConnected) { window.removeEventListener('online', pintarRed); window.removeEventListener('offline', pintarRed); return; }
    r.querySelector('b')!.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
    r.classList.toggle('mal', !navigator.onLine);
  };
  window.addEventListener('online', pintarRed);
  window.addEventListener('offline', pintarRed);
}

// ── Las seis áreas del diagrama ─────────────────────────────────────────────
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
  const { data } = await llamarFuncion<{ conversaciones: { pendiente: boolean }[]; envio?: boolean }>('whatsapp', { accion: 'conversaciones' }, 20000);
  if (!Array.isArray(data?.conversaciones)) { ponDato('whatsapp', 'sin conexión', 'aviso'); ponConexion('whatsapp', false, 'Sin conexión'); return; }
  const n = data!.conversaciones.filter(c => c.pendiente).length;
  ponDato('whatsapp', n ? `${n} por contestar` : 'todo contestado', n ? 'aviso' : 'bien');
  ponConexion('whatsapp', data!.envio !== false, data!.envio === false ? 'Sin token de envío' : n ? `${n} por contestar` : 'Conectado');
}

async function estadisticas() {
  const el = document.getElementById('ok-stats');
  if (el) await pintarEstadisticas(el, el.querySelector('.ok-ph')!.outerHTML);
}

// ── Avisos en vivo, Oki dice y la campana ───────────────────────────────────
const GRAVEDAD = { mal: 'Urgente', aviso: 'Atento', info: 'Para saber' } as const;

async function avisos() {
  const { data, error } = await API.rpc<Aviso[]>('panorama_direccion');
  const dice = document.getElementById('ok-dice');
  const persona = document.getElementById('ok-persona');
  if (!dice || !persona) return;
  const cabecera = persona.querySelector('.ok-ph')!.outerHTML;
  if (error || !data) {
    dice.innerHTML = `<p class="aviso">Oki no ha podido leer los avisos: ${esc(error?.message)}</p>`;
    persona.innerHTML = cabecera;
    ponNucleo('sistema', 'Sin leer los avisos', 'aviso');
    return;
  }
  const urgentes = urgentesDe(data);
  const graves = urgentes.filter(a => a.gravedad === 'mal').length;
  ponNucleo('sistema', graves ? `${graves} ${graves === 1 ? 'urgente' : 'urgentes'}` : urgentes.length ? `${urgentes.length} por atender` : 'Todo en orden', graves ? 'mal' : urgentes.length ? 'aviso' : 'bien');
  const n = document.getElementById('ok-campana-n'), campana = document.getElementById('ok-campana-lista');
  if (n) { n.hidden = !urgentes.length; n.textContent = String(urgentes.length); }
  if (campana) campana.innerHTML = urgentes.length
    ? urgentes.slice(0, 6).map(a => `<a class="ok-campana-op ${a.gravedad}" href="${esc(hrefAviso(a))}" role="menuitem"><span class="hex-punto" aria-hidden="true"></span>
        <span><b>${esc(a.titulo)}</b>${a.detalle ? `<small>${esc(a.detalle)}</small>` : ''}</span></a>`).join('')
    : '<p class="vacio">Nada pendiente.</p>';
  dice.innerHTML = diceHTML(urgentes);
  // El feed: lo que necesita a una persona y, detrás, lo informativo.
  const feed = [...urgentes, ...data.filter(a => a.gravedad === 'info')];
  persona.innerHTML = cabecera + (feed.length
    ? `<ul class="ok-lista">${feed.slice(0, 7).map(a => `<li class="ok-aviso ${a.gravedad}">
        <span class="hex-punto" aria-hidden="true"></span>
        <a class="ok-aviso-txt" href="${esc(hrefAviso(a))}"><b>${esc(a.titulo)}</b>${a.detalle ? `<small>${esc(a.detalle)}</small>` : ''}</a>
        <span class="ok-insignia ${a.gravedad}">${GRAVEDAD[a.gravedad]}</span></li>`).join('')}</ul>
       <a class="ok-feed-pie" href="#/direccion">Ver todos los avisos ›</a>`
    : `<p class="vacio">Nada pendiente. Buen trabajo.</p><a class="ok-feed-pie" href="#/direccion">Puesto de mando ›</a>`);
}

// ── Agentes ─────────────────────────────────────────────────────────────────
async function agentes() {
  const [enCurso, pendientes, equipos, conectados, pendDocs, indexados, informes, vinculos] = await Promise.all([
    API.contar('claude_peticiones', { estado: 'eq.en_curso' }),
    API.contar('claude_peticiones', { estado: 'eq.pendiente' }),
    API.contar('rmm_equipos'),
    API.contar('rmm_equipos', { conectado: 'eq.true' }),
    API.contar('documentos', { estado: 'eq.pendiente' }),
    API.contar('documentos', { estado: 'eq.indexado' }),
    API.contar('informes_programados', { activo: 'eq.true' }),
    API.contar('telegram_vinculos', { activo: 'eq.true', chat_id: 'not.is.null' }),
  ]);
  ponAgente('claude', enCurso ? 'activo' : pendientes ? 'espera' : 'reposo',
    enCurso ? `Trabajando en ${enCurso} ${enCurso === 1 ? 'petición' : 'peticiones'}` : pendientes ? `${pendientes} en cola` : 'Sin peticiones');
  ponNucleo('claude', enCurso ? `${enCurso} en curso` : pendientes ? `${pendientes} en cola` : 'Libre', enCurso ? 'bien' : pendientes ? 'aviso' : 'neutro');
  ponAgente('vigia', equipos == null ? 'mal' : equipos ? 'activo' : 'reposo',
    equipos == null ? 'Sin leer Breeze' : equipos ? `${conectados ?? '?'} de ${equipos} equipos en línea` : 'Sin equipos');
  ponConexion('breeze', equipos == null ? null : equipos > 0, equipos == null ? 'Sin acceso' : equipos ? `${equipos} equipos` : 'Sin equipos');
  ponAgente('indexador', pendDocs ? 'activo' : 'reposo', pendDocs ? `Indexando ${pendDocs}` : `Al día · ${indexados ?? 0} documentos`);
  ponNucleo('memoria', `${indexados ?? 0} documentos indexados`, indexados ? 'bien' : 'neutro');
  ponAgente('bot', informes ? 'activo' : vinculos ? 'espera' : 'reposo', informes ? `${informes} ${informes === 1 ? 'informe programado' : 'informes programados'}` : vinculos ? 'Vinculado, sin informes' : 'Sin vincular');
  ponConexion('telegram', !!vinculos, vinculos ? `${vinculos} ${vinculos === 1 ? 'persona' : 'personas'}` : 'Sin vincular');
}

// ── Hoy en la agenda: los bloques de hoy del espejo `agenda` ────────────────
interface Bloque { id: string; titulo: string | null; inicio: string; fin: string | null; tecnicos: string[] | string | null; estado: string | null; trabajo_id: string | null; todo_el_dia?: boolean }

function cuando(b: Bloque, ahora: number): { t: string; clase: string } {
  const ini = new Date(b.inicio).getTime(), fin = b.fin ? new Date(b.fin).getTime() : ini + 3600000;
  if (fin < ahora) return { t: 'Hecho', clase: 'hecho' };
  if (ini <= ahora) return { t: 'Ahora', clase: 'ahora' };
  const min = Math.round((ini - ahora) / 60000);
  return { t: min < 60 ? `En ${min} min` : `En ${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim(), clase: '' };
}

async function agendaHoy() {
  const el = document.getElementById('ok-agenda');
  if (!el) return;
  const cabecera = el.querySelector('.ok-ph')!.outerHTML;
  const d = new Date().toLocaleDateString('sv-SE');
  const { data, error } = await API.get<Bloque[]>('agenda', {
    select: 'id,titulo,inicio,fin,tecnicos,estado,trabajo_id,todo_el_dia',
    and: `(inicio.lte.${new Date(`${d}T23:59:59`).toISOString()},fin.gte.${new Date(`${d}T00:00:00`).toISOString()})`,
    order: 'inicio', limit: '8',
  });
  if (!el.isConnected) return;
  if (error || !data) { el.innerHTML = `${cabecera}<p class="aviso">No se pudo leer la agenda: ${esc(error?.message)}</p>`; return; }
  const ahora = Date.now();
  el.innerHTML = cabecera + (data.length
    ? `<ol class="ok-hitos">${data.map(b => {
      const c = cuando(b, ahora);
      const tec = Array.isArray(b.tecnicos) ? b.tecnicos.join(', ') : b.tecnicos ?? '';
      return `<li class="ok-hito ${c.clase}">
        <time>${b.todo_el_dia ? 'Día' : new Date(b.inicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</time>
        <span class="ok-hito-raya" aria-hidden="true"><i></i></span>
        <a class="ok-hito-txt" href="${b.trabajo_id ? `#/trabajos/${esc(b.trabajo_id)}` : '#/calendario'}"><b>${esc(b.titulo || 'Sin título')}</b>${tec ? `<small>${esc(tec)}</small>` : ''}</a>
        <em>${c.t}</em></li>`;
    }).join('')}</ol>`
    : '<p class="vacio">Nada en la agenda de hoy.</p>')
    + '<a class="ok-feed-pie" href="#/calendario">Ver el calendario ›</a>';
}

// ── Memoria de Oki ──────────────────────────────────────────────────────────
function lunes(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
}

// La constelación: documentos indexados por día en las dos últimas semanas,
// como puntos unidos (una serie, --serie-1).
function constelacion(porDia: number[]): string {
  const w = 240, h = 70, max = Math.max(1, ...porDia);
  const pts = porDia.map((n, i) => [8 + i * ((w - 16) / (porDia.length - 1)), h - 8 - (n / max) * (h - 20)] as [number, number]);
  return `<svg viewBox="0 0 ${w} ${h}" class="ok-constelacion" role="img" aria-label="Documentos indexados por día, dos semanas: ${porDia.join(', ')}">
    <polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>
    ${pts.map(([x, y], i) => `<polygon transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" points="${hexPts(porDia[i] ? 4 : 2.5)}" class="${porDia[i] ? 'con' : ''}"/>`).join('')}
  </svg>`;
}

async function memoria() {
  const el = document.getElementById('ok-memoria');
  if (!el) return;
  const cabecera = el.querySelector('.ok-ph')!.outerHTML;
  const hace14 = new Date(Date.now() - 13 * 86400000); hace14.setHours(0, 0, 0, 0);
  const [paginas, indexados, comandas, proyectos, docs] = await Promise.all([
    API.contar('paginas', { archivada: 'eq.false' }),
    API.get<{ fragmentos: number }[]>('documentos', { select: 'fragmentos', estado: 'eq.indexado', limit: '1000' }),
    API.contar('comanda_tareas', { estado: 'eq.hecha', hecha_at: `gte.${lunes()}` }),
    API.contar('proyectos', { estado: 'neq.cerrado' }),
    API.get<{ indexado_at: string | null }[]>('documentos', { select: 'indexado_at', estado: 'eq.indexado', indexado_at: `gte.${hace14.toISOString()}`, limit: '1000' }),
  ]);
  if (!el.isConnected) return;
  const fragmentos = indexados.data?.reduce((s, d) => s + (Number(d.fragmentos) || 0), 0) ?? null;
  const porDia = Array.from({ length: 14 }, () => 0);
  for (const d of docs.data ?? []) {
    if (!d.indexado_at) continue;
    const i = Math.floor((new Date(d.indexado_at).getTime() - hace14.getTime()) / 86400000);
    if (i >= 0 && i < 14) porDia[i]++;
  }
  const cifra = (v: number | null | undefined, t: string, href: string) => `<a class="ok-mem-cifra" href="${href}"><b>${v == null ? '—' : v}</b><small>${t}</small></a>`;
  el.innerHTML = `${cabecera}
    <div class="ok-mem">
      <div class="ok-mem-graf">${constelacion(porDia)}<a href="#/buscar">Ver la memoria ›</a></div>
      <div class="ok-mem-cifras">
        ${cifra(indexados.data?.length, 'Documentos', '#/buscar')}
        ${cifra(fragmentos, 'Fragmentos', '#/buscar')}
        ${cifra(paginas, 'Páginas de la wiki', '#/wiki')}
        ${cifra(proyectos, 'Proyectos abiertos', '#/proyectos')}
        ${cifra(comandas, 'Comandas hechas esta semana', '#/comandas')}
      </div>
    </div>`;
}

// ── Conexiones (las que no salen de los agentes) ────────────────────────────
async function conexiones() {
  const [estados, wa] = await Promise.all([
    syncEstados(),
    llamarFuncion<{ envio: boolean; claude: boolean; plantilla: boolean }>('whatsapp', { accion: 'estado' }, 20000),
  ]);
  const de = (clave: string) => estados.find(e => e.clave === clave);
  const zoho = de('zoho'), correo = de('correo'), drive = de('drive');
  ponConexion('zoho', zoho ? bien(zoho) : false, zoho?.ultima_ok ? (bien(zoho) ? `Copia ${hace(zoho.ultima_ok)}` : 'La última copia falló') : 'Sin conectar');
  ponConexion('correo', correo ? bien(correo) : false, correo?.ultima_ok ? (bien(correo) ? `Leído ${hace(correo.ultima_ok)}` : 'El último repaso falló') : 'Sin conectar');
  ponConexion('drive', drive ? bien(drive) : false, drive?.ultima_ok ? (bien(drive) ? `Repasado ${hace(drive.ultima_ok)}` : 'El último repaso falló') : 'Sin carpeta');
  ponConexion('claude', wa.data ? wa.data.claude : null, wa.data ? (wa.data.claude ? 'Redacta y resume' : 'Sin clave') : 'Sin comprobar');
}

registrarAcciones({
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
