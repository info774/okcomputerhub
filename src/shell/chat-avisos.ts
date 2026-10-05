// Avisos del chat dentro del hub (paridad bloque 8, tanda 5: chat-notifs.js
// de la app), además del push (que el service worker solo enseña con el hub
// fuera de la vista):
//   · Un vigilante mira hub.chat_resumen cada 20 s (y al volver a la
//     pestaña); por cada conversación con mensajes nuevos de otro suena su
//     TONO y sale un aviso arriba a la derecha (con la vista previa, si no se
//     ha quitado), salvo que esté SILENCIADA o abierta delante.
//   · «(N) » delante del título de la pestaña con lo que queda por leer.
//   · Tonos: los ocho de la app (Web Audio, sin ficheros), uno automático por
//     conversación y remitente o el que se elija, y el SONIDO PROPIO (un audio
//     del usuario, en IndexedDB de este dispositivo, máx. 2 MB, se corta a 8 s).
//   · Silenciar una conversación 1 h, 8 h o siempre; quitar el sonido o la
//     vista previa para todas.
// Las preferencias van en localStorage por persona (`hub_chat_avisos_<id>`),
// como en la app. Prefijo de ids: cha-.
import { API } from '../core/api';
import { usuario } from '../core/estado';
import { equipo, nombreDe } from '../core/equipo';
import { registrarAcciones } from '../core/dispatcher';
import { esc, toast } from '../ui/dom';
import { ico } from './linea';

// [frecuencia Hz, inicio ms, duración ms] (CHAT_TONES de la app, tal cual).
export const TONOS: Record<string, { nombre: string; notas: [number, number, number][] }> = {
  clasico: { nombre: 'Clásico', notas: [[880, 0, 90], [587.33, 110, 160]] },
  campana: { nombre: 'Campana', notas: [[1318.5, 0, 280], [1318.5, 320, 420]] },
  burbuja: { nombre: 'Burbuja', notas: [[523.25, 0, 70], [783.99, 80, 70], [1046.5, 160, 110]] },
  triple: { nombre: 'Tres notas', notas: [[659.25, 0, 90], [830.61, 110, 90], [987.77, 220, 150]] },
  suave: { nombre: 'Suave', notas: [[440, 0, 220]] },
  timbre: { nombre: 'Timbre', notas: [[987.77, 0, 100], [659.25, 130, 200]] },
  xilofono: { nombre: 'Xilófono', notas: [[1046.5, 0, 80], [1318.5, 100, 80], [1567.98, 200, 80], [2093, 300, 140]] },
  alerta: { nombre: 'Alerta', notas: [[740, 0, 90], [740, 140, 90], [740, 280, 90]] },
};
export const PROPIO = 'propio';
const CLAVES = Object.keys(TONOS);
const MAX_BYTES = 2 * 1024 * 1024, MAX_SEGUNDOS = 8, CADA_MS = 20_000;

interface PrefCanal { tono?: string; silencio?: string }   // silencio: ISO hasta cuándo, o 'siempre'
interface Prefs { sonido: boolean; vistaPrevia: boolean; propio?: { nombre: string; bytes: number } | null; canales: Record<string, PrefCanal> }
interface Resumen { id: string; nombre: string | null; tipo: string; miembros: string[]; ultimo_at: string; sin_leer: number; ultimo_texto: string | null }

const claveLS = () => `hub_chat_avisos_${usuario()?.id ?? 'anon'}`;
export function prefs(): Prefs {
  try { return { sonido: true, vistaPrevia: true, canales: {}, ...JSON.parse(localStorage.getItem(claveLS()) ?? '{}') }; }
  catch { return { sonido: true, vistaPrevia: true, canales: {} }; }
}
function guardar(p: Prefs) { try { localStorage.setItem(claveLS(), JSON.stringify(p)); } catch { /* sin almacenamiento */ } }

export function silenciada(canal: string, p = prefs()): boolean {
  const s = p.canales[canal]?.silencio;
  return s === 'siempre' || (!!s && new Date(s).getTime() > Date.now());
}
// Uno por conversación y remitente, estable (el _hashTone de la app).
export function tonoAuto(canal: string, remitente = ''): string {
  let h = 0;
  for (const ch of `${canal}:${remitente}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLAVES[h % CLAVES.length];
}
export function tonoDe(canal: string, remitente = '', p = prefs()): string {
  const t = p.canales[canal]?.tono;
  if (t === PROPIO && p.propio) return PROPIO;
  return t && TONOS[t] ? t : tonoAuto(canal, remitente);
}

// ── Sonido ──────────────────────────────────────────────────────────────────
let _ac: AudioContext | null = null;
function ctx(): AudioContext | null {
  const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  _ac ??= new AC();
  if (_ac!.state === 'suspended') void _ac!.resume().catch(() => {});
  return _ac;
}
export function sonar(tono: string) {
  if (tono === PROPIO) { void sonarPropio(); return; }
  const t = TONOS[tono], c = ctx();
  if (!t || !c) return;
  const ahora = c.currentTime;
  for (const [f, ini, dur] of t.notas) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const t0 = ahora + ini / 1000, t1 = t0 + dur / 1000;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t1);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t1 + 0.05);
  }
}

// El sonido propio vive en IndexedDB (no cabe en localStorage) y no sale del dispositivo.
const BD = 'hub-chat-sonido';
function bd(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sonidos');
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
async function bdHacer<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await bd();
  return new Promise((ok, mal) => { const r = fn(d.transaction('sonidos', modo).objectStore('sonidos')); r.onsuccess = () => ok(r.result as T); r.onerror = () => mal(r.error); });
}
let _audio: HTMLAudioElement | null = null;
async function sonarPropio() {
  try {
    const blob = await bdHacer<Blob | undefined>('readonly', s => s.get(usuario()?.id ?? 'anon'));
    if (!blob) { sonar(CLAVES[0]); return; }
    _audio?.pause();
    _audio = new Audio(URL.createObjectURL(blob));
    void _audio.play().catch(() => {});
    const a = _audio;
    setTimeout(() => a.pause(), MAX_SEGUNDOS * 1000);
  } catch { sonar(CLAVES[0]); }
}

// ── Vigilante ───────────────────────────────────────────────────────────────
let _visto = new Map<string, number>();   // canal → sin_leer de la vez anterior
let _primera = true;
let _timer = 0;
let _base = document.title;

export function ponerTitulo(base?: string) {
  if (base) _base = base;
  const n = [..._visto.values()].reduce((a, x) => a + x, 0);
  document.title = n ? `(${n > 99 ? '99+' : n}) ${_base}` : _base;
}

const canalAbierto = (id: string) => document.visibilityState === 'visible' && location.hash === `#/chat/${id}`;

function aviso(r: Resumen, remitente: string | null, p: Prefs) {
  let caja = document.getElementById('cha-avisos');
  if (!caja) { caja = document.createElement('div'); caja.id = 'cha-avisos'; caja.className = 'cha-avisos'; caja.setAttribute('aria-live', 'polite'); document.body.appendChild(caja); }
  document.getElementById(`cha-a-${r.id}`)?.remove();
  const sala = r.tipo === 'grupo' ? `# ${r.nombre ?? 'grupo'}` : r.tipo === 'ficha' ? r.nombre ?? 'Ficha' : null;
  const el = document.createElement('a');
  el.id = `cha-a-${r.id}`; el.className = 'tarjeta cha-aviso'; el.href = `#/chat/${r.id}`;
  el.innerHTML = `<span class="cha-ico">${ico('mensaje')}</span><span><strong>${esc(remitente ?? 'Mensaje nuevo')}</strong>${sala ? ` <small class="nota">en ${esc(sala)}</small>` : ''}
    <br><small>${p.vistaPrevia ? esc((r.ultimo_texto ?? '').slice(0, 120)) : 'Mensaje nuevo'}</small></span>`;
  el.addEventListener('click', () => el.remove());
  caja.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

async function mirar() {
  if (!usuario()) return;
  const { data, error } = await API.rpc<Resumen[]>('chat_resumen');
  if (error || !data) return;
  const p = prefs();
  const nuevas = _primera ? [] : data.filter(r => r.sin_leer > (_visto.get(r.id) ?? 0) && !silenciada(r.id, p) && !canalAbierto(r.id));
  _visto = new Map(data.map(r => [r.id, r.sin_leer]));
  _primera = false;
  ponerTitulo();
  if (nuevas.length) await equipo().catch(() => []);   // para nombreDe
  for (const r of nuevas.slice(0, 3)) {
    // Quién escribió lo último (para el nombre y su tono).
    const { data: m } = await API.get<{ autor_id: string | null }[]>('chat_mensajes', { select: 'autor_id', canal_id: `eq.${r.id}`, order: 'created_at.desc', limit: '1' });
    const autor = m?.[0]?.autor_id ?? '';
    if (p.sonido) sonar(tonoDe(r.id, autor, p));
    aviso(r, nombreDe(autor) || null, p);
  }
}

/** Arranca el vigilante (una vez, tras entrar). */
export function vigilarChat() {
  if (_timer) return;
  void mirar();
  _timer = window.setInterval(() => { if (document.visibilityState === 'visible') void mirar(); }, CADA_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void mirar(); });
}
/** Al leer una conversación, que el título no espere al siguiente repaso. */
export function marcarLeida(canal: string) { _visto.set(canal, 0); ponerTitulo(); }

// ── Ajustes (por conversación y para todas) ────────────────────────────────
export function panelAvisos(canal: string): string {
  const p = prefs(), c = p.canales[canal] ?? {}, auto = tonoAuto(canal);
  const sil = c.silencio === 'siempre' ? 'siempre' : silenciada(canal, p) ? `hasta las ${new Date(c.silencio!).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : '';
  return `<div class="tarjeta cha-panel" id="cha-panel">
    <h4>Avisos de esta conversación</h4>
    <div class="in-campos"><label>Tono <select id="cha-tono" data-on-change="chaTono:${esc(canal)},$value">
        <option value="">Automático (${esc(TONOS[auto].nombre)})</option>${CLAVES.map(k => `<option value="${k}" ${c.tono === k ? 'selected' : ''}>${esc(TONOS[k].nombre)}</option>`).join('')}
        ${p.propio ? `<option value="${PROPIO}" ${c.tono === PROPIO ? 'selected' : ''}>Mi sonido (${esc(p.propio.nombre)})</option>` : ''}</select></label>
      <div class="acciones"><button type="button" class="btn secundario" data-action="chaProbar" data-p0="${esc(canal)}">${ico('play')} Probar</button></div></div>
    <p class="nota">${sil ? `Silenciada ${esc(sil)}.` : 'Suena y avisa.'}</p>
    <div class="segmentado">${[['1h', '1 hora'], ['8h', '8 horas'], ['siempre', 'Siempre'], ['no', 'Quitar silencio']].map(([k, t]) => `<button type="button" data-action="chaSilenciar" data-p0="${esc(canal)}" data-p1="${k}">${t}</button>`).join('')}</div>
    <h4>Para todas</h4>
    <label class="check"><input type="checkbox" id="cha-sonido" ${p.sonido ? 'checked' : ''} data-on-change="chaGlobal:sonido,$checked"> Sonido</label>
    <label class="check"><input type="checkbox" id="cha-previa" ${p.vistaPrevia ? 'checked' : ''} data-on-change="chaGlobal:vistaPrevia,$checked"> Vista previa del mensaje en el aviso</label>
    <div class="acciones"><label class="btn secundario cha-subir">${ico('subir')} ${p.propio ? 'Cambiar mi sonido' : 'Subir mi sonido'}<input type="file" id="cha-fichero" accept="audio/*" data-on-change="chaSubir:$this" hidden></label>
      ${p.propio ? '<button type="button" class="btn secundario" data-action="chaQuitarSonido">Quitar mi sonido</button>' : ''}</div>
    <p class="nota">Tu sonido se queda en este dispositivo (máx. 2 MB; suenan los primeros ${MAX_SEGUNDOS} s).</p></div>`;
}
function repintarPanel(canal: string) { const el = document.getElementById('cha-panel'); if (el) el.outerHTML = panelAvisos(canal); }

registrarAcciones({
  chaTono(canal: string, tono: string) {
    const p = prefs();
    p.canales[canal] = { ...p.canales[canal], tono: tono || undefined };
    guardar(p);
    if (tono) sonar(tono);
  },
  chaProbar(canal: string) { sonar(tonoDe(canal)); },
  chaSilenciar(canal: string, que: string) {
    const p = prefs();
    const silencio = que === 'siempre' ? 'siempre' : que === '1h' ? new Date(Date.now() + 3600e3).toISOString() : que === '8h' ? new Date(Date.now() + 8 * 3600e3).toISOString() : undefined;
    p.canales[canal] = { ...p.canales[canal], silencio };
    guardar(p);
    toast(silencio ? 'Conversación silenciada' : 'Vuelve a sonar');
    repintarPanel(canal);
  },
  chaGlobal(campo: string, v: boolean) {
    const p = prefs();
    if (campo === 'sonido') p.sonido = v; else if (campo === 'vistaPrevia') p.vistaPrevia = v;
    guardar(p);
  },
  async chaSubir(input: HTMLInputElement) {
    const f = input.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('audio/')) { toast('Tiene que ser un audio', 'error'); return; }
    if (f.size > MAX_BYTES) { toast('Ese audio pesa más de 2 MB', 'error'); return; }
    try { await bdHacer('readwrite', s => s.put(f, usuario()?.id ?? 'anon')); }
    catch { toast('Este navegador no deja guardar el sonido', 'error'); return; }
    const p = prefs(); p.propio = { nombre: f.name.slice(0, 60), bytes: f.size }; guardar(p);
    toast('Tu sonido está guardado: elígelo en el tono');
    const canal = location.hash.match(/^#\/chat\/([0-9a-f-]{36})/)?.[1];
    if (canal) repintarPanel(canal);
  },
  async chaQuitarSonido() {
    try { await bdHacer('readwrite', s => s.delete(usuario()?.id ?? 'anon')); } catch { /* ya no estaba */ }
    const p = prefs(); p.propio = null;
    for (const c of Object.values(p.canales)) if (c.tono === PROPIO) delete c.tono;
    guardar(p);
    toast('Sonido quitado');
    const canal = location.hash.match(/^#\/chat\/([0-9a-f-]{36})/)?.[1];
    if (canal) repintarPanel(canal);
  },
});
