// Dock del modo escritorio, estilo macOS (diseño «Dock del hub», 2026-10-03):
// · Aumento: el icono bajo el puntero crece y los vecinos menos (coseno sobre
//   la distancia, medida con el dock EN REPOSO para que no tiemble al crecer).
// · Rebote al abrir una pantalla nueva; punto debajo de lo abierto.
// · Fijas por persona EN LA BASE (`hub.dock_fijas`, una fila por persona, RLS
//   «propia»), con copia en localStorage para pintar al instante. Sin fila,
//   las de siempre (las primeras del menú). Tres gestos: clic derecho →
//   Mantener/Quitar; arrastrar desde «Todas» o dentro del dock (ordena);
//   sacarlo hacia arriba lo quita. Panel, Oki, Claude y «Todas» van siempre.
// Prefijo: os-d.
import { usuario } from '../core/estado';
import { API } from '../core/api';
import { esc, toast } from '../ui/dom';
import { iconoHex } from './iconos';

const BASE = 48, HUECO = 6, RELLENO = 10, SEP = 13;
const AUMENTO = 1.85, ALCANCE = 150, REBOTE_MS = 1100;

interface Config {
  repintar: () => void; defecto: () => string[]; titulo: (id: string) => string; abierta: (id: string) => boolean; cerrarLanzador: () => void;
  estado?: (id: string) => { minimizada: boolean; delante: boolean; nota?: string; tono?: string };
}

// Iconos de línea de 16 px para las opciones del menú (el trazo es el del texto).
const ICONO_MENU: Record<string, string> = {
  abrir: '<path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/>',
  minimizar: '<path d="M3.5 11.5h9"/>',
  cerrar: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  fijar: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3.5 13.5h9"/>',
  quitar: '<path d="M8 13.5v-8M4.5 9 8 5.5 11.5 9M3.5 2.5h9"/>',
};
const opcion = (accion: string, id: string, icono: string, texto: string, clase = '') =>
  `<button role="menuitem" class="${clase}" data-action="${accion}" data-p0="${esc(id)}"><svg class="os-dmenu-ico" viewBox="0 0 16 16" aria-hidden="true">${ICONO_MENU[icono]}</svg>${esc(texto)}</button>`;
let _cfg: Config | null = null;
let _fijas: string[] | null = null;
let _rebote: { id: string; t: number } | null = null;
let _x: number | null = null;          // última x del puntero en el dock (para repintar con el aumento puesto)
let _arrastrando = false;

const claveCache = () => `hub_dock_${usuario()?.id ?? 'anon'}`;

// ── Fijas ───────────────────────────────────────────────────────────────────
export function fijas(): string[] { return _fijas ?? _cfg?.defecto() ?? []; }
export const estaFija = (id: string) => fijas().includes(id);

export async function cargarFijas() {
  try { const c = JSON.parse(localStorage.getItem(claveCache()) ?? 'null'); if (Array.isArray(c)) _fijas = c; } catch { /* sin caché */ }
  const u = usuario();
  if (!u) return;
  const { data, error } = await API.get<{ modulos: string[] }[]>('dock_fijas', { select: 'modulos', usuario_id: `eq.${u.id}`, limit: '1' });
  if (error) return;                     // sin red: se queda la copia local
  const nuevas = data?.[0]?.modulos ?? null;
  if (JSON.stringify(nuevas) === JSON.stringify(_fijas)) return;
  _fijas = nuevas;
  cachear();
  _cfg?.repintar();
}

function cachear() { try { if (_fijas) localStorage.setItem(claveCache(), JSON.stringify(_fijas)); else localStorage.removeItem(claveCache()); } catch { /* sin almacenamiento */ } }

export async function guardarFijas(lista: string[]) {
  const antes = _fijas;
  _fijas = [...new Set(lista)];
  cachear();
  _cfg?.repintar();
  const u = usuario();
  if (!u) return;
  const { error } = await API.upsert('dock_fijas', 'usuario_id', { usuario_id: u.id, modulos: _fijas, updated_at: new Date().toISOString() });
  if (error) { _fijas = antes; cachear(); _cfg?.repintar(); toast(`No se pudo guardar el dock: ${error.message}`, 'error'); }
}

export function fijar(id: string, en?: number) {
  cerrarMenu();
  const l = fijas().filter(x => x !== id);
  l.splice(en ?? l.length, 0, id);
  void guardarFijas(l);
}
export function quitar(id: string) { cerrarMenu(); void guardarFijas(fijas().filter(x => x !== id)); }

// ── Rebote ──────────────────────────────────────────────────────────────────
export function rebotar(id: string) { _rebote = { id, t: performance.now() }; }

// ── Pintar (lo llama pintarDock de escritorio.ts tras rellenar el dock) ─────
// Tamaño de reposo: 48 px salvo que no quepan; y los centros en reposo.
export function trasPintar(dock: HTMLElement) {
  const items = [...dock.children] as HTMLElement[];
  const n = items.filter(e => !e.classList.contains('os-dsep')).length;
  const seps = items.length - n;
  const cabe = Math.floor((innerWidth - 48 - RELLENO * 2 - seps * (SEP + HUECO)) / n) - HUECO;
  const base = Math.max(30, Math.min(BASE, cabe));
  dock.style.setProperty('--os-dbase', `${base}px`);
  dock.dataset.base = String(base);
  if (_rebote && performance.now() - _rebote.t < REBOTE_MS) {
    const el = dock.querySelector<HTMLElement>(`[data-mod="${CSS.escape(_rebote.id)}"]`);
    if (el) { el.classList.add('os-rebota'); el.style.animationDelay = `${-(performance.now() - _rebote.t)}ms`; }
  }
  if (_x != null && !_arrastrando) aumentar(dock, _x);
}

function centrosEnReposo(dock: HTMLElement) {
  const base = Number(dock.dataset.base) || BASE;
  let x = RELLENO;
  const c = ([...dock.children] as HTMLElement[]).map(e => {
    const w = e.classList.contains('os-dsep') ? SEP : base;
    const m = x + w / 2; x += w + HUECO; return m;
  });
  return { base, c, ancho: x - HUECO + RELLENO };
}

function aumentar(dock: HTMLElement, clientX: number) {
  const { base, c, ancho } = centrosEnReposo(dock);
  const r = dock.getBoundingClientRect();
  const x = clientX - (r.left + r.width / 2) + ancho / 2;   // el dock crece por igual a los dos lados
  ([...dock.children] as HTMLElement[]).forEach((e, i) => {
    if (e.classList.contains('os-dsep')) return;
    const d = Math.abs(x - c[i]);
    const k = d < ALCANCE ? (Math.cos(d / ALCANCE * Math.PI) + 1) / 2 : 0;
    e.style.width = `${(base * (1 + (AUMENTO - 1) * k)).toFixed(1)}px`;
  });
}

function reposo(dock: HTMLElement) {
  for (const e of dock.children) (e as HTMLElement).style.width = '';
}

// ── Gestos (una vez por escritorio pintado) ─────────────────────────────────
export function instalarDock(dock: HTMLElement, lanzador: HTMLElement, cfg: Config) {
  _cfg = cfg;
  const quieto = matchMedia('(prefers-reduced-motion: reduce)');
  dock.addEventListener('pointermove', e => {
    if (_arrastrando || e.pointerType === 'touch' || quieto.matches || document.getElementById('os-dmenu')) return;
    _x = e.clientX; dock.classList.add('os-aumentando'); aumentar(dock, e.clientX);
  });
  dock.addEventListener('pointerleave', () => { _x = null; dock.classList.remove('os-aumentando'); reposo(dock); });

  // Clic derecho: Mantener / Quitar (en el dock y en «Todas»).
  const menu = (e: MouseEvent) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-mod]');
    if (!el) return;
    e.preventDefault();
    // Con el menú abierto el dock vuelve al reposo (si no, los iconos crecidos quedan debajo del menú).
    _x = null; dock.classList.remove('os-aumentando'); reposo(dock);
    abrirMenu(el.dataset.mod!, e.clientX, e.clientY, el.closest('#os-dock') ? el.getBoundingClientRect() : null);
  };
  dock.addEventListener('contextmenu', menu);
  lanzador.addEventListener('contextmenu', menu);

  // Arrastrar: dentro del dock ordena; desde «Todas» fija; hacia arriba quita.
  const empezar = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = (e.target as Element).closest<HTMLElement>('[data-mod]');
    if (el) prepararArrastre(e, el, dock);
  };
  dock.addEventListener('pointerdown', empezar);
  lanzador.addEventListener('pointerdown', empezar);
  lanzador.addEventListener('dragstart', e => e.preventDefault());  // nada de arrastre nativo del enlace
}

export function cerrarMenu() { document.getElementById('os-dmenu')?.remove(); }

function abrirMenu(id: string, x: number, y: number, sobre: DOMRect | null) {
  cerrarMenu();
  const m = document.createElement('div');
  m.id = 'os-dmenu';
  m.className = 'os-menu os-dmenu';
  m.setAttribute('role', 'menu');
  const fija = estaFija(id);
  const abierta = !!_cfg?.abierta(id);
  const e = _cfg?.estado?.(id);
  const titulo = _cfg?.titulo(id) ?? id;
  const sub = [abierta ? (e?.minimizada ? 'Minimizada' : e?.delante ? 'Delante' : 'Abierta') : 'Sin abrir', fija ? 'en el dock' : ''].filter(Boolean).join(' · ');
  m.innerHTML = `<div class="os-menu-cab os-dmenu-cab">${iconoHex(id, titulo, 'os-dmenu-hex')}<span><b>${esc(titulo)}</b><span>${esc(sub)}</span>${e?.nota ? `<span class="os-dmenu-nota ${e.tono === 'mal' ? 'g-mal' : ''}">${esc(e.nota)}</span>` : ''}</span></div>
    ${!abierta || e?.minimizada || !e?.delante ? opcion('osAbrir', id, 'abrir', abierta ? 'Traer delante' : 'Abrir') : opcion('osMinimizar', id, 'minimizar', 'Minimizar')}
    ${abierta ? opcion('osCerrar', id, 'cerrar', 'Cerrar la ventana') : ''}
    <div class="os-dmenu-sep" role="separator"></div>
    ${fija ? opcion('osDockQuitar', id, 'quitar', 'Quitar del dock', 'os-menu-peligro') : opcion('osDockFijar', id, 'fijar', 'Mantener en el dock')}`;
  document.getElementById('os-root')!.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, (sobre ? sobre.left + sobre.width / 2 : x) - w / 2));
  m.style.left = `${left}px`;
  m.style.top = `${Math.max(8, sobre ? sobre.top - h - 10 : y - h - 6)}px`;
  (m.querySelector('button') as HTMLElement | null)?.focus();
}

// Un clic fuera lo cierra; uno en una opción, en cuanto la acción ha salido.
document.addEventListener('click', e => {
  const t = e.target as Element;
  if (t.closest?.('#os-dmenu button')) setTimeout(cerrarMenu);
  else if (!t.closest?.('#os-dmenu')) cerrarMenu();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenu(); });

function prepararArrastre(e0: PointerEvent, el: HTMLElement, dock: HTMLElement) {
  const id = el.dataset.mod!;
  const desdeDock = !!el.closest('#os-dock');
  const eraFija = estaFija(id);
  let fantasma: HTMLElement | null = null, hueco: HTMLElement | null = null;
  let fuera = false;

  const sitioHueco = (x: number) => {
    // El hueco va entre las fijas (las que no son la arrastrada).
    const fijasEl = [...dock.querySelectorAll<HTMLElement>('.os-ditem[data-fija]')].filter(f => f !== el);
    const antes = fijasEl.find(f => { const r = f.getBoundingClientRect(); return x < r.left + r.width / 2; });
    const tras = fijasEl.at(-1) ?? dock.querySelector('.os-oki');
    if (antes) dock.insertBefore(hueco!, antes); else tras?.after(hueco!);
  };

  const mover = (e: PointerEvent) => {
    if (!fantasma) {
      if (Math.hypot(e.clientX - e0.clientX, e.clientY - e0.clientY) < 6) return;
      _arrastrando = true;
      cerrarMenu();
      _cfg?.cerrarLanzador();
      reposo(dock);
      dock.classList.add('os-darrastre');
      fantasma = document.createElement('div');
      fantasma.className = 'os-dfantasma';
      fantasma.innerHTML = `${iconoHex(id, _cfg?.titulo(id) ?? id)}<span class="os-dfantasma-txt">Quitar</span>`;
      document.body.appendChild(fantasma);
      hueco = document.createElement('span');
      hueco.className = 'os-dhueco';
      if (desdeDock) el.classList.add('os-doculto');
    }
    fantasma.style.transform = `translate(${e.clientX - 30}px, ${e.clientY - 32}px)`;
    const r = dock.getBoundingClientRect();
    const enDock = e.clientY > r.top - 40 && e.clientY < r.bottom + 20 && e.clientX > r.left - 40 && e.clientX < r.right + 40;
    fuera = !enDock && desdeDock && e.clientY < r.top - 60;
    fantasma.classList.toggle('quitar', fuera && eraFija);
    if (enDock) sitioHueco(e.clientX); else hueco!.remove();
  };

  const acabar = (cancelar: boolean) => {
    removeEventListener('pointermove', mover);
    removeEventListener('pointerup', soltar);
    removeEventListener('pointercancel', anular);
    removeEventListener('keydown', tecla, true);
    if (!fantasma) return;
    // El clic que sigue al soltar (si lo hay: solo sale si se suelta sobre el
    // mismo elemento) no abre nada; y si no llega, no se queda esperando al siguiente.
    const comer = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };
    addEventListener('click', comer, { capture: true, once: true });
    setTimeout(() => { removeEventListener('click', comer, true); _arrastrando = false; });
    dock.classList.remove('os-darrastre');
    const f = fantasma;
    if (!cancelar && hueco?.isConnected) {
      // Orden nuevo: las fijas tal como quedan en el dock, con esta en el hueco.
      const orden = [...dock.querySelectorAll<HTMLElement>('.os-ditem[data-fija], .os-dhueco')]
        .filter(x => x !== el).map(x => x === hueco ? id : x.dataset.mod!);
      hueco.remove();
      f.remove();
      void guardarFijas(orden);
      return;
    }
    hueco?.remove();
    if (!cancelar && fuera && eraFija) {
      f.classList.add('os-dpuf');
      setTimeout(() => f.remove(), 320);
      quitar(id);
      return;
    }
    f.remove();
    el.classList.remove('os-doculto');
    _cfg?.repintar();
  };
  const soltar = () => acabar(false);
  const anular = () => acabar(true);
  const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); acabar(true); } };
  addEventListener('pointermove', mover);
  addEventListener('pointerup', soltar);
  addEventListener('pointercancel', anular);
  addEventListener('keydown', tecla, true);
}
