// Comandas (fase 8): «audio del jefe → tareas para el equipo». Se graba (o se
// escribe) lo que hay que hacer; la función `comandas` lo pasa a texto (Groq
// Whisper) y Claude lo trocea en tareas repartidas por persona. Tablero
// Pendiente · En curso · Hecho con filtro por persona. Son tareas DEL HUB: las
// de la app no se tocan. Prefijo de ids: co-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace, fechaHora } from '../../ui/dom';

interface Tarea { id: string; comanda_id: string | null; created_at: string; texto: string; persona_id: string | null; estado: 'pendiente' | 'en_curso' | 'hecha';
  prioridad: boolean; fecha_limite: string | null; origen: string; creada_por: string | null; hecha_at: string | null }
interface Comanda { id: string; created_at: string; creada_por: string | null; origen: string; transcripcion: string; con_claude: boolean; n_tareas: number }

const COLUMNAS: [Tarea['estado'], string][] = [['pendiente', 'Pendiente'], ['en_curso', 'En curso'], ['hecha', 'Hecho']];
const ORIGEN: Record<string, string> = { manual: 'MANUAL', voz: 'VOZ', telegram: 'TELEGRAM', mcp: 'CLAUDE' };
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const hoy = () => new Date().toLocaleDateString('sv-SE');

let _grabadora: MediaRecorder | null = null;
let _trozos: Blob[] = [];
let _arrastrando: string | null = null;

function tarjeta(t: Tarea): string {
  const vencida = t.fecha_limite && t.fecha_limite < hoy() && t.estado !== 'hecha';
  const botones = t.estado === 'pendiente' ? `<button class="btn secundario" data-action="coMover" data-p0="${t.id}" data-p1="en_curso">Empezar</button><button class="btn secundario" data-action="coMover" data-p0="${t.id}" data-p1="hecha">Hecha</button>`
    : t.estado === 'en_curso' ? `<button class="btn secundario" data-action="coMover" data-p0="${t.id}" data-p1="pendiente">Volver</button><button class="btn" data-action="coMover" data-p0="${t.id}" data-p1="hecha">Hecha</button>`
      : `<button class="btn secundario" data-action="coMover" data-p0="${t.id}" data-p1="pendiente">Reabrir</button>`;
  return `<article class="pr-tarjeta co-tarjeta ${t.prioridad ? 'co-prioridad' : ''}" draggable="true" data-id="${t.id}" data-on-dragstart="coArrastrar:$this">
    <div class="pr-tarjeta-cab">${t.prioridad ? '<span class="chip mal">PRIORIDAD</span>' : ''}<span class="chip">${esc(ORIGEN[t.origen] ?? t.origen)}</span>
      <small class="nota" title="${esc(fechaHora(t.created_at))}">${esc(hace(t.created_at))}</small></div>
    <p class="co-texto">${esc(t.texto)}</p>
    <div class="pr-tarjeta-pie"><select aria-label="Persona" data-on-change="coPersona:${t.id},$value"><option value="">Sin repartir</option>
      ${_personas.map(p => `<option value="${p.id}" ${p.id === t.persona_id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>
      ${t.fecha_limite ? `<span class="${vencida ? 'mal' : ''}">📅 ${esc(t.fecha_limite)}</span>` : ''}</div>
    <div class="acciones">${botones}${esAdmin() || t.creada_por === usuario()?.id ? `<button class="btn secundario" data-action="coBorrar" data-p0="${t.id}" aria-label="Borrar">✕</button>` : ''}</div>
  </article>`;
}
let _personas: { id: string; nombre: string }[] = [];

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const filtro = leer('hub_co_persona', '');
  const desde = new Date(Date.now() - 7 * 86400000).toISOString();
  const [ts, cs, est] = await Promise.all([
    API.get<Tarea[]>('comanda_tareas', { select: '*', or: `(estado.neq.hecha,hecha_at.gte.${desde})`, order: 'prioridad.desc,created_at' }),
    API.get<Comanda[]>('comandas', { select: '*', order: 'created_at.desc', limit: '5' }),
    llamarFuncion<{ audio: boolean; claude: boolean }>('comandas', { accion: 'estado' }),
  ]);
  _personas = (await equipo()).map(p => ({ id: p.id, nombre: p.nombre }));
  const tareas = (ts.data ?? []).filter(t => !filtro || (filtro === 'sin' ? !t.persona_id : t.persona_id === filtro));
  const cuenta = (id: string) => (ts.data ?? []).filter(t => t.estado !== 'hecha' && (id === 'sin' ? !t.persona_id : t.persona_id === id)).length;
  const puedeGrabar = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  el.innerHTML = `<section class="tarjeta co-dictar">
      <form data-on-submit="coEnviar" data-prevent="1">
        <label for="co-texto">¿Qué hay que hacer? Díctalo o escríbelo, con los nombres: «Tito, mañana cambia el router del Bar Pepe; Ana, llama al Hotel Playa por la factura».</label>
        <textarea id="co-texto" rows="3" placeholder="Escribe aquí o pulsa Grabar…"></textarea>
        <div class="acciones">
          ${puedeGrabar ? '<button type="button" class="btn secundario" id="co-grabar" data-action="coGrabar" aria-pressed="false">🎙 Grabar</button>' : ''}
          <button class="btn" type="submit" id="co-enviar">Repartir</button>
          <span class="nota" id="co-estado">${est.data ? `${est.data.audio ? '' : 'El audio aún no está conectado (falta la clave de Groq): escríbelo. '}${est.data.claude ? '' : 'Sin Claude, se reparte una tarea por línea (empieza la línea con el nombre).'}` : ''}</span>
        </div></form>
      <form class="acciones co-manual" data-on-submit="coManual" data-prevent="1">
        <input id="co-manual-texto" placeholder="O añade una tarea suelta…" aria-label="Tarea suelta" required>
        <select id="co-manual-persona" aria-label="Para quién"><option value="">Sin repartir</option>${_personas.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="co-manual-prio"> Prioridad</label>
        <button class="btn secundario" type="submit">Añadir</button></form>
    </section>
    <div class="acciones pr-barra co-chips" role="tablist" aria-label="Persona">
      <button class="chip-boton ${!filtro ? 'activo' : ''}" data-action="coFiltro" data-p0="">Todas</button>
      ${_personas.map(p => `<button class="chip-boton ${filtro === p.id ? 'activo' : ''}" data-action="coFiltro" data-p0="${p.id}">${esc(p.nombre.split(' ')[0])} (${cuenta(p.id)})</button>`).join('')}
      <button class="chip-boton ${filtro === 'sin' ? 'activo' : ''}" data-action="coFiltro" data-p0="sin">Sin repartir (${cuenta('sin')})</button>
    </div>
    <div class="pr-kanban co-tablero">${COLUMNAS.map(([k, n]) => {
      const col = tareas.filter(t => t.estado === k);
      return `<section class="pr-columna" data-estado="${k}" data-on-dragover="coSobre" data-prevent="1" data-on-drop="coSoltar:${k}">
        <header><h3>${n}</h3><span class="chip">${col.length}</span></header>
        <div class="pr-col-cuerpo">${col.map(tarjeta).join('') || '<p class="vacio">—</p>'}</div></section>`;
    }).join('')}</div>
    ${(cs.data ?? []).length ? `<details class="tarjeta"><summary>Últimas comandas</summary><ul class="di-ultimo">${(cs.data ?? []).map(c => `<li><small class="nota">${esc(hace(c.created_at))}</small>
      <span><strong>${esc(nombreDe(c.creada_por))}</strong> · ${esc(ORIGEN[c.origen === 'app' ? 'voz' : c.origen] ?? c.origen)} · ${c.n_tareas} tarea(s)${c.con_claude ? '' : ' (por líneas)'}<br><em>«${esc(c.transcripcion)}»</em></span></li>`).join('')}</ul></details>` : ''}`;
}

async function enviar(cuerpo: Record<string, unknown>) {
  const est = document.getElementById('co-estado'), btn = document.getElementById('co-enviar') as HTMLButtonElement | null;
  if (est) est.textContent = cuerpo.audio ? 'Pasando el audio a texto y repartiendo…' : 'Repartiendo…';
  if (btn) btn.disabled = true;
  const r = await llamarFuncion<{ tareas: unknown[]; con_claude: boolean }>('comandas', { accion: 'crear', ...cuerpo }, 120000);
  if (btn) btn.disabled = false;
  if (r.error || !r.data) { toast(`No se pudo: ${r.error}`, 'error'); if (est) est.textContent = r.error ?? ''; return; }
  toast(`Comanda repartida en ${r.data.tareas.length} tarea(s)`);
  resolver();
}

const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] ?? ''); f.onerror = mal; f.readAsDataURL(b); });

registrarAcciones({
  async coEnviar() {
    const texto = (document.getElementById('co-texto') as HTMLTextAreaElement).value.trim();
    if (!texto) { toast('Escribe o graba la comanda', 'error'); return; }
    await enviar({ texto });
  },
  async coGrabar() {
    const b = document.getElementById('co-grabar');
    if (_grabadora?.state === 'recording') { _grabadora.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _trozos = [];
      _grabadora = new MediaRecorder(stream);
      _grabadora.ondataavailable = e => { if (e.data.size) _trozos.push(e.data); };
      _grabadora.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (b) { b.textContent = '🎙 Grabar'; b.setAttribute('aria-pressed', 'false'); }
        const blob = new Blob(_trozos, { type: _grabadora?.mimeType || 'audio/webm' });
        if (blob.size < 1000) { toast('No se ha grabado nada', 'error'); return; }
        await enviar({ audio: await aBase64(blob), mime: blob.type });
      };
      _grabadora.start();
      if (b) { b.textContent = '⏹ Parar y repartir'; b.setAttribute('aria-pressed', 'true'); }
    } catch { toast('No hay permiso para el micrófono: actívalo en el navegador', 'error'); }
  },
  async coManual() {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
    const r = await API.post('comanda_tareas', { texto: v('co-manual-texto'), persona_id: v('co-manual-persona') || null,
      prioridad: (document.getElementById('co-manual-prio') as HTMLInputElement).checked, origen: 'manual', estado: 'pendiente' });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  coFiltro(id: string) { guardar('hub_co_persona', id); resolver(); },
  async coMover(id: string, estado: string) {
    const r = await API.patch('comanda_tareas', { id: `eq.${id}` }, { estado });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async coPersona(id: string, persona: string) {
    const r = await API.patch('comanda_tareas', { id: `eq.${id}` }, { persona_id: persona || null });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else toast('Repartida');
  },
  async coBorrar(id: string) {
    if (!confirm('¿Borrar esta tarea?')) return;
    const r = await API.delete('comanda_tareas', { id: `eq.${id}` });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  coArrastrar(el: HTMLElement) { _arrastrando = el.dataset.id ?? null; },
  coSobre() { /* permite soltar (data-prevent) */ },
  async coSoltar(estado: string) {
    if (!_arrastrando) return;
    const id = _arrastrando; _arrastrando = null;
    const r = await API.patch('comanda_tareas', { id: `eq.${id}` }, { estado });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
});

async function contador(): Promise<Contador | null> {
  const yo = usuario()?.id;
  const [n, mias] = await Promise.all([API.contar('comanda_tareas', { estado: 'neq.hecha' }), yo ? API.contar('comanda_tareas', { estado: 'neq.hecha', persona_id: `eq.${yo}` }) : Promise.resolve(0)]);
  if (n == null) return null;
  return { valor: n, subtitulo: mias ? `pendientes · ${mias} tuyas` : 'pendientes', tono: mias ? 'aviso' : 'neutro' };
}

export const moduloComandas: Modulo = {
  id: 'comandas',
  titulo: 'Comandas',
  grupo: 'Organizar',
  icono: '🧾',
  explicacion: 'Dicta o escribe lo que hay que hacer y se reparte solo en tareas, cada una a su persona, como las comandas de un bar. También por Telegram: mándale una nota de voz al bot. Cada uno ve aquí lo suyo y lo va moviendo de Pendiente a Hecho.',
  pintar,
  contador,
};
