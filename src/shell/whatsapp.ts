// Chat de WhatsApp siempre a mano: una ventana fija abajo a la derecha, en
// todas las pantallas, que arranca PLEGADA (solo la barra con cuántas
// conversaciones esperan respuesta). Las conversaciones son las de la app
// actual (su webhook las recibe); se leen y se contestan por la función
// `whatsapp` del hub, que apunta lo enviado en la app igual que su bandeja.
// Nada sale solo hacia un cliente: Oki PROPONE y la persona manda.
import { registrarAcciones } from '../core/dispatcher';
import { llamarFuncion } from '../core/funciones';
import { ir } from '../core/router';
import { esc, hace, toast } from '../ui/dom';
import { esAdmin } from '../core/estado';
import { dejarBorrador } from '../ui/borrador';

interface Conv {
  id: string; telefono: string; nombre: string; perfil: string | null; sede: string | null;
  cliente_id: string | null; local_id: string | null; contacto_id: string | null;
  plan?: string | null; estado_pago?: string | null;
  ticket: { id: string; numero: number; estado: string } | null;
  ultimo: string; ultimo_at: string | null; ultimo_entrante_at: string | null;
  sin_leer: number; pendiente: boolean; ventana: boolean;
}
interface Msg {
  id: string; created_at: string; direccion: 'entrante' | 'saliente'; tipo: string; texto: string | null;
  media_id: string | null; media_url: string | null; media_nombre: string | null; media_descripcion: string | null;
  estado: string; error: string | null; usuario: string | null; automatico: boolean;
}

const LISTA_MS = 30000, LISTA_PLEGADO_MS = 90000, HILO_MS = 12000;

let abierto = false;
let convs: Conv[] = [];
let actual: Conv | null = null;
let mensajes: Msg[] = [];
let envio = true;
let claude = false;
let plantilla = false;
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
        <div class="wa-atajos" id="wa-atajos"></div>
        <div class="wa-panel" id="wa-panel" hidden></div>
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
    const { data, error } = await llamarFuncion<{ conversaciones: Conv[]; envio: boolean; plantilla?: boolean }>('whatsapp', { accion: 'conversaciones' }, 20000);
    if (!$id('wa')) return;
    if (error || !Array.isArray(data?.conversaciones)) {
      $id('wa-resumen')!.textContent = 'Sin conexión con WhatsApp';
      if (abierto && !actual) $id('wa-lista')!.innerHTML = `<p class="wa-vacio">No se pudieron leer las conversaciones: ${esc(error)}</p>`;
    } else {
      convs = data!.conversaciones;
      envio = data!.envio !== false;
      plantilla = !!data!.plantilla;
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

// El conector del Agente de Meta (solo admin): ver dónde apunta y, tras el cambio, repuntarlo al hub.
const pieAgente = () => esAdmin() ? '<button type="button" class="wa-agente-b" data-action="waAgente">🤖 Agente de Meta</button>' : '';

function pintarLista() {
  const el = $id('wa-lista')!;
  if (!convs.length) { el.innerHTML = `<p class="wa-vacio">No hay conversaciones todavía.</p>${pieAgente()}`; return; }
  el.innerHTML = `<ul>${convs.map(c => `
    <li><button type="button" class="wa-fila${c.pendiente ? ' pendiente' : ''}" data-action="waAbrir" data-p0="${esc(c.id)}">
      <span class="wa-ini" aria-hidden="true">${esc(iniciales(c.nombre))}</span>
      <span class="wa-fila-txt"><b>${esc(c.nombre)}</b><small>${esc(c.ultimo || '—')}</small></span>
      <span class="wa-fila-meta"><small>${esc(cuando(c.ultimo_at))}</small>${c.pendiente ? '<span class="wa-punto" title="Por contestar"></span>' : ''}</span>
    </button></li>`).join('')}</ul>${pieAgente()}`;
}

async function abrir(id: string) {
  actual = convs.find(c => c.id === id) ?? null;
  if (!actual) return;
  $id('wa-lista')!.hidden = true;
  $id('wa-hilo-vista')!.hidden = false;
  $id('wa-err')!.textContent = '';
  $id('wa-oki')!.innerHTML = '';
  cerrarPanel();
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
    ${c.ticket ? `<a class="wa-ticket" href="#/tickets/${esc(c.ticket.numero)}">#${esc(c.ticket.numero)}</a>` : ''}`;
  const bloqueado = !c.ventana || !envio;
  const campo = $id('wa-in') as HTMLTextAreaElement;
  campo.disabled = bloqueado;
  campo.placeholder = !envio ? 'Falta conectar el envío de WhatsApp en el hub'
    : !c.ventana ? 'Fuera de las 24 h: primero hay que mandar la plantilla' : 'Escribe la respuesta…';
  ($id('wa-env') as HTMLButtonElement).disabled = bloqueado;
  pintarAtajos();
  pintarOki();
}

// Chip del contrato de la sede (chipPlan de la app): el plan y, si va torcido,
// el estado de pago. Que se vea que NO tiene contrato es tan útil como ver cuál.
function chipPlan(c: Conv) {
  const plan = (c.plan ?? '').trim();
  if (!plan || plan === 'Sin mantenimiento') return '<span class="chip" title="La sede no tiene plan de mantenimiento">Sin mantenimiento</span>';
  const pago = (c.estado_pago ?? '').trim();
  return `<span class="chip bien" title="Plan de mantenimiento de la sede">${esc(plan)}</span>`
    + (pago && pago !== 'Al corriente' ? `<span class="chip aviso" title="Estado de pago del mantenimiento">${esc(pago)}</span>` : '');
}

// Enlaces rápidos de la conversación (como la cabecera de la bandeja de la app):
// la ficha, el plan, el acceso remoto y las altas con cliente y sede puestos.
function pintarAtajos() {
  const c = actual!;
  const el = $id('wa-atajos')!;
  el.innerHTML = [
    c.cliente_id ? `<a class="chip-boton" href="#/clientes/${esc(c.cliente_id)}">👤 Cliente</a>` : '<span class="chip aviso" title="El teléfono no está en ninguna ficha">Sin cliente</span>',
    c.local_id ? `<a class="chip-boton" href="#/sitios/${esc(c.local_id)}">📍 Sede</a>${chipPlan(c)}` : '',
    c.local_id ? '<button type="button" class="chip-boton" data-action="waRemoto">🖥 Remoto</button>' : '',
    '<button type="button" class="chip-boton" data-action="waTicket">🎫 Ticket</button>',
    c.cliente_id ? '<button type="button" class="chip-boton" data-action="waPresupuesto">📄 Presupuesto</button>' : '',
    c.cliente_id && envio ? '<button type="button" class="chip-boton" data-action="waDocumentos" aria-expanded="false">📎 Factura / presupuesto</button>' : '',
  ].filter(Boolean).join('');
}

function abrirPanel(html: string) {
  const p = $id('wa-panel')!;
  p.innerHTML = `${html}<button type="button" class="wa-panel-x" data-action="waCerrarPanel" aria-label="Cerrar">✕</button>`;
  p.hidden = false;
}
function cerrarPanel() {
  const p = $id('wa-panel');
  if (p) { p.hidden = true; p.innerHTML = ''; }
}

// El último mensaje de TEXTO del cliente, de arranque del aviso (una foto solo aporta «📷 Foto»).
function ultimoTextoCliente(): string {
  return [...mensajes].reverse().find(m => m.direccion === 'entrante' && m.texto && !m.media_id)?.texto ?? '';
}

interface Remoto { tipo: 'anydesk' | 'rustdesk'; id: string; nombre: string }
let _remotos: Remoto[] = [];
interface Doc { tipo: 'factura' | 'presupuesto'; id: string; numero: string }
let _docs: Doc[] = [];

function pintarOki(propuesta?: string | null, motivo?: string) {
  const el = $id('wa-oki')!;
  const c = actual;
  if (!c || !envio) { el.innerHTML = ''; return; }
  // Fuera de las 24 h Meta solo deja mandar una plantilla aprobada: la de
  // retomar la conversación; cuando el cliente conteste, se vuelve a escribir.
  if (!c.ventana) {
    el.innerHTML = plantilla
      ? `<div class="wa-plantilla"><p class="wa-nota">Han pasado más de 24 h desde su último mensaje: WhatsApp solo deja mandarle la plantilla para retomar la conversación.</p>
         <button type="button" class="btn secundario" data-action="waPlantilla">📨 Mandar plantilla</button></div>`
      : '<p class="wa-nota">Fuera de las 24 h hace falta una plantilla de Meta, y aún no está puesta en el hub (WHATSAPP_PLANTILLA_TEXTO).</p>';
    return;
  }
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
    // Con copia en Storage (media_url, la guarda el webhook de la app) la foto se
    // ve en la conversación; si no, se pide a Meta (que la borra a las pocas semanas).
    const etiqueta = m.tipo === 'image' ? 'foto' : m.tipo === 'video' ? 'vídeo' : 'archivo';
    const desc = m.media_descripcion ? `<br><i>${esc(m.media_descripcion)}</i>` : '';
    const adjunto = m.media_url
      ? (m.tipo === 'image'
        ? `<a href="${esc(m.media_url)}" target="_blank" rel="noopener"><img class="wa-foto" src="${esc(m.media_url)}" alt="Foto del cliente" loading="lazy"></a>${desc}`
        : `<a href="${esc(m.media_url)}" target="_blank" rel="noopener">${m.tipo === 'video' ? '🎬' : '📎'} ${esc(m.media_nombre || `Ver ${etiqueta}`)}</a>${desc}`)
      : m.direccion === 'entrante' && m.media_id
        ? `<button type="button" class="chip-boton" data-action="waMedia" data-p0="${esc(m.id)}">${m.tipo === 'image' ? '🖼' : '📎'} Ver ${etiqueta}</button>${desc}`
        : m.media_nombre ? `📎 ${esc(m.media_nombre)}` : '';
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

async function mandarPlantilla() {
  const c = actual;
  if (!c || enviando || !confirm(`¿Mandar a ${c.nombre} la plantilla para retomar la conversación?`)) return;
  enviando = true;
  $id('wa-err')!.textContent = '';
  const { data, error } = await llamarFuncion<{ ok: boolean; mensaje: Msg }>('whatsapp', { accion: 'plantilla', conversacion_id: c.id }, 30000);
  enviando = false;
  if (error || !data?.ok) { $id('wa-err')!.textContent = `No se ha enviado: ${error ?? 'error desconocido'}`; void cargarHilo(); return; }
  if (actual?.id === c.id && data.mensaje) { mensajes = [...mensajes, data.mensaje]; pintarMensajes(); }
  $id('wa-oki')!.innerHTML = '<p class="wa-nota">Plantilla enviada. Cuando conteste, se le podrá escribir con normalidad.</p>';
}

async function alternar() {
  abierto = !abierto;
  const caja = $id('wa')!;
  caja.classList.toggle('abierto', abierto);
  caja.classList.toggle('cerrado', !abierto);
  $id('wa-cab')!.setAttribute('aria-expanded', String(abierto));
  if (abierto) {
    void llamarFuncion<{ envio: boolean; claude: boolean; plantilla?: boolean }>('whatsapp', { accion: 'estado' }).then(({ data }) => {
      if (!data) return;
      envio = data.envio !== false; claude = !!data.claude; plantilla = !!data.plantilla;
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
  waPlantilla: mandarPlantilla,
  waUsar() {
    const p = $id('wa-propuesta')?.textContent ?? '';
    const campo = $id('wa-in') as HTMLTextAreaElement;
    campo.value = p;
    campo.focus();
  },
  waDescartar: () => { $id('wa-oki')!.innerHTML = ''; },
  waCerrarPanel: cerrarPanel,
  async waAgente() {
    const el = $id('wa-lista')!;
    el.innerHTML = '<p class="wa-vacio"><span class="hex-punto pulso" aria-hidden="true"></span> Mirando el Agente de Meta…</p>';
    const { data: r, error } = await llamarFuncion<any>('whatsapp', { accion: 'meta_conector_estado' }, 40000);
    if (!$id('wa-lista') || actual) return;
    const ETQ: Record<string, string> = { active: '✅ activa', pending_review: '⏳ en revisión', blocked: '⛔ bloqueada', falta: '— sin instalar' };
    const enHub = String(r?.base_url ?? '').includes('adomalsxsymxzuozksmt');
    const detalle = error || !r?.ok ? `<p class="wa-err">${esc(error ?? r?.error ?? 'Sin respuesta')}</p>`
      : !r.registrado ? '<p class="wa-nota">El conector todavía no está dado de alta en el Agente de Meta.</p>'
        : `<p class="wa-nota">Apunta a <b>${enHub ? 'el hub' : 'la app'}</b>. Conexión: <b>${esc(r.conexion?.status ?? '—')}</b> · herramientas: <b>${esc(r.herramientas?.status ?? '—')}</b> (${esc(r.herramientas?.tool_count ?? 0)})</p>`;
    const skills = (r?.skills ?? []).map((x: any) => `<li><code>${esc(x.title)}</code> ${ETQ[x.status] ?? esc(x.status)}</li>`).join('');
    el.innerHTML = `<div class="wa-agente"><button type="button" class="wa-volver" data-action="waAgenteVolver" aria-label="Volver a las conversaciones">‹</button>
      <h4>🤖 Agente de Meta</h4>${detalle}${skills ? `<p class="wa-nota">Skills:</p><ul>${skills}</ul>` : ''}
      <button type="button" class="btn secundario" data-action="waAgenteActualizar">${r?.registrado ? 'Actualizar conector y skills' : 'Dar de alta conector y skills'}</button>
      <p class="wa-nota">Solo se puede con el cambio de WhatsApp hecho: entonces el agente pasa a usar las herramientas del hub.</p></div>`;
  },
  waAgenteVolver: () => pintarLista(),
  async waAgenteActualizar() {
    if (!confirm('¿Registrar en Meta el conector y las skills del hub? El Agente de Meta pasará a usar las herramientas del hub.')) return;
    const { data: x, error } = await llamarFuncion<any>('whatsapp', { accion: 'meta_conector' }, 60000);
    if (error || !x?.ok) { toast(`No se pudo: ${error ?? x?.error ?? 'sin respuesta'}`, 'error'); return; }
    const bloq = (x.skills ?? []).filter((k: any) => k.status === 'blocked').length;
    toast(`Conector ${x.herramientas?.status ?? '—'} · ${(x.skills ?? []).length} skills${bloq ? ` (${bloq} bloqueadas)` : ''}`, bloq ? 'error' : 'info');
  },
  // Ticket con cliente, sede y contacto de la conversación y el último texto del cliente.
  waTicket() {
    const c = actual;
    if (!c) return;
    const texto = ultimoTextoCliente();
    dejarBorrador('ticket', {
      cliente_id: c.cliente_id, local_id: c.local_id, contacto_id: c.contacto_id, canal: 'whatsapp',
      titulo: texto ? texto.replace(/\s+/g, ' ').slice(0, 70) : '', descripcion: texto,
    });
    ir('tickets', 'nuevo');
  },
  waPresupuesto() {
    const c = actual;
    if (!c?.cliente_id) return;
    if (c.local_id) ir('presupuestos', 'nuevo', 'l', c.local_id); else ir('presupuestos', 'nuevo', 'c', c.cliente_id);
  },
  // AnyDesk de la ficha + RustDesk de Breeze: uno se abre, varios se eligen (waRemoto de la app).
  async waRemoto() {
    const c = actual;
    if (!c?.local_id) return;
    const { remotosDe, abrirRemoto } = await import('../modulos/sitios/equipamiento');
    _remotos = await remotosDe(c.local_id);
    if (actual?.id !== c.id) return;
    if (!_remotos.length) { toast(`${c.sede ?? 'La sede'} no tiene ningún acceso remoto guardado (AnyDesk o RustDesk)`, 'error'); return; }
    if (_remotos.length === 1) { await abrirRemoto(_remotos[0], c.local_id); return; }
    abrirPanel(`<p class="wa-nota">¿A qué equipo de ${esc(c.sede ?? 'la sede')}?</p>${_remotos.map((r, i) => `
      <button type="button" class="btn secundario" data-action="waRemotoAbrir" data-p0="${i}">${r.tipo === 'anydesk' ? 'AnyDesk' : 'RustDesk'} · ${esc(r.nombre)} <small class="nota">${esc(r.id)}</small></button>`).join('')}`);
  },
  async waRemotoAbrir(i: string) {
    const r = _remotos[Number(i)], c = actual;
    if (!r || !c?.local_id) return;
    const { abrirRemoto } = await import('../modulos/sitios/equipamiento');
    await abrirRemoto(r, c.local_id);
    cerrarPanel();
  },
  async waDocumentos() {
    const c = actual;
    if (!c) return;
    abrirPanel('<p class="wa-nota">Buscando sus facturas y presupuestos…</p>');
    const { data, error } = await llamarFuncion<{ documentos: Doc[]; motivo?: string; plantilla?: boolean }>('whatsapp', { accion: 'documentos', conversacion_id: c.id });
    if (actual?.id !== c.id) return;
    _docs = data?.documentos ?? [];
    if (error || data?.motivo || !_docs.length) { abrirPanel(`<p class="wa-nota">${esc(error ?? data?.motivo ?? 'Este cliente no tiene facturas ni presupuestos en Zoho.')}</p>`); return; }
    const aviso = !c.ventana ? `<p class="wa-nota">${data?.plantilla ? 'Fuera de las 24 h: saldrá con la plantilla de documentos de Meta.' : 'Fuera de las 24 h hace falta la plantilla de documentos de Meta, y aún no está puesta en el hub (WHATSAPP_PLANTILLA_DOCUMENTO).'}</p>` : '';
    abrirPanel(`<p class="wa-nota">Mandar por WhatsApp a ${esc(c.nombre)}:</p>${aviso}<div class="wa-docs">${_docs.map((d, i) => `
      <button type="button" class="btn secundario" data-action="waMandarDoc" data-p0="${i}" ${!c.ventana && !data?.plantilla ? 'disabled' : ''}>${d.tipo === 'factura' ? '🧾 Factura' : '📄 Presupuesto'} ${esc(d.numero)}</button>`).join('')}</div>`);
  },
  async waMandarDoc(i: string) {
    const d = _docs[Number(i)], c = actual;
    if (!d || !c || enviando) return;
    if (!confirm(`¿Mandar a ${c.nombre} ${d.tipo === 'factura' ? 'la factura' : 'el presupuesto'} ${d.numero} por WhatsApp?`)) return;
    enviando = true;
    abrirPanel('<p class="wa-nota"><span class="hex-punto pulso" aria-hidden="true"></span> Bajando el PDF de Zoho y mandándolo…</p>');
    const { data, error } = await llamarFuncion<{ ok: boolean; mensaje: Msg }>('whatsapp', { accion: 'enviar_documento', conversacion_id: c.id, tipo: d.tipo, zoho_id: d.id }, 60000);
    enviando = false;
    if (error || !data?.ok) { abrirPanel(`<p class="wa-err">No se ha enviado: ${esc(error ?? 'error desconocido')}</p>`); void cargarHilo(); return; }
    cerrarPanel();
    toast('Enviado por WhatsApp');
    if (actual?.id === c.id && data.mensaje) { mensajes = [...mensajes, data.mensaje]; pintarMensajes(); }
  },
  // Lo que mandó el cliente y la app no copió: se pide a Meta y se abre aparte.
  async waMedia(msgId: string) {
    const c = actual;
    if (!c) return;
    const w = window.open('', '_blank');
    const { data, error } = await llamarFuncion<{ data_url: string; mime: string }>('whatsapp', { accion: 'media', conversacion_id: c.id, mensaje_id: msgId }, 40000);
    if (error || !data?.data_url) { w?.close(); toast(`No se pudo abrir: ${error ?? 'sin fichero'}`, 'error'); return; }
    if (!w) { toast('El navegador bloqueó la ventana', 'error'); return; }
    const img = w.document.createElement(data.mime.startsWith('image/') ? 'img' : 'iframe');
    img.setAttribute('src', data.data_url);
    img.setAttribute('style', data.mime.startsWith('image/') ? 'max-width:100%' : 'border:0;width:100%;height:100vh');
    w.document.body.style.margin = '0';
    w.document.body.appendChild(img);
  },
});
