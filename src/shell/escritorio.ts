// Modo escritorio: el hub como un escritorio con ventanas (propuesta 6 del
// lienzo «Hub OS»). Convive con el shell clásico y no lo toca: se enciende
// por persona (botón al pie del menú, `?os=1` / `?os=0` en la URL) y solo a
// partir de 1024 px; quien no lo activa ve el hub de siempre.
//
// Cómo funciona: cada módulo se pinta en el cuerpo de SU ventana (una por
// módulo; navegar a #/proyectos/12 repinta la de Proyectos), con la misma
// `pintarPantalla` del shell clásico. El escritorio es el panel: widgets de
// Hoy, Avisos, Cobros (admin), Equipos y Agenda, refrescados cada 5 min, que
// se arrastran a cualquier punto del escritorio (sitio guardado por escritorio).
// Barra con escritorios (varios, con nombre), Ctrl+K, sync, avisos, tema y
// reloj; dock con las pantallas del hub, Claude y «Todas». La disposición
// (ventanas, tamaño, sitio, zona de ajuste) se guarda por persona y por
// escritorio en localStorage.
// Prefijo de ids y clases: os-.
import type { Modulo } from '../core/modulo';
import { modulo, rutaActual, ir } from '../core/router';
import { usuario, esAdmin } from '../core/estado';
import { registrarAcciones } from '../core/dispatcher';
import { API } from '../core/api';
import { esc, hace, toast } from '../ui/dom';
import { visibles, hrefDe } from '../modulos/inicio';
import { avisos as cargarAvisos, GRUPOS, esMio, type Aviso } from '../modulos/direccion';
import { pintarPantalla } from './pantalla';
import { abrirBuscador } from './buscador';

const CLAVE_ACTIVO = 'hub_escritorio';
const ANCHO_MINIMO = 1024;
const MARGEN = 16;
const DOCK_FIJAS = 12;
type Zona = 'izq' | 'der' | 'ai' | 'ad' | 'bi' | 'bd' | 'max' | null;
interface Ventana { id: string; params: string[]; x: number; y: number; w: number; h: number; min: boolean; snap: Zona; z: number }
interface Escritorio { nombre: string; ventanas: Ventana[]; widgets?: Record<string, { x: number; y: number }> }
interface Estado { activo: number; escritorios: Escritorio[] }

let _estado: Estado = { activo: 0, escritorios: [{ nombre: 'Principal', ventanas: [] }] };
let _raiz: HTMLElement | null = null;
let _z = 1;
let _timer: number | undefined;
let _avisos: Aviso[] = [];
let _soloMios = false;

const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const claveDisposicion = () => `hub_os_${usuario()?.id ?? 'anon'}`;

// ── Activación ──────────────────────────────────────────────────────────────
export function escritorioActivo(): boolean {
  return leer(CLAVE_ACTIVO) === '1' && innerWidth >= ANCHO_MINIMO;
}

// `?os=1` enciende el modo y `?os=0` lo apaga (y la URL se limpia).
export function leerParametroOs() {
  const v = new URLSearchParams(location.search).get('os');
  if (v === null) return;
  guardar(CLAVE_ACTIVO, v === '1' ? '1' : null);
  history.replaceState(null, '', location.pathname + location.hash);
}

function cargarEstado() {
  try {
    const g = JSON.parse(leer(claveDisposicion()) ?? 'null');
    if (g?.escritorios?.length) _estado = { activo: Math.min(g.activo ?? 0, g.escritorios.length - 1), escritorios: g.escritorios };
  } catch { /* disposición corrupta: se empieza de cero */ }
}
function guardarEstado() { guardar(claveDisposicion(), JSON.stringify(_estado)); }
const escritorio = () => _estado.escritorios[_estado.activo];
const ventanaDe = (id: string) => escritorio().ventanas.find(v => v.id === id);

// ── Pintar ──────────────────────────────────────────────────────────────────
export function pintarEscritorio(raiz: HTMLElement) {
  _raiz = raiz;
  cargarEstado();
  document.body.classList.add('os-modo');
  document.getElementById('os-root')?.remove();
  const u = usuario();
  const ini = (u?.nombre ?? u?.email ?? '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const el = document.createElement('div');
  el.id = 'os-root';
  el.innerHTML = `
    <header id="os-barra">
      <a class="os-marca" href="#/inicio"><span class="hex" aria-hidden="true">OK</span>Ok Computer <b>Hub</b></a>
      <nav id="os-escritorios" aria-label="Escritorios"></nav>
      <button class="os-buscar" data-action="abrirBuscador" aria-label="Buscar o pedir algo"><span aria-hidden="true">🔎</span><span>Buscar o pedir algo a Claude…</span><kbd>Ctrl</kbd><kbd>K</kbd></button>
      <div class="os-barra-der">
        <span id="os-sync" class="chip">Sync…</span>
        <button id="os-bell" class="os-bbtn" data-action="osAvisos" aria-label="Avisos">🔔<span id="os-bell-n" class="os-badge" hidden></span></button>
        <button class="os-bbtn" data-action="alternarTema" aria-label="Tema claro u oscuro">🌓</button>
        <span id="os-reloj" class="os-reloj"></span>
        <button class="hex os-avatar" data-action="osMenu" aria-label="Menú de usuario" title="${esc(u?.email)}">${esc(ini)}</button>
        <div id="os-menu" class="os-menu" hidden>
          <div class="os-menu-cab"><b>${esc(u?.nombre ?? '')}</b><span>${esc(u?.email ?? '')}</span></div>
          <button data-action="osRenombrarEscritorio">Renombrar este escritorio</button>
          <button data-action="osEliminarEscritorio">Eliminar este escritorio</button>
          <button data-action="osRecolocarWidgets">Recolocar los widgets</button>
          <button data-action="osSalir">Volver a la app clásica</button>
          <button class="os-menu-peligro" data-action="salir">Salir</button>
        </div>
      </div>
    </header>
    <main id="os-escritorio">
      <section id="os-widgets" aria-label="Panel"></section>
      <div id="os-ventanas"></div>
    </main>
    <aside id="os-avisos" aria-label="Centro de avisos" hidden></aside>
    <div id="os-lanzador" hidden><div class="os-lanzador-fondo" data-action="osLanzador" data-p0="0"></div><div class="os-lanzador-panel"></div></div>
    <nav id="os-dock" aria-label="Dock"></nav>`;
  raiz.appendChild(el);
  pintarEscritorios();
  pintarDock();
  pintarWidgets();
  reloj();
  for (const v of escritorio().ventanas) void abrirVentana(v.id, v.params, false);
  clearInterval(_timer);
  _timer = window.setInterval(() => { refrescarDatos(); reloj(); }, 60_000);
  void refrescarDatos();
}

function quitarEscritorio() {
  clearInterval(_timer);
  document.getElementById('os-root')?.remove();
  document.body.classList.remove('os-modo');
  delete document.body.dataset.osSnap;
}

function pintarEscritorios() {
  document.getElementById('os-escritorios')!.innerHTML = _estado.escritorios.map((e, i) =>
    `<button class="os-esc ${i === _estado.activo ? 'activo' : ''}" data-action="osEscritorio" data-p0="${i}">${esc(e.nombre)}</button>`).join('')
    + `<button class="os-esc os-esc-mas" data-action="osNuevoEscritorio" aria-label="Nuevo escritorio">+</button>`;
}

const delHub = (m: Modulo) => !m.enlaceExterno;

function pintarDock() {
  const abiertas = new Set(escritorio().ventanas.map(v => v.id));
  const frente = ventanaFrente()?.id;
  const item = (m: Modulo, extra = '') => `
    <button class="os-ditem ${abiertas.has(m.id) ? 'abierta' : ''} ${frente === m.id ? 'activa' : ''} ${extra}" data-action="osAbrir" data-p0="${esc(m.id)}" title="${esc(m.titulo)}">
      <span class="hex" aria-hidden="true">${esc(m.icono)}</span><span class="os-dlabel">${esc(m.titulo)}</span><span class="os-dpunto"></span></button>`;
  // Fijas: las primeras del menú (las del hub); lo abierto que no esté entre
  // ellas se añade mientras dure, como en cualquier dock. El resto, en «Todas».
  const hub = visibles().filter(delHub);
  const fijas = hub.slice(0, DOCK_FIJAS);
  const enDock = [...fijas, ...hub.filter(m => abiertas.has(m.id) && !fijas.includes(m))];
  document.getElementById('os-dock')!.innerHTML = item({ id: 'inicio', titulo: 'Panel', icono: '▦' } as Modulo)
    + enDock.map(m => item(m)).join('')
    + '<span class="os-dsep"></span>'
    + `<button class="os-ditem os-claude" data-action="osClaude" title="Pedir a Claude"><span class="hex" aria-hidden="true">✨</span><span class="os-dlabel">Claude</span><span class="os-dpunto"></span></button>`
    + `<button class="os-ditem" data-action="osLanzador" data-p0="1" title="Todas las pantallas"><span class="hex os-hex-borde" aria-hidden="true">⋯</span><span class="os-dlabel">Todas</span><span class="os-dpunto"></span></button>`;
}

function pintarLanzador() {
  const lista = visibles();
  const grupo = (titulo: string, ms: Modulo[]) => ms.length ? `<div class="os-ltit"><i class="hex-punto"></i>${esc(titulo)}</div>
    <div class="os-lgrid">${ms.map(m => `<a class="os-litem ${m.enlaceExterno ? 'ext' : ''}" href="${esc(hrefDe(m))}"${m.enlaceExterno ? ' target="_blank" rel="noopener"' : ''} data-action="osLanzador" data-p0="0">
      <span class="hex" aria-hidden="true">${esc(m.icono)}</span><span>${esc(m.titulo)}<small>${esc(m.enlaceExterno ? 'abre la app actual' : m.grupo)}</small></span></a>`).join('')}</div>` : '';
  document.querySelector('#os-lanzador .os-lanzador-panel')!.innerHTML =
    grupo('Del hub', lista.filter(delHub)) + grupo('En la app actual', lista.filter(m => !delHub(m)));
}

function reloj() {
  const el = document.getElementById('os-reloj');
  if (el) el.textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ── Ventanas ────────────────────────────────────────────────────────────────
function areaEscritorio() {
  const e = document.getElementById('os-escritorio')!;
  return { W: e.clientWidth, H: e.clientHeight };
}

// Sitio por defecto: a la derecha de los widgets si cabe, si no encima.
function sitioNuevo(n: number): Pick<Ventana, 'x' | 'y' | 'w' | 'h'> {
  const { W, H } = areaEscritorio();
  const wid = document.getElementById('os-widgets');
  // Con los widgets movidos a mano no hay columna que respetar.
  const libreX = wid && !wid.classList.contains('libre') ? wid.offsetWidth + MARGEN * 2 : MARGEN * 2;
  const x = libreX + 640 <= W ? libreX : Math.round(W * 0.28);
  const w = Math.max(560, Math.min(880, W - x - MARGEN));
  const h = Math.max(420, H - MARGEN * 2 - 24);
  const d = (n % 6) * 24;
  return { x: Math.min(x + d, W - w - MARGEN), y: MARGEN + d, w, h: h - d };
}

function geometriaZona(z: Zona) {
  const { W, H } = areaEscritorio();
  const g = MARGEN / 2;
  const mitadW = Math.floor(W / 2) - g * 1.5, mitadH = Math.floor(H / 2) - g * 1.5;
  switch (z) {
    case 'max': return { x: g, y: g, w: W - g * 2, h: H - g * 2 };
    case 'izq': return { x: g, y: g, w: mitadW, h: H - g * 2 };
    case 'der': return { x: W / 2 + g / 2, y: g, w: mitadW, h: H - g * 2 };
    case 'ai': return { x: g, y: g, w: mitadW, h: mitadH };
    case 'ad': return { x: W / 2 + g / 2, y: g, w: mitadW, h: mitadH };
    case 'bi': return { x: g, y: H / 2 + g / 2, w: mitadW, h: mitadH };
    case 'bd': return { x: W / 2 + g / 2, y: H / 2 + g / 2, w: mitadW, h: mitadH };
    default: return null;
  }
}

function aplicarGeometria(v: Ventana) {
  const el = document.getElementById(`os-win-${v.id}`);
  if (!el) return;
  const g = v.snap ? geometriaZona(v.snap)! : v;
  el.style.left = `${g.x}px`; el.style.top = `${g.y}px`; el.style.width = `${g.w}px`; el.style.height = `${g.h}px`;
  el.style.zIndex = String(v.z);
  el.classList.toggle('min', v.min);
  el.classList.toggle('max', v.snap === 'max');
  el.classList.toggle('encajada', !!v.snap && v.snap !== 'max');
}

function ventanaFrente(): Ventana | undefined {
  return escritorio().ventanas.filter(v => !v.min).sort((a, b) => b.z - a.z)[0];
}

function enfocar(id: string) {
  const v = ventanaDe(id);
  if (!v) return;
  const frente = ventanaFrente();
  if (frente?.id !== id) v.z = ++_z;
  v.min = false;
  document.querySelectorAll('.os-win').forEach(w => w.classList.toggle('activa', w.id === `os-win-${id}`));
  aplicarGeometria(v);
  guardarEstado();
  pintarDock();
}

async function abrirVentana(id: string, params: string[], enfocarla = true) {
  const m = modulo(id);
  if (!m || m.enlaceExterno) return;
  let v = ventanaDe(id);
  if (!v) {
    v = { id, params, min: false, snap: null, z: ++_z, ...sitioNuevo(escritorio().ventanas.length) };
    escritorio().ventanas.push(v);
  } else { v.params = params; if (v.z > _z) _z = v.z; }
  let el = document.getElementById(`os-win-${id}`);
  if (!el) {
    el = document.createElement('section');
    el.id = `os-win-${id}`;
    el.className = 'os-win';
    el.dataset.win = id;
    el.setAttribute('aria-label', `Ventana ${m.titulo}`);
    el.innerHTML = `
      <div class="os-win-cab" data-on-dblclick="osMaximizar:${esc(id)}">
        <span class="hex os-win-icono" aria-hidden="true">${esc(m.icono)}</span>
        <span class="os-win-titulo" title="${esc(m.explicacion)}">${esc(m.titulo)}</span>
        <button class="os-wbtn" data-action="osMinimizar" data-p0="${esc(id)}" aria-label="Minimizar">–</button>
        <button class="os-wbtn" data-action="osMaximizar" data-p0="${esc(id)}" aria-label="Maximizar o restaurar">▢</button>
        <button class="os-wbtn os-wcerrar" data-action="osCerrar" data-p0="${esc(id)}" aria-label="Cerrar">✕</button>
      </div>
      <div class="os-win-cuerpo principal"><div class="os-pantalla"></div></div>`;
    document.getElementById('os-ventanas')!.appendChild(el);
    instalarArrastre(el, id);
    new ResizeObserver(() => {
      const w = ventanaDe(id);
      if (!w || w.snap || !el!.isConnected) return;
      const nw = el!.offsetWidth, nh = el!.offsetHeight;
      if (nw === w.w && nh === w.h) return;
      w.w = nw; w.h = nh; guardarEstado();
    }).observe(el);
  }
  aplicarGeometria(v);
  if (enfocarla) enfocar(id); else { el.classList.toggle('activa', ventanaFrente()?.id === id); pintarDock(); }
  guardarEstado();
  await pintarPantalla(el.querySelector('.os-pantalla') as HTMLElement, m, params);
}

function cerrarVentana(id: string) {
  const e = escritorio();
  e.ventanas = e.ventanas.filter(v => v.id !== id);
  document.getElementById(`os-win-${id}`)?.remove();
  guardarEstado();
  const f = ventanaFrente();
  if (f) enfocar(f.id); else pintarDock();
  if (rutaActual().id === id) ir('inicio');
}

// El módulo pedido por la URL se pinta en su ventana. #/inicio es el panel.
export async function mostrarEnEscritorio(m: Modulo, params: string[]) {
  if (m.id === 'inicio') { void refrescarDatos(); return; }
  if (m.enlaceExterno) { window.open(m.enlaceExterno, '_blank', 'noopener'); return; }
  await abrirVentana(m.id, params);
}

// ── Arrastre y ajuste a zonas (estilo Windows 11) ───────────────────────────
function zonaEn(x: number, y: number): Zona {
  const { W, H } = areaEscritorio();
  const b = 14;
  if (y <= b) return 'max';
  if (x <= b) return y < H * 0.3 ? 'ai' : y > H * 0.7 ? 'bi' : 'izq';
  if (x >= W - b) return y < H * 0.3 ? 'ad' : y > H * 0.7 ? 'bd' : 'der';
  return null;
}

function instalarArrastre(el: HTMLElement, id: string) {
  const cab = el.querySelector('.os-win-cab') as HTMLElement;
  cab.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as Element).closest('button') || e.button !== 0) return;
    const v = ventanaDe(id);
    if (!v) return;
    enfocar(id);
    const area = document.getElementById('os-escritorio')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Una ventana encajada se suelta al empezar a arrastrarla, con su tamaño libre.
    const desde = { x: e.clientX, y: e.clientY, left: r.left - area.left, top: r.top - area.top };
    let movio = false;
    let zona: Zona = null;
    cab.setPointerCapture(e.pointerId);
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - desde.x, dy = ev.clientY - desde.y;
      if (!movio && Math.hypot(dx, dy) < 4) return;
      if (!movio) { movio = true; if (v.snap) { v.snap = null; el.classList.remove('max', 'encajada'); el.style.width = `${v.w}px`; el.style.height = `${v.h}px`; } }
      el.style.left = `${desde.left + dx}px`; el.style.top = `${desde.top + dy}px`;
      zona = zonaEn(ev.clientX - area.left, ev.clientY - area.top);
      if (zona) document.body.dataset.osSnap = zona; else delete document.body.dataset.osSnap;
    };
    const soltar = (ev: PointerEvent) => {
      cab.removeEventListener('pointermove', mover);
      cab.removeEventListener('pointerup', soltar);
      cab.removeEventListener('pointercancel', soltar);
      delete document.body.dataset.osSnap;
      if (!movio) return;
      if (zona) v.snap = zona;
      else {
        const { W, H } = areaEscritorio();
        v.x = Math.max(-v.w + 120, Math.min(W - 120, desde.left + ev.clientX - desde.x));
        v.y = Math.max(0, Math.min(H - 44, desde.top + ev.clientY - desde.y));
      }
      aplicarGeometria(v);
      guardarEstado();
    };
    cab.addEventListener('pointermove', mover);
    cab.addEventListener('pointerup', soltar);
    cab.addEventListener('pointercancel', soltar);
  });
  el.addEventListener('pointerdown', () => { if (ventanaFrente()?.id !== id) enfocar(id); }, true);
}

function encajar(id: string, zona: Zona) {
  const v = ventanaDe(id);
  if (!v) return;
  v.snap = v.snap === zona ? null : zona;
  aplicarGeometria(v);
  guardarEstado();
}

// Alt+Mayús+flechas mueve la ventana de delante entre zonas; Alt+Mayús+↓ la restaura.
export function instalarAtajosEscritorio() {
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('os-modo') || !e.altKey || !e.shiftKey) return;
    const f = ventanaFrente();
    if (!f) return;
    const mapa: Record<string, Zona> = { ArrowLeft: 'izq', ArrowRight: 'der', ArrowUp: 'max', ArrowDown: null };
    if (!(e.key in mapa)) return;
    e.preventDefault();
    const v = ventanaDe(f.id)!;
    v.snap = mapa[e.key];
    aplicarGeometria(v);
    guardarEstado();
  });
  addEventListener('resize', () => {
    if (!document.body.classList.contains('os-modo')) return;
    if (innerWidth < ANCHO_MINIMO) { quitarEscritorio(); ir(rutaActual().id, ...rutaActual().params); return; }
    for (const v of escritorio().ventanas) aplicarGeometria(v);
    colocarWidgets();
  });
}

// ── Widgets: el escritorio es el panel ──────────────────────────────────────
const hoyLocal = () => new Date().toLocaleDateString('sv-SE');
const eur = (n: number) => `${Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`;
const hora = (v: string) => new Date(v).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const PESO = { mal: 0, aviso: 1, info: 2 } as const;

function pintarWidgets() {
  const admin = esAdmin();
  document.getElementById('os-widgets')!.innerHTML = `
    <article class="os-widget os-w-hoy" id="os-w-hoy"><div class="os-wtit"><i class="hex-punto"></i>Hoy · ${esc(new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }))}</div>
      <p class="os-saludo">Hola, ${esc(usuario()?.nombre?.split(' ')[0] ?? '')}.<br><span id="os-hoy-frase">Cargando…</span></p>
      <div class="os-cifras" id="os-hoy-cifras"></div></article>
    <article class="os-widget" id="os-w-avisos"><div class="os-wtit"><i class="hex-punto mal"></i>Avisos<span id="os-w-avisos-n"></span></div><div class="os-wcuerpo" id="os-avisos-lista"><p class="cargando">Cargando…</p></div>
      <a class="os-wenlace" href="#/direccion">Abrir el puesto de mando →</a></article>
    ${admin ? `<article class="os-widget" id="os-w-cobros"><div class="os-wtit"><i class="hex-punto"></i>Cobros<span>mantenimiento</span></div><div class="os-wcuerpo" id="os-cobros"><p class="cargando">Cargando…</p></div>
      <a class="os-wenlace" href="#/cobros">Recordatorios de cobro →</a></article>` : ''}
    <article class="os-widget" id="os-w-equipos"><div class="os-wtit"><i class="hex-punto"></i>Equipos<span id="os-equipos-cuando">Breeze</span></div><div class="os-wcuerpo" id="os-equipos"><p class="cargando">Cargando…</p></div>
      <a class="os-wenlace" href="#/monitorizacion">Monitorización →</a></article>
    <article class="os-widget os-w-agenda" id="os-w-agenda"><div class="os-wtit"><i class="hex-punto"></i>Agenda de hoy<span id="os-agenda-n"></span></div><div class="os-wcuerpo" id="os-agenda"><p class="cargando">Cargando…</p></div>
      <a class="os-wenlace" href="#/calendario">Calendario en la app ↗</a></article>`;
  colocarWidgets();
  for (const w of document.querySelectorAll<HTMLElement>('#os-widgets > .os-widget')) instalarArrastreWidget(w);
}

// Widgets movibles. Mientras nadie mueve ninguno van en la rejilla de siempre;
// al soltar el primero se congela el sitio de TODOS (para que los demás no
// salten a rellenar el hueco) y desde ahí cada uno va donde se le deje.
function colocarWidgets() {
  const cont = document.getElementById('os-widgets');
  if (!cont) return;
  const pos = escritorio().widgets;
  const ws = [...cont.querySelectorAll<HTMLElement>(':scope > .os-widget')];
  if (!pos || !Object.keys(pos).length) {
    cont.classList.remove('libre');
    ws.forEach(w => { w.style.left = w.style.top = w.style.width = ''; });
    return;
  }
  // Un widget sin sitio guardado (p. ej. uno nuevo) toma el de la rejilla.
  const sinSitio = ws.filter(w => !pos[w.id]);
  if (sinSitio.length) {
    cont.classList.remove('libre');
    ws.forEach(w => { w.style.width = ''; });
    for (const w of sinSitio) pos[w.id] = { x: cont.offsetLeft + w.offsetLeft, y: cont.offsetTop + w.offsetTop };
  }
  if (!cont.classList.contains('libre')) ws.forEach(w => { w.style.width = `${w.offsetWidth}px`; });
  cont.classList.add('libre');
  const { W, H } = areaEscritorio();
  for (const w of ws) {
    const p = pos[w.id];
    w.style.left = `${Math.max(0, Math.min(W - 80, p.x))}px`;
    w.style.top = `${Math.max(0, Math.min(H - 40, p.y))}px`;
  }
}

function congelarWidgets() {
  const e = escritorio();
  if (e.widgets && Object.keys(e.widgets).length) return;
  const cont = document.getElementById('os-widgets')!;
  e.widgets = Object.fromEntries([...cont.querySelectorAll<HTMLElement>(':scope > .os-widget')]
    .map(w => [w.id, { x: cont.offsetLeft + w.offsetLeft, y: cont.offsetTop + w.offsetTop }]));
  colocarWidgets();
}

let _zWidget = 1;
function instalarArrastreWidget(w: HTMLElement) {
  w.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('a, button, input, select, textarea')) return;
    const desde = { x: e.clientX, y: e.clientY };
    let movio = false;
    let base = { x: 0, y: 0 };
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - desde.x, dy = ev.clientY - desde.y;
      if (!movio) {
        if (Math.hypot(dx, dy) < 5) return;
        movio = true;
        congelarWidgets();
        base = { x: w.offsetLeft, y: w.offsetTop };
        w.setPointerCapture(ev.pointerId);
        w.classList.add('arrastrando');
        w.style.zIndex = String(++_zWidget);
      }
      ev.preventDefault();
      w.style.left = `${base.x + dx}px`; w.style.top = `${base.y + dy}px`;
    };
    const soltar = () => {
      w.removeEventListener('pointermove', mover);
      w.removeEventListener('pointerup', soltar);
      w.removeEventListener('pointercancel', soltar);
      if (!movio) return;
      w.classList.remove('arrastrando');
      escritorio().widgets![w.id] = { x: w.offsetLeft, y: w.offsetTop };
      colocarWidgets();
      guardarEstado();
    };
    w.addEventListener('pointermove', mover);
    w.addEventListener('pointerup', soltar);
    w.addEventListener('pointercancel', soltar);
  });
}

async function refrescarDatos() {
  if (!document.getElementById('os-root')) return;
  await Promise.all([widgetHoy(), widgetAvisos(), esAdmin() ? widgetCobros() : Promise.resolve(), widgetEquipos(), widgetAgenda(), chipSync()]);
}

async function chipSync() {
  const el = document.getElementById('os-sync');
  if (!el) return;
  const { data } = await API.get<any[]>('sync_estado', { clave: 'eq.audit', select: 'ultima_ok,ultimo_error' });
  const s = data?.[0];
  const min = s?.ultima_ok ? (Date.now() - new Date(s.ultima_ok).getTime()) / 60000 : Infinity;
  el.className = `chip ${!s?.ultima_ok || min > 60 ? 'mal' : s.ultimo_error || min > 30 ? 'aviso' : 'ok'}`;
  el.textContent = s?.ultima_ok ? `Sync ${hace(s.ultima_ok)}` : 'Sin sync';
  el.title = s?.ultimo_error ?? 'Sincronización con la app actual';
}

async function widgetHoy() {
  const d = hoyLocal();
  const ini = new Date(`${d}T00:00:00`).toISOString(), fin = new Date(`${d}T23:59:59`).toISOString();
  const [bloques, tickets, sinTecnico, tareas] = await Promise.all([
    API.contar('agenda', { and: `(inicio.lte.${fin},fin.gte.${ini})` }),
    API.contar('tickets', { estado: 'in.(Abierto,"En curso")' }),
    API.contar('tickets', { estado: 'in.(Abierto,"En curso")', or: '(tecnico_id.is.null,tecnico_id.eq.)' }),
    API.contar('tareas', { estado: 'in.(pendiente,en_progreso)' }),
  ]);
  const el = document.getElementById('os-hoy-cifras');
  if (!el) return;
  const c = (n: number | null, t: string) => `<span><b>${n ?? '—'}</b> ${t}</span>`;
  el.innerHTML = c(bloques, 'bloques') + c(tickets, 'tickets') + c(sinTecnico, 'sin técnico') + c(tareas, 'tareas');
  const piden = (sinTecnico ?? 0) + _avisos.filter(a => a.gravedad === 'mal').length;
  document.getElementById('os-hoy-frase')!.innerHTML = piden ? `<b>${piden} cosa${piden === 1 ? '' : 's'}</b> pide${piden === 1 ? '' : 'n'} mano hoy.` : 'Nada urgente por ahora.';
}

async function widgetAvisos() {
  const { data, error } = await cargarAvisos();
  _avisos = error ? _avisos : (data ?? []);
  const el = document.getElementById('os-avisos-lista');
  if (!el) return;
  const lista = [..._avisos].sort((a, b) => PESO[a.gravedad] - PESO[b.gravedad]);
  const n = lista.filter(a => a.gravedad !== 'info').length;
  document.getElementById('os-w-avisos-n')!.innerHTML = n ? `<span class="chip ${lista.some(a => a.gravedad === 'mal') ? 'mal' : 'aviso'}">${n}</span>` : '';
  const badge = document.getElementById('os-bell-n')!;
  badge.textContent = String(n); badge.hidden = !n;
  el.innerHTML = error && !lista.length ? `<p class="nota mal">No se pudieron leer: ${esc(error.message)}</p>`
    : lista.slice(0, 5).map(a => `<div class="os-fila"><span class="os-punto g-${esc(a.gravedad)}"></span><span class="os-n"><b>${esc(a.titulo.replace(/^[^:]+: /, ''))}</b>${a.detalle ? `<br><small>${esc(a.detalle)}</small>` : ''}</span>${a.importe ? `<span class="os-num">${eur(a.importe)}</span>` : ''}</div>`).join('')
      || '<p class="nota">✅ Nada pendiente.</p>';
  if (!document.getElementById('os-avisos')!.hidden) pintarCentroAvisos();
}

async function widgetCobros() {
  const [{ data: locales }, pend] = await Promise.all([
    API.get<any[]>('locales', { select: 'estado_pago,importe_mantenimiento', activo: 'neq.false', importe_mantenimiento: 'gt.0' }),
    API.contar('cobros_recordatorios', { estado: 'eq.pendiente' }),
  ]);
  const el = document.getElementById('os-cobros');
  if (!el) return;
  const ls = locales ?? [];
  const mal = ls.filter(l => ['Último aviso', 'No paga'].includes(l.estado_pago)).length;
  const av = ls.filter(l => l.estado_pago === 'Pendiente de pago').length;
  const ok = ls.length - mal - av;
  const total = ls.reduce((s, l) => s + Number(l.importe_mantenimiento || 0), 0);
  el.innerHTML = `<div class="os-cifra">${eur(total)}<small>/mes en ${ls.length} sedes</small></div>
    <div class="os-tramos"><span style="flex:${ok || 0.01};background:var(--verde)"></span><span style="flex:${av || 0.01};background:#d9a441"></span><span style="flex:${mal || 0.01};background:#d64545"></span></div>
    <div class="os-cifras"><span><b>${ok}</b> al corriente</span><span><b class="g-aviso">${av}</b> pendientes</span><span><b class="g-mal">${mal}</b> impagadas</span>${pend ? `<span><b>${pend}</b> recordatorios por mandar</span>` : ''}</div>`;
}

async function widgetEquipos() {
  const [total, conectados, alertas, { data: ultimas }] = await Promise.all([
    API.contar('rmm_equipos'), API.contar('rmm_equipos', { conectado: 'eq.true' }), API.contar('rmm_alertas', { estado: 'eq.active' }),
    API.get<any[]>('rmm_alertas', { select: 'id,hostname,sitio,severidad,titulo', estado: 'eq.active', order: 'disparada.desc', limit: '2' }),
  ]);
  const el = document.getElementById('os-equipos');
  if (!el) return;
  if (total == null) { el.innerHTML = '<p class="nota">Sin acceso a Breeze todavía.</p>'; return; }
  const sin = total - (conectados ?? 0);
  const P = 324, verde = total ? P * ((conectados ?? 0) / total) : 0, rojo = total ? P * (sin / total) : 0;
  const hexPath = 'M60 6 L107 33 L107 87 L60 114 L13 87 L13 33 Z';
  el.innerHTML = `<svg class="os-anillo" viewBox="0 0 120 120" aria-label="${conectados ?? 0} de ${total} equipos en línea">
      <path d="${hexPath}" fill="none" stroke="var(--borde)" stroke-width="12"/>
      <path d="${hexPath}" fill="none" stroke="var(--verde)" stroke-width="12" stroke-dasharray="${verde} ${P}" stroke-linejoin="round"/>
      <path d="${hexPath}" fill="none" stroke="#d64545" stroke-width="12" stroke-dasharray="${rojo} ${P}" stroke-dashoffset="${-verde}" stroke-linejoin="round"/>
      <text x="60" y="57" text-anchor="middle" class="os-anillo-n">${conectados ?? 0}</text><text x="60" y="74" text-anchor="middle" class="os-anillo-s">de ${total} en línea</text></svg>
    <div class="os-cifras"><span><b class="${sin ? 'g-mal' : ''}">${sin}</b> sin señal</span><span><b class="${alertas ? 'g-aviso' : ''}">${alertas ?? 0}</b> alertas</span></div>
    ${(ultimas ?? []).map(a => `<div class="os-fila"><span class="os-punto ${a.severidad === 'critical' ? 'g-mal' : 'g-aviso'}"></span><span class="os-n"><b>${esc(a.hostname ?? '')}</b> · ${esc(a.sitio ?? '')}<br><small>${esc(a.titulo ?? '')}</small></span></div>`).join('')}`;
  document.getElementById('os-equipos-cuando')!.textContent = 'Breeze';
}

async function widgetAgenda() {
  const d = hoyLocal();
  const ini = new Date(`${d}T00:00:00`).toISOString(), fin = new Date(`${d}T23:59:59`).toISOString();
  const { data, error } = await API.get<any[]>('agenda', { select: 'id,titulo,inicio,fin,tecnicos,trabajo_id,ticket_id,tarea_id,todo_el_dia', and: `(inicio.lte.${fin},fin.gte.${ini})`, order: 'inicio', limit: '12' });
  const el = document.getElementById('os-agenda');
  if (!el) return;
  const bloques = data ?? [];
  const ids = bloques.map(b => b.trabajo_id).filter(Boolean);
  const { data: trabajos } = ids.length ? await API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,cliente_id', id: `in.(${ids.join(',')})` }) : { data: [] };
  const cids = [...new Set((trabajos ?? []).map(t => t.cliente_id).filter(Boolean))];
  const { data: clientes } = cids.length ? await API.get<any[]>('clientes', { select: 'id,nombre', id: `in.(${cids.join(',')})` }) : { data: [] };
  const cliente = (t: any) => (clientes ?? []).find(c => c.id === t?.cliente_id)?.nombre ?? '';
  document.getElementById('os-agenda-n')!.textContent = `${bloques.length} bloque${bloques.length === 1 ? '' : 's'}`;
  el.innerHTML = error ? `<p class="nota mal">No se pudo leer la agenda: ${esc(error.message)}</p>`
    : bloques.map(b => {
      const t = (trabajos ?? []).find(x => x.id === b.trabajo_id);
      const titulo = t ? `#${t.numero ?? '?'} ${t.titulo || (t.descripcion ?? '').slice(0, 50)}` : b.titulo || (b.ticket_id ? 'Ticket' : b.tarea_id ? 'Tarea' : 'Bloque');
      const tec = (b.tecnicos ?? []).filter(Boolean);
      const sin = !tec.length;
      return `<div class="os-fila ${sin ? 'os-sin' : ''}"><span class="os-hora">${b.todo_el_dia ? 'día' : esc(hora(b.inicio))}</span><span class="os-n"><b>${esc(titulo)}</b><br><small>${esc(cliente(t))}${sin ? (cliente(t) ? ' · ' : '') + 'Sin técnico' : ''}</small></span>
        ${sin ? '<span class="chip aviso">Asignar</span>' : `<span class="chip">${esc(tec.map((n: string) => n.split(' ')[0]).join(', '))}</span>`}</div>`;
    }).join('') || '<p class="nota">Nada programado para hoy.</p>';
}

// ── Centro de avisos ────────────────────────────────────────────────────────
function pintarCentroAvisos() {
  const aside = document.getElementById('os-avisos')!;
  const lista = (_soloMios ? _avisos.filter(a => esMio(a.persona)) : _avisos).slice().sort((a, b) => PESO[a.gravedad] - PESO[b.gravedad]);
  aside.innerHTML = `<div class="os-av-cab"><b>Avisos</b><span class="chip">${lista.length}</span><span class="hueco"></span><button class="os-wbtn" data-action="osAvisos" aria-label="Cerrar avisos">✕</button></div>
    <div class="os-av-filtros"><button class="chip-boton ${_soloMios ? '' : 'activo'}" data-action="osAvisosMios" data-p0="0">Todos (${_avisos.length})</button>
      <button class="chip-boton ${_soloMios ? 'activo' : ''}" data-action="osAvisosMios" data-p0="1">Los míos (${_avisos.filter(a => esMio(a.persona)).length})</button></div>
    <div class="os-av-lista">${lista.map(a => {
      const g = GRUPOS[a.tipo] ?? { nombre: a.tipo, icono: '•' };
      const interno = a.enlace?.startsWith('#');
      return `<div class="os-av g-${esc(a.gravedad)}"><span class="hex os-av-ic" aria-hidden="true">${g.icono}</span><div class="os-av-cuerpo">
        <div class="os-av-f1"><b>${esc(g.nombre)}</b>${a.persona ? `<span>${esc(a.persona)}</span>` : ''}${a.fecha ? `<span class="os-av-cuando">${esc(hace(a.fecha))}</span>` : ''}</div>
        <div class="os-av-t">${esc(a.titulo.replace(/^[^:]+: /, ''))}</div>${a.detalle ? `<div class="os-av-s">${esc(a.detalle)}</div>` : ''}
        ${a.enlace ? `<a class="os-av-acc" href="${esc(a.enlace)}"${interno ? '' : ' target="_blank" rel="noopener"'}>${a.enlace.includes('zoho.eu') ? 'Zoho ↗' : interno ? 'Abrir' : 'App ↗'}</a>` : ''}
      </div></div>`;
    }).join('') || '<p class="nota os-av-vacio">✅ Nada pendiente.</p>'}</div>
    <div class="os-av-pie"><span>El mismo motor que el puesto de mando y el bot.</span><a href="#/direccion">Puesto de mando →</a></div>`;
}

// ── Acciones ────────────────────────────────────────────────────────────────
registrarAcciones({
  osEntrar() {
    if (innerWidth < ANCHO_MINIMO) { toast('El modo escritorio necesita una pantalla de 1024 px o más', 'error'); return; }
    guardar(CLAVE_ACTIVO, '1');
    if (_raiz ?? document.getElementById('app')) pintarEscritorio((_raiz ?? document.getElementById('app'))!);
    const { id, params } = rutaActual();
    if (id !== 'inicio') ir(id, ...params);
  },
  osSalir() {
    guardar(CLAVE_ACTIVO, null);
    quitarEscritorio();
    const { id, params } = rutaActual();
    ir(id, ...params);
  },
  osAbrir(id: string) {
    if (id === 'inicio') { ir('inicio'); return; }
    const v = ventanaDe(id);
    if (v && !v.min && ventanaFrente()?.id === id) { v.min = true; aplicarGeometria(v); guardarEstado(); pintarDock(); return; }
    if (v) { enfocar(id); ir(id, ...v.params); return; }
    ir(id);
  },
  osMinimizar(id: string) { const v = ventanaDe(id); if (!v) return; v.min = true; aplicarGeometria(v); guardarEstado(); const f = ventanaFrente(); if (f) enfocar(f.id); else pintarDock(); },
  osMaximizar(id: string) { encajar(id, 'max'); },
  osCerrar(id: string) { cerrarVentana(id); },
  osEscritorio(i: string) {
    const n = Number(i);
    if (!_estado.escritorios[n] || n === _estado.activo) return;
    _estado.activo = n; guardarEstado();
    pintarEscritorio(_raiz!);
  },
  osNuevoEscritorio() {
    const nombre = prompt('Nombre del escritorio nuevo', `Escritorio ${_estado.escritorios.length + 1}`)?.trim();
    if (!nombre) return;
    _estado.escritorios.push({ nombre, ventanas: [] });
    _estado.activo = _estado.escritorios.length - 1;
    guardarEstado();
    pintarEscritorio(_raiz!);
  },
  osRenombrarEscritorio() {
    document.getElementById('os-menu')!.hidden = true;
    const nombre = prompt('Nuevo nombre', escritorio().nombre)?.trim();
    if (!nombre) return;
    escritorio().nombre = nombre; guardarEstado(); pintarEscritorios();
  },
  osEliminarEscritorio() {
    document.getElementById('os-menu')!.hidden = true;
    if (_estado.escritorios.length < 2) { toast('Tiene que quedar al menos un escritorio', 'error'); return; }
    if (!confirm(`¿Eliminar el escritorio «${escritorio().nombre}» y cerrar sus ventanas?`)) return;
    _estado.escritorios.splice(_estado.activo, 1);
    _estado.activo = Math.max(0, _estado.activo - 1);
    guardarEstado();
    pintarEscritorio(_raiz!);
  },
  osRecolocarWidgets() {
    document.getElementById('os-menu')!.hidden = true;
    delete escritorio().widgets;
    guardarEstado();
    colocarWidgets();
  },
  osMenu() { const m = document.getElementById('os-menu')!; m.hidden = !m.hidden; },
  osAvisos() {
    const a = document.getElementById('os-avisos')!;
    a.hidden = !a.hidden;
    if (!a.hidden) pintarCentroAvisos();
  },
  osAvisosMios(v: string) { _soloMios = v === '1'; pintarCentroAvisos(); },
  osLanzador(abrir: string) {
    const l = document.getElementById('os-lanzador')!;
    l.hidden = abrir !== '1';
    if (!l.hidden) pintarLanzador();
  },
  osClaude() { abrirBuscador('claude'); },
});

// Un clic fuera cierra el menú del avatar.
document.addEventListener('click', e => {
  const m = document.getElementById('os-menu');
  if (m && !m.hidden && !(e.target as Element).closest('#os-menu, [data-action="osMenu"]')) m.hidden = true;
});
