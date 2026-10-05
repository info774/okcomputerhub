// Asistente de voz del hub (paridad: ui/voice.js de la app; decisión de Fran
// 2026-10-05: micro en la cabecera de todas las pantallas y la voz de Oki
// usa el mismo asistente). Flujo, como la app:
//   escuchar (reconocimiento del navegador si lo hay; si no, se graba y lo
//   pasa a texto Groq en la función `comandas`) o escribir → función `voz`
//   (Groq, Claude de reserva) → si la respuesta trae [[ACCION]]{…}, la
//   ejecuta `voz-acciones.ts` aquí, en el navegador (deshacer, cola, áreas) →
//   el resultado vuelve al historial para que el modelo entienda «abre el
//   segundo» → se lee en voz alta. Manos libres: al acabar de hablar, vuelve a
//   escuchar (solo con el reconocimiento del navegador). Prefijo de ids: vz-.
import { llamarFuncion } from '../core/funciones';
import { registrarAcciones } from '../core/dispatcher';
import { esc } from './dom';
import { ico } from '../shell/linea';
import { grabando, grabarYTranscribir, pararGrabacion, puedeDictar } from './dictado';
import type { Resultado } from './voz-acciones';

type Turno = { role: 'user' | 'assistant'; content: string };
const MAX_TURNOS = 20;
const LANG = 'es-ES';
let _historial: Turno[] = [];
let _estado: 'quieto' | 'escucha' | 'piensa' | 'habla' = 'quieto';
let _sr: any = null;
let _leer = leerPref('hub_voz_leer', true);
let _manos = leerPref('hub_voz_manos', false);
let _vozEs: SpeechSynthesisVoice | null = null;

function leerPref(k: string, def: boolean) { try { const v = localStorage.getItem(k); return v == null ? def : v === '1'; } catch { return def; } }
function guardarPref(k: string, v: boolean) { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }
const SR = () => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;

/** ¿Hay asistente? (alguna clave puesta en la función `voz`). Se pregunta una vez. */
let _disponible: Promise<boolean> | null = null;
export function asistenteDisponible(): Promise<boolean> {
  return (_disponible ??= llamarFuncion<{ groq: boolean; claude: boolean }>('voz', { accion: 'estado' }, 8000)
    .then(r => !!(r.data && (r.data.groq || r.data.claude))).catch(() => false));
}

// ── La ventana ──────────────────────────────────────────────────────────────
function montar(): HTMLDialogElement {
  let d = document.getElementById('vz') as HTMLDialogElement | null;
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'vz'; d.className = 'vz'; d.setAttribute('aria-label', 'Asistente de voz');
  d.innerHTML = `<header class="vz-cab"><h2>${ico('micro')} Asistente</h2><span class="nota" id="vz-estado" aria-live="polite"></span>
      <button type="button" class="icono-btn" data-action="vozCerrar" aria-label="Cerrar">${ico('cerrar')}</button></header>
    <div id="vz-conv" class="vz-conv" aria-live="polite"><p class="nota" id="vz-bienvenida">Dime qué necesitas: «¿qué tengo hoy?», «busca los trabajos pendientes del hotel Oasis», «conéctame al bar Manolo», «¿cuántas horas llevo?»…</p></div>
    <div id="vz-aviso" class="aviso" hidden></div>
    <div class="vz-pie">
      <button type="button" id="vz-mic" class="vz-mic" data-action="vozMic" aria-label="Hablar" aria-pressed="false">${ico('micro')}</button>
      <form class="vz-escribir" data-on-submit="vozEnviarTexto" data-prevent="1"><input id="vz-texto" autocomplete="off" placeholder="O escríbelo…" aria-label="Escribe al asistente">
        <button class="btn secundario" type="submit">${ico('enviar')}</button></form>
    </div>
    <div class="acciones vz-opciones">
      <label class="check"><input type="checkbox" id="vz-leer" ${_leer ? 'checked' : ''} data-on-change="vozLeer:$checked"> Leer en voz alta</label>
      <label class="check" title="${SR() ? 'Al acabar de hablar vuelve a escuchar' : 'Necesita el reconocimiento de voz del navegador (Chrome)'}"><input type="checkbox" id="vz-manos" ${_manos ? 'checked' : ''} ${SR() ? '' : 'disabled'} data-on-change="vozManos:$checked"> Manos libres</label>
      <button type="button" class="btn secundario" data-action="vozBorrar">Empezar de nuevo</button></div>`;
  d.addEventListener('close', () => { pararTodo(); });
  document.body.appendChild(d);
  if ('speechSynthesis' in window) { const c = () => { const vs = speechSynthesis.getVoices(); _vozEs = vs.find(v => v.lang === LANG) ?? vs.find(v => v.lang?.toLowerCase().startsWith('es')) ?? null; }; c(); speechSynthesis.onvoiceschanged = c; }
  return d;
}

function setEstado(e: typeof _estado, texto = '') {
  _estado = e;
  const b = document.getElementById('vz-mic');
  b?.classList.toggle('escuchando', e === 'escucha'); b?.classList.toggle('pensando', e === 'piensa');
  b?.setAttribute('aria-pressed', String(e === 'escucha'));
  const s = document.getElementById('vz-estado');
  if (s) s.textContent = texto || { quieto: '', escucha: 'Escuchando… pulsa para acabar', piensa: 'Pensando…', habla: 'Hablando…' }[e];
}
function avisar(t: string | null) { const a = document.getElementById('vz-aviso'); if (a) { a.textContent = t ?? ''; a.hidden = !t; } }

function burbuja(rol: 'user' | 'assistant', texto: string) {
  const c = document.getElementById('vz-conv');
  if (!c) return;
  document.getElementById('vz-bienvenida')?.remove();
  const p = document.createElement('p');
  p.className = `vz-burbuja vz-${rol}`; p.textContent = texto;
  c.appendChild(p); c.scrollTop = c.scrollHeight;
}

let _ultimos: Resultado[] = [];
function pintarResultados(rs: Resultado[]) {
  const c = document.getElementById('vz-conv');
  if (!c || !rs.length) return;
  _ultimos = rs;
  const ul = document.createElement('ul');
  ul.className = 'vz-res';
  ul.innerHTML = rs.map((r, i) => `<li><button type="button" data-action="vozAbrirRes" data-p0="${i}"><strong>${esc(r.titulo)}</strong>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}<span aria-hidden="true">${ico('derecha')}</span></button></li>`).join('');
  c.appendChild(ul); c.scrollTop = c.scrollHeight;
}

async function abrirResultado(r: Resultado) {
  if (r.tipo === 'remoto' && r.remoto && r.localId) { const { abrirRemoto } = await import('../modulos/sitios/equipamiento'); await abrirRemoto(r.remoto, r.localId); return; }
  // Un lugar de Google Maps: tocarlo es darlo de alta (cliente y sede), y lo que diga se cuenta aquí.
  if (r.tipo === 'lugar') {
    const { altaDesdeLugar } = await import('./voz-altas');
    const res = await altaDesdeLugar(r.id);
    burbuja('assistant', res.mensaje);
    if (res.resultados?.length) pintarResultados(res.resultados);
    _historial.push({ role: 'assistant', content: res.contexto || res.mensaje });
    hablar(res.mensaje);
    return;
  }
  if (r.ruta) { (document.getElementById('vz') as HTMLDialogElement | null)?.close(); location.hash = r.ruta; }
}

// ── Leer en voz alta ────────────────────────────────────────────────────────
function hablar(texto: string) {
  if (!_leer || !('speechSynthesis' in window) || !texto) { setEstado('quieto'); volverAEscuchar(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = LANG; if (_vozEs) u.voice = _vozEs;
  const fin = () => { if (_estado === 'habla') setEstado('quieto'); volverAEscuchar(); };
  u.onend = fin; u.onerror = fin;
  setEstado('habla');
  speechSynthesis.speak(u);
}
function pararTodo() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  try { _sr?.abort(); } catch { /* ya parado */ }
  _sr = null;
  if (grabando()) pararGrabacion();
  setEstado('quieto');
}
function volverAEscuchar() {
  if (_manos && SR() && (document.getElementById('vz') as HTMLDialogElement | null)?.open) setTimeout(() => { if (_estado === 'quieto') void escuchar(); }, 400);
}

// ── Escuchar ────────────────────────────────────────────────────────────────
async function escuchar() {
  avisar(null);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const R = SR();
  if (R) {
    const sr = new R();
    sr.lang = LANG; sr.interimResults = false; sr.maxAlternatives = 1;
    _sr = sr;
    let dicho = '';
    sr.onresult = (e: any) => { dicho = Array.from(e.results).map((x: any) => x[0]?.transcript ?? '').join(' ').trim(); };
    sr.onerror = (e: any) => { if (e.error === 'not-allowed') avisar('No hay permiso para el micrófono: actívalo en el navegador (el candado de la barra de direcciones).'); };
    sr.onend = () => { _sr = null; setEstado('quieto'); if (dicho) void enviar(dicho); };
    try { sr.start(); setEstado('escucha'); } catch { _sr = null; setEstado('quieto'); }
    return;
  }
  if (!puedeDictar()) { avisar('Este navegador no deja grabar audio: escríbelo abajo.'); return; }
  const r = await grabarYTranscribir({ empieza: () => setEstado('escucha'), pasando: () => setEstado('piensa', 'Pasando a texto…') });
  setEstado('quieto');
  if (!r.texto) { avisar(r.error ?? 'No se entendió nada'); return; }
  await enviar(r.texto);
}

// El modelo pone al final, en una línea: [[ACCION]]{"accion":…,"datos":{…}} (extraerAccion de la app).
export function extraerAccion(reply: string): { texto: string; accion: string; datos: Record<string, unknown> } | null {
  const i = reply.indexOf('[[ACCION]]');
  if (i === -1) return null;
  const texto = reply.slice(0, i).trim(), resto = reply.slice(i + 10).trim();
  const ini = resto.indexOf('{');
  if (ini === -1) return null;
  let prof = 0, fin = -1;
  for (let k = ini; k < resto.length; k++) { if (resto[k] === '{') prof++; else if (resto[k] === '}' && --prof === 0) { fin = k; break; } }
  if (fin === -1) return null;
  try { const o = JSON.parse(resto.slice(ini, fin + 1)); return o?.accion ? { texto, accion: String(o.accion), datos: o.datos ?? {} } : null; } catch { return null; }
}

// ── Una vuelta de conversación ──────────────────────────────────────────────
async function enviar(texto: string) {
  const limpio = texto.trim();
  if (!limpio) return;
  burbuja('user', limpio);
  _historial.push({ role: 'user', content: limpio });
  _historial = _historial.slice(-MAX_TURNOS);
  setEstado('piensa');
  const r = await llamarFuncion<{ reply: string; no_configurado?: boolean }>('voz', { messages: _historial }, 45000);
  if (r.error || !r.data?.reply) {
    setEstado('quieto');
    avisar(r.error ?? 'No he recibido respuesta. Inténtalo de nuevo.');
    _historial.pop();
    return;
  }
  const reply = r.data.reply.trim();
  const acc = extraerAccion(reply);
  const visible = acc ? acc.texto : reply;
  _historial.push({ role: 'assistant', content: visible || reply });
  if (visible) burbuja('assistant', visible);
  if (!acc) { hablar(visible); return; }
  setEstado('piensa', 'Haciéndolo…');
  const { ejecutarAccion } = await import('./voz-acciones');
  const res = await ejecutarAccion(acc.accion, acc.datos);
  burbuja('assistant', res.mensaje);
  if (res.resultados?.length) pintarResultados(res.resultados);
  // Al historial va el contexto completo (la lista numerada) para entender «abre el segundo».
  _historial.push({ role: 'assistant', content: res.contexto || res.mensaje });
  hablar(res.mensaje);
  if (res.abrir) await abrirResultado(res.abrir);
}

/** Abre el asistente. `escuchar`: empieza a escuchar; `texto`: lo manda como lo primero que se dice. */
export function abrirVoz(op: { escuchar?: boolean; texto?: string } = {}) {
  const d = montar();
  if (!d.open) d.showModal();
  if (op.texto) void enviar(op.texto);
  else if (op.escuchar) void escuchar();
  else setTimeout(() => (document.getElementById('vz-texto') as HTMLInputElement | null)?.focus(), 50);
}

registrarAcciones({
  vozCerrar() { (document.getElementById('vz') as HTMLDialogElement | null)?.close(); },
  // El despachador bloquea el botón mientras dura una acción asíncrona: vuelve al momento y escucha aparte.
  vozMic() {
    if (_estado === 'escucha') { try { _sr?.stop(); } catch { /* ya parado */ } if (grabando()) pararGrabacion(); return; }
    if (_estado === 'habla') { speechSynthesis.cancel(); setEstado('quieto'); }
    void escuchar();
  },
  vozEnviarTexto() {
    const i = document.getElementById('vz-texto') as HTMLInputElement | null;
    const t = i?.value.trim();
    if (!t || !i) return;
    i.value = '';
    void enviar(t);
  },
  vozAbrirRes(i: string) { const r = _ultimos[Number(i)]; if (r) void abrirResultado(r); },
  vozLeer(v: boolean) { _leer = v; guardarPref('hub_voz_leer', v); if (!v && 'speechSynthesis' in window) speechSynthesis.cancel(); },
  vozManos(v: boolean) { _manos = v; guardarPref('hub_voz_manos', v); },
  vozBorrar() {
    _historial = []; _ultimos = [];
    const c = document.getElementById('vz-conv');
    if (c) c.innerHTML = '<p class="nota" id="vz-bienvenida">Empezamos de nuevo. Dime qué necesitas.</p>';
    avisar(null);
  },
});
