// Chat de WhatsApp siempre a mano: una ventana fija abajo a la derecha, en
// todas las pantallas, que arranca PLEGADA (solo la barra con cuántas
// conversaciones esperan respuesta). Las conversaciones son las de la app
// actual (su webhook las recibe); se leen y se contestan por la función
// `whatsapp` del hub, que apunta lo enviado en la app igual que su bandeja.
// Nada sale solo hacia un cliente: Oki PROPONE y la persona manda.
import { registrarAcciones } from '../core/dispatcher';
import { llamarFuncion } from '../core/funciones';
import { esc, hace } from '../ui/dom';

interface Conv {
  id: string; telefono: string; nombre: string; perfil: string | null; sede: string | null;
  ticket: { id: string; numero: number; estado: string } | null;
  ultimo: string; ultimo_at: string | null; ultimo_entrante_at: string | null;
  sin_leer: number; pendiente: boolean; ventana: boolean;
}
interface Msg {
  id: string; created_at: string; direccion: 'entrante' | 'saliente'; tipo: string; texto: string | null;
  media_url: string | null; media_nombre: string | null; media_descripcion: string | null;
  estado: string; error: string | null; usuario: string | null; automatico: boolean;
}

const LISTA_MS = 30000, LISTA_PLEGADO_MS = 90000, HILO_MS = 12000;

let abierto = false;
let convs: Conv[] = [];
let actual: Conv | null = null;
let mensajes: Msg[] = [];
let envio = true;
let claude = false;
let enviando = false;
let tLista: number | undefined, tHilo: number | undefined;
let cargandoLista: Promise<void> | null = null;

const $id = (id: string) => document.getElementById(id);

export function pintarWhatsapp(raiz: HTMLElement) {
  clearTimeout(tLista); clearTimeout(tHilo);
  abierto = false; actual = null; mensajes = [];
  const caja = document.createElement('aside');
  caja.id = 'wa';
  caja.className = 'wa cerrado';
  caja.setAttribute('aria-label', 'WhatsApp de clientes');
  caja.innerHTML = `
    <button type="button" class="wa-cab" data-action="waAlternar" aria-expanded="false" id="wa-cab">
      <span class="wa-logo" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg></span>
      <span class="wa-titulo"><b>WhatsApp</b><small id="wa-resumen">Cargando…</small></span>
      <span class="wa-num" id="wa-num" hidden></span>
      <svg class="wa-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>
    </button>
    <div class="wa-cuerpo">
      <div id="wa-lista" class="wa-lista"></div>
      <div id="wa-hilo-vista" class="wa-hilo-vista" hidden>
        <div class="wa-convcab" id="wa-convcab"></div>
        <div class="wa-hilo" id="wa-hilo"><div id="wa-msgs" class="wa-msgs"></div></div>
        <div id="wa-oki"></div>
        <div class="wa-pie">
          <label class="wa-campo"><span class="sr">Escribe la respuesta</span>
            <textarea id="wa-in" rows="1" placeholder="Escribe la respuesta…" data-on-keydown="waTecla:$event"></textarea></label>
          <button type="button" class="wa-env" id="wa-env" data-action="waEnviar" aria-label="Enviar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </div>
        <p class="wa-err" id="wa-err" role="alert"></p>
      </div>
    </div>`;
  raiz.appendChild(caja);
  void cargarLista();
}

function programarLista() {
  clearTimeout(tLista);
  tLista = window.setTimeout(() => void cargarLista(), abierto ? LISTA_MS : LISTA_PLEGADO_MS);
}

function cargarLista(): Promise<void> {
  return (cargandoLista ??= (async () => {
    const { data, error } = await llamarFuncion<{ conversaciones: Conv[]; envio: boolean }>('whatsapp', { accion: 'conversaciones' }, 20000);
    if (!$id('wa')) return;
    if (error || !Array.isArray(data?.conversaciones)) {
      $id('wa-resumen')!.textContent = 'Sin conexión con WhatsApp';
      if (abierto && !actual) $id('wa-lista')!.innerHTML = `<p class="wa-vacio">No se pudieron leer las conversaciones: ${esc(error)}</p>`;
    } else {
      convs = data!.conversaciones;
      envio = data!.envio !== false;
      if (actual) actual = convs.find(c => c.id === actual!.id) ?? actual;
      pintarResumen();
      if (abierto && !actual) pintarLista();
    }
  })().finally(() => { cargandoLista = null; programarLista(); }));
}

function pintarResumen() {
  const n = convs.filter(c => c.pendiente).length;
  $id('wa-resumen')!.textContent = n ? `${n} ${n === 1 ? 'conversación' : 'conversaciones'} por contestar` : 'Todo contestado';
  const num = $id('wa-num')!;
  num.hidden = !n;
  num.textContent = String(n);
}

function pintarLista() {
  const el = $id('wa-lista')!;
  if (!convs.length) { el.innerHTML = '<p class="wa-vacio">No hay conversaciones todavía.</p>'; return; }
  el.innerHTML = `<ul>${convs.map(c => `
    <li><button type="button" class="wa-fila${c.pendiente ? ' pendiente' : ''}" data-action="waAbrir" data-p0="${esc(c.id)}">
      <span class="wa-ini" aria-hidden="true">${esc(iniciales(c.nombre))}</span>
      <span class="wa-fila-txt"><b>${esc(c.nombre)}</b><small>${esc(c.ultimo || '—')}</small></span>
      <span class="wa-fila-meta"><small>${esc(cuando(c.ultimo_at))}</small>${c.pendiente ? '<span class="wa-punto" title="Por contestar"></span>' : ''}</span>
    </button></li>`).join('')}</ul>`;
}

async function abrir(id: string) {
  actual = convs.find(c => c.id === id) ?? null;
  if (!actual) return;
  $id('wa-lista')!.hidden = true;
  $id('wa-hilo-vista')!.hidden = false;
  $id('wa-err')!.textContent = '';
  $id('wa-oki')!.innerHTML = '';
  ($id('wa-in') as HTMLTextAreaElement).value = '';
  _vistos = new Set();
  pintarCabConv();
  $id('wa-msgs')!.innerHTML = '<p class="wa-vacio">Cargando…</p>';
  await cargarHilo(true);
  if (actual && actual.sin_leer > 0) {
    void llamarFuncion('whatsapp', { accion: 'leida', conversacion_id: actual.id });
    actual.sin_leer = 0;
  }
}

function volver() {
  clearTimeout(tHilo);
  actual = null; mensajes = [];
  $id('wa-hilo-vista')!.hidden = true;
  $id('wa-lista')!.hidden = false;
  pintarLista();
  void cargarLista();
}

async function cargarHilo(primera = false) {
  clearTimeout(tHilo);
  const conv = actual;
  if (!conv) return;
  const { data, error } = await llamarFuncion<{ conversacion: Conv; mensajes: Msg[] }>('whatsapp', { accion: 'mensajes', conversacion_id: conv.id }, 20000);
  if (actual?.id !== conv.id) return;
  if (error || !Array.isArray(data?.mensajes)) {
    if (primera) $id('wa-msgs')!.innerHTML = `<p class="wa-vacio">No se pudo leer la conversación: ${esc(error)}</p>`;
  } else {
    const nuevos = data!.mensajes.length !== mensajes.length || data!.mensajes.at(-1)?.id !== mensajes.at(-1)?.id;
    actual = { ...conv, ...data!.conversacion };
    mensajes = data!.mensajes;
    pintarCabConv();
    if (nuevos || primera) pintarMensajes();
  }
  if (abierto && actual) tHilo = window.setTimeout(() => void cargarHilo(), HILO_MS);
}

function pintarCabConv() {
  const c = actual!;
  $id('wa-convcab')!.innerHTML = `
    <button type="button" class="wa-volver" data-action="waVolver" aria-label="Volver a las conversaciones">‹</button>
    <span class="wa-convcab-txt"><b>${esc(c.nombre)}</b><small>${esc([c.sede, '+' + c.telefono].filter(Boolean).join(' · '))}</small></span>
    <span class="wa-ventana ${c.ventana ? 'abierta' : 'cerrada'}"><span class="hex-punto" aria-hidden="true"></span>${c.ventana ? `Quedan ${restante(c.ultimo_entrante_at)}` : 'Fuera de 24 h'}</span>
    ${c.ticket ? `<a class="wa-ticket" href="#/tickets/${esc(c.ticket.id)}">#${esc(c.ticket.numero)}</a>` : ''}`;
  const bloqueado = !c.ventana || !envio;
  const campo = $id('wa-in') as HTMLTextAreaElement;
  campo.disabled = bloqueado;
  campo.placeholder = !envio ? 'Falta conectar el envío de WhatsApp en el hub'
    : !c.ventana ? 'Fuera de las 24 h: contesta desde la app con la plantilla' : 'Escribe la respuesta…';
  ($id('wa-env') as HTMLButtonElement).disabled = bloqueado;
  pintarOki();
}

function pintarOki(propuesta?: string | null, motivo?: string) {
  const el = $id('wa-oki')!;
  const c = actual;
  if (!c || !c.ventana || !envio) { el.innerHTML = ''; return; }
  if (propuesta) {
    el.innerHTML = `<div class="wa-oki">
      <div class="wa-oki-et"><span class="hex-punto" aria-hidden="true"></span>OKI PROPONE</div>
      <p id="wa-propuesta">${esc(propuesta)}</p>
      <div class="acciones"><button type="button" class="btn" data-action="waUsar">Usar respuesta</button>
      <button type="button" class="btn secundario" data-action="waDescartar">Descartar</button></div></div>`;
    return;
  }
  if (motivo) { el.innerHTML = `<p class="wa-nota">${esc(motivo)}</p>`; return; }
  el.innerHTML = claude && c.pendiente
    ? '<button type="button" class="wa-pedir" data-action="waProponer"><span class="hex-punto" aria-hidden="true"></span>Que Oki proponga una respuesta</button>'
    : '';
}

let _vistos = new Set<string>();
function pintarMensajes() {
  const el = $id('wa-msgs')!;
  const primera = !_vistos.size;
  if (!mensajes.length) { el.innerHTML = '<p class="wa-vacio">Sin mensajes.</p>'; return; }
  let dia = '';
  el.innerHTML = mensajes.map(m => {
    const d = new Date(m.created_at).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    const sep = d !== dia ? `<div class="wa-dia">${esc(d)}</div>` : '';
    dia = d;
    const hora = new Date(m.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const quien = m.direccion === 'saliente' ? (m.automatico ? 'Bot' : (m.usuario ?? '')) : '';
    const adjunto = m.media_url
      ? `<a href="${esc(m.media_url)}" target="_blank" rel="noopener">${esc(m.media_nombre || `[${m.tipo}]`)}</a>${m.media_descripcion ? `<br><i>${esc(m.media_descripcion)}</i>` : ''}`
      : '';
    const texto = m.texto ? esc(m.texto) : (adjunto ? '' : `[${esc(m.tipo)}]`);
    const nuevo = !primera && !_vistos.has(m.id);
    return `${sep}<div class="wa-msg ${m.direccion === 'saliente' ? 'yo' : 'ellos'}${m.estado === 'fallido' ? ' fallido' : ''}${nuevo ? ' nuevo' : ''}">
      <div class="wa-msg-txt">${texto}${texto && adjunto ? '<br>' : ''}${adjunto}</div>
      <div class="wa-msg-pie">${esc([hora, quien].filter(Boolean).join(' · '))}${m.estado === 'fallido' ? ` · No salió: ${esc(m.error ?? '')}` : ''}</div>
    </div>`;
  }).join('');
  _vistos = new Set(mensajes.map(m => m.id));
}

async function enviar() {
  const c = actual;
  const campo = $id('wa-in') as HTMLTextAreaElement;
  const texto = campo.value.trim();
  if (!c || !texto || enviando || campo.disabled) return;
  enviando = true;
  ($id('wa-env') as HTMLButtonElement).disabled = true;
  $id('wa-err')!.textContent = '';
  const { data, error } = await llamarFuncion<{ ok: boolean; mensaje: Msg }>('whatsapp', { accion: 'enviar', conversacion_id: c.id, texto }, 30000);
  enviando = false;
  ($id('wa-env') as HTMLButtonElement).disabled = false;
  if (error || !data?.ok) {
    $id('wa-err')!.textContent = `No se ha enviado: ${error ?? 'error desconocido'}`;
    void cargarHilo();
    return;
  }
  campo.value = '';
  if (actual?.id === c.id) {
    actual.pendiente = false;
    if (data.mensaje) mensajes = [...mensajes, data.mensaje];
    pintarMensajes();
  }
  pintarOki();
  const enLista = convs.find(x => x.id === c.id);
  if (enLista) { enLista.pendiente = false; enLista.ultimo = texto; enLista.ultimo_at = new Date().toISOString(); }
  pintarResumen();
}

async function proponer() {
  const c = actual;
  if (!c) return;
  $id('wa-oki')!.innerHTML = '<p class="wa-nota"><span class="hex-punto pulso" aria-hidden="true"></span> Oki está pensando la respuesta…</p>';
  const { data, error } = await llamarFuncion<{ propuesta: string | null; motivo?: string }>('whatsapp', { accion: 'proponer', conversacion_id: c.id }, 60000);
  if (actual?.id !== c.id) return;
  pintarOki(data?.propuesta ?? null, error ? `Oki no ha podido proponer nada: ${error}` : data?.motivo);
}

async function alternar() {
  abierto = !abierto;
  const caja = $id('wa')!;
  caja.classList.toggle('abierto', abierto);
  caja.classList.toggle('cerrado', !abierto);
  $id('wa-cab')!.setAttribute('aria-expanded', String(abierto));
  if (abierto) {
    void llamarFuncion<{ envio: boolean; claude: boolean }>('whatsapp', { accion: 'estado' }).then(({ data }) => {
      if (!data) return;
      envio = data.envio !== false; claude = !!data.claude;
      if (actual) pintarCabConv();
    });
    if (actual) void cargarHilo(); else pintarLista();
    void cargarLista();
  } else {
    clearTimeout(tHilo);
    programarLista();
  }
}

function iniciales(n: string) {
  const p = n.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}
function cuando(v: string | null) {
  if (!v) return '';
  const d = new Date(v);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : hace(v);
}
function restante(desde: string | null) {
  if (!desde) return '';
  const min = Math.max(0, Math.round((new Date(desde).getTime() + 24 * 3600000 - Date.now()) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h` : `${min} min`;
}

registrarAcciones({
  waAlternar: alternar,
  waAbrir: (id: string) => abrir(id),
  waVolver: volver,
  waEnviar: enviar,
  waTecla(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void enviar(); }
  },
  waProponer: proponer,
  waUsar() {
    const p = $id('wa-propuesta')?.textContent ?? '';
    const campo = $id('wa-in') as HTMLTextAreaElement;
    campo.value = p;
    campo.focus();
  },
  waDescartar: () => { $id('wa-oki')!.innerHTML = ''; },
});
