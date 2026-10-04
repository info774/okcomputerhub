// #/tickets/whatsapp — de un WhatsApp a un ticket o un trabajo (paridad
// bloque 5, portado de `modules/whatsapp.js` de la app). El aviso entra
// pegado, escrito o como CAPTURA del chat (botón, pegar una imagen o
// soltarla): la captura trae el nombre del contacto, que vive en la barra de
// arriba del chat y no sale al copiar. La función `parse-whatsapp` lo resume
// (Groq, el mismo prompt que la app) y aquí se cruza con las fichas para
// proponer sede, cliente o contacto. NO se crea nada a ciegas: se abre el alta
// de siempre ya rellena (borrador) para repasarla y guardarla. Si la IA falla,
// el análisis de reserva local sigue (con captura no hay reserva: se pide el
// texto). Prefijo de ids: wai-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast } from '../../ui/dom';
import { dejarBorrador } from '../../ui/borrador';

interface Analisis {
  tipo: 'ticket' | 'trabajo'; titulo: string; descripcion: string; prioridad: string;
  remitente: string; telefono: string; cliente: string; fecha: string; hora: string;
  texto?: string; original?: string;
}
interface Candidato {
  tipo: 'local' | 'cliente' | 'contacto'; id: string; nombre: string; sub: string; motivo: string; fuerte: boolean;
  clienteId: string | null; localId: string | null; contactoId: string | null;
}

let _analisis: Analisis | null = null;
let _captura: string | null = null;
let _candidatos: Candidato[] = [];
let _sel = -1;

const $ = (id: string) => document.getElementById(id);
const val = (id: string) => ($(id) as HTMLInputElement | null)?.value.trim() ?? '';

export async function pintarDesdeWhatsapp(el: HTMLElement) {
  _analisis = null; _captura = null; _candidatos = []; _sel = -1;
  el.innerHTML = `<p><a href="#/tickets">← Tickets</a></p>
    <h2>Desde WhatsApp</h2>
    <p class="nota">Pega los mensajes del cliente o una <b>captura del chat</b> (botón, Ctrl+V o soltarla aquí) y sale el ticket o el trabajo relleno, con el cliente reconocido. Nada se guarda hasta que lo repases.</p>
    <section class="tarjeta wai" id="wai" data-on-dragover="waiSobre:$event" data-on-drop="waiSoltar:$event" data-on-paste="waiPegado:$event">
      <label>Mensaje del cliente <textarea id="wai-texto" rows="6" placeholder="[12/7/26, 9:15] Bar Manolo: hola, el TPV no imprime los tickets…"></textarea></label>
      <div class="wai-captura" id="wai-captura" hidden><img id="wai-captura-img" alt="Captura del chat"><button type="button" class="btn secundario" data-action="waiQuitarCaptura">Quitar la captura</button></div>
      <input type="file" id="wai-file" accept="image/*" hidden data-on-change="waiArchivo:$this">
      <div class="acciones">
        <button type="button" class="btn secundario" data-action="waiPegar">📋 Pegar</button>
        <button type="button" class="btn secundario" data-action="waiElegirCaptura">🖼 Captura</button>
        <button type="button" class="btn" data-action="waiAnalizar" id="wai-analizar">Analizar</button>
      </div>
      <p class="nota" id="wai-estado" aria-live="polite"></p>
    </section>
    <section class="tarjeta" id="wai-resultado" hidden></section>`;
}

// ── La captura ────────────────────────────────────────────────────────────
// Al lado largo MAX_LADO y en JPEG: por debajo las letras de WhatsApp dejan de
// leerse; por encima solo se gasta la red del técnico (reescalarCaptura de la app).
const MAX_LADO = 1600;
function reescalar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen ilegible')); };
    img.src = url;
  });
}

async function usarCaptura(file: File | null | undefined): Promise<boolean> {
  if (!file || !/^image\//.test(file.type)) { toast('Eso no es una imagen', 'error'); return false; }
  try { _captura = await reescalar(file); } catch { toast('No se pudo leer la captura', 'error'); return false; }
  ($('wai-captura-img') as HTMLImageElement).src = _captura;
  $('wai-captura')!.hidden = false;
  return true;
}
function quitarCaptura() {
  _captura = null;
  const c = $('wai-captura'); if (c) c.hidden = true;
  $('wai-captura-img')?.removeAttribute('src');
  const f = $('wai-file') as HTMLInputElement | null; if (f) f.value = '';
}

// ── El análisis ───────────────────────────────────────────────────────────
async function analizar() {
  const texto = val('wai-texto');
  if (!_captura && texto.length < 5) { toast('Pega el mensaje del cliente o una captura del chat', 'error'); return; }
  const estado = $('wai-estado')!;
  estado.innerHTML = '<span class="hex-punto pulso" aria-hidden="true"></span> Leyendo el aviso…';
  const { data, error } = await llamarFuncion<Analisis>('parse-whatsapp', _captura ? { texto, imagen: _captura } : { texto }, 60000);
  let a: Analisis | null = data?.titulo ? data : null;
  if (!$('wai')) return;
  if (!a && _captura && texto.length < 5) { estado.textContent = error || 'No se pudo leer la captura: pega el mensaje como texto.'; return; }
  if (!a) { a = analisisDeReserva(texto); estado.textContent = `IA no disponible${error ? ` (${error})` : ''}: revisa el resumen a mano.`; }
  else estado.textContent = '';
  // Con captura, el «mensaje original» es lo que la IA leyó; también al campo, para repasarlo.
  const leido = (a.texto ?? '').trim();
  if (leido && !texto) ($('wai-texto') as HTMLTextAreaElement).value = leido;
  a.original = [texto, leido].filter(Boolean).join('\n\n') || leido || texto;
  _analisis = a;
  _candidatos = await buscarCandidatos(a);
  _sel = _candidatos.length ? 0 : -1;
  pintarResultado();
}

// Sin IA (analisisDeReserva de la app): quita las marcas de WhatsApp, saca el
// remitente y el teléfono, y usa la primera frase útil como título.
export function analisisDeReserva(texto: string): Analisis {
  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const RE_WA = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}):\s*(.*)$/i;
  let remitente = '';
  const cuerpo = lineas.map(l => {
    const m = l.match(RE_WA);
    if (!m) return l;
    if (!remitente) remitente = m[1].trim();
    return m[2].trim();
  }).filter(Boolean);
  const tel = texto.match(/(?:\+?34[\s.-]?)?[6789]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}/);
  const urgente = /\burgent|\bya\b|parad[oa]|no puedo cobrar|no funciona nada/i.test(texto);
  const SALUDO = /^(hola|buenas|buenos?\s+d[ií]as|buenas\s+(tardes|noches)|hey|oye|perdona|disculpa|gracias|por favor)\b[\s!¡,.…]*$/i;
  const primera = cuerpo.find(l => l.length > 3 && !SALUDO.test(l)) || cuerpo[0] || texto;
  return {
    tipo: 'ticket', titulo: primera.replace(/\s+/g, ' ').slice(0, 70), descripcion: cuerpo.join('\n'),
    prioridad: urgente ? 'Alta' : 'Media', remitente, telefono: tel ? tel[0] : '', cliente: '', fecha: '', hora: '',
  };
}

// ── Cruce con las fichas (buscarCandidatos de la app, sobre el espejo) ─────
const norm = (s: string | null | undefined) => (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
// Últimos 9 dígitos: iguala +34 600123456, 600 12 34 56, 0034600123456…
const tel9 = (s: string | null | undefined) => { const d = (s ?? '').toString().replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const limpiar = (s: string) => s.replace(/[(),*."'\\]/g, ' ').replace(/\s+/g, ' ').trim();

interface LocalT { id: string; nombre: string; direccion: string | null; cliente_id: string | null; tels: string[] }
interface ClienteT { id: string; nombre: string; nif: string | null; telefono: string | null }
interface Fichas { locales: LocalT[]; clientes: ClienteT[]; at: number }
let _fichas: Fichas | null = null;
let _cargando: Promise<Fichas> | null = null;

async function fichas(): Promise<Fichas> {
  if (_fichas && Date.now() - _fichas.at < 5 * 60_000) return _fichas;
  return (_cargando ??= (async () => {
    const [l, t, c] = await Promise.all([
      API.fetchAll<any>('locales', { select: 'id,nombre,direccion,cliente_id', activo: 'eq.true', order: 'nombre' }),
      API.fetchAll<any>('local_telefonos', { select: 'local_id,numero' }),
      API.fetchAll<any>('clientes', { select: 'id,nombre,nif,telefono', activo: 'eq.true', order: 'nombre' }),
    ]);
    const porLocal: Record<string, string[]> = {};
    for (const x of t.data ?? []) { const k = tel9(x.numero); if (k) (porLocal[x.local_id] ||= []).push(k); }
    const f: Fichas = { locales: (l.data ?? []).map((x: any) => ({ ...x, tels: porLocal[x.id] ?? [] })), clientes: c.data ?? [], at: Date.now() };
    _fichas = f;
    return f;
  })().finally(() => { _cargando = null; }));
}

// ¿Aparece el nombre de la sede o del cliente en el texto? Sin formas jurídicas y
// aceptando la forma corta de las dos primeras palabras (nombreCitado de la app).
export function nombreCitado(nombre: string, textoNorm: string): boolean {
  const n = norm(nombre).replace(/\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?|c\.?\s?b\.?)\b/g, '').replace(/\s+/g, ' ').trim();
  if (n.length >= 5 && textoNorm.includes(n)) return true;
  const partes = n.split(' ');
  if (partes.length >= 3) { const corto = partes.slice(0, 2).join(' '); return corto.length >= 6 && textoNorm.includes(corto); }
  return false;
}

async function buscarCandidatos(a: Analisis): Promise<Candidato[]> {
  const telB = tel9(a.telefono);
  const nombres = [a.cliente, a.remitente].map(norm).filter(n => n.length >= 3);
  const out: Candidato[] = [];
  const ya = (tipo: string, id: string) => out.some(c => c.tipo === tipo && c.id === id);
  const { locales, clientes } = await fichas();
  const cli = (id: string | null) => clientes.find(c => c.id === id);
  const deLocal = (l: LocalT, motivo: string): Candidato => ({ tipo: 'local', id: l.id, nombre: l.nombre, sub: [cli(l.cliente_id)?.nombre, l.direccion].filter(Boolean).join(' · '),
    motivo, fuerte: motivo.startsWith('teléfono'), clienteId: l.cliente_id, localId: l.id, contactoId: null });
  const deCliente = (c: ClienteT, motivo: string): Candidato => ({ tipo: 'cliente', id: c.id, nombre: c.nombre, sub: [c.nif, c.telefono].filter(Boolean).join(' · '),
    motivo, fuerte: motivo.startsWith('teléfono'), clienteId: c.id, localId: null, contactoId: null });

  if (telB) {
    locales.filter(l => l.tels.includes(telB)).forEach(l => out.push(deLocal(l, 'teléfono del sitio')));
    clientes.filter(c => tel9(c.telefono) === telB).forEach(c => { if (!ya('cliente', c.id)) out.push(deCliente(c, 'teléfono del cliente')); });
  }
  const orC: string[] = [];
  if (telB) orC.push(`telefono.ilike.*${telB}*`, `telefono2.ilike.*${telB}*`);
  nombres.forEach(n => { const t = limpiar(n); if (t) orC.push(`nombre.ilike.*${t}*`); });
  if (orC.length) {
    const { data } = await API.get<any[]>('contactos', { select: 'id,nombre,telefono,telefono2,cargo,empresa,cliente_id,local_id', activo: 'eq.true', or: `(${orC.join(',')})`, limit: '5' });
    (data ?? []).forEach(c => {
      const porTel = !!telB && (tel9(c.telefono) === telB || tel9(c.telefono2) === telB);
      out.push({ tipo: 'contacto', id: c.id, nombre: c.nombre, sub: [c.cargo, c.empresa || cli(c.cliente_id)?.nombre, c.telefono].filter(Boolean).join(' · '),
        motivo: porTel ? 'teléfono del contacto' : 'nombre del contacto', fuerte: porTel, clienteId: c.cliente_id, localId: c.local_id, contactoId: c.id });
    });
  }
  const textoN = norm(a.original);
  if (textoN) {
    locales.filter(l => nombreCitado(l.nombre, textoN)).slice(0, 3).forEach(l => { if (!ya('local', l.id)) out.push(deLocal(l, 'nombre citado en el mensaje')); });
    clientes.filter(c => nombreCitado(c.nombre, textoN)).slice(0, 3).forEach(c => { if (!ya('cliente', c.id)) out.push(deCliente(c, 'nombre citado en el mensaje')); });
  }
  nombres.forEach(n => {
    locales.filter(l => norm(l.nombre).includes(n) || n.includes(norm(l.nombre))).slice(0, 3).forEach(l => { if (!ya('local', l.id)) out.push(deLocal(l, 'nombre del sitio')); });
    clientes.filter(c => norm(c.nombre).includes(n) || n.includes(norm(c.nombre))).slice(0, 3).forEach(c => { if (!ya('cliente', c.id)) out.push(deCliente(c, 'nombre del cliente')); });
  });
  return out.sort((x, y) => Number(y.fuerte) - Number(x.fuerte)).slice(0, 5);
}

// ── El resultado ──────────────────────────────────────────────────────────
const ICONO: Record<Candidato['tipo'], string> = { local: '📍', cliente: '🏢', contacto: '👤' };

function pintarResultado() {
  const a = _analisis!, el = $('wai-resultado')!;
  const cuando = [a.fecha, a.hora].filter(Boolean).join(' ');
  el.innerHTML = `<h3>Resumen</h3>
    <div class="segmentado" role="radiogroup" aria-label="Qué crear">
      <button type="button" role="radio" id="wai-tipo-ticket" data-action="waiTipo" data-p0="ticket">🎫 Ticket</button>
      <button type="button" role="radio" id="wai-tipo-trabajo" data-action="waiTipo" data-p0="trabajo">🛠 Trabajo</button></div>
    <input type="hidden" id="wai-tipo">
    <label>Título <input id="wai-titulo" maxlength="200" value="${esc(a.titulo)}"></label>
    <label>Descripción <textarea id="wai-desc" rows="4">${esc(a.descripcion)}</textarea></label>
    <label>Prioridad <select id="wai-prioridad">${['Alta', 'Media', 'Baja'].map(p => `<option ${p === a.prioridad ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    ${cuando ? `<p class="nota" id="wai-cuando">📅 El cliente pide <b>${esc(cuando)}</b>: se rellenará en el trabajo.</p>` : ''}
    <h3>¿De quién es?</h3><div id="wai-candidatos" class="wai-cands"></div>
    <div class="acciones"><button type="button" class="btn" data-action="waiContinuar">Continuar</button></div>`;
  ponerTipo(a.tipo);
  pintarCandidatos();
  el.hidden = false;
}

function pintarCandidatos() {
  const el = $('wai-candidatos');
  if (!el) return;
  if (!_candidatos.length) {
    const quien = [_analisis?.cliente, _analisis?.remitente, _analisis?.telefono].filter(Boolean).join(' / ');
    el.innerHTML = `<p class="nota">No he reconocido al cliente${quien ? ` (${esc(quien)})` : ''}. Lo podrás buscar en el formulario.</p>`;
    return;
  }
  const fila = (i: number, icono: string, nombre: string, sub: string) => `<button type="button" class="wai-cand" role="radio" aria-checked="${i === _sel}" data-action="waiElegir" data-p0="${i}">
    <span aria-hidden="true">${icono}</span><span class="wai-cand-txt"><b>${esc(nombre)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="wai-cand-ok">${i === _sel ? '✓' : ''}</span></button>`;
  el.innerHTML = _candidatos.map((c, i) => fila(i, ICONO[c.tipo], c.nombre, `${c.sub ? c.sub + ' · ' : ''}coincide por ${c.motivo}`)).join('')
    + fila(-1, '🔎', 'Ninguno / buscarlo yo', '');
}

function ponerTipo(t: string) {
  ($('wai-tipo') as HTMLInputElement).value = t;
  for (const x of ['ticket', 'trabajo']) {
    const b = $(`wai-tipo-${x}`);
    b?.classList.toggle('activo', x === t);
    b?.setAttribute('aria-checked', String(x === t));
  }
}

function continuar() {
  const a = _analisis;
  if (!a) return;
  const titulo = val('wai-titulo');
  if (!titulo) { toast('Pon un título antes de continuar', 'error'); return; }
  const tipo = val('wai-tipo') === 'trabajo' ? 'trabajo' : 'ticket';
  const c = _sel >= 0 ? _candidatos[_sel] : null;
  // El mensaje original queda dentro del registro: se relee sin volver a WhatsApp.
  const descripcion = [val('wai-desc'), '— Mensaje original (WhatsApp) —', a.original].filter(Boolean).join('\n\n');
  const base = { cliente_id: c?.clienteId ?? null, local_id: c?.localId ?? null, contacto_id: c?.contactoId ?? null, titulo, descripcion, prioridad: val('wai-prioridad') };
  if (tipo === 'trabajo') { dejarBorrador('trabajo', { ...base, tipo: 'Asistencia', fecha: a.fecha, hora: a.hora }); ir('trabajos', 'nuevo'); }
  else { dejarBorrador('ticket', { ...base, canal: 'whatsapp' }); ir('tickets', 'nuevo'); }
}

registrarAcciones({
  waiAnalizar: analizar,
  waiElegirCaptura: () => ($('wai-file') as HTMLInputElement | null)?.click(),
  async waiArchivo(input: HTMLInputElement) { if (await usarCaptura(input.files?.[0])) void analizar(); },
  waiQuitarCaptura: quitarCaptura,
  // Pegar una IMAGEN la toma como captura; pegar texto sigue siendo pegar texto.
  async waiPegado(ev: ClipboardEvent) {
    const item = [...(ev.clipboardData?.items ?? [])].find(i => i.type?.startsWith('image/'));
    if (!item) return;
    ev.preventDefault();
    if (await usarCaptura(item.getAsFile())) void analizar();
  },
  waiSobre(ev: DragEvent) { ev.preventDefault(); },
  async waiSoltar(ev: DragEvent) {
    const f = [...(ev.dataTransfer?.files ?? [])].find(x => x.type?.startsWith('image/'));
    if (!f) return;
    ev.preventDefault();
    if (await usarCaptura(f)) void analizar();
  },
  // En el portapapeles puede haber una captura (lo deja «Compartir» de muchos móviles): primero la imagen.
  async waiPegar() {
    try {
      for (const item of (await navigator.clipboard.read?.()) ?? []) {
        const tipo = item.types.find(t => t.startsWith('image/'));
        if (!tipo) continue;
        if (await usarCaptura(new File([await item.getType(tipo)], 'captura', { type: tipo }))) void analizar();
        return;
      }
    } catch { /* sin permiso o sin API de imágenes: se sigue con el texto */ }
    try {
      const t = await navigator.clipboard.readText();
      if (!t?.trim()) { toast('El portapapeles está vacío', 'error'); return; }
      ($('wai-texto') as HTMLTextAreaElement).value = t.trim();
      void analizar();
    } catch { toast('No se pudo leer el portapapeles: pega el texto a mano', 'error'); $('wai-texto')?.focus(); }
  },
  waiTipo: ponerTipo,
  waiElegir(i: string) { _sel = Number(i); pintarCandidatos(); },
  waiContinuar: continuar,
});
